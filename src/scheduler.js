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

async function triggerRun(force = false, target = 'all') {
    if (state.isRunning) {
        return { started: false, reason: '이미 실행 중입니다' };
    }

    const { runWorker } = require('./worker');
    state.isRunning = true;
    state.currentRunForce = force;
    state.currentRunTarget = target;
    state.currentRunStart = Date.now();

    const targetLabel = { all: '전체', korea: '한국', world: '세계' }[target] || target;
    log(force ? `🚀 강제 재처리 시작 (${targetLabel})` : `🚀 실행 시작 (${targetLabel})`);

    try {
        const stats = await runWorker(force, log, target);
        state.lastStats = stats;
        state.lastRun = Date.now();
        return { started: true };
    } catch (err) {
        log(`❌ 실행 오류: ${err.message}`);
        return { started: true, error: err.message };
    } finally {
        state.isRunning = false;
        state.currentRunForce = false;
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
        triggerRun(false).catch((err) => log(`❌ 스케줄 실행 오류: ${err.message}`));
    });
    state.cronSchedule = cronExpression;
    config.saveRuntime({ cronSchedule: cronExpression });
}

function startScheduler() {
    state.cronSchedule = config.cronSchedule;

    if (cron.validate(config.cronSchedule)) {
        task = cron.schedule(config.cronSchedule, () => {
            triggerRun(false).catch((err) => log(`❌ 스케줄 실행 오류: ${err.message}`));
        });
        log(`📅 스케줄 등록: ${config.cronSchedule}`);
    } else {
        log(`⚠️ 유효하지 않은 CRON_SCHEDULE: "${config.cronSchedule}", 스케줄 비활성화`);
    }

    if (config.runOnStartup) {
        setTimeout(() => {
            triggerRun(false).catch((err) => log(`❌ 초기 실행 오류: ${err.message}`));
        }, 1500);
    }
}

module.exports = { startScheduler, triggerRun, reschedule };
