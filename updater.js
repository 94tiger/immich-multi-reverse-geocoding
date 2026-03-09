<<<<<<< HEAD
require('dotenv').config({ path: '/app/.env' });
const { Client } = require('pg');
const https = require('https');

// [설정값 로드]
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
    // 실행 주기 (기본 24시간)
    interval: parseInt(process.env.INTERVAL_HOURS || '24') * 60 * 60 * 1000,
    // 사진당 지연 시간 (기본 0.1초)
    delay: parseInt(process.env.STEP_DELAY_MS || '100')
};

/**
 * 네이버 역지오코딩 API 호출 함수
 */
function getNaverAddress(lat, lon) {
    return new Promise((resolve) => {
=======
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
>>>>>>> 7331ebf1ce1c3c052116dde29bddbdca02d3ff29
        const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr`;
        const options = {
            headers: {
                'x-ncp-apigw-api-key-id': config.naverId,
                'x-ncp-apigw-api-key': config.naverSecret
            }
        };
<<<<<<< HEAD

=======
>>>>>>> 7331ebf1ce1c3c052116dde29bddbdca02d3ff29
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
<<<<<<< HEAD
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.status.code === 0 && parsed.results.length > 0) {
                            const region = parsed.results[0].region;
                            const state = region.area1.name;     // 도/특별시/광역시
                            const city = region.area2.name;      // 시/군/구
                            const town = region.area3.name;      // 읍/면/동
                            resolve({ state, city: `${city} ${town}`.trim() });
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                } else {
                    resolve(null); // 에러 발생 시 해당 사진은 건너뜀
                }
            });
        }).on('error', () => resolve(null));
    });
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

/**
 * 메인 업데이트 로직
 */
async function main() {
    const client = new Client(config.db);
    try {
        await client.connect();
        
        /**
         * 🎯 핵심 변경 사항: 대한민국 좌표 필터링 (Geofencing)
         * - 위도(Latitude): 33 ~ 43 (대한민국 위도 범위)
         * - 경도(Longitude): 124 ~ 132 (대한민국 경도 범위)
         * - 조건: 한글 주소가 없거나 '대한민국'이 아닌 데이터만 추출
         */
        const query = `
            SELECT "assetId", "latitude", "longitude" 
            FROM "asset_exif" 
            WHERE "latitude" BETWEEN 33 AND 43 
              AND "longitude" BETWEEN 124 AND 132
              AND ("country" != '대한민국' OR "country" IS NULL OR "city" !~ '[가-힣]');
        `;

        const res = await client.query(query);
        const rows = res.rows;
        
        console.log(`[${new Date().toISOString()}] 🔍 국내 사진 스캔 완료: 총 ${rows.length}장 업데이트 필요`);

        let updatedCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const address = await getNaverAddress(row.latitude, row.longitude);
                if (address) {
                    const updateQuery = `
                        UPDATE "asset_exif" 
                        SET "country" = '대한민국', "state" = $1, "city" = $2 
                        WHERE "assetId" = $3
                    `;
                    await client.query(updateQuery, [address.state, address.city, row.assetId]);
                    updatedCount++;

                    // 1,000장 단위로 진행 로그 출력
                    if (updatedCount % 1000 === 0) {
                        console.log(`⏳ 진행 중: ${updatedCount}장 완료...`);
                    }
                }
            } catch (err) {
                // 개별 사진 에러 시 중단하지 않고 계속 진행
            }
            
            // API 부하 방지 지연 시간
            await sleep(config.delay); 
        }

        if (updatedCount > 0) {
            console.log(`[${new Date().toISOString()}] 🎉 작업 완료! 총 ${updatedCount}장의 주소를 한글로 업데이트했습니다.`);
        } else {
            console.log(`[${new Date().toISOString()}] ✨ 모든 국내 사진 주소가 최신 상태입니다.`);
        }

    } catch (err) {
        console.error("❌ DB 접속 또는 실행 에러:", err.message);
=======
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
>>>>>>> 7331ebf1ce1c3c052116dde29bddbdca02d3ff29
    } finally {
        await client.end();
    }
}

<<<<<<< HEAD
/**
 * 스케줄러 시작
 */
async function start() {
    console.log(`================================================`);
    console.log(`🚀 Immich Naver Geocoding Worker 가동`);
    console.log(`📍 대상 범위: 대한민국 영토 내 좌표 (Lat 33-43, Lon 124-132)`);
    console.log(`⏰ 실행 주기: ${process.env.INTERVAL_HOURS || '24'}시간`);
    console.log(`================================================`);
    
    await main();
    setInterval(main, config.interval);
}

start();
=======
console.log(`🌟 Immich Naver Reverse Geocoding 워커 가동 (주기: ${process.env.INTERVAL_HOURS || '24'}시간)`);
run();
setInterval(run, config.interval);
>>>>>>> 7331ebf1ce1c3c052116dde29bddbdca02d3ff29
