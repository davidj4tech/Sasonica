/**
 * The notes routes (server-contract.md §6.10), for mock/server.mjs: a small
 * invented Org tree in memory. Captures append to it; `say` and setup
 * actions are recorded, never run. `GET /mock/notes` shows what was
 * written; `?reset=1` puts the tree back; `?unset=1` empties it, so the
 * app sees a server with no notes (the setup path); `?drop=<title>` takes a
 * heading out, as an edit at the desk would.
 */

// Local dates, not UTC: the app's "Today" is the browser's day, so a UTC
// fixture read as yesterday every morning east of Greenwich.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => iso(new Date())
const addDays = (n) => iso(new Date(Date.now() + n * 86400e3))

function fixtures() {
  return {
    'inbox.org': `#+title: Inbox\n\n* THIS WEEK\n** TODO Water the fern\n   SCHEDULED: <${addDays(-2)} Mon>\n   The big one by the window.\n** NEXT [#A] Ring the plumber :phone:\n   DEADLINE: <${addDays(1)} Wed>\n** DONE Posted the parcel\n* LATER\n** WAITING Library hold on the atlas\n`,
    'tickler.org': `#+title: Tickler\n\n* Tickler\n** TODO Renew the passport\n   SCHEDULED: <${today()} Tue>\n** TODO Stretch\n   SCHEDULED: <${addDays(-1)} Mon +1d>\n`,
    'next-actions.org': `#+title: Next actions\n\n* Inbox\n** NEXT Sharpen the shears\n`,
    'roam/projects/garden.org': `:PROPERTIES:\n:ID: garden-id\n:END:\n#+title: Garden plan\n\nBeds by the fence. See [[id:seeds-id][seed list]].\n\n* Spring\n- [X] dig the beds\n- [ ] sow the /beans/\n`,
    'roam/projects/seeds.org': `:PROPERTIES:\n:ID: seeds-id\n:END:\n#+title: Seed list\n\n- beans\n- peas\n`,
    'roam/sessions/inbox/s1.org': `#+title: An agent session\n\nThe fern came up here too.\n`
  }
}

let FILES = fixtures()
const SETUP = { unset: false, synced: true, paragtd: false }
export const NOTES_LOG = { captures: [], said: [], setup: [], edits: [], asked: [] }
/** Chats started about an item (POST /notes/ask), by `path\ttitle`, newest first. */
const CHATS = {}

const STATES = ['TODO', 'NEXT', 'WAITING', 'SOMEDAY', 'DONE', 'CANCELLED']
const HEAD = new RegExp(`^(\\*+)\\s+(?:(${STATES.join('|')})\\s+)?(?:\\[#([A-C])\\]\\s+)?(.*?)(?:\\s+(:[\\w@:]+:))?\\s*$`)

function headings(path, done = false) {
  const lines = (FILES[path] || '').split('\n')
  const out = []
  lines.forEach((line, i) => {
    const m = HEAD.exec(line)
    if (m) out.push({ path, at: i + 1, level: m[1].length, state: m[2] || '', priority: m[3] || '', title: m[4], tags: (m[5] || '').split(':').filter(Boolean) })
    else if (out.length && /^\s*(SCHEDULED|DEADLINE):/.test(line)) {
      for (const d of line.matchAll(/(SCHEDULED|DEADLINE):\s*<(\d{4}-\d{2}-\d{2})/g)) out[out.length - 1][d[1].toLowerCase()] = d[2]
    }
  })
  return done ? out : out.filter((h) => h.state !== 'DONE' && h.state !== 'CANCELLED')
}

const titleOf = (p) => /#\+title:\s*(.+)/i.exec(FILES[p] || '')?.[1] || p.split('/').pop()

const VIEWS = [
  { name: 'inbox', label: 'Inbox', file: 'inbox.org' },
  { name: 'next', label: 'Next actions', file: 'next-actions.org' },
  { name: 'tickler', label: 'Tickler', file: 'tickler.org' }
]
const FOLDERS = [
  { name: 'roam-projects', label: 'Project notes', dir: 'roam/projects/' },
  { name: 'roam-sessions', label: 'Agent sessions', dir: 'roam/sessions/' }
]

export async function notesRoute(method, path, q, body, ok, err) {
  if (!path.startsWith('/notes')) return 0
  if (method === 'GET' && path === '/notes') {
    if (SETUP.unset) return ok({ root: '/home/you/org', views: [{ name: 'agenda', label: 'Agenda', kind: 'agenda' }] })
    return ok({
      root: '/home/you/org',
      views: [
        { name: 'agenda', label: 'Agenda', kind: 'agenda' },
        ...VIEWS.map((v) => ({ name: v.name, label: v.label, kind: 'file', path: v.file, count: headings(v.file).filter((h) => h.state).length })),
        ...FOLDERS.map((f) => ({ name: f.name, label: f.label, kind: 'folder', count: Object.keys(FILES).filter((p) => p.startsWith(f.dir)).length }))
      ]
    })
  }
  if (method === 'GET' && path === '/notes/view') {
    const name = q.get('name')
    if (name === 'agenda') {
      const horizon = addDays(7)
      const items = VIEWS.flatMap((v) => headings(v.file))
        .map((h) => ({ ...h, date: h.deadline || h.scheduled }))
        .filter((h) => h.date && h.date <= horizon)
        .map((h) => ({ ...h, overdue: h.date < today() }))
        .sort((a, b) => a.date.localeCompare(b.date))
      return ok({ view: name, items })
    }
    const v = VIEWS.find((x) => x.name === name)
    if (v) return ok({ view: name, items: headings(v.file, q.get('done') === '1') })
    const f = FOLDERS.find((x) => x.name === name)
    if (f) return ok({ view: name, items: Object.keys(FILES).filter((p) => p.startsWith(f.dir)).map((p) => ({ path: p, title: titleOf(p), modified: Math.round(Date.now() / 1000) - 3600 })) })
    return err(404, `no such view '${name}'`)
  }
  if (method === 'GET' && path === '/notes/read') {
    const p = q.get('path') || ''
    const at = Number(q.get('at') || 0)
    if (!(p in FILES)) return err(404, 'no such note')
    let text = FILES[p]
    let title = titleOf(p)
    if (at) {
      const lines = text.split('\n')
      const m = HEAD.exec(lines[at - 1] || '')
      if (!m) return err(409, 'no heading on that line (the file changed?)')
      const level = m[1].length
      let end = lines.length
      for (let j = at; j < lines.length; j++) {
        const n = HEAD.exec(lines[j])
        if (n && n[1].length <= level) { end = j; break }
      }
      text = lines.slice(at - 1, end).join('\n') + '\n'
      title = m[4]
    }
    const ids = { 'seeds-id': 'roam/projects/seeds.org', 'garden-id': 'roam/projects/garden.org' }
    const links = [...text.matchAll(/\[\[id:([^\]]+)\](?:\[([^\]]*)\])?\]/g)].filter((m) => ids[m[1]]).map((m) => ({ label: m[2] || m[1], path: ids[m[1]] }))
    return ok({ path: p, at, title, text, links, chats: CHATS[`${p}\t${title}`] || [] })
  }
  if (method === 'GET' && path === '/notes/search') {
    const needle = (q.get('q') || '').toLowerCase()
    if (!needle) return err(400, 'nothing to search for')
    const all = q.get('all') === '1'
    const notes = []
    for (const [p, text] of Object.entries(FILES)) {
      if (!all && p.startsWith('roam/sessions/')) continue
      text.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(needle)) notes.push({ path: p, line: i + 1, text: line.trim() })
      })
    }
    const memories = needle.includes('fern') ? [{ id: 'm1', user: 'ryer', score: 0.8, text: 'The fern was repotted in August.' }] : []
    return ok({ q: q.get('q'), notes, memories })
  }
  if (method === 'POST' && path === '/notes/capture') {
    const text = String(body.text || '').trim()
    if (!text) return err(400, 'nothing to capture')
    const kind = body.kind === 'note' ? 'note' : 'todo'
    const [first, ...rest] = text.split('\n')
    const before = FILES['inbox.org'] || ''
    const at = before.split('\n').length - (before.endsWith('\n') ? 1 : 0) + 1
    FILES['inbox.org'] = before + `* ${kind === 'todo' ? 'TODO ' : ''}${first}\n:PROPERTIES:\n:CREATED: [${today()}]\n:END:\n${rest.map((l) => (l.startsWith('*') ? ' ' + l : l) + '\n').join('')}`
    NOTES_LOG.captures.push({ text, kind })
    return ok({ path: 'inbox.org', at, kind, remembered: body.memory !== false })
  }
  if (method === 'POST' && (path === '/notes/state' || path === '/notes/refile' || path === '/notes/date')) {
    // The same finding rule as the server: the line if it still holds the
    // title, else the one heading with that title, else 409.
    const p = String(body.path || '')
    if (!(p in FILES) || p.startsWith('roam/')) return err(400, 'only the GTD files (inbox, next actions, …) can be changed here')
    const lines = FILES[p].replace(/\n$/, '').split('\n')
    const titleAt = (i) => HEAD.exec(lines[i] || '')?.[4]
    let i = Number(body.at || 0) - 1
    if (titleAt(i) !== body.title) {
      const hits = lines.map((_, j) => j).filter((j) => titleAt(j) === body.title)
      if (hits.length !== 1) return err(409, 'that heading is not there any more (the file changed?)')
      i = hits[0]
    }
    const m = HEAD.exec(lines[i])
    const level = m[1].length
    const setState = (line, st) => { const h = HEAD.exec(line); return [h[1], st, h[3] ? `[#${h[3]}]` : '', h[4]].filter(Boolean).join(' ') + (h[5] ? ' ' + h[5] : '') }
    NOTES_LOG.edits.push({ path, ...body })
    if (path === '/notes/date') {
      // The stamp rewritten in place: its repeater kept, its time unless given.
      const kind = String(body.kind || 'scheduled').toUpperCase()
      if (kind !== 'SCHEDULED' && kind !== 'DEADLINE') return err(400, `not a date kind: '${body.kind}'`)
      const date = String(body.date || '')
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(400, 'the date must be YYYY-MM-DD')
      const re = new RegExp(`${kind}:\\s*<([^>]*)>`)
      const plan = /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[i + 1] || '') ? i + 1 : -1
      const old = plan >= 0 ? re.exec(lines[plan]) : null
      const parts = old ? old[1].split(' ').slice(1).filter((x) => /\d/.test(x)) : []
      const oldTime = parts.find((x) => /^\d{1,2}:\d{2}/.test(x)) || ''
      const time = body.time === undefined ? oldTime : String(body.time)
      const day = date ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date + 'T12:00:00Z').getUTCDay()] : ''
      const stamp = `${kind}: <${[date, day, time, ...parts.filter((x) => x !== oldTime)].filter(Boolean).join(' ')}>`
      if (date && old) lines[plan] = lines[plan].replace(re, stamp)
      else if (date && plan >= 0) lines[plan] = `${lines[plan].trimEnd()} ${stamp}`
      else if (date) lines.splice(i + 1, 0, ' '.repeat(level + 1) + stamp)
      else if (old) {
        const rest = lines[plan].replace(re, '').replace(/\s+/g, ' ').trim()
        if (rest) lines[plan] = lines[plan].match(/^\s*/)[0] + rest
        else lines.splice(plan, 1)
      }
      FILES[p] = lines.join('\n') + '\n'
      return ok({ path: p, at: i + 1, kind: kind.toLowerCase(), date, time: date ? time : '' })
    }
    if (path === '/notes/state') {
      const st = String(body.state || '').toUpperCase()
      const plan = /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[i + 1] || '') ? i + 1 : -1
      const rep = plan >= 0 && /<(\d{4}-\d{2}-\d{2})[^>]*\+(\d+)d>/.exec(lines[plan])
      if (st === 'DONE' && rep && m[2] !== 'DONE') {
        const next = iso(new Date(new Date(rep[1] + 'T12:00:00').getTime() + Number(rep[2]) * 86400e3))
        lines[plan] = lines[plan].replace(rep[1], next)
        FILES[p] = lines.join('\n') + '\n'
        return ok({ path: p, at: i + 1, state: m[2] || '', repeated: true, next })
      }
      lines[i] = setState(lines[i], st)
      if (st === 'DONE' && m[2] !== 'DONE') lines.splice(i + 1, 0, ' '.repeat(level + 1) + `CLOSED: [${today()}]`)
      else if (st !== 'DONE' && m[2] === 'DONE' && /^\s*CLOSED:/.test(lines[i + 1] || '')) lines.splice(i + 1, 1)
      FILES[p] = lines.join('\n') + '\n'
      return ok({ path: p, at: i + 1, state: st, repeated: false })
    }
    const targets = { next: ['next-actions.org', 'Inbox', 'NEXT'], waiting: ['waiting-for.org', 'Waiting', 'WAITING'], tickler: ['tickler.org', 'Tickler', null], someday: ['someday.org', null, null], projects: ['projects.org', null, null], inbox: ['inbox.org', null, null] }
    const t = targets[body.to]
    if (!t) return err(400, `cannot move a heading to '${body.to}'`)
    if (t[0] === p) return err(400, `it is already in ${p}`)
    if (body.to === 'tickler' && !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return err(400, 'the tickler needs a date (YYYY-MM-DD)')
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) { const n = HEAD.exec(lines[j]); if (n && n[1].length <= level) { end = j; break } }
    let tree = lines.splice(i, end - i)
    FILES[p] = lines.join('\n') + '\n'
    const newLevel = t[1] ? 2 : 1
    tree = tree.map((ln) => { const h = /^(\*+)(\s.*)$/.exec(ln); return h ? '*'.repeat(h[1].length - level + newLevel) + h[2] : ln })
    if (t[2]) tree[0] = setState(tree[0], t[2])
    if (body.date) tree.splice(1, 0, ' '.repeat(newLevel + 1) + `SCHEDULED: <${body.date}>`)
    const dst = (FILES[t[0]] || '').replace(/\n+$/, '').split('\n').filter((x, k, a) => a.length > 1 || x)
    let at
    if (t[1]) {
      let h = dst.findIndex((ln) => ln === `* ${t[1]}`)
      if (h < 0) { dst.push(`* ${t[1]}`); h = dst.length - 1 }
      let ins = dst.length
      for (let j = h + 1; j < dst.length; j++) if (/^\*\s/.test(dst[j])) { ins = j; break }
      dst.splice(ins, 0, ...tree)
      at = ins + 1
    } else {
      at = dst.length + 1
      dst.push(...tree)
    }
    FILES[t[0]] = dst.join('\n') + '\n'
    return ok({ path: t[0], at, to: body.to })
  }
  if (method === 'POST' && path === '/notes/say') {
    const p = String(body.path || '')
    if (!(p in FILES)) return err(404, 'no such note')
    NOTES_LOG.said.push({ path: p, at: body.at || 0 })
    return ok({ path: p, at: body.at || 0, title: titleOf(p), chars: FILES[p].length })
  }
  if (path === '/notes/setup') {
    const components = [
      SETUP.unset
        ? { name: 'org', label: 'Notes folder', state: 'missing', detail: '/home/you/org', why: 'no notes here; start a fresh set', actions: ['create'], optional: false }
        : { name: 'org', label: 'Notes folder', state: 'ok', detail: '/home/you/org', why: null, actions: [], optional: false },
      SETUP.unset
        ? { name: 'sync', label: 'Sync (org-autosync)', state: 'off', detail: 'commits and pushes the notes every 5 minutes', why: 'the notes folder is not a git repository, so there is nothing to sync', actions: [], optional: false }
        : { name: 'sync', label: 'Sync (org-autosync)', state: 'ok', detail: 'commits and pushes the notes every 5 minutes', why: null, actions: [], optional: false },
      { name: 'memory', label: 'Memory store', state: 'down', detail: 'search reads it, captures are remembered in it', why: 'the memory store did not answer; notes work without it', actions: [], optional: true },
      SETUP.paragtd
        ? { name: 'paragtd', label: 'paragtd', state: 'ok', detail: 'the Emacs package and astro alerts', why: null, actions: ['update'], optional: true }
        : { name: 'paragtd', label: 'paragtd', state: 'missing', detail: 'the Emacs package and astro alerts', why: 'only needed for Emacs, or for astro alerts', actions: ['install'], optional: true }
    ]
    if (method === 'GET') return ok({ components, search: 'ripgrep' })
    const c = components.find((x) => x.name === body.component)
    if (!c) return err(400, `nothing to set up called '${body.component}'`)
    if (!c.actions.includes(body.action)) return err(409, `${c.name} cannot '${body.action}' here`)
    NOTES_LOG.setup.push({ component: c.name, action: body.action })
    if (c.name === 'org') {
      SETUP.unset = false
      FILES = fixtures()
      return ok({ component: 'org', action: 'create', done: true, created: ['inbox.org', 'tickler.org'] })
    }
    SETUP.paragtd = true
    return ok({ component: c.name, action: body.action, pane: '%900', cmd: 'sh -c "git clone … && bin/bootstrap"' })
  }
  return 0
}

/** `/harnesses/screen|keys|close` for the mock's one setup window. */
let screenPolls = 0
export const KEYS_LOG = []
export function setupWindowRoute(method, path, q, body, ok, err) {
  if (method === 'GET' && path === '/harnesses/screen') {
    if (q.get('pane') !== '%900') return err(404, 'not a setup window')
    screenPolls++
    const done = screenPolls >= 3
    return ok({ pane: '%900', agent: 'notes-paragtd', action: 'install', cmd: 'sh -c "git clone … && bin/bootstrap"', lines: ['Cloning into paragtd…', ...(done ? ['bootstrap ok', '', '[finished: 0]'] : [])], done, exit: done ? 0 : null })
  }
  if (method === 'POST' && (path === '/harnesses/keys' || path === '/harnesses/close')) {
    KEYS_LOG.push({ path, ...body })
    return ok({ pane: body.pane })
  }
  return 0
}

/**
 * POST /notes/ask, the notes half: the item it is about, and the first
 * message the server would type. mock/server.mjs opens the session, then
 * hands it back to `noteChatStarted`.
 */
export function noteAsk(body) {
  const p = String(body.path || '')
  const at = Number(body.at || 0)
  const text = String(body.text || '').trim()
  if (!text) return { status: 400, error: 'empty message' }
  if (!(p in FILES)) return { status: 404, error: 'no such note' }
  let title = titleOf(p)
  let where = `~/org/${p}`
  if (at) {
    const m = HEAD.exec(FILES[p].split('\n')[at - 1] || '')
    if (!m) return { status: 409, error: 'no heading on that line (the file changed?)' }
    title = m[4]
    where += `, line ${at}${m[2] ? `, ${m[2]}` : ''}`
  }
  return { path: p, at, title, prompt: `About "${title}" in my Org notes (${where}): ${text}`, text }
}

export function noteChatStarted(got, session) {
  const k = `${got.path}\t${got.title}`
  CHATS[k] = [{ session, title: got.text.slice(0, 80), at: Math.round(Date.now() / 1000) }, ...(CHATS[k] || [])]
  NOTES_LOG.asked.push({ path: got.path, at: got.at, prompt: got.prompt, session })
}

/** `GET /mock/notes`: what was written; `?reset=1` / `?unset=1`. */
export function mockNotesControl(q) {
  if (q.get('reset')) {
    FILES = fixtures()
    SETUP.unset = false
    SETUP.paragtd = false
    for (const k of Object.keys(CHATS)) delete CHATS[k]
    screenPolls = 0
    NOTES_LOG.asked.length = NOTES_LOG.captures.length = NOTES_LOG.said.length = NOTES_LOG.setup.length = NOTES_LOG.edits.length = KEYS_LOG.length = 0
  }
  if (q.get('unset')) {
    FILES = {}
    SETUP.unset = true
  }
  if (q.get('drop')) {
    // A heading taken away behind the app's back (an edit at the desk).
    for (const p of Object.keys(FILES)) FILES[p] = FILES[p].split('\n').filter((ln) => HEAD.exec(ln)?.[4] !== q.get('drop')).join('\n')
  }
  return { ...NOTES_LOG, keys: KEYS_LOG, inbox: FILES['inbox.org'] || '', files: FILES }
}
