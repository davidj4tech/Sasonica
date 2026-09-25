#!/usr/bin/env node
/**
 * A tiny stand-in for agent-media's canvas, answering the app routes
 * (server-contract.md §6, with §9 pairing and §10 session keys) from
 * in-memory fixtures. Every write path the chat front end has is exercised
 * here, never against the real canvas: a real POST types into a running
 * agent session.
 *
 *   node mock/server.mjs [--port 8793] [--static build/client]
 *
 * Auth, both kinds the canvas takes (§9 "Migration"):
 *  - a DEVICE token from `POST /pair {code, device}`. The pairing code is
 *    fixed, MOCK_PAIR_CODE (default `c0ffee42`); like the real one it dies on
 *    its first success (a wrong code does not burn it), and
 *    `GET /mock/pair` re-arms it. Paired tokens start `mock-dev-`; one that
 *    is not (or no longer) paired is refused 401, as a revoked one is.
 *    `GET /mock/devices` lists them, `?revoke=<id>` forgets one. The answer
 *    carries `name`, the desk's name for the device ("Pixel 8a";
 *    `GET /mock/pair?device=NAME` changes it, `?device=` answers with the
 *    app's own).
 *  - any other non-empty bearer, as an ABS token (legacy), except "bad"
 *    (→ 401, §4.1).
 * With --static (default: build/client if it exists) it also serves the
 * built SPA on the same port, so Settings can be left blank.
 *
 * Slow link: MOCK_DELAY_MS=2500 (or --delay 2500) holds every app-route
 * answer that long, like the phone→red5 hop (a 39-line log took 2.1–2.5 s).
 * `GET /mock/delay?ms=N` changes it while running (tests flip it between a
 * cold and a cached open). Static files and pictures are never delayed.
 *
 * Fixture sessions (all text invented):
 *   speaking  — live, a reply being spoken now (follow-along bold); it
 *               ends, rests 10 s ("finished") and is said again. The voice
 *               is one shared clock: /speech/now, /speech/ctl (every
 *               _APP_SPEECH_ACTIONS action) and the log's live line agree
 *   approval  — live, stopped on a permission prompt (/session/answer)
 *   asking    — live, an AskUserQuestion on screen, attached to its ask line
 *   multi     — live, a multi-select question (Pear ticked at the desk),
 *               answered with the structured /session/answer
 *   two       — live, two questions (single + multi); the first structured
 *               answer gets 409 with a changed question, the next one lands
 *   headless  — live, headless: the pending ask part is in the messages
 *               (status running) and the card sits on it; `request_id` echoed
 *   working   — live, a turn running (`working` steps advance)
 *   fresh     — live, not on the shelf yet (item: null): readable and
 *               repliable by session all the same (§10)
 *   shelved   — ended, resumable, with pictures and a work summary
 *   long      — ended, 90 lines, for the bottom-first window and scrolling
 *   real      — shaped like red5's live data (22 Sep 2026), on its own loop
 *               (REAL_LEN_S spoken, REAL_REST_S quiet): the live line's
 *               `sentences`/`offsets` GROW while it plays (the first poll
 *               covers ~40 % of the text) and the offsets are revised;
 *               `sentence` is null; the first ~2 s say `paused: true`; the
 *               turn is `pending` with `working` steps changing every poll;
 *               and lines are APPENDED below the live one mid-speech, so it
 *               stops being the last line
 *   nooffsets — live, `offsets: []` and `sentence: null`, `elapsed` advancing
 *               (the app estimates the sentence)
 * POST /rename renames any fixture (`terminal: false` with a `why` for an
 * ended or working one); a title containing FAIL is refused 500; `auto`
 * names it "Named: <title>".
 * MOCK_REAL_VOICE=1 makes /speech/now speak `real` with a player behind
 * `elapsed` and a stale, slow `pos`, as red5's phone lane does.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { harnessRoute, mockHarnessControl } from './harnesses.mjs'
import { mockNotesControl, noteAsk, noteChatStarted, notesRoute, setupWindowRoute } from './notes.mjs'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const PORT = Number(opt('port', process.env.MOCK_PORT || 8793))
const here = new URL('.', import.meta.url).pathname
const STATIC = resolve(here, '..', opt('static', 'build/client'))
let DELAY_MS = Number(opt('delay', process.env.MOCK_DELAY_MS || 0)) || 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const now = () => Date.now() / 1000
const r3 = (t) => Math.round(t * 1000) / 1000
const T0 = now()
const hex12 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)

// ── Fixtures ──────────────────────────────────────────────────────────────

let seq = 0
const agentLine = (text, at, extra = {}) => ({ start: null, end: null, who: 'agent', text, at: r3(at), key: createHash('sha1').update(text + at).digest('hex'), id: 1000 + seq++, ...extra })
const youLine = (text, at) => ({ start: null, end: null, who: 'you', text, at: r3(at), key: '', id: 1000 + seq++ })
const work = (seconds, steps) => ({ seconds, count: steps.length, steps })

// Long on purpose: taller than a phone screen, so the view has to follow
// the bold sentence down the reply rather than sit at the thread's foot.
const SPOKEN = [
  'The mock server is speaking this reply right now.',
  'Each sentence turns bold as the voice reaches it, on the local clock between polls.',
  'Offsets come from the server; the page adds however long ago it heard them.',
  'This reply is long on purpose, taller than a phone screen, so the thread has to follow the voice down the page.',
  'While it plays, the view keeps the bold sentence in sight instead of sticking to the bottom.',
  'Scroll by hand and it stops following, and a small pill offers to pick the thread back up.',
  'Pause, and nothing moves: the page stays where the voice stopped.',
  'The speech bar above the composer says the same thing as this line, because both read one clock.',
  'Its keys skip a sentence back or forward, and the bold jumps with them after the next poll.',
  'Ambient pictures stay hidden unless Settings asks for them; figures show as a thumbnail.',
  'When the reply ends, it keeps the same at, so it replaces itself rather than appearing twice.',
  'Then the loop starts again, so there is always something to watch.'
]
const SPOKEN_TEXT = SPOKEN.join(' ')
const SPOKEN_OFFSETS = [0, 3.2, 7.9, 12.4, 18.2, 23.1, 28.4, 32.6, 38.1, 43.6, 48.9, 54.1]
const SPOKEN_LEN = 58

function session(id, title, extra) {
  return { session: id, title, pane: null, live: true, item: `mock-item-${id.slice(0, 8)}`, lines: [], pending: false, working: null, approval: null, suggestion: '', ...extra }
}

const S = {}
function add(s) {
  S[s.session] = s
  return s
}

add(
  session(randomUUID(), 'Mock: speaking now', {
    pane: '%11',
    recap: { text: 'The follow-along is being tried on a long reply; the bold sentence should stay on screen.', at: r3(T0 - 100), source: 'claude' },
    state: 'waiting',
    suggestion: 'what happens when it ends?',
    lines: [
      youLine('Show me the follow-along.', T0 - 120),
      agentLine('Sure — the next reply is spoken aloud, and the page follows it. Here is the shape of it.', T0 - 110, {
        work: work(8.2, ['Read the contract', 'Find the live line']),
        images: ['/img/mock-figure.svg'],
        figure: true
      }),
      youLine('Go on then.', T0 - 30),
      // Ambient art beside the spoken reply: hidden unless Settings says so.
      agentLine(SPOKEN_TEXT, T0 - 25, { work: work(12.5, ['Read the live line', 'Split into sentences']), images: ['/img/mock-c.svg', '/img/mock-d.svg'], figure: false })
    ]
  })
)

// A reply with a table, links and code (lib/rich.tsx): drawn as themselves;
// the voice describes the table and skips the code, and the bold follows.
const RICH_TEXT = [
  'Here are the three options.',
  '',
  '| Option | Cost | Notes |',
  '|---|--:|---|',
  '| **Keep** | 0 | as it is |',
  '| Move | 12 | see [the plan](https://example.com/plan) |',
  '| Drop | 3 | `rm -rf` |',
  '',
  'Pick the second one; the [docs](https://example.com/docs) are linked, and so is https://example.com/raw.',
  '',
  '```sh',
  'media say --hold "hi"',
  '```',
  '',
  'Done.'
].join('\n')
const RICH_SPOKEN = [
  'Here are the three options.',
  'A table of three options with their cost.',
  'Keep is free and Drop is cheapest.',
  'Pick the second one; the docs are linked, and so is example.com link.',
  'Done.'
]
add(
  session(randomUUID(), 'Mock: a table and links', {
    live: false, state: null, pane: null,
    lines: [youLine('Compare the options.', T0 - 86400 * 5), agentLine(RICH_TEXT, T0 - 86400 * 5 + 10, { spoken: RICH_SPOKEN })]
  })
)

// §6.16: conversations known only from their harness's own store — never
// spoken, not running. The old one is outside the server's 30-day window,
// so it is listed only when the app asks for `history=all`.
add(
  session(randomUUID(), 'Mock: codex, never spoke', {
    live: false, state: null, pane: null, item: null, harness: 'codex', store: true,
    project: 'p-demo', at: r3(T0 - 86400 * 4),
    lines: [youLine('what broke the build', T0 - 86400 * 4)]
  })
)
add(
  session(randomUUID(), 'Mock: pi, months ago', {
    live: false, state: null, pane: null, item: null, harness: 'pi', store: true,
    older: true, at: r3(T0 - 86400 * 90),
    lines: [youLine('play my book', T0 - 86400 * 90)]
  })
)

const approvalQuestion = (n) => ({
  question: n ? `Do you want to run \`pnpm build\`? (asked ${n + 1} times)` : 'Do you want to run `pnpm build`?',
  partial: false,
  options: [
    { n: 1, label: 'Yes', detail: '' },
    { n: 2, label: "Yes, and don't ask again for pnpm commands", detail: 'in /home/you/projects/demo' },
    { n: 3, label: 'No, and tell Claude what to do differently', detail: '' }
  ],
  agent: 'claude'
})
const withKey = (a) => ({ ...a, key: hex12(JSON.stringify(a)) })

/**
 * An AskUserQuestion as the thread's `approval` (§6.2, kind "question"):
 * the v0 fields for old clients plus `questions`, each option numbered from
 * 1 within its question. `checked` ticks options as if done at the desk;
 * `options` overrides the v0 list; `id` makes it headless.
 */
function questionApproval(qs, { checked = {}, options, id, tool_use_id = '', salt = '' } = {}) {
  const questions = qs.map((q, i) => ({
    question: q.question + (i === 0 ? salt : ''),
    header: q.header || '',
    multiSelect: !!q.multiSelect,
    free_text: true,
    options: q.options.map((o, j) => ({ n: j + 1, label: o.label, description: o.description || '', detail: o.description || '', checked: (checked[i] || []).includes(j + 1) }))
  }))
  const one = qs.length === 1 && !qs[0].multiSelect
  return withKey({
    question: questions[0].question,
    partial: !one,
    options: options || questions[0].options.map((o) => ({ n: o.n, label: o.label, detail: o.description, checked: o.checked })),
    agent: 'claude',
    kind: 'question',
    multiSelect: qs.some((q) => q.multiSelect),
    free_text: true,
    questions,
    tool_use_id,
    ...(id ? { id } : {})
  })
}

/**
 * The structured answer checked against the question (§6.4): every question
 * answered, option numbers that exist, at most one choice (an option or your
 * own words) for a single-select. `{question: "label, label, words"}`, or
 * the reason it will not do.
 */
function structuredAnswers(approval, answers) {
  if (!Array.isArray(answers) || !answers.length) return 'answers needed'
  const out = {}
  for (const a of answers) {
    const q = approval.questions?.[a?.question_index]
    if (!q) return `no such question ${a?.question_index}`
    const sel = Array.isArray(a.selected) ? a.selected.map(Number) : []
    const other = String(a.other_text || '').trim()
    const bad = sel.find((n) => !q.options.some((o) => o.n === n))
    if (bad !== undefined) return `no option ${bad} in question ${a.question_index}`
    if (!q.multiSelect && sel.length + (other ? 1 : 0) > 1) return `one answer only for ${JSON.stringify(q.question)}`
    if (!sel.length && !other) return `no answer for ${JSON.stringify(q.question)}`
    out[q.question] = [...sel.map((n) => q.options.find((o) => o.n === n).label), ...(other ? [other] : [])].join(', ')
  }
  const missing = approval.questions.find((q) => !(q.question in out))
  if (missing) return `no answer for ${JSON.stringify(missing.question)}`
  return out
}

add(
  session(randomUUID(), 'Mock: needs approval', {
    pane: '%12',
    state: 'approval',
    asked: 0,
    lines: [youLine('Build it and tell me the size.', T0 - 60)],
    pending: true,
    working: { since: T0 - 55, count: 2, current: 'Build the bundle', current_at: T0 - 20, steps: ['Read package.json', 'Build the bundle'] },
    approval: withKey(approvalQuestion(0))
  })
)

const ASK = [
  {
    question: 'Which screen should the prototype open on?',
    options: [
      { label: 'Thread list', description: 'Live sessions first, with their state.' },
      { label: 'Last thread', description: 'Straight back into the conversation you left.' },
      { label: 'New chat', description: 'An empty composer with the place picker.' }
    ],
    multiSelect: false
  }
]
add(
  session(randomUUID(), 'Mock: asking a question', {
    pane: '%13',
    state: 'approval',
    lines: [
      youLine('Ask me something with options.', T0 - 90),
      agentLine('Which screen should the prototype open on?', T0 - 80, { ask: ASK })
    ],
    approval: questionApproval(ASK, {
      options: ASK[0].options.map((o, i) => ({ n: i + 1, label: o.label, detail: o.description })).concat([{ n: 4, label: 'Type something.', detail: '' }])
    })
  })
)

// The same question, at the foot of a reply taller than the screen (David,
// 23 Sep 2026): what he actually gets at the desk — steps, a thought and a
// long reply above the card, which used to leave the form below the fold
// with nothing saying it was there.
add(
  session(randomUUID(), 'Mock: asking after a long reply', {
    pane: '%16',
    state: 'approval',
    lines: [
      youLine('Work through it and then ask me.', T0 - 100),
      agentLine(SPOKEN_TEXT, T0 - 90, { work: work(22.5, ['Read the contract', 'Find the live line', 'Split into sentences', 'Measure the clip']) }),
      agentLine('Which screen should the prototype open on?', T0 - 80, { ask: ASK })
    ],
    approval: questionApproval(ASK, {
      options: ASK[0].options.map((o, i) => ({ n: i + 1, label: o.label, detail: o.description })).concat([{ n: 4, label: 'Type something.', detail: '' }])
    })
  })
)

// The multi-select and several-question forms (§6.2 `approval`, kind
// "question"): answered with the structured /session/answer only.
const MULTI = [
  {
    question: 'Which fruits do you like?',
    header: 'Fruit',
    options: [
      { label: 'Apple', description: 'crisp' },
      { label: 'Pear', description: 'soft' },
      { label: 'Plum', description: 'tart' }
    ],
    multiSelect: true
  }
]
add(
  session(randomUUID(), 'Mock: multi-select question', {
    pane: '%14',
    state: 'approval',
    lines: [youLine('Ask me which fruits I like.', T0 - 70)],
    // Pear already ticked at the desk: the card starts from the screen.
    approval: questionApproval(MULTI, { checked: { 0: [2] } })
  })
)
const TWO = [
  {
    question: 'Which colour?',
    header: 'Colour',
    options: [
      { label: 'Red', description: 'warm' },
      { label: 'Blue', description: 'cool' },
      { label: 'Green', description: 'calm' }
    ],
    multiSelect: false
  },
  {
    question: 'Which pets?',
    header: 'Pets',
    options: [
      { label: 'Cat', description: 'independent' },
      { label: 'Dog', description: 'loyal' },
      { label: 'Fish', description: 'quiet' }
    ],
    multiSelect: true
  }
]
add(
  session(randomUUID(), 'Mock: two questions', {
    pane: '%15',
    state: 'approval',
    // The first structured answer finds the question changed (409), as if
    // the desk had moved it on; the card re-renders and the next one lands.
    changeOnce: true,
    lines: [youLine('Ask me two things at once.', T0 - 65)],
    approval: questionApproval(TWO)
  })
)
// A headless session streams its pending ask (status "running"), so the card
// sits on that ask part rather than at the foot.
add(
  session(randomUUID(), 'Mock: headless question', {
    pane: null,
    state: 'approval',
    headless: true,
    lines: [youLine('Ask me which fruits, headless.', T0 - 50), agentLine('Which fruits do you like?', T0 - 45, { ask: MULTI, pendingAsk: 'toolu_mockheadless01' })],
    approval: questionApproval(MULTI, { id: 'req-mock-headless-1', tool_use_id: 'toolu_mockheadless01' })
  })
)

const WORK_STEPS = ['Read the thread route', 'Search for the poll cadence', 'Read useConversationLog.ts', 'Edit the working indicator', 'Run the typecheck', 'Build the bundle', 'Take a screenshot']
add(
  session(randomUUID(), 'Mock: working', {
    pane: '%14',
    state: 'working',
    lines: [youLine('Tidy the working indicator and rebuild.', T0 - 40)],
    pending: true,
    workingSince: T0 - 35
  })
)

add(session(randomUUID(), 'Mock: not on the shelf yet', { pane: '%15', state: 'waiting', item: null, lines: [youLine('A brand new chat.', T0 - 5)] }))

add(
  session(randomUUID(), 'Mock: shelved conversation', {
    live: false,
    state: null,
    recap: { text: 'We drew the thread layout: the list on the left, the thread on the right, the composer pinned at the foot. Next: try it at phone width and decide where the ambient art goes, then pick up the colours for the badges.', at: r3(T0 - 86400 * 2 + 60), source: 'claude' },
    at: r3(T0 - 86400 * 2),
    suggestion: 'can we pick this back up?',
    lines: [
      youLine('Draw me the thread layout.', T0 - 86400 * 2 - 600),
      agentLine('Here it is: the list on the left, the thread on the right, the composer pinned at the foot.\n\n- live first\n- shelved after, newest first', T0 - 86400 * 2 - 540, {
        images: ['/img/mock-figure.svg'],
        figure: true,
        work: work(212.4, ['Read app-redesign-options.md', 'Sketch the layout', 'Render the figure'])
      }),
      youLine('And some ambient art?', T0 - 86400 * 2 - 300),
      agentLine('Two small pictures, the kind the canvas draws beside a reply.', T0 - 86400 * 2 - 280, { images: ['/img/mock-a.svg', '/img/mock-b.svg'], figure: false, work: work(3.1, ['Pick colours']) })
    ]
  })
)

{
  // A long conversation, so a thread has more than the first window (20)
  // and must be opened at its foot.
  const lines = []
  const base = T0 - 86400 * 3
  for (let i = 0; i < 45; i++) {
    lines.push(youLine(`Question ${i + 1}: what about step ${i + 1}?`, base + i * 120))
    lines.push(
      agentLine(
        `Answer ${i + 1}. ` + 'This is a reply of middling length, long enough to wrap onto a few lines on a phone so the thread is properly tall. '.repeat(1 + (i % 3)),
        base + i * 120 + 30,
        { work: work(4 + i, ['Read a file', 'Think']) }
      )
    )
  }
  add(session(randomUUID(), 'Mock: long conversation', { live: false, state: null, at: r3(T0 - 86400 * 3 + 45 * 120), lines, rested: { at: r3(T0 - 86400 * 2.5), reason: 'idle-tight' }, recap: { text: 'Forty-five steps answered one by one. Next: nothing pending.', at: r3(T0 - 86400 * 2.5), source: 'agent-media' } }))
}

// Filed under Archived (§6.4), and one the idle reaper rested.
add(
  session(randomUUID(), 'Mock: archived earlier', {
    live: false,
    state: null,
    archived: true,
    rested: { at: r3(T0 - 86400 * 5), reason: 'idle' },
    at: r3(T0 - 86400 * 5),
    lines: [
      youLine('Tidy the old branch.', T0 - 86400 * 5 - 60),
      agentLine('Done; nothing left on it.', T0 - 86400 * 5 - 30),
      { ...youLine('The canvas is restarted; your change is live.', T0 - 86400 * 5 - 20), peer: { name: 'agent-media-71' } },
      agentLine('Thanks — noted.', T0 - 86400 * 5 - 10)
    ]
  })
)

// ── Real-shaped speech (red5, 22 Sep 2026) ───────────────────────────────
//
// Each has its own clock (s.real = {start, len}); it is live for len
// seconds, rests REAL_REST_S, then starts over with the appended lines gone.
const REAL_LEN_S = Number(process.env.MOCK_REAL_LEN_S ?? 70)
const REAL_REST_S = Number(process.env.MOCK_REAL_REST_S ?? 8)
const REAL_SENTENCES = Array.from({ length: 22 }, (_, i) =>
  [
    `Point ${i + 1} of the long reply, spoken the way red5 streams it.`,
    'Its clips render a few at a time, so the list of sentences grows while the voice is already speaking.',
    'The page must show the whole text from the start and let the bold walk down it.'
  ][i % 3]
)
const REAL_TEXT = REAL_SENTENCES.join(' ')
const REAL_STEP_S = REAL_LEN_S / REAL_SENTENCES.length
function realHistory(base) {
  const lines = []
  for (let i = 0; i < 6; i++) {
    lines.push(youLine(`Earlier question ${i + 1}, so the thread scrolls.`, base + i * 60))
    lines.push(agentLine(`Earlier answer ${i + 1}. ` + 'A reply of middling length that wraps onto a few lines on a phone. '.repeat(2), base + i * 60 + 20))
  }
  return lines
}
function realSession(title, variant) {
  const base = T0 - 3600
  const s = session(randomUUID(), title, { pane: variant === 'real' ? '%16' : '%17', state: 'working', variant })
  s.history = [...realHistory(base), youLine('Tell me everything, at length.', base + 900)]
  s.reply = agentLine(REAL_TEXT, base + 960)
  s.real = { start: now() + 3, appended: 0 }
  return add(s)
}
realSession('Mock: real speech (streaming, appends)', 'real')
realSession('Mock: real speech (no offsets)', 'nooffsets')

// ── The stream fixture (§11) ─────────────────────────────────────────────
//
// `Mock: stream`: a live session whose turns are scripted from the tests.
//   GET /mock/stream/append?text=   an assistant message lands now (the
//                                   transcript append the stream must show)
//   GET /mock/stream/turn           a whole turn: the listener's message,
//                                   reasoning, a tool running → done, a
//                                   redacted thought, a second tool, the
//                                   reply, then the reply SPOKEN (live
//                                   follow-along) and finished
//   GET /mock/stream/drop           end every open stream (a reconnect)
//   GET /mock/stream/refuse?on=1    refuse the stream (503) — the polling
//                                   fallback; on=0 accepts again
//   GET /mock/stream/stats          streams opened and log polls, by session
{
  const base = T0 - 1800
  const lines = []
  for (let i = 0; i < 4; i++) {
    lines.push(youLine(`Stream history question ${i + 1}.`, base + i * 60))
    lines.push(agentLine(`Stream history answer ${i + 1}. A reply that wraps onto a couple of lines on a phone.`, base + i * 60 + 20, { work: work(6, ['Read the route', 'Run the tests', 'Edit the hook']) }))
  }
  add(session(randomUUID(), 'Mock: stream', { pane: '%18', state: 'waiting', lines }))
}
const STREAM_REPLY =
  'The stream delivered every step as it happened. The reasoning came first, then the tool, running and then done. ' +
  'This reply is spoken now, so its sentences turn bold one after another while the voice reads them. ' +
  'Nothing here was polled: each change arrived as an event.'

/** The real-shaped sessions' lines and turn state, at this moment. */
function realState(s) {
  const t = now()
  let pos = t - s.real.start
  if (!s.real.hold && pos > REAL_LEN_S + REAL_REST_S) {
    s.real = { start: t, appended: 0 }
    pos = 0
  }
  const lines = [...s.history]
  const speaking = !s.real.hold && pos >= 0 && pos < REAL_LEN_S
  if (!speaking) {
    lines.push({ ...s.reply, id: s.reply.id })
    s.pending = false
    s.working = null
    s.state = 'waiting'
    return { lines }
  }
  // Clips render ahead of the voice, a few sentences at a time: at first
  // ~40 % of the text, then +3 sentences every 4 s.
  const n = Math.min(REAL_SENTENCES.length, Math.ceil(REAL_SENTENCES.length * 0.4) + 3 * Math.floor(pos / 4))
  const sentences = REAL_SENTENCES.slice(0, n)
  // Offsets revised as clips land: the not-yet-reached ones drift by a
  // fraction of a second from poll to poll.
  const wobble = Math.floor(pos / 3) % 2 ? 0.35 : 0
  const offsets = s.variant === 'nooffsets' ? [] : sentences.map((_, i) => r3(i * REAL_STEP_S + (i * REAL_STEP_S > pos ? wobble : 0)))
  if (realLost) {
    // The live row is gone while the audio plays on — a barge-in took it, or
    // the submit that owned it died (agent-media, 23 Sep 2026). What is left
    // is the turn's timeline with no claim to be playing (§6.2), and a
    // /speech/now that still knows where the player is and which turn it is
    // on. This is the case the bold used to give up on for the rest of a
    // reply. `measured: true` — the offsets are the ones the player reached.
    lines.push({ ...s.reply, id: s.reply.id, sentences, offsets, measured: true })
    s.pending = false
    s.working = null
    s.state = 'waiting'
    return { lines }
  }
  const live = {
    ...s.reply,
    id: undefined,
    live: true,
    sentences,
    sentence: null,
    offsets,
    elapsed: r3(Math.max(0, pos)),
    paused: pos < 2,
    server_time: r3(t),
    delay: 0
  }
  lines.push(live)
  if (s.variant === 'real') {
    // Appended mid-speech: the live line is no longer the last.
    if (pos > 12) lines.push(agentLine('(mock) A later message, appended while the reply above is still being spoken.', s.reply.at + 30))
    if (pos > 24) lines.push(youLine('(mock) And a reply typed at the desk meanwhile.', s.reply.at + 40))
  }
  s.pending = true
  s.state = 'working'
  const steps = WORK_STEPS.slice(0, 1 + (Math.floor(pos / 2) % WORK_STEPS.length))
  s.working = { since: r3(s.real.start), count: steps.length + Math.floor(pos / 2), current: steps[steps.length - 1], current_at: r3(t - 1), steps: steps.slice(-5), server_time: r3(t) }
  return { lines }
}

// ── Derived state, per request ────────────────────────────────────────────

function tickSession(s) {
  const t = now()
  // The approval session's dialog changes every 45 s (as if answered and
  // re-asked at the desk), so a card left open goes stale and its next press
  // gets 409 "the question has changed".
  if (s.asked !== undefined && s.approval) {
    const n = Math.floor((t - T0) / 45)
    if (n !== s.asked) {
      s.asked = n
      s.approval = withKey(approvalQuestion(n))
    }
  }
  if (s.shelvedIn && t > s.shelvedIn) {
    s.item = `mock-item-${s.session.slice(0, 8)}`
    delete s.shelvedIn
  }
  if (s.workingSince) {
    const i = Math.min(WORK_STEPS.length, 1 + Math.floor((t - s.workingSince) / 4) % (WORK_STEPS.length + 3))
    const steps = WORK_STEPS.slice(0, i)
    s.working = { since: r3(s.workingSince), count: steps.length, current: steps[steps.length - 1], current_at: r3(t - 1), steps: steps.slice(-5), server_time: r3(t) }
  } else if (s.working) {
    s.working = { ...s.working, server_time: r3(t) }
  }
  for (const job of s.jobs || []) if (t >= job.at && !job.done) (job.done = true), job.run()
}

// ── The voice (§6.5) ──────────────────────────────────────────────────────
//
// One reply is "being spoken" at a time, shared by /speech/now and the log's
// live line so the bar and the follow-along agree. The speaking fixture's
// reply plays on a loop: when it ends, the voice is quiet for SPEECH_REST_S
// ("finished") and then says it again. Every /speech/ctl action moves it.

// MOCK_SPEECH_REST_S=0 loops the reply without a break (a long test run
// stays live); jump-end always rests, so "finished" can still be seen.
const SPEECH_REST_S = Number(process.env.MOCK_SPEECH_REST_S ?? 10)
const JUMP_END_REST_S = 10
const SPEED_RUNGS = [1.0, 1.25, 1.5, 2.0, 3.0] // agent_media_core/cli.py _SPEED_RUNGS
function speedNext(cur, dir) {
  const eps = 1e-6
  if (dir > 0) {
    if (cur < 1 - eps) return Math.min(Math.round((cur + 0.1) * 100) / 100, 1)
    return SPEED_RUNGS.find((r) => r > cur + eps) ?? 3.0
  }
  if (cur > 1 + eps) return [...SPEED_RUNGS].reverse().find((r) => r < cur - eps) ?? 1.0
  return Math.max(Math.round((cur - 0.1) * 100) / 100, 0.3)
}

/** A reply's sentences and their offsets (the fixture's, or ~0.36 s a word). */
function speechOf(line) {
  if (line.text === SPOKEN_TEXT) return { sentences: SPOKEN, offsets: SPOKEN_OFFSETS, len: SPOKEN_LEN }
  // `spoken`: what the server really said, where it differs from the text —
  // a table described in words, a link's url dropped (the rich-text fixture).
  const sentences = line.spoken || line.text.split(/(?<=[.!?])\s+/).filter(Boolean)
  const offsets = []
  let t = 0
  for (const x of sentences) {
    offsets.push(r3(t))
    t += Math.max(1.5, x.split(/\s+/).length * 0.36)
  }
  return { sentences, offsets, len: r3(t) }
}

const V = {
  on: null, // { s, line, sentences, offsets, len } — what is being said
  anchorT: 0, // wall time of the last anchor
  anchorPos: 0, // reply seconds at the anchor
  paused: false,
  speed: 1.0,
  muted: false,
  volume: 80,
  restUntil: 0, // quiet until then, then the fixture's reply again
  loop: null // the fixture's reply, said again after a rest
}

function vPos() {
  if (!V.on) return 0
  return V.paused ? V.anchorPos : V.anchorPos + (now() - V.anchorT) * V.speed
}
function vSeek(pos) {
  V.anchorPos = Math.max(0, pos)
  V.anchorT = now()
}
function vSay(s, line, pos = 0) {
  V.on = { s, line, ...speechOf(line) }
  V.paused = false
  vSeek(pos)
}
function vStop(rest = SPEECH_REST_S) {
  V.on = null
  V.paused = false
  V.restUntil = now() + rest
}
/** Advance the clock: a reply that ran out ends; after a rest, the loop starts again. */
function vTick() {
  if (V.on && vPos() >= V.on.len) vStop()
  if (!V.on && V.loop && now() >= V.restUntil) vSay(V.loop.s, V.loop.line)
}
function vSentence() {
  const pos = vPos()
  let i = 0
  V.on.offsets.forEach((o, k) => {
    if (pos >= o) i = k
  })
  return i
}
/** Every spoken agent line, newest first — the turns `prev`/`replay N` count. */
function spokenTurns() {
  const all = []
  for (const s of Object.values(S)) for (const l of s.lines) if (l.who === 'agent' && l.id) all.push({ s, line: l })
  return all.sort((a, b) => b.line.at - a.line.at)
}

/**
 * MOCK_REAL_VOICE=1: /speech/now reports the streaming real-shaped session
 * instead, modelled on red5 (22 Sep 2026): the player falls behind
 * `elapsed` (stalls between clips: 1.4 s, growing 0.02 s a second), and
 * its `pos` is STALE — a snapshot taken at most once a second, answered
 * 1.5 s after the request arrives, as the canvas's 1 Hz speech poller and
 * a slow /speech/now do.
 */
const REAL_VOICE = process.env.MOCK_REAL_VOICE === '1'
export const realPlayerPos = (elapsed) => Math.max(0, 0.98 * elapsed - 1.4)
const realSnap = { t: 0, pos: 0 }
/**
 * Seconds the player has been moved by something the app did not do — a
 * skip at the desk, a media key (GET /mock/real/jump?by=). `elapsed` does
 * not move with it, so the app's clock is left behind the voice, which is
 * what the "Follow along" pill resyncs. Cleared by /mock/real/restart.
 */
let realJump = 0
/**
 * The live row has been lost while the audio plays on (GET /mock/real/lose).
 * The message keeps its words and offsets as a `timeline`, and /speech/now
 * keeps reporting a live player and which turn it is on.
 */
let realLost = false
function realVoiceNow() {
  const s = Object.values(S).find((x) => x.variant === 'real')
  if (!s || s.real.hold) return null
  const t = now()
  const e = t - s.real.start
  if (e < 0 || e >= REAL_LEN_S) return null
  if (t - realSnap.t >= 1) {
    realSnap.t = t
    realSnap.pos = Math.max(0, realPlayerPos(e) + realJump)
  }
  return { ok: true, live: true, speaking: e >= 2, paused: e < 2, sentence: '', session: s.session, title: s.title, item: s.item, pos: Math.floor(realSnap.pos), dur: Math.ceil(REAL_LEN_S), speed: 1, muted: false,
    // Which turn the player is on (§6.5) — what makes `pos` a position into
    // something. `id` on a replay; here the live turn's own `at`.
    turn: { at: s.reply.at } }
}

/** §6.5 `queued`: replies said but not heard yet (GET /mock/arrive?mode=queue adds one). */
const QUEUED = []

function speechNow() {
  const out = speechNowHeard()
  return { ...out, replay: false, queued: QUEUED.map((q) => ({ ...q })) }
}

function speechNowHeard() {
  if (REAL_VOICE) {
    const r = realVoiceNow()
    if (r) return r
  }
  vTick()
  if (!V.on) return { ok: true, live: false, speaking: false, paused: false, sentence: '', session: null, title: '', item: null, pos: null, dur: null, speed: null, muted: V.muted }
  const { s } = V.on
  return {
    ok: true,
    live: true,
    speaking: !V.paused,
    paused: V.paused,
    sentence: V.on.sentences[vSentence()],
    session: s.session,
    title: s.title,
    item: s.item,
    pos: Math.floor(vPos()),
    dur: Math.ceil(V.on.len),
    speed: V.speed,
    muted: V.muted
  }
}

/** Every /speech/ctl the app sent, for the tests (GET /mock/speech/log). */
const CTL_LOG = []

/** Returns `out`, as `media` would print it, or null for an unknown action. */
function speechCtl(action, arg, body = {}) {
  vTick()
  const n = Math.max(1, Math.min(999, Number(arg) || 1))
  const turns = spokenTurns()
  const replayTurn = (k) => {
    const t = turns[Math.min(k, turns.length) - 1]
    if (!t) return 'nothing to replay'
    vSay(t.s, t.line)
    return String(Math.min(k, turns.length))
  }
  const step = (d) => {
    if (!V.on) return 'nothing playing'
    const i = vSentence() + d
    if (i >= V.on.offsets.length) {
      vStop(Math.max(SPEECH_REST_S, JUMP_END_REST_S))
      return 'end'
    }
    // Back from well into a sentence restarts it first, as the popup's h does.
    const back = d < 0 && vPos() - V.on.offsets[vSentence()] > 1.5 ? vSentence() : Math.max(0, i)
    vSeek(V.on.offsets[d < 0 ? back : i])
    return `sentence ${d < 0 ? back : i}`
  }
  switch (action) {
    case 'toggle':
      if (!V.on) return replayTurn(1)
      vSeek(vPos())
      V.paused = !V.paused
      return V.paused ? 'paused' : 'playing'
    case 'skip-':
      return step(-1)
    case 'skip+':
      return step(1)
    // The fixtures have no paragraphs; two sentences stand in for one.
    case 'para-':
      return step(-2)
    case 'para+':
      return step(2)
    case 'jump-end':
      if (V.on) vStop(Math.max(SPEECH_REST_S, JUMP_END_REST_S))
      return 'end'
    case 'prev':
      // Well into the reply: restart it first; else the turn before `n`.
      if (V.on && vPos() > 3 && V.on.line.id === turns[n - 1]?.line.id) {
        vSeek(0)
        V.paused = false
        return String(n)
      }
      return replayTurn(n + 1)
    case 'replay':
      return replayTurn(n)
    case 'replay-id': {
      const t = turns.find((x) => x.line.id === Number(arg))
      if (!t) return `no history row ${arg}`
      // "Read from here" (§6.5): from a sentence of GET /speech/sentences.
      const { offsets } = speechOf(t.line)
      const from = Number.isInteger(body.sentence) ? Math.min(body.sentence, offsets.length - 1) : 0
      vSay(t.s, t.line, offsets[from] || 0)
      return String(turns.indexOf(t) + 1)
    }
    case 'goto-sentence': {
      // Checked by the route: an index, and a reply being said.
      const i = Math.min(Number(arg), V.on.offsets.length - 1)
      vSeek(V.on.offsets[i])
      return `sentence ${i}`
    }
    case 'speed-':
    case 'speed+':
      vSeek(vPos())
      V.speed = speedNext(V.speed, action === 'speed+' ? 1 : -1)
      return `speed ${V.speed}`
    case 'speed0':
      vSeek(vPos())
      V.speed = 1.0
      return 'speed 1'
    case 'vol-':
    case 'vol+':
      V.volume = Math.max(0, Math.min(100, V.volume + (action === 'vol+' ? 5 : -5)))
      return `volume ${V.volume}`
    case 'mute':
      V.muted = !V.muted
      return V.muted ? 'muted' : 'unmuted'
    default:
      return null
  }
}

/** The line being said, marked live in its place (§6.2 "The live line"). */
function liveLine(line) {
  const t = now()
  const pos = vPos()
  return {
    ...line,
    id: undefined, // history_id stays on the server while live
    live: true,
    sentences: V.on.sentences,
    sentence: vSentence(),
    offsets: V.on.offsets,
    elapsed: r3(pos),
    paused: V.paused,
    server_time: r3(t),
    delay: 0
  }
}

// Mid-way through its reply at start, like a voice already talking.
{
  const s = Object.values(S).find((x) => x.title === 'Mock: speaking now')
  V.loop = { s, line: s.lines[s.lines.length - 1] }
  vSay(V.loop.s, V.loop.line, 4)
}

// §6.1 (22 Sep 2026): every row carries archived, rested (null while live) and pinned.
const flags = (s) => ({ archived: !!s.archived, rested: s.live ? null : s.rested || null, pinned: !!s.pinned, priority: s.speech === 'interrupt' || s.speech === 'auto', speech: s.speech || 'normal', project: s.project ?? null, cwd: s.cwd ?? null, harness: s.harness || 'claude', ...(s.store ? { source: 'store' } : {}) })
const row = (s) => (s.live ? { session: s.session, title: s.title, live: true, pane: s.pane, recap: s.recap || null, ...flags(s) } : { session: s.session, title: s.title, live: false, pane: null, at: s.at, recap: s.recap || null, ...flags(s) })

// ── Search (§6.14) ────────────────────────────────────────────────────────
//
// Over the fixtures' §6.2.2 messages, as the index would hold them: every
// term (case-insensitive) must be in a message's words — the last as a
// prefix — newest first; tool steps only with `tools=1`. Threads by title,
// recap and project. Memory: a fixed list, when SEARCH.memory says the host
// has agent-memory (GET /mock/search?memory=0 says it has not).

const SEARCH = { memory: true, indexing: false }
const MEMORIES = [
  { id: 'mem-1', user: 'ryer', score: 0.82, text: 'David prefers the follow-along bold a little ahead of the voice.' },
  { id: 'mem-2', user: 'sam', score: 0.64, text: 'The long conversation fixture answers forty-five questions.' }
]

const termsOf = (text) => {
  const out = []
  for (const m of String(text || '').matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1]) {
      const w = m[1].match(/[\p{L}\p{N}_]+/gu)
      if (w) out.push(w.join(' '))
    } else out.push(...(m[2].match(/[\p{L}\p{N}_]+/gu) || []))
  }
  return out
}

/** Where every term is in `text` ([start, end] each), or null if one is missing. */
function spansOf(text, terms) {
  const low = text.toLowerCase()
  const spans = []
  for (const t of terms) {
    const needle = t.toLowerCase()
    // At the start of a word, as FTS matches (a word, or the start of one).
    const found = []
    for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) {
      if (i === 0 || !/[\p{L}\p{N}_]/u.test(low[i - 1])) found.push([i, i + needle.length])
    }
    if (!found.length) return null
    spans.push(...found)
  }
  return spans.sort((a, b) => a[0] - b[0])
}

/** ~14 words around the first match, with its offsets. */
function snippetOf(text, terms) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const spans = spansOf(flat, terms) || []
  const first = spans[0]?.[0] ?? 0
  let start = Math.max(0, flat.lastIndexOf(' ', Math.max(0, first - 50)) + 1)
  if (first - start > 60) start = first
  let end = Math.min(flat.length, start + 140)
  const cut = flat.indexOf(' ', end)
  end = cut < 0 ? flat.length : cut
  const pre = start > 0 ? '…' : ''
  const body = flat.slice(start, end)
  const snippet = pre + body + (end < flat.length ? '…' : '')
  const match = spans.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start + pre.length, b - start + pre.length])
  return { text: snippet, match }
}

function searchOf(q) {
  const text = q.get('q') || ''
  const terms = termsOf(text)
  if (!terms.length) return { __status: 400, error: 'nothing to search for' }
  const tools = q.get('tools') === '1'
  const limit = Math.min(100, Number(q.get('limit')) || 20)
  const before = q.get('before') ? Number(q.get('before')) : Infinity
  const all = Object.values(S)
  const hits = []
  for (const s of all) {
    const msgs = messagesOf(s, s.real ? realState(s).lines : s.lines)
    const thread = { title: s.title, project: s.project ?? null, harness: 'claude', live: !!s.live, archived: !!s.archived }
    for (const m of msgs) {
      if (!(m.at < before)) continue
      const words = m.parts
        .map((p) => (p.type === 'text' ? p.text : p.type === 'reasoning' ? p.text : p.type === 'ask' ? [...p.ask.map((x) => x.question), p.answer].join('\n') : ''))
        .filter(Boolean)
        .join('\n\n')
      if (words && spansOf(words, terms)) hits.push({ session: s.session, message: m.id, role: m.role, at: m.at, kind: 'text', snippet: snippetOf(words, terms), thread })
      if (!tools) continue
      const steps = m.parts.filter((p) => p.type === 'tool').map((p) => [p.name, p.title, p.input_summary, p.result_summary].filter(Boolean).join('\n')).join('\n\n')
      if (steps && spansOf(steps, terms)) hits.push({ session: s.session, message: m.id, role: m.role, at: m.at, kind: 'tool', snippet: snippetOf(steps, terms), thread })
    }
  }
  hits.sort((a, b) => b.at - a.at)
  const messages = hits.slice(0, limit)
  const out = { q: text, terms, tools, threads: [], messages, next: hits.length > limit ? messages[messages.length - 1].at : null, indexing: SEARCH.indexing }
  if (before !== Infinity) return out
  const low = terms.map((t) => t.toLowerCase())
  for (const s of all) {
    const fields = { title: s.title || '', recap: s.recap?.text || '', project: s.project || '' }
    const hay = Object.values(fields).join(' \n').toLowerCase()
    if (!low.every((t) => hay.includes(t))) continue
    const match = {}
    for (const [k, v] of Object.entries(fields)) {
      const sp = v ? (low.map((t) => spansOf(v, [t])).filter(Boolean).flat()) : []
      if (sp.length) match[k] = sp.sort((a, b) => a[0] - b[0])
    }
    const lastAt = Math.max(s.at || 0, ...s.lines.map((l) => l.at || 0))
    out.threads.push({ session: s.session, title: s.title, project: s.project ?? null, harness: 'claude', live: !!s.live, archived: !!s.archived, recap: s.recap?.text || null, at: r3(lastAt) || null, match })
  }
  out.threads.sort((a, b) => (b.at || 0) - (a.at || 0))
  if (q.get('memory') !== '0') {
    out.memory = SEARCH.memory ? { available: true, items: MEMORIES.filter((m) => low.every((t) => m.text.toLowerCase().includes(t))) } : { available: false }
  }
  return out
}

function logOf(s, q = null) {
  tickSession(s)
  vTick()
  const lines = s.real ? realState(s).lines : s.lines.map((l) => (V.on && V.on.s === s && V.on.line === l ? liveLine(l) : l))
  const last = lines[lines.length - 1]
  const pending = s.pending || (!!last && last.who === 'you')
  const out = { ok: true, session: s.session, lines, pending, working: s.working, approval: s.approval, suggestion: pending ? '' : s.suggestion, recap: null }
  // §6.2.2: messages only when asked for (`messages=1`), and always on the stream.
  if (q && q.around) Object.assign(out, aroundOf(messagesOf(s, lines), q.around, q.limit))
  else if (q && q.messages) Object.assign(out, pageOf(messagesOf(s, lines), q.before, q.limit))
  // The lines never say a turn is running on their own; the messages do.
  return out
}

/** A reply lands in a session: the listener's line, a turn, an answer. */
/**
 * How /reply behaves (GET /mock/reply?delay=&skew=&flatten=&fail= sets it):
 * the listener's line lands in the log at once, then the answer waits
 * `delay` ms — so a poll can bring the line back BEFORE /reply answers, the
 * race David's phone hit. `skew` s shifts the server's `at` (its clock vs
 * the phone's); `flatten` records the text with its whitespace flattened,
 * as a pane would; `fail` refuses with 500.
 */
const REPLY = { delay: 0, skew: 0, flatten: false, fail: false }

function receive(s, text) {
  const t = now()
  const into = s.real ? s.history : s.lines
  into.push(youLine(REPLY.flatten ? text.replace(/\s+/g, ' ').trim() : text, t + REPLY.skew))
  s.live = true
  s.pane = s.pane || `%${20 + Object.keys(S).length}`
  s.state = 'working'
  s.pending = true
  s.suggestion = ''
  s.jobs = [
    { at: t + 1.5, run: () => (s.workingSince = now()) },
    {
      at: t + 7,
      run: () => {
        delete s.workingSince
        s.working = null
        s.pending = false
        s.state = 'waiting'
        into.push(agentLine(`(mock) I heard: “${text.slice(0, 120)}”.`, now(), { work: work(5.4, WORK_STEPS.slice(0, 2)) }))
        s.suggestion = 'thanks'
      }
    }
  ]
}

// ── Messages (§6.2.2) ─────────────────────────────────────────────────────
//
// The fixtures are written as lines; their §6.2.2 messages are derived here,
// the way the server reads a transcript: a user message per listener line
// (not the answer to an ask — that is the ask's tool result), an assistant
// message per agent line with a redacted "thought", the turn's steps as
// tool parts (from `work`, or the line's own `pre` parts) and the reply as
// the last text part. Ids are stable as a message grows: an assistant
// message's id is its turn (the listener line before it) and its place in
// that turn, as a transcript uuid of the turn's first record would be. A
// session at work with no reply yet gets a running assistant message from
// its `working` steps, with the id its reply will have — so the reply
// REPLACES it, as on the server.

const uuidOf = (text) => {
  const h = createHash('sha1').update(text).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const TOOL_NAMES = ['Bash', 'Read', 'Grep', 'Edit']
const stepPart = (s, turn, k, title, status = 'done') => ({
  type: 'tool',
  name: TOOL_NAMES[k % TOOL_NAMES.length],
  title,
  input_summary: `(mock) ${title.toLowerCase()} — ` + 'an input summary of the kind the server cuts at 300 characters. '.repeat(1 + (k % 2)),
  status,
  result_summary: status === 'running' ? '' : status === 'error' ? 'Exit code 1\n(mock) it failed' : `(mock) ${title}: ok\n` + 'a line of output\n'.repeat(1 + (k % 3)),
  tool_use_id: `toolu_${hex12(s.session + turn + k)}`
})
const LIVE_KEYS = ['sentences', 'sentence', 'offsets', 'elapsed', 'server_time', 'delay', 'paused']

function messagesOf(s, lines) {
  const out = []
  let turn = 'start'
  let ordinal = 0
  lines.forEach((l, i) => {
    const prev = lines[i - 1]
    if (l.who === 'you') {
      if (prev && prev.who === 'agent' && prev.ask) return // the ask's answer, not a prompt
      turn = String(l.at)
      ordinal = 0
      out.push({
        id: uuidOf(`${s.session}:u:${l.at}`),
        role: 'user',
        at: l.at,
        parts: [{ type: 'text', text: l.text }],
        spoken: l.id ? { id: l.id, key: '', at: l.at } : null,
        turn: { running: false },
        ...(l.command ? { command: l.command } : {}),
        ...(l.peer ? { peer: l.peer } : {})
      })
      return
    }
    const id = uuidOf(`${s.session}:a:${turn}:${ordinal++}`)
    const next = lines[i + 1]
    let parts
    if (l.ask && l.pendingAsk && s.approval) {
      // A headless session's ask, streamed while it is still pending.
      parts = [{ type: 'ask', ask: l.ask, status: 'running', answer: '', tool_use_id: l.pendingAsk }]
    } else if (l.ask) {
      // Written to the transcript only once answered (§6.2.2).
      if (!next || next.who !== 'you') return
      parts = [{ type: 'ask', ask: l.ask, status: 'done', answer: next.text, tool_use_id: `toolu_${hex12(id)}` }]
    } else if (l.pre) {
      parts = [...l.pre]
      if (l.text) parts.push({ type: 'text', text: l.text })
    } else {
      parts = [{ type: 'reasoning', text: '', redacted: true }]
      ;(l.work?.steps || []).forEach((step, k) => {
        if (k === 1) parts.push({ type: 'reasoning', text: `(mock) Narration between steps: ${step.toLowerCase()} next.`, redacted: false })
        parts.push(stepPart(s, turn, k, step))
        if (k % 2 === 0) parts.push({ type: 'reasoning', text: '', redacted: true })
      })
      parts.push({ type: 'text', text: l.text })
    }
    const spoken =
      l.id || l.live
        ? {
            id: l.live ? null : l.id,
            key: l.key,
            at: l.at,
            ...(l.images ? { images: l.images, figure: !!l.figure } : {}),
            ...(l.live ? { live: Object.fromEntries(LIVE_KEYS.map((k) => [k, l[k]])) } : {}),
            // The newest turn's timeline when nothing is live (§6.2).
            ...(!l.live && l.sentences
              ? { timeline: { sentences: l.sentences, offsets: l.offsets || [], measured: !!l.measured } }
              : {})
          }
        : null
    out.push({ id, role: 'assistant', at: l.at, parts, spoken, turn: { running: !!l.running && s.live } })
  })
  // At work, no reply yet: the turn so far.
  const last = lines[lines.length - 1]
  if (s.live && s.working && last && last.who === 'you') {
    const steps = s.working.steps || []
    const parts = [{ type: 'reasoning', text: '', redacted: true }]
    steps.forEach((step, k) => parts.push(stepPart(s, turn, k, step, k === steps.length - 1 ? 'running' : 'done')))
    out.push({ id: uuidOf(`${s.session}:a:${turn}:0`), role: 'assistant', at: r3(s.working.since), parts, spoken: null, turn: { running: true } })
  }
  return out
}

/**
 * §6.14 jump: the page holding `around`, from 5 before it to the newest —
 * or, past 500, `limit` from there with `newer: true`. Not there: the
 * newest page, `found: false`.
 */
function aroundOf(all, around, limit = 60) {
  const i = all.findIndex((m) => m.id === around)
  if (i < 0) return { ...pageOf(all, '', limit), around: { id: around, found: false, newer: false }, newer: false }
  const start = Math.max(0, i - 5)
  const newer = all.length - start > 500
  const messages = newer ? all.slice(start, start + limit) : all.slice(start)
  return { messages, older: start > 0, around: { id: around, found: true, newer }, newer }
}

/** §6.2 paging: the newest `limit`, or those before `before`. */
function pageOf(all, before, limit = 60) {
  let end = all.length
  if (before) {
    const i = all.findIndex((m) => m.id === before)
    end = i >= 0 ? i : 0
  }
  const start = Math.max(0, end - Math.min(500, Math.max(1, limit)))
  return { messages: all.slice(start, end), older: start > 0 }
}

// ── The per-thread stream (§11) ──────────────────────────────────────────
//
// Each connection is its own watcher (the server shares one per session;
// the difference is invisible to a client): a `snapshot` first, then every
// MOCK_STREAM_TICK_MS the thread is read again and what changed is sent —
// `message` (append / replace by id; the live clock's ticking fields are
// not a change), `live` (a new reply, a new sentence, pause/resume, offsets,
// or the clock jumping more than 1 s: never merely ticking), `working`,
// `approval`, `suggestion`, `state`, `recap` (each without its clock), and
// `ping` after MOCK_PING_S of silence.

const STREAM_TICK_MS = Number(process.env.MOCK_STREAM_TICK_MS ?? 100)
const PING_MS = Number(process.env.MOCK_PING_S ?? 15) * 1000
const STREAM = { refuse: false }
/** /session/close and /session/archive (GET /mock/session?fail=&delay=). */
const SESSION_OPS = { fail: '', delay: 0 }
const STATS = { streams: {}, log: {} }
const OPEN = new Set()

const stateOf = (s) => ({ state: s.live ? s.state || 'waiting' : 'ended', live: !!s.live, pane: s.live ? s.pane : null })
function envelopeOf(s) {
  const env = logOf(s, { messages: true })
  delete env.ok // REALITY (red5): the snapshot has no `ok`
  return { ...env, ...stateOf(s), resumable: true, agents: agentCounts(s.session), project: s.project ?? null, cwd: s.cwd ?? null }
}
const TICKING = new Set(['elapsed', 'server_time', 'sentence', 'paused', 'delay'])
function sigOf(m) {
  const live = m.spoken?.live
  if (!live) return JSON.stringify(m)
  return JSON.stringify({ ...m, spoken: { ...m.spoken, live: Object.fromEntries(Object.entries(live).filter(([k]) => !TICKING.has(k))) } })
}
function liveOfMessages(msgs) {
  for (const m of msgs) if (m.spoken?.live) return { id: m.id, at: m.spoken.at, ...m.spoken.live }
  return null
}
const noClock = (v) => (v && typeof v === 'object' ? JSON.stringify({ ...v, server_time: undefined }) : JSON.stringify(v))

function openStream(req, res, s) {
  STATS.streams[s.session] = (STATS.streams[s.session] || 0) + 1
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...CORS })
  res.write('retry: 2000\n\n')
  const c = { res, s, n: 0, sigs: new Map(), last: {}, live: null, liveRead: 0, wrote: Date.now(), timer: null }
  const send = (event, data) => {
    c.n += 1
    res.write(`id: ${c.n}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    c.wrote = Date.now()
  }
  const env = envelopeOf(s)
  for (const m of env.messages) c.sigs.set(m.id, sigOf(m))
  c.live = liveOfMessages(env.messages)
  c.liveRead = now()
  c.last = { working: noClock(env.working), approval: noClock(env.approval), suggestion: noClock({ text: env.suggestion }), state: noClock(stateOf(s)), recap: noClock(env.recap), agents: noClock(env.agents) }
  send('snapshot', env)
  const tick = () => {
    const e = envelopeOf(s)
    for (const m of e.messages) {
      const sig = sigOf(m)
      const old = c.sigs.get(m.id)
      if (old === sig) continue
      c.sigs.set(m.id, sig)
      send('message', { op: old === undefined ? 'append' : 'replace', message: m })
    }
    const live = liveOfMessages(e.messages)
    const t = now()
    let changed = !c.live !== !live
    if (!changed && live) {
      changed = ['id', 'sentence', 'paused', 'delay'].some((k) => c.live[k] !== live[k]) || JSON.stringify(c.live.offsets) !== JSON.stringify(live.offsets)
      if (!changed && !live.paused) changed = Math.abs(live.elapsed - (c.live.elapsed + (t - c.liveRead))) > 1
    }
    if (changed) send('live', live)
    if (changed || !live || live.paused) (c.live = live), (c.liveRead = t)
    else if (live) (c.live = { ...live, elapsed: c.live.elapsed + (t - c.liveRead) }), (c.liveRead = t)
    const cur = { working: e.working, approval: e.approval, suggestion: { text: e.suggestion }, state: stateOf(s), recap: e.recap, agents: e.agents }
    for (const [k, v] of Object.entries(cur)) {
      const sig = noClock(v)
      if (c.last[k] === sig) continue
      c.last[k] = sig
      send(k, v)
    }
    if (Date.now() - c.wrote >= PING_MS) send('ping', {})
  }
  c.timer = setInterval(() => {
    try {
      tick()
    } catch (e) {
      console.error('stream tick', e)
    }
  }, STREAM_TICK_MS)
  OPEN.add(c)
  const end = () => {
    clearInterval(c.timer)
    OPEN.delete(c)
  }
  req.on('close', end)
  res.on('close', end)
}

/** The scripted turn in `Mock: stream` (GET /mock/stream/turn). */
function streamTurn(s) {
  const t0 = now()
  s.lines.push(youLine('Stream test: show me a turn.', t0))
  s.state = 'working'
  const L = agentLine('', t0 + 0.4, { pre: [], running: true })
  delete L.id // not spoken yet
  const at = (dt, fn) => setTimeout(fn, dt * 1000)
  at(0.4, () => {
    L.pre = [{ type: 'reasoning', text: 'Reading the stream route first, then running the tests.', redacted: false }]
    s.lines.push(L)
    s.working = { since: r3(t0), count: 1, current: 'Read the stream route', current_at: r3(now()), steps: ['Read the stream route'], server_time: r3(now()) }
  })
  at(1.0, () => (L.pre = [...L.pre, stepPart(s, 'stream', 0, 'Run the stream tests', 'running')]))
  at(2.2, () => {
    L.pre = [...L.pre.slice(0, -1), stepPart(s, 'stream', 0, 'Run the stream tests', 'done'), { type: 'reasoning', text: '', redacted: true }, stepPart(s, 'stream', 1, 'Read the result', 'running')]
    s.working = { ...s.working, count: 2, current: 'Read the result', steps: ['Read the stream route', 'Read the result'] }
  })
  at(3.0, () => {
    L.pre = [...L.pre.slice(0, -1), stepPart(s, 'stream', 1, 'Read the result', 'done')]
    L.text = STREAM_REPLY
    L.running = false
    s.working = null
    s.state = 'waiting'
  })
  at(3.5, () => {
    L.id = 1000 + seq++
    vSay(s, L)
  })
}


// ── Background agents (§6.12) ─────────────────────────────────────────────
//
// `Mock: working` has a tree of subagents, the way Claude Code keeps them
// (`<session>/subagents/agent-<id>.jsonl` + `.meta.json`): one done (with a
// long log, for Load earlier), one running whose current step moves every
// MOCK_AGENT_STEP_S, a fork running under it and a done one beside it, one
// failed and one stopped. GET /mock/agents?finish=<id> ends a running one
// (done), `?spawn=1` starts another, `?reset=1` puts them back. The stream's
// snapshot carries `agents: {running, total}` and an `agents` event when
// the counts change.
const AGENT_STEP_S = Number(process.env.MOCK_AGENT_STEP_S ?? 3)
const AGENT_STEPS = ['Read the route table', 'Search for the stream watcher', 'Edit threads.py', 'Run the server tests', 'Read the failure', 'Edit the fixture', 'Run the typecheck']
const AGENTS = {}
function agent(id, description, extra) {
  return { id, description, agent_type: 'general-purpose', is_fork: false, parent_id: null, depth: 1, started_at: r3(T0 - 300), ended_at: null, status: 'done', current_step: null, steps: 0, last_at: r3(T0 - 300), logSize: 3, ...extra }
}
function seedAgents() {
  const w = Object.values(S).find((x) => x.title === 'Mock: working')
  if (!w) return
  AGENTS[w.session] = [
    agent('a1c01e7815570a8f6', 'Map the client routes', { agent_type: 'Explore', started_at: r3(T0 - 900), ended_at: r3(T0 - 700), last_at: r3(T0 - 700), steps: 14, logSize: 45 }),
    agent('a3d589a1ad3335234', 'Run the long test suite', { started_at: r3(T0 - 800), ended_at: r3(T0 - 780), last_at: r3(T0 - 780), status: 'failed', steps: 2 }),
    agent('a085f45672a8c46a4', 'Build the server half', { started_at: r3(T0 - 600), status: 'running', steps: 9, stepBase: 9 }),
    agent('a43f1798d9fccafdc', 'Research headless modes', { parent_id: 'a085f45672a8c46a4', depth: 2, started_at: r3(T0 - 500), ended_at: r3(T0 - 380), last_at: r3(T0 - 380), steps: 6 }),
    agent('a47fdcc9d305699f4', 'App half (fork)', { agent_type: 'fork', is_fork: true, parent_id: 'a085f45672a8c46a4', depth: 2, started_at: r3(T0 - 400), status: 'running', steps: 4, stepBase: 4 }),
    agent('a38c5219b5d009c07', 'Old research', { started_at: r3(T0 - 1000), ended_at: r3(T0 - 950), last_at: r3(T0 - 950), status: 'stopped', steps: 3 })
  ]
}
/** A running agent's step moves with the clock; the row as the server answers it. */
function agentRow(a) {
  const { logSize, stepBase, ...row } = a
  if (a.status === 'running') {
    const k = Math.floor((now() - T0) / AGENT_STEP_S)
    row.steps = (stepBase || 0) + k
    row.current_step = AGENT_STEPS[(row.steps + (a.depth > 1 ? 3 : 0)) % AGENT_STEPS.length]
    row.last_at = r3(now())
  } else row.current_step = null
  return row
}
const agentsOf = (sid) => (AGENTS[sid] || []).map(agentRow)
const agentCounts = (sid) => {
  const rows = AGENTS[sid] || []
  return { running: rows.filter((a) => a.status === 'running').length, total: rows.length }
}
/** A subagent's transcript as messages: its task, then a message per step. */
function agentMessages(sid, a) {
  const row = agentRow(a)
  const out = [{ id: uuidOf(`${a.id}:task`), role: 'user', at: a.started_at, parts: [{ type: 'text', text: `(mock) The task: ${a.description}.` }], spoken: null, turn: { running: false } }]
  const n = a.status === 'running' ? Math.max(1, row.steps) : Math.max(a.logSize, 1)
  for (let i = 0; i < n; i++) {
    const last = i === n - 1
    const running = a.status === 'running' && last
    const title = running ? row.current_step : `Step ${i + 1}: ${AGENT_STEPS[i % AGENT_STEPS.length]}`
    const parts = [
      { type: 'reasoning', text: '', redacted: true },
      { type: 'tool', name: 'Bash', title, input_summary: `(mock) ${title.toLowerCase()}`, status: running ? 'running' : a.status === 'failed' && last ? 'error' : 'done', result_summary: running ? '' : '(mock) ok', tool_use_id: `toolu_${hex12(a.id + i)}` }
    ]
    if (!running) parts.push({ type: 'text', text: last && a.status !== 'running' ? `(mock) ${a.status === 'failed' ? 'It failed: the suite did not start.' : 'Finished: here is what I found.'}` : `(mock) Step ${i + 1} done.` })
    out.push({ id: uuidOf(`${a.id}:m:${i}`), role: 'assistant', at: r3(a.started_at + (i + 1) * 5), parts, spoken: null, turn: { running } })
  }
  return out
}
function agentsControl(q) {
  const sid = Object.keys(AGENTS)[0]
  if (q.get('reset')) seedAgents()
  const fin = q.get('finish')
  if (fin && sid) {
    const a = AGENTS[sid].find((x) => x.id === fin)
    if (a && a.status === 'running') Object.assign(a, { status: 'done', ended_at: r3(now()), last_at: r3(now()), steps: agentRow(a).steps, logSize: agentRow(a).steps })
  }
  if (q.get('spawn') && sid) AGENTS[sid].push(agent(`a${hex12(String(now()))}0000`.slice(0, 18), q.get('description') || 'A new background agent', { started_at: r3(now()), status: 'running', steps: 0, stepBase: -Math.floor((now() - T0) / AGENT_STEP_S) }))
  return { ok: true, session: sid, counts: sid ? agentCounts(sid) : null }
}

// ── HTTP ──────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Encoding'
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS })
  res.end(JSON.stringify(body))
}
const fail = (res, status, error, extra = {}) => send(res, status, { ok: false, error, ...extra })

function readBody(req) {
  return new Promise((done) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        done(JSON.parse(data || '{}'))
      } catch {
        done({}) // §3: a malformed body is read as {}
      }
    })
  })
}

/** §9: the one pairing code, and the devices it has paired (token → row). */
// `device`: the name given at the desk (`pair --device NAME`), which the
// real server answers with and which wins over the name the app asks for.
// `GET /mock/pair?device=NAME` changes it; `?device=` falls back to the app's.
const PAIR = { code: process.env.MOCK_PAIR_CODE || 'c0ffee42', armed: true, device: 'Pixel 8a' }
/** §6.2 drafts by session: {text, at}; empty text deletes. `GET /mock/drafts` lists them. */
const DRAFTS = new Map()
const DEVICES = new Map()

const SESSION_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{8}_\d{6}_[0-9a-f]+)$/
const byItem = (item) => Object.values(S).find((s) => s.item && s.item === item)

function svg(name) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  if (name === 'mock-figure.svg') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" font-family="sans-serif" font-size="16">
<rect width="640" height="360" fill="#fff"/><rect x="20" y="20" width="200" height="320" rx="10" fill="none" stroke="#333" stroke-width="2"/>
<text x="40" y="52">Threads</text><rect x="36" y="70" width="168" height="30" rx="6" fill="#cfe9dd"/><text x="46" y="91" font-size="13">live · working</text>
<rect x="36" y="108" width="168" height="30" rx="6" fill="#eee"/><text x="46" y="129" font-size="13">shelved · 2d</text>
<rect x="240" y="20" width="380" height="320" rx="10" fill="none" stroke="#333" stroke-width="2"/><text x="260" y="52">Thread</text>
<rect x="260" y="70" width="240" height="40" rx="10" fill="#eee"/><rect x="400" y="120" width="200" height="30" rx="10" fill="#d6e6f7"/>
<rect x="260" y="290" width="340" height="34" rx="17" fill="none" stroke="#333"/><text x="276" y="312" font-size="13">composer</text></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${hue},45%,55%)"/><circle cx="128" cy="128" r="70" fill="hsl(${(hue + 150) % 360},55%,70%)"/></svg>`
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }

function serveStatic(req, res, path) {
  if (!existsSync(STATIC)) return false
  let file = join(STATIC, path)
  if (!file.startsWith(STATIC)) return false
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html') // SPA fallback
  if (!existsSync(file)) return false
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
  return true
}

/** The projects /session/move will accept, as the canvas's layout knows them. */
const KNOWN_PROJECTS = new Set(['agent-media', 'sasonica', 'runlet'])

/** The body of the last /reply or /ask, as sent: its `refs`, and `keep_reading` (the chip). */
let LAST_SEND = null
// §6.3 `refs`: a line at the foot per chip that names a session, as refs.py writes it.
function withRefs(text, refs) {
  if (!refs || typeof refs !== 'object') return text
  const lines = []
  for (const m of text.matchAll(/@\[([^[\]\n]{1,200})\]/g)) {
    const label = m[1].trim()
    const sid = refs[label]
    const line = `@[${label}] is conversation ${sid} (claude, transcript /mock/${sid}.jsonl)`
    if (sid && SESSION_RE.test(sid) && !lines.includes(line)) lines.push(line)
  }
  return lines.length ? `${text}\n\n${lines.join('\n')}` : text
}

const API = new Set(['/pair', '/dashboard', '/alerts/digests', '/alerts/digest', '/audio/targets', '/audio/target', '/targets', '/conversations', '/sessions/state', '/conversation', '/conversation/log', '/reply', '/ask', '/session/answer', '/session/resume', '/session/close', '/session/archive', '/session/priority', '/session/move', '/draft', '/commands', '/rename', '/speech/now', '/speech/ctl', '/speech/sentences', '/notes', '/notes/view', '/notes/read', '/notes/search', '/notes/capture', '/notes/say', '/notes/setup', '/notes/state', '/notes/refile', '/notes/date', '/notes/priority', '/notes/ask', '/harnesses', '/harnesses/run', '/harnesses/screen', '/harnesses/keys', '/harnesses/close', '/search'])

// Every row's project (§6.1, 22 Sep 2026: `project` and `cwd`, null when
// not known): a mix, some null, for By project and the row's small line.
// And one old shelved thread pinned, for Smart's "pinned on top".
{
  const P = { 'Mock: speaking now': 'agent-media', 'Mock: working': 'agent-media', 'Mock: long conversation': 'agent-media', 'Mock: needs approval': 'sasonica', 'Mock: asking a question': 'sasonica', 'Mock: shelved conversation': 'sasonica', 'Mock: archived earlier': 'sasonica', 'Mock: multi-select question': 'runlet' }
  for (const x of Object.values(S)) {
    x.project = P[x.title] ?? null
    x.cwd = x.project ? `/home/you/projects/${x.project}` : null
    if (x.title === 'Mock: long conversation') x.pinned = true
  }
  seedAgents()
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock')
  const path = url.pathname
  const log = (status) => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${path}${url.search} → ${status}`)

  if (req.method === 'OPTIONS') {
    if (!API.has(path)) return res.writeHead(405).end()
    res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '3600' })
    return res.end()
  }

  if (path.startsWith('/img/')) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', ...CORS })
    return res.end(svg(path.slice(5)))
  }
  if (path === '/healthz') return res.writeHead(200).end('ok')
  if (path === '/mock/notes') return send(res, 200, mockNotesControl(url.searchParams))
  if (path === '/mock/harnesses') return send(res, 200, mockHarnessControl(url.searchParams))
  if (path === '/mock/real/restart') {
    // Tests: start the real-shaped replies now (they go live in `?in=` s).
    // `?ended=1` holds them finished (spoken, with a history id) until the next restart.
    const lead = Number(url.searchParams.get('in') || 0)
    const hold = url.searchParams.get('ended') === '1'
    for (const x of Object.values(S)) if (x.real) x.real = { start: now() + lead, appended: 0, hold }
    realJump = 0
    realLost = false
    realSnap.t = 0
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end('ok')
  }
  if (path === '/mock/real/lose') {
    // Tests: lose the live row (`?on=0` to give it back) without stopping
    // the player.
    realLost = url.searchParams.get('on') !== '0'
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(String(realLost))
  }
  if (path === '/mock/real/jump') {
    // Tests: the player is `by` seconds further on than `elapsed` says.
    realJump += Number(url.searchParams.get('by') || 0)
    realSnap.t = 0
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(String(realJump))
  }
  if (path === '/mock/last-send') {
    // Tests: the body of the last /reply or /ask (refs.mjs reads its `refs`,
    // keepreading.mjs its `keep_reading`).
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(LAST_SEND))
  }
  if (path === '/mock/reply') {
    const q = url.searchParams
    if (q.has('delay')) REPLY.delay = Number(q.get('delay')) || 0
    if (q.has('skew')) REPLY.skew = Number(q.get('skew')) || 0
    if (q.has('flatten')) REPLY.flatten = q.get('flatten') === '1'
    if (q.has('fail')) REPLY.fail = q.get('fail') === '1'
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(REPLY))
  }
  if (path === '/mock/speech/log') {
    // Tests: what /speech/ctl was sent (`?clear=1` empties it first).
    if (url.searchParams.get('clear') === '1') CTL_LOG.length = 0
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(CTL_LOG))
  }
  if (path === '/mock/voice') {
    // Tests: `?loop=0` stops the speaking fixture coming back after it ends
    // (so "finished" lasts), `?loop=1` restores it.
    if (url.searchParams.get('loop') === '0') (V.saved = V.loop || V.saved), (V.loop = null)
    if (url.searchParams.get('loop') === '1') V.loop = V.loop || V.saved || null
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(V.loop ? 'looping' : 'not looping')
  }
  if (path === '/mock/session') {
    const q = url.searchParams
    if (q.has('fail')) SESSION_OPS.fail = q.get('fail') === 'none' ? '' : q.get('fail')
    if (q.has('delay')) SESSION_OPS.delay = Number(q.get('delay')) || 0
    return send(res, 200, { ok: true, ...SESSION_OPS })
  }
  if (path === '/mock/pair') {
    PAIR.armed = true
    if (url.searchParams.has('device')) PAIR.device = url.searchParams.get('device') || ''
    console.log(`pairing code ${PAIR.code} armed`)
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(PAIR.code)
  }
  if (path === '/mock/arrive') {
    // Tests: a reply lands in another session (by fixture title, default
    // "Mock: not on the shelf yet"), the way David saw one while reading:
    //   mode=state  working now, then in 6 s a new agent line and `waiting`
    //               (a turn ending; longer than the 5 s /sessions/state poll)
    //   mode=speak  a new agent line, and the voice starts saying it
    //   mode=queue  listed in /speech/now `queued` (`&urgent=1` for urgent)
    //   clear=1     empties `queued`
    const q = url.searchParams
    if (q.get('clear') === '1') QUEUED.length = 0
    const s = Object.values(S).find((x) => x.title === (q.get('title') || 'Mock: not on the shelf yet'))
    const mode = q.get('mode') || ''
    if (s && mode === 'state') {
      s.state = 'working'
      setTimeout(() => {
        s.lines.push(agentLine('(mock) A reply that arrived while you were elsewhere.', now()))
        s.state = 'waiting'
      }, 6000)
    } else if (s && mode === 'speak') {
      const line = agentLine('(mock) A reply in another thread. It is being spoken now.', now())
      s.lines.push(line)
      vSay(s, line)
    } else if (s && mode === 'queue') {
      QUEUED.push({ session: s.session, title: s.title, urgent: q.get('urgent') === '1', at: r3(now()) })
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ session: s?.session || null, queued: QUEUED }))
  }
  if (path.startsWith('/mock/stream/')) {
    const st = Object.values(S).find((x) => x.title === 'Mock: stream')
    const what = path.slice('/mock/stream/'.length)
    const out = { ok: true, at: Date.now() }
    if (what === 'append') {
      const text = url.searchParams.get('text') || '(mock) appended'
      const role = url.searchParams.get('role') || 'agent'
      st.lines.push(role === 'you' ? youLine(text, now()) : agentLine(text, now()))
    } else if (what === 'turn') streamTurn(st)
    else if (what === 'drop') {
      out.dropped = OPEN.size
      for (const c of [...OPEN]) c.res.destroy()
    } else if (what === 'refuse') STREAM.refuse = url.searchParams.get('on') === '1'
    else if (what === 'stats') Object.assign(out, STATS, { open: OPEN.size, session: st.session })
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(out))
  }
  if (path === '/mock/dashboard') {
    // Tests: `?hosts=tight` (default: red5 short of memory, sessiond down,
    // hpo offline) or `?hosts=ok` (red5 at ease, everything up, hpo online).
    const h = url.searchParams.get('hosts')
    if (h) DASH.hosts = h
    return send(res, 200, { ok: true, ...DASH })
  }
  if (path === '/mock/drafts') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(Object.fromEntries(DRAFTS)))
  }
  if (path === '/mock/devices') {
    const revoke = url.searchParams.get('revoke')
    if (revoke) for (const [tok, d] of DEVICES) if (d.id === revoke) DEVICES.delete(tok)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify([...DEVICES.values()]))
  }
  if (path === '/mock/search') {
    // GET /mock/search?memory=0|1&indexing=0|1 — agent-memory on the host
    // or not, and whether the index is still catching up.
    if (url.searchParams.has('memory')) SEARCH.memory = url.searchParams.get('memory') !== '0'
    if (url.searchParams.has('indexing')) SEARCH.indexing = url.searchParams.get('indexing') === '1'
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify(SEARCH))
  }
  if (path === '/mock/delay') {
    DELAY_MS = Number(url.searchParams.get('ms')) || 0
    console.log(`delay now ${DELAY_MS} ms`)
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(String(DELAY_MS))
  }

  const agentsPath = path.match(/^\/threads\/([^/]+)\/agents(?:\/([^/]+)\/log)?$/)
  if (agentsPath) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '3600' })
      return res.end()
    }
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!tok || tok === 'bad' || (tok.startsWith('mock-dev-') && !DEVICES.get(tok))) return (log(401), fail(res, 401, 'Audiobookshelf rejected that login'))
    const sid = decodeURIComponent(agentsPath[1])
    if (!SESSION_RE.test(sid)) return (log(400), fail(res, 400, 'not a session id'))
    const s = S[sid]
    if (!s) return (log(404), fail(res, 404, 'no such session'))
    if (DELAY_MS) await sleep(DELAY_MS)
    if (!agentsPath[2]) {
      log(200)
      return send(res, 200, { ok: true, session: sid, counts: agentCounts(sid), agents: agentsOf(sid) })
    }
    const a = (AGENTS[sid] || []).find((x) => x.id === decodeURIComponent(agentsPath[2]))
    if (!a) return (log(404), fail(res, 404, 'no such agent'))
    const page = pageOf(agentMessages(sid, a), url.searchParams.get('before') || '', Number(url.searchParams.get('limit')) || 60)
    log(200)
    return send(res, 200, { ok: true, session: sid, agent: agentRow(a), ...page })
  }
  if (path === '/mock/agents') return send(res, 200, agentsControl(url.searchParams))

  const events = path.match(/^\/threads\/([^/]+)\/events$/)
  if (events) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '3600' })
      return res.end()
    }
    // §11: the bearer header, or ?access_token= for a plain EventSource.
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('access_token') || ''
    if (!tok || tok === 'bad' || (tok.startsWith('mock-dev-') && !DEVICES.get(tok))) return (log(401), fail(res, 401, 'Audiobookshelf rejected that login'))
    const sid = decodeURIComponent(events[1])
    if (!SESSION_RE.test(sid)) return (log(400), fail(res, 400, 'not a session id'))
    const s = S[sid]
    if (!s) return (log(404), fail(res, 404, 'no such session'))
    if (STREAM.refuse) return (log(503), fail(res, 503, 'too many open threads'))
    if (DELAY_MS) await sleep(DELAY_MS)
    log('stream')
    return openStream(req, res, s)
  }

  if (!API.has(path)) {
    if (req.method === 'GET' && serveStatic(req, res, path)) return
    return fail(res, 404, 'no such route')
  }

  // §9 — POST /pair needs no credential.
  if (path === '/pair') {
    if (req.method !== 'POST') return fail(res, 405, 'POST only')
    const body = await readBody(req)
    if (DELAY_MS) await sleep(DELAY_MS)
    const code = String(body.code || '').trim()
    if (!PAIR.armed || code !== PAIR.code) {
      log(403)
      return fail(res, 403, 'invalid or expired pairing code', { code: 'bad_pairing_code' })
    }
    PAIR.armed = false // dies on its first success, never on a failure
    const token = `mock-dev-${randomUUID().replace(/-/g, '')}`
    const id = `d_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const name = PAIR.device || String(body.device || '').trim().slice(0, 80) || 'device'
    DEVICES.set(token, { id, name, created: r3(now()) })
    log(200)
    console.log(`  paired ${id} (${name})`)
    return send(res, 200, { ok: true, token, device_id: id, name, server: { name: 'mock', base: `http://${req.headers.host}` } })
  }

  // §9: a paired device token first; else §4.1, any bearer passes as an
  // ABS token except "bad". An unknown device token is refused, as a
  // revoked one falls through to ABS and is refused there.
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const device = DEVICES.get(bearer)
  if (!bearer || bearer === 'bad' || (bearer.startsWith('mock-dev-') && !device)) {
    log(401)
    return fail(res, 401, 'Audiobookshelf rejected that login')
  }
  if (device) device.last_seen = r3(now())

  const body = req.method === 'POST' ? await readBody(req) : {}
  if (DELAY_MS) await sleep(DELAY_MS)
  const status = await route(req.method, path, url.searchParams, body, res)
  log(status)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock canvas on http://127.0.0.1:${PORT}${existsSync(STATIC) ? ` (serving ${STATIC})` : ''}${DELAY_MS ? `, answering after ${DELAY_MS} ms` : ''}`)
  for (const s of Object.values(S)) console.log(`  ${s.session}  ${s.title}`)
})

const PLACES = () => [
  { name: 'demo', path: '/home/you/projects/demo', at: r3(now()) },
  { name: 'agent-media', path: '/home/you/projects/agent-media', at: r3(now() - 3600) }
]

// §6.9: where the voice plays. POST /audio/target moves it (mock state only).
const AUDIO = { speech: 'app', default: 'app', overridden: false }
const AUDIO_OPTIONS = [
  { name: 'app', label: 'Phone (Sasonica)', available: true, why: null },
  { name: 'phone', label: 'Phone (Termux player)', available: true, why: 'was slow or unreachable a moment ago' },
  { name: 'rooms', label: 'House speakers', available: true, why: null },
  { name: 'local', label: 'red5', available: false, why: 'no speech player running on red5' }
]
const audioSpeech = () => ({ current: AUDIO.speech, default: AUDIO.default, overridden: AUDIO.overridden, options: AUDIO_OPTIONS })

// §6.11 hosts: `GET /mock/dashboard?hosts=tight|ok` picks the scenario.
const DASH = { hosts: process.env.MOCK_DASH_HOSTS || 'tight' }
function dashHosts() {
  const tight = DASH.hosts !== 'ok'
  const live = Object.values(S).filter((x) => x.live).length
  const total = 7758
  const avail = tight ? 820 : 4300
  return [
    {
      name: 'red5', role: 'origin', local: true, online: true, last_seen: null, sessions: live,
      mem_used_mb: total - avail, mem_total_mb: total, mem_available_mb: avail, sessions_mem_mb: tight ? 5200 : 2100, tight,
      reaper: { mode: 'apply', last_run_at: r3(now() - 420), closed_last_run: tight ? 2 : 0 },
      shell: { service: 'sasonica-shell', active: true },
      sessiond: { service: 'agent-media-sessiond', active: !tight }
    },
    {
      name: 'hpo', role: 'peer', local: false, online: !tight, last_seen: tight ? r3(now() - 7200) : r3(now() - 5), sessions: null,
      mem_used_mb: null, mem_total_mb: null, mem_available_mb: null, sessions_mem_mb: null, tight: null, reaper: null, shell: null, sessiond: null
    }
  ]
}

async function route(method, path, q, body, res) {
  const ok = (b) => (send(res, 200, { ok: true, ...b }), 200)
  const err = (status, error, extra) => (fail(res, status, error, extra), status)
  // The harnesses and their windows (mock/harnesses.mjs).
  const harness = harnessRoute(method, path, q, body, ok, err)
  if (harness) return harness
  // The notes routes and their setup window (mock/notes.mjs).
  const notes = (await notesRoute(method, path, q, body, ok, err)) || setupWindowRoute(method, path, q, body, ok, err)
  if (notes) return notes

  const DIGESTS = () => [
    { n: 1, id: 'digest.org-agenda', at: r3(now() - 90000), level: 'info', title: 'Org agenda: 9 items due today', detail: 'inbox: TODO yesterday thing', speech: null },
    { n: 2, id: 'digest.describe', at: r3(now() - 7200), level: 'info', title: 'Describe 24h: 2 calls', detail: 'Two calls.', speech: { id: null, heard: false } },
    { n: 3, id: 'digest.org-agenda', at: r3(now() - 3600), level: 'info', title: 'Org agenda: 14 items due today', speech: { id: 9001, heard: false }, view: 'agenda',
      detail: '  inbox:       9:00...... Scheduled:  NEXT Ring the plumber :home:\n  tickler:    Scheduled:  TODO Renew the passport\n  inbox:      Sched. 2x:  TODO An old thing since refiled :inbox:\nSacred Brain alerts.\n  memory store healthy' },
    { n: 4, id: 'digest.landscape', at: r3(now() - 1800), level: 'info', title: 'Landscape watch', speech: null,
      detail: '# Landscape\n\nFrom GitHub only.\n\n## Worth stealing\n\n- **Session recovery** after the daemon\n  forgets.\n- A phone mode, see [happy](https://example.com/happy)\n\n| tool | stars |\n|---|---|\n| happy | 9k |' }
  ]

  if (method === 'GET' && path === '/dashboard') {
    // §6.11: one answer for the home screen, from the same fixtures (recent:
    // 12 here, not ~8, so the older fixtures with recaps make the cut).
    const all = Object.values(S)
    all.forEach(tickSession)
    const lastAt = (x) => Math.max(x.at || 0, ...x.lines.map((l) => l.at || 0))
    const sp = speechNow()
    return ok({
      at: r3(now()),
      needs_you: all.filter((x) => x.live && x.approval).map((x) => ({ session: x.session, title: x.title, kind: x.approval.kind === 'question' ? 'question' : 'approval', approval: x.approval, project: x.project ?? null, cwd: x.cwd ?? null, ...(x.headless ? { driver: 'headless' } : {}) })),
      working: all.filter((x) => x.live && x.state === 'working').map((x) => ({ session: x.session, title: x.title, current: x.working?.current || '', since: x.working?.since ?? null, count: x.working?.count || 0, project: x.project ?? null, cwd: x.cwd ?? null })),
      speech: { now: { live: sp.live, speaking: sp.speaking, paused: sp.paused, session: sp.session, title: sp.title, sentence: sp.sentence, target: AUDIO.speech, replay: false }, queued: sp.queued },
      recent: all.filter((x) => !x.archived).sort((a, b) => lastAt(b) - lastAt(a)).slice(0, 12).map((x) => ({ session: x.session, title: x.title, recap: x.recap || null, at: r3(lastAt(x)) || null, live: !!x.live, rested: x.live ? null : x.rested || null, project: x.project ?? null, cwd: x.cwd ?? null })),
      places: PLACES(),
      agents: [{ name: 'claude', present: true }, { name: 'codex', present: true }, { name: 'pi', present: false }, { name: 'hermes', present: false }],
      hosts: dashHosts(),
      // §6.11 digests: one waiting to be heard, one still rendering.
      digests: [
        { id: 'digest.org-agenda', title: 'Org agenda: 14 items due today', level: 'info', changed_at: r3(now() - 3600), speech: { id: 9001, heard: false }, n: 3 },
        { id: 'digest.describe', title: 'Describe 24h: 2 calls', level: 'info', changed_at: r3(now() - 7200), speech: { id: null, heard: false }, n: 2 }
      ]
    })
  }

  // §6.17 the digest log: browse (no bodies) and read one.
  if (method === 'GET' && path === '/alerts/digests') {
    const before = Number(q.get('before')) || Infinity
    const id = q.get('id')
    return ok({ digests: DIGESTS().filter((d) => d.n < before && (!id || d.id === id)).sort((a, b) => b.n - a.n).map(({ detail, ...d }) => d) })
  }
  if (method === 'GET' && path === '/alerts/digest') {
    const all = DIGESTS()
    const d = all.find((x) => x.n === Number(q.get('n')))
    if (!d) return err(404, 'no such digest')
    const same = all.filter((x) => x.id === d.id).map((x) => x.n)
    const before = same.filter((m) => m < d.n)
    const after = same.filter((m) => m > d.n)
    return ok({ digest: { ...d, prev: before.length ? Math.max(...before) : null, next: after.length ? Math.min(...after) : null } })
  }

  if (method === 'GET' && path === '/search') {
    const r = searchOf(q)
    return r.__status ? err(r.__status, r.error) : ok(r)
  }

  if (method === 'GET' && path === '/audio/targets') return ok({ channels: { speech: audioSpeech() } })
  if (method === 'POST' && path === '/audio/target') {
    if (body.channel !== 'speech') return err(400, `unknown channel ${body.channel}`)
    const t = body.target
    if (t && !AUDIO_OPTIONS.some((o) => o.name === t && o.available)) return err(400, `cannot play on ${t}`)
    AUDIO.speech = t || AUDIO.default
    AUDIO.overridden = !!t
    return ok({ channel: 'speech', ...audioSpeech() })
  }

  if (method === 'GET' && (path === '/targets' || path === '/conversations')) {
    // The window on each harness's store (§6.16): rows older than it are
    // listed only for `history=all`.
    const all = Object.values(S).filter((s) => !s.older || q.get('history') === 'all')
    const sessions = [...all.filter((s) => s.live).map(row), ...all.filter((s) => !s.live).sort((a, b) => b.at - a.at).map(row)]
    if (path === '/conversations') return ok({ sessions })
    return ok({ sessions, places: PLACES() })
  }

  if (method === 'GET' && path === '/sessions/state') {
    Object.values(S).forEach(tickSession)
    return ok({ sessions: Object.values(S).filter((s) => s.live && s.state).map((s) => ({ session: s.session, tail: s.item ? `p-demo/${s.title}` : '', state: s.state, title: s.title })) })
  }

  if (method === 'GET' && path === '/conversation') {
    const item = q.get('item')
    const sid = q.get('session')
    if (item) {
      const s = byItem(item)
      if (!s) return err(404, 'no such item')
      return ok({ session: s.session, live: s.live, pane: s.pane, resumable: true, suggestion: s.suggestion })
    }
    if (!sid || !SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s) return err(404, 'no such session')
    tickSession(s)
    return ok({ session: s.session, item: s.item, scanning: false, live: s.live, pane: s.pane, resumable: true, suggestion: s.suggestion })
  }

  if (method === 'GET' && path === '/conversation/log') {
    // §10: `session` wins when both are given.
    const sid = q.get('session')
    if (sid !== null) {
      if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
      const s = S[sid]
      if (!s) return err(404, 'no conversation for that session yet')
      STATS.log[sid] = (STATS.log[sid] || 0) + 1
      const around = q.get('around') || ''
      const mq = q.get('messages') === '1' || around ? { messages: true, before: q.get('before') || '', limit: Number(q.get('limit')) || 60, around } : null
      return (send(res, 200, logOf(s, mq)), 200)
    }
    const s = byItem(q.get('item') || '')
    if (!s) return err(404, 'no such item')
    return (send(res, 200, logOf(s)), 200)
  }

  if (method === 'POST' && path === '/reply') {
    LAST_SEND = body
    const text = withRefs(String(body.text || '').trim(), body.refs)
    if (!text) return err(400, 'empty reply')
    let s
    if (body.session !== undefined) {
      // §10: by session (wins over item).
      const sid = String(body.session || '')
      if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
      s = S[sid]
      if (!s) return err(404, `no such session ${sid.slice(0, 8)}`)
    } else {
      s = byItem(body.item || '')
      if (!s) return err(404, 'not a conversation (no session behind it)')
    }
    if (REPLY.fail) {
      if (REPLY.delay) await sleep(REPLY.delay)
      return err(500, 'could not deliver the reply')
    }
    const opened = !s.live
    receive(s, text)
    // §6.4: talking un-archives, once the words are in.
    s.archived = false
    // The line is in the log already; the answer comes after (the race).
    if (REPLY.delay) await sleep(REPLY.delay)
    return ok({ session: s.session, pane: s.pane, opened, submitted: true })
  }

  if (method === 'POST' && path === '/ask') {
    LAST_SEND = body
    const text = withRefs(String(body.text || '').trim(), body.refs)
    if (!text) return err(400, 'empty message')
    if (body.agent && !['claude', 'codex', 'pi', 'hermes'].includes(body.agent)) return err(400, `unknown agent ${body.agent}`)
    if (body.cwd && !['/home/you/projects/demo', '/home/you/projects/agent-media'].includes(body.cwd)) return err(404, `not a known place: ${body.cwd}`)
    if (body.target && body.target !== 'new') {
      const s = S[body.target]
      if (!s) return err(404, 'no such session')
      if (body.dry) return ok({ dry: true, mode: 'continued', how: 'picked', session: s.session, title: s.title, item: s.item, text })
      const opened = !s.live
      receive(s, text)
      return ok({ mode: 'continued', how: 'picked', session: s.session, pane: s.pane, opened, submitted: true, title: s.title, item: s.item, text })
    }
    const agent = body.agent || 'claude'
    if (body.dry) return ok({ dry: true, mode: 'new', how: 'asked', agent, session: null, title: '', item: null, text })
    const s = add(session(randomUUID(), text.slice(0, 40), { pane: `%${30 + Object.keys(S).length}`, state: 'working', item: null, shelvedIn: now() + 10 }))
    receive(s, text)
    return ok({ mode: 'new', how: 'asked', session: s.session, pane: s.pane, opened: true, fresh: true, tmux: 'amux-scratch', agent, submitted: true, title: '', text })
  }

  if (method === 'POST' && path === '/notes/ask') {
    // A chat about a note: a fresh session like /ask's, opened in the notes tree.
    const got = noteAsk(body)
    if (got.error) return err(got.status, got.error)
    const s = add(session(randomUUID(), got.prompt.slice(0, 40), { pane: `%${30 + Object.keys(S).length}`, state: 'working', item: null, shelvedIn: now() + 10 }))
    receive(s, got.prompt)
    noteChatStarted(got, s.session)
    return ok({ mode: 'new', how: 'asked', session: s.session, pane: s.pane, opened: true, fresh: true, tmux: 'org', agent: 'claude', submitted: true, title: '', text: got.prompt, path: got.path, at: got.at })
  }

  if (method === 'POST' && path === '/session/answer') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s || !s.live) return err(404, 'that session is not live')
    if (!s.approval) return err(409, 'that session is not waiting on a question')
    tickSession(s)
    if (body.key !== s.approval.key) return err(409, 'the question has changed', { approval: s.approval })
    if (body.answers !== undefined || body.request_id) {
      // The structured form (§6.4): a question, every question answered.
      if (s.approval.kind !== 'question') return err(400, 'this dialog answers by number (choice and key)', { approval: s.approval })
      if (s.approval.id && body.request_id && body.request_id !== s.approval.id) return err(409, 'the question has changed', { approval: s.approval })
      const got = structuredAnswers(s.approval, body.answers)
      if (typeof got === 'string') return err(400, got, { approval: s.approval })
      s.lastAnswer = body
      if (s.changeOnce) {
        delete s.changeOnce
        s.approval = questionApproval(TWO, { salt: ' (asked again)' })
        return err(409, 'the question has changed', { approval: s.approval })
      }
      const said = Object.values(got).join(', ')
      s.approval = null
      s.state = 'working'
      const asked = s.lines.findLast((l) => l.ask)
      if (asked?.pendingAsk) delete asked.pendingAsk
      if (s.lines[s.lines.length - 1]?.ask) s.lines.push(youLine(said, now()))
      s.pending = true
      s.jobs = [
        {
          at: now() + 4,
          run: () => {
            s.working = null
            s.pending = false
            s.state = 'waiting'
            s.lines.push(agentLine(`(mock) You answered: ${said}.`, now()))
          }
        }
      ]
      return ok({ session: s.session, pane: s.headless ? null : s.pane, answers: got, waiting: false, approval: null, ...(s.headless ? { driver: 'headless', request_id: body.request_id || '' } : {}) })
    }
    const choice = Number(body.choice)
    const picked = s.approval.options.find((o) => o.n === choice)
    if (!picked) return err(400, `no option ${body.choice}`, { approval: s.approval })
    s.approval = null
    delete s.asked
    s.state = 'working'
    if (s.lines[s.lines.length - 1]?.ask) s.lines.push(youLine(picked.label, now()))
    s.pending = true
    s.jobs = [
      {
        at: now() + 4,
        run: () => {
          s.working = null
          s.pending = false
          s.state = 'waiting'
          s.lines.push(agentLine(`(mock) You chose ${choice}: ${picked.label}.`, now()))
        }
      }
    ]
    return ok({ session: s.session, pane: s.pane, answered: choice, label: picked.label, waiting: false, approval: null })
  }

  if (path === '/draft') {
    // §6.2: {session, text, at} (at = the writer's clock, stored as given);
    // empty or whitespace-only text deletes; none is {text: "", at: 0}.
    const sid = String(method === 'POST' ? body.session || '' : q.get('session') || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    if (method === 'POST') {
      const text = String(body.text || '').slice(0, 8192)
      const at = Number(body.at) || now()
      if (text.trim()) DRAFTS.set(sid, { text, at })
      else DRAFTS.delete(sid)
      console.log(`  draft ${sid.slice(0, 8)} ${text.trim() ? JSON.stringify(text.slice(0, 40)) : '(deleted)'}`)
    }
    const d = DRAFTS.get(sid) || { text: '', at: 0 }
    return ok({ session: sid, text: d.text, at: d.at })
  }

  // §6.4 POST /session/close {session} → {session, pane?, live:false, closed}.
  // GET /mock/session?fail=close|archive|none refuses one of them 500 (rollback).
  if (method === 'POST' && path === '/session/close') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s) return err(404, `no such session ${sid.slice(0, 8)}`)
    if (SESSION_OPS.delay) await sleep(SESSION_OPS.delay)
    if (SESSION_OPS.fail === 'close') return err(500, 'could not close the session')
    if (!s.live) return ok({ session: sid, live: false, closed: false })
    const pane = s.pane
    s.live = false
    s.state = null
    s.pending = false
    s.working = null
    s.jobs = []
    s.rested = null
    s.at = r3(now())
    return ok({ session: sid, pane, live: false, closed: true })
  }
  // §6.4 POST /session/archive {session, archived} → {session, archived}.
  if (method === 'POST' && path === '/session/priority') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s) return err(404, `no such session ${sid.slice(0, 8)}`)
    let level = body.level
    if (level === undefined) {
      const flag = body.priority === undefined ? true : body.priority
      if (typeof flag !== 'boolean') return err(400, 'priority must be true or false')
      level = flag ? 'auto' : 'normal'
    }
    if (!['interrupt', 'auto', 'normal', 'quiet'].includes(level)) return err(400, 'level must be interrupt, auto, normal or quiet')
    s.speech = level
    return ok({ session: sid, level, priority: level === 'interrupt' || level === 'auto' })
  }
  if (method === 'POST' && path === '/session/archive') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s) return err(404, `no such session ${sid.slice(0, 8)}`)
    const archived = body.archived === undefined ? true : body.archived
    if (typeof archived !== 'boolean') return err(400, 'archived must be true or false')
    if (SESSION_OPS.delay) await sleep(SESSION_OPS.delay)
    if (SESSION_OPS.fail === 'archive') return err(500, 'could not archive')
    s.archived = archived
    return ok({ session: sid, archived })
  }

  // §6.15 POST /session/move {session, project|cwd} → where it now is, and
  // whether its session restarted there. A working session is refused 409,
  // as on the canvas.
  if (method === 'POST' && path === '/session/move') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s) return err(404, `no such session ${sid.slice(0, 8)}`)
    const project = String(body.project || '')
    const cwd = String(body.cwd || '')
    if (!project && !cwd) return err(400, 'no project or directory given')
    if (project && !KNOWN_PROJECTS.has(project)) return err(400, `no directory known for project '${project}'`)
    if (s.live && s.state === 'working') return err(409, 'that session is working — stop it first')
    if (SESSION_OPS.delay) await sleep(SESSION_OPS.delay)
    if (SESSION_OPS.fail === 'move') return err(500, 'could not move the transcript')
    s.project = project || null
    s.cwd = cwd || `/home/you/projects/${project}`
    // Its own files follow (§6.15); MOCK 'move-folder' keeps them behind.
    const folder = SESSION_OPS.fail === 'move-folder' ? null : `/conversations/${project}/${s.title}`
    s.folder = folder || s.folder
    return ok({
      session: sid, project: s.project, cwd: s.cwd, restarted: !!s.live,
      pane: s.live ? s.pane : null, live: !!s.live, folder,
      ...(folder ? {} : { folder_error: `/conversations/${project}/${s.title} is already there` })
    })
  }

  if (method === 'POST' && path === '/rename') {
    // §6.4: {session (or item), title} → {session, title, terminal, why}.
    // A title containing FAIL is refused 500, for the rollback path.
    // `auto` with no title names it "Named: <old title>"; one whose title
    // contains NONAME gets the 502 the gateway's silence gives.
    const cur = body.session !== undefined ? S[String(body.session)] : byItem(body.item || '')
    if (body.auto && !body.title && cur?.title?.includes('NONAME')) return err(502, 'could not think of a name')
    const title = String(body.title || (body.auto && cur ? `Named: ${cur.title.replace(/^Named: /, '')}` : '')).replace(/\s+/g, ' ').trim()
    if (!title) return err(400, 'no title')
    const s = body.session !== undefined ? S[String(body.session)] : byItem(body.item || '')
    if (!s) return err(404, 'no such session')
    if (title.includes('FAIL')) return err(500, 'could not rename')
    s.title = title
    const why = !s.live
      ? 'the session has ended; it starts with this name when resumed'
      : s.state === 'working'
        ? 'the running session will pick it up when it is free'
        : null
    return ok({ session: s.session, title, terminal: !why, why })
  }

  if (method === 'GET' && path === '/speech/now') {
    const answer = speechNow()
    // The real-voice model answers slowly, with the pos it read on arrival.
    if (REAL_VOICE && answer.session && S[answer.session]?.variant === 'real') await sleep(1500)
    return ok(answer)
  }

  if (method === 'GET' && path === '/speech/sentences') {
    // §6.5 "Read from here": the reply's sentences as replay-id + sentence counts them.
    const raw = q.get('id') || ''
    if (!/^\d+$/.test(raw)) return err(400, 'id must be a history row id')
    const t = spokenTurns().find((x) => x.line.id === Number(raw))
    if (!t) return err(404, 'no such spoken reply')
    return ok({ id: Number(raw), sentences: speechOf(t.line).sentences })
  }

  if (method === 'POST' && path === '/speech/ctl') {
    const isIndex = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9999
    if (body.action === 'goto-sentence') {
      if (!isIndex(body.arg)) return err(400, 'arg must be a sentence index')
      vTick()
      if (!V.on) return err(409, 'nothing is being said')
      if (body.session && V.on.s.session !== body.session) return err(409, 'that reply is no longer being said')
    }
    if (body.action === 'replay-id' && body.sentence != null && !isIndex(body.sentence)) return err(400, 'sentence must be a sentence index')
    CTL_LOG.push({ action: body.action, arg: body.arg, sentence: body.sentence, session: body.session, at: Date.now() })
    const out = speechCtl(String(body.action || ''), body.arg, body)
    if (out === null) return err(400, 'unknown action')
    console.log(`  speech ${body.action}${body.arg !== undefined ? ' ' + body.arg : ''} → ${out}`)
    return ok({ out })
  }

  return err(400, 'not in the mock')
}
