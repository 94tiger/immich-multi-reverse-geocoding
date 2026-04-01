'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { startServer } = require('./server');
const { startScheduler } = require('./scheduler');

startServer();
startScheduler();
