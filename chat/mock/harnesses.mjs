// The harness routes (§6.6), mocked: GET /harnesses, POST /harnesses/run,
// and the screen / keys / close of the windows run opened. Claude is signed
// in, Codex is installed but signed out, pi is missing, Hermes can't say.
// A sign-in shows its link and waits for a code; typing one (then Enter)
// signs Codex in. An install finishes on its third screen and installs pi.
// Panes that aren't ours fall through to the notes window (mock/notes.mjs).

const fixtures = () => ({
  claude: { present: true, version: '2.3.1 (Claude Code)', auth: 'in', account: 'you@example.com' },
  codex: { present: true, version: 'codex-cli 0.155.1', auth: 'out', account: '' },
  pi: { present: false, version: '', auth: 'unknown', account: '' },
  hermes: { present: true, version: 'Hermes 0.9', auth: 'unknown', account: '' }
})
const INSTALL = { claude: 'npm install -g @anthropic-ai/claude-code', codex: 'npm install -g @openai/codex', pi: 'npm install -g @mariozechner/pi-coding-agent', hermes: 'hermes update' }
const LOGIN = { claude: 'claude auth login', codex: 'codex login' }

let H = fixtures()
let WIN = new Map()
let next = 910
export const HARNESS_LOG = { runs: [], keys: [], closed: [] }

function rows() {
  return Object.entries(H).map(([name, h]) => {
    const actions = []
    if (INSTALL[name] && (name !== 'hermes' || h.present)) actions.push('install')
    if (h.present && LOGIN[name]) actions.push('login')
    return { name, present: h.present, path: h.present ? `/home/you/.local/bin/${name}` : null, version: h.present ? h.version : '', auth: h.present ? h.auth : 'unknown', account: h.account, actions, installed_action: h.present ? 'update' : 'install' }
  })
}

export function harnessRoute(method, path, q, body, ok, err) {
  if (method === 'GET' && path === '/harnesses') return ok({ agents: rows() })
  if (method === 'POST' && path === '/harnesses/run') {
    const { agent, action } = body
    if (!(agent in H)) return err(400, `not an agent: '${agent}'`)
    const cmd = action === 'install' ? INSTALL[agent] : action === 'login' ? LOGIN[agent] : null
    if (!cmd) return err(409, action === 'login' ? `${agent} has no sign-in to run` : `no install recipe for ${agent}`)
    const pane = `%${next++}`
    WIN.set(pane, { agent, action, cmd, polls: 0, typed: '', done: false, exit: null })
    HARNESS_LOG.runs.push({ agent, action })
    return ok({ pane, agent, action, cmd })
  }
  const pane = method === 'GET' ? q.get('pane') : body?.pane
  const w = WIN.get(pane)
  if (!w) return 0
  if (method === 'GET' && path === '/harnesses/screen') {
    w.polls++
    let lines
    if (w.action === 'install') {
      lines = [`$ ${w.cmd}`, 'added 1 package in 3s']
      if (w.polls >= 3 && !w.done) {
        w.done = true
        w.exit = 0
        H[w.agent].present = true
        H[w.agent].version ||= `${w.agent} 1.0.0`
      }
    } else {
      lines = ['Open this link to sign in:', `https://auth.example.com/${w.agent}?code=abc`, '', 'Paste the code here:']
      if (w.typed) lines.push(w.typed, '', 'Signed in.')
    }
    if (w.done) lines.push('', `[finished: ${w.exit}]`)
    return ok({ pane, agent: w.agent, action: w.action, cmd: w.cmd, lines, done: w.done, exit: w.exit })
  }
  if (method === 'POST' && path === '/harnesses/keys') {
    HARNESS_LOG.keys.push({ pane, text: body.text || '', key: body.key || '' })
    if (body.text) w.typed = body.text
    if (body.key === 'Enter' && w.action === 'login' && w.typed) {
      w.done = true
      w.exit = 0
      H[w.agent].auth = 'in'
      H[w.agent].account = 'you@example.com'
    }
    return ok({ pane })
  }
  if (method === 'POST' && path === '/harnesses/close') {
    HARNESS_LOG.closed.push(pane)
    WIN.delete(pane)
    return ok({ pane })
  }
  return 0
}

/** `GET /mock/harnesses`: what was run and typed; `?reset=1` starts over. */
export function mockHarnessControl(q) {
  if (q.get('reset')) {
    H = fixtures()
    WIN = new Map()
    HARNESS_LOG.runs.length = HARNESS_LOG.keys.length = HARNESS_LOG.closed.length = 0
  }
  return { ...HARNESS_LOG, harnesses: rows() }
}
