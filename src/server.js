'use strict';
const express = require('express');
const path = require('path');
const config = require('./config');
const state = require('./state');

function startServer() {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // 선택적 Bearer 토큰 인증
    if (config.webPassword) {
        app.use('/api', (req, res, next) => {
            const auth = req.headers.authorization || '';
            const [type, token] = auth.split(' ');
            if ((type === 'Bearer' && token === config.webPassword) || req.query.token === config.webPassword) {
                return next();
            }
            return res.status(401).json({ error: '인증 필요' });
        });
    }

    // 현재 상태
    app.get('/api/status', (req, res) => {
        res.json({
            isRunning: state.isRunning,
            currentRunMode: state.currentRunMode,
            currentRunTarget: state.currentRunTarget,
            currentRunStart: state.currentRunStart,
            lastRun: state.lastRun,
            lastStats: state.lastStats,
            cronSchedule: state.cronSchedule,
            providers: {
                korea: config.geocodingKorea,
                world: config.geocodingWorld,
                includeBuildingName: config.includeBuildingName,
                googleLanguage: config.googleLanguage,
                hasNaverKey: !!config.naverId,
                hasKakaoKey: !!config.kakaoApiKey,
                hasGoogleKey: !!config.googleApiKey,
                hasHereKey: !!config.hereApiKey,
                hasPhotonUrl: !!config.photonUrl,
            },
        });
    });

    // 수동 실행 트리거
    app.post('/api/run', async (req, res) => {
        const { triggerRun } = require('./scheduler');
        const mode = ['new', 'untranslated', 'all'].includes(req.body.mode) ? req.body.mode : 'new';
        const target = ['all', 'korea', 'world'].includes(req.body.target) ? req.body.target : 'all';
        const modeLabel = { new: '미입력만', untranslated: '미번역 포함', all: '전체 재처리' }[mode];
        const targetLabel = { all: '전체', korea: '한국', world: '세계' }[target];
        state.addLog(`[웹 UI] 수동 실행 요청 — ${targetLabel} / ${modeLabel}`);
        const result = await triggerRun(mode, target);
        res.json(result);
    });

    // 로그 조회 (since: 타임스탬프 ms)
    app.get('/api/logs', (req, res) => {
        const since = parseInt(req.query.since || '0', 10);
        res.json({ logs: state.getLogs(since) });
    });

    // 설정 조회
    app.get('/api/config', (req, res) => {
        res.json({
            cronSchedule: config.cronSchedule,
            geocodingKorea: config.geocodingKorea,
            geocodingWorld: config.geocodingWorld,
            includeBuildingName: config.includeBuildingName,
            googleLanguage: config.googleLanguage,
            hasNaverKey: !!config.naverId,
            hasGoogleKey: !!config.googleApiKey,
        });
    });

    // Immich 사용자 목록 조회 (필터 UI용)
    app.get('/api/immich/users', async (req, res) => {
        const { createClient } = require('./db');
        const client = createClient();
        try {
            await client.connect();
            const result = await client.query(
                `SELECT id, email, name FROM public."user"
                 WHERE "deletedAt" IS NULL
                 ORDER BY name`,
            );
            res.json({ users: result.rows });
        } catch (e) {
            console.error('[사용자 목록 오류]', e.message);
            res.status(500).json({ error: e.message });
        } finally {
            try { await client.end(); } catch {}
        }
    });

    // 캐시 삭제 (target: korea | world | all)
    app.post('/api/cache/clear', async (req, res) => {
        const { createClient } = require('./db');
        const target = req.body.target;
        if (!['korea', 'world', 'all'].includes(target)) {
            return res.status(400).json({ error: '유효하지 않은 target' });
        }

        const client = createClient();
        try {
            await client.connect();
            let sql;
            if (target === 'korea') {
                // 한국 좌표 범위: 위도 33-43, 경도 124-132
                sql = `DELETE FROM geocoding.geocode_cache
                       WHERE CAST(split_part(cache_key, '_', 1) AS NUMERIC) BETWEEN 33 AND 43
                         AND CAST(split_part(cache_key, '_', 2) AS NUMERIC) BETWEEN 124 AND 132`;
            } else if (target === 'world') {
                sql = `DELETE FROM geocoding.geocode_cache
                       WHERE NOT (CAST(split_part(cache_key, '_', 1) AS NUMERIC) BETWEEN 33 AND 43
                              AND CAST(split_part(cache_key, '_', 2) AS NUMERIC) BETWEEN 124 AND 132)`;
            } else {
                sql = `DELETE FROM geocoding.geocode_cache`;
            }
            const result = await client.query(sql);
            const targetLabel = { korea: '한국', world: '세계', all: '전체' }[target];
            state.addLog(`[웹 UI] ${targetLabel} 캐시 초기화 — ${result.rowCount}건 삭제`);
            res.json({ deleted: result.rowCount });
        } catch (e) {
            console.error('[캐시 삭제 오류]', e.message);
            res.status(500).json({ error: e.message });
        } finally {
            try { await client.end(); } catch {}
        }
    });

    // 필터 설정 조회/저장
    app.get('/api/filter', (req, res) => {
        res.json({
            filterUserIds:      config.filterUserIds,
            filterPathPrefixes: config.filterPathPrefixes,
        });
    });

    app.post('/api/filter', (req, res) => {
        const { filterUserIds, filterPathPrefixes } = req.body;
        const toSave = {};

        if (Array.isArray(filterUserIds)) {
            config.filterUserIds = filterUserIds;
            toSave.filterUserIds = filterUserIds;
        }
        if (Array.isArray(filterPathPrefixes)) {
            config.filterPathPrefixes = filterPathPrefixes;
            toSave.filterPathPrefixes = filterPathPrefixes;
        }

        config.saveRuntime(toSave);
        const parts = [];
        if (toSave.filterUserIds !== undefined) parts.push(`사용자 필터 ${toSave.filterUserIds.length}명`);
        if (toSave.filterPathPrefixes !== undefined) parts.push(`경로 필터 ${toSave.filterPathPrefixes.length}개`);
        state.addLog(`[웹 UI] 필터 저장 — ${parts.join(', ') || '전체 대상'}`);
        res.json({ success: true });
    });

    // 연결 상태 헬스체크 (시작 시 1회만 실행, 이후 캐시 반환)
    // 테스트 좌표: 서울시청 (37.5665, 126.9780)
    const TEST_LAT = 37.5665;
    const TEST_LON = 126.9780;
    let healthCache = null;

    async function runHealthCheck() {
        const { fetchNaver, fetchKakao, fetchGoogle, fetchHere, fetchPhoton } = require('./geocoder');
        const { createClient } = require('./db');

        const result = {
            db:     { ok: false, detail: '' },
            naver:  { ok: null,  detail: '키 미설정' },
            kakao:  { ok: null,  detail: '키 미설정' },
            google: { ok: null,  detail: '키 미설정' },
            here:   { ok: null,  detail: '키 미설정' },
            photon: { ok: null,  detail: 'URL 미설정' },
            checkedAt: Date.now(),
        };

        const client = createClient();
        try {
            await client.connect();
            await client.query('SELECT 1');
            result.db = { ok: true, detail: '연결됨' };
        } catch (e) {
            result.db = { ok: false, detail: e.message };
        } finally {
            try { await client.end(); } catch {}
        }

        if (config.naverId && config.naverSecret) {
            try {
                const addr = await fetchNaver(TEST_LAT, TEST_LON);
                result.naver = addr?.state
                    ? { ok: true,  detail: addr.state }
                    : { ok: false, detail: '응답 없음 (키 오류)' };
            } catch (e) {
                result.naver = { ok: false, detail: e.message };
            }
        }

        if (config.kakaoApiKey) {
            try {
                const addr = await fetchKakao(TEST_LAT, TEST_LON);
                result.kakao = addr?.state
                    ? { ok: true,  detail: addr.state }
                    : { ok: false, detail: '응답 없음 (키 오류)' };
            } catch (e) {
                result.kakao = { ok: false, detail: e.message };
            }
        }

        if (config.googleApiKey) {
            try {
                const addr = await fetchGoogle(TEST_LAT, TEST_LON);
                result.google = addr?.state
                    ? { ok: true,  detail: addr.state }
                    : { ok: false, detail: '응답 없음 (키 오류)' };
            } catch (e) {
                result.google = { ok: false, detail: e.message };
            }
        }

        if (config.hereApiKey) {
            try {
                const addr = await fetchHere(TEST_LAT, TEST_LON);
                result.here = addr?.state
                    ? { ok: true,  detail: addr.state }
                    : { ok: false, detail: '응답 없음 (키 오류)' };
            } catch (e) {
                result.here = { ok: false, detail: e.message };
            }
        }

        if (config.photonUrl) {
            try {
                const addr = await fetchPhoton(TEST_LAT, TEST_LON);
                const detail = addr?.state || addr?.city;
                result.photon = detail
                    ? { ok: true,  detail }
                    : { ok: false, detail: '응답 없음' };
            } catch (e) {
                result.photon = { ok: false, detail: e.message };
            }
        }

        healthCache = result;
    }

    app.get('/api/health', (req, res) => {
        if (!healthCache) return res.json({ checking: true });
        res.json(healthCache);
    });

    // API 테스트 (위도/경도 입력 → 주소 반환)
    app.get('/api/test-geocode', async (req, res) => {
        const { fetchNaver, fetchKakao, fetchGoogle, fetchHere, fetchPhoton } = require('./geocoder');
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        const provider = req.query.provider;

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: '유효하지 않은 좌표' });
        }

        try {
            let result = null;
            if (provider === 'naver') result = await fetchNaver(lat, lon);
            else if (provider === 'kakao') result = await fetchKakao(lat, lon);
            else if (provider === 'google') result = await fetchGoogle(lat, lon);
            else if (provider === 'here') result = await fetchHere(lat, lon);
            else if (provider === 'photon') result = await fetchPhoton(lat, lon);
            else return res.status(400).json({ error: '유효하지 않은 제공자' });

            res.json({ result });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 설정 변경 (cron, 제공자, 건물명)
    app.post('/api/config', (req, res) => {
        const { cronSchedule, geocodingKorea, geocodingWorld, includeBuildingName, googleLanguage } = req.body;
        const { reschedule } = require('./scheduler');

        try {
            const toSave = {};

            if (cronSchedule !== undefined) {
                reschedule(cronSchedule);
                toSave.cronSchedule = cronSchedule;
            }

            if (geocodingKorea !== undefined) {
                const valid = ['naver', 'kakao', 'google', 'here', 'photon', 'disabled'];
                if (!valid.includes(geocodingKorea)) {
                    return res.status(400).json({ error: '유효하지 않은 한국 제공자 값' });
                }
                config.geocodingKorea = geocodingKorea;
                toSave.geocodingKorea = geocodingKorea;
            }

            if (geocodingWorld !== undefined) {
                const valid = ['google', 'here', 'photon', 'disabled'];
                if (!valid.includes(geocodingWorld)) {
                    return res.status(400).json({ error: '유효하지 않은 세계 제공자 값' });
                }
                config.geocodingWorld = geocodingWorld;
                toSave.geocodingWorld = geocodingWorld;
            }

            if (includeBuildingName !== undefined) {
                config.includeBuildingName = !!includeBuildingName;
                toSave.includeBuildingName = !!includeBuildingName;
            }

            if (googleLanguage !== undefined) {
                const validLangs = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es'];
                if (!validLangs.includes(googleLanguage)) {
                    return res.status(400).json({ error: '유효하지 않은 언어 코드' });
                }
                config.googleLanguage = googleLanguage;
                toSave.googleLanguage = googleLanguage;
            }

            if (Object.keys(toSave).length > 0) {
                config.saveRuntime(toSave);
                const parts = [];
                if (toSave.cronSchedule !== undefined) parts.push(`스케줄: ${toSave.cronSchedule}`);
                if (toSave.geocodingKorea !== undefined) parts.push(`한국: ${toSave.geocodingKorea}`);
                if (toSave.geocodingWorld !== undefined) parts.push(`세계: ${toSave.geocodingWorld}`);
                if (toSave.includeBuildingName !== undefined) parts.push(`건물명: ${toSave.includeBuildingName ? 'ON' : 'OFF'}`);
                if (toSave.googleLanguage !== undefined) parts.push(`언어: ${toSave.googleLanguage}`);
                state.addLog(`[웹 UI] 설정 저장 — ${parts.join(', ')}`);
            }

            res.json({ success: true });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    const port = config.webPort;
    app.listen(port, () => {
        console.log(`🌐 웹 UI: http://localhost:${port}`);
        // 시작 시 1회만 헬스체크 실행
        runHealthCheck().catch((e) => console.error('헬스체크 오류:', e.message));
    });
}

module.exports = { startServer };
