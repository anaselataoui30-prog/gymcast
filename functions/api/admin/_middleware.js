import { isAuthed, json } from "../../../lib/core.js";

const PUBLIC_PATHS = [
  "/api/admin/login",
  "/api/admin/auth/check",
  "/api/admin/logout",
];

export async function onRequest(context) {
  const request = context.request;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const url = new URL(request.url);

  if (PUBLIC_PATHS.includes(url.pathname)) {
    return context.next();
  }

  const authed = await isAuthed(request, context.env);

  if (!authed) {
    return json({ error: "Not logged in." }, 401);
  }

  return context.next();
}