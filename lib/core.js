// Shared helpers for Gymcast.
// Required Cloudflare Pages settings:
// - R2 bucket binding name: BUCKET
// - Environment variable: ADMIN_PASSWORD
// - Optional environment variable: PUBLIC_MEDIA_BASE_URL

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
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

export function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/\D/g, "")
    .slice(0, 4)
    .padStart(4, "0");
}

export function getMediaBase(env) {
  return String(env.PUBLIC_MEDIA_BASE_URL || env.MEDIA_BASE_URL || "")
    .replace(/\/+$/, "");
}

function defaultState() {
  return {
    tvs: [
      {
        code: "0001",
        name: "Demo Screen",
        gym: "G1",
        videoId: null,
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
  if (!env.BUCKET) {
    if (!memory.state) {
      memory.state = defaultState();
    }
    return memory.state;
  }

  const object = await env.BUCKET.get(STATE_KEY);

  if (!object) {
    const state = defaultState();
    await writeState(env, state);
    return state;
  }

  let parsed;

  try {
    parsed = await object.json();
  } catch {
    parsed = {};
  }

  return {
    tvs: [],
    videos: [],
    settings: { ...DEFAULT_SETTINGS },
    ...parsed,
  };
}

export async function writeState(env, state) {
  if (!env.BUCKET) {
    memory.state = state;
    return;
  }

  await env.BUCKET.put(STATE_KEY, JSON.stringify(state, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

const encoder = new TextEncoder();

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacKey(env) {
  if (!env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is not set.");
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.ADMIN_PASSWORD),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

async function sign(env, message) {
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return bufferToBase64Url(signature);
}

export async function createSessionCookie(env, secure = true) {
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const signature = await sign(env, expires);

  return [
    `${COOKIE_NAME}=${expires}.${signature}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Strict",
    "Max-Age=604800",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parseCookies(cookieHeader = "") {
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

export async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return false;
  }

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return false;
  }

  const [expires, signature] = token.split(".");

  if (!expires || Number(expires) < Date.now()) {
    return false;
  }

  const expected = await sign(env, expires);

  return expected === signature;
}