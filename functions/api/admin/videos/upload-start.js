import { json } from "../../../../lib/core.js";

const ALLOWED = ["mp4", "webm", "mov", "m4v", "mkv", "avi", "m3u8", "ts"];

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const env = context.env;
  if (!env.BUCKET) return json({ error: "R2 bucket binding BUCKET is missing." }, 500);

  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }

  const name = String(body.name || "video.mp4");
  const ext = String(name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ALLOWED.includes(ext)) return json({ error: `Unsupported file type .${ext}` }, 400);

  const id = crypto.randomUUID().slice(0, 8);
  const key = `videos/${id}.${ext}`;

  const mpu = await env.BUCKET.createMultipartUpload(key, {
    httpMetadata: {
      contentType: String(body.type || "video/mp4"),
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  return json({ ok: true, key, uploadId: mpu.uploadId });
}
