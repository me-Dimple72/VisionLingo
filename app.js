/* ==========================================================================
   LensWord — point your camera at anything, learn the word for it.
   Modeled after the real "Lingo lens" iOS app (ARKit + Vision/CoreML +
   Apple Translation), rebuilt for the free open web:
     - COCO-SSD (TensorFlow.js)  -> live bounding boxes
     - MobileNet  (TensorFlow.js) -> ImageNet-1000 vocabulary, classified
       on tap — this is what gives labels like "space heater" that aren't
       in COCO's 80 classes.
     - Web Speech API -> pronunciation
     - MyMemory API   -> translation (no download/language-pack step needed,
       unlike the on-device Apple Translation framework)
     - localStorage    -> saved words AND pinned on-screen labels
========================================================================== */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  lang: localStorage.getItem("lensword_lang") || "es",
  sensitivity: parseFloat(localStorage.getItem("lensword_sensitivity") || "0.5"),
  words: JSON.parse(localStorage.getItem("lensword_words") || "[]"),
  translationCache: JSON.parse(localStorage.getItem("lensword_cache") || "{}"),
  labelScale: parseFloat(localStorage.getItem("lensword_label_scale") || "1"),
  cocoModel: null,
  clsModel: null,
  facingMode: "environment",
  stream: null,
  detections: [],
  anchors: [],           // pinned on-screen labels: {id, x, y, en, translated, langFlag}
  selected: null,
  detecting: false,
  lastDetectAt: 0,
  classifying: false,
  traySearchQuery: "",
  trayFilterLang: null,  // null = all languages
  traySortBy: "date",    // date | en | translated
  traySortOrder: "desc", // asc | desc
  autoSpeak: localStorage.getItem("lensword_autospeak") !== "off", // on by default
  autoBusy: false,
  lastAnnouncedLabel: null,
};

const els = {
  onboard: document.getElementById("onboard"),
  onboardSlides: document.getElementById("onboardSlides"),
  obDots: document.getElementById("obDots"),
  obStart: document.getElementById("obStart"),
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  cameraStage: document.querySelector(".camera-stage"),
  scanStatusText: document.getElementById("scanStatusText"),
  cameraError: document.getElementById("cameraError"),
  cameraErrorMsg: document.getElementById("cameraErrorMsg"),
  retryCamera: document.getElementById("retryCamera"),
  camFlip: document.getElementById("camFlip"),
  labelSettingsBtn: document.getElementById("labelSettingsBtn"),
  anchorsLayer: document.getElementById("anchorsLayer"),
  autoPillLayer: document.getElementById("autoPillLayer"),
  autoSpeakSeg: document.getElementById("autoSpeakSeg"),
  anchorFab: document.getElementById("anchorFab"),
  wordCard: document.getElementById("wordCard"),
  wcEnglish: document.getElementById("wcEnglish"),
  wcTranslated: document.getElementById("wcTranslated"),
  wcPhonetic: document.getElementById("wcPhonetic"),
  wcSpeak: document.getElementById("wcSpeak"),
  wcSave: document.getElementById("wcSave"),
  wcAnchor: document.getElementById("wcAnchor"),
  wcClose: document.getElementById("wcClose"),
  catchToast: document.getElementById("catchToast"),
  infoBtn: document.getElementById("infoBtn"),
  infoBackdrop: document.getElementById("infoBackdrop"),
  langPill: document.getElementById("langPill"),
  langFlag: document.getElementById("langFlag"),
  langLabel: document.getElementById("langLabel"),
  navBadge: document.getElementById("navBadge"),
  trayGrid: document.getElementById("trayGrid"),
  trayEmpty: document.getElementById("trayEmpty"),
  traySub: document.getElementById("traySub"),
  traySearch: document.getElementById("traySearch"),
  traySortBtn: document.getElementById("traySortBtn"),
  trayFilterBtn: document.getElementById("trayFilterBtn"),
  sortBackdrop: document.getElementById("sortBackdrop"),
  sortBySeg: document.getElementById("sortBySeg"),
  sortOrderSeg: document.getElementById("sortOrderSeg"),
  filterBackdrop: document.getElementById("filterBackdrop"),
  filterGrid: document.getElementById("filterGrid"),
  langGrid: document.getElementById("langGrid"),
  langGridSheet: document.getElementById("langGridSheet"),
  sheetBackdrop: document.getElementById("sheetBackdrop"),
  labelSettingsBackdrop: document.getElementById("labelSettingsBackdrop"),
  labelSizeSlider: document.getElementById("labelSizeSlider"),
  clearAnchors: document.getElementById("clearAnchors"),
  sensitivitySeg: document.getElementById("sensitivitySeg"),
  clearWords: document.getElementById("clearWords"),
};

const ctx = els.overlay.getContext("2d");
const cropCanvas = document.createElement("canvas");

function currentLanguage() {
  return LANGUAGES.find(l => l.code === state.lang) || LANGUAGES[0];
}
function persist() {
  localStorage.setItem("lensword_lang", state.lang);
  localStorage.setItem("lensword_sensitivity", String(state.sensitivity));
  localStorage.setItem("lensword_words", JSON.stringify(state.words));
  localStorage.setItem("lensword_cache", JSON.stringify(state.translationCache));
  localStorage.setItem("lensword_label_scale", String(state.labelScale));
  localStorage.setItem("lensword_autospeak", state.autoSpeak ? "on" : "off");
}

// ---------------------------------------------------------------------------
// Onboarding (first launch only, 4 slides — mirrors the reference app)
// ---------------------------------------------------------------------------
let obIndex = 0;
function initOnboarding() {
  const slides = els.onboardSlides.querySelectorAll(".onboard-slide");
  slides.forEach((s, i) => {
    els.obDots.appendChild(Object.assign(document.createElement("span"), { className: i === 0 ? "active" : "" }));
  });
  const dots = els.obDots.querySelectorAll("span");

  function render() {
    slides.forEach((s, i) => s.classList.toggle("active", i === obIndex));
    dots.forEach((d, i) => d.classList.toggle("active", i === obIndex));
    els.obStart.textContent = obIndex === slides.length - 1 ? "Start Learning" : "Next";
  }
  els.obStart.addEventListener("click", () => {
    if (obIndex < slides.length - 1) { obIndex++; render(); }
    else finishOnboarding();
  });
  render();

  if (!localStorage.getItem("lensword_onboarded")) {
    els.onboard.classList.remove("hidden");
  }
}
function finishOnboarding() {
  localStorage.setItem("lensword_onboarded", "1");
  els.onboard.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Language UI
// ---------------------------------------------------------------------------
function renderLangUI() {
  const lang = currentLanguage();
  els.langFlag.textContent = lang.flag;
  els.langLabel.textContent = lang.name;

  const buildGrid = (container, onPick) => {
    container.innerHTML = "";
    LANGUAGES.forEach(l => {
      const btn = document.createElement("button");
      btn.className = "lang-chip" + (l.code === state.lang ? " active" : "");
      btn.innerHTML = `<span class="flag">${l.flag}</span><span>${l.name}</span>`;
      btn.addEventListener("click", () => onPick(l));
      container.appendChild(btn);
    });
  };
  const pickLang = (l) => {
    state.lang = l.code;
    persist();
    renderLangUI();
    renderTray();
    els.sheetBackdrop.classList.add("hidden");
  };
  buildGrid(els.langGrid, pickLang);
  buildGrid(els.langGridSheet, pickLang);
}
els.langPill.addEventListener("click", () => els.sheetBackdrop.classList.remove("hidden"));
els.sheetBackdrop.addEventListener("click", (e) => { if (e.target === els.sheetBackdrop) els.sheetBackdrop.classList.add("hidden"); });

// Info / instructions sheet
els.infoBtn.addEventListener("click", () => els.infoBackdrop.classList.remove("hidden"));
els.infoBackdrop.addEventListener("click", (e) => { if (e.target === els.infoBackdrop) els.infoBackdrop.classList.add("hidden"); });

// Label settings sheet (size slider + clear all pinned labels)
els.labelSettingsBtn.addEventListener("click", () => {
  els.labelSizeSlider.value = state.labelScale;
  els.labelSettingsBackdrop.classList.remove("hidden");
});
els.labelSettingsBackdrop.addEventListener("click", (e) => { if (e.target === els.labelSettingsBackdrop) els.labelSettingsBackdrop.classList.add("hidden"); });
els.labelSizeSlider.addEventListener("input", () => {
  state.labelScale = parseFloat(els.labelSizeSlider.value);
  els.anchorsLayer.style.setProperty("--label-scale", state.labelScale);
  persist();
});
els.clearAnchors.addEventListener("click", () => {
  state.anchors = [];
  renderAnchors();
  els.labelSettingsBackdrop.classList.add("hidden");
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v => v.removeAttribute("data-active"));
    document.getElementById("view-" + target).setAttribute("data-active", "true");
    if (target === "tray") renderTray();
  });
});

// ---------------------------------------------------------------------------
// Camera setup (back camera by default, flippable to front)
// ---------------------------------------------------------------------------
async function startCamera() {
  els.cameraError.classList.add("hidden");
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    els.video.srcObject = stream;
    els.video.style.transform = state.facingMode === "user" ? "scaleX(-1)" : "none";
    await new Promise(res => { els.video.onloadedmetadata = res; });
    els.video.play();
    resizeCanvas();

    // Watchdog: a stream can resolve successfully but still deliver zero
    // real frames if the OS itself is blocking the camera (common on
    // macOS when the browser has in-page permission but System Settings
    // → Privacy & Security → Camera is off for that browser). This is
    // silent — no JS error is thrown — so we detect it by checking for
    // real video dimensions after giving it a moment to start.
    setTimeout(() => {
      if (els.video.videoWidth === 0) {
        els.cameraErrorMsg.innerHTML =
          `Your browser granted camera access, but no picture is coming through — this almost always means your <b>operating system</b> is blocking the camera for this browser (separate from the website permission).<br><br>
          <b>On macOS:</b> System Settings → Privacy &amp; Security → Camera → turn on the toggle for your browser (Chrome/Safari/etc), then fully quit and reopen the browser.<br>
          <b>On Windows:</b> Settings → Privacy &amp; Security → Camera → allow desktop apps to access your camera.<br><br>
          Also try <code>camera-test.html</code> from this project on its own — if it also shows a black frame, this confirms it's an OS setting, not this app.`;
        els.cameraError.classList.remove("hidden");
      }
    }, 2500);

    if (!state.cocoModel || !state.clsModel) loadModels();
    else requestAnimationFrame(detectLoop);
  } catch (err) {
    console.error("Camera error:", err);
    els.cameraErrorMsg.textContent =
      err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
        : "Couldn't access a camera on this device. Make sure it isn't in use by another app.";
    els.cameraError.classList.remove("hidden");
    els.scanStatusText.textContent = "Camera unavailable";
  }
}
els.retryCamera.addEventListener("click", startCamera);
els.camFlip.addEventListener("click", () => {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  startCamera();
});
window.addEventListener("resize", resizeCanvas);

function resizeCanvas() {
  const rect = els.cameraStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.overlay.width = rect.width * dpr;
  els.overlay.height = rect.height * dpr;
  els.overlay.style.width = rect.width + "px";
  els.overlay.style.height = rect.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
async function loadModels() {
  try {
    els.scanStatusText.textContent = "Loading detector…";

    // If the TensorFlow.js CDN scripts didn't load (blocked by an
    // ad-blocker, corporate firewall, or no internet), `cocoSsd` and
    // `mobilenet` won't exist as globals — fail fast with a clear message
    // instead of hanging on a spinner forever.
    if (typeof cocoSsd === "undefined" || typeof mobilenet === "undefined" || typeof tf === "undefined") {
      throw new Error("CDN_BLOCKED");
    }

    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT:" + label)), ms)),
    ]);

    state.cocoModel = state.cocoModel || await withTimeout(cocoSsd.load({ base: "lite_mobilenet_v2" }), 20000, "coco-ssd");
    els.scanStatusText.textContent = "Loading 1,000-word vocabulary…";
    state.clsModel = state.clsModel || await withTimeout(mobilenet.load({ version: 2, alpha: 1.0 }), 20000, "mobilenet");
    els.scanStatusText.textContent = "Scanning…";
    requestAnimationFrame(detectLoop);
    startAutoAnnounceLoop();
  } catch (err) {
    console.error("Model load error:", err);
    const isCdnIssue = err.message === "CDN_BLOCKED" || (err.message || "").startsWith("TIMEOUT");
    els.scanStatusText.textContent = isCdnIssue ? "Detector blocked — see below" : "Detector failed to load";
    if (isCdnIssue) {
      els.cameraErrorMsg.innerHTML =
        `The AI detection models couldn't load from the CDN (jsdelivr.net). This is usually caused by an <b>ad-blocker</b>, <b>corporate/school firewall</b>, or <b>no internet connection</b> — not a bug in the app itself.<br><br>
        Try: disabling any ad-blocker/privacy extension for this page, checking your internet connection, or opening this page in an incognito/private window.<br><br>
        You can verify the camera itself works independently by opening <code>camera-test.html</code> from this project.`;
      els.cameraError.classList.remove("hidden");
    }
  }
}

// ---------------------------------------------------------------------------
// Live detection loop — cheap coco-ssd boxes for the overlay.
// ---------------------------------------------------------------------------
async function detectLoop(ts) {
  if (!state.detecting && state.cocoModel && els.video.readyState >= 2) {
    if (ts - state.lastDetectAt > 200) {
      state.lastDetectAt = ts;
      state.detecting = true;
      try {
        const preds = await state.cocoModel.detect(els.video, 8);
        mapDetections(preds);
        drawDetections();
      } catch (e) { /* transient — skip this frame */ }
      state.detecting = false;
    }
  }
  requestAnimationFrame(detectLoop);
}

function mapDetections(preds) {
  const videoW = els.video.videoWidth, videoH = els.video.videoHeight;
  const rect = els.cameraStage.getBoundingClientRect();
  const displayW = rect.width, displayH = rect.height;
  if (!videoW || !videoH) { state.detections = []; return; }

  const scale = Math.max(displayW / videoW, displayH / videoH);
  const offsetX = (videoW * scale - displayW) / 2;
  const offsetY = (videoH * scale - displayH) / 2;

  state.detections = preds
    .filter(p => p.score >= state.sensitivity)
    .map(p => {
      const [x, y, w, h] = p.bbox;
      return {
        coarseLabel: p.class, score: p.score,
        x: x * scale - offsetX, y: y * scale - offsetY, w: w * scale, h: h * scale,
        videoBox: { x, y, w, h },
      };
    });
}

function drawDetections() {
  const rect = els.cameraStage.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  els.cameraStage.querySelectorAll(".box-label").forEach(n => n.remove());

  state.detections.forEach((d) => {
    const isSelected = state.selected && Math.abs(state.selected.x - d.x) < 20 && Math.abs(state.selected.y - d.y) < 20;
    ctx.strokeStyle = isSelected ? "#FFB454" : "#4FD8E8";
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, d.x, d.y, d.w, d.h, 12);
    ctx.stroke();

    const chip = document.createElement("div");
    chip.className = "box-label";
    chip.textContent = "tap to identify";
    chip.style.left = Math.max(4, d.x) + "px";
    chip.style.top = Math.max(4, d.y - 22) + "px";
    if (isSelected) chip.style.background = "#FFB454";
    els.cameraStage.appendChild(chip);
  });
}

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------------------------------------------------------------------
// Auto-speak on sight — automatically identifies and pronounces whatever's
// centered in the camera view every few seconds, no tap required. Classifies
// the center crop directly (independent of coco-ssd's 80 classes) so it
// works for literally anything the 1,000-class vocabulary recognizes.
// ---------------------------------------------------------------------------
let autoAnnounceTimer = null;
function startAutoAnnounceLoop() {
  clearInterval(autoAnnounceTimer);
  autoAnnounceTimer = setInterval(runAutoAnnounce, 2800);
}

async function runAutoAnnounce() {
  if (!state.autoSpeak || state.autoBusy || state.classifying) return;
  if (!state.clsModel || els.video.readyState < 2) return;
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;

  state.autoBusy = true;
  try {
    // classify a generous center crop — works regardless of whether
    // coco-ssd drew a box, so nothing is limited to its 80 classes
    const size = Math.min(vw, vh) * 0.65;
    const sx = (vw - size) / 2, sy = (vh - size) / 2;
    cropCanvas.width = 224; cropCanvas.height = 224;
    const cctx = cropCanvas.getContext("2d");
    cctx.drawImage(els.video, sx, sy, size, size, 0, 0, 224, 224);

    const results = await state.clsModel.classify(cropCanvas, 1);
    const top = results[0];
    if (top && top.probability > 0.3 && top.className !== state.lastAnnouncedLabel) {
      state.lastAnnouncedLabel = top.className;
      const firstTerm = top.className.split(",")[0].trim();
      const translated = await translateWord(firstTerm, state.lang);
      speak(translated, currentLanguage().speech);
      showAutoPill(translated);
    }
  } catch (err) {
    console.error("Auto-announce error:", err);
  }
  state.autoBusy = false;
}

function showAutoPill(translatedText) {
  const lang = currentLanguage();
  const pill = document.createElement("div");
  pill.className = "auto-pill";
  pill.innerHTML = `<span>${lang.flag}</span><span>${translatedText}</span>`;
  els.autoPillLayer.innerHTML = "";
  els.autoPillLayer.appendChild(pill);
  setTimeout(() => pill.remove(), 2900);
}

els.autoSpeakSeg.querySelectorAll("button").forEach(btn => {
  btn.classList.toggle("active", (btn.dataset.val === "on") === state.autoSpeak);
  btn.addEventListener("click", () => {
    els.autoSpeakSeg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.autoSpeak = btn.dataset.val === "on";
    state.lastAnnouncedLabel = null; // allow immediate re-announce when turned back on
    persist();
  });
});

// ---------------------------------------------------------------------------
// Tap to identify — on a box, or anywhere on the frame.
// ---------------------------------------------------------------------------
els.cameraStage.addEventListener("click", (e) => {
  if (state.classifying) return;
  if (e.target.closest(".anchor-pill")) return; // handled by its own listener
  const rect = els.cameraStage.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;

  const hit = state.detections.find(d => px >= d.x && px <= d.x + d.w && py >= d.y && py <= d.y + d.h);
  if (hit) {
    state.selected = hit;
    drawDetections();
    identifyFromVideoBox(hit.videoBox, { x: hit.x + hit.w / 2, y: hit.y });
  } else {
    const videoBox = screenPointToVideoCrop(px, py, rect);
    state.selected = { x: px - 70, y: py - 70, w: 140, h: 140 };
    drawDetections();
    identifyFromVideoBox(videoBox, { x: px, y: py - 70 });
  }
});

function screenPointToVideoCrop(px, py, rect) {
  const videoW = els.video.videoWidth, videoH = els.video.videoHeight;
  const displayW = rect.width, displayH = rect.height;
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const offsetX = (videoW * scale - displayW) / 2;
  const offsetY = (videoH * scale - displayH) / 2;
  const vx = (px + offsetX) / scale;
  const vy = (py + offsetY) / scale;
  const size = Math.min(videoW, videoH) * 0.45;
  return {
    x: Math.max(0, vx - size / 2), y: Math.max(0, vy - size / 2),
    w: Math.min(size, videoW), h: Math.min(size, videoH),
  };
}

async function identifyFromVideoBox(videoBox, anchorPoint) {
  openWordCardLoading();
  state.classifying = true;
  els.wordCard.dataset.anchorX = anchorPoint.x;
  els.wordCard.dataset.anchorY = anchorPoint.y;
  try {
    const padX = videoBox.w * 0.15, padY = videoBox.h * 0.15;
    const sx = Math.max(0, videoBox.x - padX);
    const sy = Math.max(0, videoBox.y - padY);
    const sw = Math.min(els.video.videoWidth - sx, videoBox.w + padX * 2);
    const sh = Math.min(els.video.videoHeight - sy, videoBox.h + padY * 2);

    cropCanvas.width = 224; cropCanvas.height = 224;
    const cctx = cropCanvas.getContext("2d");
    cctx.drawImage(els.video, sx, sy, sw, sh, 0, 0, 224, 224);

    const results = await state.clsModel.classify(cropCanvas, 3);
    const top = results[0];
    const fullLabel = top ? top.className : "object";
    const firstTerm = fullLabel.split(",")[0].trim();
    await fillWordCard(fullLabel, firstTerm);
  } catch (err) {
    console.error("Classification error:", err);
    await fillWordCard("object", "object");
  }
  state.classifying = false;
}

// ---------------------------------------------------------------------------
// Word card: translate + speak + save + pin
// ---------------------------------------------------------------------------
function openWordCardLoading() {
  els.wordCard.classList.remove("hidden");
  els.wcEnglish.textContent = "identifying…";
  els.wcTranslated.innerHTML = `<span class="wc-word">…</span>`;
  els.wcPhonetic.textContent = "Looking at 1,000 possible objects…";
  els.wcSave.classList.remove("saved");
  els.wcSave.innerHTML = `<span class="ic">＋</span> Save word`;
  els.wcAnchor.classList.remove("pinned");
  els.wcAnchor.innerHTML = `<span class="ic">📌</span> Pin label on screen`;
}

async function fillWordCard(displayLabel, translateTerm) {
  els.wcEnglish.textContent = displayLabel;
  els.wcPhonetic.textContent = "Translating…";

  const translated = await translateWord(translateTerm, state.lang);
  els.wcTranslated.innerHTML = `<span class="wc-word">${translated}</span>`;
  const lang = currentLanguage();
  els.wcPhonetic.textContent = `${lang.flag} ${lang.name} · tap "Hear it" for native pronunciation`;

  els.wordCard.dataset.en = displayLabel;
  els.wordCard.dataset.translated = translated;

  const already = state.words.some(w => w.en === displayLabel && w.lang === state.lang);
  if (already) {
    els.wcSave.classList.add("saved");
    els.wcSave.innerHTML = `<span class="ic">✓</span> Saved`;
  }
}

// Reopen the card from a pinned anchor, without reclassifying
function fillWordCardFromAnchor(anchor) {
  els.wordCard.classList.remove("hidden");
  els.wcEnglish.textContent = anchor.en;
  els.wcTranslated.innerHTML = `<span class="wc-word">${anchor.translated}</span>`;
  const lang = LANGUAGES.find(l => l.code === anchor.lang) || currentLanguage();
  els.wcPhonetic.textContent = `${lang.flag} ${lang.name} · tap "Hear it" for native pronunciation`;
  els.wordCard.dataset.en = anchor.en;
  els.wordCard.dataset.translated = anchor.translated;
  els.wordCard.dataset.anchorId = anchor.id;

  const already = state.words.some(w => w.en === anchor.en && w.lang === anchor.lang);
  els.wcSave.classList.toggle("saved", already);
  els.wcSave.innerHTML = already ? `<span class="ic">✓</span> Saved` : `<span class="ic">＋</span> Save word`;
  els.wcAnchor.classList.add("pinned");
  els.wcAnchor.innerHTML = `<span class="ic">📌</span> Pinned`;
}

els.wcClose.addEventListener("click", () => {
  els.wordCard.classList.add("hidden");
  delete els.wordCard.dataset.anchorId;
  state.selected = null;
  drawDetections();
});

// Long-press anywhere on the word card to delete the saved word (if any)
let longPressTimer = null;
function startLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    const en = els.wordCard.dataset.en;
    const before = state.words.length;
    state.words = state.words.filter(w => !(w.en === en && w.lang === state.lang));
    if (state.words.length !== before) {
      persist();
      updateBadge();
      els.wcSave.classList.remove("saved");
      els.wcSave.innerHTML = `<span class="ic">＋</span> Save word`;
      showCatchToast("Removed from your words");
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, 550);
}
function cancelLongPress() { clearTimeout(longPressTimer); }
["pointerdown"].forEach(ev => els.wordCard.addEventListener(ev, startLongPress));
["pointerup", "pointerleave", "pointercancel"].forEach(ev => els.wordCard.addEventListener(ev, cancelLongPress));

els.wcSpeak.addEventListener("click", () => {
  const text = els.wordCard.dataset.translated;
  if (!text) return;
  speak(text, currentLanguage().speech);
});

els.wcSave.addEventListener("click", () => {
  const en = els.wordCard.dataset.en;
  const translated = els.wordCard.dataset.translated;
  if (!en || !translated) return;
  const exists = state.words.some(w => w.en === en && w.lang === state.lang);
  if (exists) return;
  const lang = currentLanguage();
  state.words.unshift({ en, translated, lang: state.lang, langName: lang.name, flag: lang.flag, date: Date.now() });
  persist();
  els.wcSave.classList.add("saved");
  els.wcSave.innerHTML = `<span class="ic">✓</span> Saved`;
  showCatchToast("Saved to your tray");
  updateBadge();
});

// Pin (anchor) the current word as a persistent green label on the camera view
els.wcAnchor.addEventListener("click", () => {
  const en = els.wordCard.dataset.en;
  const translated = els.wordCard.dataset.translated;
  if (!en || !translated) return;
  const x = parseFloat(els.wordCard.dataset.anchorX) || els.cameraStage.clientWidth / 2;
  const y = parseFloat(els.wordCard.dataset.anchorY) || els.cameraStage.clientHeight / 2;
  const lang = currentLanguage();
  state.anchors.push({
    id: "a" + Date.now() + Math.random().toString(36).slice(2, 6),
    x, y, en, translated, lang: state.lang, langFlag: lang.flag,
  });
  renderAnchors();
  els.wcAnchor.classList.add("pinned");
  els.wcAnchor.innerHTML = `<span class="ic">📌</span> Pinned`;
  showCatchToast("Label pinned to screen");
});

function showCatchToast(message) {
  if (message) els.catchToast.textContent = message;
  els.catchToast.classList.remove("hidden");
  clearTimeout(showCatchToast._t);
  showCatchToast._t = setTimeout(() => {
    els.catchToast.classList.add("hidden");
    els.catchToast.textContent = "Saved to your tray";
  }, 2000);
}

function speak(text, langCode) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = langCode;
  utt.rate = 0.9;
  window.speechSynthesis.speak(utt);
}

// ---------------------------------------------------------------------------
// Pinned anchor labels (persistent green pills on the camera view)
// ---------------------------------------------------------------------------
function renderAnchors() {
  els.anchorsLayer.innerHTML = "";
  els.anchorsLayer.style.setProperty("--label-scale", state.labelScale);
  state.anchors.forEach(a => {
    const pill = document.createElement("div");
    pill.className = "anchor-pill";
    pill.style.left = a.x + "px";
    pill.style.top = a.y + "px";
    pill.textContent = `${a.langFlag} ${a.translated}`;

    let lp = null;
    pill.addEventListener("pointerdown", () => {
      lp = setTimeout(() => {
        state.anchors = state.anchors.filter(x => x.id !== a.id);
        renderAnchors();
        if (navigator.vibrate) navigator.vibrate(30);
        showCatchToast("Label removed");
      }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev =>
      pill.addEventListener(ev, () => clearTimeout(lp)));
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      fillWordCardFromAnchor(a);
    });
    els.anchorsLayer.appendChild(pill);
  });
}

// ---------------------------------------------------------------------------
// Translation (MyMemory free API, cached in localStorage)
// ---------------------------------------------------------------------------
async function translateWord(word, langCode) {
  const lang = LANGUAGES.find(l => l.code === langCode);
  const cacheKey = `${word}_${langCode}`;
  if (state.translationCache[cacheKey]) return state.translationCache[cacheKey];
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|${lang.translate}`;
    const res = await fetch(url);
    const data = await res.json();
    let translated = (data?.responseData?.translatedText || word).trim();
    state.translationCache[cacheKey] = translated;
    persist();
    return translated;
  } catch (err) {
    console.error("Translation error:", err);
    return word;
  }
}

// ---------------------------------------------------------------------------
// Tray (flashcards) — with search, language filter, sort
// ---------------------------------------------------------------------------
function updateBadge() {
  const n = state.words.length;
  els.navBadge.textContent = n > 99 ? "99+" : n;
  els.navBadge.classList.toggle("hidden", n === 0);
}

function getFilteredSortedWords() {
  let list = state.words.slice();
  if (state.trayFilterLang) list = list.filter(w => w.lang === state.trayFilterLang);
  if (state.traySearchQuery) {
    const q = state.traySearchQuery.toLowerCase();
    list = list.filter(w => w.en.toLowerCase().includes(q) || w.translated.toLowerCase().includes(q));
  }
  const dir = state.traySortOrder === "asc" ? 1 : -1;
  list.sort((a, b) => {
    if (state.traySortBy === "date") return (a.date - b.date) * dir;
    if (state.traySortBy === "en") return a.en.localeCompare(b.en) * dir;
    return a.translated.localeCompare(b.translated) * dir;
  });
  return list;
}

function renderTray() {
  const list = getFilteredSortedWords();
  els.traySub.textContent = `${state.words.length} word${state.words.length === 1 ? "" : "s"} captured`;
  els.trayEmpty.classList.toggle("hidden", state.words.length > 0);
  els.trayGrid.innerHTML = "";

  list.forEach((w) => {
    const idx = state.words.indexOf(w);
    const card = document.createElement("div");
    card.className = "flashcard";
    card.innerHTML = `
      <div class="fc-front">
        <div class="fc-word">${w.translated}</div>
        <div class="fc-en">${w.en}</div>
      </div>
      <div class="fc-back">
        <div class="fc-word">${w.en}</div>
        <div class="fc-en">${w.translated}</div>
      </div>
      <div class="fc-foot">
        <span class="fc-flag">${w.flag}</span>
        <div class="fc-row-btns">
          <button class="fc-icon-btn fc-speak" title="Hear it">▶</button>
          <button class="fc-icon-btn danger fc-delete" title="Delete">✕</button>
        </div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".fc-icon-btn")) return;
      card.classList.toggle("flipped");
    });
    card.querySelector(".fc-speak").addEventListener("click", (e) => {
      e.stopPropagation();
      const lang = LANGUAGES.find(l => l.code === w.lang);
      speak(w.translated, lang ? lang.speech : "en-US");
    });
    card.querySelector(".fc-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      state.words.splice(idx, 1);
      persist();
      updateBadge();
      renderTray();
    });
    els.trayGrid.appendChild(card);
  });
}

els.traySearch.addEventListener("input", () => {
  state.traySearchQuery = els.traySearch.value;
  renderTray();
});

els.trayFilterBtn.addEventListener("click", () => {
  els.filterGrid.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.className = "lang-chip" + (state.trayFilterLang === null ? " active" : "");
  allBtn.innerHTML = `<span class="flag">🌐</span><span>All Languages</span>`;
  allBtn.addEventListener("click", () => { state.trayFilterLang = null; renderTray(); els.filterBackdrop.classList.add("hidden"); });
  els.filterGrid.appendChild(allBtn);
  LANGUAGES.forEach(l => {
    const btn = document.createElement("button");
    btn.className = "lang-chip" + (state.trayFilterLang === l.code ? " active" : "");
    btn.innerHTML = `<span class="flag">${l.flag}</span><span>${l.name}</span>`;
    btn.addEventListener("click", () => { state.trayFilterLang = l.code; renderTray(); els.filterBackdrop.classList.add("hidden"); });
    els.filterGrid.appendChild(btn);
  });
  els.filterBackdrop.classList.remove("hidden");
});
els.filterBackdrop.addEventListener("click", (e) => { if (e.target === els.filterBackdrop) els.filterBackdrop.classList.add("hidden"); });

els.traySortBtn.addEventListener("click", () => els.sortBackdrop.classList.remove("hidden"));
els.sortBackdrop.addEventListener("click", (e) => { if (e.target === els.sortBackdrop) els.sortBackdrop.classList.add("hidden"); });
els.sortBySeg.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", () => {
    els.sortBySeg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.traySortBy = btn.dataset.val;
    renderTray();
  });
});
els.sortOrderSeg.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", () => {
    els.sortOrderSeg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.traySortOrder = btn.dataset.val;
    renderTray();
  });
});

els.clearWords.addEventListener("click", () => {
  if (state.words.length === 0) return;
  if (confirm("Delete all saved words? This can't be undone.")) {
    state.words = [];
    persist();
    updateBadge();
    renderTray();
  }
});

// ---------------------------------------------------------------------------
// Settings: sensitivity segmented control
// ---------------------------------------------------------------------------
els.sensitivitySeg.querySelectorAll("button").forEach(btn => {
  if (parseFloat(btn.dataset.val) === state.sensitivity) btn.classList.add("active");
  btn.addEventListener("click", () => {
    els.sensitivitySeg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.sensitivity = parseFloat(btn.dataset.val);
    persist();
  });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
renderLangUI();
updateBadge();
initOnboarding();
startCamera();