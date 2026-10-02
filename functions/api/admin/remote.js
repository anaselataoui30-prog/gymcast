import { json, normalizeCode } from "../../../lib/core.js";

const CMD_KEY = "data/commands.json";
const ALLOWED = ["play","pause","seek","mute","unmute","volup","voldown","next","prev","replay","blackout"];

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const env = context.env;

  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }

  const code = normalizeCode(body.code);
  const cmd = String(body.cmd || "");
  const arg = Number(body.arg) || 0;

  if (!code || code === "0000") return json({ error: "Missing code." }, 400);
  if (!ALLOWED.includes(cmd)) return json({ error: "Unknown command." }, 400);

  let cmds = {};

  if (env.BUCKET) {
    const obj = await env.BUCKET.get(CMD_KEY);
    if (obj) { try { cmds = await obj.json(); } catch { cmds = {}; } }
  } else {
    cmds = (globalThis.__gymcast && globalThis.__gymcast.cmds) || {};
  }

  const prev = cmds[code];
  cmds[code] = { seq: (prev && prev.seq ? prev.seq : 0) + 1, cmd, arg, ts: Date.now() };

  if (env.BUCKET) {
    await env.BUCKET.put(CMD_KEY, JSON.stringify(cmds), { httpMetadata: { contentType: "application/json" } });
  } else {
    globalThis.__gymcast = globalThis.__gymcast || {};
    globalThis.__gymcast.cmds = cmds;
  }

  return json({ ok: true, seq: cmds[code].seq });
}
