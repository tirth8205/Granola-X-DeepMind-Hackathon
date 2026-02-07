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

// --- Persistence ---
const STORAGE_KEY = "crumble_sessions";
let currentSessionRecord = null;
let viewingSessionId = null;

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function saveCurrentSession() {
  if (!currentSessionRecord || currentSessionRecord.entries.length === 0) return;
  currentSessionRecord.endTime = Date.now();
  currentSessionRecord.duration = getElapsedTime();
  const sessions = loadSessions();
  sessions.unshift(currentSessionRecord);
  saveSessions(sessions);
  currentSessionRecord = null;
}

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
const historySidebar = document.getElementById("history-sidebar");
const historyList = document.getElementById("history-list");
const btnClearHistory = document.getElementById("btn-clear-history");
const archiveView = document.getElementById("archive-view");
const archiveTitle = document.getElementById("archive-title");
const archiveStats = document.getElementById("archive-stats");
const archiveSummary = document.getElementById("archive-summary");
const archiveFindings = document.getElementById("archive-findings");
const archiveLog = document.getElementById("archive-log");
const archiveLogDetails = document.getElementById("archive-log-details");
const btnBackToLanding = document.getElementById("btn-back-to-landing");
const btnExport = document.getElementById("btn-export");
const btnExportArchive = document.getElementById("btn-export-archive");
const btnCopyFindings = document.getElementById("btn-copy-findings");
const btnCopyLive = document.getElementById("btn-copy-live");

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

  if (currentSessionRecord) {
    currentSessionRecord.entries.push({ type, message, time: getElapsedTime() });
  }

  return entry;
}

function addFeedbackEntry(message) {
  const entry = document.createElement("div");
  entry.className = "transcript-entry transcript-feedback";

  entry.innerHTML = `
    <div class="transcript-dot"></div>
    <span class="transcript-time">${getElapsedTime()}</span>
    <span class="transcript-msg">${formatFeedback(message)}</span>
  `;

  transcript.appendChild(entry);
  transcript.scrollTop = transcript.scrollHeight;

  if (currentSessionRecord) {
    currentSessionRecord.entries.push({ type: "feedback", message, time: getElapsedTime() });
  }

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

function formatFeedback(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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
    archiveView.hidden = true;
    sessionEl.hidden = false;
    app.classList.add("session-active");
  }, 350);
}

function showLandingView() {
  app.classList.remove("session-active");
  sessionEl.hidden = true;
  archiveView.hidden = true;
  orbContainer.hidden = false;
  landing.hidden = false;
  landing.classList.remove("fade-out");
  viewingSessionId = null;
  renderHistorySidebar();
}

// --- Status ---
function setStatus(state, text) {
  const keepClasses = [];
  for (const cls of orbContainer.classList) {
    if (!cls.startsWith("state-")) keepClasses.push(cls);
  }
  orbContainer.className = keepClasses.join(" ") + ` state-${state}`;
  statusText.textContent = text;
}

let errorTimeout = null;
function showError(msg) {
  if (!msg) return;
  errorText.textContent = msg;
  errorBar.hidden = false;
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => { errorBar.hidden = true; }, 6000);
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

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
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
const SYSTEM_PROMPT = `You are a world-class UX auditor with 15 years of experience at companies like Apple, Stripe, and Linear. You're sitting beside a colleague watching their product through a live screen share. You receive periodic screenshots — never comment on image quality, blurriness, or compression. That's just the capture.

YOUR MISSION: Deliver a ruthlessly thorough UX audit. The user is paying for your expert eye. Miss nothing. Every pixel matters.

PERSONALITY:
- Warm but direct. Like a trusted mentor, not a checklist robot.
- Start with genuine praise when something works well — "Oh nice, this hero section has real presence. The type scale is doing heavy lifting here."
- When something's off, be honest and specific — "That secondary CTA is fighting for attention with the nav. I'd drop it to 14px or mute the color."
- Use conversational language. Say "feels heavy" not "excessive visual weight." Say "gets lost" not "lacks sufficient contrast ratio."

ON FIRST SEEING A SCREEN:
1. Take a breath. Let it land. Then share your gut reaction — what grabbed you first? Was that the right thing to grab attention?
2. Work top-to-bottom, left-to-right. Don't jump around randomly.
3. Call out 1-2 things that are working well FIRST. Then move into critiques.

WHAT TO AUDIT (be exhaustive):

Visual Hierarchy & Layout:
- Is there a clear focal point? Does the eye flow naturally?
- Are spacing values consistent? Do related elements feel grouped?
- Is there enough whitespace or does it feel cramped?
- Does the grid feel intentional or are things slightly misaligned?

Typography:
- Is the type scale clear? Headings vs body vs captions — do they feel distinct?
- Line lengths — are paragraphs too wide (over ~75 characters) or too narrow?
- Line height — does body text breathe? Is it too tight or too loose?
- Font weights — is there a clear hierarchy between bold, medium, regular?

Color & Contrast:
- Does the color palette feel cohesive or is it pulling in too many directions?
- Text contrast — can you read everything comfortably? WCAG AA requires 4.5:1 for body text, 3:1 for large text.
- Are colors used meaningfully? Do reds mean errors? Do greens confirm success?
- Are interactive elements visually distinct from static content?

Buttons & CTAs:
- Is the primary action on each screen immediately obvious?
- Are button labels action-oriented? "Get Started" beats "Submit". "Download for Mac" beats "Download".
- Do buttons look tappable? Minimum 44x44px touch targets.
- Is there clear visual difference between primary, secondary, and ghost buttons?
- NEVER suggest removing a CTA, download button, pricing link, or signup button. These are revenue-critical. Always suggest how to IMPROVE them instead.

Navigation & Wayfinding:
- Does the user know where they are? Is the current page indicated?
- Can they get back? Is there a clear escape hatch?
- Is the nav structure flat enough? Too many levels = confusion.
- Do links look like links? Are they underlined or otherwise distinct?

Content & Microcopy:
- Are headings descriptive? Could someone scan just headings and understand the page?
- Is the microcopy helpful? Do labels explain what's needed?
- Are error messages human? "Something went wrong" is lazy. "Your email needs an @ symbol" is helpful.
- Is there appropriate empty state / zero state design?

Interaction & Feedback:
- When something is clickable, does it feel clickable?
- Are loading states handled? Or does the UI just freeze?
- Do forms give inline validation or make you wait until submit?
- Are success and error states clearly communicated?

Responsive & Practicality:
- Would this layout survive on a phone? What would break?
- Are images sized appropriately or are they comically large/small?
- Is the content prioritization right for mobile — most important thing first?

GIVING FEEDBACK:
- Be specific: "The 'Download for Mac' button in gray at the bottom of the hero competes with three other links — it doesn't read as the primary CTA. Making it your brand green at 16px bold would fix that instantly."
- Explain why it matters: "A first-time visitor has about 5 seconds to figure out what to do. Right now the eye goes to the illustration first, then the headline, but the CTA gets skipped."
- Suggest a concrete fix: "I'd increase the button size, add more vertical breathing room above it, and consider a subtle shadow to lift it off the background."
- Praise what deserves it: "This card layout is really well done — consistent padding, clear hierarchy in each card, and the hover state is smooth. Ship it."

PACING:
- Give 2-3 observations, then pause for 3-4 seconds to let the user absorb or respond.
- After the pause, continue with the next 2-3 observations.
- When you've covered everything on the current screen, say: "That's everything I'm seeing on this screen. Navigate somewhere else and I'll keep going."
- If the user navigates to a new page, do a full fresh audit of that page.

WHEN THE USER SPEAKS:
- Stop your audit immediately and listen.
- Answer their question directly and specifically.
- If they ask "what do you think about X?" — give your honest take, not a diplomatic non-answer.
- After answering, resume your audit where you left off.

ABSOLUTE RULES:
- NEVER comment on image quality, resolution, or screenshot artifacts
- NEVER suggest removing buttons, CTAs, download links, or conversion elements — always suggest improving them
- NEVER critique code, architecture, or technical implementation
- NEVER repeat feedback you already gave unless the issue got worse
- NEVER give vague feedback like "could be better" or "needs work" — always say specifically WHAT and HOW
- NEVER speak in long unbroken monologues — always pause between observation groups`;

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

    currentSessionRecord = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      endTime: null,
      duration: null,
      entries: [],
    };

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
    saveCurrentSession();
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
  saveCurrentSession();
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

// --- History Sidebar ---
function renderHistorySidebar() {
  const sessions = loadSessions();

  if (sessions.length === 0) {
    historySidebar.hidden = true;
    app.classList.remove("has-history");
    return;
  }

  app.classList.add("has-history");
  historySidebar.hidden = false;

  historyList.innerHTML = sessions.map((s) => {
    const date = new Date(s.startTime);
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const preview = s.entries.find((e) => e.type === "feedback");
    const previewText = preview
      ? preview.message.substring(0, 80) + (preview.message.length > 80 ? "..." : "")
      : "No feedback recorded";

    return `
      <div class="history-item${viewingSessionId === s.id ? " active" : ""}" data-session-id="${s.id}">
        <span class="history-item-date">${escapeHtml(dateStr)}</span>
        <span class="history-item-duration">${s.duration || "Unknown"} duration</span>
        <span class="history-item-preview">${escapeHtml(previewText)}</span>
      </div>
    `;
  }).join("");
}

// --- Archive View ---
function viewPastSession(sessionId) {
  const sessions = loadSessions();
  const s = sessions.find((sess) => sess.id === sessionId);
  if (!s) return;

  viewingSessionId = sessionId;

  landing.hidden = true;
  landing.classList.add("fade-out");
  sessionEl.hidden = true;
  archiveView.hidden = false;
  orbContainer.hidden = true;

  const date = new Date(s.startTime);
  archiveTitle.textContent =
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + ` (${s.duration})`;

  // Stats
  const findings = s.entries.filter((e) => e.type === "feedback");
  const errors = s.entries.filter((e) => e.type === "error");
  archiveStats.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${findings.length}</div>
      <div class="stat-label">Findings</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.duration || "—"}</div>
      <div class="stat-label">Duration</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${errors.length}</div>
      <div class="stat-label">Errors</div>
    </div>
  `;

  // Findings — only feedback entries, numbered
  if (findings.length === 0) {
    archiveFindings.innerHTML = `<div class="archive-empty">No UX findings were recorded in this session.</div>`;
  } else {
    archiveFindings.innerHTML = findings
      .map((entry, i) => `
        <div class="finding-card">
          <span class="finding-number">${i + 1}</span>
          <div class="finding-content">
            <div class="finding-text">${formatFeedback(entry.message)}</div>
            <div class="finding-time">${entry.time}</div>
          </div>
        </div>
      `)
      .join("");
  }

  // System log — collapsed by default
  const logEntries = s.entries.filter((e) => e.type !== "feedback");
  archiveLogDetails.open = false;
  archiveLog.innerHTML = logEntries
    .map((entry) => `
      <div class="log-entry${entry.type === "error" ? " log-entry-error" : ""}">
        [${entry.time}] ${escapeHtml(entry.message)}
      </div>
    `)
    .join("");

  // Summary
  renderSummary(s);

  renderHistorySidebar();
}

function renderSummary(sessionRecord) {
  if (sessionRecord.summary) {
    archiveSummary.innerHTML = `
      <div class="summary-card">
        <div class="summary-card-header">
          <svg class="sparkle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          AI Summary
        </div>
        <div class="summary-body">${parseSummaryToHtml(sessionRecord.summary)}</div>
      </div>`;
  } else {
    const findings = sessionRecord.entries.filter((e) => e.type === "feedback");
    if (findings.length === 0) {
      archiveSummary.innerHTML = "";
      return;
    }
    archiveSummary.innerHTML = `
      <button class="summary-generate" id="btn-generate-summary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Generate AI Summary
      </button>`;
    document.getElementById("btn-generate-summary").addEventListener("click", () => {
      generateSummary(sessionRecord.id);
    });
  }
}

function parseSummaryToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^(?!<)/, "<p>")
    .replace(/(?!>)$/, "</p>")
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<h3>)/g, "$1")
    .replace(/(<\/h3>)<\/p>/g, "$1")
    .replace(/<p>(<ul>)/g, "$1")
    .replace(/(<\/ul>)<\/p>/g, "$1");
}

async function generateSummary(sessionId) {
  const btn = document.getElementById("btn-generate-summary");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      Generating summary...`;
  }

  try {
    const token = await fetchToken();
    const sessions = loadSessions();
    const s = sessions.find((sess) => sess.id === sessionId);
    if (!s) return;

    const transcript = s.entries
      .map((e) => `[${e.time}] [${e.type.toUpperCase()}] ${e.message}`)
      .join("\n");

    const prompt = `You are an expert UX analyst. Below is a complete transcript from a live UX audit session where an AI watched a user's screen and gave real-time feedback.

Analyze the entire transcript and produce a structured summary with these sections:

## Overview
A 2-3 sentence summary of what was reviewed and the overall quality assessment.

## Key Issues (Priority Order)
List the most important UX problems found, from most critical to least. For each:
- What the issue is
- Why it matters
- Suggested fix

## What's Working Well
List the positive aspects that were called out. Be specific.

## Action Items
A concise checklist of concrete next steps the team should take, ordered by impact.

Here is the transcript:

${transcript}`;

    const ai = new GoogleGenAI({ apiKey: token });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    const summaryText = result.text;

    // Save to session record
    const freshSessions = loadSessions();
    const idx = freshSessions.findIndex((sess) => sess.id === sessionId);
    if (idx !== -1) {
      freshSessions[idx].summary = summaryText;
      saveSessions(freshSessions);
    }

    // Re-render with summary
    renderSummary({ ...s, summary: summaryText });
  } catch (err) {
    console.error("[CRUMBLE] Summary generation failed:", err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Retry — ${err.message || "failed"}`;
    }
  }
}

function exitArchiveView() {
  viewingSessionId = null;
  archiveView.hidden = true;
  orbContainer.hidden = false;
  landing.hidden = false;
  landing.classList.remove("fade-out");
  renderHistorySidebar();
}

// --- Export ---
function getFindingsText(sessionData) {
  const findings = sessionData.entries.filter((e) => e.type === "feedback");
  if (findings.length === 0) return "No findings recorded.";
  return findings
    .map((f, i) => `${i + 1}. [${f.time}] ${f.message}`)
    .join("\n\n");
}

function getSessionDateStr(sessionData) {
  return new Date(sessionData.startTime).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function copyFindings(sessionData, labelEl) {
  if (sessionData.entries.length === 0) return;

  let text = `Crumble UX Audit — ${getSessionDateStr(sessionData)} (${sessionData.duration})\n\n`;
  if (sessionData.summary) {
    text += `=== AI SUMMARY ===\n\n${sessionData.summary}\n\n=== FULL LOG ===\n\n`;
  }
  for (const entry of sessionData.entries) {
    if (entry.type === "feedback") {
      text += `[${entry.time}] FEEDBACK: ${entry.message}\n\n`;
    } else if (entry.type === "error") {
      text += `[${entry.time}] ERROR: ${entry.message}\n`;
    } else {
      text += `[${entry.time}] ${entry.message}\n`;
    }
  }

  await navigator.clipboard.writeText(text.trim());
  labelEl.textContent = "Copied!";
  setTimeout(() => { labelEl.textContent = "Copy"; }, 1500);
}

function generateHtmlReport(sessionData) {
  const dateStr = getSessionDateStr(sessionData);
  const findings = sessionData.entries.filter((e) => e.type === "feedback");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UX Audit — ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap');
  body { font-family: 'Inter', sans-serif; background: #faf9f7; color: #1a1a1a; padding: 3rem 2rem; max-width: 720px; margin: 0 auto; font-size: 15px; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .header h1 { font-family: 'Instrument Serif', serif; font-size: 2rem; font-weight: 400; letter-spacing: -0.02em; margin-bottom: 0.3rem; }
  .header .meta { font-size: 0.85rem; color: #666; }
  .header .meta span { margin-right: 1.5rem; }
  .stats { display: flex; gap: 1rem; margin-bottom: 2rem; }
  .stat { flex: 1; background: #fff; border: 1px solid #e5e3df; border-radius: 8px; padding: 0.8rem 1rem; }
  .stat-val { font-size: 1.5rem; font-weight: 700; }
  .stat-lbl { font-size: 0.7rem; color: #999; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.1rem; }
  .finding { display: flex; gap: 0.8rem; padding: 1rem 0; border-bottom: 1px solid #eee; }
  .finding:last-child { border-bottom: none; }
  .finding-num { font-family: 'Courier New', monospace; font-size: 0.75rem; color: #8b5cf6; background: #f3f0ff; padding: 0.15rem 0.5rem; border-radius: 4px; height: fit-content; flex-shrink: 0; font-weight: 600; }
  .finding-body { flex: 1; }
  .finding-body p { font-family: 'Instrument Serif', serif; font-size: 1rem; line-height: 1.7; font-style: italic; }
  .finding-body .time { font-family: 'Courier New', monospace; font-size: 0.7rem; color: #aaa; margin-top: 0.4rem; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e3df; font-size: 0.7rem; color: #bbb; text-align: center; }
  @media print { body { padding: 1rem; } .stats { break-inside: avoid; } }
  @media (max-width: 600px) { body { padding: 1.5rem 1rem; } .stats { flex-direction: column; } }
</style>
</head>
<body>
  <div class="header">
    <h1>UX Audit Report</h1>
    <div class="meta">
      <span>${dateStr}</span>
      <span>Duration: ${sessionData.duration}</span>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${findings.length}</div><div class="stat-lbl">Findings</div></div>
    <div class="stat"><div class="stat-val">${sessionData.duration}</div><div class="stat-lbl">Duration</div></div>
  </div>
  ${sessionData.summary ? `<div style="background:#fff;border:1px solid #e5e3df;border-radius:8px;padding:1.2rem;margin-bottom:2rem;">
    <h2 style="font-family:'Instrument Serif',serif;font-size:1.2rem;font-weight:400;margin-bottom:0.8rem;letter-spacing:-0.01em;">AI Summary</h2>
    <div style="font-size:0.9rem;line-height:1.7;color:#444;">${parseSummaryToHtml(sessionData.summary)}</div>
  </div>` : ""}
  <div class="findings">
    ${sessionData.entries.length === 0 ? '<p style="color:#999;font-style:italic;">No entries recorded.</p>' : sessionData.entries.map((e) => {
      const safe = e.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (e.type === "feedback") {
        return `<div class="finding">
          <span class="finding-num">UX</span>
          <div class="finding-body">
            <p>${safe}</p>
            <div class="time">${e.time}</div>
          </div>
        </div>`;
      } else if (e.type === "error") {
        return `<div class="finding" style="border-left:3px solid #d97b6b;">
          <span class="finding-num" style="background:#fef2f2;color:#d97b6b;">ERR</span>
          <div class="finding-body">
            <p style="font-style:normal;color:#d97b6b;">${safe}</p>
            <div class="time">${e.time}</div>
          </div>
        </div>`;
      } else {
        return `<div class="finding" style="opacity:0.5;">
          <span class="finding-num" style="background:#f5f5f4;color:#999;">SYS</span>
          <div class="finding-body">
            <p style="font-style:normal;font-size:0.8rem;color:#888;">${safe}</p>
            <div class="time">${e.time}</div>
          </div>
        </div>`;
      }
    }).join("")}
  </div>
  <div class="footer">Generated by Crumble — AI UX Critique Tool</div>
</body>
</html>`;
}

function downloadHtmlReport(sessionData) {
  const html = generateHtmlReport(sessionData);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateSlug = new Date(sessionData.startTime).toISOString().split("T")[0];
  a.download = `crumble-audit-${dateSlug}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCurrentSession() {
  if (!currentSessionRecord) return;
  downloadHtmlReport({
    ...currentSessionRecord,
    endTime: Date.now(),
    duration: getElapsedTime(),
  });
}

function exportArchivedSession(sessionId) {
  const sessions = loadSessions();
  const s = sessions.find((sess) => sess.id === sessionId);
  if (!s) return;
  downloadHtmlReport(s);
}

// --- Event Listeners ---
btnStart.addEventListener("click", startSession);
btnStop.addEventListener("click", stopSession);
btnDismissError.addEventListener("click", () => {
  errorBar.hidden = true;
  if (errorTimeout) clearTimeout(errorTimeout);
});

btnExport.addEventListener("click", exportCurrentSession);
btnExportArchive.addEventListener("click", () => {
  if (viewingSessionId) exportArchivedSession(viewingSessionId);
});

btnCopyFindings.addEventListener("click", () => {
  if (!viewingSessionId) return;
  const sessions = loadSessions();
  const s = sessions.find((sess) => sess.id === viewingSessionId);
  if (s) copyFindings(s, document.getElementById("copy-label"));
});

btnCopyLive.addEventListener("click", () => {
  if (!currentSessionRecord) return;
  copyFindings(
    { ...currentSessionRecord, endTime: Date.now(), duration: getElapsedTime() },
    document.getElementById("copy-live-label"),
  );
});

historyList.addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (item) viewPastSession(item.dataset.sessionId);
});

btnBackToLanding.addEventListener("click", exitArchiveView);

btnClearHistory.addEventListener("click", () => {
  if (confirm("Clear all session history?")) {
    localStorage.removeItem(STORAGE_KEY);
    exitArchiveView();
    renderHistorySidebar();
  }
});

// Save on tab close
window.addEventListener("beforeunload", () => {
  if (currentSessionRecord && currentSessionRecord.entries.length > 0) {
    saveCurrentSession();
  }
});

// Initialize
renderHistorySidebar();
