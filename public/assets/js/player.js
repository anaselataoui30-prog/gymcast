"use strict";

const LS = {
  code: "gc_code",
  name: "gc_name",
  gym: "gc_gym",
  tok: "gc_tok",
};

const $ = (selector) => document.querySelector(selector);

let code = localStorage.getItem(LS.code);

let settings = {
  pollSeconds: 60,
  standbyText: "STANDBY",
  mutedAutoplay: false,
  autoReloadOnError: true,
};

let pollTimer = null;
let clockTimer = null;
let hls = null;

let currentUrl = null;
let gestureDone = false;
let started = false;
let failCount = 0;
let lastHeartbeat = 0;

const HEARTBEAT_MS = 10 * 60 * 1000;

const SMPTE = [
  "#b4b4b4",
  "#b4b400",
  "#00b4b4",
  "#00b400",
  "#b400b4",
  "#b40000",
  "#0000b4",
];

function kindOf(url) {
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
    return "yt";
  }

  if (/vimeo\.com/i.test(url)) {
    return "vimeo";
  }

  if (/\.m3u8(\?|$)/i.test(url)) {
    return "hls";
  }

  return "direct";
}

function ytId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1).split("/")[0];
    }

    const pathMatch = parsed.pathname.match(
      /\/(?:embed|shorts|live|v)\/([\w-]{6,})/
    );

    if (pathMatch) {
      return pathMatch[1];
    }

    const channelMatch = parsed.pathname.match(/\/channel\/([\w-]+)/);

    if (channelMatch) {
      return "ch:" + channelMatch[1];
    }

    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function buildEmbed(video) {
  const mute = settings.mutedAutoplay ? 1 : 0;
  const kind = kindOf(video.url);

  if (kind === "yt") {
    const id = ytId(video.url);

    if (!id) {
      return null;
    }

    if (id.startsWith("ch:")) {
      return `https://www.youtube.com/embed/live_stream?channel=${id.slice(3)}&autoplay=1&mute=${mute}`;
    }

    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${mute}&rel=0&playsinline=1&iv_load_policy=3`;
  }

  if (kind === "vimeo") {
    const id = (video.url.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];

    if (!id) {
      return null;
    }

    return `https://player.vimeo.com/video/${id}?autoplay=1&muted=${mute}&loop=1`;
  }

  return null;
}

function goFS() {
  const el = document.documentElement;

  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
}

function userGesture() {
  if (gestureDone) {
    return;
  }

  gestureDone = true;

  goFS();

  $("#startOverlay").classList.add("off");

  const video = $("#player video");

  if (video) {
    video.play().catch(() => {});
  }
}

$("#startOverlay").addEventListener("click", userGesture);

window.addEventListener("keydown", userGesture, {
  once: true,
});

goFS();

function show(id) {
  document.querySelectorAll(".stage").forEach((stage) => {
    stage.classList.remove("on");
  });

  if (id) {
    document.getElementById(id).classList.add("on");
  }
}

function tickClock() {
  const el = $("#clockBig");

  if (el) {
    el.textContent = new Date().toLocaleTimeString("en-GB");
  }
}

function standbyBars() {
  const bars = $("#standbyBars");

  if (!bars) {
    return;
  }

  bars.innerHTML = SMPTE
    .map((color) => `<i style="background:${color}"></i>`)
    .join("");
}

function showStandby() {
  standbyBars();

  const meta = $("#standbyMeta");

  if (meta) {
    meta.textContent = `SCREEN ${code} · ${localStorage.getItem(LS.gym) || ""} — ${
      settings.standbyText || "STANDBY"
    }`;
  }

  $("#player").innerHTML = "";
  currentUrl = null;

  show("stage-standby");

  if (!clockTimer) {
    clockTimer = setInterval(tickClock, 1000);
  }

  tickClock();
}

function scheduleReload() {
  if (!settings.autoReloadOnError) {
    return;
  }

  setTimeout(() => {
    location.reload();
  }, 5000);
}

function playVideo(video) {
  if (video.url === currentUrl) {
    return;
  }

  currentUrl = video.url;

  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  show(null);

  const wrap = $("#player");

  if (hls) {
    hls.destroy();
    hls = null;
  }

  const kind = kindOf(video.url);

  if (kind === "yt" || kind === "vimeo") {
    const embed = buildEmbed(video);

    wrap.innerHTML = embed
      ? `<iframe src="${embed}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<div class="error">Unsupported video URL</div>`;

    return;
  }

  if (kind === "hls") {
    wrap.innerHTML = `<video autoplay playsinline loop ${
      settings.mutedAutoplay ? "muted" : ""
    }></video>`;

    const videoEl = wrap.querySelector("video");
    videoEl.onerror = scheduleReload;

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(video.url);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
    } else {
      videoEl.src = video.url;
      videoEl.play().catch(() => {});
    }

    return;
  }

  wrap.innerHTML = `<video src="${video.url}" autoplay playsinline loop ${
    settings.mutedAutoplay ? "muted" : ""
  }></video>`;

  wrap.querySelector("video").onerror = scheduleReload;
}

function chipShow() {
  const chip = $("#tvChip");

  if (!chip) {
    return;
  }

  chip.textContent = `SCREEN ${code} · ${localStorage.getItem(LS.gym) || ""} · ${
    localStorage.getItem(LS.name) || ""
  }`;

  chip.hidden = false;

  clearTimeout(chip._t);

  chip._t = setTimeout(() => {
    chip.hidden = true;
  }, 6000);
}

async function poll() {
  try {
    const now = Date.now();

    let url = `/api/tv/state?code=${encodeURIComponent(code)}`;

    if (now - lastHeartbeat >= HEARTBEAT_MS) {
      url += "&hb=1";
      lastHeartbeat = now;
    }

    const res = await fetch(url, {
      cache: "no-store",
    });

    if (res.status === 404) {
      localStorage.removeItem(LS.code);
      location.reload();
      return;
    }

    if (!res.ok) {
      throw new Error("Bad state response");
    }

    const state = await res.json();

    failCount = 0;
    $("#lost").hidden = true;

    settings = {
      ...settings,
      ...state.settings,
    };

    if (
      state.reloadToken &&
      localStorage.getItem(LS.tok) !== state.reloadToken
    ) {
      localStorage.setItem(LS.tok, state.reloadToken);
      location.reload();
      return;
    }

    if (state.video) {
      playVideo(state.video);
    } else {
      showStandby();
    }

    if (!started) {
      started = true;
      chipShow();
    }

    clearInterval(pollTimer);

    pollTimer = setInterval(
      poll,
      Math.max(60, Number(settings.pollSeconds) || 60) * 1000
    );
  } catch {
    failCount += 1;

    if (failCount >= 3) {
      $("#lost").hidden = false;
    }
  }
}

const digits = [...document.querySelectorAll(".digit")];

digits.forEach((digit, index) => {
  digit.addEventListener("input", () => {
    digit.value = digit.value.replace(/\D/g, "");

    if (digit.value && index < 3) {
      digits[index + 1].focus();
    }
  });

  digit.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !digit.value && index > 0) {
      digits[index - 1].focus();
    }
  });

  digit.addEventListener("paste", (event) => {
    const text = (event.clipboardData.getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, 4);

    if (!text) {
      return;
    }

    event.preventDefault();

    text.split("").forEach((char, i) => {
      digits[i].value = char;
    });

    digits[Math.min(text.length, 3)].focus();
  });
});

$("#btnActivate").addEventListener("click", async () => {
  const value = digits.map((digit) => digit.value).join("");
  const error = $("#actError");

  error.hidden = true;

  if (value.length < 4) {
    error.textContent = "Enter all 4 digits.";
    error.hidden = false;
    return;
  }

  try {
    const res = await fetch("/api/tv/activate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: value,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Activation failed.");
    }

    localStorage.setItem(LS.code, data.tv.code);
    localStorage.setItem(LS.name, data.tv.name);
    localStorage.setItem(LS.gym, data.tv.gym);

    code = data.tv.code;

    userGesture();
    boot();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;

    digits.forEach((digit) => {
      digit.value = "";
    });

    digits[0].focus();
  }
});

function boot() {
  if (!code) {
    $("#startOverlay").classList.add("off");
    show("stage-activate");

    if (digits[0]) {
      digits[0].focus();
    }

    return;
  }

  showStandby();
  poll();
}

boot();