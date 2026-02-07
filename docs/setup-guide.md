# Setup Guide

How to run Crumble on your machine.

## Prerequisites

- **Node.js 18+** — Download from [nodejs.org](https://nodejs.org/) (LTS recommended)
- **A Gemini API key** — Get one free at [Google AI Studio](https://aistudio.google.com/apikey)
- **A modern browser** — Chrome or Edge recommended (screen capture + AudioWorklet support required)

## Step 1: Clone the Repository

```bash
git clone https://github.com/tirth8205/Granola-X-DeepMind-Hackathon.git
cd Granola-X-DeepMind-Hackathon
```

## Step 2: Install Dependencies

```bash
npm install
```

This installs three packages: `express`, `dotenv`, and `@google/genai`.

## Step 3: Set Up Your API Key

Create a `.env` file in the project root:

```bash
echo "GEMINI_API_KEY=your_key_here" > .env
```

Replace `your_key_here` with your actual Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

> **Important:** Never commit the `.env` file. It's already in `.gitignore`.

## Step 4: Start the Server

```bash
npm start
```

You should see:

```
Server running at http://localhost:3000
```

For development with auto-restart on file changes:

```bash
npm run dev
```

## Step 5: Use Crumble

1. Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge
2. Click **Start Session**
3. Select a screen or browser tab to share when prompted
4. Allow microphone access (optional — without it, the AI will critique but you can't interrupt)
5. The AI will begin analyzing your screen and speaking its feedback
6. Talk to it anytime to ask questions or redirect its focus
7. Click **End Session** when done

## Running with Docker

If you prefer Docker:

```bash
# Build the image
docker build -t crumble .

# Run the container (pass your API key)
docker run -p 3000:3000 -e GEMINI_API_KEY=your_key_here crumble
```

Then open [http://localhost:3000](http://localhost:3000).

## Custom Port

Set the `PORT` environment variable to use a different port:

```bash
PORT=8080 npm start
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY not set in .env` | Make sure your `.env` file exists in the project root with a valid key |
| Screen share prompt doesn't appear | Use Chrome or Edge — Firefox has limited `getDisplayMedia` support |
| No audio from the AI | Check that your system volume is up and no other app is blocking audio output |
| Mic denied — listen-only mode | The AI will still critique, but you can't interrupt. Re-allow mic in browser settings if needed |
| WebSocket connection error | Verify your API key is valid and has access to the Gemini Live API |
