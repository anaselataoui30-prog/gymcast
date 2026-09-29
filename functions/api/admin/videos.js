import {
  getMediaBase,
  json,
  readState,
  writeState,
} from "../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body = {};

  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const title = String(body.title || "").trim().slice(0, 80);
  const url = String(body.url || "").trim();

  if (!title || !/^https?:\/\//i.test(url)) {
    return json({ error: "Give it a title and a full http(s) URL." }, 400);
  }

  const state = await readState(context.env);
  const id = crypto.randomUUID().slice(0, 8);
  const mediaBase = getMediaBase(context.env);

  const video = {
    id,
    title,
    url,
    source: mediaBase && url.startsWith(mediaBase) ? "r2" : "external",
    createdAt: Date.now(),
  };

  state.videos.push(video);

  await writeState(context.env, state);

  return json(
    {
      ok: true,
      video,
    },
    201
  );
}