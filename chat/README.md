# Sasonica chat (prototype)

A chat-first front end for Sasonica, built as a strangler beside the Nuxt app:
it touches nothing outside `chat/`. It will later become the Capacitor web
entry point; for now it builds to a static bundle.

Stack: React 19 + TypeScript, React Router v7 in SPA mode (`ssr: false`),
assistant-ui's `useExternalStoreRuntime`. It talks to agent-media's canvas
through the routes in `agent-media/docs/server-contract.md`: §6 (v0), with
§9 device pairing, §10 threads keyed by session, §6.2.2 messages read from
the transcript and §11 the per-thread stream (all built on red5 22 Sep
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
`?session=` and the v0 `?item=`) from invented fixtures, including the §11
stream `GET /threads/{session}/events` (a snapshot, then what changed every
`MOCK_STREAM_TICK_MS`, default 100; a ping after `MOCK_PING_S`, default 15)
and §6.2.2 `messages` on the log with `?messages=1` (`before`/`limit`
paging). The fixtures are written as lines and their messages derived the
way the server reads a transcript: a redacted thought, the turn's steps as
tool parts with a line of narration, the reply last; a session at work gets
a running message that its reply replaces (same id). `Mock: stream` is
scripted from the tests: `GET /mock/stream/append?text=` lands a message now,
`/mock/stream/turn` plays a whole turn (reasoning, a tool running → done, a
second tool, the reply, then the reply spoken), `/mock/stream/drop` ends
every open stream, `/mock/stream/refuse?on=1` refuses it (503) and
`/mock/stream/stats` counts streams opened and log polls. The fixtures: a reply being spoken
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
`GET /mock/arrive?mode=speak|state|queue[&urgent=1][&title=]` lands a reply
in another session (spoken now; a turn ending working → waiting in 6 s; or
listed in `/speech/now`'s `queued`), `?clear=1` empties `queued`;
`GET /mock/reply?delay=&skew=&flatten=&fail=` makes /reply slow (the line
lands in the log first), shifts the server clock, flattens whitespace or
refuses; `GET /dashboard` (§6.11) is built from the same fixtures (their questions,
the working turn, the voice and its `queued`, recaps — `recent` keeps 12 so
the older fixtures with recaps make the cut) plus invented hosts:
`GET /mock/dashboard?hosts=tight` (the default: red5 short of memory,
sessiond down, hpo offline) or `?hosts=ok`; `/audio/targets` and
`POST /audio/target` keep the speech target in memory.
Background agents (§6.12): `Mock: working` has six (done with a 45-message
log, running with a step that moves every `MOCK_AGENT_STEP_S` (3), a fork
and a done child under it, failed, stopped); `GET /mock/agents?finish=<id>`
ends a running one (an `agents` event), `?spawn=1` starts one, `?reset=1`.
Rows carry `project`/`cwd` (a mix, some null) and `Mock: long conversation`
is pinned, for the sort modes.
`MOCK_REAL_VOICE=1` makes `/speech/now`
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
(and 8813 for `dashboard.mjs`, which answers the same questions `ask.mjs`
does) and runs `test/{pair,follow,keys,skew,rename,finished,send,draft,arrivals,stream,notes,notes-edit,sessions,brand,ask,dashboard}.mjs` in headless
Chromium at phone size: pairing and the one-request thread open (its stream),
follow-along on the real-shaped speech (default and Larger text), the top
play/pause key (portrait, landscape, Larger), the skew correction against
a stale `pos`, rename, the finished speech bar, the send race, and drafts
(switch threads, reload, hidden, a newer copy from another device, send),
and replies elsewhere (nothing moves; notice and dot) with the ↑/↓ pills,
and the stream (`stream.mjs`: an appended message renders < 1 s after the
mock's append with no polling — ~0.1 s on the mock; reasoning collapsed;
steps grouped and mounted only when opened; follow-along on the stream's
clock; a dropped stream reconnects to a snapshot with no duplicates; a
refused one falls back to polling and comes back; Load earlier keeps the
reader's place), Exit and Archive (`sessions.mjs`: the long-press menu and
the thread's ⋮, the confirm, optimistic with rollback, the folded Archived
section, Exit & archive, the saved list, sending un-archives), and the brand (`brand.mjs`: icons, manifest, the wordmark
and Pair's tagline, the faces leaving the text-size scale alone, no sideways
scroll), and Home (`dashboard.mjs`: every section; a multi-select question
answered in place posts `/session/answer` and leaves at once; the working
step and its ticking time; the queue and the output sheet; recaps clamped
and expanding; quick start opening New chat preset; the machines' ring and
dots following the hosts scenario and reduced motion; Home ⇄ Threads and
the back gesture; the + at least 16 px above the speech bar or a 48 px nav
inset with the last row clear of it — portrait, landscape, Larger; the
composer one line when empty, even laid out at zero width first, capped,
and above a keyboard-shortened viewport). `E2E_PORT=<n>` moves the mocks to n, n+1 and n+2, for a second worktree
running the suites at the same time. Playwright is not a
dependency; any playwright-core with its browsers in `~/.cache/ms-playwright`
will do. Screenshots go to `$TMPDIR/sasonica-chat-shots`.

`test/live.mjs` is the read-only check against a real canvas (not in
`run.mjs`): it opens one thread's stream in the built app with a device
token, aborts every non-GET request to the canvas, prints what rendered,
and — on the canvas's own host — stats the session's transcript every 50 ms
and times each write to the next change in the thread.

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
| `app/lib/convert.ts` | §6.2.2 message → `ThreadMessageLike` (§14: text, `reasoning`, `tool-call`, the ask), the approval item, `groupParts` ("Worked · N steps" runs) |
| `app/lib/messages.ts` | the words as shown (`[[visual:]]` markers and markdown off, as the speech strips them), the spoken reply, the live message, applying stream events, the cache's plain copy |
| `app/lib/sse.ts` | a fetch-based SSE reader (the Authorization header; EventSource cannot set one) |
| `app/lib/followAlong.ts` | live-line sentence clock, whitespace-faithful sentence split |
| `app/hooks/useThread.ts` | the thread's §11 stream: snapshot + events, heartbeat watchdog (45 s), reconnect with backoff, the polling fallback (§6.2 adaptive cadence) after 3 failures, stream retried every 30 s; older pages (`before`); sends |
| `app/hooks/useThreads.ts` | `/targets`, `/sessions/state` (5 s) |
| `app/lib/snapshots.ts`, `app/lib/store.ts` | the last good messages per thread (by session, the newest 60, no live clock or running turn), and the list, in memory over IndexedDB (40 threads LRU); best-effort. `CACHE_VERSION` (3: messages) in store.ts drops old-shaped entries on upgrade |
| `app/hooks/usePrefetch.ts` | warms the top 5 threads from the list, one at a time, low priority |
| `app/hooks/useBottomFirst.ts` | newest 20 messages first, older ones added above, scroll pinned to the bottom |
| `app/lib/drafts.ts`, `app/hooks/useDraft.ts` | the composer's text per thread: local copy, `/draft` push/reconcile, the send rules; the hook binds it to the composer |
| `app/lib/arrivals.ts`, `app/components/Notices.tsx` | replies elsewhere: notices, unread-since-seen per session, from /speech/now and /sessions/state |
| `app/lib/textSize.ts` | the per-device text size (one root `--text-size`; everything is rem) |
| `app/hooks/useSpeech.tsx` | the ONE `/speech/now` poll for the app (1.5 s live / 5 s idle / 15 s failing), the `/speech/ctl` keys, optimistic state |
| `app/components/SpeechBar.tsx` | the speech bar and its full-controls sheet |
| `app/lib/titles.ts`, `app/hooks/useRename.ts`, `app/components/RenameSheet.tsx` | rename: optimistic title overrides read by every title, the POST and rollback, the sheet |
| `app/hooks/useFollowAlong.ts` | keeps the bold sentence on screen while the live line plays; holds off assistant-ui's own scrolling while a live line exists; "Follow along" pill, "New messages ↓" |
| `app/lib/pictures.ts` | the per-device "Show ambient artwork" setting |
| `app/components/Thread.tsx` | the assistant-ui runtime and thread layout |
| `app/components/parts.tsx` | follow-along text, reasoning ("Thinking" / "thought"), tool steps and the "Worked · N steps" block, pictures, ask/approval tool UIs, working indicator |
| `app/routes/*` | thread list, thread, new chat, settings, coding agents (install / sign in) |
| `app/routes/home.tsx`, `app/hooks/useDashboard.ts` | Home, the landing screen: GET /dashboard (§6.11) every 5 s while visible, painted from the saved answer; a card answered here hides at once (and a 409 swaps in the new question) until a later poll agrees |
| `app/components/Nav.tsx` | Home \| Threads (Threads pushes, Home pops it) and ←, a real back when there is one |
| `app/components/Machines.tsx` | the hosts: memory ring (green → amber at 70 % → red at 85 % or the reaper's "tight"), session count, service and online dots, a tap for the numbers |
| `app/components/OutputSheet.tsx` | where speech plays: /audio/targets, POST /audio/target (§6.9) |
| `app/components/AutoGrow.tsx` | the composer's box: one line empty, grows to 8 rows, re-measured when its width changes |
| `app/api/notes.ts`, `app/routes/notes.tsx`, `note.tsx`, `notes-setup.tsx`, `app/components/MoveSheet.tsx`, `app/lib/org.tsx`, `app/notes.css` | the Organiser tab (§6.10): views, one note, the setup checklist and its window; `app/components/HomeAgenda.tsx` + `app/hooks/useMarkDone.ts`, Home's Agenda section and the ○/Undo they share; Org rendered for reading; its own stylesheet. Pages live under `/organiser/…` so they never share a path with the `/notes` API on a one-port server |
| `mock/notes.mjs` | the notes routes on the mock: an invented Org tree; `GET /mock/notes` shows captures/says/setup (`?reset=1`, `?unset=1`) |

## What works

- Home (`/`, the landing screen; the thread list is `/threads`, one tap away
  on the Home | Threads switch). One GET /dashboard (§6.11) every 5 s while
  visible, stale-while-revalidate like the list. Top to bottom: **Needs you**
  (every question or permission prompt, answered in place with the thread's
  own card — single, multi-select, Other; the title opens the thread),
  **Working now** (the step in progress, a breathing dot, the time so far),
  **Listening** (what the voice is doing and how many replies wait, from the
  app's one /speech/now poll; the chip opens the speech output sheet), **Recaps**
  (the recent threads' "where it was", three lines, a tap for all of it,
  live / resting), **Quick start** (the top places × the main agent, the top
  place × each other agent, straight into New chat preset via
  `/new?cwd=&agent=`), **Machines** (a row per host). The speech bar stays
  global; the + rides above it.
- The + (22 Sep 2026, David's Pixel 8a with 3-button nav: it sat on the
  navigation bar and covered the last row's time): the dock carries the
  bottom safe-area inset, the + sits 20 px (16 in landscape) above the dock's
  top — the speech bar when it shows — and the list and Home end with room
  for it. In Sasonica Next the shell pads the WebView clear of the bars
  itself, so the inset there is 0 and nothing is counted twice.
- The composer starts at one line and grows to 8 (then scrolls): its own
  autosize (`AutoGrow.tsx`), because assistant-ui's measured once before the
  WebView had a width and drew all 8 rows in Next.

- Background agents (§6.12, 22 Sep 2026): a strip under a thread's header,
  hidden until the thread has spawned one, collapsed to "2 running · 2 done
  · 1 failed"; open, a tree (forks and children under their parent), each
  row its description, status dot, elapsed time and, while running, the step
  it is on. Running first then most recent, or Start order (per device). The
  counts ride on the stream (snapshot `agents`, `agents` event); the list is
  `GET /threads/{s}/agents`, polled every 5 s while open with work going. A
  row opens `/t/:session/agents/:id`: that agent's own thread, read-only (no
  composer), Load earlier included.
- Thread list order (22 Sep 2026): "Sort:" offers Smart (needs you →
  working → the rest, pinned on top within each; the default), Most recent,
  and By project (headings from each row's `project`, "Other" last); the
  Archived section follows it; kept per device (localStorage). Rows, Home's
  recap and working cards, and the thread header carry the project really
  small under the title, when there is one.
- Menus and sheets (the ⋮ menu, the long-press menu, rename and exit
  sheets, the sort menu, speech controls and output) all close on a tap
  outside — a scrim takes that tap, so it never presses what is under it —
  on Escape, and on Android back in Next (`lib/layers.ts`: MainActivity asks
  `window.__sasonicaBack()` first; with nothing open back goes back a
  screen, then leaves the app).

- Pairing (§9): first run lands on Pair this device (a pasted
  `sasonica://pair?…` or `http(s)://…/pair?c=…` link, or server + code); a
  link opened into the app as `/?pair=<code>&server=<base>` pairs at once.
  Settings shows the paired device — "Paired as Pixel 8a with red5", the
  name given at the desk, which `POST /pair` answers with (`name`; an older
  server that leaves it out shows the name the app asked for) — its server,
  id and Unpair; the ABS
  token lives on under Advanced / legacy.
- A thread is its stream, `GET /threads/{session}/events` (§11) — ONE
  request to open it, shelved or not, fetch-streamed with the device token
  in the Authorization header. Why (David, 22 Sep 2026): turns reached the
  terminal much sooner than the app, and the app had no reasoning. The
  stream is read off the transcript the terminal draws from (the server
  measured transcript append → event at 0.33 s median; the mock suite
  measures event → rendered at ~0.1 s). Its first frame, `snapshot`,
  REPLACES the thread (older pages loaded by hand are kept above it when
  they join up), so a reconnect cannot duplicate anything; `message`
  events are applied by id; `live` moves the follow-along clock; `working`,
  `approval`, `suggestion`, `state`, `recap` replace their piece. Nothing
  for 45 s (pings come every 15) is a dead connection: aborted and
  reopened. Reconnects back off 1 s → 30 s; three failed connections in a
  row (no snapshot, or open under 5 s) and the thread polls
  `/conversation/log?session=&messages=1` at the §6.2 cadence instead
  ("polling" in the header), trying the stream again every 30 s. Hidden,
  the stream is closed; shown again, its snapshot is the catch-up.
- It paints first from its saved messages with "updating…" in the header.
  The list paints from its snapshot too, and warms the top five threads in
  the background (the log's newest page, `messages=1`). A cached message
  has no live clock and no running turn until the snapshot restores them.
  Blocked or private storage just means no cache.
- Messages (§6.2.2), not lines: every text part — the narration between
  steps and the reply — shown plain (the `[[visual:]]` markers and
  markdown are taken off the way the speech takes them off, so the
  follow-along can walk the words); the reply (the trailing text parts, what
  is spoken) is one part. Reasoning: a collapsed "Thinking" disclosure (the
  text rendered only when opened), or — for redacted thinking, ~90 % on
  red5 — a small "∴ thought" marker. Tool steps, with the reasoning between
  them, fold into a "Worked · N steps" block (the terminal's grouping);
  closed, it mounts nothing; opened, each step is its title and status
  (✓ / ✕ / spinner), and a tap shows its input and result summaries. While
  a step runs, the block says "Working · N steps" with a spinner and the
  running step's title. Asks show read-only with the answer marked (a
  transcript has an ask only once it is answered; the one on screen is the
  approval card). Pictures come from `spoken.images`; ▶ replays
  `spoken.id`; the follow-along is keyed by the live message's id.
- "Load earlier" at the top when `older`: the page before the first
  message (`before=<id>`), added above without moving the reader. The ↑
  pill loads one too, and goes to its top.
- isRunning: `state == "working"`, the last message's `turn.running`,
  `working`, a send not yet answered, or (the stream has no `pending`) a
  live session whose last message is the listener's.
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
- A 404 ("no such session") on the stream falls to the poll, which keeps
  asking every 3 s. Message ids are the transcript's (stable as a message
  grows), so a reply replaces its running self in place.
- Follow-along: the live message's sentence in bold on a local clock
  between `live` events (sent only on a new sentence, pause, a skip, or
  new offsets — never merely ticking); the sentences' growth without
  offsets comes from the message's own `spoken.live`. Not advancing while
  paused.
- Pictures (figure wide, ambient small), the slash-command chip, the ghost
  suggestion (fills the composer), the working indicator with a running
  timer and step list.
- Approvals as a human tool UI; numbered options → `POST /session/answer`;
  409 re-renders the new question with "The question changed — choose again".
- An AskUserQuestion on screen (`approval.kind: "question"`) is a question
  card (`QuestionCard`, parts.tsx): one section per question with its header
  chip, tap an option of a single-select, tick the boxes of a multi-select
  (started from what is `checked` on screen), or write your own words under
  "Other" (a single-select's words replace its option) — one Send for all,
  enabled once every question has an answer. One single-select question
  sends on the tap. It posts the structured form `{session, key, answers:
  [{question_index, selected: [n…], other_text?}], request_id?}` (the id
  only for a headless session), pane and headless alike; a 409 swaps in the
  returned question and the picks start over. The card sits on the pending
  `ask` part when the messages carry one (a headless session streams it:
  `status: "running"`, matched by `tool_use_id`), else at the foot of the
  thread (a pane session's ask is written only once answered). Answered asks
  are read-only with the chosen options marked and any words of your own as
  "Other: …". Suite: `test/ask.mjs`.
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
- Replies elsewhere never move you (David, 22 Sep: a turn finishing in
  another session took over the screen he was reading). Nothing another
  session does navigates, changes the open thread, its follow-along or its
  scroll. A reply starting to be heard elsewhere, one waiting in
  `/speech/now`'s `queued` (§6.5), or a session going working → waiting (or
  into approval) becomes a notice under the header — "New reply · <title>",
  "Reply waiting", "Needs you" in amber for `urgent` — tap to open, ▶ to
  hear a waiting one now (ends what is playing; only when it is next), ×,
  or it goes in 12 s (30 s urgent). Not on the list, whose rows get an
  unread dot (and a bold title) instead: arrived since this device last had
  the thread open and visible (`lib/arrivals.ts`, localStorage, this
  device's clock). In a thread, the speech bar's title for another thread's
  reply opens the sheet, not the thread (its link does), and a tap within
  0.8 s of the bar appearing or changing is ignored.
- ↑ / ↓ pills at the right of a thread when more than ¾ of a screen from
  the top / the foot (↓ gives way to "New messages ↓"), shown while the
  thread is moved by hand (wheel, touch, paging keys) and for 3 s after —
  at the right edge they sit where a reply's play key can be, so they do
  not stay. They scroll the follow hook's own way, so they work while a
  live line holds assistant-ui's scrolling off.
- The Organiser (the third tab, and Home's Agenda section — overdue and
  today, tickable, with the way in; server-contract.md §6.10): a strip of views
  (Agenda grouped Overdue / Today / Tomorrow / by day, the GTD files, the
  roam folders; the last one remembered), a heading or a note opened as
  rendered Org with its id links followable, 🔊 to have the voice read it
  (`/notes/say`), search over the notes and the memory store (agent notes
  on a tick), and a capture box at the foot — To-do or Note into the inbox,
  Ctrl+Enter saves. A server with no notes lands on the setup checklist:
  start fresh notes, turn on sync, install paragtd, and watch a long action's
  window (`/harnesses/screen`), typing into it if it asks.
- Changing notes (§6.10 `/notes/state`, `/notes/refile`; GTD files only,
  roam notes stay read-only): ○ before a row marks it done at once, with
  Undo (a repeating item moves on to its next date instead); in a heading,
  state keys (TODO / NEXT / WAITING / ✓ Done) and Move to… — next actions,
  waiting for, someday, projects, inbox, or the tickler on a date. A heading
  changed at the desk meanwhile is refused (409), never guessed at.
- New chat: place picker (`/targets.places`) and agent picker, `/ask {text,
  target: "new", cwd, agent}`, then straight into the new thread.

## Stubbed / not done

- **Stop**: `onCancel` → `stopSession()` in `app/api/index.ts` throws "not
  available yet"; the double-press → `speech: "silence"` logic is in
  `useStop` (Thread.tsx). When §12 exists, only the function body changes.
- Slash menu (`/commands`), resume/close, `/focus`, dictation,
  branch-from-here, `dry: true` routing for words that name a thread, the
  thread-list adapter (routing is React Router instead). Auto-scroll is
  assistant-ui's own, not the 8 s reader hold from ConversationLog.vue.
- The device token is in localStorage; the Capacitor build moves it to the
  Android keystore (`readDevice`/`writeDevice` in `api/auth.ts`).

## Licence

This directory (the chat app and the Sasonica Next shell) is Apache-2.0 — see `LICENSE` and `NOTICE` here. The rest of this repository is the Audiobookshelf app fork and stays GPL v3.
