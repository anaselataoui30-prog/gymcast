import { getMediaBase, json } from "../../../lib/core.js";

export async function onRequestGet(context) {
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

  const listed = await env.BUCKET.list({
    prefix: "videos/",
    limit: 1000,
  });

  const files = listed.objects
    .filter((object) => !object.key.endsWith("/"))
    .map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded,
      url: `${mediaBase}/${object.key}`,
    }));

  return json({
    files,
  });
}