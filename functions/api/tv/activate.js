import {
  json,
  normalizeCode,
  readState,
  writeState,
} from "../../../lib/core.js";

export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const code = normalizeCode(body.code);

  if (!code || code === "0000") {
    return json({ error: "Enter a valid 4-digit screen code." }, 400);
  }

  const state = await readState(env);
  const tv = state.tvs.find((item) => item.code === code);

  if (!tv) {
    return json(
      { error: `Screen code ${code} was not found.` },
      404
    );
  }

  if (!tv.activatedAt) {
    tv.activatedAt = Date.now();
    await writeState(env, state);
  }

  return json({
    ok: true,
    tv: {
      code: tv.code,
      name: tv.name,
      gym: tv.gym,
    },
  });
}