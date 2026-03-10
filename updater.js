require('dotenv').config({ path: '/app/.env' });
const { Client } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
    naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
    naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
    db: {
        user: (process.env.DB_USERNAME || 'postgres').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        host: (process.env.DB_HOSTNAME || 'immich_postgres').trim(),
        database: (process.env.DB_DATABASE_NAME || 'immich').trim(),
        port: 5432,
    },
    interval: parseInt(process.env.INTERVAL_HOURS || '24') * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100')
};

const isForceMode = process.argv.includes('--force');
let locationMap = {};

try {
    const mappingPath = path.join(__dirname, 'mapping.json');
    if (fs.existsSync(mappingPath)) {
        locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
} catch (e) {}

function translateLocation(engName) {
    if (!engName) return null;
    const lowerEng = engName.toLowerCase();
    for (const [eng, kor] of Object.entries(locationMap)) {
        if (lowerEng.includes(eng.toLowerCase())) return kor;
    }
    return null;
}

function getNaverAddress(lat, lon) {
    return new Promise((resolve) => {
        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr`;
        const options = {
            headers: { 'x-ncp-apigw-api-key-id': config.naverId, 'x-ncp-apigw-api-key': config.naverSecret }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const parsed = JSON.parse(data);
                        if (parsed.status.code === 0 && parsed.results.length > 0) {
                            const region = parsed.results[0].region;
                            resolve({ 
                                state: region.area1.name, 
                                city: `${region.area2.name} ${region.area3.name}`.trim() 
                            });
                            return;
                        }
                    }
                    resolve(null);
                } catch (e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function main(forceUpdate = false) {
    const client = new Client(config.db);
    try {
        await client.connect();
        
        let queryCondition = `WHERE "latitude" BETWEEN 33 AND 43 AND "longitude" BETWEEN 124 AND 132`;
        if (!forceUpdate) {
            queryCondition += ` AND ("country" != '대한민국' OR "country" IS NULL OR "city" IS NULL OR "city" !~ '[가-힣]')`;
        }

        const query = `SELECT "assetId", "latitude", "longitude", "country", "city", "state" FROM "asset_exif" ${queryCondition};`;
        const res = await client.query(query);
        
        console.log(`[${new Date().toISOString()}] 🔍 스캔 시작: 총 ${res.rows.length}장 대상`);

        let updatedCount = 0;
        for (const row of res.rows) {
            try {
                let address = await getNaverAddress(row.latitude, row.longitude);
                
                if (!address) {
                    const korState = translateLocation(row.state);
                    const korCity = translateLocation(row.city);
                    
                    // 지명 정보가 매핑 사전에 존재할 때만 순수하게 번역된 주소 사용
                    if (korState || korCity) {
                        address = { state: korState || row.state, city: korCity || row.city };
                    }
                }

                if (address) {
                    await client.query(
                        `UPDATE "asset_exif" SET "country" = '대한민국', "state" = $1, "city" = $2 WHERE "assetId" = $3`,
                        [address.state, address.city, row.assetId]
                    );
                    updatedCount++;
                    if (updatedCount % 500 === 0) console.log(`⏳ 진행 중: ${updatedCount}장 완료...`);
                }
            } catch (err) {}
            await sleep(config.delay); 
        }
        console.log(`[${new Date().toISOString()}] 🎉 작업 완료: 총 ${updatedCount}장 업데이트됨`);
    } catch (err) {
        console.error("❌ [DB 에러]", err.message);
    } finally {
        await client.end();
    }
}

if (isForceMode) {
    main(true).then(() => process.exit(0));
} else {
    main(false);
    setInterval(() => main(false), config.interval);
}
