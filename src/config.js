'use strict';
const fs = require('fs');
const path = require('path');

const RUNTIME_CONFIG_PATH = process.env.RUNTIME_CONFIG_PATH || '/data/runtime-config.json';

let runtimeOverride = {};
try {
    if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
        runtimeOverride = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
    }
} catch (e) {}

const env = (key, def = '') => (process.env[key] || def).trim();

const config = {
    // 웹 UI
    webPort: parseInt(env('WEB_PORT', '3000'), 10),
    webPassword: env('WEB_PASSWORD'),
    runOnStartup: env('RUN_ON_STARTUP', 'true') !== 'false',

    // 스케줄링 (런타임 설정 우선)
    cronSchedule: runtimeOverride.cronSchedule || env('CRON_SCHEDULE', '0 2 * * *'),
    geocodingKorea: runtimeOverride.geocodingKorea || env('GEOCODING_KOREA', 'naver'),
    geocodingWorld: runtimeOverride.geocodingWorld || env('GEOCODING_WORLD', 'disabled'),

    // Naver API
    naverId: env('NAVER_CLIENT_ID'),
    naverSecret: env('NAVER_CLIENT_SECRET'),
    naverTimeoutMs: parseInt(env('NAVER_API_TIMEOUT_MS', '10000'), 10),

    // Google Maps API
    googleApiKey: env('GOOGLE_API_KEY'),
    googleTimeoutMs: parseInt(env('GOOGLE_API_TIMEOUT_MS', '10000'), 10),

    // Immich PostgreSQL
    db: {
        user: env('DB_USERNAME', 'postgres'),
        password: env('DB_PASSWORD'),
        host: env('DB_HOSTNAME', 'immich_postgres'),
        database: env('DB_DATABASE_NAME', 'immich'),
        port: 5432,
    },

    // 기타
    delay: parseInt(env('STEP_DELAY_MS', '100'), 10),
    cacheTtlDays: parseInt(env('CACHE_TTL_DAYS', '180'), 10),
};

config.saveRuntime = function (overrides) {
    Object.assign(runtimeOverride, overrides);
    for (const [key, value] of Object.entries(overrides)) {
        if (key in config) config[key] = value;
    }
    try {
        fs.mkdirSync(path.dirname(RUNTIME_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(runtimeOverride, null, 2));
    } catch (e) {
        console.error('런타임 설정 저장 실패:', e.message);
    }
};

module.exports = config;
