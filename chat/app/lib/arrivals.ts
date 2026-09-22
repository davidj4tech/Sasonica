/**
 * Replies that arrived in threads other than the one being read — told, never
 * acted on.
 *
 * REALITY (David, 22 Sep 2026): a turn finishing in another session took
 * over the screen he was reading. The rule since: nothing that happens
 * elsewhere navigates, changes the open thread, its follow-along or its
 * scroll. It becomes a notice ("New reply · <title>", tap to open) and an
 * unread dot in the list, and that is all.
 *
 * Where arrivals come from:
 * - /speech/now (§6.5): a reply from a session starting to be heard (not a
 *   replay), and each entry of `queued` — said but waiting for the voice;
 *   `urgent` ones (a question, a permission prompt) get a stronger notice.
 * - /sessions/state: a session going working → waiting (its turn ended), or
 *   into `approval`.
 * The first answer of each is the baseline, not news.
 *
 * Unread = arrived after it was last seen here. "Seen" is per session, on
 * this device (localStorage, in try/catch): the thread open and visible
 * marks it continuously. Times are this device's clock throughout, so a
 * server clock off from the phone's cannot make a thread unread.
 */
import { useSyncExternalStore } from 'react'
import type { SessionId, SessionState, SpeechNow } from '../api/types'

export type NoticeKind = 'new' | 'waiting'

export interface Notice {
  id: number
  session: SessionId
  title: string
  kind: NoticeKind
  urgent: boolean
  /** Local ms. */
  at: number
}

const SEEN_KEY = 'sasonica.chat.seen'
const ARRIVED_KEY = 'sasonica.chat.arrived'
/** A notice goes by itself after this long (urgent ones stay longer). */
const NOTICE_MS = 12000
const URGENT_NOTICE_MS = 30000
/** Kept on screen at once, newest first. */
const MAX_NOTICES = 2

function load(key: string): Record<string, number> {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function save(key: string, v: Record<string, number>) {
  try {
    // Only the newest 200: sessions come and go.
    const keep = Object.entries(v)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(keep)))
  } catch {
    // Not kept past this page load.
  }
}

let seen: Record<string, number> | null = null
let arrived: Record<string, number> | null = null
const seenMap = () => (seen ??= typeof window === 'undefined' ? {} : load(SEEN_KEY))
const arrivedMap = () => (arrived ??= typeof window === 'undefined' ? {} : load(ARRIVED_KEY))

let notices: Notice[] = []
let nextId = 1
/** The thread on screen, if any. */
let openSession: SessionId | null = null
let version = 0
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

function emit() {
  version++
  for (const fn of listeners) fn()
}
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/** The thread page tells us which session is open (null when it closes). */
export function setOpenSession(session: SessionId | null) {
  openSession = session
  if (session) markSeen(session)
}

/** Everything in this thread up to now has been seen. */
export function markSeen(session: SessionId) {
  seenMap()[session] = Date.now()
  save(SEEN_KEY, seenMap())
  notices = notices.filter((n) => n.session !== session)
  emit()
}

function isUnreadRaw(session: SessionId) {
  return (arrivedMap()[session] || 0) > (seenMap()[session] || 0)
}

export function dismissNotice(id: number) {
  notices = notices.filter((n) => n.id !== id)
  const t = timers.get(id)
  if (t !== undefined) window.clearTimeout(t)
  timers.delete(id)
  emit()
}

/**
 * Every live session's title from /sessions/state: what names a notice when
 * its source had none — a chat started since the list was fetched, or a
 * /speech/now that has no title for it yet. Without it the notice showed
 * the session id's first 8 characters.
 */
const liveTitles = new Map<string, string>()

/** Something new in `session`. Only the open, visible thread takes it silently. */
export function arrive(session: SessionId, title: string, kind: NoticeKind, urgent = false) {
  const now = Date.now()
  arrivedMap()[session] = now
  save(ARRIVED_KEY, arrivedMap())
  if (session === openSession && visible()) {
    markSeen(session)
    return
  }
  const old = notices.find((n) => n.session === session)
  // "New reply" supersedes "waiting" for the same session, not the reverse.
  const k: NoticeKind = old?.kind === 'new' && kind === 'waiting' ? 'new' : kind
  if (old) dismissNoticeQuiet(old.id)
  const n: Notice = { id: nextId++, session, title: title || liveTitles.get(session) || old?.title || '', kind: k, urgent: urgent || !!old?.urgent, at: now }
  notices = [n, ...notices].slice(0, MAX_NOTICES)
  timers.set(
    n.id,
    window.setTimeout(() => dismissNotice(n.id), n.urgent ? URGENT_NOTICE_MS : NOTICE_MS)
  )
  emit()
}
function dismissNoticeQuiet(id: number) {
  notices = notices.filter((n) => n.id !== id)
  const t = timers.get(id)
  if (t !== undefined) window.clearTimeout(t)
  timers.delete(id)
}

// ── Sources ───────────────────────────────────────────────────────────────

let speechBase = false
let heard: string | null = null
const queuedSeen = new Set<string>()

/** Every /speech/now answer (the SpeechProvider's poll). */
export function noteSpeech(now: SpeechNow) {
  const hearing = now.live && !now.replay && now.session ? now.session : null
  const queued = (now.queued || []).filter((q) => q.session)
  const keys = queued.map((q) => `${q.session}|${q.at}`)
  if (!speechBase) {
    speechBase = true
    heard = hearing
    keys.forEach((k) => queuedSeen.add(k))
    return
  }
  if (hearing && hearing !== heard) arrive(hearing, now.title, 'new')
  heard = hearing
  queued.forEach((q, i) => {
    if (queuedSeen.has(keys[i])) return
    queuedSeen.add(keys[i])
    arrive(q.session as SessionId, q.title, 'waiting', !!q.urgent)
  })
}

let statesBase: Record<string, SessionState> | null = null

/** Every /sessions/state answer; `titleOf` names a session for the notice. */
export function noteStates(next: Record<string, SessionState>, titleOf: (s: SessionId) => string, titles: Record<string, string> = {}) {
  for (const [session, title] of Object.entries(titles)) if (title) liveTitles.set(session, title)
  const prev = statesBase
  statesBase = next
  if (!prev) return
  for (const [session, state] of Object.entries(next)) {
    const was = prev[session]
    if (state === 'waiting' && was === 'working') arrive(session, titleOf(session), 'new')
    else if (state === 'approval' && was !== 'approval') arrive(session, titleOf(session), 'new', true)
  }
}

// ── For components ────────────────────────────────────────────────────────

const getVersion = () => version

/** Arrived since this device last had it open. */
export function useUnread(session: SessionId): boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return isUnreadRaw(session)
}

export function useNotices(): Notice[] {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return notices
}
