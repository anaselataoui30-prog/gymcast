import { json, normalizeCode } from "../../../lib/core.js";

const CMD_KEY = "data/commands.json";
const ALLOWED = ["play","pause","seek","mute","unmute","volup","voldown","next","prev","replay","blackout"];

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const env = context.env;

  let body = {};
  try { body = await context.request.json(); } catch { body = {}; }

  // one code OR many codes — same endpoint
  let codes = [];
  if (Array.isArray(body.codes)) codes = body.codes.map(normalizeCode);
  else if (body.code) codes = [normalizeCode(body.code)];
  codes = [...new Set(codes.filter((c) => c && c !== "0000"))].slice(0, 500);

  const cmd = String(body.cmd || "");
  const arg = Number(body.arg) || 0;

  if (!codes.length) return json({ error: "No screens selected." }, 400);
  if (!ALLOWED.includes(cmd)) return json({ error: "Unknown command." }, 400);

  let cmds = {};
  if (env.BUCKET) {
    const obj = await env.BUCKET.get(CMD_KEY);
    if (obj) { try { cmds = await obj.json(); } catch { cmds = {}; } }
  } else {
    cmds = (globalThis.__gymcast && globalThis.__gymcast.cmds) || {};
  }

  const ts = Date.now();
  for (const code of codes) {
    const prev = cmds[code];
    cmds[code] = { seq: (prev && prev.seq ? prev.seq : 0) + 1, cmd, arg, ts };
  }

  if (env.BUCKET) {
    await env.BUCKET.put(CMD_KEY, JSON.stringify(cmds), { httpMetadata: { contentType: "application/json" } });
  } else {
    globalThis.__gymcast = globalThis.__gymcast || {};
    globalThis.__gymcast.cmds = cmds;
  }

  return json({ ok: true, sent: codes.length });
}
