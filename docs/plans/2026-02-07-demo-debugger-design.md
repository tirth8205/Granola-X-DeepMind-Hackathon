# Demo Debugger - Design Document

## What It Is

A real-time UX critique tool powered by Gemini Live API. Captures a browser tab via screen share, streams video + mic audio to Gemini Live, and receives conversational voice critiques about UX issues. Interruptible - users can ask follow-up questions mid-critique.

## Architecture (2-Hour Hackathon Scope)

### Components

1. **Backend Auth Service** (`/server`) - Simple Node/Express (~50 lines). Holds API key, generates ephemeral token for Gemini Live.
2. **Screen Capture Module** - `getDisplayMedia()` for video, `getUserMedia()` for mic.
3. **Gemini Live Connection** - Frontend requests token from backend, opens direct WebSocket. Sends video + audio, receives voice + text.
4. **Minimal UI** - Start button, status text, stop button.

### NOT Building (Cut for Time)

- Text storage / transcript panel
- Download notes feature
- Polished UI states
- Custom sample app (use existing flawed site or quick HTML)
- Error handling beyond basic alerts
- Backup recording

## File Structure

```
server/
  index.js          # Express + /token endpoint
  .env              # GEMINI_API_KEY (gitignored)
  package.json

client/
  index.html        # Single page
  app.js            # All logic (~200-300 lines)
  styles.css        # Basic styling
```

## System Prompt (Gemini Live)

```
You are a UX expert observing a live app demo through screen share. Your role:

BEHAVIOR:
- Watch the screen continuously and comment on UX issues as they appear
- Speak conversationally, like a helpful colleague sitting beside the user
- Keep critiques brief (1-2 sentences), then pause to let the user continue
- When the user asks follow-up questions, pause your observation and respond directly
- After answering, resume watching for new issues

CRITIQUE STYLE:
- Lead with what you observe: "That button feels..."
- Explain why it's a problem: "...users might miss it because..."
- Suggest a fix when obvious: "...consider moving it top-right"
- Be constructive, not harsh - you're helping, not judging

FOCUS AREAS (priority order):
1. Layout and visual hierarchy issues
2. Navigation and flow confusion
3. Accessibility concerns (contrast, sizing)
4. Interaction feedback gaps
5. Performance issues (visible delays)

DO NOT:
- Critique code or technical implementation
- Comment on content/copy unless egregiously unclear
- Speak continuously - leave natural pauses
- Repeat the same issue multiple times
```

## Error Handling (Minimal)

| Failure | Fallback |
|---|---|
| Token fetch fails | Alert + retry button |
| Screen share denied | "Screen share required" message |
| Mic denied | Listen-only mode (AI critiques, can't interrupt) |
| WebSocket disconnects | Alert + one auto-reconnect attempt |

## 2-Hour Build Plan

**Hour 1: Core Pipeline**
- 0:00-0:15: Project setup + Express backend with /token
- 0:15-0:40: Screen capture + mic + Gemini WebSocket connection
- 0:40-1:00: Pipe streams, get first AI voice response

**Hour 2: Demo-Ready**
- 1:00-1:20: System prompt tuning
- 1:20-1:35: Minimal UI
- 1:35-1:50: Test on flawed target
- 1:50-2:00: One full rehearsal
