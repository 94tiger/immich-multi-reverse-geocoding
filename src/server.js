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
            currentRunForce: state.currentRunForce,
            currentRunStart: state.currentRunStart,
            lastRun: state.lastRun,
            lastStats: state.lastStats,
            cronSchedule: state.cronSchedule,
            providers: {
                korea: config.geocodingKorea,
                world: config.geocodingWorld,
                includeBuildingName: config.includeBuildingName,
                hasNaverKey: !!config.naverId,
                hasGoogleKey: !!config.googleApiKey,
            },
        });
    });

    // 수동 실행 트리거
    app.post('/api/run', async (req, res) => {
        const { triggerRun } = require('./scheduler');
        const force = req.body.force === true;
        const result = await triggerRun(force);
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
                `SELECT id, email, name FROM users
                 WHERE "deletedAt" IS NULL
                 ORDER BY name`,
            );
            res.json({ users: result.rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        } finally {
            try { await client.end(); } catch {}
        }
    });

    // 필터 설정 조회/저장
    app.get('/api/filter', (req, res) => {
        res.json({
            filterUserIds:    config.filterUserIds,
            filterPathPrefix: config.filterPathPrefix,
        });
    });

    app.post('/api/filter', (req, res) => {
        const { filterUserIds, filterPathPrefix } = req.body;
        const toSave = {};

        if (Array.isArray(filterUserIds)) {
            config.filterUserIds = filterUserIds;
            toSave.filterUserIds = filterUserIds;
        }
        if (filterPathPrefix !== undefined) {
            config.filterPathPrefix = filterPathPrefix;
            toSave.filterPathPrefix = filterPathPrefix;
        }

        config.saveRuntime(toSave);
        res.json({ success: true });
    });

    // 연결 상태 헬스체크 (시작 시 1회만 실행, 이후 캐시 반환)
    // 테스트 좌표: 서울시청 (37.5665, 126.9780)
    const TEST_LAT = 37.5665;
    const TEST_LON = 126.9780;
    let healthCache = null;

    async function runHealthCheck() {
        const { fetchNaver, fetchGoogle } = require('./geocoder');
        const { createClient } = require('./db');

        const result = {
            db:     { ok: false, detail: '' },
            naver:  { ok: null,  detail: '키 미설정' },
            google: { ok: null,  detail: '키 미설정' },
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

        healthCache = result;
    }

    app.get('/api/health', (req, res) => {
        if (!healthCache) return res.json({ checking: true });
        res.json(healthCache);
    });

    // 설정 변경 (cron, 제공자, 건물명)
    app.post('/api/config', (req, res) => {
        const { cronSchedule, geocodingKorea, geocodingWorld, includeBuildingName } = req.body;
        const { reschedule } = require('./scheduler');

        try {
            const toSave = {};

            if (cronSchedule !== undefined) {
                reschedule(cronSchedule);
                toSave.cronSchedule = cronSchedule;
            }

            if (geocodingKorea !== undefined) {
                const valid = ['naver', 'google', 'disabled'];
                if (!valid.includes(geocodingKorea)) {
                    return res.status(400).json({ error: '유효하지 않은 한국 제공자 값' });
                }
                config.geocodingKorea = geocodingKorea;
                toSave.geocodingKorea = geocodingKorea;
            }

            if (geocodingWorld !== undefined) {
                const valid = ['google', 'disabled'];
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

            if (Object.keys(toSave).length > 0) {
                config.saveRuntime(toSave);
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
