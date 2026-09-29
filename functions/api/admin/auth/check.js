import {
  isAuthed,
  json,
} from "../../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authed = await isAuthed(context.request, context.env);

  return json({
    authed,
  });
}
