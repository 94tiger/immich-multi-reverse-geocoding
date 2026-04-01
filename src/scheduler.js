'use strict';
const cron = require('node-cron');
const config = require('./config');
const state = require('./state');

let task = null;

function log(msg) {
    const text = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${msg}`;
    console.log(text);
    state.addLog(msg);
}

async function triggerRun(mode = 'new', target = 'all') {
    if (state.isRunning) {
        return { started: false, reason: '이미 실행 중입니다' };
    }

    const { runWorker } = require('./worker');
    state.isRunning = true;
    state.currentRunMode = mode;
    state.currentRunTarget = target;
    state.currentRunStart = Date.now();

    const modeLabel = { new: '미입력만', untranslated: '미번역 포함', all: '전체 재처리' }[mode] || mode;
    const targetLabel = { all: '전체', korea: '한국', world: '세계' }[target] || target;
    log(`🚀 실행 시작 (${targetLabel} / ${modeLabel})`);

    try {
        const stats = await runWorker(mode, log, target);
        state.lastStats = stats;
        state.lastRun = Date.now();
        return { started: true };
    } catch (err) {
        log(`❌ 실행 오류: ${err.message}`);
        return { started: true, error: err.message };
    } finally {
        state.isRunning = false;
        state.currentRunMode = 'new';
        state.currentRunTarget = 'all';
        state.currentRunStart = null;
    }
}

function reschedule(cronExpression) {
    if (!cron.validate(cronExpression)) {
        throw new Error(`유효하지 않은 Cron 표현식: ${cronExpression}`);
    }
    if (task) {
        task.stop();
    }
    task = cron.schedule(cronExpression, () => {
        triggerRun('new', 'all').catch((err) => log(`❌ 스케줄 실행 오류: ${err.message}`));
    });
    state.cronSchedule = cronExpression;
    config.saveRuntime({ cronSchedule: cronExpression });
}

function startScheduler() {
    state.cronSchedule = config.cronSchedule;

    if (cron.validate(config.cronSchedule)) {
        task = cron.schedule(config.cronSchedule, () => {
            triggerRun('new', 'all').catch((err) => log(`❌ 스케줄 실행 오류: ${err.message}`));
        });
        log(`📅 스케줄 등록: ${config.cronSchedule}`);
    } else {
        log(`⚠️ 유효하지 않은 CRON_SCHEDULE: "${config.cronSchedule}", 스케줄 비활성화`);
    }

    if (config.runOnStartup) {
        setTimeout(() => {
            triggerRun('new', 'all').catch((err) => log(`❌ 초기 실행 오류: ${err.message}`));
        }, 1500);
    }
}

module.exports = { startScheduler, triggerRun, reschedule };
