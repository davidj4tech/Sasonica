import { useCallback, useEffect, useState } from 'react'
import { getSessionsState, getTargets } from '../api'
import type { Place, SessionRow, SessionState, SessionsStateResponse, TargetsResponse } from '../api/types'
import { loadStates, loadTargets, peekStates, peekTargets, saveStates, saveTargets } from '../lib/snapshots'
import { confirmTitles } from '../lib/titles'
import { confirmFlags } from '../lib/sessionFlags'
import { usePoll } from './usePoll'
import { noteStates } from '../lib/arrivals'

/**
 * Rows seen in /targets, so a thread page has a heading (and knows whether
 * the session is live) before it asks anything — the page itself asks only
 * for the log (§10).
 */
const known = new Map<string, SessionRow>()
export function knownTitle(session: string): string {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.title || ''
}
/** Live per the last /targets seen; undefined when the list never showed it. */
export function knownLive(session: string): boolean | undefined {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.live
}

/** The project per the last /targets seen (§6.1), or null. */
export function knownProject(session: string): string | null {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.project || null
}

/** Archived per the last /targets seen (the server's flag, before any change made here). */
export function knownArchived(session: string): boolean | undefined {
  return (known.get(session) || peekTargets()?.sessions.find((r) => r.session === session))?.archived
}

/** An exit or archive the server accepted (or its rollback), for the rows seen in this page load. */
export function noteRow(session: string, patch: Partial<SessionRow>) {
  const row = known.get(session)
  if (row) known.set(session, { ...row, ...patch })
}

/** A rename the server accepted, for the next page that asks knownTitle. */
export function noteRenamed(session: string, title: string) {
  const row = known.get(session)
  if (row) known.set(session, { ...row, title })
}

function rowsOf(res: TargetsResponse): SessionRow[] {
  for (const row of res.sessions) known.set(row.session, row)
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
      confirmTitles(res.sessions)
      confirmFlags(res.sessions)
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
        const map = stateMap(res)
        // A turn ending elsewhere: a notice and an unread dot, nothing more.
        noteStates(map, knownTitle)
        setStates(map)
      } catch {
        // Keep the last map; the list's own error line says what is wrong.
      }
    },
    () => 5000,
    enabled
  )
  return states
}
