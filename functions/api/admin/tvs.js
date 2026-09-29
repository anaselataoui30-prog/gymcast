import {
  json,
  normalizeCode,
  readState,
  writeState,
} from "../../../lib/core.js";

const GYMS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body = {};

  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  const code = normalizeCode(body.code);

  if (!code || code === "0000") {
    return json({ error: "Invalid screen code." }, 400);
  }

  const state = await readState(context.env);

  if (state.tvs.some((tv) => tv.code === code)) {
    return json({ error: `Code ${code} already exists.` }, 409);
  }

  state.tvs.push({
    code,
    name: String(body.name || "").slice(0, 60) || `Screen ${code}`,
    gym: GYMS.includes(body.gym) ? body.gym : "G1",
    videoId: null,
    reloadToken: null,
    createdAt: Date.now(),
    activatedAt: null,
  });

  await writeState(context.env, state);

  return json(
    {
      ok: true,
      code,
    },
    201
  );
}