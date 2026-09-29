import {
  getMediaBase,
  json,
  readState,
  writeState,
} from "../../../../lib/core.js";

export async function onRequest(context) {
  const method = context.request.method;
  const id = context.params.id;

  const state = await readState(context.env);
  const video = state.videos.find((item) => item.id === id);

  if (!video) {
    return json({ error: "Video not found." }, 404);
  }

  if (method === "PATCH") {
    let body = {};

    try {
      body = await context.request.json();
    } catch {
      body = {};
    }

    if (body.title != null && String(body.title).trim()) {
      video.title = String(body.title).trim().slice(0, 80);
    }

    if (body.url != null) {
      const url = String(body.url).trim();

      if (!/^https?:\/\//i.test(url)) {
        return json({ error: "URL must start with http(s)://" }, 400);
      }

      video.url = url;

      const mediaBase = getMediaBase(context.env);
      video.source = mediaBase && url.startsWith(mediaBase) ? "r2" : "external";
    }

    await writeState(context.env, state);

    return json({ ok: true });
  }

  if (method === "DELETE") {
    if (video.key && context.env.BUCKET) {
      await context.env.BUCKET.delete(video.key);
    }

    state.videos = state.videos.filter((item) => item.id !== id);

    for (const tv of state.tvs) {
      if (tv.videoId === id) {
        tv.videoId = null;
      }
    }

    if (state.settings.fallbackVideoId === id) {
      state.settings.fallbackVideoId = null;
    }

    await writeState(context.env, state);

    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, 405);
}