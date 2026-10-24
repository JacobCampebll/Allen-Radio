// stt.mjs — server speech-to-text. iPhones always use this (their built-in recognizer can
// fight the radio for the mic); other phones fall back to it if their recognizer is missing
// or conflicts.
// POST { id, lang, mime, audio: <base64> }  →  { id, text }
//
// Uses OpenAI transcription through Netlify AI Gateway: Netlify injects OPENAI_API_KEY and
// OPENAI_BASE_URL at runtime, so there is no OpenAI account or key to manage.
// Never log or store the audio or the transcript.
// No sign-in, so this endpoint is public: other websites are refused and Netlify rate-limits each IP.

import OpenAI, { toFile } from "openai";

const MODEL = "gpt-4o-mini-transcribe";
const MAX_AUDIO_B64 = 4_000_000; // ~3 MB of audio, well under the 6 MB function limit

// Vocabulary hint so jobsite words and numbers come out right.
const PROMPT =
  "Two-way radio on an asphalt paving crew. Words like paver, roller, tack, milling machine, " +
  "flagger, haul truck, lane closure, shoulder, cones, the mat, tons, station 12+50, truck 12. " +
  "Spanish may include troca, la pavimentadora, el rodillo, el banderero, toneladas.";

const EXT = { "audio/mp4": "m4a", "audio/aac": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav" };

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
  const mime = (typeof body.mime === "string" ? body.mime : "audio/webm").split(";")[0].trim().toLowerCase();
  if (typeof body.audio !== "string" || !body.audio || body.audio.length > MAX_AUDIO_B64) {
    return reply(400, { id, error: "bad_audio", text: "" });
  }
  if (!process.env.OPENAI_API_KEY) return reply(503, { id, error: "not_configured", text: "" });

  try {
    const client = new OpenAI({ timeout: 8000, maxRetries: 0 }); // key + base URL injected by Netlify
    const file = await toFile(Buffer.from(body.audio, "base64"), `clip.${EXT[mime] || "webm"}`, { type: mime });
    const result = await client.audio.transcriptions.create({
      file,
      model: MODEL,
      ...(lang === "en" || lang === "es" ? { language: lang } : {}),
      prompt: PROMPT,
      response_format: "json",
    });
    return reply(200, { id, text: (result.text || "").trim().slice(0, 600) });
  } catch (err) {
    // Log only the error class/status — never the audio or transcript.
    const status = err instanceof OpenAI.APIError ? err.status : undefined;
    console.error("stt failed", err?.name, status ?? "");
    const reason = err instanceof OpenAI.APIError ? String(err.message || "").slice(0, 200) : "";
    return reply(502, { id, error: "upstream", upstreamStatus: status ?? null, reason, text: "" });
  }
};

export const config = {
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
