import { useCallback, useEffect, useState } from 'react'
import { ApiError, getSessionConversation, getSessionsState, getTargets } from '../api'
import type { Place, SessionConversation, SessionRow, SessionState } from '../api/types'
import { usePoll } from './usePoll'

/** Titles seen in /targets, so a thread page has a heading before it asks. */
const titles = new Map<string, string>()
export function knownTitle(session: string): string {
  return titles.get(session) || ''
}

/** GET /targets — on open, and on demand (§6.1: "on open"). */
export function useTargets() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTargets()
      for (const row of res.sessions) titles.set(row.session, row.title)
      // Live first (the server already orders them so; kept explicit).
      const rows = [...res.sessions].sort((a, b) => Number(b.live) - Number(a.live))
      setSessions(rows)
      setPlaces(res.places || [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { sessions, places, error, loading, reload: load }
}

/** GET /sessions/state, polled every 5 s (§6.1). Absent = not live. */
export function useSessionStates(enabled = true) {
  const [states, setStates] = useState<Record<string, SessionState>>({})
  usePoll(
    async () => {
      try {
        const res = await getSessionsState()
        const next: Record<string, SessionState> = {}
        for (const row of res.sessions || []) next[row.session] = row.state
        setStates(next)
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
 */
export function useThreadInfo(session: string) {
  const [info, setInfo] = useState<SessionConversation | null>(null)
  const [error, setError] = useState('')
  const [startedAt] = useState(() => Date.now())

  const waiting = !info || !info.item || info.scanning
  usePoll(
    async () => {
      try {
        const res = await getSessionConversation(session)
        setInfo(res)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        if (err instanceof ApiError && err.status === 400) setInfo(null)
      }
    },
    () => ITEM_POLL_MS,
    !!session && waiting && Date.now() - startedAt < ITEM_WAIT_MS,
    [session]
  )

  // A usable item: present and not scanning (§6.2).
  const item = info && info.item && !info.scanning ? info.item : null
  return { info, item, error }
}
