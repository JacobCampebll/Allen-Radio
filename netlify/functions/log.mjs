// log.mjs — crew message log, kept for 24 hours (see netlify/lib/crew-log.js).
//
// POST { crew, who, lang, id, kind, text, translations, failed, subId, alert, urgent }
//      → saves one timestamped message (the app) and sends lock-screen alerts to the rest of the crew
// GET    ?crew=Beaver|all                                           → the last 24 hours (foreman page)
// DELETE ?crew=Beaver|all                                           → erase that crew's saved messages
//
// No sign-in or passcode: anyone with the link can read or erase the last 24 hours. Other websites are
// refused and Netlify rate-limits each IP.

import { CREWS, KEEP_MS, logStore, keyTime, purgeExpired, eraseAll } from "../lib/crew-log.js";
import { notifyCrew } from "../lib/push.js";

const LANGS = ["en-US", "es-US"];
const KINDS = ["voice", "safety"];
const MAX_TEXT = 600;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

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

async function save(req, context) {
  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }
  const crew = CREWS.includes(body.crew) ? body.crew : "";
  const kind = KINDS.includes(body.kind) ? body.kind : "";
  const text = str(body.text, MAX_TEXT);
  if (!crew || !kind || !text) return reply(400, { error: "bad_request" });

  const translations = {};
  for (const l of LANGS) {
    const t = str(body.translations?.[l], MAX_TEXT);
    if (t) translations[l] = t;
  }
  const now = Date.now();
  const entry = {
    at: new Date(now).toISOString(), // timestamp, set by the server
    crew,
    kind,
    who: str(body.who, 20) || "?",
    lang: LANGS.includes(body.lang) ? body.lang : "",
    text,
    translations,
    failed: body.failed === true,
  };
  const id = str(body.id, 64).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2);
  const store = logStore();
  await store.setJSON(`${crew}/${now}-${id}`, entry);
  // Clear this crew's records past 24 hours after replying (the hourly cleanup also covers it).
  context.waitUntil(purgeExpired([crew], store).catch(() => {}));

  // Lock-screen alerts for everyone in the crew who isn't looking at the radio, in their language.
  // Safety buttons carry their own title per language ("🚨 EMERGENCIA"); voice uses the speaker's name.
  const alert = {};
  for (const l of LANGS) { const a = str(body.alert?.[l], 60); if (a) alert[l] = a; }
  const said = (l) => (l === entry.lang ? text : translations[l] || text);
  context.waitUntil(notifyCrew({
    crew,
    exceptSubId: typeof body.subId === "string" ? body.subId : "",
    tag: `${crew}-${id}`,
    build: (l) => kind === "safety"
      ? { title: alert[l] || alert["en-US"] || "Allen Radio", body: `${entry.who}: ${said(l)}`, urgent: body.urgent === true }
      : { title: entry.who, body: said(l), urgent: false },
  }).catch((err) => console.error("notify failed", err?.name)));
  return reply(200, { ok: true });
}

async function read(req) {
  const crewParam = new URL(req.url).searchParams.get("crew") || "all";
  const crews = crewParam === "all" ? CREWS : CREWS.filter((c) => c === crewParam);
  if (!crews.length) return reply(400, { error: "bad_crew" });

  const store = logStore();
  const cutoff = Date.now() - KEEP_MS;
  const keys = [];
  for (const c of crews) {
    const { blobs } = await store.list({ prefix: `${c}/` });
    keys.push(...blobs.map((b) => b.key).filter((k) => keyTime(k) >= cutoff)); // never show anything past 24 h
  }
  const entries = [];
  for (let i = 0; i < keys.length; i += 25) {
    const batch = await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" })));
    entries.push(...batch.filter(Boolean));
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return reply(200, { crew: crewParam, keepHours: KEEP_MS / 3600000, entries });
}

async function erase(req) {
  const crewParam = new URL(req.url).searchParams.get("crew") || "";
  const crews = crewParam === "all" ? CREWS : CREWS.filter((c) => c === crewParam);
  if (!crews.length) return reply(400, { error: "bad_crew" });
  const removed = await eraseAll(crews);
  return reply(200, { ok: true, removed });
}

export default async (req, context) => {
  if (!sameSite(req)) return reply(403, { error: "forbidden" });
  try {
    if (req.method === "POST") return await save(req, context);
    if (req.method === "GET") return await read(req);
    if (req.method === "DELETE") return await erase(req);
    return reply(405, { error: "method_not_allowed" });
  } catch (err) {
    // Log only the error class — never message text.
    console.error("log failed", err?.name);
    return reply(500, { error: "storage" });
  }
};

export const config = {
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
