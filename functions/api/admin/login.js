import {
  createSessionCookie,
  json,
} from "../../../lib/core.js";

export async function onRequestPost(context) {
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

  return json(
    {
      ok: true,
    },
    200,
    {
      "set-cookie": cookie,
    }
  );
}