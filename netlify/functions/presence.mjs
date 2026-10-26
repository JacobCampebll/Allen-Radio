// presence.mjs — who's on the radio right now, per crew (for the counts on the start screen).
//
// POST { deviceId, crew, name, peerId?, subId?, away? } → check-in every 20 s while the radio is on screen;
//                                                away = true when it leaves. Also tells lock-screen
//                                                alerts this phone is looking at the radio.
//                                                Replies { count, peers } = people on that crew now and
//                                                where to reach them, so the phone dials only real phones.
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
  const peers = Object.fromEntries(CREWS.map((c) => [c, []]));
  await Promise.all(blobs.map(async ({ key }) => {
    const p = await s.get(key, { type: "json" });
    if (!p) return;
    if (now - p.t > FORGET_MS) return s.delete(key);
    if (now - p.t <= ACTIVE_MS && out[p.crew] !== undefined) {
      out[p.crew]++; names[p.crew].push(p.name);
      if (p.peer) peers[p.crew].push(p.peer);
    }
  }));
  for (const c of CREWS) names[c].sort((a, b) => a.localeCompare(b));
  return { counts: out, names, peers };
}

export default async (req) => {
  if (!sameSite(req)) return reply(403, { error: "forbidden" });
  try {
    if (req.method === "GET" && new URL(req.url).searchParams.has("diag")) {
      // Recent reports from phones stuck reconnecting (last hour).
      const ds = getStore("presence-diag");
      const { blobs } = await ds.list();
      const out = [];
      for (const { key } of blobs) {
        const d = await ds.get(key, { type: "json" });
        if (!d || Date.now() - d.t > 3600_000) { await ds.delete(key); continue; }
        out.push({ phone: key, ...d });
      }
      return reply(200, out);
    }
    if (req.method === "GET") { const { counts: c, names } = await counts(); return reply(200, { counts: c, names }); }
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
      const diag = JSON.stringify(body.diag).slice(0, 1500);
      console.log("radio stuck", body.deviceId.slice(0, 6), String(body.crew).slice(0, 10), diag);
      await getStore("presence-diag").set(`${body.deviceId.slice(0, 6)}`, JSON.stringify({ t: Date.now(), crew: String(body.crew).slice(0, 10), diag: JSON.parse(diag.endsWith("}") ? diag : "{}") }));
      return reply(200, { ok: true });
    }

    const s = store();
    if (body.away === true) await s.delete(`on/${body.deviceId}`);
    else {
      if (!CREWS.includes(body.crew)) return reply(400, { error: "bad_request" });
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : "";
      const peer = typeof body.peerId === "string" && /^allen-field-radio-[a-z0-9-]{1,40}$/.test(body.peerId) ? body.peerId : undefined;
      await s.setJSON(`on/${body.deviceId}`, { crew: body.crew, name: name || "?", peer, t: Date.now() });
    }
    if (hex(body.subId, 32)) await markSeen(body.subId, body.away === true);
    if (body.away === true) return reply(200, { ok: true });
    const now = await counts();
    return reply(200, { ok: true, count: now.counts[body.crew], peers: now.peers[body.crew] });
  } catch (err) {
    console.error("presence failed", err?.name);
    return reply(500, { error: "storage" });
  }
};

// One check-in every 20 s per open radio, plus start-screen polling every 10 s.
export const config = {
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
