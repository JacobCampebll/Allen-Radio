// presence.mjs — who's on the radio right now, per crew (for the counts on the start screen).
//
// POST { deviceId, crew, name, subId?, away? } → check-in every 20 s while the radio is on screen;
//                                                away = true when it leaves. Also tells lock-screen
//                                                alerts this phone is looking at the radio.
//                                                Replies { count } = people on that crew now, so the
//                                                phone can tell if it's missing someone.
// GET                                          → { counts: { Beaver: 2, ... }, names: { Beaver: ["Jake", ...] } }
//
// No sign-in, so this is public: other websites are refused and Netlify rate-limits each IP.

import { getStore } from "@netlify/blobs";
import { CREWS } from "../lib/crew-log.js";
import { markSeen } from "../lib/push.js";

const ACTIVE_MS = 45_000;          // counted as "on" if it checked in this recently
const FORGET_MS = 10 * 60_000;     // stale check-ins are deleted after this

const store = () => getStore({ name: "presence", consistency: "strong" });
const hex = (v, n) => typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sameSite(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function counts() {
  const s = store();
  const now = Date.now();
  const { blobs } = await s.list({ prefix: "on/" });
  const out = Object.fromEntries(CREWS.map((c) => [c, 0]));
  const names = Object.fromEntries(CREWS.map((c) => [c, []]));
  await Promise.all(blobs.map(async ({ key }) => {
    const p = await s.get(key, { type: "json" });
    if (!p) return;
    if (now - p.t > FORGET_MS) return s.delete(key);
    if (now - p.t <= ACTIVE_MS && out[p.crew] !== undefined) { out[p.crew]++; names[p.crew].push(p.name); }
  }));
  for (const c of CREWS) names[c].sort((a, b) => a.localeCompare(b));
  return { counts: out, names };
}

export default async (req) => {
  if (!sameSite(req)) return reply(403, { error: "forbidden" });
  try {
    if (req.method === "GET") return reply(200, await counts());
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

    let body;
    try {
      body = JSON.parse(await req.text()); // sendBeacon posts as text/plain
    } catch {
      return reply(400, { error: "bad_json" });
    }
    if (!hex(body.deviceId, 32)) return reply(400, { error: "bad_request" });

    // A phone stuck reconnecting sends its recent connection events here for the function log.
    if (body.diag && typeof body.diag === "object") {
      console.log("radio stuck", body.deviceId.slice(0, 6), String(body.crew).slice(0, 10), JSON.stringify(body.diag).slice(0, 1500));
      return reply(200, { ok: true });
    }

    const s = store();
    if (body.away === true) await s.delete(`on/${body.deviceId}`);
    else {
      if (!CREWS.includes(body.crew)) return reply(400, { error: "bad_request" });
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : "";
      await s.setJSON(`on/${body.deviceId}`, { crew: body.crew, name: name || "?", t: Date.now() });
    }
    if (hex(body.subId, 32)) await markSeen(body.subId, body.away === true);
    if (body.away === true) return reply(200, { ok: true });
    return reply(200, { ok: true, count: (await counts()).counts[body.crew] });
  } catch (err) {
    console.error("presence failed", err?.name);
    return reply(500, { error: "storage" });
  }
};

// One check-in every 20 s per open radio, plus start-screen polling every 10 s.
export const config = {
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
