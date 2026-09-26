/**
 * The voice's player, on every screen (Sasonica's SpeechBar.vue, ported).
 *
 * Collapsed, it is one row: what is being said (the conversation's title —
 * tap to open it — over the current sentence), a progress sliver along its
 * top edge from `pos`/`dur`, and the keys wanted most, packed close: start
 * of reply, back a sentence, pause/resume, on a sentence, end of reply. The chevron (or a tap on the sentence) opens
 * the full set in a sheet: turns, paragraphs, end of reply, replay, speed,
 * volume and mute — every key the canvas takes from the app (§6.5).
 *
 * In the thread that is speaking, the live line already bolds the sentence,
 * so the bar leaves it out and says only the time (or "Paused" and the time).
 *
 * Shown while a reply is live (speaking or paused); a reply that has just
 * ended keeps it for 30 s, since that is when replay is wanted — as a slim
 * strip, about half the bar's height (it sits over the composer, the
 * screen's prime real estate): "▶ Replay · <title>" on one line, the whole
 * strip the replay key, and the chevron for the full set. Each key's hit
 * area reaches past the strip to 44 px. The full bar is back as soon as
 * something speaks. State and keys come from the one SpeechProvider poll.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import type { SessionId } from '../api/types'
import { useSpeech } from '../hooks/useSpeech'
import { useTitle } from '../lib/titles'
import { useScrim } from '../lib/layers'
import { isNative, openOutputSwitcher } from '../lib/native'

// ── Icons (currentColor, sized by the button's font-size) ─────────────────

const Svg = ({ children, label }: { children: ReactNode; label?: string }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
    {children}
  </svg>
)
export const IconPlay = () => (
  <Svg>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" />
  </Svg>
)
export const IconPause = () => (
  <Svg>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
  </Svg>
)
export const IconReplay = () => (
  <Svg>
    <path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="currentColor" />
  </Svg>
)
const IconStart = () => (
  <Svg>
    <path d="M4 6h2v12H4zm2.5 6 7 5V7zm6.5 0 7 5V7z" fill="currentColor" />
  </Svg>
)
const IconBackSentence = () => (
  <Svg>
    <path d="M11 18V6l-8.5 6L11 18zm.5-6 8.5 6V6l-8.5 6z" fill="currentColor" />
  </Svg>
)
const IconFwdSentence = () => (
  <Svg>
    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="currentColor" />
  </Svg>
)
const IconPrevTurn = () => (
  <Svg>
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" fill="currentColor" />
  </Svg>
)
const IconNextTurn = () => (
  <Svg>
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor" />
  </Svg>
)
const IconParaBack = () => (
  <Svg>
    <path d="M17.6 6.4 16.2 5l-7 7 7 7 1.4-1.4L12 12zm-6 0L10.2 5l-7 7 7 7 1.4-1.4L6 12z" fill="currentColor" />
  </Svg>
)
const IconParaFwd = () => (
  <Svg>
    <path d="M6.4 6.4 7.8 5l7 7-7 7-1.4-1.4L12 12zm6 0L13.8 5l7 7-7 7-1.4-1.4L18 12z" fill="currentColor" />
  </Svg>
)
const IconEnd = () => (
  <Svg>
    <path d="M5.6 7.4 7 6l6 6-6 6-1.4-1.4L10.2 12zM16 6h2v12h-2z" fill="currentColor" />
  </Svg>
)
const IconExpand = ({ open }: { open: boolean }) => (
  <Svg>
    <path d={open ? 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z' : 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z'} fill="currentColor" />
  </Svg>
)
const IconVolume = ({ muted }: { muted: boolean }) => (
  <Svg>
    <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
    {muted ? (
      <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    ) : (
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    )}
  </Svg>
)

// ── Helpers ───────────────────────────────────────────────────────────────

/** 1:24 — a position or length in the reply, as the bar and a resume key say it. */
export function clock(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return ''
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function speedLabel(v: number | null | undefined): string {
  const n = Number(v)
  return n ? `${n.toFixed(2).replace(/\.?0+$/, '')}×` : '1×'
}

/** Nothing to reset: no rate reported, or one that rounds to normal. */
function isNormalSpeed(v: number | null | undefined): boolean {
  const n = Number(v)
  return !n || Math.abs(n - 1) < 0.005
}

/** 0–1, or null when the server gave no position. */
function progressOf(pos: number | null | undefined, dur: number | null | undefined): number | null {
  if (pos == null || !dur) return null
  return Math.max(0, Math.min(1, pos / dur))
}

/** A tap on the bar's title sooner than this after it appeared or changed thread is ignored. */
const SETTLE_TAP_MS = 800

// ── The bar ───────────────────────────────────────────────────────────────

export function SpeechBar({ here }: { here?: SessionId }) {
  const speech = useSpeech()
  const { now, finished, error } = speech
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const live = !!now?.live
  const visible = live || !!finished || open
  // Hand the sheet back when the bar goes (no reply, nothing just ended).
  useEffect(() => {
    if (!live && !finished) setOpen(false)
  }, [live, finished])

  const session = live ? now?.session : finished?.session
  const title = useTitle(session, (live ? now?.title : finished?.title) || '') || (live ? 'Speaking' : 'Nothing playing')
  // When the bar appeared or changed thread. A tap this soon after was
  // aimed at whatever the bar just pushed aside, not at the bar.
  const changedAtRef = useRef(0)
  useEffect(() => {
    changedAtRef.current = Date.now()
  }, [session, visible])

  if (!visible) return null

  const paused = live ? !!now?.paused : true
  const inHere = !!here && session === here
  // What Replay plays: the thread the bar names, else the one on screen —
  // never "the newest of all", which can be a reply held somewhere else.
  const replayOf = session || here
  const toggle = () => speech.toggle(replayOf)
  const progress = live ? progressOf(now?.pos, now?.dur) : null
  const times = live && now?.pos != null ? `${clock(now.pos)}${now.dur ? ` / ${clock(now.dur)}` : ''}` : ''

  const openThread = () => {
    if (!session || inHere || Date.now() - changedAtRef.current < SETTLE_TAP_MS) return
    setOpen(false)
    navigate(`/t/${encodeURIComponent(session)}`, { state: { title } })
  }
  const expand = () => {
    speech.resetTurns()
    setOpen(true)
  }

  const second = error
    ? error
    : !live
      ? 'Finished · play to hear it again'
      : inHere
        ? // Short: the keys take most of the row, and the dot says "speaking".
          paused ? `Paused${times ? ` · ${times}` : ''}` : times || 'Speaking'
        : now?.sentence || (paused ? 'Paused' : '…')

  // Finished (nothing speaking, nothing wrong): the slim strip.
  if (!live && !error && finished) {
    return (
      <>
        <div className="speech-bar slim" role="region" aria-label="Speech">
          <button className="slim-replay" aria-label="Replay" title={`Replay: ${title}`} onClick={toggle}>
            <IconPlay />
            <span className="slim-word">Replay</span>
            <span className="slim-title">{title}</span>
          </button>
          <button className="slim-more" aria-label="All speech controls" aria-expanded={open} onClick={() => (open ? setOpen(false) : expand())}>
            <IconExpand open={open} />
          </button>
        </div>
        {open && typeof document !== 'undefined' && createPortal(<SpeechSheet title={title} session={session || null} inHere={inHere} replayOf={replayOf} onOpen={openThread} onClose={() => setOpen(false)} />, document.body)}
      </>
    )
  }

  const toggleLabel = !live ? 'Replay' : paused ? 'Resume' : 'Pause'

  return (
    <>
      <div className={`speech-bar${inHere ? ' here' : ''}${paused ? ' paused' : ''}`} role="region" aria-label="Speech">
        {progress !== null && (
          <div className="speech-progress" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="speech-text">
          {inHere ? (
            // This thread is the one speaking: its live line has the words.
            <button className="speech-title" onClick={expand}>
              <span className={live && !paused ? 'eq on' : 'eq'} aria-hidden="true" />
              {second}
            </button>
          ) : (
            <>
              {/* In a thread, another thread's reply opens the sheet (which has
                  the link): the bar changes under the reader's thumb when a
                  reply starts elsewhere, and a stray tap must never take
                  them away from what they are reading. On the list, a tap
                  opens it. */}
              <button className="speech-title" onClick={session && !here ? openThread : expand} title={session && !here ? 'Open this conversation' : undefined}>
                <span className={live && !paused ? 'eq on' : 'eq'} aria-hidden="true" />
                {title}
              </button>
              {second && (
                <button className={error ? 'speech-sentence failed' : 'speech-sentence'} onClick={expand}>
                  {second}
                </button>
              )}
            </>
          )}
        </div>
        {live && (
          <button className="skey" aria-label="Start of reply" onClick={() => void (session ? speech.gotoSentence(session, 0) : speech.ctl('goto-sentence', 0))}>
            <IconStart />
          </button>
        )}
        {live && (
          <button className="skey" aria-label="Back a sentence" onClick={() => void speech.ctl('skip-')}>
            <IconBackSentence />
          </button>
        )}
        <button className="skey main" aria-label={toggleLabel} aria-pressed={live ? !paused : undefined} onClick={toggle}>
          {!live ? <IconReplay /> : paused ? <IconPlay /> : <IconPause />}
        </button>
        {live && (
          <button className="skey" aria-label="Next sentence" onClick={() => void speech.ctl('skip+')}>
            <IconFwdSentence />
          </button>
        )}
        {live && (
          <button className="skey" aria-label="End of reply" onClick={() => void speech.ctl('jump-end')}>
            <IconNextTurn />
          </button>
        )}
        <button className="skey more" aria-label="All speech controls" aria-expanded={open} onClick={() => (open ? setOpen(false) : expand())}>
          <IconExpand open={open} />
        </button>
      </div>
      {open && typeof document !== 'undefined' && createPortal(<SpeechSheet title={title} session={session || null} inHere={inHere} replayOf={replayOf} onOpen={openThread} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

// ── The full set ──────────────────────────────────────────────────────────

function SpeechSheet(props: { title: string; session: SessionId | null; inHere: boolean; replayOf?: SessionId; onOpen: () => void; onClose: () => void }) {
  const speech = useSpeech()
  const { replayOf } = props
  const toggle = () => speech.toggle(replayOf)
  const { now, error } = speech
  const live = !!now?.live
  const paused = live ? !!now?.paused : true
  const progress = live ? progressOf(now?.pos, now?.dur) : null

  // A scrim tap, Escape or Android back closes it (lib/layers.ts).
  const scrim = useScrim(props.onClose)

  const sentence = error || now?.sentence || (paused && live ? 'Paused' : live ? '…' : 'The last reply has finished. Replay it, or go back a turn.')

  return (
    <div className="speech-sheet-wrap" {...scrim}>
      <div className="speech-sheet" role="dialog" aria-label="Speech controls" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className={live && !paused ? 'eq on' : 'eq'} aria-hidden="true" />
          {props.session && !props.inHere ? (
            <button className="sheet-title link" onClick={props.onOpen}>
              {props.title}
            </button>
          ) : (
            <p className="sheet-title">{props.title}</p>
          )}
          <button className="skey" aria-label="Close" onClick={props.onClose}>
            <IconExpand open />
          </button>
        </div>

        <div className="sheet-cols">
          <div className="sheet-col">
            <p className={error ? 'sheet-sentence failed' : 'sheet-sentence'}>{sentence}</p>
            <div className="sheet-progress">
              <div className="speech-progress inline" aria-hidden="true">
                <i style={{ width: `${(progress ?? 0) * 100}%` }} />
              </div>
              <span className="sheet-time">{live ? `${clock(now?.pos)}${now?.dur ? ` / ${clock(now.dur)}` : ''}` : ''}</span>
            </div>
            <div className="transport">
              <button className="skey" aria-label="Previous turn" onClick={speech.prevTurn}>
                <IconPrevTurn />
              </button>
              <button className="skey" aria-label="Back a paragraph" disabled={!live} onClick={() => void speech.ctl('para-')}>
                <IconParaBack />
              </button>
              <button className="skey" aria-label="Back a sentence" disabled={!live} onClick={() => void speech.ctl('skip-')}>
                <IconBackSentence />
              </button>
              <button className="skey main big" aria-label={!live ? 'Replay' : paused ? 'Resume' : 'Pause'} onClick={toggle}>
                {paused ? <IconPlay /> : <IconPause />}
              </button>
              <button className="skey" aria-label="Next sentence" disabled={!live} onClick={() => void speech.ctl('skip+')}>
                <IconFwdSentence />
              </button>
              <button className="skey" aria-label="Next paragraph" disabled={!live} onClick={() => void speech.ctl('para+')}>
                <IconParaFwd />
              </button>
              <button className="skey" aria-label={speech.histIdx > 1 ? 'Next turn' : 'End of reply'} onClick={speech.nextTurn}>
                <IconNextTurn />
              </button>
            </div>
          </div>

          <div className="sheet-col">
            <div className="pills">
              <button className="pill" onClick={() => speech.replayLatest(replayOf)}>
                <IconReplay /> Replay latest
              </button>
              <button className="pill" disabled={!live} onClick={() => void speech.ctl('jump-end')}>
                <IconEnd /> End of reply
              </button>
              <button className={now?.muted ? 'pill on' : 'pill'} aria-pressed={!!now?.muted} onClick={() => void speech.ctl('mute')}>
                <IconVolume muted={!!now?.muted} /> {now?.muted ? 'Muted' : 'Mute'}
              </button>
              {/* Android's own output picker (earbuds / speaker / Cast); only in the shell. */}
              {isNative() && (
                <button className="pill" onClick={() => void openOutputSwitcher()}>
                  <IconVolume muted={false} /> Output…
                </button>
              )}
            </div>
            {/* The rate is a reading, not a button. It used to be both: the
                one element showed the speed AND reset it, so as soon as it
                said 1× it read as a reset key that had eaten the indicator
                ("the speed indicator only stays for a few seconds before
                switching back to a button to reset it" — David, 23 Sep 2026).
                Reset is its own key now, and it is only offered when there is
                something to reset. */}
            <div className="knob">
              <span className="knob-label">Speed</span>
              <button className="skey" aria-label="Slower" onClick={() => void speech.ctl('speed-')}>
                −
              </button>
              <span className="knob-value" aria-live="polite" aria-label={`Speed ${speedLabel(now?.speed)}`}>
                {speedLabel(now?.speed)}
              </span>
              <button className="skey" aria-label="Faster" onClick={() => void speech.ctl('speed+')}>
                +
              </button>
              <button
                className="skey knob-reset"
                aria-label="Reset speed to 1×"
                title="Reset to 1×"
                disabled={isNormalSpeed(now?.speed)}
                onClick={() => void speech.ctl('speed0')}
              >
                <IconReplay />
              </button>
            </div>
            <div className="knob">
              <span className="knob-label">Volume</span>
              <button className="skey" aria-label="Quieter" onClick={() => void speech.ctl('vol-')}>
                −
              </button>
              <span className="knob-value quiet" aria-hidden="true">
                <IconVolume muted={!!now?.muted} />
              </span>
              <button className="skey" aria-label="Louder" onClick={() => void speech.ctl('vol+')}>
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
