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

// [캐시 설정] 메모리 보호를 위한 최대 크기 제한
const addressCache = new Map();
const MAX_CACHE_SIZE = 50000;

// [안전장치] 중복 실행 방지용 자물쇠(Lock)
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

function getNaverAddress(lat, lon) {
    return new Promise((resolve) => {
        // 건물명 매칭 정확도를 위해 소수점 5자리(약 1.1m 오차) 기준으로 캐시
        const cacheKey = `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;

        // 1. 캐시 적중 시 API 호출 없이 즉시 반환
        if (addressCache.has(cacheKey)) {
            return resolve({ ...addressCache.get(cacheKey), fromCache: true });
        }

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
                    if (res.statusCode === 200) {
                        const parsed = JSON.parse(data);
                        if (parsed.status.code === 0 && parsed.results.length > 0) {
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

                            // 하드코딩 필터 없이 유효한 문자열인지 정도만 검증
                            if (roadResult?.land?.addition0?.value) {
                                const rawBuildingName = roadResult.land.addition0.value.trim();
                                if (rawBuildingName.length >= 2 && Number.isNaN(Number(rawBuildingName))) {
                                    buildingName = rawBuildingName;
                                }
                            }

                            if (buildingName) {
                                cityName = `${cityName} (${buildingName})`.trim();
                            }

                            const result = { state: stateName, city: cityName };

                            // 2. 캐시 저장 (최대치 도달 시 가장 오래된 키 제거)
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
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
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

        // 무한 루프 없이 main 1회당 DB를 한 번만 스캔
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

        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🔍 총 ${res.rows.length}장 처리 시작 (현재 캐시 크기: ${addressCache.size})...`);

        let totalUpdated = 0;
        let cacheHitCount = 0;
        let fallbackHitCount = 0;

        for (const row of res.rows) {
            try {
                let address = await getNaverAddress(row.latitude, row.longitude);

                if (address && address.fromCache) cacheHitCount++;

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

                    if (totalUpdated % 500 === 0) {
                        console.log(`⏳ 진행 중: ${totalUpdated}장 완료...`);
                    }
                }
            } catch (err) {
                // 개별 업데이트 에러는 무시하고 다음 사진으로 진행
            }

            await sleep(config.delay);
        }

        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 🎉 작업 완료! 총 ${totalUpdated}장 업데이트`);
        console.log(` - API 캐시 활용: ${cacheHitCount}번`);
        console.log(` - 영문/사전 번역 활용: ${fallbackHitCount}번`);
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
