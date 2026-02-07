import { GoogleGenAI, Modality } from "https://esm.sh/@google/genai@1.40.0";

// --- State ---
let session = null;
let screenStream = null;
let audioContext = null;
let audioRecorderWorklet = null;
let audioSource = null;
let playbackContext = null;
let frameTimer = null;
let isActive = false;
let sessionStartTime = null;
let timerInterval = null;
let currentSpeakingEntry = null;
let lastTurnHadText = false;

// --- DOM ---
const app = document.getElementById("app");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const orbContainer = document.getElementById("orb-container");
const statusText = document.getElementById("status-text");
const landing = document.getElementById("landing");
const sessionEl = document.getElementById("session");
const previewContainer = document.getElementById("preview-container");
const screenPreview = document.getElementById("screen-preview");
const captureCanvas = document.getElementById("capture-canvas");
const errorBar = document.getElementById("error-bar");
const errorText = document.getElementById("error-text");
const btnDismissError = document.getElementById("btn-dismiss-error");
const transcript = document.getElementById("transcript");
const sessionTimer = document.getElementById("session-timer");

// --- Audio Playback ---
let playbackScheduledTime = 0;

function initPlaybackContext() {
  if (!playbackContext) {
    playbackContext = new AudioContext({ sampleRate: 24000 });
  }
}

function playPCM16(base64Data) {
  initPlaybackContext();
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  const buffer = playbackContext.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);

  const now = playbackContext.currentTime;
  if (playbackScheduledTime < now) {
    playbackScheduledTime = now + 0.05;
  }
  source.start(playbackScheduledTime);
  playbackScheduledTime += buffer.duration;
}

function stopPlayback() {
  playbackScheduledTime = 0;
  if (playbackContext) {
    playbackContext.close();
    playbackContext = null;
  }
}

// --- Transcript ---
function getElapsedTime() {
  if (!sessionStartTime) return "00:00";
  const elapsed = Date.now() - sessionStartTime;
  const mins = Math.floor(elapsed / 60000).toString().padStart(2, "0");
  const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function addTranscriptEntry(type, message) {
  const entry = document.createElement("div");
  entry.className = `transcript-entry transcript-${type}`;

  entry.innerHTML = `
    <div class="transcript-dot"></div>
    <span class="transcript-time">${getElapsedTime()}</span>
    <span class="transcript-msg">${escapeHtml(message)}</span>
  `;

  transcript.appendChild(entry);
  transcript.scrollTop = transcript.scrollHeight;
  return entry;
}

function addFeedbackEntry(message) {
  const entry = document.createElement("div");
  entry.className = "transcript-entry transcript-feedback";

  entry.innerHTML = `
    <div class="transcript-dot"></div>
    <span class="transcript-time">${getElapsedTime()}</span>
    <span class="transcript-msg">${escapeHtml(message)}</span>
  `;

  transcript.appendChild(entry);
  transcript.scrollTop = transcript.scrollHeight;
  return entry;
}

function addSpeakingEntry() {
  if (currentSpeakingEntry) return;

  const entry = document.createElement("div");
  entry.className = "transcript-entry transcript-speaking";

  entry.innerHTML = `
    <div class="transcript-dot"></div>
    <span class="transcript-time">${getElapsedTime()}</span>
    <span class="transcript-msg">AI is speaking <span class="waveform"><span></span><span></span><span></span><span></span><span></span></span></span>
  `;

  transcript.appendChild(entry);
  transcript.scrollTop = transcript.scrollHeight;
  currentSpeakingEntry = entry;
}

function removeSpeakingEntry() {
  if (currentSpeakingEntry) {
    currentSpeakingEntry.remove();
    currentSpeakingEntry = null;
  }
}

function clearTranscript() {
  transcript.innerHTML = "";
  currentSpeakingEntry = null;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Session Timer ---
function startSessionTimer() {
  sessionStartTime = Date.now();
  timerInterval = setInterval(() => {
    sessionTimer.textContent = getElapsedTime();
  }, 1000);
}

function stopSessionTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  sessionStartTime = null;
}

// --- View Transitions ---
function showSessionView() {
  landing.classList.add("fade-out");
  setTimeout(() => {
    landing.hidden = true;
    sessionEl.hidden = false;
    app.classList.add("session-active");
  }, 350);
}

function showLandingView() {
  app.classList.remove("session-active");
  sessionEl.hidden = true;
  landing.hidden = false;
  landing.classList.remove("fade-out");
}

// --- Status ---
function setStatus(state, text) {
  // Preserve non-state classes (like 'reveal')
  const keepClasses = [];
  for (const cls of orbContainer.classList) {
    if (!cls.startsWith("state-")) keepClasses.push(cls);
  }
  orbContainer.className = keepClasses.join(" ") + ` state-${state}`;
  statusText.textContent = text;
}

function showError(msg) {
  errorText.textContent = msg;
  errorBar.hidden = false;
}

// --- Token ---
async function fetchToken() {
  const res = await fetch("/token", { method: "POST" });
  if (!res.ok) throw new Error("Failed to get token");
  const data = await res.json();
  return data.token;
}

// --- Screen Capture ---
async function startScreenCapture() {
  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  screenPreview.srcObject = screenStream;

  screenStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (isActive) stopSession();
  });
}

function sendVideoFrames() {
  if (!isActive || !screenStream) return;

  const video = screenPreview;
  const canvas = captureCanvas;
  const ctx = canvas.getContext("2d");

  if (video.videoWidth === 0) {
    frameTimer = setTimeout(sendVideoFrames, 500);
    return;
  }

  canvas.width = video.videoWidth * 0.5;
  canvas.height = video.videoHeight * 0.5;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = dataUrl.split(",")[1];

  if (session) {
    session.sendRealtimeInput({
      media: { mimeType: "image/jpeg", data: base64 },
    });
  }

  frameTimer = setTimeout(sendVideoFrames, 2000);
}

// --- Mic Capture ---
async function startMicCapture() {
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext({ sampleRate: 16000 });
  await audioContext.audioWorklet.addModule("audio-worklet.js");

  audioSource = audioContext.createMediaStreamSource(micStream);
  audioRecorderWorklet = new AudioWorkletNode(audioContext, "audio-recorder-worklet");

  audioRecorderWorklet.port.onmessage = (e) => {
    if (!isActive || !session) return;
    const int16buffer = e.data.int16buffer;
    const bytes = new Uint8Array(int16buffer);
    const base64 = arrayBufferToBase64(bytes);
    session.sendRealtimeInput({
      media: { mimeType: "audio/pcm;rate=16000", data: base64 },
    });
  };

  audioSource.connect(audioRecorderWorklet);
  audioRecorderWorklet.connect(audioContext.destination);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

// --- Gemini Live Session ---
const SYSTEM_PROMPT = `You are a thorough senior UX auditor watching a live app demo through screen share. You receive screenshots every couple of seconds — never comment on image quality or compression, that's just the capture method.

YOUR GOAL: Deliver a comprehensive UX audit. Catch every issue — big and small. The user wants to hear ALL of it.

HOW TO BEHAVE:
- Wait a few seconds after connecting before speaking. Let the user settle in.
- When the user talks, stop and respond directly. Resume your audit after.
- Work through the screen methodically: top to bottom, left to right.
- When the user navigates to a new page, do a full sweep of that page.
- It's okay to give several observations in a row — the user wants thorough coverage.

WHAT TO COVER ON EVERY SCREEN:
1. First impression — what grabs attention first? Is that the right thing?
2. Visual hierarchy — size, weight, color, spacing. Does it guide the eye correctly?
3. CTAs and buttons — are they prominent enough? Is the primary action obvious?
4. Navigation — is the user's current location clear? Can they find their way?
5. Typography — readability, sizing, line length, contrast against background
6. Spacing and alignment — consistency in padding, margins, grid alignment
7. Color usage — does it support the hierarchy? Accessible contrast ratios?
8. Interactive elements — do buttons/links look clickable? Hover/active states?
9. Content clarity — are labels, headings, and microcopy clear and helpful?
10. Mobile considerations — would this work on smaller screens?

FEEDBACK STYLE:
- Be specific: "The 'Download for Mac' button at 14px in gray doesn't read as a primary CTA" not "some buttons are hard to see"
- Explain impact: "Users scanning this hero section would likely miss it"
- Suggest concrete fixes: "Making it 16px bold in your brand color would help"
- Call out what works too: "The nav spacing is solid — clean and scannable"
- Never suggest removing elements unless they're clearly redundant. Buttons like download CTAs, sign-up, pricing — those are intentional. Suggest improving them, not removing them.

PACING:
- Give 2-3 observations, then pause briefly to let the user absorb or respond
- After a pause, continue with more observations if there are any
- When you've covered everything visible, say so: "That covers what I can see on this screen — navigate somewhere else and I'll keep going"

DO NOT:
- Comment on code, architecture, or technical implementation
- Mention image quality, resolution, or screenshot artifacts
- Suggest removing CTAs, download buttons, or key conversion elements — improve them instead
- Repeat an issue you already raised unless it's gotten worse
- Skip small details — the user wants the full picture`;

async function connectToGemini(token) {
  console.log("[CRUMBLE] connectToGemini called");
  console.log("[CRUMBLE] Token (first 10 chars):", token?.substring(0, 10) + "...");
  console.log("[CRUMBLE] Model:", "gemini-2.5-flash-native-audio-preview-12-2025");

  const ai = new GoogleGenAI({ apiKey: token });
  console.log("[CRUMBLE] GoogleGenAI client created");

  const connectConfig = {
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_PROMPT,
    },
    callbacks: {
      onopen: () => {
        console.log("[CRUMBLE] WebSocket OPENED — connected to Gemini Live");
        setStatus("analyzing", "Analyzing screen...");
        addTranscriptEntry("analyzing", "Session active — analyzing your screen");
      },
      onmessage: (message) => {
        console.log("[CRUMBLE] Message received:", JSON.stringify(message).substring(0, 200));
        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith("audio/")) {
              console.log("[CRUMBLE] Audio chunk received, mime:", part.inlineData.mimeType);
              setStatus("speaking", "AI is speaking...");
              addSpeakingEntry();
              playPCM16(part.inlineData.data);
            }
            if (part.text) {
              console.log("[CRUMBLE] Text received:", part.text);
              removeSpeakingEntry();
              addFeedbackEntry(part.text);
              lastTurnHadText = true;
            }
          }
        }
        if (message.serverContent?.turnComplete) {
          console.log("[CRUMBLE] Turn complete");
          removeSpeakingEntry();
          if (!lastTurnHadText) {
            addTranscriptEntry("system", "Feedback delivered");
          }
          lastTurnHadText = false;
          if (isActive) setStatus("analyzing", "Analyzing screen...");
        }
        if (message.serverContent?.interrupted) {
          console.log("[CRUMBLE] Interrupted by user");
          stopPlayback();
          initPlaybackContext();
          removeSpeakingEntry();
          setStatus("listening", "Listening to you...");
          addTranscriptEntry("listening", "You interrupted — listening...");
        }
      },
      onerror: (e) => {
        console.error("[CRUMBLE] WebSocket ERROR:", e);
        console.error("[CRUMBLE] Error type:", e?.type);
        console.error("[CRUMBLE] Error message:", e?.message);
        console.error("[CRUMBLE] Error code:", e?.code);
        console.error("[CRUMBLE] Error reason:", e?.reason);
        console.error("[CRUMBLE] Error keys:", e ? Object.keys(e) : "null");
        try { console.error("[CRUMBLE] Error JSON:", JSON.stringify(e)); } catch {}
        const errMsg = e?.message || e?.reason || "Unknown WebSocket error";
        showError("Connection error: " + errMsg);
        addTranscriptEntry("error", "Connection error: " + errMsg);
      },
      onclose: (e) => {
        console.log("[CRUMBLE] WebSocket CLOSED");
        console.log("[CRUMBLE] Close code:", e?.code);
        console.log("[CRUMBLE] Close reason:", e?.reason);
        console.log("[CRUMBLE] Close wasClean:", e?.wasClean);
        try { console.log("[CRUMBLE] Close JSON:", JSON.stringify(e)); } catch {}
        if (isActive) stopSession();
      },
    },
  };

  console.log("[CRUMBLE] Calling ai.live.connect()...");
  try {
    session = await ai.live.connect(connectConfig);
    console.log("[CRUMBLE] ai.live.connect() resolved successfully, session:", session);
  } catch (connectErr) {
    console.error("[CRUMBLE] ai.live.connect() REJECTED:", connectErr);
    console.error("[CRUMBLE] Rejection type:", typeof connectErr);
    console.error("[CRUMBLE] Rejection name:", connectErr?.name);
    console.error("[CRUMBLE] Rejection message:", connectErr?.message);
    console.error("[CRUMBLE] Rejection stack:", connectErr?.stack);
    try { console.error("[CRUMBLE] Rejection JSON:", JSON.stringify(connectErr)); } catch {}
    throw connectErr;
  }
}

// --- Session Management ---
async function startSession() {
  console.log("[CRUMBLE] === START SESSION ===");
  try {
    btnStart.disabled = true;

    showSessionView();
    startSessionTimer();
    clearTranscript();

    setStatus("connecting", "Getting token...");
    addTranscriptEntry("system", "Requesting authentication...");

    console.log("[CRUMBLE] Fetching token...");
    const token = await fetchToken();
    console.log("[CRUMBLE] Token received, length:", token?.length);
    addTranscriptEntry("system", "Token received");

    setStatus("connecting", "Starting screen capture...");
    addTranscriptEntry("system", "Starting screen capture...");

    console.log("[CRUMBLE] Requesting screen capture...");
    await startScreenCapture();
    console.log("[CRUMBLE] Screen capture active, tracks:", screenStream?.getTracks().length);
    addTranscriptEntry("system", "Screen capture active");

    setStatus("connecting", "Requesting mic access...");
    addTranscriptEntry("system", "Requesting microphone...");

    try {
      console.log("[CRUMBLE] Requesting mic...");
      await startMicCapture();
      console.log("[CRUMBLE] Mic connected, audioContext state:", audioContext?.state);
      addTranscriptEntry("system", "Microphone connected");
    } catch (micErr) {
      console.warn("[CRUMBLE] Mic denied:", micErr);
      showError("Mic denied — AI will critique but you can't interrupt");
      addTranscriptEntry("error", "Microphone denied — listen-only mode");
    }

    setStatus("connecting", "Connecting to Gemini...");
    addTranscriptEntry("system", "Connecting to Gemini Live...");

    console.log("[CRUMBLE] Calling connectToGemini...");
    await connectToGemini(token);
    console.log("[CRUMBLE] connectToGemini resolved");

    isActive = true;
    btnStop.disabled = false;

    console.log("[CRUMBLE] Starting video frame loop");
    sendVideoFrames();
  } catch (err) {
    console.error("[CRUMBLE] === START FAILED ===");
    console.error("[CRUMBLE] Error:", err);
    console.error("[CRUMBLE] Error name:", err?.name);
    console.error("[CRUMBLE] Error message:", err?.message);
    console.error("[CRUMBLE] Error stack:", err?.stack);
    try { console.error("[CRUMBLE] Error JSON:", JSON.stringify(err)); } catch {}
    const errMsg = err?.message || err?.reason || String(err);
    setStatus("error", "Failed to start");
    showError(errMsg);
    addTranscriptEntry("error", `Failed: ${errMsg}`);
    btnStart.disabled = false;
    stopSessionTimer();
    showLandingView();
    cleanup();
  }
}

function stopSession() {
  isActive = false;
  cleanup();
  stopSessionTimer();
  setStatus("idle", "Session ended");
  btnStart.disabled = false;
  btnStop.disabled = true;
  showLandingView();
}

function cleanup() {
  if (frameTimer) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
  if (session) {
    try { session.close(); } catch {}
    session = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    screenPreview.srcObject = null;
  }
  if (audioRecorderWorklet) {
    audioRecorderWorklet.disconnect();
    audioRecorderWorklet = null;
  }
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  stopPlayback();
}

// --- Event Listeners ---
btnStart.addEventListener("click", startSession);
btnStop.addEventListener("click", stopSession);
btnDismissError.addEventListener("click", () => {
  errorBar.hidden = true;
});
