import { DEFAULT_SETTINGS, json, normalizeCode, readState } from "../../../lib/core.js";
import { touchPresence } from "../../../lib/presence.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "Method not allowed." }, 405);

  const { env, request } = context;
  const url = new URL(request.url);
  const code = normalizeCode(url.searchParams.get("code"));

  if (!code || code === "0000") return json({ error: "Missing screen code." }, 400);

  const state = await readState(env);
  const tv = state.tvs.find((item) => item.code === code);
  if (!tv) return json({ error: "Unknown screen." }, 404);

  if (url.searchParams.get("hb") === "1") await touchPresence(env, code);

  const settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const playlistIds = tv.playlistIds || [];

  const playlist = playlistIds
    .map((id) => state.videos.find((v) => v.id === id))
    .filter(Boolean)
    .map((v) => ({ id: v.id, title: v.title, url: v.url, source: v.source }));

  return json({
    tv: { code: tv.code, name: tv.name, gym: tv.gym },
    playlist,
    paused: Boolean(tv.paused),
    settings: {
      pollSeconds: Math.min(600, Math.max(60, Number(settings.pollSeconds) || 600)),
      standbyText: settings.standbyText,
      mutedAutoplay: Boolean(settings.mutedAutoplay),
      autoReloadOnError: Boolean(settings.autoReloadOnError),
    },
    reloadToken: tv.reloadToken || null,
    resetToken: tv.resetToken || null,
    storage: env.BUCKET ? "r2" : "memory",
  });
}
