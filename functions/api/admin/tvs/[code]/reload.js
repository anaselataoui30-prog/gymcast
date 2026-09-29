import {
  json,
  normalizeCode,
  readState,
  writeState,
} from "../../../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const code = normalizeCode(context.params.code);

  const state = await readState(context.env);
  const tv = state.tvs.find((item) => item.code === code);

  if (!tv) {
    return json({ error: "Screen not found." }, 404);
  }

  tv.reloadToken =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  await writeState(context.env, state);

  return json({ ok: true });
}
