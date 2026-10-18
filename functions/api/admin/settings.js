import {
  DEFAULT_SETTINGS,
  json,
  readState,
  writeState,
} from "../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "PUT") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body = {};

  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const state = await readState(context.env);

  const settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
  };

  if ("fallbackVideoId" in body) {
    settings.fallbackVideoId =
      body.fallbackVideoId &&
      state.videos.some((video) => video.id === body.fallbackVideoId)
        ? body.fallbackVideoId
        : null;
  }

  if (body.pollSeconds != null) {
    settings.pollSeconds = Math.min(
      600,
      Math.max(60, Number(body.pollSeconds) || 60)
    );
  }

  if (body.standbyText != null) {
    settings.standbyText = String(body.standbyText).slice(0, 40);
  }

  if ("mutedAutoplay" in body) {
    settings.mutedAutoplay = Boolean(body.mutedAutoplay);
  }

  if ("autoReloadOnError" in body) {
    settings.autoReloadOnError = Boolean(body.autoReloadOnError);
  }

  // ===== NEW: gym display labels (dictionary: stored value -> nice name) =====
  if (body.gymNames && typeof body.gymNames === "object" && !Array.isArray(body.gymNames)) {
    const clean = {};
    for (const [k, v] of Object.entries(body.gymNames)) {
      if (typeof v === "string" && v.trim()) {
        clean[String(k).slice(0, 60)] = v.trim().slice(0, 60);
      }
    }
    settings.gymNames = clean;
  }
  // ==========================================================================

  state.settings = settings;

  await writeState(context.env, state);

  return json({
    ok: true,
    settings,
  });
}
