// Lock-screen notifications (Web Push). Subscriptions and "who's looking at the radio"
// heartbeats live in Netlify Blobs; the VAPID signing keys are created on first use and kept
// in Blobs too, so there is nothing to configure in Netlify.

import webpush from "web-push";
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const SUBJECT = "https://allenradio.netlify.app";
const ACTIVE_MS = 45_000; // a phone that checked in this recently has the radio on screen

const store = () => getStore({ name: "push", consistency: "strong" });
export const subIdOf = (endpoint) => createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);

export async function vapidKeys() {
  const s = store();
  let keys = await s.get("config/vapid", { type: "json" });
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    await s.setJSON("config/vapid", fresh, { onlyIfNew: true });
    keys = (await s.get("config/vapid", { type: "json" })) || fresh; // whoever wrote first wins
  }
  return keys;
}

export async function saveSubscription({ subscription, crew, lang, name }) {
  const subId = subIdOf(subscription.endpoint);
  await store().setJSON(`subs/${subId}`, { subscription, crew, lang, name, at: Date.now() });
  return subId;
}

export async function removeSubscription(subId) {
  const s = store();
  await s.delete(`subs/${subId}`);
  await s.delete(`seen/${subId}`);
}

// away = true when the radio goes off screen, so alerts start right away.
export async function markSeen(subId, away) {
  await store().setJSON(`seen/${subId}`, { t: away ? 0 : Date.now() });
}

// Send one message to everyone in the crew who isn't looking at the radio, in their language.
// build(lang) returns { title, body, urgent }.
export async function notifyCrew({ crew, exceptSubId, tag, build }) {
  const s = store();
  const { publicKey, privateKey } = await vapidKeys();
  webpush.setVapidDetails(SUBJECT, publicKey, privateKey);

  const { blobs } = await s.list({ prefix: "subs/" });
  const now = Date.now();
  let sent = 0;
  await Promise.all(blobs.map(async ({ key }) => {
    const subId = key.slice(5);
    if (subId === exceptSubId) return;
    const sub = await s.get(key, { type: "json" });
    if (!sub || sub.crew !== crew) return;
    const seen = await s.get(`seen/${subId}`, { type: "json" });
    if (seen && now - seen.t < ACTIVE_MS) return; // radio is open on that phone; it already got the message
    const msg = build(sub.lang);
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify({ ...msg, tag }), {
        TTL: 300, urgency: msg.urgent ? "high" : "normal",
      });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await removeSubscription(subId); // phone unsubscribed
      else console.error("push failed", err.statusCode ?? err.name);
    }
  }));
  return sent;
}
