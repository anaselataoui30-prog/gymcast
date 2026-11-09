/* ============================================================
   GYMCAST TV PLAYER — 24/7 hardened build v3
   Fixes applied: C1–C5, H1–H5, R1–R7, plus standby/ytFailCount
   state resets. Verified against 48h continuous-playback profile.
   ============================================================ */
(() => {
"use strict";

/* ---------- 1. GLOBAL ERROR HANDLING ---------- */
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
});
window.addEventListener('error', e => {
  console.error('Global error:', e.error);
});

/* ---------- 2. DOM & constants ---------- */
const LS_CODE = "gymcast_tv_code";
const LS_TOK  = "gymcast_tok";
const LS_RST  = "gymcast_rst";
const LS_DUR  = "gc_dur_";

const POLL_MIN = 60, POLL_MAX = 600, POLL_DEFAULT = 600;
const PROBE_INTERVAL = 60000;
const RETRY_INTERVAL = 10000;
const ALIGN_INTERVAL = 5000;
const BUFFER_BANNER_DELAY = 2500;
const CATCHUP_MAX = 1.5, SLOWDOWN_MIN = 0.9;
const SYNC_DEADZONE = 0.3;
const BOUNDARY_SNAP = 2;
const MIDFIX_DRIFT = 10;
const MIDFIX_BUFFER = 6;
const CATCHUP_BUFFER = 4;
const CLOCK_TRUST = 10000;
const YT_RETRY_DELAY = 1000;
const YT_STANDBY_COOLDOWN = 60000;

const el = {
  activation: document.getElementById("activation"),
  player: document.getElementById("player"),
  pausedBadge: document.getElementById("paused-badge"),
  net: document.getElementById("net-overlay"),
  netTitle: document.getElementById("net-title"),
  netSub: document.getElementById("net-sub"),
  error: document.getElementById("error"),
  digits: Array.from(document.querySelectorAll(".digit")),
  connect: document.getElementById("connectBtn"),
};

/* ---------- 3. App state ---------- */
const S = {
  code: null,
  playlist: [],
  index: 0,
  paused: false,
  idleDelay: POLL_DEFAULT * 1000,
  vol: 100,
  audioUnlocked: false,
  netDown: false,
  buffering: false,
  htmlVid: null,
  ytPlayer: null,
  serverOffset: 0,
  bestRtt: null,
  syncOn: false,
  segStart: [],
  totalDur: 0,
  pendingSeek: null,
  midFixUsed: false,
  pollTimer: null, pollFn: null,
  probeTimer: null, probing: false,
  retryTimer: null,
  downClock: null, downSince: 0,
  bufferTimer: null,
  stallTimer: null,
  imageTimer: null,
  imageEndsAt: 0,
  transitionTimer: null,
  transitioning: false,
  standbyShowing: false,
};

let ytFailCount = 0;
let playlistVersion = 0;
let lastAnimLoad = 0;

/* ---------- 4. Small utils ---------- */
const isYTUrl = (u) => /youtube\.com|youtu\.be/i.test(u);

/* FIX R6: pathname-based check avoids query-string false positives */
const isImageUrl = (u) => {
  try {
    const path = new URL(u, window.location.href).pathname;
    return /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i.test(path);
  } catch (e) {
    return /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i.test(u);
  }
};

const IMAGE_DURATION = 15;
const now = () => Date.now();
const correctedNow = () => now() + S.serverOffset;
const fmtDur = (ms) => {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
function bufferAhead() {
  const v = S.htmlVid;
  try {
    if (v && v.buffered && v.buffered.length) return v.buffered.end(v.buffered.length - 1) - v.currentTime;
  } catch (e) {}
  return 0;
}

/* FIX R3: image items are never "dead media" */
function mediaIsDead() {
  const v = document.getElementById("html-vid");
  if (v) return Boolean(v.error) || v.readyState === 0;
  if (S.playlist.length) {
    const cur = S.playlist[S.index];
    if (cur && isImageUrl(cur.url)) return false;
  }
  return !S.ytPlayer && S.playlist.length > 0;
}

function schedulePoll(delay) {
  clearTimeout(S.pollTimer);
  S.pollTimer = setTimeout(() => { if (S.pollFn) S.pollFn(); }, delay);
}

/* ---------- 5. Network banner UI ---------- */
function showNet(mode, title, sub) {
  el.net.classList.remove("down", "slow", "ok");
  el.net.classList.add(mode);
  el.net.style.display = "flex";
  el.netTitle.textContent = title;
  el.netSub.textContent = sub || "";
}
function hideNet() { el.net.style.display = "none"; }

const ANIM_URLS   = { slow: "/assets/anim/slow.html", offline: "/assets/anim/offline.html" };
const ANIM_TEXTS  = { slow: "CONNEXION AU SYSTÈME...", offline: "PAS DE CONNEXION" };
const ANIM_COLORS = { slow: "#ffb02e", offline: "#ff4d3d" };
const ANIM_CACHE_KEY = "gc_anim_cache";
let animCache = {};
try { animCache = JSON.parse(localStorage.getItem(ANIM_CACHE_KEY) || "{}"); } catch (e) { animCache = {}; }

const netAnim = document.createElement("div");
netAnim.style.cssText = "position:fixed;inset:0;z-index:38;display:none;pointer-events:none;background:#000;";
netAnim.innerHTML =
  '<iframe style="width:100%;height:100%;border:0;display:none;" title="status"></iframe>' +
  '<div class="ma-fb" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:22px;text-align:center;font-family:system-ui,sans-serif;">' +
    '<div class="ma-logo">MFITNESS&nbsp;<span>GYM</span></div>' +
    '<div class="ma-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
    '<div class="ma-title"></div>' +
    '<div class="ma-sub">RECONNEXION AUTOMATIQUE…</div>' +
  '</div>';
document.body.appendChild(netAnim);
const netAnimFrame = netAnim.querySelector("iframe");
const maFb = netAnim.querySelector(".ma-fb");
const maTitle = netAnim.querySelector(".ma-title");
const maStyle = document.createElement("style");
maStyle.textContent =
  ".ma-logo{font-size:44px;font-weight:900;letter-spacing:6px;color:#e9edf5;}" +
  ".ma-logo span{color:#ffb02e;}" +
  ".ma-bars{display:flex;gap:6px;align-items:flex-end;height:46px;}" +
  ".ma-bars i{width:8px;height:20%;background:#ffb02e;border-radius:3px;animation:mab 1.1s infinite ease-in-out;}" +
  ".ma-bars i:nth-child(2){animation-delay:.12s}.ma-bars i:nth-child(3){animation-delay:.24s}" +
  ".ma-bars i:nth-child(4){animation-delay:.36s}.ma-bars i:nth-child(5){animation-delay:.48s}" +
  ".ma-bars i:nth-child(6){animation-delay:.6s}.ma-bars i:nth-child(7){animation-delay:.72s}" +
  "@keyframes mab{0%,100%{height:18%}50%{height:100%}}" +
  ".ma-title{font-family:monospace;font-size:26px;font-weight:800;letter-spacing:4px;animation:mablink 1.6s infinite;}" +
  "@keyframes mablink{0%,100%{opacity:1}50%{opacity:.35}}" +
  ".ma-sub{font-family:monospace;font-size:12px;letter-spacing:2px;color:#8791a5;}";
document.head.appendChild(maStyle);

function loadAnimCache() {
  if (now() - lastAnimLoad < 60000) return;
  lastAnimLoad = now();
  Object.keys(ANIM_URLS).forEach((kind) => {
    fetch(ANIM_URLS[kind], { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
      .then((html) => {
        if (html && html.indexOf("<") !== -1) {
          animCache[kind] = html;
          try { localStorage.setItem(ANIM_CACHE_KEY, JSON.stringify(animCache)); } catch (e) {}
        }
      })
      .catch(() => {});
  });
}
loadAnimCache();

let animCurrent = "";
function showAnim(kind) {
  netAnim.style.display = "block";
  if (animCurrent === kind) return;
  animCurrent = kind;
  const html = animCache[kind];
  if (html) {
    maFb.style.display = "none";
    netAnimFrame.style.display = "block";
    netAnimFrame.srcdoc = html;
  } else {
    netAnimFrame.style.display = "none";
    netAnimFrame.removeAttribute("srcdoc");
    maFb.style.display = "flex";
    maTitle.textContent = ANIM_TEXTS[kind];
    maTitle.style.color = ANIM_COLORS[kind];
  }
}
function hideAnim() {
  if (netAnim.style.display === "none") return;
  netAnim.style.display = "none";
  netAnimFrame.style.display = "none";
  netAnimFrame.removeAttribute("srcdoc");
  maFb.style.display = "none";
  animCurrent = "";
}
function updateAnim() {
  if (S.netDown) showAnim("offline");
  else if (S.buffering) showAnim("slow");
  else hideAnim();
}

function setNetDown(on, reason) {
  if (on === S.netDown) { if (on && reason) el.netTitle.textContent = reason; return; }
  S.netDown = on;
  clearTimeout(S.retryTimer); S.retryTimer = null;

  if (on) {
    clearTimeout(S.stallTimer); S.stallTimer = null;
    clearTimeout(S.bufferTimer); S.buffering = false;
    S.downSince = now();
    showNet("down", reason || "📡 NO INTERNET — GYMCAST AUTO-RETRY", "the system is fine · waiting for network · 00:00");
    clearInterval(S.downClock);
    S.downClock = setInterval(() => {
      if (S.netDown) el.netSub.textContent = "the system is fine · waiting for network · " + fmtDur(now() - S.downSince);
    }, 1000);
    if (!S.probeTimer) S.probeTimer = setInterval(() => { if (S.netDown) probe(); }, PROBE_INTERVAL);
    updateAnim();
  } else {
    clearInterval(S.downClock); S.downClock = null;
    if (S.probeTimer) { clearInterval(S.probeTimer); S.probeTimer = null; }
    showNet("ok", "✔ BACK ONLINE — RESUMING", "");
    setTimeout(() => { if (!S.netDown && !S.buffering) hideNet(); }, 3000);
    if (!S.paused && !S.transitioning && mediaIsDead()) playCurrent();
    updateAnim();
    loadAnimCache();
  }
}

function setBuffering(on) {
  if (on) {
    if (S.buffering || S.netDown) return;
    clearTimeout(S.bufferTimer);
    S.bufferTimer = setTimeout(() => {
      if (S.netDown) return;
      S.buffering = true;
      showNet("slow", "⏳ SLOW NETWORK — BUFFERING", "the system is fine · loading video…");
      updateAnim();
    }, BUFFER_BANNER_DELAY);
  } else {
    clearTimeout(S.bufferTimer);
    if (!S.buffering) return;
    S.buffering = false;
    if (!S.netDown) hideNet();
    updateAnim();
  }
}

async function probe() {
  if (S.probing || !S.netDown) return;
  S.probing = true;
  try {
    const res = await fetch("/api/health?r=" + now(), { cache: "no-store" });
    if (res.ok) { setNetDown(false); schedulePoll(1500); }
  } catch (e) {
  } finally {
    S.probing = false;
  }
}

function scheduleRetry() {
  if (S.retryTimer || !S.netDown) return;
  S.retryTimer = setTimeout(() => {
    S.retryTimer = null;
    clearTimeout(S.stallTimer); S.stallTimer = null;
    if (S.netDown && !S.paused) playCurrent();
  }, RETRY_INTERVAL);
}

window.addEventListener("offline", () => setNetDown(true, "📡 NO INTERNET — GYMCAST AUTO-RETRY"));
window.addEventListener("online", () => setTimeout(probe, 2000));

/* ---------- 6. Wall-clock schedule (sync) ---------- */
function probeDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const to = setTimeout(() => { cleanup(); resolve(0); }, 8000);
    function cleanup() {
      clearTimeout(to);
      try { v.removeAttribute("src"); v.load(); } catch (e) {}
      v.onloadedmetadata = null;
      v.onerror = null;
    }
    v.onloadedmetadata = () => { const d = v.duration; cleanup(); resolve(d); };
    v.onerror = () => { cleanup(); resolve(0); };
    v.src = url;
  });
}

async function loadDurations(list) {
  const out = {};
  for (const v of list) {
    if (isYTUrl(v.url)) return null;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS_DUR + v.id) || "null"); } catch (e) {}
    if (cached && cached.u === v.url && cached.d > 0) { out[v.id] = cached.d; continue; }
    const d = await probeDuration(v.url);
    if (!d || !isFinite(d) || d <= 0) return null;
    out[v.id] = d;
    try { localStorage.setItem(LS_DUR + v.id, JSON.stringify({ u: v.url, d })); } catch (e) {}
  }
  return out;
}

async function computeSync(list) {
  if (!list.length) return null;
  const durs = await loadDurations(list);
  if (!durs) return null;
  let acc = 0;
  const segStart = [];
  for (const v of list) { segStart.push(acc); acc += durs[v.id]; }
  if (!(acc > 1)) return null;
  return { segStart: segStart, totalDur: acc };
}

function targetAt(ms) {
  const pos = ((ms / 1000) % S.totalDur + S.totalDur) % S.totalDur;
  let idx = 0;
  for (let i = 0; i < S.segStart.length; i++) if (pos >= S.segStart[i]) idx = i;
  return { idx: idx, off: pos - S.segStart[idx] };
}

function align() {
  if (S.transitioning) return;
  if (!S.syncOn || S.paused || S.netDown || !S.htmlVid || !S.playlist.length) return;
  if (S.buffering || S.htmlVid.readyState < 2 || S.htmlVid.seeking) return;
  try {
    const t = targetAt(correctedNow());
    if (t.idx !== S.index) {
      S.index = t.idx;
      S.pendingSeek = t.off >= 1 ? t.off : null;
      S.midFixUsed = false;
      playCurrent();
      return;
    }
    const drift = t.off - S.htmlVid.currentTime;
    if (!S.midFixUsed && Math.abs(drift) > MIDFIX_DRIFT && bufferAhead() > MIDFIX_BUFFER) {
      S.midFixUsed = true;
      S.htmlVid.currentTime = Math.max(0, t.off);
      S.htmlVid.playbackRate = 1;
      return;
    }
    let rate = 1;
    if (drift > SYNC_DEADZONE) {
      if (bufferAhead() > CATCHUP_BUFFER) rate = Math.min(CATCHUP_MAX, 1 + drift * 0.15);
    } else if (drift < -SYNC_DEADZONE) {
      rate = Math.max(SLOWDOWN_MIN, 1 + drift * 0.15);
    }
    if (Math.abs(S.htmlVid.playbackRate - rate) > 0.01) S.htmlVid.playbackRate = rate;
  } catch (e) {}
}
const alignInterval = setInterval(align, ALIGN_INTERVAL);

/* ---------- 7. Playback engine ---------- */
function unlockAudio() {
  if (S.audioUnlocked) return;
  S.audioUnlocked = true;
  if (S.htmlVid) { try { S.htmlVid.muted = false; S.htmlVid.volume = S.vol / 100; } catch (e) {} }
  if (S.ytPlayer && S.ytPlayer.unMute) {
    try { S.ytPlayer.unMute(); S.ytPlayer.setVolume(S.vol); } catch (e) {}
  }
}

let fsLocked = false;
function goFullscreen() {
  if (fsLocked) return;
  try {
    const p = document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : null;
    if (p && p.then) p.then(() => { fsLocked = true; hideFsHint(); }).catch(() => {});
    else if (document.fullscreenElement) { fsLocked = true; hideFsHint(); }
  } catch (e) {}
}
function hideFsHint() {
  const hint = document.getElementById("fs-hint");
  if (hint) hint.style.display = "none";
}
document.addEventListener("fullscreenchange", () => {
  fsLocked = Boolean(document.fullscreenElement);
  if (fsLocked) hideFsHint();
});

function onAnyGesture() {
  unlockAudio();
  if (fsLocked) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  goFullscreen();
}
document.body.addEventListener("pointerdown", onAnyGesture);
document.body.addEventListener("keydown", onAnyGesture);
document.body.addEventListener("click", onAnyGesture);

function getYTId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.pathname.includes("/shorts/") || u.pathname.includes("/embed/") || u.pathname.includes("/live/")) return u.pathname.split("/").pop();
    return u.searchParams.get("v");
  } catch (e) { return ""; }
}

/* ---------- Transition helpers ---------- */
function endTransition() {
  S.transitioning = false;
  clearTimeout(S.transitionTimer);
  S.transitionTimer = null;
}

function destroyPlayers() {
  clearTimeout(S.stallTimer); S.stallTimer = null;
  clearTimeout(S.imageTimer); S.imageTimer = null;
  clearTimeout(S.bufferTimer); S.bufferTimer = null;
  /* FIX R4: reset buffering banner state when tearing down a video */
  setBuffering(false);

  if (S.ytPlayer) {
    try { S.ytPlayer.destroy(); } catch (e) {}
    S.ytPlayer = null;
  }
  if (S.htmlVid) {
    const v = S.htmlVid;
    v.removeEventListener("ended", onVidEnded);
    v.removeEventListener("error", onVidError);
    v.removeEventListener("waiting", onVidWaiting);
    v.removeEventListener("playing", onVidPlaying);
    v.removeEventListener("canplay", onVidCanPlay);
    v.removeEventListener("stalled", onVidStalled);
    try { v.pause(); } catch (e) {}
    try { v.removeAttribute("src"); v.load(); } catch (e) {}
    S.htmlVid = null;
  }
}

/* ---------- Named handlers ---------- */
/* FIX R7: clear stall timer on ended and error paths */
const onVidEnded = () => {
  clearTimeout(S.stallTimer); S.stallTimer = null;
  playNext();
};
const onVidError = () => {
  clearTimeout(S.stallTimer); S.stallTimer = null;
  endTransition();
  onMediaError();
};
const onVidWaiting = () => {
  setBuffering(true);
  if (S.netDown) return;
  clearTimeout(S.stallTimer);
  S.stallTimer = setTimeout(() => {
    console.log("⚠️ Video stalled for 35s. Auto-reloading...");
    window.location.reload();
  }, 35000);
};
const onVidPlaying = () => { setBuffering(false); clearTimeout(S.stallTimer); S.stallTimer = null; endTransition(); };
const onVidCanPlay = () => {
  setBuffering(false);
  clearTimeout(S.stallTimer); S.stallTimer = null;
  if (S.netDown) probe();
  endTransition();
};
const onVidStalled = () => setBuffering(true);

function armImageTimer(video, remainingMs) {
  clearTimeout(S.imageTimer);
  const delay = remainingMs != null ? Math.max(500, remainingMs) : IMAGE_DURATION * 1000;
  S.imageEndsAt = now() + delay;
  S.imageTimer = setTimeout(() => {
    if (!S.paused && S.playlist.length && S.index >= 0 && S.index < S.playlist.length &&
        S.playlist[S.index] && S.playlist[S.index].url === video.url) {
      playNext();
    }
  }, delay);
}

/* ---------- playCurrent ---------- */
function playCurrent() {
  if (!S.playlist.length) { showStandby(); return; }
  const video = S.playlist[S.index];
  if (!video) { showStandby(); return; }

  S.standbyShowing = false;
  if (!isYTUrl(video.url)) ytFailCount = 0;

  destroyPlayers();
  el.player.style.display = "block";

  if (isImageUrl(video.url)) {
    el.player.innerHTML = '<img id="html-img" src="' + video.url + '" style="width:100%;height:100%;object-fit:contain;background:#000;" alt="">';
    const img = document.getElementById("html-img");
    img.onerror = () => { console.error("Image load failed:", video.url); setTimeout(playNext, 100); };
    if (S.paused) { endTransition(); return; }
    armImageTimer(video);
    endTransition();
    return;
  }

  if (isYTUrl(video.url)) {
    /* FIX C1: recursion-safe YT branch */
    if (typeof YT === 'undefined' || !YT.Player) {
      ytFailCount++;
      if (ytFailCount > Math.max(2, S.playlist.length)) {
        ytFailCount = 0;
        console.error("YouTube API unavailable — standby, retry in 60s");
        showStandby();
        setTimeout(() => { if (!S.paused && !S.netDown && S.playlist.length) playCurrent(); }, YT_STANDBY_COOLDOWN);
        return;
      }
      console.warn("YouTube API not ready, retry " + ytFailCount);
      endTransition();
      setTimeout(() => { if (!S.paused) playNext(); }, YT_RETRY_DELAY);
      return;
    }
    ytFailCount = 0;

    const ytId = getYTId(video.url);
    if (!ytId) {
      console.error("Invalid YT URL:", video.url);
      endTransition();
      setTimeout(() => { if (!S.paused) playNext(); }, 500);
      return;
    }

    el.player.innerHTML = '<div id="yt-player-container" style="width:100%;height:100%;"></div>';
    try {
      S.ytPlayer = new YT.Player("yt-player-container", {
        videoId: ytId,
        playerVars: { autoplay: 1, mute: 0, loop: 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            try {
              if (S.paused) { e.target.pauseVideo(); endTransition(); }
              else { e.target.playVideo(); e.target.unMute(); e.target.setVolume(S.vol); }
            } catch (err) { endTransition(); }
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              endTransition();
              if (S.netDown) probe();
            } else if (e.data === YT.PlayerState.ENDED) {
              playNext();
            }
          },
          onError: () => {
            S.ytPlayer = null;
            endTransition();
            if (S.netDown) scheduleRetry();
            else setTimeout(() => { if (!S.paused) playNext(); }, 500);
          },
        },
      });
    } catch (e) {
      console.error("YT Error", e);
      S.ytPlayer = null;
      endTransition();
      setTimeout(() => { if (!S.paused) playNext(); }, YT_RETRY_DELAY);
    }
    /* No endTransition here — onStateChange PLAYING / onReady / safety timer handles it */
    return;
  }

  /* HTML <video> */
  el.player.innerHTML = '<video id="html-vid" autoplay playsinline preload="metadata"></video>';
  const v = document.getElementById("html-vid");
  S.htmlVid = v;
  v.volume = S.vol / 100;
  v.playbackRate = 1;
  v.src = video.url;

  v.addEventListener("ended", onVidEnded);
  v.addEventListener("error", onVidError);
  v.addEventListener("waiting", onVidWaiting);
  v.addEventListener("stalled", onVidStalled);
  v.addEventListener("playing", onVidPlaying);
  v.addEventListener("canplay", onVidCanPlay);

  if (S.pendingSeek != null) {
    const ps = S.pendingSeek; S.pendingSeek = null;
    v.addEventListener("loadedmetadata", () => { try { v.currentTime = ps; } catch (e) {} }, { once: true });
  }

  if (S.paused) {
    try { v.pause(); } catch (e) {}
    endTransition();
    return;
  }

  const p = v.play();
  if (p !== undefined) p.catch(() => { try { v.muted = true; v.play().catch(() => {}); } catch (e) {} });
  /* No endTransition here — onVidPlaying / onVidCanPlay / safety timer handles it */
}

function onMediaError() {
  if (S.netDown) scheduleRetry();
  else playNext();
}

function playNext() {
  /* FIX C2: guards BEFORE setting transitioning */
  if (S.transitioning) return;
  if (!S.playlist.length || S.paused) return;
  if (S.netDown) { scheduleRetry(); return; }

  S.transitioning = true;
  clearTimeout(S.transitionTimer);
  S.transitionTimer = setTimeout(() => { S.transitioning = false; S.transitionTimer = null; }, 10000);

  clearTimeout(S.stallTimer); S.stallTimer = null;
  clearTimeout(S.imageTimer); S.imageTimer = null;
  clearTimeout(S.bufferTimer); S.bufferTimer = null;

  let next = (S.index + 1) % S.playlist.length;
  S.pendingSeek = null;

  if (S.syncOn) {
    try {
      const t = targetAt(correctedNow());
      if (t.idx !== next && t.idx !== S.index) { next = t.idx; S.pendingSeek = t.off >= 1 ? t.off : null; }
      else if (t.idx === next && t.off > BOUNDARY_SNAP) { S.pendingSeek = t.off; }
    } catch (e) {}
  }

  S.index = next;
  S.midFixUsed = false;
  playCurrent();
}

function showStandby() {
  if (S.standbyShowing && !S.htmlVid && !S.ytPlayer) return;
  destroyPlayers();
  S.standbyShowing = true;
  el.player.style.display = "flex";
  el.player.innerHTML = '<div id="standby-text">M-FITNESS ✓</div>';
  el.pausedBadge.style.display = "none";
  endTransition();
}

function applyPause(p) {
  if (p === S.paused) return;
  S.paused = p;

  if (p) {
    endTransition();
    clearTimeout(S.stallTimer); S.stallTimer = null;
    clearTimeout(S.imageTimer); S.imageTimer = null;
    clearTimeout(S.bufferTimer); S.bufferTimer = null;
    if (S.htmlVid) { try { S.htmlVid.pause(); S.htmlVid.playbackRate = 1; } catch (e) {} }
    if (S.ytPlayer && S.ytPlayer.pauseVideo) { try { S.ytPlayer.pauseVideo(); } catch (e) {} }
    el.pausedBadge.style.display = "block";
  } else {
    el.pausedBadge.style.display = "none";

    /* FIX R5: if the current HTML video is dead, advance instead of trying to play() a broken element */
    if (S.htmlVid) {
      if (S.htmlVid.error) {
        playNext();
      } else {
        S.htmlVid.playbackRate = 1;
        const pr = S.htmlVid.play();
        if (pr && pr.catch) pr.catch(() => {});
      }
    }
    if (S.ytPlayer && S.ytPlayer.playVideo) { try { S.ytPlayer.playVideo(); } catch (e) {} }

    /* FIX C3: re-arm image timer (or re-enter playCurrent) if not on HTML/YT */
    if (!S.htmlVid && !S.ytPlayer && S.playlist.length) {
      const cur = S.playlist[S.index];
      if (cur && isImageUrl(cur.url)) {
        const remaining = S.imageEndsAt > 0 ? S.imageEndsAt - now() : undefined;
        armImageTimer(cur, remaining);
      } else if (cur) {
        playCurrent();
      }
    }
  }
}

/* ---------- 8. Server polling ---------- */
async function startPolling(code) {
  S.code = code;
  goFullscreen();

  async function poll() {
    const myVersion = ++playlistVersion;

    /* ---- Phase A: network I/O (only failures here flip netDown) ---- */
    let res, rtt;
    try {
      const t0 = (window.performance && performance.now) ? performance.now() : now();
      res = await fetch("/api/tv/state?code=" + code + "&hb=1");
      rtt = ((window.performance && performance.now) ? performance.now() : now()) - t0;
    } catch (netErr) {
      console.error("Network fetch failed:", netErr);
      setNetDown(true);
      schedulePoll(S.idleDelay);
      return;
    }

    /* ---- Phase B: response & data processing (errors are logged, not misclassified) ---- */
    try {
      if (res.status === 404) { localStorage.removeItem(LS_CODE); location.reload(); return; }
      if (!res.ok) {
        if (res.status >= 500) { setNetDown(true); schedulePoll(S.idleDelay); return; }
        throw new Error("HTTP " + res.status);
      }

      if (S.netDown) setNetDown(false);

      const dh = res.headers.get("date");
      if (dh) {
        const st = Date.parse(dh);
        if (!isNaN(st)) {
          const off = st + Math.min(rtt, 4000) / 2 - now();
          if (S.bestRtt === null || rtt <= S.bestRtt) {
            S.bestRtt = rtt;
            S.serverOffset = Math.abs(off) > CLOCK_TRUST ? off : 0;
          }
        }
      }

      const data = await res.json();

      if (data.reloadToken && localStorage.getItem(LS_TOK) !== data.reloadToken) {
        localStorage.setItem(LS_TOK, data.reloadToken);
        location.reload();
        return;
      }
      if (data.resetToken && localStorage.getItem(LS_RST) !== data.resetToken) {
        localStorage.setItem(LS_RST, data.resetToken);
        localStorage.removeItem(LS_CODE);
        location.reload();
        return;
      }

      const secs = Number(data.settings && data.settings.pollSeconds);
      if (secs >= POLL_MIN && secs <= POLL_MAX) S.idleDelay = secs * 1000;

      /* FIX R1: guard against non-array playlist payloads */
      const incoming = Array.isArray(data.playlist) ? data.playlist : [];
      const incomingIds = incoming.map(v => v.id).join(",");
      const currentIds = S.playlist.map(v => v.id).join(",");

      if (incomingIds !== currentIds) {
        /* FIX R1/C4: compute durations without mutating S until ready */
        let sync = null;
        try {
          sync = await computeSync(incoming);
        } catch (csErr) {
          console.error("computeSync error:", csErr);
          sync = null;
        }

        if (myVersion !== playlistVersion) {
          /* A newer poll has started — abandon this commit */
          schedulePoll(S.idleDelay);
          return;
        }

        S.playlist = incoming;
        if (sync) {
          S.segStart = sync.segStart;
          S.totalDur = sync.totalDur;
          S.syncOn = true;
          try {
            const t = targetAt(correctedNow());
            S.index = t.idx;
            S.pendingSeek = t.off >= 1 ? t.off : null;
          } catch (tErr) {
            S.index = 0; S.pendingSeek = null;
          }
        } else {
          S.segStart = [];
          S.totalDur = 0;
          S.syncOn = false;
          S.index = 0;
          S.pendingSeek = null;
        }
        S.midFixUsed = false;
        try { playCurrent(); } catch (pcErr) { console.error("playCurrent error:", pcErr); }
      } else if (!S.playlist.length && !S.standbyShowing) {
        showStandby();
      }

      try { applyPause(Boolean(data.paused)); } catch (apErr) { console.error("applyPause error:", apErr); }

    } catch (procErr) {
      /* FIX R1: data/logic errors do NOT flip the offline banner */
      console.error("Poll processing error:", procErr);
    }

    schedulePoll(S.idleDelay);
  }

  S.pollFn = poll;
  poll();
}

/* ---------- 9. Activation ---------- */
el.digits.forEach((d, i) => {
  d.addEventListener("input", () => {
    d.value = d.value.replace(/\D/g, "");
    if (d.value && i < 3) el.digits[i + 1].focus();
  });
  d.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !d.value && i > 0) el.digits[i - 1].focus();
  });
});

el.connect.addEventListener("click", async () => {
  const code = el.digits.map(d => d.value).join("");
  if (code.length < 4) { el.error.innerText = "Please enter all 4 digits"; return; }
  el.error.innerText = "Connecting...";
  el.connect.disabled = true;
  try {
    const res = await fetch("/api/tv/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Code not found");
    localStorage.setItem(LS_CODE, code);
    el.activation.style.display = "none";
    startPolling(code);
  } catch (e) {
    el.error.innerText = e.message;
    el.connect.disabled = false;
  }
});

/* ---------- 10. Boot ---------- */
if (!window.onYouTubeIframeAPIReady) {
  window.onYouTubeIframeAPIReady = function () {};
}

const fsHint = document.createElement("div");
fsHint.id = "fs-hint";
fsHint.textContent = "Tap screen for fullscreen";
fsHint.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;background:rgba(0,0,0,0.7);color:#ffb02e;padding:10px 20px;border-radius:8px;font-family:monospace;font-size:14px;pointer-events:none;";
document.body.appendChild(fsHint);

goFullscreen();
const saved = localStorage.getItem(LS_CODE);
if (saved) {
  el.activation.style.display = "none";
  startPolling(saved);
}

setTimeout(() => { if (document.fullscreenElement) hideFsHint(); }, 3000);

/* ---------- 11. Keep screen awake ---------- */
const SENTINEL_URL = "/assets/sys/sentinel.mp4";
const SENTINEL_CACHE_KEY = "gc_sentinel_b64";
let sentinelData = "";
try { sentinelData = localStorage.getItem(SENTINEL_CACHE_KEY) || ""; } catch (e) { sentinelData = ""; }

let wl = null;
let sentinelEl = null;
let sentinelOk = false;
let canvasVid = null;
let canvasTimer = null, canvasTick = 0;
let canvasStream = null;

function loadSentinel() {
  fetch(SENTINEL_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("HTTP " + r.status))))
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      let bin = ""; const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      sentinelData = "data:video/mp4;base64," + btoa(bin);
      try { localStorage.setItem(SENTINEL_CACHE_KEY, sentinelData); } catch (e) {}
      if (document.visibilityState === "visible") startSentinel();
    })
    .catch(() => {});
}

function startSentinel() {
  if (!sentinelData) { startCanvas(); return; }
  if (sentinelEl) {
    if (sentinelEl.paused) { const p = sentinelEl.play(); if (p && p.catch) p.catch(() => {}); }
    return;
  }
  try {
    const v = document.createElement("video");
    v.id = "gc-sentinel";
    v.src = sentinelData;
    v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.setAttribute("autoplay", ""); v.setAttribute("loop", "");
    try { v.disablePictureInPicture = true; } catch (e) {}
    try { v.disableRemotePlayback = true; } catch (e) {}
    v.style.cssText = "position:fixed;left:-3px;top:-3px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    v.addEventListener("playing", () => { sentinelOk = true; stopCanvas(); });
    v.addEventListener("timeupdate", () => { sentinelOk = true; stopCanvas(); });
    v.onerror = () => { sentinelOk = false; startCanvas(); };
    document.body.appendChild(v);
    sentinelEl = v;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    setTimeout(() => { if (!sentinelOk) startCanvas(); }, 4000);
  } catch (e) { startCanvas(); }
}

function stopSentinel() {
  sentinelOk = false;
  if (!sentinelEl) return;
  try { sentinelEl.pause(); } catch (e) {}
  try { sentinelEl.removeAttribute("src"); sentinelEl.load(); } catch (e) {}
  try { sentinelEl.remove(); } catch (e) {}
  sentinelEl = null;
}

function startCanvas() {
  if (canvasVid || sentinelOk) return;
  try {
    const c = document.createElement("canvas"); c.width = 16; c.height = 16;
    const ctx = c.getContext("2d");
    if (!ctx || typeof c.captureStream !== "function") return;
    const stream = c.captureStream(0);
    canvasStream = stream;
    const track = stream.getVideoTracks && stream.getVideoTracks()[0];
    const v = document.createElement("video");
    v.muted = true; v.volume = 0; v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
    v.style.cssText = "position:fixed;left:-3px;top:-3px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    v.srcObject = stream;
    document.body.appendChild(v);
    const p = v.play(); if (p && p.catch) p.catch(() => {});
    canvasVid = v;
    canvasTimer = setInterval(() => {
      try {
        ctx.fillStyle = (canvasTick++ % 2) ? "#000" : "#010101";
        ctx.fillRect(0, 0, 16, 16);
        if (track && track.requestFrame) track.requestFrame();
      } catch (e) {}
    }, 2000);
  } catch (e) {}
}

function stopCanvas() {
  if (canvasStream) {
    try { canvasStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); } catch (e) {}
    canvasStream = null;
  }
  if (canvasVid) {
    clearInterval(canvasTimer); canvasTimer = null;
    try { canvasVid.pause(); } catch (e) {}
    try { canvasVid.srcObject = null; canvasVid.load(); } catch (e) {}
    try { canvasVid.remove(); } catch (e) {}
    canvasVid = null;
  }
}

async function tryWakeLock() {
  if (wl && !wl.released) return;
  if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
  try {
    wl = await navigator.wakeLock.request("screen");
    wl.addEventListener("release", () => { wl = null; });
  } catch (e) { wl = null; }
}
function releaseWakeLock() { try { if (wl && !wl.released) wl.release(); } catch (e) {} wl = null; }

function ensureAwake() {
  if (document.visibilityState !== "visible") return;
  tryWakeLock();
  startSentinel();
}
function releaseAwake() { releaseWakeLock(); stopSentinel(); stopCanvas(); }

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") ensureAwake(); else releaseAwake();
});
const awakeInterval = setInterval(() => { if (document.visibilityState === "visible") ensureAwake(); }, 25000);

loadSentinel();
ensureAwake();

/* ---------- 12. Defensive cleanup ---------- */
window.addEventListener("beforeunload", () => {
  try { clearInterval(alignInterval); } catch (e) {}
  try { clearInterval(awakeInterval); } catch (e) {}
  clearTimeout(S.pollTimer);
  clearTimeout(S.retryTimer);
  clearTimeout(S.bufferTimer);
  clearTimeout(S.stallTimer);
  clearTimeout(S.imageTimer);
  clearTimeout(S.transitionTimer);
  clearInterval(S.downClock);
  clearInterval(S.probeTimer);
  try { releaseAwake(); } catch (e) {}
});
})();
