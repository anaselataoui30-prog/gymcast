/* ============================================================
   GYMCAST TV PLAYER — organized build
   ------------------------------------------------------------
   1. DOM & constants
   2. App state
   3. Small utils
   4. Network banner UI (down / buffering / recovered)
   5. Wall-clock schedule (multi-screen sync, glide + snaps)
   6. Playback engine (MP4 + YouTube)
   7. Server polling (playlist, pause, restart, reset, clock)
   8. Activation (first-time code entry)
   9. Boot
   ============================================================ */
(() => {
"use strict";

/* ---------- 1. DOM & constants ---------- */
const LS_CODE = "gymcast_tv_code";
const LS_TOK  = "gymcast_tok";
const LS_RST  = "gymcast_rst";
const LS_DUR  = "gc_dur_";

const POLL_MIN = 60, POLL_MAX = 600, POLL_DEFAULT = 600;
const PROBE_INTERVAL = 60000;        // health probes while offline
const RETRY_INTERVAL = 10000;        // media retry while offline
const ALIGN_INTERVAL = 5000;         // sync check cadence
const BUFFER_BANNER_DELAY = 2500;    // stall must last this long to show banner
const CATCHUP_MAX = 1.5, SLOWDOWN_MIN = 0.9;
const SYNC_DEADZONE = 0.3;           // s: inside this = perfectly in sync
const BOUNDARY_SNAP = 2;             // s: lag that snaps at video boundary
const MIDFIX_DRIFT = 10;             // s: lag that allows one mid-video snap
const MIDFIX_BUFFER = 6;             // s: buffer required to allow mid snap
const CATCHUP_BUFFER = 4;            // s: buffer required to speed-glide
const CLOCK_TRUST = 10000;           // ms: ignore server clock correction below this

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

/* ---------- 2. App state ---------- */
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
};

/* ---------- 3. Small utils ---------- */
const isYTUrl = (u) => /youtube\.com|youtu\.be/i.test(u);
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
function mediaIsDead() {
  const v = document.getElementById("html-vid");
  if (v) return Boolean(v.error) || v.readyState === 0;
  return !S.ytPlayer && S.playlist.length > 0;
}
function schedulePoll(delay) {
  clearTimeout(S.pollTimer);
  S.pollTimer = setTimeout(() => { if (S.pollFn) S.pollFn(); }, delay);
}

/* ---------- 4. Network banner UI ---------- */
function showNet(mode, title, sub) {
  el.net.classList.remove("down", "slow", "ok");
  el.net.classList.add(mode);
  el.net.style.display = "flex";
  el.netTitle.textContent = title;
  el.netSub.textContent = sub || "";
}
function hideNet() { el.net.style.display = "none"; }

function setNetDown(on, reason) {
  if (on === S.netDown) { if (on && reason) el.netTitle.textContent = reason; return; }
  S.netDown = on;
  clearTimeout(S.retryTimer); S.retryTimer = null;

  if (on) {
    clearTimeout(S.bufferTimer); S.buffering = false;
    S.downSince = now();
    showNet("down", reason || "📡 NO INTERNET — GYMCAST AUTO-RETRY", "the system is fine · waiting for network · 00:00");
    clearInterval(S.downClock);
    S.downClock = setInterval(() => {
      if (S.netDown) el.netSub.textContent = "the system is fine · waiting for network · " + fmtDur(now() - S.downSince);
    }, 1000);
    if (!S.probeTimer) S.probeTimer = setInterval(() => { if (S.netDown) probe(); }, PROBE_INTERVAL);
  } else {
    clearInterval(S.downClock); S.downClock = null;
    if (S.probeTimer) { clearInterval(S.probeTimer); S.probeTimer = null; }
    showNet("ok", "✔ BACK ONLINE — RESUMING", "");
    setTimeout(() => { if (!S.netDown && !S.buffering) hideNet(); }, 3000);
    if (!S.paused && mediaIsDead()) playCurrent();
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
    }, BUFFER_BANNER_DELAY);
  } else {
    clearTimeout(S.bufferTimer);
    if (!S.buffering) return;
    S.buffering = false;
    if (!S.netDown) hideNet();
  }
}

async function probe() {
  if (S.probing || !S.netDown) return;
  S.probing = true;
  try {
    const res = await fetch("/api/health?r=" + now(), { cache: "no-store" });
    if (res.ok) { setNetDown(false); schedulePoll(1500); }
  } catch (e) {}
  S.probing = false;
}

function scheduleRetry() {
  if (S.retryTimer || !S.netDown) return;
  S.retryTimer = setTimeout(() => {
    S.retryTimer = null;
    if (S.netDown && !S.paused) playCurrent();
  }, RETRY_INTERVAL);
}

window.addEventListener("offline", () => setNetDown(true, "📡 NO INTERNET — GYMCAST AUTO-RETRY"));
window.addEventListener("online", () => setTimeout(probe, 2000));

/* ---------- 5. Wall-clock schedule (sync) ---------- */
function probeDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const to = setTimeout(() => { cleanup(); resolve(0); }, 8000);
    function cleanup() { clearTimeout(to); v.removeAttribute("src"); try { v.load(); } catch (e) {} }
    v.onloadedmetadata = () => { const d = v.duration; cleanup(); resolve(d); };
    v.onerror = () => { cleanup(); resolve(0); };
    v.src = url;
  });
}

async function loadDurations(list) {
  const out = {};
  for (const v of list) {
    if (isYTUrl(v.url)) return null;                      // sync = pure MP4 playlists only
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

async function setupSync(list) {
  S.syncOn = false; S.totalDur = 0; S.segStart = [];
  if (!list.length) return;
  const durs = await loadDurations(list);
  if (!durs) return;
  let acc = 0;
  for (const v of list) { S.segStart.push(acc); acc += durs[v.id]; }
  if (!(acc > 1)) return;
  S.totalDur = acc;
  S.syncOn = true;
}

function targetAt(ms) {
  const pos = ((ms / 1000) % S.totalDur + S.totalDur) % S.totalDur;
  let idx = 0;
  for (let i = 0; i < S.segStart.length; i++) if (pos >= S.segStart[i]) idx = i;
  return { idx, off: pos - S.segStart[idx] };
}

// Glide with speed when safe; snap only when clearly lagging.
function align() {
  if (!S.syncOn || S.paused || S.netDown || !S.htmlVid || !S.playlist.length) return;
  if (S.buffering || S.htmlVid.readyState < 2 || S.htmlVid.seeking) return;
  try {
    const t = targetAt(correctedNow());

    if (t.idx !== S.index) {                              // wrong video (join/recovery)
      S.index = t.idx;
      S.pendingSeek = t.off >= 1 ? t.off : null;
      S.midFixUsed = false;
      playCurrent();
      return;
    }

    const drift = t.off - S.htmlVid.currentTime;          // >0 = behind schedule

    if (!S.midFixUsed && Math.abs(drift) > MIDFIX_DRIFT && bufferAhead() > MIDFIX_BUFFER) {
      S.midFixUsed = true;                                // one emergency snap per video
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
setInterval(align, ALIGN_INTERVAL);

/* ---------- 6. Playback engine ---------- */
function unlockAudio() {
  if (S.audioUnlocked) return;
  S.audioUnlocked = true;
  if (S.htmlVid) { S.htmlVid.muted = false; S.htmlVid.volume = S.vol / 100; }
  if (S.ytPlayer && S.ytPlayer.unMute) { S.ytPlayer.unMute(); S.ytPlayer.setVolume(S.vol); }
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

/* Fullscreen: strict browsers grant it only after a user gesture (or in kiosk
   mode). Try at boot; retry silently on every tap/click/key until it sticks. */
let fsLocked = false;
function goFullscreen() {
  if (fsLocked) return;
  try {
    const p = document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : null;
    if (p && p.then) p.then(() => { fsLocked = true; }).catch(() => {});
    else if (document.fullscreenElement) fsLocked = true;
  } catch (e) {}
}
document.addEventListener("fullscreenchange", () => { fsLocked = Boolean(document.fullscreenElement); });
window.addEventListener("pointerdown", goFullscreen);
window.addEventListener("keydown", goFullscreen);

function getYTId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.pathname.includes("/shorts/") || u.pathname.includes("/embed/") || u.pathname.includes("/live/")) return u.pathname.split("/").pop();
    return u.searchParams.get("v");
  } catch (e) { return ""; }
}

function playCurrent() {
  if (!S.playlist.length) { showStandby(); return; }

  el.player.style.display = "block";
  const video = S.playlist[S.index];

  if (S.ytPlayer) { try { S.ytPlayer.destroy(); } catch (e) {} S.ytPlayer = null; }
  if (S.htmlVid) { S.htmlVid.removeEventListener("ended", playNext); S.htmlVid.removeEventListener("error", onMediaError); S.htmlVid = null; }

  if (isYTUrl(video.url)) {
    el.player.innerHTML = '<div id="yt-player-container" style="width:100%;height:100%;"></div>';
    S.ytPlayer = new YT.Player("yt-player-container", {
      videoId: getYTId(video.url),
      playerVars: { autoplay: 1, mute: 0, loop: 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: (e) => {
          e.target.playVideo();
          e.target.unMute();
          e.target.setVolume(S.vol);
          if (S.paused) e.target.pauseVideo();
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) playNext();
          else if (e.data === YT.PlayerState.PLAYING && S.netDown) probe();
        },
        onError: () => { if (S.netDown) scheduleRetry(); else playNext(); },
      },
    });
    return;
  }

  el.player.innerHTML = '<video id="html-vid" autoplay playsinline></video>';
  const v = document.getElementById("html-vid");
  S.htmlVid = v;
  v.src = video.url;
  v.volume = S.vol / 100;
  v.playbackRate = 1;
  v.addEventListener("ended", playNext);
  v.addEventListener("error", onMediaError);
  v.addEventListener("waiting", () => setBuffering(true));
  v.addEventListener("stalled", () => setBuffering(true));
  v.addEventListener("playing", () => setBuffering(false));
  v.addEventListener("canplay", () => { setBuffering(false); if (S.netDown) probe(); });

  if (S.pendingSeek != null) {
    const ps = S.pendingSeek; S.pendingSeek = null;
    v.addEventListener("loadedmetadata", () => { try { v.currentTime = ps; } catch (e) {} }, { once: true });
  }

  if (S.paused) {
    v.pause();
  } else {
    const p = v.play();
    if (p !== undefined) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
  }
}

function onMediaError() {
  if (S.netDown) scheduleRetry();   // offline: retry same video, never skip
  else playNext();                  // online: broken file → skip it
}

function playNext() {
  if (!S.playlist.length || S.paused) return;
  if (S.netDown) { scheduleRetry(); return; }

  let next = (S.index + 1) % S.playlist.length;
  S.pendingSeek = null;

  if (S.syncOn) {
    try {
      const t = targetAt(correctedNow());
      if (t.idx !== next && t.idx !== S.index) { next = t.idx; S.pendingSeek = t.off >= 1 ? t.off : null; }
      else if (t.idx === next && t.off > BOUNDARY_SNAP) { S.pendingSeek = t.off; }  // lagging screen snaps at boundary
    } catch (e) {}
  }

  S.index = next;
  S.midFixUsed = false;
  playCurrent();
}

function showStandby() {
  el.player.style.display = "flex";
  el.player.innerHTML = '<div id="standby-text">STANDBY</div>';
  el.pausedBadge.style.display = "none";
}

function applyPause(p) {
  if (p === S.paused) return;
  S.paused = p;
  if (p) {
    if (S.htmlVid) { S.htmlVid.pause(); S.htmlVid.playbackRate = 1; }
    if (S.ytPlayer && S.ytPlayer.pauseVideo) S.ytPlayer.pauseVideo();
    el.pausedBadge.style.display = "block";
  } else {
    el.pausedBadge.style.display = "none";
    if (S.htmlVid) { S.htmlVid.playbackRate = 1; S.htmlVid.play().catch(() => {}); }
    if (S.ytPlayer && S.ytPlayer.playVideo) S.ytPlayer.playVideo();
  }
}

/* ---------- 7. Server polling ---------- */
async function startPolling(code) {
  S.code = code;
  goFullscreen();

  async function poll() {
    const t0 = (window.performance && performance.now) ? performance.now() : now();
    try {
      const res = await fetch(`/api/tv/state?code=${code}&hb=1`);
      const rtt = ((window.performance && performance.now) ? performance.now() : now()) - t0;

      if (res.status === 404) { localStorage.removeItem(LS_CODE); location.reload(); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);

      const dh = res.headers.get("date");
      if (dh) {
        const st = Date.parse(dh);
        if (!isNaN(st)) {
          const off = st + Math.min(rtt, 4000) / 2 - now();
          if (S.bestRtt === null || rtt <= S.bestRtt) {
            S.bestRtt = rtt;
            S.serverOffset = Math.abs(off) > CLOCK_TRUST ? off : 0;   // trust device NTP unless wildly wrong
          }
        }
      }

      const data = await res.json();
      if (S.netDown) setNetDown(false);

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

      const incoming = data.playlist || [];
      const incomingIds = incoming.map(v => v.id).join(",");
      const currentIds = S.playlist.map(v => v.id).join(",");

      if (incomingIds !== currentIds) {
        S.playlist = incoming;
        await setupSync(S.playlist);
        if (S.syncOn) {
          const t = targetAt(correctedNow());
          S.index = t.idx;
          S.pendingSeek = t.off >= 1 ? t.off : null;
        } else {
          S.index = 0;
        }
        S.midFixUsed = false;
        playCurrent();
      } else if (!S.playlist.length && el.player.style.display !== "flex") {
        showStandby();
      }

      applyPause(Boolean(data.paused));
    } catch (e) {
      console.error("Poll error", e);
      setNetDown(true);
    }
    schedulePoll(S.idleDelay);
  }

  S.pollFn = poll;
  poll();
}

/* ---------- 8. Activation ---------- */
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
      body: JSON.stringify({ code }),
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

/* ---------- 9. Boot ---------- */
window.onYouTubeIframeAPIReady = function () {};
goFullscreen();   // permissive TV browsers go full immediately; strict ones wait for the first tap
const saved = localStorage.getItem(LS_CODE);
if (saved) {
  el.activation.style.display = "none";
  startPolling(saved);
}
})();
