#!/usr/bin/env node
// Headless suites against the mock (never the real canvas):
//   pnpm build && PLAYWRIGHT_CORE=<dir> node test/run.mjs
//
//   pair    fresh install → pair with a code → list → open a thread by
//           session in ONE log request → reply; unpair; spent/wrong code;
//           auto-pair link; pasted sasonica:// link; revoked token; legacy
//           ABS token
//   follow  real-shaped speech (sentences growing, paused start, working
//           under it, lines appended below, no offsets): the bold stays on
//           screen and the view is never yanked to the bottom; hand scroll →
//           "Follow along"; "New messages ↓"; at default and Larger text
//   keys    the top play/pause key: one or two by height, in sync, portrait,
//           landscape, Larger
//   skew    the bold follows /speech/now's pos when `elapsed` runs ahead
//   resync  a skip taken elsewhere leaves the bold behind the voice; the
//           "Follow along" pill asks where the voice is and catches up
//   lostlive  the live row goes while the audio plays on (a barge-in): the
//           bold rides the player's own position off the turn's timeline
//   rename  long press / title tap / ⋮ → POST /rename; optimistic
//           everywhere, rolled back on refusal
//   finished  the finished bar: a slim Replay strip (portrait, landscape,
//           Larger), 44 px hit areas, the full bar back on speech; ~30 s
//   send    a sent message shows once through the /reply race, clock skew
//           and flattened text; a refused one keeps its words with Retry
//   arrivals  a reply in another session while reading A: nothing moves, a
//           notice (urgent: stronger) and a list dot; ↑/↓ pills
//   notes   the Notes tab: views, agenda, a heading and a roam note, read
//           aloud, search (notes + memory), capture, setup + its window
//   notes-layout  the Organiser offers the server's keywords and refile
//           targets: plain Org, and paragtd's for an older server
//   notes-show  the Organiser's Show and Sort menus: done/waiting/plain,
//           File order, Date, Priority, Title, Recently changed; remembered
//   notes-edit  ○ done + Undo, a repeater moving on, state keys, a date
//           changed, Move to… (next actions, the tickler on a date), a
//           vanished heading
//   draft   the composer's text per thread: switch, reload, hidden, a newer
//           copy from another device, send clears it, new chat
//   stream  the thread is its §11 stream: a new message renders < 1 s after
//           the transcript append with no polling; reasoning collapsed;
//           steps grouped and lazy; follow-along; reconnect without
//           duplicates; the polling fallback and back; Load earlier
//   dashboard  Home (§6.11): every section, a question answered in place,
//           quick start, machines, Home ⇄ Threads; the + clear of the nav
//           bar and the last row; the composer's one-line start and keyboard
//   agents  §6.12 background agents: the strip collapsed and open (a tree,
//           running first / start order, steps moving, the `agents` event),
//           an agent's read-only thread with Load earlier; menus and sheets
//           close on a tap outside (pressing nothing), Escape and Android back
//   about   About from Settings: mark, version, server, shell version, credits
//   harnesses  Coding agents from Settings: versions and sign-in state, a
//           sign-in with a pasted code, an install to finished
//   move    a thread to another project (§6.15): the picker from a long press
//           and from the thread's ⋮, what a move costs a live session, a
//           refused one, the project line following
//   sort    the thread list: Smart / Most recent / By project (headings,
//           Archived too), kept per device; the project line under titles
//   search  ⌕ beside Show / Sort on Threads → /find: threads, messages and memory as
//           you type; a hit opens its thread at that message, lit; memory
//           only when the server has it; Advanced adds "Tool steps"; recent
//           searches; portrait, landscape, Largest
//   filter  the thread list's Show: Active / Live / Closed / Archived /
//           Everything and one project; the empty line; kept per device
//   tapread  "Read from here": a tap on a sentence of the message being said
//           jumps the voice (goto-sentence, bold at once, then the real
//           position); an older reply sends nothing on a tap or selection
//           and plays from its ▶; drags, selections and the keys are not taps
//   rich    a reply's table, links, bare address and code drawn as
//           themselves; while spoken the described table is one bold step
//           and the sentences after it are still followed
//   pinch   two fingers step the text size up/down, saved as the Settings
//           choice, capped at both ends; the page never zooms
//   refs    another thread by chip: Share into… (list and ⋮, a thread or New
//           chat) leaves it in the draft; a send carries `refs` and shows a
//           link; `@` in the box offers threads by title
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mockAt = (port, env) => {
  const p = spawn(process.execPath, [path.join(here, '..', 'mock', 'server.mjs'), '--port', String(port)], { env: { ...process.env, ...env }, stdio: 'ignore' })
  return new Promise((r) => setTimeout(() => r(p), 800))
}
const run = (file, env = {}) =>
  new Promise((r) => {
    const p = spawn(process.execPath, [path.join(here, file)], { env: { ...process.env, ...env }, stdio: 'inherit' })
    p.on('exit', (code) => r(code || 0))
  })

// E2E_PORT moves the mocks (P, P+1, P+2), so two worktrees can run the
// suites at once without sharing a mock's state.
const P = Number(process.env.E2E_PORT || 8811)
const mock = await mockAt(P, { MOCK_SPEECH_REST_S: '0' })
const skewMock = await mockAt(P + 1, { MOCK_REAL_VOICE: '1' })
// Home answers the same questions ask.mjs answers: a mock of its own.
const dashMock = await mockAt(P + 2, { MOCK_SPEECH_REST_S: '0' })
// Background agents and sorting: a mock whose running agents step each second.
const agentsMock = await mockAt(P + 3, { MOCK_SPEECH_REST_S: '0', MOCK_AGENT_STEP_S: '1' })
// Moving changes which project a thread is in, which sort.mjs and filter.mjs
// read: its own mock, so the order the suites run in does not matter.
const moveMock = await mockAt(P + 4, { MOCK_SPEECH_REST_S: '0' })
let failed = 0
try {
  for (const [file, env] of [['pair.mjs'], ['follow.mjs'], ['follow.mjs', { SIZE: 'largest' }], ['keys.mjs'], ['skew.mjs'], ['resync.mjs'], ['lostlive.mjs'], ['rename.mjs'], ['finished.mjs'], ['send.mjs'], ['draft.mjs'], ['arrivals.mjs'], ['stream.mjs'], ['notes.mjs'], ['notes-show.mjs'], ['notes-edit.mjs'], ['notes-layout.mjs'], ['sessions.mjs'], ['brand.mjs'], ['about.mjs'], ['harnesses.mjs'], ['ask.mjs'], ['dashboard.mjs'], ['agents.mjs'], ['sort.mjs'], ['filter.mjs'], ['move.mjs'], ['tapread.mjs'], ['rich.mjs'], ['peer.mjs'], ['search.mjs'], ['pinch.mjs'], ['refs.mjs']]) {
    console.log(`\n── ${file} ${env ? JSON.stringify(env) : ''}`)
    failed += (await run(file, { BASE: `http://127.0.0.1:${file === 'skew.mjs' || file === 'resync.mjs' || file === 'lostlive.mjs' ? P + 1 : file === 'dashboard.mjs' ? P + 2 : file === 'agents.mjs' || file === 'sort.mjs' || file === 'filter.mjs' ? P + 3 : file === 'move.mjs' ? P + 4 : P}`, ...env })) ? 1 : 0
  }
} finally {
  mock.kill()
  skewMock.kill()
  dashMock.kill()
  agentsMock.kill()
  moveMock.kill()
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites pass')
process.exit(failed ? 1 : 0)
