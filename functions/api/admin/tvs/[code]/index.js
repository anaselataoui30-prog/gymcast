import {
  json,
  normalizeCode,
  readState,
  writeState,
} from "../../../../../lib/core.js";

export async function onRequest(context) {
  const method = context.request.method;
  const code = normalizeCode(context.params.code);

  const state = await readState(context.env);
  const tv = state.tvs.find((item) => item.code === code);

  if (!tv) {
    return json({ error: "Screen not found." }, 404);
  }

  if (method === "PATCH") {
    let body = {};
    try { body = await context.request.json(); } catch { body = {}; }

    if (body.name != null) tv.name = String(body.name).slice(0, 60);
    if (body.gym != null) tv.gym = String(body.gym);

    await writeState(context.env, state);
    return json({ ok: true });
  }

  if (method === "DELETE") {
    state.tvs = state.tvs.filter((item) => item.code !== code);
    await writeState(context.env, state);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, 405);
}
