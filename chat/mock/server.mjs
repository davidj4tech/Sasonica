#!/usr/bin/env node
/**
 * A tiny stand-in for agent-media's canvas, answering the v0 app routes
 * (server-contract.md §6) from in-memory fixtures. Every write path the chat
 * front end has is exercised here, never against the real canvas: a real
 * POST types into a running agent session.
 *
 *   node mock/server.mjs [--port 8793] [--static build/client]
 *
 * Any non-empty bearer is accepted, except "bad" (→ 401, §4.1). With
 * --static (default: build/client if it exists) it also serves the built SPA
 * on the same port, so Settings can be left blank.
 *
 * Slow link: MOCK_DELAY_MS=2500 (or --delay 2500) holds every app-route
 * answer that long, like the phone→red5 hop (a 39-line log took 2.1–2.5 s).
 * `GET /mock/delay?ms=N` changes it while running (tests flip it between a
 * cold and a cached open). Static files and pictures are never delayed.
 *
 * Fixture sessions (all text invented):
 *   speaking  — live, a reply being spoken now (follow-along bold)
 *   approval  — live, stopped on a permission prompt (/session/answer)
 *   asking    — live, an AskUserQuestion on screen, attached to its ask line
 *   working   — live, a turn running (`working` steps advance)
 *   fresh     — live, not on the shelf yet (item: null)
 *   shelved   — ended, resumable, with pictures and a work summary
 *   long      — ended, 90 lines, for the bottom-first window and scrolling
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

const SPOKEN = [
  'The mock server is speaking this reply right now.',
  'Each sentence turns bold as the voice reaches it, on the local clock between polls.',
  'Offsets come from the server; the page adds however long ago it heard them.',
  'When the reply ends, it keeps the same at, so it replaces itself rather than appearing twice.',
  'Then the loop starts again, so there is always something to watch.'
]
const SPOKEN_TEXT = SPOKEN.join(' ')
const SPOKEN_OFFSETS = [0, 3.2, 7.9, 12.4, 17.6]
const SPOKEN_LEN = 21

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
      agentLine('Sure — the next reply is spoken aloud, and the page follows it.', T0 - 110, { work: work(8.2, ['Read the contract', 'Find the live line']) }),
      youLine('Go on then.', T0 - 30)
    ],
    liveAt: r3(T0 - 25)
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

function liveLine(s) {
  if (!s.liveAt) return null
  const t = now()
  const elapsed = (t - s.liveAt) % SPOKEN_LEN
  let sentence = 0
  SPOKEN_OFFSETS.forEach((o, i) => {
    if (elapsed >= o) sentence = i
  })
  return {
    start: null,
    end: null,
    who: 'agent',
    text: SPOKEN_TEXT,
    at: s.liveAt,
    key: '',
    live: true,
    sentences: SPOKEN,
    sentence,
    offsets: SPOKEN_OFFSETS,
    elapsed: r3(elapsed),
    paused: false,
    server_time: r3(t),
    delay: 0,
    work: work(12.5, ['Read the live line', 'Split into sentences'])
  }
}

const row = (s) => (s.live ? { session: s.session, title: s.title, live: true, pane: s.pane } : { session: s.session, title: s.title, live: false, pane: null, at: s.at })

function logOf(s) {
  tickSession(s)
  const lines = [...s.lines]
  const live = liveLine(s)
  if (live) lines.push(live)
  const last = lines[lines.length - 1]
  const pending = s.pending || (!!last && last.who === 'you')
  return { ok: true, session: s.session, lines, pending, working: s.working, approval: s.approval, suggestion: pending ? '' : s.suggestion }
}

/** A reply lands in a session: the listener's line, a turn, an answer. */
function receive(s, text) {
  const t = now()
  s.lines.push(youLine(text, t))
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
        s.lines.push(agentLine(`(mock) I heard: “${text.slice(0, 120)}”.`, now(), { work: work(5.4, WORK_STEPS.slice(0, 2)) }))
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

const API = new Set(['/targets', '/conversations', '/sessions/state', '/conversation', '/conversation/log', '/reply', '/ask', '/session/answer', '/session/resume', '/session/close', '/draft', '/commands'])

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

  // §4.1 — any bearer passes, except "bad".
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer === 'bad') {
    log(401)
    return fail(res, 401, 'Audiobookshelf rejected that login')
  }

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
    return ok({ session: s.session, item: s.item, scanning: false, live: s.live, pane: s.pane, resumable: true })
  }

  if (method === 'GET' && path === '/conversation/log') {
    const s = byItem(q.get('item') || '')
    if (!s) return err(404, 'no such item')
    return (send(res, 200, logOf(s)), 200)
  }

  if (method === 'POST' && path === '/reply') {
    const text = String(body.text || '').trim()
    if (!text) return err(400, 'empty reply')
    const s = byItem(body.item || '')
    if (!s) return err(404, 'not a conversation (no session behind it)')
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

  return err(400, 'not in the mock')
}
