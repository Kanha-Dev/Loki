const path = require('path');
const fs = require('fs');

// Run this from repo root: CUE_USERDATA=./tmp node scripts/test_store.js

console.log('CWD', process.cwd());
const tmp = path.resolve(process.env.CUE_USERDATA || './tmp');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
process.env.CUE_USERDATA = tmp;

const store = require('../src/store');
console.log('Store FILE:', require('path').join(process.env.CUE_USERDATA, 'cue-data.json'));

console.log('Initial settings:', store.getSettings());
store.appendHistory({ id: new Date().toISOString(), mode: 'test', prompt: 'hello', response: 'world' });
console.log('History after append:', store.getHistory().slice(0,3));
store.clearHistory();
console.log('History after clear:', store.getHistory());
