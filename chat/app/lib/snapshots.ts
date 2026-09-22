/**
 * The last good answer for each screen, kept on the phone so a thread (or the
 * thread list) paints at once and the network only has to confirm it —
 * stale-while-revalidate.
 *
 * Why: from the phone to red5 one round trip is ~0.43 s, and a busy thread's
 * snapshot is ~390 KB (§11, uncompressed on the stream).
 *
 * What is kept, per session: the snapshot's messages (§6.2.2), plain —
 * no follow-along clock and no running turn (messages.ts plainMessage) —
 * and whether older ones exist. Not kept: `working`, `approval`, `pending`,
 * `suggestion`, the state — "what is happening right now", where a stale
 * card or step timer would be a lie. They arrive with the first snapshot.
 *
 * Two layers: a memory map (synchronous, so moving between screens inside the
 * app paints on the very first render) over IndexedDB (lib/store.ts, so a
 * cold start of the app still paints before the network). Both are
 * best-effort; no storage just means no cache.
 *
 * Bounded: at most MAX_THREADS threads (least recently opened or refreshed
 * goes first) and the newest MAX_MESSAGES messages each.
 */
import type { DashboardResponse, Message, SessionId, SessionRow, SessionsStateResponse, TargetsResponse } from '../api/types'
import { plainMessage } from './messages'
import { idbDel, idbGet, idbSet } from './store'

const MAX_THREADS = 40
/** The newest this many messages are kept (one page); the stream fills in the rest. */
const MAX_MESSAGES = 60

const threadKey = (session: SessionId) => `thread:${session}`
const INDEX_KEY = 'threads:index'
const TARGETS_KEY = 'list:targets'
const STATES_KEY = 'list:states'
const DASH_KEY = 'home:dashboard'

/** What the thread page gets back. */
export interface ThreadSnapshot {
  session: SessionId
  /** Messages as last seen, plain (see plainMessage). */
  messages: Message[]
  /** More exist before the first one. */
  older: boolean
  /** Local ms they were last saved. */
  savedAt: number
}

/** On disk: the messages as a JSON string, which doubles as the change signature. */
interface Stored {
  session: SessionId
  json: string
  older: boolean
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

function parse(stored: Stored | undefined): ThreadSnapshot | undefined {
  if (!stored || typeof stored.json !== 'string') return undefined
  try {
    const messages = JSON.parse(stored.json) as Message[]
    if (!Array.isArray(messages)) return undefined
    return { session: stored.session, messages: messages.map(plainMessage), older: !!stored.older, savedAt: stored.savedAt }
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

/**
 * The thread as last seen fresh (a snapshot, or the messages since). Written
 * only when the plain messages changed — a live reply's clock ticks, but
 * with it stripped the words are the same until something is said.
 * `older` is whether messages exist before the first KEPT one.
 */
export function saveThreadMessages(session: SessionId, messages: Message[], older: boolean) {
  touch(session, { used: true, checked: true })
  const kept = messages.slice(-MAX_MESSAGES)
  let json: string
  try {
    json = JSON.stringify(kept.map(plainMessage))
  } catch {
    return
  }
  const prev = memory.get(session)
  if (prev && prev.json === json) return
  const stored: Stored = { session, json, older: older || kept.length < messages.length, savedAt: Date.now() }
  memory.set(session, stored)
  void idbSet(threadKey(session), stored).then(evict)
}

/** Local ms this thread was last fetched successfully, 0 if never. */
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

/** A rename the server accepted: the saved list says so too, so a cold start paints it. */
export function renameInTargets(session: SessionId, title: string) {
  const cur = listMemory.targets
  if (!cur) return
  saveTargets({ ...cur, sessions: cur.sessions.map((r) => (r.session === session ? { ...r, title } : r)) })
}

/** An exit or an archive (or its rollback): the saved list says so too. */
export function patchTargetRow(session: SessionId, patch: Partial<SessionRow>) {
  const cur = listMemory.targets
  if (!cur) return
  saveTargets({ ...cur, sessions: cur.sessions.map((r) => (r.session === session ? { ...r, ...patch } : r)) })
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

// ── The home screen ──────────────────────────────────────────────────────

let dashMemory: DashboardResponse | undefined
let lastDashJson = ''
export function peekDashboard() {
  return dashMemory
}
export async function loadDashboard(): Promise<DashboardResponse | undefined> {
  if (!dashMemory) dashMemory = await idbGet<DashboardResponse>(DASH_KEY)
  return dashMemory
}
/** Polled every 5 s; written to disk only when it changed (the clock aside). */
export function saveDashboard(res: DashboardResponse) {
  dashMemory = res
  const json = JSON.stringify({ ...res, at: 0 })
  if (json === lastDashJson) return
  lastDashJson = json
  void idbSet(DASH_KEY, res)
}
