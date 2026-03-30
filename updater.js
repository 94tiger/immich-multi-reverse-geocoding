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
    interval: parseInt(process.env.INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100', 10),
};

const isForceMode = process.argv.includes('--force');
let locationMap = {};

// L1 캐시 (메모리)
const addressCache = new Map();
const MAX_CACHE_SIZE = 50000;

// L2 캐시 (DB) 유효기간
const CACHE_TTL_DAYS = 180;

// 중복 실행 방지용 Lock
let isRunning = false;

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

function getCacheKey(lat, lon) {
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;
}

function setMemoryCache(cacheKey, value) {
    if (addressCache.size >= MAX_CACHE_SIZE) {
        const firstKey = addressCache.keys().next().value;
        addressCache.delete(firstKey);
    }
    addressCache.set(cacheKey, value);
}

async function ensureCacheTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS "custom_naver_geocode_cache" (
            "cache_key" VARCHAR PRIMARY KEY,
            "state" VARCHAR,
            "city" VARCHAR,
            "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function fetchNaverAddress(lat, lon) {
    return new Promise((resolve) => {
        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr,addr`;
        const options = {
            headers: {
                'x-ncp-apigw-api-key-id': config.naverId,
                'x-ncp-apigw-api-key': config.naverSecret,
            },
        };

        https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        resolve(null);
                        return;
                    }

                    const parsed = JSON.parse(data);
                    if (parsed.status?.code !== 0 || !Array.isArray(parsed.results) || parsed.results.length === 0) {
                        resolve(null);
                        return;
                    }

                    const admResult = parsed.results.find((r) => r.name === 'admcode') || parsed.results[0];
                    const region = admResult.region;

                    const stateName = region.area1?.name || '';
                    const area2 = region.area2?.name || '';
                    const area3 = region.area3?.name || '';
                    const area4 = region.area4?.name || '';

                    const cityParts = [area2, area3, area4].filter((part) => part && part.trim() !== '');
                    let cityName = cityParts.join(' ');

                    let buildingName = '';
                    const roadResult = parsed.results.find((r) => r.name === 'roadaddr');

                    // 하드코딩 블랙리스트 없이 길이와 숫자 여부만 판별
                    if (roadResult?.land?.addition0?.value) {
                        const rawBuildingName = roadResult.land.addition0.value.trim();
                        if (rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
                            buildingName = rawBuildingName;
                        }
                    }

                    if (buildingName) {
                        cityName = `${cityName} (${buildingName})`.trim();
                    }

                    resolve({ state: stateName, city: cityName });
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function getNaverAddress(client, lat, lon) {
    const cacheKey = getCacheKey(lat, lon);

    // 1순위: L1 메모리 캐시
    if (addressCache.has(cacheKey)) {
        return { ...addressCache.get(cacheKey), fromCache: 'memory' };
    }

    // 2순위: L2 DB 캐시 (TTL 180일)
    try {
        const cacheRes = await client.query(
            `SELECT "state", "city"
             FROM "custom_naver_geocode_cache"
             WHERE "cache_key" = $1
               AND "updated_at" >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
             LIMIT 1`,
            [cacheKey, CACHE_TTL_DAYS],
        );

        if (cacheRes.rows.length > 0) {
            const cachedAddress = {
                state: cacheRes.rows[0].state,
                city: cacheRes.rows[0].city,
            };
            setMemoryCache(cacheKey, cachedAddress);
            return { ...cachedAddress, fromCache: 'db' };
        }
    } catch (e) {
        // DB 캐시 조회 실패 시에도 API fallback 진행
    }

    // 3순위: Naver API 호출
    const apiAddress = await fetchNaverAddress(lat, lon);
    if (!apiAddress) return null;

    setMemoryCache(cacheKey, apiAddress);

    try {
        await client.query(
            `INSERT INTO "custom_naver_geocode_cache" ("cache_key", "state", "city", "updated_at")
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT ("cache_key") DO UPDATE
             SET "state" = EXCLUDED."state",
                 "city" = EXCLUDED."city",
                 "updated_at" = CURRENT_TIMESTAMP`,
            [cacheKey, apiAddress.state, apiAddress.city],
        );
    } catch (e) {
        // DB 캐시 저장 실패는 치명적이지 않으므로 무시
    }

    return { ...apiAddress, fromCache: false };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main(forceUpdate = false) {
    // 타이머가 겹쳐 동일 프로세스가 2개 이상 도는 것 방지
    if (isRunning) {
        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ⏳ 이미 작업이 진행 중입니다. 스킵합니다.`);
        return;
    }

    const client = new Client(config.db);
    isRunning = true;

    try {
        await client.connect();
        await ensureCacheTable(client);

        // 실패 row 무한 반복 방지를 위해 main 1회당 SELECT는 딱 한 번만 수행
        let queryCondition = `WHERE "latitude" BETWEEN 33 AND 43 AND "longitude" BETWEEN 124 AND 132`;
        queryCondition += ` AND ("country" IN ('South Korea', '대한민국', 'Korea'))`;

        if (!forceUpdate) {
            queryCondition += ` AND ("city" IS NULL OR "city" !~ '[가-힣]')`;
        }

        const query = `SELECT "assetId", "latitude", "longitude", "country", "city", "state" FROM "asset_exif" ${queryCondition};`;
        const res = await client.query(query);

        if (res.rows.length === 0) {
            console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🔍 업데이트할 항목이 없습니다.`);
            return;
        }

        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🔍 총 ${res.rows.length}장 처리 시작 (현재 메모리 캐시 크기: ${addressCache.size})...`);

        let processedCount = 0;
        let totalUpdated = 0;
        let apiCallCount = 0;
        let dbCacheHitCount = 0;
        let memoryCacheHitCount = 0;
        let fallbackHitCount = 0;

        for (const row of res.rows) {
            processedCount++;

            try {
                let address = await getNaverAddress(client, row.latitude, row.longitude);

                if (address?.fromCache === 'memory') {
                    memoryCacheHitCount++;
                } else if (address?.fromCache === 'db') {
                    dbCacheHitCount++;
                } else {
                    apiCallCount++;
                }

                if (!address) {
                    const korState = translateLocation(row.state);
                    const korCity = translateLocation(row.city);

                    if (korState || korCity) {
                        address = {
                            state: korState || row.state,
                            city: korCity || row.city,
                        };
                        fallbackHitCount++;
                    }
                }

                if (address) {
                    await client.query(
                        `UPDATE "asset_exif" SET "country" = '대한민국', "state" = $1, "city" = $2 WHERE "assetId" = $3`,
                        [address.state, address.city, row.assetId],
                    );
                    totalUpdated++;
                }

                if (processedCount % 500 === 0) {
                    console.log(
                        `⏳ 진행 중: ${processedCount}장 스캔 완료... (API 시도: ${apiCallCount} | DB 캐시 적중: ${dbCacheHitCount} | 메모리 캐시 적중: ${memoryCacheHitCount} | DB 반영: ${totalUpdated})`,
                    );
                }
            } catch (err) {
                // 개별 row 에러는 무시하고 다음 사진으로 진행
            }

            await sleep(config.delay);
        }

        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🎉 작업 완료 상세 리포트`);
        console.log(` ┌─ 총 처리 건수: ${processedCount}장`);
        console.log(` ├─ 실제 DB 반영: ${totalUpdated}장`);
        console.log(` ├─ API 시도 건수: ${apiCallCount}번`);
        console.log(` ├─ DB 캐시 적중: ${dbCacheHitCount}번`);
        console.log(` ├─ 메모리 캐시 적중: ${memoryCacheHitCount}번`);
        console.log(` └─ 사전 번역(Fallback): ${fallbackHitCount}번`);
    } catch (err) {
        console.error('❌ [DB 에러]', err.message);
    } finally {
        try {
            await client.end();
        } catch (e) {}
        isRunning = false;
    }
}

if (isForceMode) {
    main(true).then(() => process.exit(0));
} else {
    main(false);
    setInterval(() => main(false), config.interval);
}
