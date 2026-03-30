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
const addressCache = new Map();
const MAX_CACHE_SIZE = 10000; // 메모리 보호를 위한 캐시 최대 크기

try {
    const mappingPath = path.join(__dirname, 'mapping.json');
    if (fs.existsSync(mappingPath)) {
        locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
} catch (e) {}

function translateLocation(engName) {
    if (!engName) return null;
    const original = engName.toLowerCase().trim();
    const clean = original.replace(/-(do|si|gun|gu|eup|myeon|dong|ri)$/i, '').trim();
    
    if (locationMap[original]) return locationMap[original];
    if (locationMap[clean]) return locationMap[clean];

    for (const [eng, kor] of Object.entries(locationMap)) {
        const key = eng.toLowerCase();
        if (original === key || original.split('-').includes(key)) return kor;
    }
    return null;
}

function getNaverAddress(lat, lon) {
    return new Promise((resolve) => {
        // 소수점 4자리 반올림 (약 11m 오차 범위 내 동일 지역 간주)
        const cacheKey = `${parseFloat(lat).toFixed(4)}_${parseFloat(lon).toFixed(4)}`;
        
        if (addressCache.has(cacheKey)) {
            return resolve({ ...addressCache.get(cacheKey), fromCache: true });
        }

        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr,addr`;
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
                            const admResult = parsed.results.find(r => r.name === 'admcode') || parsed.results[0];
                            const region = admResult.region;
                            
                            const stateName = region.area1.name;
                            const area2 = region.area2 ? region.area2.name : '';
                            const area3 = region.area3 ? region.area3.name : '';
                            const area4 = region.area4 ? region.area4.name : '';
                            
                            let cityParts = [area2, area3, area4].filter(part => part && part.trim() !== '');
                            let cityName = cityParts.join(' ');
                            
                            let buildingName = '';
                            const roadResult = parsed.results.find(r => r.name === 'roadaddr');
                            if (roadResult && roadResult.land && roadResult.land.addition0 && roadResult.land.addition0.value) {
                                const rawBuildingName = roadResult.land.addition0.value.trim();
                                if (rawBuildingName.length >= 2 && isNaN(rawBuildingName)) {
                                    buildingName = rawBuildingName;
                                }
                            }

                            if (buildingName) {
                                cityName = `${cityName} (${buildingName})`.trim();
                            }

                            const result = { state: stateName, city: cityName };
                            
                            // 캐시 저장 (크기 제한 확인)
                            if (addressCache.size >= MAX_CACHE_SIZE) {
                                const firstKey = addressCache.keys().next().value;
                                addressCache.delete(firstKey);
                            }
                            addressCache.set(cacheKey, result);
                            
                            resolve({ ...result, fromCache: false });
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
let isRunning = false;

async function main(forceUpdate = false) {
    if (isRunning) {
        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ⏳ 이미 작업이 진행 중입니다. 스킵합니다.`);
        return;
    }

    const client = new Client(config.db);
    isRunning = true;

    try {
        await client.connect();
        let totalUpdated = 0;
        let cacheHitCount = 0;
        
        while (true) {
            let queryCondition = `WHERE "latitude" BETWEEN 33 AND 43 AND "longitude" BETWEEN 124 AND 132`;
            queryCondition += ` AND ("country" IN ('South Korea', '대한민국', 'Korea'))`;

            if (!forceUpdate) {
                queryCondition += ` AND ("city" IS NULL OR "city" !~ '[가-힣]')`;
            }

            const query = `SELECT "assetId", "latitude", "longitude", "country", "city", "state" FROM "asset_exif" ${queryCondition} LIMIT 1000;`;
            const res = await client.query(query);
            
            if (res.rows.length === 0) break;

            console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🔍 1,000장 처리 시작 (캐시 크기: ${addressCache.size})...`);

            for (const row of res.rows) {
                try {
                    let address = await getNaverAddress(row.latitude, row.longitude);
                    
                    if (address && address.fromCache) cacheHitCount++;

                    if (!address) {
                        const korState = translateLocation(row.state);
                        const korCity = translateLocation(row.city);
                        if (korState || korCity) {
                            address = { state: korState || row.state, city: korCity || row.city };
                        }
                    }

                    if (address) {
                        await client.query(
                            `UPDATE "asset_exif" SET "country" = '대한민국', "state" = $1, "city" = $2 WHERE "assetId" = $3`,
                            [address.state, address.city, row.assetId]
                        );
                        totalUpdated++;
                    }
                } catch (err) {
                    // 개별 업데이트 에러는 무시하고 진행
                }
                await sleep(config.delay); 
            }

            // forceUpdate가 아니더라도 한 번의 cycle(LIMIT 1000)에서 업데이트된 게 없으면 
            // 무한 루프 방지를 위해 탈출 (실패 row 반복 방어)
            if (totalUpdated === 0 && !forceUpdate) break;
            if (forceUpdate) break; 
        }
        
        if (totalUpdated > 0) {
            console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🎉 작업 완료! 총 ${totalUpdated}장 업데이트 (캐시 활용: ${cacheHitCount}번)`);
        }
    } catch (err) {
        console.error("❌ [DB 에러]", err.message);
    } finally {
        await client.end();
        isRunning = false;
    }
}

if (isForceMode) {
    main(true).then(() => process.exit(0));
} else {
    main(false);
    setInterval(() => main(false), config.interval);
}
