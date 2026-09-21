/**
 * One thread's transcript, kept up to date by polling GET /conversation/log.
 *
 * v0 has no stream (§11 is v1), so this is the §6.2 adaptive poll, by
 * setTimeout: 1 s while a line is live (the bold has to keep up with the
 * voice) or just after anything changed, 2 s while a turn is `working` or an
 * `approval` is on screen, 15 s idle. The behaviour and the reasons for each
 * number come from Sasonica's ConversationLog.vue.
 *
 * When §11 lands, the stream's `snapshot` replaces `apply(res)` wholesale and
 * `line` / `live` / `working` / `approval` / `suggestion` events patch the
 * same state; this poll stays as the fallback.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { getConversationLog } from '../api'
import type { Approval, ConversationLog, Line, Working } from '../api/types'
import { liveClockOf, type LiveClock } from '../lib/followAlong'
import { usePoll } from './usePoll'

const POLL_IDLE_MS = 15000
const POLL_FAST_MS = 1000
const POLL_WORKING_MS = 2000
/** Keep the fast cadence this long after the transcript last changed. */
const FAST_LINGER_MS = 20 * 1000
/** Ceiling on the fast cadence while merely waiting for an answer. */
const FAST_WINDOW_MS = 3 * 60 * 1000
/** How long an ended live line is held while the server catches up. */
const ENDED_LIVE_HOLD_MS = 30 * 1000
/** How long an optimistic "you" line waits for its real one. */
const OPTIMISTIC_HOLD_MS = 60 * 1000

export interface LogState {
  lines: Line[]
  pending: boolean
  working: Working | null
  /** Local ms when `working` was read, to run its timer between polls. */
  workingAt: number
  approval: Approval | null
  suggestion: string
  live: LiveClock | null
  error: string
  loaded: boolean
}

const EMPTY: LogState = {
  lines: [],
  pending: false,
  working: null,
  workingAt: 0,
  approval: null,
  suggestion: '',
  live: null,
  error: '',
  loaded: false
}

export function useConversationLog(item: string | null) {
  const [state, setState] = useState<LogState>(EMPTY)
  // Sent from here and not yet back as a "you" line.
  const [optimistic, setOptimistic] = useState<{ text: string; at: number }[]>([])
  const [awaiting, setAwaiting] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const awaitingRef = useRef(awaiting)
  awaitingRef.current = awaiting
  const sigRef = useRef('')
  const changedAtRef = useRef(0)
  const endedLiveRef = useRef<{ line: Line; until: number } | null>(null)

  /**
   * A reply stops being live a beat before it lands in history; a poll in
   * between gets the conversation without it and the page shrinks by a whole
   * reply. Hold the ended line until the same `at` comes back (or 30 s).
   * (ConversationLog.vue `carryEndedLive`.)
   */
  const carryEndedLive = useCallback((lines: Line[]): Line[] => {
    const wasLive = stateRef.current.lines.find((l) => l.live)
    if (wasLive && !lines.some((l) => l.at === wasLive.at)) {
      endedLiveRef.current = { line: { ...wasLive, live: false }, until: Date.now() + ENDED_LIVE_HOLD_MS }
    }
    const held = endedLiveRef.current
    if (!held) return lines
    if (lines.some((l) => l.at === held.line.at) || Date.now() > held.until) {
      endedLiveRef.current = null
      return lines
    }
    return [...lines, held.line]
  }, [])

  const apply = useCallback(
    (res: ConversationLog, askedAt: number) => {
      const now = Date.now()
      const lines = carryEndedLive(res.lines || [])
      const last = lines[lines.length - 1]
      if (last && last.who !== 'you') setAwaiting(false)

      // A cheap signature of what is on screen; any change re-arms the fast
      // cadence, whoever caused it.
      const sig =
        lines.length +
        '|' +
        (last ? `${last.who}:${last.text}#${last.live ? last.sentence : ''}` : '') +
        '|' +
        (res.approval ? res.approval.key : '') +
        '|' +
        (res.working ? res.working.count : '')
      if (sig !== sigRef.current) {
        sigRef.current = sig
        changedAtRef.current = now
      }

      // Drop optimistic lines once a "you" line with the same words is back.
      setOptimistic((opt) =>
        opt.filter((o) => now - o.at * 1000 < OPTIMISTIC_HOLD_MS && !lines.some((l) => l.who === 'you' && l.at >= o.at - 5 && l.text.trim() === o.text.trim()))
      )

      const liveLine = lines.find((l) => l.live)
      setState({
        lines,
        pending: !!res.pending,
        working: res.working || null,
        workingAt: now,
        approval: res.approval || null,
        suggestion: res.pending ? '' : res.suggestion || '',
        live: liveLine ? liveClockOf(liveLine, now, now - askedAt) : null,
        error: '',
        loaded: true
      })
    },
    [carryEndedLive]
  )

  const fetchOnce = useCallback(async () => {
    if (!item) return
    const askedAt = Date.now()
    try {
      apply(await getConversationLog(item), askedAt)
    } catch (err) {
      // Keep the lines: blanking a transcript over a blinked network is
      // worse than showing one a few seconds old.
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loaded: true }))
    }
  }, [item, apply])

  const nextDelay = useCallback(() => {
    const s = stateRef.current
    if (s.live) return POLL_FAST_MS
    if (s.working || s.approval) return POLL_WORKING_MS
    const since = Date.now() - changedAtRef.current
    if (since < FAST_LINGER_MS) return POLL_FAST_MS
    if ((awaitingRef.current || s.pending) && since < FAST_WINDOW_MS) return POLL_FAST_MS
    return POLL_IDLE_MS
  }, [])

  const kick = usePoll(fetchOnce, nextDelay, !!item, [item])

  /** A reply was accepted: show it at once and poll fast until it lands. */
  const sent = useCallback(
    (text: string) => {
      setOptimistic((o) => [...o, { text, at: Date.now() / 1000 }])
      setAwaiting(true)
      changedAtRef.current = Date.now()
      kick()
    },
    [kick]
  )

  /**
   * Re-render from the answer's `approval` (the next dialog, or a 409's
   * current one) without waiting for the next poll. Not followed by a poll:
   * the answer is the newer reading, and the 2 s cadence confirms it.
   */
  const setApproval = useCallback((approval: Approval | null) => {
    changedAtRef.current = Date.now()
    setState((s) => ({ ...s, approval }))
  }, [])

  const isRunning = state.pending || awaiting || !!state.working
  return useMemo(
    () => ({ ...state, optimistic, isRunning, sent, setApproval, refresh: kick }),
    [state, optimistic, isRunning, sent, setApproval, kick]
  )
}
