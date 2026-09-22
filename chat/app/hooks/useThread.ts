/**
 * One thread, kept up to date by its stream: `GET /threads/{session}/events`
 * (server-contract.md §11), with the polled log as the fallback.
 *
 * Why the stream (David, 22 Sep 2026: "turns reach the terminal much sooner
 * than the app"): the poll read speech history, which had a reply only once
 * it was queued and rendered for speech. The stream is read off the agent's
 * transcript — the file the terminal draws from — and the server measured
 * a transcript append reaching the event at 0.33 s median. It also carries
 * what the lines never had: the reasoning and every tool step (§6.2.2).
 *
 * The stream:
 *  - fetch-streamed with the Authorization header (api openThreadStream);
 *  - the first frame on every connection is a `snapshot`, which REPLACES the
 *    thread (keeping older pages loaded by hand above it, lib/messages.ts
 *    mergeSnapshot) — so a reconnect can never duplicate a message;
 *  - `message` events are applied by id, `live` moves the follow-along
 *    clock (sparse: on a new sentence, pause, skip — the clock runs locally
 *    between), and `working` / `approval` / `suggestion` / `state` / `recap`
 *    replace their part of the state;
 *  - a heartbeat watchdog: the server pings after 15 s of silence, so
 *    nothing at all for WATCHDOG_MS means a dead connection — abort it and
 *    reconnect;
 *  - reconnect with backoff (1 s doubling to 30 s); a connection that dies
 *    before its snapshot, or within SHORT_LIVED_MS of opening, counts as a
 *    failure. After FALLBACK_AFTER failures in a row the thread falls back
 *    to polling `/conversation/log?session=&messages=1` (the §6.2 adaptive
 *    cadence), and tries the stream again every STREAM_RETRY_MS; the first
 *    snapshot stops the polling;
 *  - closed while the page is hidden (a backgrounded phone holds a canvas
 *    handler thread for nothing), reopened when it shows: its snapshot is
 *    the catch-up.
 *
 * Stale-while-revalidate: the thread opens on its last saved messages
 * (lib/snapshots.ts), marked `stale`, and the first snapshot replaces them.
 * Messages keep their ids, so the swap updates them in place rather than
 * remounting them. Saves are coalesced (SAVE_EVERY_MS).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getConversationLog, getEarlier, openThreadStream } from '../api'
import type { AgentCounts, Approval, ConversationLog, LiveEvent, Message, Recap, ThreadEvent, ThreadState, Working } from '../api/types'
import { liveClockFrom, withGrowth, type LiveClock } from '../lib/followAlong'
import { applyMessage, liveFields, liveOf, mergeSnapshot, signature } from '../lib/messages'
import { saidOf, unmatched, type PendingSend } from '../lib/pending'
import { loadThread, peekThread, saveThreadMessages } from '../lib/snapshots'
import { usePoll } from './usePoll'

/** No bytes at all for this long (pings come every 15 s): the connection is dead. */
const WATCHDOG_MS = 45 * 1000
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30 * 1000
/** A connection shorter than this counts as a failure even with a snapshot (a flapping proxy). */
const SHORT_LIVED_MS = 5000
/** Failed connections in a row before polling takes over. */
const FALLBACK_AFTER = 3
/** While polling, try the stream again this often. */
const STREAM_RETRY_MS = 30 * 1000
/** Coalesce cache writes: a running turn sends a message event a second. */
const SAVE_EVERY_MS = 2000

// The fallback poll's cadence (§6.2), as before the stream.
const POLL_IDLE_MS = 15000
const POLL_FAST_MS = 1000
const POLL_WORKING_MS = 2000
const POLL_MISSING_MS = 3000
const FAST_LINGER_MS = 20 * 1000
const FAST_WINDOW_MS = 3 * 60 * 1000

export type Transport = 'connecting' | 'stream' | 'poll'

export interface ThreadView {
  messages: Message[]
  /** Messages exist before `messages[0]` (Load earlier). */
  older: boolean
  /** The polled log's `pending` (the stream's is derived; see isRunning). */
  pending: boolean
  /** From the snapshot / `state` events; null until known (and while polling). */
  state: ThreadState | null
  /** The session has a pane, per the stream; null until known. */
  sessionLive: boolean | null
  working: Working | null
  /** Local ms when `working` was read, to run its timer between events. */
  workingAt: number
  approval: Approval | null
  suggestion: string
  recap: Recap | null
  /** Background agents (§6.12): from the snapshot and `agents` events; null until known. */
  agents: AgentCounts | null
  /** The thread's project (§6.1), from the snapshot; null when not known. */
  project: string | null
  /** The follow-along clock of the message being spoken here, and its id. */
  live: LiveClock | null
  liveId: string | null
  error: string
  loaded: boolean
  /** 404: nothing at all is known about this session yet; keeps asking. */
  missing: boolean
  /** The messages are the saved snapshot, not yet confirmed by the server. */
  stale: boolean
  transport: Transport
}

const EMPTY: ThreadView = {
  messages: [],
  older: false,
  pending: false,
  state: null,
  sessionLive: null,
  working: null,
  workingAt: 0,
  approval: null,
  suggestion: '',
  recap: null,
  agents: null,
  project: null,
  live: null,
  liveId: null,
  error: '',
  loaded: false,
  missing: false,
  stale: false,
  transport: 'connecting'
}

function fromCache(messages: Message[], older: boolean): ThreadView {
  return { ...EMPTY, messages, older, loaded: true, stale: true }
}

function clockOf(ev: LiveEvent, receivedAt: number, rtt: number): { live: LiveClock | null; liveId: string | null } {
  if (!ev) return { live: null, liveId: null }
  const live = liveClockFrom(liveFields(ev), receivedAt, rtt)
  return { live, liveId: live ? ev.id : null }
}

/**
 * Keyed by `session`. Mount one per thread (the page keys it by session).
 */
export function useThread(session: string) {
  const [view, setView] = useState<ThreadView>(() => {
    const snap = peekThread(session)
    return snap?.messages.length ? fromCache(snap.messages, snap.older) : EMPTY
  })
  // Sent from here and not yet back as a user message (lib/pending.ts).
  const [sends, setSends] = useState<PendingSend[]>([])
  const [awaiting, setAwaiting] = useState(false)
  const [earlier, setEarlier] = useState<{ loading: boolean; error: string }>({ loading: false, error: '' })

  const viewRef = useRef(view)
  viewRef.current = view
  const awaitingRef = useRef(awaiting)
  awaitingRef.current = awaiting
  /** A fresh answer has been applied; the disk snapshot must not overwrite it. */
  const freshRef = useRef(false)
  const rttRef = useRef(400)
  const sigRef = useRef('')
  const changedAtRef = useRef(0)
  const [transport, setTransport] = useState<Transport>('connecting')
  const transportRef = useRef(transport)
  transportRef.current = transport

  // Disk hit (a cold start of the app): paint as soon as IndexedDB answers,
  // unless the network beat it.
  useEffect(() => {
    let cancelled = false
    if (viewRef.current.loaded) return
    void loadThread(session).then((snap) => {
      if (cancelled || freshRef.current || !snap?.messages.length) return
      setView((v) => (v.loaded ? v : fromCache(snap.messages, snap.older)))
    })
    return () => {
      cancelled = true
    }
  }, [session])

  // ── The cache, coalesced ────────────────────────────────────────────────
  const saveTimerRef = useRef<number | null>(null)
  const saveSoon = useCallback(() => {
    if (saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const v = viewRef.current
      if (!v.stale && v.messages.length) saveThreadMessages(session, v.messages, v.older)
    }, SAVE_EVERY_MS)
  }, [session])
  useEffect(
    () => () => {
      if (saveTimerRef.current === null) return
      window.clearTimeout(saveTimerRef.current)
      const v = viewRef.current
      if (!v.stale && v.messages.length) saveThreadMessages(session, v.messages, v.older)
    },
    [session]
  )

  // Every change of the messages: the poll's fast cadence re-arms, sends
  // whose own message is back retire (lib/pending.ts: no clocks), and the
  // cache is written (coalesced).
  useEffect(() => {
    if (view.stale) return
    const sig = signature(view.messages)
    if (sig !== sigRef.current) {
      sigRef.current = sig
      changedAtRef.current = Date.now()
    }
    setSends((cur) => unmatched(cur, saidOf(view.messages)))
    saveSoon()
  }, [view.messages, view.stale, saveSoon])

  /** A whole thread: a snapshot, or a poll of the log. Replaces the state. */
  const applyWhole = useCallback(
    (res: Omit<ConversationLog, 'ok'> & { state?: ThreadState; live?: boolean; agents?: AgentCounts; project?: string | null }, receivedAt: number, rtt: number, fromStream: boolean) => {
      freshRef.current = true
      const snapMessages = res.messages || []
      setView((v) => {
        const held = v.stale ? [] : v.messages
        const { messages, older } = mergeSnapshot(held, v.older, snapMessages, !!res.older)
        return {
          ...v,
          messages,
          older,
          pending: !!res.pending,
          state: fromStream ? res.state || null : v.state,
          sessionLive: fromStream ? !!res.live : v.sessionLive,
          working: res.working || null,
          workingAt: receivedAt,
          approval: res.approval || null,
          suggestion: res.suggestion || '',
          recap: res.recap ?? null,
          agents: fromStream ? res.agents ?? null : v.agents,
          project: res.project !== undefined ? res.project ?? null : v.project,
          ...clockOf(liveOf(snapMessages), receivedAt, rtt),
          error: '',
          loaded: true,
          missing: false,
          stale: false
        }
      })
    },
    []
  )

  const onEvent = useCallback(
    (ev: ThreadEvent) => {
      const now = Date.now()
      switch (ev.type) {
        case 'snapshot':
          applyWhole(ev.data, now, rttRef.current, true)
          return
        case 'message': {
          const m = ev.data?.message
          if (!m?.id) return
          setView((v) => {
            const grown = v.live && v.liveId === m.id && m.spoken?.live ? withGrowth(v.live, m.spoken.live) : v.live
            return { ...v, messages: applyMessage(v.messages, ev.data.op, m), live: grown }
          })
          return
        }
        case 'live':
          setView((v) => ({ ...v, ...clockOf(ev.data, now, rttRef.current) }))
          return
        case 'working':
          setView((v) => ({ ...v, working: ev.data || null, workingAt: now }))
          changedAtRef.current = now
          return
        case 'approval':
          setView((v) => ({ ...v, approval: ev.data || null }))
          changedAtRef.current = now
          return
        case 'suggestion':
          setView((v) => ({ ...v, suggestion: ev.data?.text || '' }))
          return
        case 'state':
          setView((v) => ({ ...v, state: ev.data?.state || null, sessionLive: !!ev.data?.live }))
          return
        case 'recap':
          setView((v) => ({ ...v, recap: ev.data || null }))
          return
        case 'agents':
          setView((v) => ({ ...v, agents: ev.data || null }))
          return
        default:
          return
      }
    },
    [applyWhole]
  )

  // ── The stream ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    let stopped = false
    let ctl: AbortController | null = null
    let retry: number | null = null
    let watchdog: number | null = null
    let failures = 0

    const clearTimers = () => {
      if (retry !== null) window.clearTimeout(retry)
      if (watchdog !== null) window.clearTimeout(watchdog)
      retry = watchdog = null
    }
    const schedule = (ms: number) => {
      if (retry !== null) window.clearTimeout(retry)
      retry = window.setTimeout(() => {
        retry = null
        void connect()
      }, ms)
    }
    const connect = async () => {
      if (stopped || document.hidden || ctl) return
      const mine = (ctl = new AbortController())
      const armWatchdog = () => {
        if (watchdog !== null) window.clearTimeout(watchdog)
        watchdog = window.setTimeout(() => mine.abort(), WATCHDOG_MS)
      }
      armWatchdog()
      let snapshotAt = 0
      try {
        await openThreadStream(
          session,
          {
            onOpen: (rtt) => (rttRef.current = rtt),
            onBytes: armWatchdog,
            onEvent: (ev) => {
              if (ev.type === 'snapshot') {
                snapshotAt = Date.now()
                setTransport('stream')
              }
              onEvent(ev)
            }
          },
          mine.signal
        )
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setView((v) => ({ ...v, error: '', loaded: true, missing: true }))
        } else if (err instanceof ApiError && err.status === 401) {
          setView((v) => ({ ...v, error: err.message, loaded: true }))
        }
      } finally {
        if (watchdog !== null) window.clearTimeout(watchdog)
        watchdog = null
        if (ctl === mine) ctl = null
      }
      if (stopped || document.hidden) return
      const lasted = snapshotAt ? Date.now() - snapshotAt : 0
      failures = snapshotAt && lasted >= SHORT_LIVED_MS ? 0 : failures + 1
      if (failures >= FALLBACK_AFTER) {
        setTransport('poll')
        schedule(STREAM_RETRY_MS)
        return
      }
      const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** failures)
      schedule(base / 2 + Math.random() * (base / 2))
    }
    const onVisibility = () => {
      if (document.hidden) {
        clearTimers()
        ctl?.abort()
        ctl = null
      } else {
        void connect()
      }
    }
    void connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimers()
      ctl?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [session, onEvent])

  // ── The fallback poll ───────────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    if (!session || transportRef.current !== 'poll') return
    const askedAt = Date.now()
    try {
      const res = await getConversationLog(session)
      if (transportRef.current !== 'poll') return // the stream came back meanwhile
      const now = Date.now()
      applyWhole(res, now, now - askedAt, false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setView((v) => ({ ...v, error: '', loaded: true, missing: true }))
        return
      }
      // Keep the messages: blanking a thread over a blinked network is worse
      // than showing one a few seconds old.
      setView((v) => ({ ...v, error: err instanceof Error ? err.message : String(err), loaded: true }))
    }
  }, [session, applyWhole])

  const nextDelay = useCallback(() => {
    const v = viewRef.current
    if (v.missing) return POLL_MISSING_MS
    if (v.live) return POLL_FAST_MS
    if (v.working || v.approval) return POLL_WORKING_MS
    const since = Date.now() - changedAtRef.current
    if (since < FAST_LINGER_MS) return POLL_FAST_MS
    if ((awaitingRef.current || v.pending) && since < FAST_WINDOW_MS) return POLL_FAST_MS
    return POLL_IDLE_MS
  }, [])

  const kick = usePoll(pollOnce, nextDelay, !!session && transport === 'poll', [session])
  /** Re-read now: the poll's kick while polling; the stream needs none. */
  const refresh = useCallback(() => {
    if (transportRef.current === 'poll') kick()
  }, [kick])

  // ── Older pages ─────────────────────────────────────────────────────────
  const earlierRef = useRef(false)
  const loadEarlier = useCallback(async (): Promise<boolean> => {
    const v = viewRef.current
    const first = v.messages[0]
    if (earlierRef.current || !v.older || !first || v.stale) return false
    earlierRef.current = true
    setEarlier({ loading: true, error: '' })
    try {
      const res = await getEarlier(session, first.id)
      const got = res.messages || []
      setView((cur) => {
        // Prepend what is not held already, before whatever is first now.
        const have = new Set(cur.messages.map((m) => m.id))
        const add = got.filter((m) => !have.has(m.id))
        return { ...cur, messages: [...add, ...cur.messages], older: !!res.older && add.length > 0 }
      })
      setEarlier({ loading: false, error: '' })
      return got.length > 0
    } catch (err) {
      setEarlier({ loading: false, error: err instanceof Error ? err.message : String(err) })
      return false
    } finally {
      earlierRef.current = false
    }
  }, [session])

  // ── Sending ─────────────────────────────────────────────────────────────
  const seqRef = useRef(0)
  const sending = useCallback(
    (text: string): string => {
      const id = `${Date.now()}-${++seqRef.current}`
      const before = viewRef.current.messages.filter((m) => m.role === 'user').map((m) => m.at)
      setSends((cur) => [...cur, { id, text, at: Date.now() / 1000, before, state: 'sending' }])
      setAwaiting(true)
      changedAtRef.current = Date.now()
      refresh()
      return id
    },
    [refresh]
  )
  const sent = useCallback(
    (id: string) => {
      setSends((cur) => cur.map((s) => (s.id === id && s.state === 'sending' ? { ...s, state: 'sent' } : s)))
      changedAtRef.current = Date.now()
      refresh()
    },
    [refresh]
  )
  const failed = useCallback((id: string, error: string, untaken = false) => {
    setSends((cur) => cur.map((s) => (s.id === id ? { ...s, state: untaken ? 'untaken' : 'failed', error } : s)))
    setAwaiting(false)
  }, [])
  const discard = useCallback((id: string) => {
    setSends((cur) => cur.filter((s) => s.id !== id))
  }, [])

  /** Re-render from an answer's `approval` without waiting for the stream. */
  const setApproval = useCallback((approval: Approval | null) => {
    changedAtRef.current = Date.now()
    setView((v) => ({ ...v, approval }))
  }, [])

  // isRunning (§11): state == "working", or the last message's
  // turn.running, or `working`; plus, from the poll, `pending`. The stream
  // has no pending event, so there it is derived as the poll's was: a live
  // session whose last message is the listener's. And a send not answered.
  const last = view.messages[view.messages.length - 1]
  const derivedPending = transport === 'poll' || view.state === null ? view.pending : view.sessionLive !== false && !view.stale && last?.role === 'user'
  const isRunning = view.state === 'working' || !!view.working || !!(!view.stale && last?.turn?.running) || derivedPending || awaiting

  const optimistic = useMemo(() => unmatched(sends, saidOf(view.messages)), [sends, view.messages])
  // "A send not answered" ends once our message is back and the agent has
  // spoken after it (or the send failed).
  useEffect(() => {
    if (!awaiting) return
    const out = optimistic.some((s) => s.state === 'sending' || s.state === 'sent')
    if (!out && last?.role === 'assistant') setAwaiting(false)
  }, [awaiting, optimistic, last])
  return useMemo(
    () => ({
      ...view,
      transport,
      optimistic,
      isRunning,
      earlier,
      loadEarlier,
      sending,
      sent,
      failed,
      discard,
      setApproval,
      refresh
    }),
    [view, transport, optimistic, isRunning, earlier, loadEarlier, sending, sent, failed, discard, setApproval, refresh]
  )
}
