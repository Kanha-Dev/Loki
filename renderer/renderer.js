/* 6Eyes renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const sixEyes = window['6Eyes']; // exposed by preload
  const $ = (s) => document.querySelector(s);

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('logo', { size: 18 });
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  $('#stop-btn').innerHTML = icon('stop-square', { size: 15 });
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', { size: 16 });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('refresh-cw', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('more-horizontal', { size: 18 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;

  const messages = $('#messages');
  const persistToggle = $('#persist-toggle');
  const debugToggle = $('#debug-toggle');
  const mainDebug = $('#main-debug');
  const meetingToggle = $('#meeting-toggle');
  const meetingStatus = $('#meeting-status');
  const meetingList = $('#meeting-list');
  const notesDebugToggle = $('#notes-debug-toggle');
  const meetingDebug = $('#meeting-debug');

  let meetingActive = false;
  let currentMeetingNotes = '';
  let currentSessionId = null;
  const transcriptSessions = [];

  function appendTerminal(el, text, type = 'info') {
    if (!el) return;
    const row = document.createElement('div');
    row.className = 'terminal-row ' + type;
    row.textContent = text;
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;
  }

  function appendMainDebug(text) {
    appendTerminal(mainDebug, text, 'info');
  }

  function appendMeetingDebug(text, type = 'info') {
    appendTerminal(meetingDebug, text, type);
  }

  function clearMessages() { messages.innerHTML = ''; aiEl = null; caretEl = null; }

  function setMeetingStatus(text, type = 'info') {
    if (meetingStatus) {
      meetingStatus.textContent = text;
      meetingStatus.classList.toggle('error', type === 'error');
    }
  }

  function setMeetingActive(active) {
    meetingActive = active;
    if (meetingToggle) {
      meetingToggle.textContent = active ? 'Stop' : 'Start';
      meetingToggle.classList.toggle('active', active);
      meetingToggle.classList.toggle('recording', active);
    }
    setMeetingStatus(active ? 'Running' : 'Stopped');
  }
  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // minimal, safe markdown: fenced code, bullets, inline code, bold, paragraphs
  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, buf = [];
    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^\s*[-*]\s+/.test(line)) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
      if (line.trim() === '') { flushP(); if (inList) { html += '</ul>'; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += '</ul>'; if (inCode) html += '</code></pre>';
    return html;
  }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
    // scroll to bottom when new user bubble added
    messages.scrollTop = messages.scrollHeight;
  }

  function startAi(small) {
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    aiEl.insertBefore(span, caretEl);
    // keep view pinned to bottom while streaming
    messages.scrollTop = messages.scrollHeight;
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
    // ensure final AI message is visible
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(v) { busy = v; $('#send-btn').classList.toggle('busy', v); }

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text) {
    if (busy) return;
    setBusy(true);
    sixEyes.ask({ mode, text: text || '' });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  // ---- UI element toggling -----------------------------------
  let uiHidden = false;
  let transcriptVisible = false;
  const hideBtn = $('#hide-btn');
  const panelWrap = $('#panel-wrap');
  const meetingSide = $('#meeting-side');
  const transcriptPane = $('#transcript-pane');

  hideBtn.addEventListener('click', () => {
    uiHidden = !uiHidden;
    panelWrap.classList.toggle('hidden', uiHidden);
    meetingSide.classList.toggle('hidden', uiHidden);
    if (transcriptVisible) transcriptPane.classList.toggle('hidden', uiHidden);
    hideBtn.querySelector('span:last-child').textContent = uiHidden ? 'Show UI' : 'Hide UI';
    hideBtn.classList.toggle('collapsed', uiHidden);
  });

  $('#toggle-panel-btn').addEventListener('click', () => {
    panelWrap.classList.toggle('hidden');
  });

  $('#toggle-meeting-btn').addEventListener('click', () => {
    meetingSide.classList.toggle('hidden');
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  input.addEventListener('input', syncPlaceholder);
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    input.value = ''; syncPlaceholder();
    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); runMode('assist', ''); }
  });

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    await sixEyes.settingsSet({ smart: settings.smart });
  });

  // Stop = start/stop listening. Kick off system-audio capture straight from the click so
  // the user-gesture is fresh for getDisplayMedia (loopback capture needs it).
  $('#stop-btn').addEventListener('click', () => {
    const turningOn = !$('#stop-btn').classList.contains('active');
    if (turningOn) startSystemAudio();
    sixEyes.captureToggle();
  });

  // ---- capture: mic (renderer side) --------------------------------------
  let audioCtx = null, micStream = null, micNode = null, micProc = null;
  async function startMic() {
    if (micStream) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      audioCtx = new AudioContext({ sampleRate: 16000 });
      micNode = audioCtx.createMediaStreamSource(micStream);
      micProc = audioCtx.createScriptProcessor(4096, 1, 1);
      const sink = audioCtx.createGain(); sink.gain.value = 0; // run processor silently
      micNode.connect(micProc); micProc.connect(sink); sink.connect(audioCtx.destination);
      micProc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        sixEyes.micPcm(out.buffer);
      };
    } catch (err) {
      sixEyes.log('mic error: ' + (err && err.message));
    }
  }
  function stopMic() {
    if (micProc) { micProc.disconnect(); micProc.onaudioprocess = null; micProc = null; }
    if (micNode) { micNode.disconnect(); micNode = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  // ---- capture: system/meeting audio (getDisplayMedia loopback, in 6Eyes's process) ----
  let sysStream = null, sysCtx = null, sysNode = null, sysProc = null;
  async function startSystemAudio() {
    if (sysStream) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop()); // we only want the audio
      const tracks = stream.getAudioTracks();
      if (!tracks.length) { sixEyes.log('system audio: no loopback track (macOS loopback unsupported here)'); stream.getTracks().forEach((t) => t.stop()); return; }
      sysStream = stream;
      sysCtx = new AudioContext({ sampleRate: 16000 });
      sysNode = sysCtx.createMediaStreamSource(new MediaStream(tracks));
      sysProc = sysCtx.createScriptProcessor(4096, 1, 1);
      const sink = sysCtx.createGain(); sink.gain.value = 0;
      sysNode.connect(sysProc); sysProc.connect(sink); sink.connect(sysCtx.destination);
      sysProc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        sixEyes.systemPcm(out.buffer);
      };
      sixEyes.log('system audio: capturing loopback');
    } catch (err) {
      sixEyes.log('system audio error: ' + (err && err.message));
    }
  }
  function stopSystemAudio() {
    if (sysProc) { sysProc.disconnect(); sysProc.onaudioprocess = null; sysProc = null; }
    if (sysNode) { sysNode.disconnect(); sysNode = null; }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
  }

  // ---- events from main --------------------------------------------------
  sixEyes.on('capture:state', ({ active }) => {
    $('#live-dot').classList.toggle('off', !active);
    $('#stop-btn').classList.toggle('active', active);
    if (active) { startMic(); startSystemAudio(); } else { stopMic(); stopSystemAudio(); }
  });
  sixEyes.on('llm:start', ({ userBubble, small }) => {
    // keep prior messages (history) visible; only add the current user bubble
    if (userBubble) addUserBubble(userBubble);
    startAi(!!small);
    setBusy(true);
  });
  sixEyes.on('llm:token', ({ text }) => appendToken(text));
  sixEyes.on('llm:done', () => { finalizeAi(); setBusy(false); });
  sixEyes.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message;
    finalizeAi();
    appendMainDebug('LLM error: ' + message);
    setBusy(false);
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('6Eyes-status');
    if (!el) {
      el = document.createElement('div');
      el.id = '6Eyes-status';
      const panel = document.getElementById('panel');
      panel.insertBefore(el, document.getElementById('action-row'));
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  sixEyes.on('status', ({ message }) => { sixEyes.log('[status] ' + message); showStatus(message); appendMainDebug('[status] ' + message); });
  sixEyes.on('transcript', (turn) => {
    // Show speech detection indicator when transcript is received
    const liveDot = $('#live-dot');
    if (liveDot) {
      liveDot.classList.add('speaking');
      setTimeout(() => liveDot.classList.remove('speaking'), 500);
    }
    
    // Add transcript to current session if meeting notes is active
    if (meetingActive && currentSessionId) {
      const session = transcriptSessions.find(s => s.id === currentSessionId);
      if (session) {
        session.transcripts.push({
          ...turn,
          timestamp: new Date().toISOString()
        });
      }
    }
  });

  // ---- settings ----------------------------------------------------------
  const settingsWrap = $('#settings-wrap');
  function openSettings() { fillSettings(); settingsWrap.classList.remove('hidden'); }
  function closeSettings() {
    stopShortcutRecording();
    saveSettings();
    settingsWrap.classList.add('hidden');
  }
  $('#toggle-settings-btn').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', closeSettings);
  
  // More menu dropdown
  const moreMenu = $('#more-menu');
  const moreBtn = $('#more-btn');
  const placeholderToggle = $('#placeholder-toggle');
  let menuOpen = false;
  let placeholderEnabled = false;

  // Load placeholder state from settings
  async function loadPlaceholderState() {
    try {
      const currentSettings = await sixEyes.settingsGet();
      placeholderEnabled = currentSettings.placeholderEnabled || false;
      placeholderToggle.classList.toggle('on', placeholderEnabled);
    } catch (e) {
      console.error('Failed to load placeholder state:', e);
    }
  }

  // Save placeholder state to settings
  async function savePlaceholderState() {
    try {
      await sixEyes.settingsSet({ placeholderEnabled });
    } catch (e) {
      console.error('Failed to save placeholder state:', e);
    }
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
    moreMenu.classList.toggle('hidden', !menuOpen);
    moreBtn.classList.toggle('active', menuOpen);
  }

  function closeMenu() {
    menuOpen = false;
    moreMenu.classList.add('hidden');
    moreBtn.classList.remove('active');
  }

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  placeholderToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    placeholderEnabled = !placeholderEnabled;
    placeholderToggle.classList.toggle('on', placeholderEnabled);
    savePlaceholderState();
    console.log('Placeholder toggle:', placeholderEnabled);
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (menuOpen && !e.target.closest('.more-menu-container')) {
      closeMenu();
    }
  });

  // Load initial state
  loadPlaceholderState();

  // ---- meeting notes / persistent chat -----------------------------------
  let meetingNoteTimer = null;

  function renderMeetingNotes() {
    if (!meetingList) return;
    if (!currentMeetingNotes) {
      meetingList.innerHTML = '<div class="muted">No meeting notes yet.</div>';
      return;
    }
    
    // Parse bullet points and display them
    const lines = currentMeetingNotes.split('\n').filter(line => line.trim());
    meetingList.innerHTML = '';
    
    lines.forEach((line, index) => {
      const bulletItem = document.createElement('div');
      bulletItem.className = 'bullet-item';
      bulletItem.textContent = line;
      meetingList.appendChild(bulletItem);
    });
  }

  function renderTranscripts() {
    const transcriptList = $('#transcript-list');
    if (!transcriptList) return;
    
    if (!transcriptSessions.length) {
      transcriptList.innerHTML = '<div class="muted">No transcript sessions yet.</div>';
      return;
    }
    
    transcriptList.innerHTML = '';
    
    transcriptSessions.forEach((session, sessionIndex) => {
      const sessionDiv = document.createElement('div');
      sessionDiv.className = 'transcript-session';
      
      const sessionHeader = document.createElement('div');
      sessionHeader.className = 'transcript-session-header';
      sessionHeader.textContent = `Session ${sessionIndex + 1} - ${new Date(session.startTime).toLocaleString()}`;
      sessionDiv.appendChild(sessionHeader);
      
      if (!session.transcripts.length) {
        const noTranscripts = document.createElement('div');
        noTranscripts.className = 'muted';
        noTranscripts.textContent = 'No transcripts in this session.';
        sessionDiv.appendChild(noTranscripts);
      } else {
        session.transcripts.forEach(transcript => {
          const transcriptItem = document.createElement('div');
          transcriptItem.className = 'transcript-item';
          
          const speaker = document.createElement('div');
          speaker.className = 'transcript-speaker';
          speaker.textContent = transcript.channel === 'them' ? 'Interviewer:' : 'You:';
          
          const text = document.createElement('div');
          text.className = 'transcript-text';
          text.textContent = transcript.text;
          
          const time = document.createElement('div');
          time.className = 'transcript-time';
          time.textContent = new Date(transcript.timestamp).toLocaleTimeString();
          
          transcriptItem.appendChild(speaker);
          transcriptItem.appendChild(text);
          transcriptItem.appendChild(time);
          sessionDiv.appendChild(transcriptItem);
        });
      }
      
      transcriptList.appendChild(sessionDiv);
    });
  }

  async function generateMeetingNote() {
    try {
      appendMeetingDebug('Requesting meeting note...');
      const note = await sixEyes.generateMeetingNote(currentMeetingNotes);
      if (!note || !note.trim()) {
        appendMeetingDebug('Meeting note returned empty response.', 'warn');
        return;
      }
      const trimmed = note.trim();
      if (currentMeetingNotes === trimmed) {
        appendMeetingDebug('Meeting note unchanged; skipping duplicate.');
        return;
      }
      currentMeetingNotes = trimmed;
      renderMeetingNotes();
      setMeetingStatus('Running');
      appendMeetingDebug('Meeting note generated successfully.');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setMeetingStatus('Error: ' + message, 'error');
      appendMeetingDebug('Meeting note error: ' + message, 'error');
    }
  }

  function stopMeetingNotesLoop() {
    if (meetingNoteTimer) { clearInterval(meetingNoteTimer); meetingNoteTimer = null; }
    setMeetingActive(false);
    appendMeetingDebug('Meeting notes stopped.');
  }
  function startMeetingNotesLoop() {
    // Clear existing timer without logging "stopped"
    if (meetingNoteTimer) { clearInterval(meetingNoteTimer); meetingNoteTimer = null; }
    
    // Create new session for transcripts
    currentSessionId = new Date().toISOString();
    transcriptSessions.push({
      id: currentSessionId,
      startTime: new Date(),
      transcripts: []
    });
    
    const interval = Math.max(15, Number(settings?.meetingNotes?.intervalSeconds) || 60) * 1000;
    setMeetingActive(true);
    // Start audio capture explicitly
    startMic();
    startSystemAudio();
    sixEyes.captureSet(true);
    generateMeetingNote();
    meetingNoteTimer = setInterval(generateMeetingNote, interval);
    appendMeetingDebug('Meeting notes started. Interval: ' + (interval / 1000) + 's');
  }

  if (meetingToggle) {
    meetingToggle.addEventListener('click', () => {
      if (meetingActive) stopMeetingNotesLoop(); else startMeetingNotesLoop();
    });
  }
  if (debugToggle) {
    debugToggle.addEventListener('click', () => {
      mainDebug.classList.toggle('hidden');
      debugToggle.classList.toggle('on', !mainDebug.classList.contains('hidden'));
    });
  }
  if (notesDebugToggle) {
    notesDebugToggle.addEventListener('click', () => {
      meetingDebug.classList.toggle('hidden');
      notesDebugToggle.classList.toggle('on', !meetingDebug.classList.contains('hidden'));
    });
  }
  
  const transcriptBtn = $('#transcript-btn');
  const closeTranscriptBtn = $('#close-transcript');
  if (transcriptBtn) {
    transcriptBtn.addEventListener('click', () => {
      transcriptVisible = true;
      transcriptPane.classList.remove('hidden');
      transcriptBtn.classList.add('on');
      renderTranscripts();
      // keep transcript below meeting notes on first open
      if (!readLayout()?.['transcript-pane']) {
        const meeting = meetingSide.getBoundingClientRect();
        transcriptPane.style.transform = 'none';
        transcriptPane.style.left = 'auto';
        transcriptPane.style.right = '20px';
        transcriptPane.style.top = (meeting.bottom + 16) + 'px';
      }
    });
  }

  if (closeTranscriptBtn) {
    closeTranscriptBtn.addEventListener('click', () => {
      transcriptVisible = false;
      transcriptPane.classList.add('hidden');
      transcriptBtn.classList.remove('on');
    });
  }

  if (persistToggle) {
    persistToggle.addEventListener('click', async () => {
      settings.chatPersistent = !settings.chatPersistent;
      persistToggle.classList.toggle('on', settings.chatPersistent);
      await sixEyes.settingsSet({ chatPersistent: settings.chatPersistent });
      if (settings.chatPersistent) {
        try {
          const h = await sixEyes.historyGet();
          if (h && h.length) renderHistoryIntoMessages(h);
          else showExample();
        } catch (e) {
          showExample();
        }
      } else {
        showExample();
      }
    });
  }

  function fillSettings() {
    document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#chat-persist').checked = !!settings.chatPersistent;
    $('#meeting-notes-enabled').checked = !!settings.meetingNotes.enabled;
    $('#meeting-notes-interval').value = settings.meetingNotes.intervalSeconds || 60;
    const s = settings.shortcuts || {};
    updateShortcutButton('shortcut-leetcode-collect', s.leetcodeCollect || 'CommandOrControl+Shift+H');
    updateShortcutButton('shortcut-leetcode-send', s.leetcodeSend || 'CommandOrControl+H');
    updateShortcutButton('shortcut-assist', s.assist || 'CommandOrControl+Return');
    $('#s-status').textContent = statusText();
  }

  function updateShortcutButton(id, shortcut) {
    const btn = document.getElementById(id);
    if (btn) {
      const keysEl = btn.querySelector('.s-shortcut-keys');
      if (keysEl) {
        keysEl.textContent = formatShortcut(shortcut);
      }
    }
  }

  function formatShortcut(shortcut) {
    return shortcut
      .replace('CommandOrControl', '⌘')
      .replace('Control', '⌃')
      .replace('Shift', '⇧')
      .replace('Alt', '⌥')
      .replace('Meta', '⌘')
      .replace('Plus', '+')
      .replace('Return', '↵')
      .replace('Enter', '↵')
      .replace(/\+/g, '');
  }

  function parseShortcut(e) {
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.key && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    return parts.join('+');
  }

  // Keyboard capture for shortcuts
  let recordingShortcut = null;
  let recordingButton = null;
  let recordedKeys = [];

  function startShortcutRecording(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    recordingShortcut = btn.dataset.shortcut;
    recordingButton = btn;
    recordedKeys = [];
    btn.classList.add('recording');
    
    const keysEl = btn.querySelector('.s-shortcut-keys');
    const hintEl = btn.querySelector('.s-shortcut-hint');
    if (keysEl) keysEl.textContent = '...';
    if (hintEl) hintEl.textContent = 'Press keys (Esc to cancel)';
  }

  function stopShortcutRecording() {
    if (recordingButton) {
      recordingButton.classList.remove('recording');
      const hintEl = recordingButton.querySelector('.s-shortcut-hint');
      if (hintEl) hintEl.textContent = 'Click to change';
    }
    recordingShortcut = null;
    recordingButton = null;
    recordedKeys = [];
  }

  function handleShortcutCapture(e) {
    if (!recordingShortcut || !recordingButton) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Ignore Escape (cancel recording)
    if (e.key === 'Escape') {
      stopShortcutRecording();
      // Restore original shortcut
      const s = settings.shortcuts || {};
      const originalShortcut = s[recordingShortcut] || getDefaultShortcut(recordingShortcut);
      updateShortcutButton(recordingButton.id, originalShortcut);
      return;
    }
    
    // Build the shortcut string from current key state
    const parts = [];
    if (e.metaKey) parts.push('CommandOrControl');
    if (e.ctrlKey) parts.push('Control');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    
    // Add the actual key if it's not a modifier
    if (e.key && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    
    const shortcut = parts.join('+');
    
    // Only accept if we have at least one modifier and one non-modifier key
    if (shortcut && 
        shortcut !== 'CommandOrControl' && 
        shortcut !== 'Control' && 
        shortcut !== 'Shift' && 
        shortcut !== 'Alt' &&
        parts.length >= 2) {
      
      // Save the shortcut
      if (!settings.shortcuts) settings.shortcuts = {};
      settings.shortcuts[recordingShortcut] = shortcut;
      
      // Update button display
      updateShortcutButton(recordingButton.id, shortcut);
      
      stopShortcutRecording();
      $('#s-status').textContent = `Shortcut set: ${formatShortcut(shortcut)} (restart required)`;
    }
  }

  function getDefaultShortcut(shortcutName) {
    const defaults = {
      leetcodeCollect: 'CommandOrControl+Shift+H',
      leetcodeSend: 'CommandOrControl+H',
      assist: 'CommandOrControl+Return'
    };
    return defaults[shortcutName] || '';
  }
  function statusText() {
    const k = settings.apiKeys;
    const has = [k.openai && 'OpenAI', k.anthropic && 'Anthropic', k.gemini && 'Gemini'].filter(Boolean);
    const stt = k.openai ? 'Whisper' : (k.gemini ? 'Gemini' : 'none');
    return 'Active: ' + settings.provider + ' · keys: ' + (has.join(', ') || 'none set') + ' · transcription: ' + stt;
  }
  document.querySelectorAll('#provider-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.provider = b.dataset.provider;
    document.querySelectorAll('#provider-seg button').forEach((x) => x.classList.toggle('on', x === b));
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#s-status').textContent = statusText();
  }));
  async function saveSettings() {
    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    if (!settings.models[settings.provider]) settings.models[settings.provider] = {};
    settings.models[settings.provider].fast = $('#model-fast').value.trim();
    settings.models[settings.provider].smart = $('#model-smart').value.trim();
    settings.chatPersistent = !!$('#chat-persist').checked;
    settings.meetingNotes.enabled = !!$('#meeting-notes-enabled').checked;
    settings.meetingNotes.intervalSeconds = Math.max(15, Number($('#meeting-notes-interval').value) || 60);
    // Shortcuts are already saved when captured, but ensure they exist
    if (!settings.shortcuts) settings.shortcuts = {};
    await sixEyes.settingsSet(settings);
    if (!settings.chatPersistent) {
      showExample();
    }
    if (settings.meetingNotes.enabled && meetingActive) {
      startMeetingNotesLoop();
    }
  }

  // Sidebar navigation
  document.querySelectorAll('.s-sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      if (!tab) return;
      
      // Update sidebar active state
      document.querySelectorAll('.s-sidebar-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      
      // Update tab content visibility
      document.querySelectorAll('.s-tab-content').forEach((content) => {
        content.classList.remove('active');
        if (content.dataset.tab === tab) {
          content.classList.add('active');
        }
      });
    });
  });

  // Shortcut button click handlers
  document.querySelectorAll('.s-shortcut-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      startShortcutRecording(btn.id);
    });
  });

  // Global keyboard event for shortcut capture
  document.addEventListener('keydown', handleShortcutCapture);

  // Model detection UI
  const detectModelsBtn = $('#detect-models-btn');
  const detectionStatus = $('#detection-status');
  const detectionResults = $('#detection-results');
  const modelsList = $('#models-list');
  
  // Store rate limit info
  let rateLimitInfo = null;

  function formatContextSize(context) {
    if (context >= 1000000) {
      return (context / 1000000).toFixed(1) + 'M';
    } else if (context >= 1000) {
      return (context / 1000).toFixed(0) + 'K';
    }
    return context.toString();
  }

  function renderModelsList(models, recommended) {
    modelsList.innerHTML = '';
    
    models.forEach(model => {
      const isRecommended = model.id === recommended;
      const card = document.createElement('div');
      card.className = `model-card ${isRecommended ? 'recommended' : ''}`;
      
      const currentFast = $('#model-fast').value;
      const currentSmart = $('#model-smart').value;
      
      // Add rate limit info if available
      let rateLimitHtml = '';
      if (rateLimitInfo && rateLimitInfo.provider === settings.provider) {
        const remaining = rateLimitInfo.tokensRemaining || rateLimitInfo.requestsRemaining;
        const limit = rateLimitInfo.tokensLimit || rateLimitInfo.requestsLimit;
        if (remaining && limit) {
          const percentage = ((remaining / limit) * 100).toFixed(0);
          rateLimitHtml = `
            <div class="model-rate-limit">
              <span class="rate-limit-label">Rate Limit:</span>
              <span class="rate-limit-value">${remaining}/${limit} (${percentage}%)</span>
            </div>
          `;
        }
      }
      
      card.innerHTML = `
        <div class="model-header">
          <span class="model-name">${model.id}</span>
          ${isRecommended ? '<span class="model-badge">Recommended</span>' : ''}
        </div>
        <div class="model-description">${model.description || 'AI model'}</div>
        <div class="model-meta">
          <div class="model-meta-item">
            <span>Context:</span>
            <span class="model-meta-value">${formatContextSize(model.context || 128000)}</span>
          </div>
          <div class="model-meta-item">
            <span>Input:</span>
            <span class="model-meta-value">$${(model.inputPrice || 0).toFixed(2)}/M</span>
          </div>
          <div class="model-meta-item">
            <span>Output:</span>
            <span class="model-meta-value">$${(model.outputPrice || 0).toFixed(2)}/M</span>
          </div>
        </div>
        ${rateLimitHtml}
        <div class="model-actions">
          <button class="model-action-btn set-fast ${currentFast === model.id ? 'active' : ''}" data-model="${model.id}" data-mode="fast">
            Set as Normal
          </button>
          <button class="model-action-btn set-smart ${currentSmart === model.id ? 'active' : ''}" data-model="${model.id}" data-mode="smart">
            Set as Smart
          </button>
        </div>
      `;
      
      modelsList.appendChild(card);
    });
    
    // Add event listeners for the buttons
    modelsList.querySelectorAll('.model-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.model;
        const mode = btn.dataset.mode;
        
        // Update the input field
        if (mode === 'fast') {
          $('#model-fast').value = modelId;
        } else {
          $('#model-smart').value = modelId;
        }
        
        // Update button states
        modelsList.querySelectorAll(`.model-action-btn[data-mode="${mode}"]`).forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');

        // Save settings
        try {
          await sixEyes.settingsSet({
            models: {
              [settings.provider]: {
                ...settings.models[settings.provider],
                [mode]: modelId
              }
            }
          });
          
          detectionStatus.textContent = `${mode === 'fast' ? 'Normal' : 'Smart'} mode set to ${modelId}`;
          detectionStatus.className = 'detection-status success';
          
          // Clear status after 2 seconds
          setTimeout(() => {
            detectionStatus.textContent = '';
            detectionStatus.className = 'detection-status';
          }, 2000);
        } catch (err) {
          detectionStatus.textContent = 'Failed to save: ' + (err && err.message ? err.message : 'Unknown error');
          detectionStatus.className = 'detection-status error';
        }
      });
    });
  }

  if (detectModelsBtn) {
    detectModelsBtn.addEventListener('click', async () => {
      if (!settings.apiKeys[settings.provider]) {
        detectionStatus.textContent = 'Please add an API key first';
        detectionStatus.className = 'detection-status error';
        return;
      }

      detectModelsBtn.disabled = true;
      detectionStatus.textContent = 'Detecting models...';
      detectionStatus.className = 'detection-status loading';
      detectionResults.classList.add('hidden');

      try {
        const result = await sixEyes.modelsDetect(settings.provider);
        
        if (result.success && result.available && result.available.length > 0) {
          detectionStatus.textContent = `Found ${result.available.length} models`;
          detectionStatus.className = 'detection-status success';
          
          renderModelsList(result.available, result.recommended);
          detectionResults.classList.remove('hidden');
        } else {
          detectionStatus.textContent = 'Detection failed: ' + (result.error || 'Unknown error');
          detectionStatus.className = 'detection-status error';
        }
      } catch (err) {
        detectionStatus.textContent = 'Detection failed: ' + (err && err.message ? err.message : 'Unknown error');
        detectionStatus.className = 'detection-status error';
      } finally {
        detectModelsBtn.disabled = false;
      }
    });
  }

  // Listen for automatic detection results from main process
  sixEyes.on('models:detected', (result) => {
    if (result.success && !detectionResults.classList.contains('hidden')) {
      renderModelsList(result.available, result.recommended);
    }
  });

  // Listen for rate limit updates
  sixEyes.on('ratelimit:updated', (info) => {
    rateLimitInfo = info;
    // Re-render models list if it's visible to show updated rate limit info
    if (!detectionResults.classList.contains('hidden')) {
      const currentModels = Array.from(modelsList.querySelectorAll('.model-card')).map(card => {
        return {
          id: card.querySelector('.model-name').textContent,
          description: card.querySelector('.model-description').textContent,
          context: 128000, // Would need to store this properly
          inputPrice: 0,
          outputPrice: 0
        };
      });
      // For now, just update the display if we have the data
      // In a full implementation, we'd store the model data and re-render
    }
  });

  // Usage tracking UI
  async function updateUsageUI() {
    try {
      const usage = await sixEyes.usageGet();
      
      // Update overview stats
      $('#usage-total-tokens').textContent = usage.totalTokens.toLocaleString();
      $('#usage-total-cost').textContent = `$${usage.totalCost.toFixed(4)}`;
      $('#usage-monthly-limit').textContent = `$${usage.monthlyLimit.toFixed(2)}`;
      $('#usage-limit-input').value = usage.monthlyLimit;
      
      // Update progress bar
      const percentage = Math.min(100, (usage.totalCost / usage.monthlyLimit) * 100);
      const remaining = Math.max(0, usage.monthlyLimit - usage.totalCost);
      
      const barFill = $('#usage-bar-fill');
      barFill.style.width = `${percentage}%`;
      barFill.classList.remove('warning', 'danger');
      
      if (percentage >= 90) {
        barFill.classList.add('danger');
      } else if (percentage >= 70) {
        barFill.classList.add('warning');
      }
      
      $('#usage-percentage').textContent = `${percentage.toFixed(1)}%`;
      $('#usage-remaining').textContent = `$${remaining.toFixed(2)} remaining`;
      
      // Update provider breakdown
      const providerBreakdown = $('#usage-by-provider');
      providerBreakdown.innerHTML = '';
      
      for (const [provider, data] of Object.entries(usage.byProvider)) {
        if (data.tokens > 0) {
          const item = document.createElement('div');
          item.className = 'usage-breakdown-item';
          item.innerHTML = `
            <span class="usage-breakdown-name">${provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
            <div>
              <span class="usage-breakdown-value">${data.tokens.toLocaleString()}</span>
              <span class="usage-breakdown-cost">$${data.cost.toFixed(4)}</span>
            </div>
          `;
          providerBreakdown.appendChild(item);
        }
      }
      
      // Update model breakdown
      const modelBreakdown = $('#usage-by-model');
      modelBreakdown.innerHTML = '';
      
      for (const [model, data] of Object.entries(usage.byModel)) {
        if (data.tokens > 0) {
          const item = document.createElement('div');
          item.className = 'usage-breakdown-item';
          item.innerHTML = `
            <span class="usage-breakdown-name">${model}</span>
            <div>
              <span class="usage-breakdown-value">${data.tokens.toLocaleString()}</span>
              <span class="usage-breakdown-cost">$${data.cost.toFixed(4)}</span>
            </div>
          `;
          modelBreakdown.appendChild(item);
        }
      }
      
      if (modelBreakdown.children.length === 0) {
        modelBreakdown.innerHTML = '<div style="color: var(--tx-mut); font-size: 13px;">No usage data yet</div>';
      }
      
    } catch (err) {
      console.error('Failed to update usage UI:', err);
    }
  }

  // Usage button handlers
  const setLimitBtn = $('#set-limit-btn');
  const resetUsageBtn = $('#reset-usage-btn');
  const usageLimitInput = $('#usage-limit-input');

  if (setLimitBtn) {
    setLimitBtn.addEventListener('click', async () => {
      const limit = parseFloat(usageLimitInput.value);
      if (isNaN(limit) || limit < 1) {
        $('#s-status').textContent = 'Please enter a valid limit (minimum $1)';
        return;
      }

      try {
        await sixEyes.usageSetLimit(limit);
        await updateUsageUI();
        $('#s-status').textContent = 'Monthly limit updated';
      } catch (err) {
        $('#s-status').textContent = 'Failed to update limit';
      }
    });
  }

  if (resetUsageBtn) {
    resetUsageBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to reset all usage data? This cannot be undone.')) {
        return;
      }

      try {
        await sixEyes.usageReset();
        await updateUsageUI();
        $('#s-status').textContent = 'Usage data reset';
      } catch (err) {
        $('#s-status').textContent = 'Failed to reset usage';
      }
    });
  }

  // Listen for usage updates
  sixEyes.on('usage:updated', () => {
    updateUsageUI();
  });

  // Initial usage UI update
  updateUsageUI();

  const resetLayoutBtn = $('#reset-layout-btn');
  if (resetLayoutBtn) {
    resetLayoutBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(LAYOUT_KEY);
      } catch (e) {}
      PANEL_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.style.left = '';
          el.style.top = '';
          el.style.width = '';
          el.style.height = '';
          el.style.maxHeight = '';
          el.style.transform = '';
        }
      });
      applyDefaultLayout();
      showStatus('Layout reset to default.');
    });
  }

  // ---- LeetCode multi-screenshot capture ----------------------------------
  const leetcodePanel = $('#leetcode-panel');
  const leetcodeScreenshots = $('#leetcode-screenshots');
  const leetcodeMoreBtn = $('#leetcode-more-btn');
  const leetcodeSolveBtn = $('#leetcode-solve-btn');
  const leetcodeCloseBtn = $('#leetcode-close-btn');
  const leetcodeStatus = $('#leetcode-status');
  let capturedImages = [];
  let leetcodeCollectMode = false;

  function openLeetCodePanel() {
    capturedImages = [];
    leetcodeCollectMode = true;
    renderLeetCodeScreenshots();
    leetcodePanel.classList.remove('hidden');
    leetcodeStatus.textContent = `${capturedImages.length} screenshot(s) captured`;
    setIgnore(false);
    captureAndAddScreenshot();
  }

  function closeLeetCodePanel() {
    leetcodePanel.classList.add('hidden');
    setIgnore(true);
    capturedImages = [];
    leetcodeCollectMode = false;
  }

  async function captureAndAddScreenshot() {
    try {
      const dataUrl = await sixEyes.captureScreenshot();
      if (dataUrl) {
        capturedImages.push(dataUrl);
        renderLeetCodeScreenshots();
        leetcodeStatus.textContent = `${capturedImages.length} screenshot(s) captured`;
      }
    } catch (err) {
      appendMainDebug('Screenshot capture failed: ' + (err && err.message));
    }
  }

  function renderLeetCodeScreenshots() {
    leetcodeScreenshots.innerHTML = '';
    capturedImages.forEach((dataUrl, index) => {
      const item = document.createElement('div');
      item.className = 'screenshot-item';
      
      const img = document.createElement('img');
      img.src = dataUrl;
      item.appendChild(img);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => {
        capturedImages.splice(index, 1);
        renderLeetCodeScreenshots();
        leetcodeStatus.textContent = `${capturedImages.length} screenshot(s) captured`;
      });
      item.appendChild(deleteBtn);
      
      leetcodeScreenshots.appendChild(item);
    });
  }

  async function submitLeetCode() {
    // If panel is open with collected screenshots, capture one more and send all
    if (leetcodeCollectMode && !leetcodePanel.classList.contains('hidden') && capturedImages.length > 0) {
      try {
        const dataUrl = await sixEyes.captureScreenshot();
        if (dataUrl) {
          capturedImages.push(dataUrl);
        }
      } catch (err) {
        appendMainDebug('Screenshot capture failed: ' + (err && err.message));
      }
      closeLeetCodePanel();
      sixEyes.ask({ mode: 'leetcode', text: '', images: capturedImages });
    } else {
      // Panel is closed or no images collected, capture and send immediately
      closeLeetCodePanel();
      try {
        const dataUrl = await sixEyes.captureScreenshot();
        sixEyes.ask({ mode: 'leetcode', text: '', images: dataUrl ? [dataUrl] : null });
      } catch (err) {
        appendMainDebug('Screenshot capture failed: ' + (err && err.message));
      }
    }
  }

  if (leetcodeMoreBtn) {
    leetcodeMoreBtn.addEventListener('click', captureAndAddScreenshot);
  }
  if (leetcodeSolveBtn) {
    leetcodeSolveBtn.addEventListener('click', submitLeetCode);
  }
  if (leetcodeCloseBtn) {
    leetcodeCloseBtn.addEventListener('click', closeLeetCodePanel);
  }

  // Listen for leetcode shortcuts from main process
  sixEyes.on('leetcode:collect', () => {
    if (leetcodeCollectMode && !leetcodePanel.classList.contains('hidden')) {
      // Panel is open, add screenshot
      captureAndAddScreenshot();
    } else {
      // Panel is closed, open it and start collecting
      openLeetCodePanel();
    }
  });

  sixEyes.on('leetcode:send', () => {
    if (leetcodeCollectMode && !leetcodePanel.classList.contains('hidden')) {
      // Panel is open, send collected screenshots
      submitLeetCode();
    } else {
      // Panel is closed, capture and send immediately
      submitLeetCode();
    }
  });

  // ---- example conversation (matches the reference screenshot) ------------
  function showExample() {
    clearMessages();
    addUserBubble('What should I say?');
    const ai = document.createElement('div');
    ai.className = 'ai-text';
    ai.textContent = 'A discounted cash flow model values a company by projecting future free cash flows and discounting them to present value using the weighted average cost of capital.';
    messages.appendChild(ai);
  }

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!settingsWrap.classList.contains('hidden')) closeSettings();
      if (!leetcodePanel.classList.contains('hidden')) closeLeetCodePanel();
    }
    if (e.metaKey && e.key === ',') { e.preventDefault(); openSettings(); }
  });

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) { if (v !== ignoring) { ignoring = v; sixEyes.setIgnoreMouse(v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap, #meeting-side, #transcript-pane, #settings-wrap, #onboard-scrim, #leetcode-panel'));
    setIgnore(!overUI);
  });
  setIgnore(true);

  // ---- layout: default positions + drag/resize + persistence ---------------
  const LAYOUT_KEY = '6Eyes-ui-layout';
  const PANEL_IDS = ['panel-wrap', 'meeting-side', 'transcript-pane', 'toolbar', 'leetcode-panel', 'settings-wrap'];

  const DEFAULT_LAYOUT = {
    'panel-wrap': { top: 68, centerX: true, width: null, height: null },
    'meeting-side': { top: 68, right: 20, width: 320, height: 380 },
    'transcript-pane': { below: 'meeting-side', gap: 16, right: 20, width: 320, height: 280 },
    'toolbar': { top: 14, centerX: true, width: null, height: null },
    'leetcode-panel': { top: 68, left: 20, width: 280, height: 300 },
    'settings-wrap': { top: 100, centerX: true, width: 680, height: 600 }
  };

  function getViewport() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  // Helper function to calculate responsive panel dimensions
  function getResponsiveDimensions(vp) {
    return {
      panel: {
        width: Math.min(624, vp.w * 0.94),
        height: Math.min(500, vp.h * 0.7)
      },
      meeting: {
        width: Math.min(320, vp.w * 0.4),
        height: Math.min(380, vp.h * 0.5)
      },
      transcript: {
        height: Math.min(280, vp.h * 0.35)
      },
      leetcode: {
        width: Math.min(280, vp.w * 0.35),
        height: Math.min(300, vp.h * 0.4)
      },
      settings: {
        width: Math.min(680, vp.w * 0.92),
        height: Math.min(600, vp.h * 0.85)
      }
    };
  }

  function applyDefaultLayout() {
    const vp = getViewport();
    const panel = $('#panel-wrap');
    const meeting = $('#meeting-side');
    const transcript = $('#transcript-pane');
    const toolbar = $('#toolbar');
    const leetcode = $('#leetcode-panel');
    const settings = $('#settings-wrap');
    const dims = getResponsiveDimensions(vp);

    panel.style.transform = 'none';
    panel.style.width = dims.panel.width + 'px';
    panel.style.left = ((vp.w - dims.panel.width) / 2) + 'px';
    panel.style.top = '68px';
    panel.style.right = 'auto';
    panel.style.height = dims.panel.height + 'px';
    panel.style.maxHeight = dims.panel.height + 'px';

    meeting.style.transform = 'none';
    meeting.style.left = 'auto';
    meeting.style.right = '20px';
    meeting.style.top = '68px';
    meeting.style.width = dims.meeting.width + 'px';
    meeting.style.height = dims.meeting.height + 'px';
    meeting.style.maxHeight = dims.meeting.height + 'px';

    const meetingBottom = 68 + dims.meeting.height;
    transcript.style.transform = 'none';
    transcript.style.left = 'auto';
    transcript.style.right = '20px';
    transcript.style.top = (meetingBottom + 16) + 'px';
    transcript.style.width = dims.meeting.width + 'px';
    transcript.style.height = dims.transcript.height + 'px';
    transcript.style.maxHeight = dims.transcript.height + 'px';

    if (leetcode) {
      leetcode.style.transform = 'none';
      leetcode.style.left = '20px';
      leetcode.style.top = '68px';
      leetcode.style.right = 'auto';
      leetcode.style.width = dims.leetcode.width + 'px';
      leetcode.style.height = dims.leetcode.height + 'px';
      leetcode.style.maxHeight = dims.leetcode.height + 'px';
    }

    if (toolbar) {
      toolbar.style.transform = 'none';
      const tbWidth = toolbar.offsetWidth || 220;
      toolbar.style.left = ((vp.w - tbWidth) / 2) + 'px';
      toolbar.style.top = '14px';
      toolbar.style.right = 'auto';
    }

    if (settings) {
      settings.style.transform = 'none';
      settings.style.width = dims.settings.width + 'px';
      settings.style.left = ((vp.w - dims.settings.width) / 2) + 'px';
      settings.style.top = '100px';
      settings.style.right = 'auto';
      settings.style.height = dims.settings.height + 'px';
      settings.style.maxHeight = dims.settings.height + 'px';
    }
  }

  function readLayout() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveLayout() {
    const layout = {};
    PANEL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return;
      const rect = el.getBoundingClientRect();
      layout[id] = {
        left: rect.left,
        top: rect.top,
        width: el.offsetWidth,
        height: el.offsetHeight
      };
    });
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }

  function applySavedLayout(saved) {
    if (!saved) return false;
    let applied = false;
    PANEL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      const pos = saved[id];
      if (!el || !pos) return;
      el.style.transform = 'none';
      el.style.left = Math.max(8, pos.left) + 'px';
      el.style.top = Math.max(8, pos.top) + 'px';
      el.style.right = 'auto';
      if (id !== 'toolbar') {
        if (pos.width) el.style.width = Math.max(240, pos.width) + 'px';
        if (pos.height) {
          el.style.height = Math.max(180, pos.height) + 'px';
          el.style.maxHeight = Math.max(180, pos.height) + 'px';
        }
      }
      applied = true;
    });
    return applied;
  }

  function clampPanel(el) {
    const vp = getViewport();
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    left = Math.min(Math.max(8, left), vp.w - w - 8);
    top = Math.min(Math.max(8, top), vp.h - h - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    el.style.transform = 'none';
  }

  function makeDraggable(element, handle) {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, textarea, a, .resize-handle')) return;
      dragging = true;
      const rect = element.getBoundingClientRect();
      element.style.transform = 'none';
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      element.style.left = startLeft + 'px';
      element.style.top = startTop + 'px';
      element.style.right = 'auto';
      element.style.zIndex = '100';
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      element.style.left = (startLeft + e.clientX - startX) + 'px';
      element.style.top = (startTop + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      element.style.zIndex = '';
      clampPanel(element);
      saveLayout();
    });
  }

  function makeResizable(element) {
    const handle = element.querySelector('.resize-handle');
    if (!handle) return;
    let resizing = false;
    let startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      resizing = true;
      const rect = element.getBoundingClientRect();
      element.style.transform = 'none';
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.right = 'auto';
      startX = e.clientX;
      startY = e.clientY;
      startW = element.offsetWidth;
      startH = element.offsetHeight;
      element.style.zIndex = '100';
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const minW = element.id === 'panel-wrap' ? 320 : 240;
      const minH = element.id === 'panel-wrap' ? 280 : 180;
      const w = Math.max(minW, startW + e.clientX - startX);
      const h = Math.max(minH, startH + e.clientY - startY);
      element.style.width = w + 'px';
      element.style.height = h + 'px';
      element.style.maxHeight = h + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      element.style.zIndex = '';
      clampPanel(element);
      saveLayout();
    });
  }

  function initPanelInteractions() {
    makeDraggable($('#panel-wrap'), $('.panel-drag-bar'));
    makeDraggable($('#meeting-side'), $('#meeting-side .meeting-head'));
    makeDraggable($('#transcript-pane'), $('#transcript-pane .meeting-head'));
    makeDraggable($('#leetcode-panel'), $('#leetcode-panel .leetcode-head'));
    makeDraggable($('#toolbar'), $('#toolbar'));
    makeDraggable($('#settings-wrap'), $('#settings-wrap .panel-drag-bar'));
    PANEL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) makeResizable(el);
    });
  }

  function initLayout() {
    const saved = readLayout();
    if (!saved || !applySavedLayout(saved)) applyDefaultLayout();
    initPanelInteractions();
  }

  window.addEventListener('resize', () => {
    PANEL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) clampPanel(el);
    });
    // Re-apply responsive sizing on resize
    const vp = getViewport();
    const dims = getResponsiveDimensions(vp);
    const panel = $('#panel-wrap');
    if (panel && !panel.classList.contains('hidden')) {
      panel.style.height = dims.panel.height + 'px';
      panel.style.maxHeight = dims.panel.height + 'px';
    }
    const meeting = $('#meeting-side');
    if (meeting && !meeting.classList.contains('hidden')) {
      meeting.style.width = dims.meeting.width + 'px';
      meeting.style.height = dims.meeting.height + 'px';
      meeting.style.maxHeight = dims.meeting.height + 'px';
    }
    const transcript = $('#transcript-pane');
    if (transcript && !transcript.classList.contains('hidden')) {
      const meetingRect = meeting ? meeting.getBoundingClientRect() : { bottom: 68 + dims.meeting.height };
      transcript.style.top = (meetingRect.bottom + 16) + 'px';
      transcript.style.height = dims.transcript.height + 'px';
      transcript.style.maxHeight = dims.transcript.height + 'px';
    }
    const settings = $('#settings-wrap');
    if (settings && !settings.classList.contains('hidden')) {
      settings.style.width = dims.settings.width + 'px';
      settings.style.left = ((vp.w - dims.settings.width) / 2) + 'px';
      settings.style.height = dims.settings.height + 'px';
      settings.style.maxHeight = dims.settings.height + 'px';
    }
  });

  // ---- onboarding / first-run tutorial -----------------------------------
  const obScrim = $('#onboard-scrim');
  const OB_STEPS = [
    {
      icon: '👋',
      title: 'Welcome to 6Eyes',
      body: '6Eyes is a private AI copilot that floats over your screen. It can <strong>see your screen</strong>, <strong>hear your meetings</strong>, and help you answer questions or solve coding problems — while staying hidden from most screen shares.<br><br>This quick guide gets you running in about a minute.'
    },
    {
      icon: '🔐',
      title: 'Allow 6Eyes to see & hear',
      body: '6Eyes needs two macOS permissions. Click each button, turn <strong>6Eyes</strong> ON in the window that opens, then come back here.<ul><li><strong>Microphone</strong> — to hear you</li><li><strong>Screen Recording</strong> — to see your screen and hear meeting audio</li></ul>',
      buttons: [
        { label: 'Open Microphone settings', action: () => sixEyes.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone') },
        { label: 'Open Screen Recording settings', action: () => sixEyes.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') }
      ]
    },
    {
      icon: '🔑',
      title: 'Connect an AI provider',
      body: '6Eyes uses <strong>your own</strong> API key — pick <span class="hl">OpenAI</span>, <span class="hl">Anthropic</span>, or <span class="hl">Google Gemini</span>. Get a key from your provider, then paste it into 6Eyes\'s Settings.<br><br><strong>Tip:</strong> the listening features need speech-to-text access (an OpenAI key with Whisper, or a Gemini key). A chat-only key still powers screen &amp; coding help.',
      buttons: [{ label: 'Open 6Eyes Settings', action: () => { finishOnboard(); openSettings(); } }]
    },
    {
      icon: '🫥',
      title: 'Stay hidden in Zoom',
      body: '6Eyes is hidden from most screen shares automatically (Google Meet, Teams, QuickTime — nothing to do). <strong>Zoom needs one setting:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong><br><br>Avoid “<strong>without</strong> window filtering” — that mode reveals 6Eyes.'
    },
    {
      icon: '✨',
      title: 'You\'re all set',
      body: 'How to use 6Eyes:<ul><li><span class="kbd">⌘</span> <span class="kbd">↵</span> — <strong>Assist</strong> with whatever\'s on screen or being said</li><li><span class="kbd">⌘</span> <span class="kbd">H</span> — solve a coding problem on screen</li><li>Click <strong>▢</strong> in the top bar to start listening to a meeting</li><li>Type a question and press <span class="kbd">↵</span></li></ul>Reopen this guide anytime by clicking the <strong>6Eyes logo</strong>. Quit with <span class="kbd">⌘</span><span class="kbd">⇧</span><span class="kbd">X</span>.'
    }
  ];
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    $('#ob-icon').textContent = step.icon;
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = step.body;
    const btns = $('#ob-buttons'); btns.innerHTML = '';
    (step.buttons || []).forEach((b) => { const el = document.createElement('button'); el.textContent = b.label; el.addEventListener('click', b.action); btns.appendChild(el); });
    const dots = $('#ob-dots'); dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => { const d = document.createElement('span'); if (i === obIndex) d.className = 'on'; dots.appendChild(d); });
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? 'Done' : 'Next';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
  }
  function showOnboard() { obIndex = 0; renderOnboard(); obScrim.classList.remove('hidden'); setIgnore(false); }
  async function finishOnboard() {
    obScrim.classList.add('hidden');
    if (settings && !settings.onboarded) { settings.onboarded = true; await sixEyes.settingsSet({ onboarded: true }); }
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', showOnboard);

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    settings = await sixEyes.settingsGet();
    smartBtn.classList.toggle('on', !!settings.smart);
    try {
      if (settings.chatPersistent) {
        persistToggle.classList.toggle('on', !!settings.chatPersistent);
        const h = await sixEyes.historyGet();
        if (h && h.length) renderHistoryIntoMessages(h);
        else showExample();
      } else {
        persistToggle.classList.toggle('on', false);
        showExample();
      }
    } catch (e) { showExample(); }
    syncPlaceholder();
    const st = await sixEyes.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    $('#stop-btn').classList.toggle('active', st.active);
    mainDebug.classList.add('hidden');
    meetingDebug.classList.add('hidden');
    debugToggle.classList.toggle('on', false);
    notesDebugToggle.classList.toggle('on', false);
    setMeetingActive(false);
    initLayout();
    if (!settings.onboarded) showOnboard();
  })();

  function renderHistoryIntoMessages(entries) {
    // entries come newest-first from store; display oldest->newest
    const list = (entries || []).slice().reverse();
    clearMessages();
    for (const e of list) {
      if (e.prompt) addUserBubble(e.prompt);
      if (e.response) {
        const ai = document.createElement('div'); ai.className = 'ai-text'; ai.innerHTML = renderMarkdown(e.response || '');
        messages.appendChild(ai);
      }
    }
    // scroll to bottom
    messages.scrollTop = messages.scrollHeight;
  }
})();
