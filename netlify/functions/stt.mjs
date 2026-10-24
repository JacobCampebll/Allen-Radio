// stt.mjs — server speech-to-text. Used by iPhones (Apple's recognizer can fight the radio for
// the mic) and by any phone whose built-in recognizer is missing or conflicts.
// POST { id, lang, mime, audio: <base64> }  →  { id, text }
//
// Uses Google Gemini with your own GEMINI_API_KEY (Netlify env vars). Requests go straight to
// Google: Netlify AI Gateway may still inject GOOGLE_GEMINI_BASE_URL, and it rejects outside keys.
// Never log or store the audio or the transcript.
// No sign-in, so this endpoint is public: other websites are refused and Netlify rate-limits each IP.

import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.8-flash";
const MAX_AUDIO_B64 = 4_000_000; // ~3 MB of audio, well under the 6 MB function limit
const LANG_NAMES = { en: "English", es: "Spanish" };

const instructions = (lang) =>
  `Transcribe this two-way radio clip from an asphalt paving crew, word for word, in ${LANG_NAMES[lang] || "English or Spanish"}. ` +
  "Jobsite words include paver, roller, tack, milling machine, flagger, haul truck, lane closure, shoulder, cones, " +
  "the mat, tons, troca, la pavimentadora, el rodillo, el banderero, toneladas. " +
  "Write numbers as digits (truck 12, station 12+50, 200 tons). " +
  "Output only the transcript, with no quotes, labels or notes. If there is no clear speech, output nothing.";

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

export default async (req) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!sameSite(req)) return reply(403, { error: "forbidden" });

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }

  const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
  const lang = typeof body.lang === "string" ? body.lang.slice(0, 2).toLowerCase() : "";
  const mime = (typeof body.mime === "string" && body.mime ? body.mime : "audio/webm").split(";")[0].trim().toLowerCase();
  if (typeof body.audio !== "string" || !body.audio || body.audio.length > MAX_AUDIO_B64) {
    return reply(400, { id, error: "bad_audio", text: "" });
  }
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) return reply(503, { id, error: "not_configured", text: "" });

  try {
    // Google rejects deadlines under 10 s, so cut the call off ourselves (the page waits 9 s).
    const ai = new GoogleGenAI({ httpOptions: { baseUrl: "https://generativelanguage.googleapis.com" } });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: body.audio } }, { text: instructions(lang) }] }],
      config: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: "LOW" }, abortSignal: AbortSignal.timeout(8500) },
    });
    const text = (res.text || "").replace(/^["'“”]+|["'“”]+$/g, "").trim().slice(0, 600);
    return reply(200, { id, text });
  } catch (err) {
    // Log only the error class/status — never the audio or transcript.
    const status = typeof err?.status === "number" ? err.status : undefined;
    console.error("stt failed", err?.name, status ?? "");
    return reply(502, { id, error: "upstream", upstreamStatus: status ?? null, reason: String(err?.message || "").slice(0, 200), text: "" });
  }
};

export const config = {
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
