import { json, normalizeCode, readState, writeState } from "../../../lib/core.js";

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }

  const codes = Array.isArray(body.codes) ? body.codes.map((code) => normalizeCode(code)) : [];
  const playlistIds = Array.isArray(body.playlistIds) ? body.playlistIds : [];

  if (!codes.length) return json({ error: "No screens selected." }, 400);

  const state = await readState(context.env);

  if (playlistIds.length > 0) {
    const validIds = new Set(state.videos.map((v) => v.id));
    for (const id of playlistIds) {
      if (!validIds.has(id)) return json({ error: `Video ${id} not found.` }, 404);
    }
  }

  const wanted = new Set(codes);
  let updated = 0;

  for (const tv of state.tvs) {
    if (wanted.has(tv.code)) {
      tv.playlistIds = playlistIds;
      updated += 1;
    }
  }

  await writeState(context.env, state);
  return json({ ok: true, updated });
}
