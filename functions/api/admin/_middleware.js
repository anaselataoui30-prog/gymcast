import { json, verifyToken } from "../../../lib/core.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // the login door stays open
  if (url.pathname === "/api/admin/login") {
    return context.next();
  }

  const auth = context.request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!(await verifyToken(context.env, token))) {
    return json({ error: "Not logged in." }, 401);
  }

  return context.next();
}
