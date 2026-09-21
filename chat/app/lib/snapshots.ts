/**
 * The last good answer for each screen, kept on the phone so a thread (or the
 * thread list) paints at once and the network only has to confirm it —
 * stale-while-revalidate.
 *
 * Why: from the phone to red5 one round trip is ~0.43 s and a 39-line log
 * takes 2–2.5 s, and v0 opens a thread with two sequential requests (session
 * → item, then the log). That was 3–4 s of "Loading…" per thread.
 *
 * What is kept, per session: the resolved ABS item (so a known thread goes
 * straight to the log — one round trip instead of two) and the log envelope's
 * lines. Not kept: `working`, `approval`, `pending`, `suggestion` — those are
 * "what is happening right now", and a stale approval card or a stale step
 * timer would be a lie. They arrive with the first fresh poll.
 *
 * Two layers: a memory map (synchronous, so moving between screens inside the
 * app paints on the very first render) over IndexedDB (lib/store.ts, so a
 * cold start of the app still paints before the network). Both are
 * best-effort; no storage just means no cache.
 *
 * Bounded: at most MAX_THREADS threads (least recently opened or refreshed
 * goes first) and MAX_LINES lines each.
 */
import type { ConversationLog, ItemId, Line, SessionId, SessionsStateResponse, TargetsResponse } from '../api/types'
import { idbDel, idbGet, idbSet } from './store'

const MAX_THREADS = 40
/** The newest this many lines are kept; the fresh log fills in the rest. */
const MAX_LINES = 300

const threadKey = (session: SessionId) => `thread:${session}`
const INDEX_KEY = 'threads:index'
const TARGETS_KEY = 'list:targets'
const STATES_KEY = 'list:states'

/** What the thread page gets back. */
export interface ThreadSnapshot {
  session: SessionId
  item: ItemId | null
  /** Lines as last seen, with any live marking removed (see plainLine). */
  lines: Line[]
  /** Local ms the lines were last saved. */
  savedAt: number
}

/** On disk: the lines as a JSON string, which doubles as the change signature. */
interface Stored {
  session: SessionId
  item: ItemId | null
  json: string
  savedAt: number
}

/** Per session: when it was last opened/saved (LRU) and last fetched (prefetch). */
type Index = Record<SessionId, { used: number; checked: number }>

// ── The index (LRU + "fetched recently") ─────────────────────────────────

let index: Index = {}
let indexLoaded: Promise<void> | null = null

function loadIndex(): Promise<void> {
  if (!indexLoaded) {
    indexLoaded = idbGet<Index>(INDEX_KEY).then((stored) => {
      // Anything touched before the disk answered wins over the disk.
      if (stored && typeof stored === 'object') index = { ...stored, ...index }
    })
  }
  return indexLoaded
}

let indexTimer: number | null = null
/** Coalesce index writes: a poll touches it every second while live. */
function saveIndexSoon() {
  if (indexTimer !== null) return
  indexTimer = window.setTimeout(() => {
    indexTimer = null
    void idbSet(INDEX_KEY, index)
  }, 1000)
}

function touch(session: SessionId, what: { used?: boolean; checked?: boolean }) {
  const now = Date.now()
  const row = index[session] || { used: 0, checked: 0 }
  index[session] = { used: what.used ? now : row.used, checked: what.checked ? now : row.checked }
  saveIndexSoon()
}

/** Drop the least recently used threads beyond MAX_THREADS. */
async function evict() {
  await loadIndex()
  const sessions = Object.keys(index)
  if (sessions.length <= MAX_THREADS) return
  sessions.sort((a, b) => index[b].used - index[a].used)
  for (const s of sessions.slice(MAX_THREADS)) {
    delete index[s]
    memory.delete(s)
    void idbDel(threadKey(s))
  }
  saveIndexSoon()
}

// ── Threads ───────────────────────────────────────────────────────────────

const memory = new Map<SessionId, Stored>()

/**
 * A cached line is history, never "now": its follow-along clock is as old as
 * the cache, so bolding from it would point at the wrong sentence. Keep the
 * words, drop the live fields; the first fresh poll puts them back.
 */
export function plainLine(line: Line): Line {
  if (!line.live) return line
  const { live: _l, sentences: _s, sentence: _n, offsets: _o, elapsed: _e, server_time: _t, delay: _d, paused: _p, ...rest } = line
  return rest
}

function parse(stored: Stored | undefined): ThreadSnapshot | undefined {
  if (!stored || typeof stored.json !== 'string') return undefined
  try {
    const lines = JSON.parse(stored.json) as Line[]
    if (!Array.isArray(lines)) return undefined
    return { session: stored.session, item: stored.item, lines: lines.map(plainLine), savedAt: stored.savedAt }
  } catch {
    return undefined
  }
}

/** Synchronous: only what this page load has already seen. */
export function peekThread(session: SessionId): ThreadSnapshot | undefined {
  return parse(memory.get(session))
}

/** The snapshot, from memory or disk. Marks the thread as recently used. */
export async function loadThread(session: SessionId): Promise<ThreadSnapshot | undefined> {
  let stored = memory.get(session)
  if (!stored) {
    stored = await idbGet<Stored>(threadKey(session))
    if (stored && !memory.has(session)) memory.set(session, stored)
    stored = memory.get(session)
  }
  if (stored) touch(session, { used: true })
  return parse(stored)
}

/** The item a session resolved to — v0's log is keyed by it. */
export function saveThreadItem(session: SessionId, item: ItemId | null) {
  const prev = memory.get(session)
  if (prev && prev.item === item) return
  const stored: Stored = { session, item, json: prev?.json || '[]', savedAt: prev?.savedAt || 0 }
  memory.set(session, stored)
  touch(session, { used: true })
  void idbSet(threadKey(session), stored).then(evict)
}

/**
 * A good /conversation/log answer. Written only when the lines changed —
 * a live reply is re-polled every second, but with its live fields stripped
 * the text is the same until the next line lands, so nothing is written.
 */
export function saveThreadLog(session: SessionId, item: ItemId, log: ConversationLog) {
  touch(session, { used: true, checked: true })
  let json: string
  try {
    json = JSON.stringify((log.lines || []).slice(-MAX_LINES).map(plainLine))
  } catch {
    return
  }
  const prev = memory.get(session)
  if (prev && prev.item === item && prev.json === json) return
  const stored: Stored = { session, item, json, savedAt: Date.now() }
  memory.set(session, stored)
  void idbSet(threadKey(session), stored).then(evict)
}

/** Local ms this thread's log was last fetched successfully, 0 if never. */
export async function lastChecked(session: SessionId): Promise<number> {
  await loadIndex()
  return index[session]?.checked || 0
}

// ── The thread list ──────────────────────────────────────────────────────

const listMemory: { targets?: TargetsResponse; states?: SessionsStateResponse } = {}

export function peekTargets() {
  return listMemory.targets
}
export async function loadTargets(): Promise<TargetsResponse | undefined> {
  if (!listMemory.targets) listMemory.targets = await idbGet<TargetsResponse>(TARGETS_KEY)
  return listMemory.targets
}
export function saveTargets(res: TargetsResponse) {
  listMemory.targets = res
  void idbSet(TARGETS_KEY, res)
}

export function peekStates() {
  return listMemory.states
}
export async function loadStates(): Promise<SessionsStateResponse | undefined> {
  if (!listMemory.states) listMemory.states = await idbGet<SessionsStateResponse>(STATES_KEY)
  return listMemory.states
}
let lastStatesJson = ''
/** Polled every 5 s; written only when it changed. */
export function saveStates(res: SessionsStateResponse) {
  listMemory.states = res
  const json = JSON.stringify(res.sessions || [])
  if (json === lastStatesJson) return
  lastStatesJson = json
  void idbSet(STATES_KEY, res)
}
