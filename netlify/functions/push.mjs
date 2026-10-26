// push.mjs — lock-screen alert sign-up for the radio.
//
// GET                                                       → { publicKey } for the phone to subscribe with
// POST { action: "subscribe", subscription, crew, lang, name } → { subId }
// POST { action: "seen", subId, away }                      → heartbeat: radio on screen (or just left it)
// POST { action: "unsubscribe", subId }
//
// No sign-in, so this is public: other websites are refused and Netlify rate-limits each IP.

import { CREWS } from "../lib/crew-log.js";
import { vapidKeys, saveSubscription, removeSubscription, markSeen } from "../lib/push.js";

const LANGS = ["en-US", "es-US"];

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

const validSubId = (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

export default async (req) => {
  if (!sameSite(req)) return reply(403, { error: "forbidden" });
  try {
    if (req.method === "GET") return reply(200, { publicKey: (await vapidKeys()).publicKey });
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

    let body;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return reply(400, { error: "bad_json" });
    }

    if (body.action === "subscribe") {
      const sub = body.subscription;
      const ok = sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
        && sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string";
      if (!ok || !CREWS.includes(body.crew)) return reply(400, { error: "bad_request" });
      const subId = await saveSubscription({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        crew: body.crew,
        lang: LANGS.includes(body.lang) ? body.lang : "en-US",
        name: typeof body.name === "string" ? body.name.slice(0, 20) : "",
      });
      return reply(200, { subId });
    }
    if (body.action === "seen" && validSubId(body.subId)) {
      await markSeen(body.subId, body.away === true);
      return reply(200, { ok: true });
    }
    if (body.action === "unsubscribe" && validSubId(body.subId)) {
      await removeSubscription(body.subId);
      return reply(200, { ok: true });
    }
    return reply(400, { error: "bad_request" });
  } catch (err) {
    console.error("push signup failed", err?.name);
    return reply(500, { error: "storage" });
  }
};

// Heartbeats come every 30 s per open radio, so allow a bit more than the other functions.
export const config = {
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
