// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
let appPath = null;
try { appPath = require('electron').app.getPath('userData'); } catch (e) { appPath = null; }
// Allow tests to override the user data path via env var SIXEYES_USERDATA
const FILE = path.join(process.env.SIXEYES_USERDATA || appPath || path.join(__dirname, '..', 'data'), '6Eyes-data.json');

const DEFAULTS = {
  provider: 'openai',
  smart: false,
  chatPersistent: true,
  meetingNotes: { enabled: false, intervalSeconds: 60 },
  apiKeys: { openai: '', anthropic: '', gemini: '', deepgram: '' },
  history: [],
  shortcuts: {
    leetcodeCollect: 'CommandOrControl+Shift+H',
    leetcodeSend: 'CommandOrControl+H',
    assist: 'CommandOrControl+Return'
  },
  models: {
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: 'claude-3-5-haiku-latest', smart: 'claude-3-5-sonnet-latest' },
    gemini: { fast: 'gemini-3.1-flash-lite', smart: 'gemini-2.5-pro' }
  },
  usage: {
    totalTokens: 0,
    totalCost: 0,
    byProvider: {
      openai: { tokens: 0, cost: 0 },
      anthropic: { tokens: 0, cost: 0 },
      gemini: { tokens: 0, cost: 0 }
    },
    byModel: {},
    monthlyLimit: 10.00, // $10 default monthly limit
    resetDate: new Date().toISOString()
  }
};

let data = null;

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

function load() {
  if (data) return data;
  try { data = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { data = deepMerge(DEFAULTS, {}); }
  return data;
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch (e) { /* ignore */ } }

module.exports = {
  getSettings() { return load(); },
  setSettings(patch) { load(); data = deepMerge(data, patch || {}); save(); return data; }
};

// History helpers
module.exports.getHistory = function () { const d = load(); return (d.history || []).slice().reverse(); };
module.exports.appendHistory = function (entry) {
  load(); if (!data.history) data.history = [];
  // keep newest at the end; cap size to avoid unbounded growth
  const MAX = 500;
  data.history.push(entry || {});
  if (data.history.length > MAX) data.history = data.history.slice(data.history.length - MAX);
  save();
  return entry;
};
module.exports.clearHistory = function () { load(); data.history = []; save(); return data.history; };

// Usage tracking helpers
module.exports.getUsage = function () { 
  const d = load();
  checkMonthlyReset(d);
  return d.usage || DEFAULTS.usage;
};

module.exports.recordUsage = function (provider, model, inputTokens, outputTokens, cost) {
  load();
  if (!data.usage) data.usage = { ...DEFAULTS.usage };
  checkMonthlyReset(data);
  
  // Update totals
  data.usage.totalTokens += (inputTokens + outputTokens);
  data.usage.totalCost += cost;
  
  // Update by provider
  if (!data.usage.byProvider[provider]) {
    data.usage.byProvider[provider] = { tokens: 0, cost: 0 };
  }
  data.usage.byProvider[provider].tokens += (inputTokens + outputTokens);
  data.usage.byProvider[provider].cost += cost;
  
  // Update by model
  if (!data.usage.byModel[model]) {
    data.usage.byModel[model] = { tokens: 0, cost: 0 };
  }
  data.usage.byModel[model].tokens += (inputTokens + outputTokens);
  data.usage.byModel[model].cost += cost;
  
  save();
  return data.usage;
};

module.exports.resetUsage = function () {
  load();
  data.usage = { ...DEFAULTS.usage, resetDate: new Date().toISOString() };
  save();
  return data.usage;
};

module.exports.setMonthlyLimit = function (limit) {
  load();
  if (!data.usage) data.usage = { ...DEFAULTS.usage };
  data.usage.monthlyLimit = limit;
  save();
  return data.usage;
};

function checkMonthlyReset(d) {
  if (!d.usage || !d.usage.resetDate) return;
  
  const resetDate = new Date(d.usage.resetDate);
  const now = new Date();
  
  // Reset if we're in a new month
  if (resetDate.getMonth() !== now.getMonth() || resetDate.getFullYear() !== now.getFullYear()) {
    d.usage.totalTokens = 0;
    d.usage.totalCost = 0;
    d.usage.byProvider = {
      openai: { tokens: 0, cost: 0 },
      anthropic: { tokens: 0, cost: 0 },
      gemini: { tokens: 0, cost: 0 }
    };
    d.usage.byModel = {};
    d.usage.resetDate = now.toISOString();
  }
}
