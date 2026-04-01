'use strict';

const MAX_LOGS = 1000;

const state = {
    isRunning: false,
    currentRunMode: 'new',
    currentRunTarget: 'all',
    currentRunStart: null,
    lastRun: null,
    lastStats: null,
    cronSchedule: null,
    logs: [],

    addLog(text) {
        this.logs.push({ time: Date.now(), text });
        if (this.logs.length > MAX_LOGS) {
            this.logs.shift();
        }
    },

    getLogs(since = 0) {
        return this.logs.filter((l) => l.time > since);
    },
};

module.exports = state;
