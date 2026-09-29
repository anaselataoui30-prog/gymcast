import { json, readState, writeState, getMediaBase } from "../../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const env = context.env;
  if (!env.BUCKET) return json({ error: "R2 bucket binding BUCKET is missing." }, 500);

  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }

  const { key, uploadId, parts, title } = body;
  if (!key || !uploadId || !Array.isArray(parts)) return json({ error: "Missing upload info." }, 400);

  const mpu = await env.BUCKET.resumeMultipartUpload(key, uploadId);
  await mpu.complete(parts);

  const mediaBase = getMediaBase(env);
  const url = mediaBase ? `${mediaBase}/${key}` : `/${key}`;
  const id = key.split("/").pop().split(".")[0];

  const state = await readState(env);
  const video = {
    id,
    title: String(title || key.split("/").pop()).slice(0, 80),
    url,
    source: "r2",
    key,
    createdAt: Date.now(),
  };
  state.videos.push(video);
  await writeState(env, state);

  return json({ ok: true, video }, 201);
}
