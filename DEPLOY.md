# Allen Field Radio — Deploy & Smoke Test

## Files

```
C:\Users\<you>\Projects\allen-field-radio\
├─ index.html                     the whole app (CONFIG at top)
├─ netlify.toml
├─ package.json                   pulls in the Anthropic SDK for the function
├─ netlify\functions\translate.mjs   one translation call per transmission
├─ netlify\functions\stt.mjs         server speech-to-text fallback (STUB, see TODO)
└─ netlify\lib\allen-auth.js         checks the Supabase Bearer token
```

If you already have the org-wide `allen-auth.js`, copy it over `netlify\lib\allen-auth.js`.
The functions only call `requireUser(req)` and expect `{ user }` or `{ response }` back.

## 1. Fill in CONFIG (index.html)

Open `index.html` and edit the `CONFIG` block at the top:

| Key | Set to |
|---|---|
| `supabaseUrl` / `supabaseAnonKey` | The shared Allen Supabase project URL and its publishable (anon) key. If you leave these blank, login is skipped and every translation returns 401, so captions show "(not translated)". |
| `translate.model` | Defaults to `claude-haiku-5-5`. The function only accepts `claude-haiku-5-5` or `claude-sonnet-5-5`. |
| `experimental.enabled` | Leave `false` until you know the crew speaks a Mayan language. |
| `glossary[].verified`, `presets[].verified` | Flip to `true` once the bilingual reviewer signs off on each one. |

## 2. Netlify environment variables

Go to Netlify → **allen-field-radio** → Site configuration → Environment variables. Add these with the scope set to **Functions**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key. It lives here only and never goes in the HTML. |
| `SUPABASE_URL` | The same URL as `CONFIG.supabaseUrl` |
| `SUPABASE_ANON_KEY` | The same key as `CONFIG.supabaseAnonKey` |

Redeploy after you change any of these.

## 3. Deploy

Drag-and-drop deploys **do not** run functions, so use one of these instead.

**Option A: Git (recommended).** Connect the site to `JacobCampebll/Allen-Radio` in Netlify. Netlify reads `netlify.toml`, runs `npm install`, and deploys on every push. You don't need a build command.

**Option B: Netlify CLI from Windows**
```
cd C:\Users\<you>\Projects\allen-field-radio
npm install
npm install -g netlify-cli
netlify login
netlify link            (pick allen-field-radio)
netlify deploy --prod
```

For local testing, `netlify dev` serves the page and functions at http://localhost:8888. The mic and speech features need HTTPS or localhost.

## 4. Smoke test (two phones, same channel)

The page shows a small diagnostics line at the bottom with the caption engine and the last caption latency. Record the results in the table below.

1. Phone A: language English. Phone B: Español – Guatemala. Both join the same channel.
2. On A, hold PTT and say "Hold traffic, truck twelve is backing in." B hears the voice. Within about 3 s, B sees and hears Spanish, and the caption keeps "12".
3. On B, say "Ya viene la troca, ¿está listo el paver?" A gets an English caption that keeps "paver".
4. Tap STOP on A. B gets the alarm tone, a red LCD flash, and Spanish speech right away.
5. Remove `ANTHROPIC_API_KEY` and redeploy. Voice still works, and captions show the original with "(not translated)". Put the key back.
6. Record the caption latency, and whether phone speech recognition broke the mic, on each device:

| Device / browser | Caption latency (diag line) | STT conflicted with radio mic? | Notes |
|---|---|---|---|
| Android Chrome | | | |
| iPhone Safari | | | |

**How to tell whether STT conflicted:** In Auto mode, the app watches the radio mic while the phone's speech recognition runs. If the mic track dies, or goes silent while recognition still hears words, the app shows a toast ("can't caption and transmit at once"), switches that phone to server captions, and the diag line reads "phone STT conflicted with mic → server". Also confirm by ear on the other phone: does the voice still come through while captions work?

**If iPhone conflicts:** server captions need a real provider in `stt.mjs` (see the TODO). Until you add one, a conflicting phone transmits voice normally but sends "no caption". You can also set the Captions dropdown to **Off** on that phone.

## 5. Before crews rely on it

- [ ] A bilingual crew member reviews every preset's Spanish wording (GT / MX / general) in `CONFIG.presets`, and you set `verified: true`. The yellow dots go away.
- [ ] The same review for `CONFIG.glossary`.
- [ ] Pick an STT provider for `stt.mjs` if any phone conflicts.
- [ ] Turn on `experimental` (Mayan) only after you confirm what the crew speaks. It shows text captions only and is badged "experimental – may be wrong".

## Privacy

Transcripts pass through the translate function in memory only. The function doesn't store them or log their text (it logs only error class and status). Translation runs once per transmission, on the sender's phone. Receivers make no API calls.
