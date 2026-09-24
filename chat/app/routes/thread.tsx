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
import { BackLink } from '../components/Nav'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { answer, ApiError, reply, stopSession } from '../api'
import type { Approval, QuestionAnswer } from '../api/types'
import { SpeechBar } from '../components/SpeechBar'
import { ApprovalCard } from '../components/parts'
import { Thread } from '../components/Thread'
import { useThread } from '../hooks/useThread'
import { useSpeech } from '../hooks/useSpeech'
import { knownArchived, knownLive, knownSpeech, knownProject, knownProjects, knownTitle, noteRow, useSessionStates } from '../hooks/useThreads'
import { useSessionActions } from '../hooks/useSessionActions'
import { ACTION_LABEL, ProjectPickerSheet, sessionMenuItems, SPEECH_LEVELS, SpeechSheet, type SessionAction } from '../components/SessionSheets'
import { archivedOf, clearArchivedOverride, clearEnded, endedHere, projectOverrideOf, useSessionFlags } from '../lib/sessionFlags'
import { useAutoRename, useRename } from '../hooks/useRename'
import { RenameSheet } from '../components/RenameSheet'
import { Popover } from '../components/Popover'
import { AgentsStrip } from '../components/AgentsStrip'
import { useTitle } from '../lib/titles'
import { loadTargets, patchTargetRow } from '../lib/snapshots'
import { buildItems } from '../lib/convert'
import { draftSent } from '../lib/drafts'
import { markSeen, setOpenSession } from '../lib/arrivals'
import { isThisTurn, playerClockOf, withPaused, withSkew, type LiveClock } from '../lib/followAlong'
import type { SpeechLevel, SpeechNow } from '../api/types'

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
  const [moving, setMoving] = useState(false)
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const rename = useRename()
  const autoRename = useAutoRename()
  const acts = useSessionActions()
  const navigate = useNavigate()
  useSessionFlags()
  const archived = archivedOf(session, knownArchived(session))
  // The speech level (§6.4 /session/priority): what the server last said, per thread.
  const [speechSet, setSpeechSet] = useState<Record<string, SpeechLevel>>({})
  const speechLevel = speechSet[session] ?? knownSpeech(session)
  const [pickingSpeech, setPickingSpeech] = useState(false)
  const speechBadge = SPEECH_LEVELS.find((s) => s.level === speechLevel)?.badge

  const log = useThread(session)
  const jumpTo = useSearchJump(log.loadAround)
  // The project line under the title (§6.1): the stream's, else the list's.
  const project = projectOverrideOf(session, log.project || knownProject(session))
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
  // The "Follow along" pill re-reads the voice's position as well as
  // re-centring the words (hooks/useFollowAlong.ts).
  const { refresh: refreshSpeech } = speech
  const askBoth = useCallback(() => {
    refreshSpeech()
    refresh()
  }, [refreshSpeech, refresh])
  const { skew, resync } = useElapsedSkew(session, log.live, speech.now, speech.nowAskedAt, askBoth)
  const live = useMemo(() => {
    const clock = log.live && press ? withPaused(log.live, press.paused, press.at) : log.live
    return clock ? withSkew(clock, skew) : clock
  }, [log.live, press, skew])

  // When the server has no live row but the player is still on one of these
  // turns, the bold rides the player's own position instead (§6.2 `timeline`
  // + §6.5 `turn`). This is the path that survives a barge-in taking the live
  // row away mid-reply: the words and their offsets are on the message, and
  // `pos` says how far in the voice is. The live clock always wins when there
  // is one — it is the finer of the two.
  const played = useMemo(() => {
    if (live || !speakingHere) return null
    const m = log.messages.find((msg) => isThisTurn(msg, speech.now))
    const clock = m && playerClockOf(m, speech.now, speech.nowAskedAt)
    return clock ? { clock, id: m!.id } : null
  }, [live, speakingHere, log.messages, speech.now, speech.nowAskedAt])

  const items = useMemo(
    () => buildItems({ session, messages: log.messages, approval: log.approval,
                       live: live || played?.clock || null,
                       liveId: live ? log.liveId : played?.id || null,
                       optimistic: log.optimistic, dock: true }),
    [session, log.messages, log.approval, live, played, log.liveId, log.optimistic]
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
        // Sending resumes an ended session and un-archives the thread (the
        // server clears the flag once the words are in, §6.4).
        clearEnded(session)
        clearArchivedOverride(session)
        if (knownArchived(session)) {
          patchTargetRow(session, { archived: false })
          noteRow(session, { archived: false })
        }
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
      answer: async (approval: Approval, choice: number | QuestionAnswer[]) => {
        // A question goes structured (§6.4): every answer, by option number
        // and your own words; anything else is the number pressed.
        const res = await answer(
          Array.isArray(choice)
            ? { session, key: approval.key, answers: choice, ...(approval.id ? { request_id: approval.id } : {}) }
            : { session, choice, key: approval.key }
        )
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
  // Exited from here: ended at once, until a send resumes it.
  const ended = endedHere(session)
  const state = ended ? null : (log.state && log.state !== 'ended' ? log.state : null) || states[session]
  const listLive = knownLive(session)
  const sessionLive = !ended && (log.sessionLive ?? (!!state || listLive === true || !!log.live))
  const closed = ended || (!sessionLive && (log.sessionLive === false || listLive === false))
  const onAction = (a: SessionAction) => {
    setMenu(false)
    if (a === 'rename') setRenaming(true)
    else if (a === 'move') setMoving(true)
    else if (a === 'auto-rename') {
      setStatus({ text: 'Thinking of a name…' })
      void autoRename(session).then((r) => setStatus({ text: r.message, failed: !r.ok }))
    } else if (a === 'exit' || a === 'exit-archive') {
      // No confirm (a send resumes it); once the close is accepted, the
      // thread is gone from under the reader, so land on the list rather
      // than back on a screen that may not mention it.
      setStatus(null)
      void (a === 'exit-archive' ? acts.exitAndArchive(session) : acts.exit(session)).then((r) =>
        r.ok ? navigate('/threads', { replace: true }) : setStatus({ text: r.message, failed: true })
      )
    }
    else if (a === 'speech') setPickingSpeech(true)
    else {
      setStatus(null)
      void acts.archive(session, a === 'archive').then((r) => setStatus({ text: r.message, failed: !r.ok }))
    }
  }

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
      {/* Two rows: the title has the whole first one, so long names are not
          cut short; ← and ⋮ sit on the second, beside the project and badges. */}
      <header className="bar thread-bar">
        <h1>
          <button className="title-button" onClick={() => setRenaming(true)} title="Rename">
            {title}
          </button>
        </h1>
        <div className="thread-sub">
          <BackLink />
          {project && <span className="thread-project">{project}</span>}
          {log.stale && <span className="updating">updating…</span>}
          {!log.stale && log.transport === 'poll' && (
            <span className="updating" title="The live stream is not reachable; checking every few seconds instead">
              polling
            </span>
          )}
          {(state || sessionLive || closed) && <span className={`badge ${state || ''}`}>{state || (sessionLive ? 'live' : 'ended')}</span>}
          {archived && <span className="badge archived">Archived</span>}
          {speechBadge && <span className={`badge speech ${speechLevel}`}>{speechBadge}</span>}
          <div className="menu-anchor">
            <button ref={menuButton} className="icon" aria-label="Thread menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              ⋮
            </button>
            {menu && (
              <Popover anchor={menuButton} label="Thread menu" onClose={() => setMenu(false)}>
                {sessionMenuItems(sessionLive, archived).map((a) => (
                  <button key={a} role="menuitem" onClick={() => onAction(a)}>
                    {ACTION_LABEL[a]}
                  </button>
                ))}
              </Popover>
            )}
          </div>
        </div>
      </header>
      <AgentsStrip session={session} counts={log.agents} />
      {pickingSpeech && (
        <SpeechSheet
          current={speechLevel}
          onClose={() => setPickingSpeech(false)}
          onPick={(level) => {
            setPickingSpeech(false)
            setStatus(null)
            void acts.speech(session, level).then((r) => {
              if (r.ok) setSpeechSet((m) => ({ ...m, [session]: level }))
              setStatus({ text: r.message, failed: !r.ok })
            })
          }}
        />
      )}
      {moving && (
        <ProjectPickerSheet
          title={title}
          current={project}
          projects={knownProjects()}
          live={sessionLive}
          onClose={() => setMoving(false)}
          onPick={(to) => {
            setMoving(false)
            setStatus({ text: `Moving to ${to}…` })
            void acts.move(session, to).then((r) => setStatus({ text: r.message, failed: !r.ok }))
          }}
        />
      )}
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
        isRunning={log.isRunning && !ended}
        working={ended ? null : log.working}
        workingAt={log.workingAt}
        thinking={log.isRunning && !ended}
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
        dock={log.approval ? <ApprovalCard approval={log.approval} /> : null}
        speechBar={<SpeechBar here={session} />}
        jumpTo={jumpTo}
        onResync={resync}
        status={
          (status || (log.error && log.messages.length > 0)) && (
            <p className={status?.failed || !status ? 'status failed' : 'status'}>{status ? status.text : log.error}</p>
          )
        }
      />
    </div>
  )
}

/**
 * A thread opened from a search hit (routes/search.tsx): `?at=<message>`
 * (with `t=<its time>` and `hl=<the words>`). The message is loaded in
 * (useThread's loadAround) and then handed to Thread to scroll to and light.
 */
function useSearchJump(loadAround: (id: string, at: number | null) => Promise<string | null>) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const at = params.get('at') || ''
  const t = Number(params.get('t'))
  const hl = params.get('hl') || ''
  const [jump, setJump] = useState<{ id: string; terms: string[] } | null>(null)
  useEffect(() => {
    if (!at) return
    let live = true
    void loadAround(at, Number.isFinite(t) && t > 0 ? t : null).then((id) => {
      if (live && id) setJump({ id, terms: hl.split(/\s+/).filter(Boolean) })
    })
    return () => {
      live = false
    }
    // Once per jump: the page is keyed by session, the URL names the hit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])
  return jump
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
function useElapsedSkew(
  session: string,
  clock: LiveClock | null,
  now: SpeechNow | null,
  askedAt: number,
  ask: () => void
): { skew: number; resync: () => void } {
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
    if (floor > SKEW_MIN_S) {
      setSkew(Math.round(floor * 10) / 10)
      return
    }
    // d BELOW zero is the other case: the player is past the log's clock,
    // so the bold is behind the voice (a skip taken elsewhere, a clock that
    // was frozen while the voice ran on). Staleness and the dropped
    // fraction of a second can only push d up, never down, so a negative d
    // is trustworthy on sight; the UPPER envelope is the conservative one
    // there, as the lower is for a lead.
    const ceil = Math.max(...samples)
    setSkew(ceil < -SKEW_MIN_S ? Math.round(ceil * 10) / 10 : 0)
  }, [now, askedAt, session])
  /**
   * The reader says the bold is not where the voice is: start the estimate
   * again from a fresh answer. The window is dropped (a lead measured
   * before a skip means nothing now) and both sources are asked at once —
   * /speech/now for the player's position, the log for a fresh `elapsed`
   * and anchor. The skew already applied is kept until the new sample
   * lands, so the bold does not jump and come back.
   */
  const resync = useCallback(() => {
    samplesRef.current = []
    ask()
  }, [ask])
  return { skew, resync }
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
