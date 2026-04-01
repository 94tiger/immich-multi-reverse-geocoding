'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fetchAddress, isKorean } = require('./geocoder');
const { createClient, ensureCacheTable, warmUpCache, upsertCache, bulkUpdate, bulkUpdateByIds } = require('./db');

const FAST_TRACK_CHUNK_SIZE = 2000;
const FAST_TRACK_LOG_INTERVAL = 10000;
const API_TRACK_LOG_INTERVAL = 50;
const MAX_CACHE_SIZE = 50000;

// 매핑 번역 사전 (Fallback용)
let locationMap = {};
try {
    const mappingPath = path.join(__dirname, '..', 'mapping.json');
    if (fs.existsSync(mappingPath)) {
        locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
} catch (e) {}

// L1 메모리 캐시 (재시작 시 초기화됨, warmUp으로 DB에서 재적재)
const addressCache = new Map();

function getCacheKey(lat, lon) {
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;
}

function setMemoryCache(key, value, enforceLimit = true) {
    if (enforceLimit && addressCache.size >= MAX_CACHE_SIZE) {
        addressCache.delete(addressCache.keys().next().value);
    }
    addressCache.set(key, value);
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 사용자/경로 필터 조건과 파라미터를 반환한다.
 * @param {number} startIdx - 다음 placeholder 번호 시작값 ($1 기준)
 * @returns {{ clause: string, params: any[] }}
 */
function buildFilterClause(startIdx) {
    const parts = [];
    const params = [];
    let idx = startIdx;

    if (config.filterUserIds?.length > 0) {
        params.push(config.filterUserIds);
        parts.push(`a."ownerId" = ANY($${idx++}::uuid[])`);
    }
    if (config.filterPathPrefixes?.length > 0) {
        const orClauses = config.filterPathPrefixes.map((prefix) => {
            params.push(prefix + '%');
            return `a."originalPath" LIKE $${idx++}`;
        });
        parts.push(`(${orClauses.join(' OR ')})`);
    }

    return {
        clause: parts.length > 0 ? 'AND ' + parts.join(' AND ') : '',
        params,
    };
}

/**
 * @param {boolean} forceUpdate - 강제 재처리 여부
 * @param {(msg: string) => void} log - 로그 출력 함수
 * @param {'all'|'korea'|'world'} target - 처리 범위
 * @returns {Promise<object>} 실행 통계
 */
async function runWorker(forceUpdate, log, target = 'all') {
    const stats = {
        warmedCount: 0,
        koreanTotal: 0,
        worldTotal: 0,
        fastTrackCount: 0,
        apiTrackCount: 0,
        fastTrackUpdated: 0,
        apiTrackUpdated: 0,
        worldUpdated: 0,
        apiCallCount: 0,
        memoryHitCount: 0,
        fallbackHitCount: 0,
        totalUpdated: 0,
        startTime: Date.now(),
        endTime: null,
    };

    const client = createClient();
    try {
        await client.connect();
        await ensureCacheTable(client);

        stats.warmedCount = await warmUpCache(client, addressCache, config.cacheTtlDays);
        log(`🔥 캐시 워밍업 완료: ${stats.warmedCount}건 적재`);

        // ── Phase 0+1+2: 한국 자산 처리 ─────────────────────────────
        if (config.geocodingKorea !== 'disabled' && (target === 'all' || target === 'korea')) {
            const { clause: filterClause, params: filterParams } = buildFilterClause(1);
            const needsJoin = filterClause !== '';

            let korQuery = `
                SELECT ae."assetId", ae.latitude, ae.longitude, ae.country, ae.city, ae.state
                FROM public."asset_exif" ae
                ${needsJoin ? 'INNER JOIN public.asset a ON a.id = ae."assetId"' : ''}
                WHERE ae.latitude BETWEEN 33 AND 43
                  AND ae.longitude BETWEEN 124 AND 132
                  AND ae.country IN ('South Korea', '대한민국', 'Korea')
                  ${needsJoin ? 'AND a."deletedAt" IS NULL' : ''}
            `;
            if (!forceUpdate) {
                korQuery += ` AND (ae.city IS NULL OR ae.city !~ '[가-힣]')`;
            }
            korQuery += ` ${filterClause}`;

            const korRes = await client.query(korQuery, filterParams);
            stats.koreanTotal = korRes.rows.length;

            if (korRes.rows.length === 0) {
                log(`🔍 한국 업데이트 대상 없음`);
            } else {
                log(`🧭 한국 대상 ${korRes.rows.length}건 분류 중...`);

                const fastTrack = [];
                const apiTrack = [];

                for (const row of korRes.rows) {
                    if (addressCache.has(getCacheKey(row.latitude, row.longitude))) {
                        fastTrack.push(row);
                    } else {
                        apiTrack.push(row);
                    }
                }

                stats.fastTrackCount = fastTrack.length;
                stats.apiTrackCount = apiTrack.length;
                log(`⚡ Fast Track ${fastTrack.length}건, API Track ${apiTrack.length}건`);

                // Phase 1: Fast Track (캐시 적중)
                log(`⚡ Phase 1 시작: 캐시 적중 고속 처리`);
                for (let i = 0; i < fastTrack.length; i += FAST_TRACK_CHUNK_SIZE) {
                    const chunk = fastTrack.slice(i, i + FAST_TRACK_CHUNK_SIZE);
                    const items = chunk
                        .map((row) => {
                            const cached = addressCache.get(getCacheKey(row.latitude, row.longitude));
                            if (!cached) return null;
                            return {
                                assetId: row.assetId,
                                country: cached.country || '대한민국',
                                state: cached.state,
                                city: cached.city,
                            };
                        })
                        .filter(Boolean);

                    if (items.length) {
                        const updated = await bulkUpdate(client, items);
                        stats.fastTrackUpdated += updated;
                        stats.totalUpdated += updated;
                    }

                    const done = Math.min(i + FAST_TRACK_CHUNK_SIZE, fastTrack.length);
                    if (done % FAST_TRACK_LOG_INTERVAL === 0 || done === fastTrack.length) {
                        log(`⚡ Fast Track: ${done}/${fastTrack.length}건 (반영: ${stats.fastTrackUpdated})`);
                    }
                }
                log(`✅ Phase 1 완료: ${stats.fastTrackUpdated}건`);

                // Phase 2: API Track (미캐시)
                log(`🌐 Phase 2 시작: API 미확인 주소 처리`);
                const groups = new Map();
                for (const row of apiTrack) {
                    const key = getCacheKey(row.latitude, row.longitude);
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(row);
                }
                log(`🗂️ ${groups.size}개 좌표 그룹`);

                let groupsDone = 0;
                let photosDone = 0;

                for (const [key, rows] of groups.entries()) {
                    groupsDone++;
                    photosDone += rows.length;
                    const first = rows[0];
                    let address = null;

                    if (groupsDone <= 3) {
                        log(
                            `🔎 샘플 ${groupsDone}/${groups.size}: lat=${first.latitude} lon=${first.longitude} (${rows.length}장)`,
                        );
                    }

                    try {
                        if (addressCache.has(key)) {
                            address = { ...addressCache.get(key), source: 'memory' };
                            stats.memoryHitCount += rows.length;
                        } else {
                            const apiResult = await fetchAddress(first.latitude, first.longitude);
                            if (apiResult) {
                                address = { ...apiResult, source: 'api' };
                                stats.apiCallCount++;
                                setMemoryCache(key, apiResult);
                                await upsertCache(client, key, apiResult).catch(() => {});
                            }
                        }

                        // Fallback: mapping.json 번역 (한국 자산 전용)
                        if (!address && isKorean(first.latitude, first.longitude)) {
                            const korState = translateLocation(first.state);
                            const korCity = translateLocation(first.city);
                            if (korState || korCity) {
                                address = {
                                    country: '대한민국',
                                    state: korState || first.state,
                                    city: korCity || first.city,
                                    source: 'fallback',
                                };
                                stats.fallbackHitCount += rows.length;
                            }
                        }

                        if (address) {
                            const updated = await bulkUpdateByIds(
                                client,
                                rows.map((r) => r.assetId),
                                address,
                            );
                            stats.apiTrackUpdated += updated;
                            stats.totalUpdated += updated;
                        }
                    } catch {
                        // 개별 그룹 에러 무시
                    }

                    if (groupsDone % API_TRACK_LOG_INTERVAL === 0 || groupsDone === groups.size) {
                        log(
                            `🌐 API Track: ${groupsDone}/${groups.size}그룹, ${photosDone}/${apiTrack.length}장 ` +
                                `(API: ${stats.apiCallCount} | 메모리 재사용: ${stats.memoryHitCount} | Fallback: ${stats.fallbackHitCount} | 반영: ${stats.apiTrackUpdated})`,
                        );
                    }

                    if (address?.source === 'api') await sleep(config.delay);
                }
                log(`✅ Phase 2 완료: ${stats.apiTrackUpdated}건`);
            }
        }

        // ── 세계 자산 처리 (Google API) ───────────────────────────
        if (config.geocodingWorld === 'google' && (target === 'all' || target === 'world')) {
            log(`🌍 세계 주소 처리 시작 (Google API)...`);

            const { clause: wFilterClause, params: wFilterParams } = buildFilterClause(1);
            const wNeedsJoin = wFilterClause !== '';

            let worldQuery = `
                SELECT ae."assetId", ae.latitude, ae.longitude, ae.country, ae.city, ae.state
                FROM public."asset_exif" ae
                ${wNeedsJoin ? 'INNER JOIN public.asset a ON a.id = ae."assetId"' : ''}
                WHERE ae.latitude IS NOT NULL AND ae.longitude IS NOT NULL
                  AND NOT (ae.latitude BETWEEN 33 AND 43 AND ae.longitude BETWEEN 124 AND 132)
                  ${wNeedsJoin ? 'AND a."deletedAt" IS NULL' : ''}
            `;
            if (!forceUpdate) {
                worldQuery += ` AND (ae.city IS NULL OR ae.city !~ '[가-힣]')`;
            }
            worldQuery += ` ${wFilterClause}`;

            const worldRes = await client.query(worldQuery, wFilterParams);
            stats.worldTotal = worldRes.rows.length;
            log(`🌍 세계 대상: ${worldRes.rows.length}건`);

            if (worldRes.rows.length > 0) {
                const worldGroups = new Map();
                for (const row of worldRes.rows) {
                    const key = getCacheKey(row.latitude, row.longitude);
                    if (!worldGroups.has(key)) worldGroups.set(key, []);
                    worldGroups.get(key).push(row);
                }

                let wDone = 0;
                for (const [key, rows] of worldGroups.entries()) {
                    wDone++;
                    const first = rows[0];
                    let address = null;

                    try {
                        if (addressCache.has(key)) {
                            address = addressCache.get(key);
                        } else {
                            address = await fetchAddress(first.latitude, first.longitude);
                            if (address) {
                                setMemoryCache(key, address);
                                await upsertCache(client, key, address).catch(() => {});
                                stats.apiCallCount++;
                            }
                        }

                        if (address) {
                            const updated = await bulkUpdateByIds(
                                client,
                                rows.map((r) => r.assetId),
                                address,
                            );
                            stats.worldUpdated += updated;
                            stats.totalUpdated += updated;
                        }
                    } catch {
                        // 개별 그룹 에러 무시
                    }

                    if (address) await sleep(config.delay);

                    if (wDone % API_TRACK_LOG_INTERVAL === 0 || wDone === worldGroups.size) {
                        log(`🌍 세계: ${wDone}/${worldGroups.size}그룹 (반영: ${stats.worldUpdated})`);
                    }
                }
            }

            log(`✅ 세계 처리 완료: ${stats.worldUpdated}건`);
        }

        stats.endTime = Date.now();
        const duration = Math.round((stats.endTime - stats.startTime) / 1000);

        log(`🎉 작업 완료 (${duration}초)`);
        log(` ├─ 캐시 워밍업: ${stats.warmedCount}건`);
        log(` ├─ 한국 대상: ${stats.koreanTotal}건 (Fast: ${stats.fastTrackCount}, API: ${stats.apiTrackCount})`);
        log(` ├─ 세계 대상: ${stats.worldTotal}건`);
        log(` ├─ Fast Track 반영: ${stats.fastTrackUpdated}건`);
        log(` ├─ API Track 반영: ${stats.apiTrackUpdated}건`);
        log(` ├─ 세계 반영: ${stats.worldUpdated}건`);
        log(` ├─ 실제 API 호출: ${stats.apiCallCount}번`);
        log(` ├─ 메모리 재사용: ${stats.memoryHitCount}번`);
        log(` ├─ Fallback 번역: ${stats.fallbackHitCount}번`);
        log(` └─ 총 반영: ${stats.totalUpdated}건`);

        return stats;
    } catch (err) {
        stats.endTime = Date.now();
        log(`❌ DB 오류: ${err.message}`);
        throw err;
    } finally {
        try {
            await client.end();
        } catch {}
    }
}

module.exports = { runWorker };
