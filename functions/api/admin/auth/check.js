import { json } from "../../../../lib/core.js";

// NO PASSWORD MODE (temporary): always answer "yes, logged in".
export async function onRequest(context) {
  return json({ authed: true });
}
