import { useCallback, useEffect, useState } from 'react'
import { ApiError, getSessionConversation, getSessionsState, getTargets } from '../api'
import type { Place, SessionConversation, SessionRow, SessionState, SessionsStateResponse, TargetsResponse } from '../api/types'
import { loadStates, loadTargets, loadThread, peekStates, peekTargets, peekThread, saveStates, saveTargets, saveThreadItem } from '../lib/snapshots'
import { usePoll } from './usePoll'

/** Titles seen in /targets, so a thread page has a heading before it asks. */
const titles = new Map<string, string>()
export function knownTitle(session: string): string {
  return titles.get(session) || ''
}

function rowsOf(res: TargetsResponse): SessionRow[] {
  for (const row of res.sessions) titles.set(row.session, row.title)
  // Live first (the server already orders them so; kept explicit).
  return [...res.sessions].sort((a, b) => Number(b.live) - Number(a.live))
}

/**
 * GET /targets — on open, and on demand (§6.1: "on open"). Paints from the
 * last saved answer first (lib/snapshots.ts); `stale` until the server
 * confirms it.
 */
export function useTargets() {
  const [cached] = useState(() => peekTargets())
  const [sessions, setSessions] = useState<SessionRow[]>(() => (cached ? rowsOf(cached) : []))
  const [places, setPlaces] = useState<Place[]>(() => cached?.places || [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(!!cached)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTargets()
      saveTargets(res)
      setSessions(rowsOf(res))
      setPlaces(res.places || [])
      setError('')
      setStale(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let fresh = false
    // Disk snapshot (a cold start of the app), unless the network beat it.
    if (!cached) {
      void loadTargets().then((res) => {
        if (fresh || !res) return
        setSessions((s) => (s.length ? s : rowsOf(res)))
        setPlaces((p) => (p.length ? p : res.places || []))
        setStale(true)
      })
    }
    void load().then(() => {
      fresh = true
    })
  }, [load, cached])

  return { sessions, places, error, loading, stale, reload: load }
}

function stateMap(res: SessionsStateResponse | undefined): Record<string, SessionState> {
  const next: Record<string, SessionState> = {}
  for (const row of res?.sessions || []) next[row.session] = row.state
  return next
}

/**
 * GET /sessions/state, polled every 5 s (§6.1). Absent = not live. Starts
 * from the last saved answer, so the list's badges paint with it.
 */
export function useSessionStates(enabled = true) {
  const [states, setStates] = useState<Record<string, SessionState>>(() => stateMap(peekStates()))
  useEffect(() => {
    if (peekStates()) return
    void loadStates().then((res) => {
      if (res) setStates((s) => (Object.keys(s).length ? s : stateMap(res)))
    })
  }, [])
  usePoll(
    async () => {
      try {
        const res = await getSessionsState()
        saveStates(res)
        setStates(stateMap(res))
      } catch {
        // Keep the last map; the list's own error line says what is wrong.
      }
    },
    () => 5000,
    enabled
  )
  return states
}

/** How long to wait for the shelf to catch up with a new session (S: ask.vue). */
const ITEM_WAIT_MS = 5 * 60 * 1000
const ITEM_POLL_MS = 3000

/**
 * GET /conversation?session= — what this thread is, and its ABS item once
 * the library has built one. v0's log is keyed by item, so until it arrives
 * the thread has no transcript to show ("not on the shelf yet"). Polled every
 * 3 s for up to 5 minutes while the item is missing or still scanning.
 *
 * The resolved item is saved (lib/snapshots.ts): a thread opened before
 * starts its log request at once with the saved item instead of waiting a
 * round trip for this one. This one still runs, beside the log, to refresh
 * live/resumable and to correct the item if it ever changed.
 */
export function useThreadInfo(session: string) {
  const [info, setInfo] = useState<SessionConversation | null>(null)
  const [cachedItem, setCachedItem] = useState<string | null>(() => peekThread(session)?.item || null)
  const [error, setError] = useState('')
  const [asked, setAsked] = useState(false)
  const [startedAt] = useState(() => Date.now())

  useEffect(() => {
    if (cachedItem) return
    let cancelled = false
    void loadThread(session).then((snap) => {
      if (!cancelled && snap?.item) setCachedItem((c) => c || snap.item)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const waiting = !info || !info.item || info.scanning
  usePoll(
    async () => {
      try {
        const res = await getSessionConversation(session)
        setInfo(res)
        setError('')
        if (res.item && !res.scanning) saveThreadItem(session, res.item)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        if (err instanceof ApiError && err.status === 400) setInfo(null)
      } finally {
        setAsked(true)
      }
    },
    () => ITEM_POLL_MS,
    !!session && (!asked || waiting) && Date.now() - startedAt < ITEM_WAIT_MS,
    [session]
  )

  // A usable item: the server's, once it has answered (present and not
  // scanning, §6.2); until then the saved one.
  const fresh = info && info.item && !info.scanning ? info.item : null
  const item = info ? fresh : cachedItem
  return { info, item, error }
}
