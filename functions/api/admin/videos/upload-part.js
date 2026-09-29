import { json } from "../../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const env = context.env;
  if (!env.BUCKET) return json({ error: "R2 bucket binding BUCKET is missing." }, 500);

  const key = context.request.headers.get("x-gc-key");
  const uploadId = context.request.headers.get("x-gc-upload");
  const partNumber = Number(context.request.headers.get("x-gc-part"));

  if (!key || !uploadId || !partNumber) return json({ error: "Missing upload headers." }, 400);

  const data = await context.request.arrayBuffer();
  if (!data.byteLength) return json({ error: "Empty chunk." }, 400);

  const mpu = await env.BUCKET.resumeMultipartUpload(key, uploadId);
  const part = await mpu.uploadPart(partNumber, data);

  return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
}
