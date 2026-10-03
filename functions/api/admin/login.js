import { json, createToken } from "../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const { env, request } = context;

  if (!env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD is not set in Cloudflare Pages environment variables." }, 500);
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  if (String(body.password || "") !== String(env.ADMIN_PASSWORD)) {
    return json({ error: "Wrong password." }, 401);
  }

  const token = await createToken(env);

  return json({ ok: true, token });
}
