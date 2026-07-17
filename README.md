<div align="center">

# loki

**An intelligent AI assistant that floats invisibly over your screen — seeing what you see, hearing your conversations, and staying hidden from screen shares.**

A free, open-source alternative to proprietary AI copilots. Bring your own API keys (OpenAI · Anthropic · Google Gemini).

</div>

---

> [!WARNING]  
> **Important:** loki attempts to stay hidden from screen recordings, but this is **best-effort, not guaranteed**. On macOS 15.4+, some capture tools may still detect it, and phone cameras always can. Using a hidden assistant during **proctored exams, job interviews, or recorded meetings** may violate platform policies or local consent laws. loki is designed for legitimate use cases: personal note-taking, studying, accessibility, and practice. **You are responsible for how you use it.**

---

## Features

loki provides real-time AI assistance by combining three inputs: your screen, your microphone, and meeting audio from other participants.

### Core Capabilities

- **Smart Assistance** — Press `⌘` `↵` anywhere to get contextual help based on what's on your screen and what's being discussed
- **Coding Problem Solver** — Press `⌘` `H` to capture and solve coding problems with approach, code, and complexity analysis
- **Conversation Guidance** — Get suggestions for what to say in meetings based on both sides of the conversation
- **Meeting Notes** — Automatically generate and maintain persistent notes during meetings with configurable intervals
- **Follow-up Questions** — Receive intelligent suggestions for relevant follow-up questions to keep conversations productive
- **Session Recap** — Get a concise summary of the entire conversation for anyone joining late
- **Flexible Querying** — Type any question and get answers based on your screen context and conversation history
- **Model Selection** — Switch between fast and smart AI models depending on your needs

### Interface Features

- **Glassmorphism UI** — Beautiful, transparent panel that floats above everything
- **Click-through Design** — Empty space around the panel doesn't block the app behind it
- **Draggable & Resizable** — All panels can be repositioned and resized; positions persist between sessions
- **Screen Share Protection** — Designed to stay hidden from most screen capture tools (best-effort)
- **Persistent Chat History** — Optionally save your conversation history between sessions
- **Usage Tracking** — Monitor token usage and costs with monthly spending limits

---

## Installation

### Option A: Pre-built Application (Recommended)

1. Visit the [Releases](../../releases) page and download `loki-mac.zip`
2. Unzip the file to get `loki.app`
3. Move `loki.app` to your Applications folder
4. **First-time setup:** Since loki is unsigned, macOS requires special handling:
   - Right-click `loki.app` → Open → click Open in the dialog
   - If you see "loki is damaged and can't be opened," run this in Terminal:
     ```bash
     xattr -cr /Applications/loki.app
     ```
   - Then double-click loki.app again

After this initial setup, loki will open normally.

### Option B: Build from Source

Requires Node.js 18+.

```bash
git clone https://github.com/Blueturboguy07/loki.git
cd loki
npm install
npm start
```

To build your own application:

```bash
npm run pack  # Creates dist/mac-arm64/loki.app
```

**Note:** Built apps are ad-hoc signed. Rebuilding changes the app identity, so you'll need to regrant macOS permissions. For daily use, build once and keep it.

---

## Getting Started

When you first launch loki, a built-in tutorial guides you through setup. You can also access it anytime by clicking the loki logo in the top-left corner.

### Step 1: Grant macOS Permissions

loki needs permission to see and hear:

- **Microphone:** System Settings → Privacy & Security → Microphone → Enable loki
- **Screen Recording:** System Settings → Privacy & Security → Screen Recording → Enable loki

macOS may ask you to quit and reopen loki after granting permissions.

### Step 2: Configure AI Provider

loki uses your own API keys — no subscription required. Open Settings (⌘ `,`) and add your key:

| Provider | Where to get key | Notes |
|----------|------------------|-------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Supports all features, but key must have Whisper/audio access for transcription |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Excellent for coding and screen help; no speech-to-text, so add OpenAI/Gemini key for audio features |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Single key handles both chat and transcription |

Your keys are stored locally in `loki-data.json` and sent only to your chosen provider.

### Step 3: Zoom Configuration (Optional)

loki hides automatically from most screen share tools (Google Meet, Teams, QuickTime). For Zoom, enable this setting:

**Zoom → Settings → Share Screen → Advanced → Screen capture mode → "Advanced capture with window filtering"**

This tells Zoom to respect loki's privacy flag. The "without window filtering" mode will capture loki.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘` `↵` | Get smart assistance based on current context |
| `⌘` `H` | Solve the coding problem visible on screen |
| `⌘` `,` | Open Settings |
| `⌘` `⇧` `X` | Quit loki |

---

## Using the Interface

### Main Panel

- **Input Box** — Type questions and press Enter to query your screen and conversation
- **Action Buttons** — Quick access to common features (Assist, Say, Follow-up, Recap)
- **Smart Toggle** — Switch between fast (default) and smart AI models
- **Chat Persistence** — Toggle to save conversation history between sessions

### Top Toolbar

- **Logo Button** — Access the onboarding tutorial
- **Hide UI** — Collapse to just the toolbar
- **Stop Button (▢)** — Start/stop meeting audio capture (green dot = active)
- **Panel Toggle** — Show/hide the main panel
- **Notes Toggle** — Open the Meeting Notes panel
- **Settings Toggle** — Open configuration panel

### Meeting Notes Panel

- **Start/Stop** — Begin or end note-taking session
- **Interval Setting** — Configure how often to generate notes (default: 60 seconds)
- **Session History** — View and manage previous note sessions
- **Transcript View** — See the conversation transcript being used for notes

### Settings Panel

- **Provider Selection** — Choose between OpenAI, Anthropic, or Gemini
- **API Keys** — Enter and manage your provider keys
- **Model Configuration** — Set fast and smart model names per provider
- **Usage Tracking** — View token usage and costs, set monthly limits
- **Layout Reset** — Restore default panel positions if needed

---

## Technical Details

loki is built with [Electron](https://www.electronjs.org/). Everything runs locally except AI API calls.

### Architecture

```
Main Process
├── Overlay window (frameless, transparent, always-on-top, content-protected)
├── Screenshot capture (desktopCapturer)
├── Speech-to-text (Whisper / Gemini) → "You" + "Them" channels
└── LLM streaming (OpenAI / Anthropic / Gemini)

Renderer Process
└── Glass UI + mic capture + system-audio loopback
```

### Input Handling

- **Screen** — Captured via Electron's desktopCapturer when needed
- **Your Microphone** — getUserMedia → downsampled to 16kHz → transcribed
- **Meeting Audio** — getDisplayMedia loopback captures system output on separate channel

### Privacy Implementation

The invisibility feature uses `setContentProtection(true)`, setting `NSWindowSharingNone`. This asks macOS to exclude loki from screen capture streams — the same mechanism used by DRM apps and Zoom's toolbar. It's not a GPU trick or special overlay, which is why it's best-effort on macOS 15.4+.

---

## Troubleshooting

**"It says I need to grant access, but I already did."**

You likely granted permission to an older build. Since the app is ad-hoc signed, rebuilding changes its identity. Toggle loki off and on in System Settings → Screen Recording, or remove and re-add it.

**"Getting 403 errors / no access to model."**

Your API key is restricted. Common issue: OpenAI project keys that only allow chat models work for screen help but fail on transcription (Whisper). Fix: enable audio/Whisper on the key, use an unrestricted key, or add a Gemini key for transcription.

**"Listening feature does nothing / no transcript."**

Ensure you have a transcription-capable key configured (OpenAI with Whisper, or Gemini). Also verify Screen Recording permission is granted (required for meeting audio).

**"loki appears in my Zoom share."**

Set Zoom's Screen capture mode to "Advanced capture with window filtering" (see Step 3 above). Remember this is best-effort on macOS 15.4+.

**"loki is damaged and can't be opened."**

Run `xattr -cr /Applications/loki.app` in Terminal (see Installation → Option A).

---

## Privacy & Security

- No accounts, no servers, no telemetry — loki collects nothing
- API keys stored locally in `loki-data.json`, sent only to your chosen provider
- Screenshots and audio sent to AI provider only when features are used
- Transcripts kept in memory only during current session
- All processing happens locally except AI API calls

---

## Contributing

Issues and pull requests are welcome. loki is designed to be small and readable:
- `main.js` — App logic, capture, and AI integration
- `renderer/` — UI (HTML, CSS, JavaScript)
- `src/` — AI provider implementations

No build step required for source development (plain HTML/CSS/JS).

---

## License

**GPL-3.0-or-later**

Built as an open-source study of AI assistant tools. Inspired by projects exploring similar functionality.
