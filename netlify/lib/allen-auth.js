// allen-auth.js — verify the Supabase Bearer token sent by the shared Allen login block.
// If you already have the org-wide allen-auth.js, drop it in here instead; the functions
// only rely on `requireUser(req)` returning { user } or { response }.
//
// Env vars (Netlify → Site configuration → Environment variables, scope: Functions):
//   SUPABASE_URL       e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY  the project's publishable / anon key

const CACHE_MS = 60_000;
const cache = new Map(); // token -> { user, exp }

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function requireUser(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: json(401, { error: "missing_token" }) };

  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return { user: hit.user };

  const url = Netlify.env.get("SUPABASE_URL");
  const anon = Netlify.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { response: json(500, { error: "auth_not_configured" }) };

  let res;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: anon },
    });
  } catch {
    return { response: json(502, { error: "auth_unreachable" }) };
  }
  if (!res.ok) return { response: json(401, { error: "invalid_token" }) };

  const user = await res.json();
  if (cache.size > 500) cache.clear();
  cache.set(token, { user, exp: Date.now() + CACHE_MS });
  return { user };
}
