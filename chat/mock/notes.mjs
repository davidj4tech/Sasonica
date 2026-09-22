/**
 * The notes routes (server-contract.md §6.10), for mock/server.mjs: a small
 * invented Org tree in memory. Captures append to it; `say` and setup
 * actions are recorded, never run. `GET /mock/notes` shows what was
 * written; `?reset=1` puts the tree back; `?unset=1` empties it, so the
 * app sees a server with no notes (the setup path).
 */

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10)

function fixtures() {
  return {
    'inbox.org': `#+title: Inbox\n\n* THIS WEEK\n** TODO Water the fern\n   SCHEDULED: <${addDays(-2)} Mon>\n   The big one by the window.\n** NEXT [#A] Ring the plumber :phone:\n   DEADLINE: <${addDays(1)} Wed>\n** DONE Posted the parcel\n* LATER\n** WAITING Library hold on the atlas\n`,
    'tickler.org': `#+title: Tickler\n\n* Tickler\n** TODO Renew the passport\n   SCHEDULED: <${today()} Tue>\n`,
    'roam/projects/garden.org': `:PROPERTIES:\n:ID: garden-id\n:END:\n#+title: Garden plan\n\nBeds by the fence. See [[id:seeds-id][seed list]].\n\n* Spring\n- [X] dig the beds\n- [ ] sow the /beans/\n`,
    'roam/projects/seeds.org': `:PROPERTIES:\n:ID: seeds-id\n:END:\n#+title: Seed list\n\n- beans\n- peas\n`,
    'roam/sessions/inbox/s1.org': `#+title: An agent session\n\nThe fern came up here too.\n`
  }
}

let FILES = fixtures()
const SETUP = { unset: false, synced: true, paragtd: false }
export const NOTES_LOG = { captures: [], said: [], setup: [] }

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
    return ok({ path: p, at, title, text, links })
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

/** `GET /mock/notes`: what was written; `?reset=1` / `?unset=1`. */
export function mockNotesControl(q) {
  if (q.get('reset')) {
    FILES = fixtures()
    SETUP.unset = false
    SETUP.paragtd = false
    screenPolls = 0
    NOTES_LOG.captures.length = NOTES_LOG.said.length = NOTES_LOG.setup.length = KEYS_LOG.length = 0
  }
  if (q.get('unset')) {
    FILES = {}
    SETUP.unset = true
  }
  return { ...NOTES_LOG, keys: KEYS_LOG, inbox: FILES['inbox.org'] || '' }
}
