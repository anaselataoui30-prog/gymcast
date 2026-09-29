import {
  DEFAULT_SETTINGS,
  getMediaBase,
  json,
  readState,
} from "../../../lib/core.js";

import { getPresence } from "../../../lib/presence.js";

export async function onRequestGet(context) {
  const env = context.env;

  const state = await readState(env);
  const presence = await getPresence(env);

  let max = 0;

  for (const tv of state.tvs) {
    const parsed = parseInt(tv.code, 10);

    if (!Number.isNaN(parsed)) {
      max = Math.max(max, parsed);
    }
  }

  return json({
    tvs: state.tvs,
    videos: state.videos,
    settings: {
      ...DEFAULT_SETTINGS,
      ...state.settings,
    },
    presence,
    nextCode: String(max + 1).padStart(4, "0"),
    mediaBaseUrl: getMediaBase(env) || null,
  });
}