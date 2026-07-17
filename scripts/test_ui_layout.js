// Layout persistence helpers — mirrors renderer logic for CI-style checks.
// Run: node scripts/test_ui_layout.js

const assert = require('assert');

const PANEL_IDS = ['panel-wrap', 'meeting-side', 'transcript-pane'];

function clamp(left, top, w, h, vpW, vpH) {
  left = Math.min(Math.max(8, left), vpW - w - 8);
  top = Math.min(Math.max(8, top), vpH - h - 8);
  return { left, top };
}

function applySavedLayout(saved, vpW = 1440, vpH = 900) {
  const out = {};
  PANEL_IDS.forEach((id) => {
    const pos = saved[id];
    if (!pos) return;
    const w = Math.max(240, pos.width || 320);
    const h = Math.max(180, pos.height || 280);
    const c = clamp(pos.left, pos.top, w, h, vpW, vpH);
    out[id] = { ...c, width: w, height: h };
  });
  return out;
}

// defaults: main centered, notes upper-right, transcript below notes
const defaults = {
  'panel-wrap': { left: 408, top: 68, width: 624, height: 400 },
  'meeting-side': { left: 1100, top: 68, width: 320, height: 380 },
  'transcript-pane': { left: 1100, top: 464, width: 320, height: 280 }
};

const applied = applySavedLayout(defaults);
assert.strictEqual(applied['meeting-side'].top, 68);
assert.strictEqual(applied['transcript-pane'].top, 464);
assert(applied['transcript-pane'].top > applied['meeting-side'].top + applied['meeting-side'].height - 50);

const clamped = clamp(-100, -50, 320, 280, 1440, 900);
assert.strictEqual(clamped.left, 8);
assert.strictEqual(clamped.top, 8);

console.log('test_ui_layout.js: all checks passed');
