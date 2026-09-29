import { isAuthed, json } from "../../../../lib/core.js";

export async function onRequestGet(context) {
  const authed = await isAuthed(context.request, context.env);

  return json({
    authed,
  });
}