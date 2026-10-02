import { json, normalizeCode } from "../../../lib/core.js";

const CMD_KEY = "data/commands.json";

export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "Method not allowed." }, 405);

  const code = normalizeCode(new URL(context.request.url).searchParams.get("code"));
  if (!code || code === "0000") return json({ error: "Missing code." }, 400);

  let cmds = {};

  if (context.env.BUCKET) {
    const obj = await context.env.BUCKET.get(CMD_KEY);
    if (obj) { try { cmds = await obj.json(); } catch { cmds = {}; } }
  } else {
    cmds = (globalThis.__gymcast && globalThis.__gymcast.cmds) || {};
  }

  return json({ cmd: cmds[code] || null });
}
