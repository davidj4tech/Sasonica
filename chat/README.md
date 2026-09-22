# Sasonica chat (prototype)

A chat-first front end for Sasonica, built as a strangler beside the Nuxt app:
it touches nothing outside `chat/`. It will later become the Capacitor web
entry point; for now it builds to a static bundle.

Stack: React 19 + TypeScript, React Router v7 in SPA mode (`ssr: false`),
assistant-ui's `useExternalStoreRuntime`. It talks to agent-media's canvas
through the routes in `agent-media/docs/server-contract.md`: §6 (v0), with
§9 device pairing and §10 threads keyed by session (both built on red5 22 Sep
2026), bound to assistant-ui as in §14.

```
pnpm install
pnpm typecheck
pnpm build          # → build/client/index.html + assets (static SPA)
```

## Run against the mock

```
pnpm build && pnpm mock        # http://127.0.0.1:8793 — serves the bundle AND a fake canvas
```

Open it: a fresh browser lands on **Pair this device**. Server address
`http://127.0.0.1:8793`, code `c0ffee42` (`MOCK_PAIR_CODE`). The code dies on
its first success, as the real one does; `GET /mock/pair` re-arms it
(`?device=NAME` sets the desk's name it answers with, default "Pixel 8a"), and
`/?pair=c0ffee42&server=http://127.0.0.1:8793` pairs with no typing.
`GET /mock/devices` lists paired devices and `?revoke=<id>` forgets one; its
token then gets 401, as a revoked one does. Settings → Advanced / legacy still
takes any bearer as an ABS token (`bad` gets a 401). Or run `pnpm dev` (Vite
on :5173) beside `pnpm mock` with the same settings.

`MOCK_DELAY_MS=2500 pnpm mock` holds every app-route answer 2.5 s, like the
phone→red5 link (`GET /mock/delay?ms=N` changes it while running) — the way to
see a cached open paint before the network answers.

The mock (`mock/server.mjs`) answers every route the app uses (both keys:
`?session=` and the v0 `?item=`) from invented fixtures: a reply being spoken
(follow-along), a permission prompt whose question changes every 45 s (a
stale card gets 409 "the question has changed"), an AskUserQuestion on
screen, a turn at work, a session not on the shelf yet (readable and
repliable by session), and a shelved conversation with pictures. Two more
are shaped like red5's real speech (see "Follow-along on real data"): a
streamed reply whose sentences grow while it plays, starts `paused`, has
`working` changing under it and lines appended below it; and one with no
offsets and a null `sentence`. `GET /mock/real/restart?in=N` starts them
(`&ended=1` holds them finished); `GET /mock/voice?loop=0` stops the
speaking fixture coming back after it ends (`loop=1` restores it);
`POST /rename` renames any fixture (a title containing FAIL gets a 500);
`/draft` keeps drafts in memory (`GET /mock/drafts` lists them);
`GET /mock/reply?delay=&skew=&flatten=&fail=` makes /reply slow (the line
lands in the log first), shifts the server clock, flattens whitespace or
refuses; `MOCK_REAL_VOICE=1` makes `/speech/now`
speak the streamed one with its `pos` lagging `elapsed`. The speaking thread's long reply
(with a figure above it and ambient art on it) is one shared voice clock
for `/speech/now`, `/speech/ctl` (every action) and the live line; it
loops, resting 10 s between ("finished") — `MOCK_SPEECH_REST_S=0` loops
without a rest for long test runs. `/reply`, `/ask` and
`/session/answer` change its state, so every write path can be exercised
here. **Test write paths against the mock only**: against the real canvas a
POST types into a running agent session.

## Headless tests

```
pnpm build
PLAYWRIGHT_CORE=~/agent-config/node_modules/playwright-core pnpm test:e2e
```

`test/run.mjs` starts two mocks (8811, and 8812 with `MOCK_REAL_VOICE=1`)
and runs `test/{pair,follow,keys,skew,rename,finished,send,draft}.mjs` in headless
Chromium at phone size: pairing and the one-request thread open,
follow-along on the real-shaped speech (default and Larger text), the top
play/pause key (portrait, landscape, Larger), the skew correction against
a stale `pos`, rename, the finished speech bar, the send race, and drafts
(switch threads, reload, hidden, a newer copy from another device, send). Playwright is not a
dependency; any playwright-core with its browsers in `~/.cache/ms-playwright`
will do. Screenshots go to `$TMPDIR/sasonica-chat-shots`.

## Run against a real canvas

Pair (§9). At the desk on the canvas's host:

```
media-visual-canvas pair --device "Pixel 8a" --host <canvas tailnet ip>
```

prints `sasonica://pair?server=<base>&code=<code>` (one-time, 30 min). Paste
it into Pair this device, or type the server address and code. `POST /pair`
trades it for a device token; the server address becomes the base it
answered from. Settings shows the paired device and **Unpair** (forgets it
here; revoke the token itself with `media-visual-canvas devices --revoke
<id>`). The legacy way, an Audiobookshelf token plus a server address, is
under Settings → Advanced / legacy and is used only while not paired. The
canvas answers CORS for the app routes and `POST /pair`, so the bundle can be
served from anywhere. Reading is safe; sending, answering and starting chats
are real.

## Preview on a phone

```
pnpm build
node serve.mjs --host <tailnet ip> --port 8795 [--canvas http://<canvas>:8781]
```

Serves the bundle with the SPA fallback. To pair the phone: mint a code at
the desk (`media-visual-canvas pair --device NAME --host <canvas ip>`) and
open `http://<tailnet ip>:8795/pair?c=<code>` on the phone. The preview
redirects to `/?pair=<code>&server=<canvas>` and the app pairs itself with
the canvas; this server never sees a token. `--canvas` (or
`SASONICA_CHAT_CANVAS`) defaults to this host on 8781.

Legacy: with `SASONICA_CHAT_TOKEN=<ABS bearer>` set it also prints its own
`/pair?c=…` link (30 minutes) whose page stores that bearer in the phone's
browser, as before. A `/pair?c=` that is not that code is taken to be a
device code and passed through.

## Layout

| Path | What |
| --- | --- |
| `app/api/auth.ts` | the only module that stores the base URL and credentials: the device token (§9 `pair()`, `unpair()`, link parsing), else the legacy ABS bearer. Prototype storage is localStorage; `readDevice`/`writeDevice` are what move to the Android keystore in the Capacitor build |
| `app/routes/pairing.tsx` | Pair this device: a pasted link, or server + code; auto-pairs from `?pair=&server=` |
| `app/api/types.ts` | shapes transcribed from §6/§9/§10, with notes where the live server differs |
| `app/api/index.ts` | every call the app makes, keyed by session (§10) |
| `app/lib/convert.ts` | log line → `ThreadMessageLike` (§14), approval attachment |
| `app/lib/followAlong.ts` | live-line sentence clock, whitespace-faithful sentence split |
| `app/hooks/useConversationLog.ts` | the adaptive poll (1 s live / 2 s working or approval / 15 s idle, setTimeout-based) |
| `app/hooks/useThreads.ts` | `/targets`, `/sessions/state` (5 s) |
| `app/lib/snapshots.ts`, `app/lib/store.ts` | the last good lines per thread (by session), and the list, in memory over IndexedDB (40 threads LRU); best-effort. `CACHE_VERSION` in store.ts drops old-shaped entries on upgrade |
| `app/hooks/usePrefetch.ts` | warms the top 5 threads from the list, one at a time, low priority |
| `app/hooks/useBottomFirst.ts` | newest 20 messages first, older ones added above, scroll pinned to the bottom |
| `app/lib/drafts.ts`, `app/hooks/useDraft.ts` | the composer's text per thread: local copy, `/draft` push/reconcile, the send rules; the hook binds it to the composer |
| `app/lib/textSize.ts` | the per-device text size (one root `--text-size`; everything is rem) |
| `app/hooks/useSpeech.tsx` | the ONE `/speech/now` poll for the app (1.5 s live / 5 s idle / 15 s failing), the `/speech/ctl` keys, optimistic state |
| `app/components/SpeechBar.tsx` | the speech bar and its full-controls sheet |
| `app/lib/titles.ts`, `app/hooks/useRename.ts`, `app/components/RenameSheet.tsx` | rename: optimistic title overrides read by every title, the POST and rollback, the sheet |
| `app/hooks/useFollowAlong.ts` | keeps the bold sentence on screen while the live line plays; holds off assistant-ui's own scrolling while a live line exists; "Follow along" pill, "New messages ↓" |
| `app/lib/pictures.ts` | the per-device "Show ambient artwork" setting |
| `app/components/Thread.tsx` | the assistant-ui runtime and thread layout |
| `app/components/parts.tsx` | follow-along text, pictures, work summary, ask/approval tool UIs, working indicator |
| `app/routes/*` | thread list, thread, new chat, settings |

## What works

- Pairing (§9): first run lands on Pair this device (a pasted
  `sasonica://pair?…` or `http(s)://…/pair?c=…` link, or server + code); a
  link opened into the app as `/?pair=<code>&server=<base>` pairs at once.
  Settings shows the paired device — "Paired as Pixel 8a with red5", the
  name given at the desk, which `POST /pair` answers with (`name`; an older
  server that leaves it out shows the name the app asked for) — its server,
  id and Unpair; the ABS
  token lives on under Advanced / legacy.
- Opening a thread is ONE request, `/conversation/log?session=` (§10) — no
  session → item lookup, shelved or not — and it paints first from its saved
  snapshot with "updating…" in the header. The list paints from its
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

- Speech bar (§6.5), on the list, a thread and new chat, while a reply is
  live, and for 30 s after it ends: "Finished · play to hear it again" the
  first 3 times on a device (counted in localStorage), then just the title
  and a compact "▶ Replay". Title opens
  the thread; sentence; progress sliver; back / pause-resume / on a
  sentence. The chevron opens the full set: turns (`prev`/`replay` with the
  hist index, as SpeechBar.vue), paragraphs, end of reply, replay latest,
  speed −/reset/+ (the `media speed` ladder, predicted), volume −/+, mute.
  Pause, speed and mute are optimistic and held until a poll asked after the
  press answers; a refused press rolls back and says why. One poller for
  the app, stopped while the tab is hidden. In the thread that is speaking,
  the bar shows only the time — the live line has the words — and a pause
  stops the bold at once (the two agree before the next log poll).
- Play/pause beside spoken replies: ▶ on a line with a history `id`
  (`replay-id`), pause/resume on the live line. A reply too tall to see
  whole (taller than the visible band) gets the same key at its top-right
  as well; both read one state.
- Follow-along scroll: while the live line plays, the view keeps its bold
  sentence in sight (moving only when it would leave the view, not every
  tick) instead of sticking to the bottom; a hand scroll stops it and shows
  a "Follow along" pill. Messages arriving below the live line never move
  the view; "New messages ↓" offers them. Paused: nothing moves. Ended: back
  to the foot if you were following, else your place is kept. Sending takes
  you to the foot.

### Follow-along on real data (red5, 22 Sep 2026)

It passed the mock and failed on the phone because real live lines differ:

- **The sentences grow while the reply is spoken** (streamed clips): the
  first poll of a 1188-character reply carried 7 sentences covering 519
  characters, later ones 10, 13, 17. The app drew only the sentences, so the
  bubble shrank to 44 % when the line went live and grew back every poll.
  Now the whole text shows from the start; the uncovered tail is plain.
- **assistant-ui scrolls to the bottom whatever `autoScroll` says**: a
  scroll-to-bottom requested while the view is already at the bottom (on
  open, run start, a send) fires no scroll event, so its "scrolling to
  bottom" flag never clears, and every content resize after that scrolls to
  the bottom. Real threads resize constantly (the growing live line,
  `working` steps, appended lines). While a live line exists, every
  `scrollTo` on the viewport that is not the follow hook's own is dropped.
- **Every reply starts `paused: true`** for ~1.5 s (the first clip loading),
  and a pause that turned following off handed the view back to the
  auto-scroll. Following is now just "a live line, not paused, not taken
  over by hand"; the guard holds while paused too.
- **`elapsed` runs ahead of the voice**: it is wall time since the reply
  started, and stalls between streamed clips are not taken off; measured on
  red5 (one clock) it led the player by ~1.4 s on two replies and 2.3 s on a
  third, drifting up as stalls add up (`delay` said 0). `/speech/now`'s
  `pos` is the player's position but whole seconds and STALE (the canvas's
  ~1 Hz snapshot, and the route takes 1.4–3.3 s), so the correction takes
  the lower envelope of `elapsed`-when-asked − `pos` over the last 8
  answers: staleness can only push that up, never down. (A first version
  used the median at arrival, counted the staleness as lead, and held the
  bold 1.5–1.9 s behind the voice.)
- **`server_time` is stamped at the end of /conversation/log** (receive −
  server_time 0.00 s over 979 polls), so `elapsed` was true one transit
  before it arrived, not half a (slow) round trip: the anchor takes off at
  most 0.25 s.
- Settings → Follow-along lead (default 0.5 s, 0–2 s) nudges the bold
  ahead or back, per device, for what no server number shows (the phone
  player's output latency, and taking a sentence in as it starts).
- `sentence` can be null; with no offsets either, the sentence is estimated
  from the speaking rate so there is still one to follow.
- Pictures: `[[visual:]]` figures as a thumbnail that opens on a tap;
  ambient art hidden unless Settings → Show ambient artwork (per device).

- Thread list from `/targets` (live first, state badges from `/sessions/state`
  polled every 5 s).
- Rename (§6.4): a long press on a thread in the list, or in the thread a
  tap on its title or ⋮ → Rename…, opens a sheet prefilled with the title
  (empty names can't be saved). `POST /rename {session, title}`; the new
  name shows at once in the list, the header, the speech bar and the saved
  list (`lib/titles.ts`), and is rolled back if refused. `terminal: false`
  is not a failure: "Renamed." plus the server's `why`, quietly.
- Thread view: `/conversation/log?session=` polled adaptively (a 404 "no
  conversation for that session yet" keeps asking every 3 s); ids
  `${session}:${at}`; ended live lines held until the server returns them
  (no shrink-and-jump).
- Follow-along: the live line's sentence in bold on a local clock between
  polls; not advancing while paused.
- Pictures (figure wide, ambient small), work summaries, the slash-command
  chip, the ghost suggestion (fills the composer), the working indicator with
  a running timer and step list.
- Approvals as a human tool UI; numbered options → `POST /session/answer`;
  409 re-renders the new question with "The question changed — choose again".
  An AskUserQuestion still on screen gets live buttons; answered ones are
  read-only with the choice marked.
- Composer: `/reply {session, text}` (§10), shelved or not. The message
  shows at once ("sending…") and is REPLACED by the server's own line when
  that comes back (`lib/pending.ts`): matched on the first new "you" line
  with the same words (whitespace-normalised, a `Re: “…” —` prefix or a
  slash-command chip allowed), never on time, so a line that arrives before
  /reply answers, or a server clock off from the phone's, cannot show it
  twice. A refusal keeps the words on the message with Retry / Discard; a
  502 `submitted: false` says they are in the pane's box but were not taken.
  "Session reopened" when `opened`.
  The composer stays usable while a turn runs (the harness queues typed input).
- Drafts (§6.2): what is typed in a thread's composer is kept per session —
  in localStorage at once, and on the server with `POST /draft {session,
  text, at}` (`at` = this device's clock) 800 ms after typing stops, and at
  once when the tab is hidden, the page goes away or the thread is left
  (a keepalive fetch: `sendBeacon` cannot carry the Authorization header).
  Opening a thread shows the local copy at once, then asks `GET /draft`:
  the newer `at` wins — a newer server copy (another device) replaces the
  box unless something was typed since open, in which case that stays and
  is pushed. An emptied draft is kept as a tombstone `{text: "", at}`, so an
  older copy never comes back. A good send clears it here and on the
  server; a refused one keeps it (the bubble has Retry, and the draft
  survives a reload). The thread list marks threads with a local draft
  ("Draft"). The new-chat screen keeps its draft on this device only
  (`NEW_CHAT`), cleared when the chat starts, and a refused start puts the
  words back in the box.
- New chat: place picker (`/targets.places`) and agent picker, `/ask {text,
  target: "new", cwd, agent}`, then straight into the new thread.

## Stubbed / not done

- **Stop**: `onCancel` → `stopSession()` in `app/api/index.ts` throws "not
  available yet"; the double-press → `speech: "silence"` logic is in
  `useStop` (Thread.tsx). When §12 exists, only the function body changes.
- Slash menu (`/commands`), resume/close, `/focus`
  ("answer at the desk" is text only), dictation,
  branch-from-here, `dry: true` routing for words that name a thread, the
  thread-list adapter (routing is React Router instead). Auto-scroll is
  assistant-ui's own, not the 8 s reader hold from ConversationLog.vue.
- The device token is in localStorage; the Capacitor build moves it to the
  Android keystore (`readDevice`/`writeDevice` in `api/auth.ts`).
