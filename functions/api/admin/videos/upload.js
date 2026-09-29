import {
  getMediaBase,
  json,
  readState,
  writeState,
} from "../../../../lib/core.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi", "m3u8", "ts"];

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const env = context.env;

  if (!env.BUCKET) {
    return json({ error: "R2 bucket binding BUCKET is missing." }, 500);
  }

  const mediaBase = getMediaBase(env);

  if (!mediaBase) {
    return json(
      { error: "Set PUBLIC_MEDIA_BASE_URL to your public R2 domain." },
      500
    );
  }

  let form;

  try {
    form = await context.request.formData();
  } catch {
    return json({ error: "Invalid form data." }, 400);
  }

  const file = form.get("file");
  const title = String(form.get("title") || "").trim().slice(0, 80);

  if (!(file instanceof File)) {
    return json({ error: "No file uploaded." }, 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return json(
      { error: "File too large for browser upload. Upload it directly to R2, then use Import From R2." },
      413
    );
  }

  const extension = String(file.name.split(".").pop() || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return json({ error: "Unsupported file type." }, 400);
  }

  const id = crypto.randomUUID().slice(0, 8);
  const key = `videos/${id}.${extension}`;

  const contentType =
    file.type ||
    (extension === "m3u8"
      ? "application/vnd.apple.mpegurl"
      : extension === "ts"
      ? "video/mp2t"
      : "video/mp4");

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      title: title || file.name,
    },
  });

  const url = `${mediaBase}/${key}`;

  const state = await readState(env);

  const video = {
    id,
    title: title || file.name,
    url,
    source: "r2",
    key,
    size: file.size,
    createdAt: Date.now(),
  };

  state.videos.push(video);

  await writeState(env, state);

  return json(
    {
      ok: true,
      video,
    },
    201
  );
}
