const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cue', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  historyGet: () => ipcRenderer.invoke('history:get'),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  generateMeetingNote: (previous) => ipcRenderer.invoke('meeting-note:generate', previous),
  ask: (payload) => ipcRenderer.send('ask', payload),
  captureScreenshot: () => ipcRenderer.invoke('capture:screenshot'),
  captureToggle: () => ipcRenderer.invoke('capture:toggle'),
  captureSet: (active) => ipcRenderer.invoke('capture:set', active),
  captureState: () => ipcRenderer.invoke('capture:state'),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  log: (msg) => ipcRenderer.send('log', msg),
  modelsDetect: (provider) => ipcRenderer.invoke('models:detect', provider),
  modelsUseRecommended: (provider) => ipcRenderer.invoke('models:use-recommended', provider),
  usageGet: () => ipcRenderer.invoke('usage:get'),
  usageReset: () => ipcRenderer.invoke('usage:reset'),
  usageSetLimit: (limit) => ipcRenderer.invoke('usage:set-limit', limit),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'history:updated', 'history:cleared', 'leetcode:collect', 'leetcode:send', 'models:detected', 'settings:updated', 'usage:updated', 'ratelimit:updated'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
