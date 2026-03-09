require('dotenv').config();
const { Client } = require('pg');
const https = require('https');

// 환경 변수 로드
const config = {
    naverId: process.env.NAVER_CLIENT_ID,
    naverSecret: process.env.NAVER_CLIENT_SECRET,
    db: {
        user: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOSTNAME || 'immich_postgres',
        database: process.env.DB_DATABASE_NAME || 'immich',
        port: 5432,
    },
    interval: parseInt(process.env.INTERVAL_HOURS || '24') * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100')
};

async function getNaverAddress(lat, lon) {
    return new Promise((resolve, reject) => {
        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr`;
        const options = {
            headers: {
                'x-ncp-apigw-api-key-id': config.naverId,
                'x-ncp-apigw-api-key': config.naverSecret
            }
        };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.status.code === 0 && parsed.results.length > 0) {
                        const region = parsed.results[0].region;
                        resolve({ 
                            state: region.area1.name, 
                            city: `${region.area2.name} ${region.area3.name}`.trim() 
                        });
                    } else resolve(null);
                } catch (e) { resolve(null); }
            });
        }).on('error', reject);
    });
}

async function run() {
    const client = new Client(config.db);
    try {
        await client.connect();
        console.log(`[${new Date().toISOString()}] 🚀 스캔 시작...`);

        const query = `
            SELECT "assetId", "latitude", "longitude" 
            FROM "asset_exif" 
            WHERE "latitude" IS NOT NULL 
              AND "longitude" IS NOT NULL 
              AND ("country" != '대한민국' OR "country" IS NULL OR "city" !~ '[가-힣]');
        `;
        const res = await client.query(query);
        const rows = res.rows;
        console.log(`🔍 대상 사진: ${rows.length}장`);

        let updated = 0;
        for (const row of rows) {
            const addr = await getNaverAddress(row.latitude, row.longitude);
            if (addr) {
                await client.query(
                    `UPDATE "asset_exif" SET "country" = '대한민국', "state" = $1, "city" = $2 WHERE "assetId" = $3`,
                    [addr.state, addr.city, row.assetId]
                );
                updated++;
                if (updated % 100 === 0) console.log(`⏳ ${updated}장 처리 중...`);
            }
            await new Promise(r => setTimeout(r, config.delay));
        }
        console.log(`✅ 완료! 총 ${updated}장의 주소를 업데이트했습니다.`);
    } catch (err) {
        console.error("❌ 에러 발생:", err.message);
    } finally {
        await client.end();
    }
}

console.log(`🌟 Immich Naver Reverse Geocoding 워커 가동 (주기: ${process.env.INTERVAL_HOURS || '24'}시간)`);
run();
setInterval(run, config.interval);
