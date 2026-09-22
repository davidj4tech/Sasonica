/**
 * One thread. The session comes from the URL, and it is all the page needs:
 * the thread is its stream, `/threads/{session}/events` (§11) — ONE request
 * to open a thread, shelved or not, whose first frame is the whole thread —
 * with the polled log as the fallback (hooks/useThread.ts), and replies go
 * to /reply {session}. A thread that is not on the shelf yet is as readable
 * and repliable as any other.
 *
 * A thread opened before paints from its saved messages at once
 * (lib/snapshots.ts), with "updating…" in the header until the first
 * snapshot — never a spinner over content.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { answer, ApiError, reply, stopSession } from '../api'
import type { Approval } from '../api/types'
import { SpeechBar } from '../components/SpeechBar'
import { Thread } from '../components/Thread'
import { useThread } from '../hooks/useThread'
import { useSpeech } from '../hooks/useSpeech'
import { knownLive, knownTitle, useSessionStates } from '../hooks/useThreads'
import { useRename } from '../hooks/useRename'
import { RenameSheet } from '../components/RenameSheet'
import { useTitle } from '../lib/titles'
import { loadTargets } from '../lib/snapshots'
import { buildItems } from '../lib/convert'
import { draftSent } from '../lib/drafts'
import { markSeen, setOpenSession } from '../lib/arrivals'
import { withPaused, withSkew, type LiveClock } from '../lib/followAlong'
import type { SpeechNow } from '../api/types'

type Status = { text: string; failed?: boolean } | null

/**
 * Keyed by session: moving from one thread to another (same route) starts
 * every hook afresh — snapshot, poll, the bottom-first window in Thread —
 * rather than showing one thread's state under another's title.
 */
export default function ThreadRoute() {
  const { session = '' } = useParams()
  return <ThreadPage key={session} session={session} />
}

function ThreadPage({ session }: { session: string }) {
  const location = useLocation()
  // Where the title comes from: the list that linked here, the list seen in
  // this page load, else the saved list (a cold start straight into a thread).
  const [savedTitle, setSavedTitle] = useState('')
  const serverTitle = (location.state as { title?: string } | null)?.title || knownTitle(session) || savedTitle
  useEffect(() => {
    if (serverTitle) return
    let cancelled = false
    void loadTargets().then((res) => {
      const row = res?.sessions.find((r) => r.session === session)
      if (!cancelled && row?.title) setSavedTitle(row.title)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])
  const title = useTitle(session, serverTitle) || session.slice(0, 8)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const rename = useRename()

  const log = useThread(session)
  useSeen(session, log.messages.length)
  const states = useSessionStates()
  const [status, setStatus] = useState<Status>(null)

  // The bar and the live line agree: a pause pressed (on the bar or the
  // message) stops the bold at once, before the log's next poll confirms
  // it; and any key re-reads the log straight after, so a skip moves the
  // bold as soon as the server has moved.
  const speech = useSpeech()
  const { refresh } = log
  useEffect(() => speech.onSettled(refresh), [speech.onSettled, refresh])
  const speakingHere = speech.now?.live && (speech.now.session === session || !speech.now.session)
  // The press is held past the bar's own confirmation until the log has
  // answered once more, so the bold does not step back for a beat between
  // the two polls.
  const heldRef = useRef<{ press: { paused: boolean; at: number }; seen?: LiveClock | null } | null>(null)
  const barPress = speakingHere ? speech.pausePress : null
  if (barPress) heldRef.current = { press: barPress }
  else if (heldRef.current) {
    if (!('seen' in heldRef.current)) heldRef.current.seen = log.live
    else if (heldRef.current.seen !== log.live) heldRef.current = null
  }
  const press = barPress || heldRef.current?.press || null
  const skew = useElapsedSkew(session, log.live, speech.now, speech.nowAskedAt)
  const live = useMemo(() => {
    const clock = log.live && press ? withPaused(log.live, press.paused, press.at) : log.live
    return clock ? withSkew(clock, skew) : clock
  }, [log.live, press, skew])

  const items = useMemo(
    () => buildItems({ session, messages: log.messages, approval: log.approval, live, liveId: log.liveId, optimistic: log.optimistic }),
    [session, log.messages, log.approval, live, log.liveId, log.optimistic]
  )

  // The message shows at once ("sending…") and is replaced by the server's
  // own line when that comes back (lib/pending.ts). A refusal keeps the
  // words in the bubble with Retry; nothing is thrown, so the box empties,
  // but the draft keeps them too (a reload loses the bubble) until a send
  // of them succeeds or they are discarded.
  const { sending, sent, failed, discard: discardSend } = log
  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      const id = sending(text)
      setStatus(null)
      try {
        const res = await reply(session, text)
        sent(id)
        draftSent(session, text)
        // A revived session reads the reply once it has loaded, which can
        // take a minute — "sent" there would be a small lie (§6.3).
        if (res.opened) setStatus({ text: 'Session reopened — it will pick this up shortly.' })
      } catch (err) {
        // 502 with submitted:false: the words are in the pane's box but
        // were never taken — a retry would type them twice.
        if (err instanceof ApiError && err.payload.submitted === false) {
          failed(id, `Typed into ${err.payload.pane || 'the session'} but not taken — press Enter at the desk.`, true)
          return false
        }
        failed(id, err instanceof Error ? err.message : String(err))
        return false
      }
      return true
    },
    [session, sending, sent, failed]
  )

  const onStop = useCallback(
    (speech: 'auto' | 'silence') => {
      stopSession({ session, speech }).catch((err) => setStatus({ text: err.message, failed: true }))
    },
    [session]
  )

  const optimisticRef = useRef(log.optimistic)
  optimisticRef.current = log.optimistic
  const discard = useCallback(
    (id: string) => {
      const send = optimisticRef.current.find((s) => s.id === id)
      discardSend(id)
      // Thrown away on purpose: not a draft any more either.
      if (send) draftSent(session, send.text)
    },
    [session, discardSend]
  )
  const actions = useMemo(
    () => ({
      retry: (id: string) => {
        const send = optimisticRef.current.find((s) => s.id === id)
        if (!send) return
        discardSend(id)
        void onSend(send.text)
      },
      discard,
      answer: async (approval: Approval, choice: number) => {
        const res = await answer({ session, choice, key: approval.key })
        if (res.ok) {
          log.setApproval(res.res.approval)
          return { error: '', key: '' }
        }
        // 409 question_changed: re-render from the returned approval and let
        // the person choose again.
        if (res.changed) {
          log.setApproval(res.approval)
          return { error: 'The question changed — choose again.', key: res.approval?.key || '' }
        }
        return { error: res.error, key: approval.key }
      }
    }),
    [session, log, discard, discardSend, onSend]
  )

  // Live: the stream says so (its snapshot and `state` events), else
  // /sessions/state lists it (polled), else the list said so, else a live
  // follow-along in the thread itself. `closed` only when we know.
  const state = (log.state && log.state !== 'ended' ? log.state : null) || states[session]
  const listLive = knownLive(session)
  const sessionLive = log.sessionLive ?? (!!state || listLive === true || !!log.live)
  const closed = !sessionLive && (log.sessionLive === false || listLive === false)

  let empty: React.ReactNode = null
  if (log.messages.length) {
    // A snapshot or the thread is on screen.
  } else if (log.error) {
    empty = <p className="empty error">{log.error}</p>
  } else if (!log.loaded) {
    empty = <p className="empty delayed">Loading…</p>
  } else if (log.missing) {
    empty = <p className="empty">Nothing from this session yet — this page keeps checking.</p>
  } else {
    empty = <p className="empty">No messages yet.</p>
  }

  return (
    <div className="page thread-page">
      <header className="bar">
        <Link className="icon" to="/" title="Threads">
          ←
        </Link>
        <h1 className="grow">
          <button className="title-button" onClick={() => setRenaming(true)} title="Rename">
            {title}
          </button>
        </h1>
        {log.stale && <span className="updating">updating…</span>}
        {!log.stale && log.transport === 'poll' && (
          <span className="updating" title="The live stream is not reachable; checking every few seconds instead">
            polling
          </span>
        )}
        {(state || sessionLive || closed) && <span className={`badge ${state || ''}`}>{state || (sessionLive ? 'live' : 'ended')}</span>}
        <div className="menu-anchor">
          <button className="icon" aria-label="Thread menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ⋮
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  setRenaming(true)
                }}
              >
                Rename…
              </button>
            </div>
          )}
        </div>
      </header>
      {renaming && (
        <RenameSheet
          title={title}
          onClose={() => setRenaming(false)}
          onSave={(name) => {
            setRenaming(false)
            setStatus({ text: 'Renaming…' })
            void rename(session, name).then((r) => setStatus({ text: r.message, failed: !r.ok }))
          }}
        />
      )}
      <Thread
        items={items}
        isRunning={log.isRunning}
        working={log.working}
        workingAt={log.workingAt}
        thinking={log.isRunning}
        suggestion={log.suggestion}
        onSend={onSend}
        onStop={onStop}
        actions={actions}
        draftKey={session}
        empty={empty}
        older={log.older && !log.stale}
        onLoadEarlier={log.loadEarlier}
        earlierLoading={log.earlier.loading}
        earlierError={log.earlier.error}
        placeholder={closed ? 'Session closed. Sending resumes it' : undefined}
        speechBar={<SpeechBar here={session} />}
        status={
          (status || (log.error && log.messages.length > 0)) && (
            <p className={status?.failed || !status ? 'status failed' : 'status'}>{status ? status.text : log.error}</p>
          )
        }
      />
    </div>
  )
}

/** Below this, the log's clock and the player agree well enough (pos is whole seconds). */
const SKEW_MIN_S = 0.5
/** The lower envelope is taken over this many /speech/now answers (~12 s). */
const SKEW_SAMPLES = 8
/** E[min of 8 uniform fractions of a second]: what the envelope still over-reads. */
const SKEW_FLOOR_BIAS_S = 0.1

/**
 * How far the log's live `elapsed` runs ahead of what the player is at.
 *
 * MEASURED (red5, 22 Sep 2026, speech on the phone, one clock): `elapsed`
 * is wall time since the reply started, and the stalls between streamed
 * clips are not taken off, so it runs ahead of the player — by ~1.4 s on
 * two replies and 2.3 s on a third, drifting up within a reply as stalls
 * add up. `delay` said 0.
 *
 * `pos` (/speech/now) is the player's own position, but whole seconds, and
 * STALE: it is the canvas's ~1 Hz speech snapshot, and /speech/now itself
 * took 1.4–3.3 s to answer. The first version of this compared `elapsed` at
 * the answer's ARRIVAL with pos + 0.5 and took the median, which counted the
 * staleness as lead: it held the bold back 2.9–3.8 s against a true 1.4–2.3
 * — the bold trailed the voice by ~1.5–1.9 s ("a little bit behind").
 *
 * Now: d = elapsed at the moment the /speech/now request was SENT − pos.
 * Staleness and the fraction of a second pos drops can only make d larger
 * than the true lead, never smaller, so the lower envelope (the minimum of
 * the last SKEW_SAMPLES) is the estimate, less its small expected
 * over-read. Not playing, another thread, no `pos`: 0.
 */
function useElapsedSkew(session: string, clock: LiveClock | null, now: SpeechNow | null, askedAt: number): number {
  const [skew, setSkew] = useState(0)
  const samplesRef = useRef<number[]>([])
  const clockRef = useRef(clock)
  clockRef.current = clock
  const sentences = clock?.sentences[0] || ''
  // A new reply starts afresh.
  useEffect(() => {
    samplesRef.current = []
    setSkew(0)
  }, [sentences])
  useEffect(() => {
    const c = clockRef.current
    if (!c || c.paused || !askedAt || !now?.live || now.paused || now.session !== session || typeof now.pos !== 'number') return
    const elapsedThen = c.elapsed + (askedAt - c.anchorMs) / 1000
    const samples = [...samplesRef.current.slice(-(SKEW_SAMPLES - 1)), elapsedThen - now.pos]
    samplesRef.current = samples
    const floor = Math.min(...samples) - SKEW_FLOOR_BIAS_S
    setSkew(floor > SKEW_MIN_S ? Math.round(floor * 10) / 10 : 0)
  }, [now, askedAt, session])
  return skew
}

/**
 * This thread is the open one (lib/arrivals.ts): its replies are seen as
 * they land — no notice, no unread dot — while the page is visible; one
 * that lands while hidden is unread until the page shows again.
 */
function useSeen(session: string, messages: number) {
  useEffect(() => {
    setOpenSession(session)
    const onVisible = () => {
      if (document.visibilityState === 'visible') markSeen(session)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      markSeen(session)
      setOpenSession(null)
    }
  }, [session])
  useEffect(() => {
    if (messages && document.visibilityState === 'visible') markSeen(session)
  }, [session, messages])
}
