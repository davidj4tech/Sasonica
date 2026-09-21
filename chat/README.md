# Sasonica chat (prototype)

A chat-first front end for Sasonica, built as a strangler beside the Nuxt app:
it touches nothing outside `chat/`. It will later become the Capacitor web
entry point; for now it builds to a static bundle.

Stack: React 19 + TypeScript, React Router v7 in SPA mode (`ssr: false`),
assistant-ui's `useExternalStoreRuntime`. It talks to agent-media's canvas
through the **v0** routes described in
`agent-media/docs/server-contract.md` §6, bound to assistant-ui as in §14.

```
pnpm install
pnpm typecheck
pnpm build          # → build/client/index.html + assets (static SPA)
```

## Run against the mock

```
pnpm build && pnpm mock        # http://127.0.0.1:8793 — serves the bundle AND a fake canvas
```

Open it, go to Settings, set the server address to `http://127.0.0.1:8793`
and any token (`bad` gets a 401). Or run `pnpm dev` (Vite on :5173) beside
`pnpm mock` with the same settings.

`MOCK_DELAY_MS=2500 pnpm mock` holds every app-route answer 2.5 s, like the
phone→red5 link (`GET /mock/delay?ms=N` changes it while running) — the way to
see a cached open paint before the network answers.

The mock (`mock/server.mjs`) answers every route the app uses from invented
fixtures: a reply being spoken (follow-along), a permission prompt whose
question changes every 45 s (a stale card gets 409 "the question has
changed"), an AskUserQuestion on screen, a turn at work, a session not on the
shelf yet, and a shelved conversation with pictures. `/reply`, `/ask` and
`/session/answer` change its state, so every write path can be exercised
here. **Test write paths against the mock only**: against the real canvas a
POST types into a running agent session.

## Run against a real canvas

Settings → server address `http://<canvas host>:8781` (red5's canvas binds its
tailnet IP, not loopback) and your Audiobookshelf token. The canvas answers
CORS for the app routes, so the bundle can be served from anywhere
(`pnpm dev`, or `pnpm mock` for its static server). Reading is safe; sending,
answering and starting chats are real.

## Preview on a phone

```
pnpm build
SASONICA_CHAT_TOKEN=<bearer> node serve.mjs --host <tailnet ip> --port 8795
```

Serves the bundle with the SPA fallback, and prints a pairing link
(`/pair?c=…`, good for 30 minutes) that stores the token in the phone's browser, so the
token is never typed or pasted. Blank server address = this host on 8781, so
serving from the canvas's machine needs no Settings at all.

## Layout

| Path | What |
| --- | --- |
| `app/api/auth.ts` | the only module that stores the base URL and credential. v1 device pairing (§9) replaces this file |
| `app/api/types.ts` | v0 shapes transcribed from §6, with notes where the live server differs |
| `app/api/index.ts` | every call the app makes; v1 route changes land here |
| `app/lib/convert.ts` | log line → `ThreadMessageLike` (§14), approval attachment |
| `app/lib/followAlong.ts` | live-line sentence clock, whitespace-faithful sentence split |
| `app/hooks/useConversationLog.ts` | the adaptive poll (1 s live / 2 s working or approval / 15 s idle, setTimeout-based) |
| `app/hooks/useThreads.ts` | `/targets`, `/sessions/state` (5 s), session → item resolution |
| `app/lib/snapshots.ts`, `app/lib/store.ts` | the last good lines + item per thread, and the list, in memory over IndexedDB (40 threads LRU); best-effort |
| `app/hooks/usePrefetch.ts` | warms the top 5 threads from the list, one at a time, low priority |
| `app/hooks/useBottomFirst.ts` | newest 20 messages first, older ones added above, scroll pinned to the bottom |
| `app/lib/textSize.ts` | the per-device text size (one root `--text-size`; everything is rem) |
| `app/components/Thread.tsx` | the assistant-ui runtime and thread layout |
| `app/components/parts.tsx` | follow-along text, pictures, work summary, ask/approval tool UIs, working indicator |
| `app/routes/*` | thread list, thread, new chat, settings |

## What works

- Opening a thread feels instant: it paints from its saved snapshot (lines +
  resolved item) with "updating…" in the header, and a known thread goes
  straight to the log — one round trip, not two. The list paints from its
  snapshot too, and warms the top five threads in the background. A cached
  live line is plain text until fresh data restarts the follow-along.
  Blocked or private storage just means no cache. `fetchLogTail()` in
  `api/index.ts` is where the server's coming `?tail=N` switches on.
- Threads open at the foot, newest 20 messages first, older ones added
  above without a sweep or jump.
- Composer: Enter is a new line, Ctrl/Cmd+Enter sends (hint shown only with
  a real keyboard); grows to 8 rows. Landscape and the soft keyboard keep
  the header and composer on screen; the column is a centred 46rem.
- Text size: Settings → Small / Default (17px) / Large / Larger, per device.

- Thread list from `/targets` (live first, state badges from `/sessions/state`
  polled every 5 s).
- Thread view: session → item via `/conversation?session=` (re-asked every
  3 s for up to 5 min while there is no item: "not on the shelf yet"), then
  `/conversation/log?item=` polled adaptively; ids `${session}:${at}`; ended
  live lines held until the server returns them (no shrink-and-jump).
- Follow-along: the live line's sentence in bold on a local clock between
  polls; not advancing while paused.
- Pictures (figure wide, ambient small), work summaries, the slash-command
  chip, the ghost suggestion (fills the composer), the working indicator with
  a running timer and step list.
- Approvals as a human tool UI; numbered options → `POST /session/answer`;
  409 re-renders the new question with "The question changed — choose again".
  An AskUserQuestion still on screen gets live buttons; answered ones are
  read-only with the choice marked.
- Composer: `/reply {item, text}`; before the thread has an item, `/ask
  {text, target: <session>}` instead. "Session reopened" vs "Sent"; a 502
  `submitted: false` says the words are in the composer but were not taken.
  The composer stays usable while a turn runs (the harness queues typed input).
- New chat: place picker (`/targets.places`) and agent picker, `/ask {text,
  target: "new", cwd, agent}`, then straight into the new thread.

## Stubbed / not done

- **Stop**: `onCancel` → `stopSession()` in `app/api/index.ts` throws "not
  available yet"; the double-press → `speech: "silence"` logic is in
  `useStop` (Thread.tsx). When §12 exists, only the function body changes.
- Drafts (`/draft`), slash menu (`/commands`), rename, resume/close, `/focus`
  ("answer at the desk" is text only), speech bar and replay, dictation,
  branch-from-here, `dry: true` routing for words that name a thread, the
  thread-list adapter (routing is React Router instead). Auto-scroll is
  assistant-ui's own, not the 8 s reader hold from ConversationLog.vue.
- Auth is a pasted bearer in localStorage (v1: pairing + keystore).
