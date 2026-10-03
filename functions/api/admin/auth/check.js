import { json, verifyToken } from "../../../../lib/core.js";

export async function onRequest(context) {
  const auth = context.request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return json({ authed: await verifyToken(context.env, token) });
}
