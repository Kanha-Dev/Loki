const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell } = require('electron');
const path = require('path');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { createLLM } = require('./src/llm');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { detectModelsWithCache } = require('./src/modelDetect');
const { estimateTokens, estimateRequestTokens, estimateCost, formatCost } = require('./src/tokenEstimator');

let win = null;

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const transcript = []; // { channel, text, ts }
const FLUSH_MS = 3500;
const MIN_BYTES = Math.floor(16000 * 2 * 0.6); // ~0.6s
const RMS_GATE = 240;
let flushTimer = null;

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

// -------- window --------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = workArea.width, H = workArea.height;
  win = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x,
    y: workArea.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Invisibility + overlay behavior. Set CUE_NO_PROTECT=1 to disable for debugging.
  win.setContentProtection(!process.env.CUE_NO_PROTECT);            // excluded from screen capture (best-effort)
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => win.showInactive());
  win.webContents.on('render-process-gone', (_e, d) => console.log('[cue] renderer gone', JSON.stringify(d)));
}

// -------- STT flushing --------
async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: 'No transcription key set. Add an OpenAI (Whisper) or Gemini key in Settings to enable listening. Screen/LeetCode features work without it.' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim()) {
      const turn = { channel, text: res.text.trim(), ts: Date.now() };
      transcript.push(turn);
      send('transcript', turn);
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  if (sttDisabled) return;
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found';
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', { message: 'Transcription off: your ' + err.provider + ' key has no access to a speech-to-text model (403). Screen + LeetCode still work. To enable listening: give the key Whisper/transcription access, or add a Gemini key in Settings and reopen.' });
  } else {
    send('status', { message: 'Transcription error (' + err.provider + '): ' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside cue's own process
// and use cue's own Screen-Recording grant — no separate helper binary to authorize.
function setCapturing(active) {
  state.capturing = active;
  if (active) {
    startFlushLoop();
  } else {
    stopFlushLoop();
    buffers.you = []; buffers.them = [];
  }
  send('capture:state', { active });
  return active;
}

// -------- feature runner --------
async function runFeature(mode, userText, images = null) {
  if (state.busy) return;
  const def = MODES[mode];
  if (!def) return;
  state.busy = true;
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings);
    const userBubble = def.userBubble !== null ? def.userBubble : (mode === 'ask' ? userText : null);
    send('llm:start', { userBubble, small: !!def.small });

    if (!llm.ready) {
      send('llm:error', { message: 'Add your ' + settings.provider + ' API key in Settings (gear icon) to start. Model: ' + (llm.model || 'unset') + '.' });
      return;
    }

    let imageDataUrls = images;
    if (!imageDataUrls && def.needsScreen) {
      try {
        const single = await captureScreenshot();
        imageDataUrls = [single];
      }
      catch (e) { send('status', { message: 'Screen capture needs permission — grant Screen Recording to cue in System Settings.' }); }
    }

    const built = def.build({ transcript, userText: userText || '' });
    let response = '';
    const started = Date.now();
    
    // Estimate input tokens before streaming
    const tokenEstimate = estimateRequestTokens(def.system, [{ role: 'user', text: built }], imageDataUrls && imageDataUrls[0] ? imageDataUrls[0] : null);
    
    await llm.stream({
      system: def.system,
      turns: [{ role: 'user', text: built }],
      imageDataUrls,
      onToken: (t) => {
        response += t;
        send('llm:token', { text: t });
      },
      onRateLimitInfo: (rateLimitInfo) => {
        send('ratelimit:updated', rateLimitInfo);
      }
    });
    const duration_ms = Date.now() - started;
    
    // Estimate output tokens and record usage
    const outputTokens = estimateTokens(response);
    const costEstimate = estimateCost(llm.provider, llm.model, tokenEstimate.inputTokens, outputTokens, tokenEstimate.imageTokens);
    
    try {
      store.recordUsage(llm.provider, llm.model, tokenEstimate.inputTokens, outputTokens, costEstimate.totalCost);
      send('usage:updated', store.getUsage());
    } catch (e) {
      console.error('Failed to record usage:', e);
    }
    // persist history entry (prompt + response) only when chat persistence is enabled.
    try {
      if (settings.chatPersistent) {
        const entry = {
          id: new Date().toISOString(),
          mode,
          prompt: built,
          image: imageDataUrls && imageDataUrls[0] ? imageDataUrls[0] : null,
          images: imageDataUrls || null,
          response: response,
          provider: llm.provider,
          model: llm.model,
          duration_ms
        };
        try { store.appendHistory(entry); send('history:updated', entry); } catch (e) { /* ignore */ }
      }
    } catch (e) {}
    send('llm:done', {});
  } catch (e) {
    send('llm:error', { message: 'Error: ' + (e && e.message ? e.message : String(e)) });
  } finally {
    state.busy = false;
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', async (_e, patch) => { 
  sttDisabled = false; 
  const result = store.setSettings(patch);
  
  // Trigger model detection if API key changed
  if (patch.apiKeys && patch.apiKeys[patch.provider]) {
    const apiKey = patch.apiKeys[patch.provider];
    detectModelsWithCache(patch.provider, apiKey).then(detection => {
      send('models:detected', detection);
    }).catch(err => {
      console.error('Model detection failed:', err);
    });
  }
  
  return result;
});
ipcMain.handle('history:get', () => { try { return store.getHistory(); } catch (e) { return []; } });
ipcMain.handle('history:clear', () => { try { const h = store.clearHistory(); send('history:cleared', {}); return h; } catch (e) { return []; } });
ipcMain.handle('models:detect', async (_e, provider) => {
  const settings = store.getSettings();
  const apiKey = settings.apiKeys[provider];
  if (!apiKey) {
    return { success: false, error: 'No API key for provider' };
  }
  return await detectModelsWithCache(provider, apiKey);
});
ipcMain.handle('models:use-recommended', async (_e, provider) => {
  const settings = store.getSettings();
  const apiKey = settings.apiKeys[provider];
  if (!apiKey) {
    return { success: false, error: 'No API key for provider' };
  }
  
  const detection = await detectModelsWithCache(provider, apiKey);
  if (!detection.success || !detection.recommended) {
    return { success: false, error: 'No recommended model available' };
  }
  
  // Apply recommended models
  if (!settings.models[provider]) {
    settings.models[provider] = {};
  }
  settings.models[provider].fast = detection.fast;
  settings.models[provider].smart = detection.smart;
  
  store.setSettings(settings);
  send('settings:updated', settings);
  
  return { success: true, models: settings.models[provider] };
});
ipcMain.handle('usage:get', () => { try { return store.getUsage(); } catch (e) { return store.getUsage(); } });
ipcMain.handle('usage:reset', () => { try { const u = store.resetUsage(); send('usage:updated', u); return u; } catch (e) { return store.getUsage(); } });
ipcMain.handle('usage:set-limit', (_e, limit) => { try { return store.setMonthlyLimit(limit); } catch (e) { return store.getUsage(); } });
ipcMain.handle('meeting-note:generate', async (_e, previousNotes) => {
  const settings = store.getSettings();
  const llm = createLLM(settings);
  if (!llm.ready) throw new Error('Add your ' + settings.provider + ' API key in Settings to generate meeting notes.');
  const transcriptText = transcript.map((t) => (t.channel === 'them' ? 'Them: ' : 'You: ') + t.text).join('\n');
  const promptParts = [
    'You are cue, a meeting assistant that summarizes conversation into concise bullet points. Use the transcript below and the previous notes to generate updated meeting notes.',
    previousNotes ? 'Previous notes:\n' + previousNotes : '',
    'Transcript:\n' + (transcriptText || '(no transcript yet)'),
    'Output the complete updated meeting notes as numbered bullet points. Each point should be short and precise (1-2 sentences max). Update existing points minimally when necessary and add new points for new information. Format as:\n1) Point 1\n2) Point 2\n3) Point 3\n\nIf nothing new has happened, return the previous notes unchanged.'
  ].filter(Boolean);
  const prompt = promptParts.join('\n\n');
  const full = await llm.stream({ system: 'You summarize meeting transcripts into concise note updates.', turns: [{ role: 'user', text: prompt }], imageDataUrl: null, onToken: () => {} });
  return full.trim();
});
ipcMain.handle('capture:screenshot', async () => { return await captureScreenshot(); });
ipcMain.handle('capture:toggle', () => setCapturing(!state.capturing));
ipcMain.handle('capture:set', (_e, active) => setCapturing(active));
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.on('ask', (_e, payload) => runFeature(payload.mode, payload.text, payload.images));
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) buffers.you.push(Buffer.from(arrayBuffer)); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) buffers.them.push(Buffer.from(arrayBuffer)); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));

// -------- shortcuts --------
function registerShortcuts() {
  const settings = store.getSettings();
  const shortcuts = settings.shortcuts || {
    leetcodeCollect: 'CommandOrControl+Shift+H',
    leetcodeSend: 'CommandOrControl+H',
    assist: 'CommandOrControl+Return'
  };
  
  globalShortcut.register(shortcuts.assist, () => runFeature('assist', ''));
  globalShortcut.register(shortcuts.leetcodeCollect, () => send('leetcode:collect'));
  globalShortcut.register(shortcuts.leetcodeSend, () => send('leetcode:send'));
  globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
}

// -------- lifecycle --------
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // System-audio loopback for getDisplayMedia: hand back a screen source with 'loopback'
  // audio so the renderer can capture what's playing (Zoom/Meet) using cue's own grant.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length) callback({ video: sources[0], audio: 'loopback' });
      else callback();
    }).catch(() => callback());
  }, { useSystemPicker: false });

  createWindow();
  registerShortcuts();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
