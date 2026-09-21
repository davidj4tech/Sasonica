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
 *    `GET /mock/devices` lists them, `?revoke=<id>` forgets one.
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
 * MOCK_REAL_VOICE=1 makes /speech/now speak `real`, with the player's `pos`
 * lagging `elapsed` (pos = 0.75 × elapsed), as red5's phone lane did.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

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
    approval: withKey({
      question: 'Which screen should the prototype open on?',
      partial: false,
      options: ASK[0].options.map((o, i) => ({ n: i + 1, label: o.label, detail: o.description })).concat([{ n: 4, label: 'Type something.', detail: '' }]),
      agent: 'claude'
    })
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
  add(session(randomUUID(), 'Mock: long conversation', { live: false, state: null, at: r3(T0 - 86400 * 3 + 45 * 120), lines }))
}

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
  const sentences = line.text.split(/(?<=[.!?])\s+/).filter(Boolean)
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
 * instead, with the player's `pos` falling behind `elapsed` as red5's did
 * (stalls between clips: pos = 0.75 × elapsed), so the app's skew
 * correction has something to correct.
 */
const REAL_VOICE = process.env.MOCK_REAL_VOICE === '1'
function realVoiceNow() {
  const s = Object.values(S).find((x) => x.variant === 'real')
  if (!s || s.real.hold) return null
  const pos = now() - s.real.start
  if (pos < 0 || pos >= REAL_LEN_S) return null
  return { ok: true, live: true, speaking: pos >= 2, paused: pos < 2, sentence: '', session: s.session, title: s.title, item: s.item, pos: Math.floor(pos * 0.75), dur: Math.ceil(REAL_LEN_S * 0.75), speed: 1, muted: false }
}

function speechNow() {
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

/** Returns `out`, as `media` would print it, or null for an unknown action. */
function speechCtl(action, arg) {
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
      vSay(t.s, t.line)
      return String(turns.indexOf(t) + 1)
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

const row = (s) => (s.live ? { session: s.session, title: s.title, live: true, pane: s.pane } : { session: s.session, title: s.title, live: false, pane: null, at: s.at })

function logOf(s) {
  tickSession(s)
  vTick()
  const lines = s.real ? realState(s).lines : s.lines.map((l) => (V.on && V.on.s === s && V.on.line === l ? liveLine(l) : l))
  const last = lines[lines.length - 1]
  const pending = s.pending || (!!last && last.who === 'you')
  return { ok: true, session: s.session, lines, pending, working: s.working, approval: s.approval, suggestion: pending ? '' : s.suggestion }
}

/** A reply lands in a session: the listener's line, a turn, an answer. */
function receive(s, text) {
  const t = now()
  const into = s.real ? s.history : s.lines
  into.push(youLine(text, t))
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
const PAIR = { code: process.env.MOCK_PAIR_CODE || 'c0ffee42', armed: true }
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' }

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

const API = new Set(['/pair', '/targets', '/conversations', '/sessions/state', '/conversation', '/conversation/log', '/reply', '/ask', '/session/answer', '/session/resume', '/session/close', '/draft', '/commands', '/speech/now', '/speech/ctl'])

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
  if (path === '/mock/real/restart') {
    // Tests: start the real-shaped replies now (they go live in `?in=` s).
    // `?ended=1` holds them finished (spoken, with a history id) until the next restart.
    const lead = Number(url.searchParams.get('in') || 0)
    const hold = url.searchParams.get('ended') === '1'
    for (const x of Object.values(S)) if (x.real) x.real = { start: now() + lead, appended: 0, hold }
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end('ok')
  }
  if (path === '/mock/pair') {
    PAIR.armed = true
    console.log(`pairing code ${PAIR.code} armed`)
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(PAIR.code)
  }
  if (path === '/mock/devices') {
    const revoke = url.searchParams.get('revoke')
    if (revoke) for (const [tok, d] of DEVICES) if (d.id === revoke) DEVICES.delete(tok)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify([...DEVICES.values()]))
  }
  if (path === '/mock/delay') {
    DELAY_MS = Number(url.searchParams.get('ms')) || 0
    console.log(`delay now ${DELAY_MS} ms`)
    res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS })
    return res.end(String(DELAY_MS))
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
    const name = String(body.device || '').trim().slice(0, 80) || 'device'
    DEVICES.set(token, { id, name, created: r3(now()) })
    log(200)
    console.log(`  paired ${id} (${name})`)
    return send(res, 200, { ok: true, token, device_id: id, server: { name: 'mock', base: `http://${req.headers.host}` } })
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

async function route(method, path, q, body, res) {
  const ok = (b) => (send(res, 200, { ok: true, ...b }), 200)
  const err = (status, error, extra) => (fail(res, status, error, extra), status)

  if (method === 'GET' && (path === '/targets' || path === '/conversations')) {
    const all = Object.values(S)
    const sessions = [...all.filter((s) => s.live).map(row), ...all.filter((s) => !s.live).sort((a, b) => b.at - a.at).map(row)]
    if (path === '/conversations') return ok({ sessions })
    return ok({
      sessions,
      places: [
        { name: 'demo', path: '/home/you/projects/demo', at: r3(now()) },
        { name: 'agent-media', path: '/home/you/projects/agent-media', at: r3(now() - 3600) }
      ]
    })
  }

  if (method === 'GET' && path === '/sessions/state') {
    Object.values(S).forEach(tickSession)
    return ok({ sessions: Object.values(S).filter((s) => s.live && s.state).map((s) => ({ session: s.session, tail: s.item ? `p-demo/${s.title}` : '', state: s.state })) })
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
      return (send(res, 200, logOf(s)), 200)
    }
    const s = byItem(q.get('item') || '')
    if (!s) return err(404, 'no such item')
    return (send(res, 200, logOf(s)), 200)
  }

  if (method === 'POST' && path === '/reply') {
    const text = String(body.text || '').trim()
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
    const opened = !s.live
    receive(s, text)
    return ok({ session: s.session, pane: s.pane, opened, submitted: true })
  }

  if (method === 'POST' && path === '/ask') {
    const text = String(body.text || '').trim()
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

  if (method === 'POST' && path === '/session/answer') {
    const sid = String(body.session || '')
    if (!SESSION_RE.test(sid)) return err(400, 'not a session id')
    const s = S[sid]
    if (!s || !s.live) return err(404, 'that session is not live')
    if (!s.approval) return err(409, 'that session is not waiting on a question')
    tickSession(s)
    if (body.key !== s.approval.key) return err(409, 'the question has changed', { approval: s.approval })
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

  if (method === 'GET' && path === '/speech/now') return ok(speechNow())

  if (method === 'POST' && path === '/speech/ctl') {
    const out = speechCtl(String(body.action || ''), body.arg)
    if (out === null) return err(400, 'unknown action')
    console.log(`  speech ${body.action}${body.arg !== undefined ? ' ' + body.arg : ''} → ${out}`)
    return ok({ out })
  }

  return err(400, 'not in the mock')
}
