// stt.mjs — server speech-to-text fallback, used when the phone's built-in
// SpeechRecognition is missing or fights WebRTC for the mic.
// POST { id, lang, mime, audio: <base64> }  →  { id, text }
//
// TODO(Jake): pick a provider and fill in transcribe(). Until then this returns
// an empty transcript, and the radio shows "no caption" (voice still works).
// Never log or store the audio or the transcript.

import { requireUser } from "../lib/allen-auth.js";

const MAX_AUDIO_B64 = 4_000_000; // ~3 MB of audio, well under the 6 MB function limit

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Return the transcript string for the clip. Provider key goes in a Netlify env var.
async function transcribe(/* audioBytes, mime, lang */) {
  return "";
}

export default async (req) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  let body;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }

  const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
  const lang = typeof body.lang === "string" ? body.lang.slice(0, 16) : "";
  const mime = typeof body.mime === "string" ? body.mime.slice(0, 64) : "audio/webm";
  if (typeof body.audio !== "string" || !body.audio || body.audio.length > MAX_AUDIO_B64) {
    return reply(400, { id, error: "bad_audio", text: "" });
  }

  try {
    const text = await transcribe(Buffer.from(body.audio, "base64"), mime, lang);
    return reply(200, { id, text: (text || "").trim(), provider: "stub" });
  } catch (err) {
    console.error("stt failed", err?.name);
    return reply(502, { id, error: "upstream", text: "" });
  }
};
