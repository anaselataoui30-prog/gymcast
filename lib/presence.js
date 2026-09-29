const PRESENCE_KEY = "data/presence.json";
const WRITE_THROTTLE_MS = 10 * 60 * 1000;

export const ONLINE_MS = 15 * 60 * 1000;

const memory = globalThis.__gymcast = globalThis.__gymcast || {};

export async function touchPresence(env, code) {
  if (!code) {
    return;
  }

  const now = Date.now();

  if (!env.BUCKET) {
    memory.presence = memory.presence || {};

    if (
      memory.presence[code] &&
      now - memory.presence[code] < WRITE_THROTTLE_MS
    ) {
      return;
    }

    memory.presence[code] = now;
    return;
  }

  let presence = {};

  try {
    const object = await env.BUCKET.get(PRESENCE_KEY);

    if (object) {
      presence = await object.json();
    }
  } catch {
    presence = {};
  }

  if (presence[code] && now - presence[code] < WRITE_THROTTLE_MS) {
    return;
  }

  presence[code] = now;

  await env.BUCKET.put(PRESENCE_KEY, JSON.stringify(presence, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

export async function getPresence(env) {
  if (!env.BUCKET) {
    return memory.presence || {};
  }

  try {
    const object = await env.BUCKET.get(PRESENCE_KEY);

    if (!object) {
      return {};
    }

    return await object.json();
  } catch {
    return {};
  }
}