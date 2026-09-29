import {
  createSessionCookie,
  json,
} from "../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const { env, request } = context;

  if (!env.ADMIN_PASSWORD) {
    return json(
      {
        error:
          "ADMIN_PASSWORD is not set. Add it in Cloudflare Pages environment variables.",
      },
      500
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ error: "Wrong password." }, 401);
  }

  const url = new URL(request.url);
  const secure = url.protocol === "https:" || url.hostname === "localhost";

  const cookie = await createSessionCookie(env, secure);

  return new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": cookie,
      },
    }
  );
}
