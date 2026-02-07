# Crumble

**Find the cracks before they crumble.**

Crumble is a real-time AI-powered UX audit tool. Share your screen and a Gemini-powered design critic watches live, spotting layout issues, accessibility gaps, and interaction problems a human eye might miss — and talks to you about them.

## How It Works

1. Click **Start Session** — Crumble captures your screen and microphone
2. Gemini Live analyzes your UI in real-time via periodic screenshots + audio
3. The AI speaks its critiques out loud (layout, typography, color, CTAs, navigation, accessibility)
4. Interrupt anytime to ask follow-up questions — it listens and responds naturally
5. When done, review findings in the session log, generate an AI summary, or export an HTML report

## Features

- **Live screen analysis** — Frames sent every 2 seconds to Gemini 2.5 Flash (native audio)
- **Voice interaction** — AI speaks critiques aloud; interrupt with your mic to ask questions
- **Session history** — Past sessions saved in localStorage with full transcript replay
- **AI summaries** — Generate a structured summary of findings from any past session
- **HTML report export** — Download a styled, printable audit report
- **Copy to clipboard** — Quick-share findings with your team

## Tech Stack

- **Frontend:** Vanilla JS, HTML, CSS (no build step)
- **Backend:** Node.js + Express (serves static files + API key proxy)
- **AI:** Google Gemini 2.5 Flash via the Live API (`@google/genai`)
- **Audio:** Web Audio API with AudioWorklet for mic capture, PCM16 playback for AI voice

## Quick Start

```bash
# Clone the repo
git clone https://github.com/tirth8205/Granola-X-DeepMind-Hackathon.git
cd Granola-X-DeepMind-Hackathon

# Install dependencies
npm install

# Create a .env file with your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Start the server
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

For detailed setup instructions, see [docs/setup-guide.md](docs/setup-guide.md).

## Project Structure

```
├── server.js              # Express server — serves static files + /token endpoint
├── public/
│   ├── index.html         # Single-page app shell
│   ├── app.js             # All client-side logic (Gemini Live, screen capture, UI)
│   ├── audio-worklet.js   # AudioWorklet for mic PCM16 encoding
│   └── styles.css         # Full design system (dark theme, orb animations)
├── docs/
│   ├── setup-guide.md     # How to run Crumble on your machine
│   └── plans/             # Design documents
├── Dockerfile             # Production container setup
├── package.json
└── .env                   # Your Gemini API key (gitignored)
```

## License

Built for the Granola x DeepMind Hackathon.
