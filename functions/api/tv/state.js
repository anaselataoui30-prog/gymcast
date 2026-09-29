import {
  DEFAULT_SETTINGS,
  json,
  normalizeCode,
  readState,
} from "../../../lib/core.js";

import { touchPresence } from "../../../lib/presence.js";

export async function onRequestGet(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const code = normalizeCode(url.searchParams.get("code"));

  if (!code || code === "0000") {
    return json({ error: "Missing screen code." }, 400);
  }

  const state = await readState(env);
  const tv = state.tvs.find((item) => item.code === code);

  if (!tv) {
    return json({ error: "Unknown screen." }, 404);
  }

  if (url.searchParams.get("hb") === "1") {
    await touchPresence(env, code);
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
  };

  const video =
    state.videos.find((item) => item.id === tv.videoId) ||
    state.videos.find((item) => item.id === settings.fallbackVideoId) ||
    null;

  return json({
    tv: {
      code: tv.code,
      name: tv.name,
      gym: tv.gym,
    },
    video,
    settings: {
      pollSeconds: Math.max(60, Number(settings.pollSeconds) || 60),
      standbyText: settings.standbyText,
      mutedAutoplay: Boolean(settings.mutedAutoplay),
      autoReloadOnError: Boolean(settings.autoReloadOnError),
    },
    reloadToken: tv.reloadToken || null,
    storage: env.BUCKET ? "r2" : "memory",
  });
}