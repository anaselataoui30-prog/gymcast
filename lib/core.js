export const DEFAULT_SETTINGS = {
  fallbackVideoId: null,
  pollSeconds: 60,
  standbyText: "STANDBY",
  mutedAutoplay: false,
  autoReloadOnError: true,
};

const STATE_KEY = "data/state.json";
const COOKIE_NAME = "gymcast_session";

const memory = globalThis.__gymcast = globalThis.__gymcast || {};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function normalizeCode(value) {
  return String(value || "").trim().replace(/\D/g, "").slice(0, 4).padStart(4, "0");
}

export function getMediaBase(env) {
  return String(env.PUBLIC_MEDIA_BASE_URL || env.MEDIA_BASE_URL || "").replace(/\/+$/, "");
}

function defaultState() {
  return {
    tvs: [
      {
        code: "0001",
        name: "Demo Screen",
        gym: "G1",
        playlistIds: [],
        reloadToken: null,
        createdAt: Date.now(),
        activatedAt: null,
      },
    ],
    videos: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export async function readState(env) {
  let state;

  if (!env.BUCKET) {
    if (!memory.state) memory.state = defaultState();
    state = memory.state;
  } else {
    const object = await env.BUCKET.get(STATE_KEY);

    if (!object) {
      state = defaultState();
      await writeState(env, state);
      return state;
    }

    let parsed;
    try { parsed = await object.json(); } catch { parsed = {}; }

    state = {
      tvs: [],
      videos: [],
      settings: { ...DEFAULT_SETTINGS },
      ...parsed,
    };
  }

  // Migration: old single videoId -> new playlistIds array
  let migrated = false;
  for (const tv of state.tvs) {
    if (!Array.isArray(tv.playlistIds)) {
      tv.playlistIds = tv.videoId ? [tv.videoId] : [];
      migrated = true;
    }
    if (tv.videoId) {
      delete tv.videoId;
      migrated = true;
    }
  }
  if (migrated) await writeState(env, state);

  return state;
}

export async function writeState(env, state) {
  if (!env.BUCKET) {
    memory.state = state;
    return;
  }

  await env.BUCKET.put(STATE_KEY, JSON.stringify(state, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

const encoder = new TextEncoder();

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(env) {
  if (!env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set.");
  return crypto.subtle.importKey("raw", encoder.encode(env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, message) {
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bufferToBase64Url(signature);
}

export async function createSessionCookie(env, secure = true) {
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const signature = await sign(env, expires);
  const parts = [
    `${COOKIE_NAME}=${expires}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  const expiresNum = Number(expires);
  if (isNaN(expiresNum) || expiresNum < Date.now()) return false;
  const expected = await sign(env, expires);
  return expected === signature;
}

// ---------- session tokens (Bearer) ----------
export async function createToken(env, ttlMs) {
  const expires = String(Date.now() + (ttlMs || 7 * 24 * 60 * 60 * 1000));
  const signature = await sign(env, expires);
  return expires + "." + signature;
}

export async function verifyToken(env, token) {
  if (!env.ADMIN_PASSWORD || !token) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false;
  const expires = parts[0];
  const signature = parts[1];
  const exp = Number(expires);
  if (isNaN(exp) || exp < Date.now()) return false;
  const expected = await sign(env, expires);
  return expected === signature;
}
