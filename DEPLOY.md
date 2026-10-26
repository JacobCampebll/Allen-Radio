# Allen Field Radio — Deploy & Smoke Test

## Files

```
C:\Users\<you>\Projects\allen-field-radio\
├─ index.html                        the whole app (CONFIG at top)
├─ allen-logo-white.png              header logo
├─ netlify.toml
├─ package.json                      pulls in the Anthropic SDK for the function
├─ netlify\functions\translate.mjs   one translation call per transmission (model, prompt, glossary live here)
└─ netlify\functions\stt.mjs         server speech-to-text with Google Gemini (all iPhones use it)
```

## How it works now

- Everyone types their name and picks English or Español. There's no sign-in. The Spanish is neutral Latin American, so crews from Mexico, Guatemala and Honduras all understand it.
- Four crews, each its own channel: Beaver, Powell, Ian, Blake (`CONFIG.crews` in `index.html`; the log function has the same list in `netlify/functions/log.mjs`).
- Safety buttons (STOP, SLOW, HOLD TRAFFIC, CLEAR / GO, TRUCK COMING, BACK UP, EMERGENCY) play an alert and show/speak fixed wording in each person's language.
- Every message is saved, timestamped, to the crew log (Netlify Blobs store `crew-log`) and **deleted after 24 hours**: on each new message, and by the hourly `log-cleanup` scheduled function. Foreman view and CSV download of the last 24 hours at `/log.html` with an **Erase log** button (no passcode: anyone with the link can read or erase the last 24 hours).
- Installable: Add to Home Screen gives an Allen Radio icon and full-screen app.
- Lock-screen alerts (Web Push): crew members who turn on alerts get each message and safety button as a notification, in their language, whenever the radio isn't on their screen. iPhones need the Home Screen app (iOS 16.4+). Text only, no live voice. Subscriptions and VAPID keys live in the Netlify Blobs store `push` (keys are created automatically; nothing to configure). Worker: `push-sw.js`; server: `netlify/functions/push.mjs` and `netlify/lib/push.js`; alerts are sent from `log.mjs` when a message is saved.
- Tap the big button to talk and tap again to send. The mic turns itself off after 30 s (`CONFIG.maxTalkSeconds`).
- The translation shows in the card under the button, with the original underneath and older messages listed below.

## 1. Settings you might change

| Where | What |
|---|---|
| `index.html` → `CONFIG.channel` | The one channel everyone joins |
| `index.html` → `CONFIG.presets[].verified` | Flip to `true` after the bilingual reviewer signs off |
| `translate.mjs` → `GLOSSARY` | Paving terms the translator must use. Set `verified: true` after review |
| `translate.mjs` → `SYSTEM_PROMPT`, `MODEL` | Translation instructions and model (`claude-haiku-5-5`) |

## 2. Netlify environment variable

Go to Netlify → **allen-field-radio** → Site configuration → Environment variables, and add this with the scope set to **Functions**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key, for translations. If it's missing, Netlify's built-in AI Gateway key is used and billed to Netlify credits. |
| `GEMINI_API_KEY` | Your Google Gemini key, for server captions (speech to text). Required: Netlify's gateway key doesn't work for this. |

Redeploy after you change it.

**Because there's no sign-in, the translate function is public.** It's protected three ways:
- The prompt and model are fixed on the server, so it can only translate.
- It refuses calls from other websites.
- Netlify limits each IP to 30 calls a minute.

Anyone with the link can still use the radio. Keep an eye on usage in the Anthropic console, and add sign-in back if that becomes a problem.

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

The page shows a small gray line at the very bottom with the caption engine and the last caption latency. Record the results in the table below.

1. Phone A: language English. Phone B: Español. Both join the same channel.
2. On A, tap the button, say "Hold traffic, truck twelve is backing in.", and tap again. B hears the voice. Within about 3 s, B sees and hears Spanish, and the caption keeps "12".
3. On B, tap, say "Ya viene la troca, ¿está listo el paver?", and tap again. A gets an English caption that keeps "paver".
4. (Only if `showPresets` is on.) Tap STOP on A. B gets the alarm tone, a red flash, and Spanish speech right away.
5. Remove `ANTHROPIC_API_KEY` and redeploy. Voice still works, and captions show the original with "(not translated)". Put the key back.
6. Record the caption latency, and whether phone speech recognition broke the mic, on each device:

| Device / browser | Caption latency (diag line) | STT conflicted with radio mic? | Notes |
|---|---|---|---|
| Android Chrome | | | |
| iPhone Safari | | | |

**How to tell whether STT conflicted:** In Auto mode, the app watches the radio mic while the phone's speech recognition runs. If the mic track dies, or goes silent while recognition still hears words, the app shows a toast ("can't caption and transmit at once"), switches that phone to server captions, and the diag line reads "phone STT conflicted with mic → server". Also confirm by ear on the other phone: does the voice still come through while captions work?

**iPhones** always use server captions (Google Gemini, `stt.mjs`), so Apple's recognizer never competes with the radio mic. Expect a few seconds' wait for the caption; the card shows "Transcribing…" meanwhile.
## 5. Before crews rely on it

- [ ] A bilingual crew member reviews the `GLOSSARY` in `translate.mjs`, and you set `verified: true`.
- [ ] Before turning on `showPresets`, the same review for every preset's Spanish line in `CONFIG.presets`.
- [ ] Move the Gemini key off the free tier (turn on billing in Google AI Studio): free keys get lowest priority when Google is busy, and Google may use free-tier data to improve its products.

## Privacy

The translate and captions functions handle text and audio in memory only and never log it (only error class and status). The one place messages are stored is the crew log, which deletes them after 24 hours. Translation runs once per transmission, on the sender's phone. Receivers make no API calls.
