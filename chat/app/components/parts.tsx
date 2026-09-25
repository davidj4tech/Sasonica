/**
 * The custom part and message renderers the thread uses: the follow-along
 * text, reasoning, tool steps and the "Worked · N steps" block, pictures,
 * the slash-command chip, the ask and approval tool UIs, and the running
 * turn's indicator.
 */
import {
  useAuiState,
  type DataMessagePartComponent,
  type ImageMessagePartComponent,
  type ReasoningMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent
} from '@assistant-ui/react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PropsWithChildren, type ReactNode } from 'react'
import type { Approval, ApprovalQuestion, QuestionAnswer, Working } from '../api/types'
import { useSpeechActions } from '../hooks/useSpeech'
import { IconPause, IconPlay } from './SpeechBar'
import type { ApprovalArgs, AskArgs, LineCustom, StepArgs } from '../lib/convert'
import { useShowAmbient } from '../lib/pictures'
import { duration, liveParts, sentenceAt, type LiveClock } from '../lib/followAlong'
import { Link } from 'react-router'
import { REF_LINE, refsIn } from '../lib/refs'
import { BLOCK_CLOSE, BLOCK_OPEN } from '../lib/messages'
import { rich } from '../lib/rich'

/** What the tool UIs need from the thread page. */
export interface ThreadActions {
  /**
   * POST /session/answer: a number (`{choice, key}`), or for a question the
   * structured answers (`{answers, key, request_id?}`). Resolves to '' on
   * success, else the sentence to show and the key of the question it
   * belongs to (after a 409 that is the NEW question's key, so the message
   * survives the re-render).
   */
  answer: (approval: Approval, choice: number | QuestionAnswer[]) => Promise<{ error: string; key: string }>
  /** Send a failed message again (it becomes a new send). */
  retry?: (sendId: string) => void
  /** Drop a failed message. */
  discard?: (sendId: string) => void
}
export const ThreadActionsContext = createContext<ThreadActions>({ answer: async (a) => ({ error: 'not wired', key: a.key }) })

export function useCustom(): LineCustom {
  return useAuiState((s) => (s.message.metadata?.custom || {}) as LineCustom)
}

/** A clock that ticks every `ms` while `on`. */
function useTick(on: boolean, ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [on, ms])
  return now
}

// ── Text ──────────────────────────────────────────────────────────────────

/** A tapped sentence is shown at once and held this long at most while the server catches up. */
const TAP_HOLD_MS = 6000
/** The server's clock confirms a tap once it is on the tapped sentence or this many past it (a short one may be over already). */
const TAP_CONFIRM_SPAN = 3

/** Taps that are not "read from here": on a control, a link or code. */
const NOT_A_SENTENCE_TAP = 'a, button, input, textarea, select, code, pre, [role="button"]'

/**
 * The spoken reply of the message being said, its sentence in bold — and
 * "read from here": a tap on any sentence (the server's own `sentences`,
 * so index i is the server's i) jumps the voice there (§6.5
 * `goto-sentence`). The bold moves at once and holds on the tapped
 * sentence until the server's clock, read after the jump, agrees — then
 * follows the real position again. A tap only: a scroll is never a click,
 * a selection (long press, drag) or a double tap is left to the browser,
 * and links, code and controls keep their own taps.
 */
function LiveText({ text, clock, session }: { text: string; clock: LiveClock; session?: string }) {
  // A quarter-second tick is what moves the bold between polls.
  const now = useTick(!clock.paused, 250)
  const { gotoSentence } = useSpeechActions()
  const [tap, setTap] = useState<{ idx: number; at: number; settledAt: number | null } | null>(null)
  const real = sentenceAt(clock, now)
  // Confirmed: a clock received after the server took the jump is on (or
  // just past) the tapped sentence.
  useEffect(() => {
    if (tap && tap.settledAt !== null && clock.anchorMs >= tap.settledAt && real >= tap.idx && real <= tap.idx + TAP_CONFIRM_SPAN) setTap(null)
  }, [tap, clock, real])
  // Never confirmed: the server's position is the truth after all.
  useEffect(() => {
    if (!tap) return
    const t = window.setTimeout(() => setTap((cur) => (cur && cur.at === tap.at ? null : cur)), TAP_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [tap])
  const current = tap ? tap.idx : real
  const { parts, tail } = liveParts(text, clock.sentences)

  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!session || e.button !== 0 || e.detail > 1) return
    const target = e.target as HTMLElement
    if (target.closest(NOT_A_SENTENCE_TAP)) return
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && !sel.isCollapsed && sel.toString().trim()) return
    const el = target.closest<HTMLElement>('[data-i]')
    if (!el) return
    const idx = Number(el.dataset.i)
    if (!Number.isInteger(idx) || idx < 0) return
    const at = Date.now()
    setTap({ idx, at, settledAt: null })
    void gotoSentence(session, idx).then((ok) =>
      setTap((cur) => (cur && cur.at === at ? (ok ? { ...cur, settledAt: Date.now() } : null) : cur))
    )
  }

  return (
    <div className="line-text live-text" onClick={onClick}>
      {parts.map((p, n) => {
        // A described table or code block is `span` sentences at once.
        const last = p.i + p.span - 1
        const cls = current >= p.i && current <= last ? 'sentence now' : last < current ? 'sentence said' : 'sentence'
        // A block brings its own margin, so the line breaks beside it go.
        const block = p.text.startsWith(BLOCK_OPEN)
        const beside = block || parts[n - 1]?.text.startsWith(BLOCK_OPEN) || p.lead.includes(BLOCK_CLOSE)
        const lead = beside ? p.lead.replace(/^\n+|\n+$/g, '') : p.lead
        return (
          <span key={n}>
            {rich(lead, `l${n}`)}
            <span data-i={p.i} className={p.span > 1 || p.text.startsWith(BLOCK_OPEN) ? `${cls} block` : cls}>
              {rich(p.text, `s${n}`)}
            </span>
          </span>
        )
      })}
      {/* Not rendered to speech yet: shown, never bold (the sentences grow into it). */}
      {tail && <span className="sentence pending">{rich(tail, 't')}</span>}
    </div>
  )
}

/**
 * Text part: plain, or — the spoken reply of the message being said — with
 * its sentence in bold (§6.2). The whole text is shown from the start.
 */
export const LineText: TextMessagePartComponent = ({ text }) => {
  const custom = useCustom()
  if (custom.live && text === custom.liveText) return <LiveText text={text} clock={custom.live} session={custom.session} />
  // A spoken reply that is not playing: its history row, which its ▶ plays.
  if (custom.id && text === custom.liveText) return <div className="line-text" data-rid={custom.id}>{rich(text)}</div>
  if (text.includes('@[')) return <div className="line-text">{chipped(text)}</div>
  return <div className="line-text">{rich(text)}</div>
}

const CHIP = /@\[([^[\]\n]{1,200})\]/g

/**
 * A message that names other threads by chip (lib/refs.ts): the server's
 * lines at its foot go, and each chip becomes a link to its thread — the
 * session from those lines, else the one this device remembers.
 */
function chipped(text: string): ReactNode[] {
  const known: Record<string, string> = { ...refsIn(text) }
  const body = text.replace(REF_LINE, (_all, label: string, session: string) => {
    known[label.trim()] = session
    return ''
  })
  const out: ReactNode[] = []
  let last = 0
  for (const m of body.matchAll(CHIP)) {
    const label = m[1].trim()
    out.push(...rich(body.slice(last, m.index), `c${m.index}`))
    const session = known[label]
    out.push(
      session ? (
        <Link key={m.index} className="ref-chip" to={`/t/${encodeURIComponent(session)}`} state={{ title: label }}>
          @{label}
        </Link>
      ) : (
        <span key={m.index} className="ref-chip">
          @{label}
        </span>
      )
    )
    last = m.index + m[0].length
  }
  out.push(...rich(body.slice(last), 'end'))
  return out
}

// ── Reasoning and tool steps ──────────────────────────────────────────────

/**
 * A reasoning part: the model's words behind a collapsed "Thinking"
 * disclosure (rendered only when opened), or — REALITY on red5, ~90 % of
 * them — thinking whose text the harness does not keep: a small "thought"
 * marker, never an empty box. (Claude Code keeps a signature only; Codex
 * encrypts it; pi writes the words, so a pi thread is mostly the first
 * shape.)
 */
export const Reasoning: ReasoningMessagePartComponent = ({ text }) => {
  const [open, setOpen] = useState(false)
  if (!text) return <span className="thought" title="The model thought here; its words are not kept">thought</span>
  return (
    <div className={open ? 'thinking open' : 'thinking'}>
      <button className="thinking-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Thinking
      </button>
      {open && <p className="thinking-text">{text}</p>}
    </div>
  )
}

const STATUS_MARK: Record<string, string> = { running: '…', done: '✓', error: '✕' }

/**
 * One tool step: its title (the step in plain English) and status; a tap
 * opens the input and result summaries, which are rendered only then (a
 * busy page carries ~6 of them per message, 300 chars each).
 */
export const ToolStep: ToolCallMessagePartComponent<StepArgs> = ({ args, result, toolName }) => {
  const [open, setOpen] = useState(false)
  const status = args?.status || (result === undefined ? 'running' : 'done')
  const summary = args?.summary || ''
  const res = typeof result === 'string' ? result : result === undefined ? '' : JSON.stringify(result)
  return (
    <div className={`step ${status}${open ? ' open' : ''}`}>
      <button className="step-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="step-mark" aria-label={status}>
          {status === 'running' ? <span className="spinner small" /> : STATUS_MARK[status] || '·'}
        </span>
        <span className="step-title">{args?.title || toolName}</span>
      </button>
      {open && (
        <div className="step-body">
          <p className="step-tool">{toolName}</p>
          {summary && <pre className="step-in">{summary}</pre>}
          {res && <pre className={status === 'error' ? 'step-out error' : 'step-out'}>{res}</pre>}
        </div>
      )}
    </div>
  )
}

/**
 * The parts' grouping (lib/convert.ts groupParts): a run of tool steps (and
 * the reasoning between them) folds into one "Worked · N steps" block, like
 * the terminal's. Its children — the steps — are mounted only while it is
 * open. While a step runs, the block says so and names it.
 */
export function PartGroup({ groupKey, indices, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
  const [open, setOpen] = useState(false)
  const steps = useAuiState((s) => {
    const content = s.message.content as readonly { type: string; args?: StepArgs; result?: unknown }[]
    let n = 0
    let running = ''
    let errors = 0
    for (const i of indices) {
      const p = content[i]
      if (p?.type !== 'tool-call') continue
      n++
      if (p.args?.status === 'running' || (p.result === undefined && !p.args?.status)) running = p.args?.title || ''
      if (p.args?.status === 'error') errors++
    }
    return `${n}|${errors}|${running}`
  })
  if (!groupKey) return <>{children}</>
  const [nStr, errStr, ...rest] = steps.split('|')
  const running = rest.join('|')
  const n = Number(nStr)
  const errors = Number(errStr)
  return (
    <div className={open ? 'work-group open' : 'work-group'}>
      <button className="work-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {running ? <span className="spinner small" /> : <span className="work-caret">{open ? '▾' : '▸'}</span>}
        <span>
          {running ? 'Working' : 'Worked'} · {n} step{n === 1 ? '' : 's'}
          {errors > 0 && <span className="work-errors"> · {errors} failed</span>}
        </span>
        {running && !open && <span className="work-now">{running}</span>}
      </button>
      {open && <div className="work-steps">{children}</div>}
    </div>
  )
}

/**
 * A `[[visual:]]` figure (`figure: true`) is a compact thumbnail; a tap
 * opens it to the column's width, and a tap on the opened one goes to the
 * picture itself, as before. Ambient art (`figure: false`) is hidden unless
 * Settings → "Show ambient artwork" (lib/pictures.ts), and then stays small.
 */
function PictureView({ image }: { image: string }) {
  const { figure } = useCustom()
  const showAmbient = useShowAmbient()
  const [open, setOpen] = useState(false)
  if (!figure) {
    if (!showAmbient) return null
    return (
      <a className="picture ambient" href={image} target="_blank" rel="noreferrer">
        <img src={image} alt="" loading="lazy" />
      </a>
    )
  }
  if (!open) {
    return (
      <button className="picture figure thumb" onClick={() => setOpen(true)} aria-label="Open the figure">
        <img src={image} alt="figure" loading="lazy" />
      </button>
    )
  }
  return (
    <a className="picture figure" href={image} target="_blank" rel="noreferrer">
      <img src={image} alt="figure" loading="lazy" />
    </a>
  )
}

/** Image part (https / blob / data URLs). */
export const Picture: ImageMessagePartComponent = ({ image }) => <PictureView image={image} />

/** `data-picture` part: an http picture assistant-ui would not keep as an image. */
export const PictureData: DataMessagePartComponent<{ src: string }> = ({ data }) => <PictureView image={data.src} />

// ── Message furniture ─────────────────────────────────────────────────────

/**
 * Play/pause beside a spoken reply. The one being said now gets pause (or
 * resume — its state is the follow-along's, so the key and the bold agree);
 * any other with a speech-history row (`spoken.id`) gets ▶, which replays it
 * (`replay-id`, as ConversationLog.vue did on a tap). Messages never spoken
 * (or whose speech was not recognised, §6.2.2) have no id and no key.
 */
export function MessageSpeechKey() {
  const { id, live } = useCustom()
  const { toggle, replayId } = useSpeechActions()
  if (live) {
    return (
      <button className="msg-key on" aria-label={live.paused ? 'Resume' : 'Pause'} onClick={() => toggle()}>
        {live.paused ? <IconPlay /> : <IconPause />}
      </button>
    )
  }
  if (!id) return null
  return (
    <button className="msg-key" aria-label="Play this reply" onClick={() => replayId(id)}>
      <IconPlay />
    </button>
  )
}

/** The chip for a slash command typed from the box (`message.command`). */
/** "From <name>": a message another session sent into this one. */
export function PeerNote() {
  const { peer } = useCustom()
  if (!peer) return null
  return <span className="peer-note">From {peer.name}</span>
}

export function CommandChip() {
  const { command } = useCustom()
  if (!command) return null
  const label = typeof command.text === 'string' ? command.text : JSON.stringify(command)
  return <span className="command-chip">{label}</span>
}

/**
 * Under a message sent from here: "sending…" until the server takes it,
 * nothing once it has (the bubble is replaced by the server's own line when
 * that arrives), or what went wrong with Retry / Discard.
 */
export function OptimisticMark() {
  const { optimistic, send } = useCustom()
  const { retry, discard } = useContext(ThreadActionsContext)
  if (!optimistic || !send) return null
  if (send.state === 'sending') return <span className="sending-mark">sending…</span>
  if (send.state === 'sent') return null
  return (
    <span className="sending-mark failed">
      <span className="why">{send.error || 'Not sent.'}</span>
      {send.state === 'failed' && retry && (
        <button className="send-action" onClick={() => retry(send.id)}>
          Retry
        </button>
      )}
      {discard && (
        <button className="send-action quiet" onClick={() => discard(send.id)}>
          {send.state === 'failed' ? 'Discard' : 'OK'}
        </button>
      )}
    </span>
  )
}

// ── Asks and approvals (human tool UI) ────────────────────────────────────

/**
 * The numbered options of the dialog on screen, each one a button that
 * presses that number (POST /session/answer {session, choice, key}). A 409
 * "question has changed" re-renders from the new `approval` via the page.
 */
function ApprovalOptions({ approval }: { approval: Approval }) {
  const { answer } = useContext(ThreadActionsContext)
  const [busy, setBusy] = useState<number | null>(null)
  // An error belongs to one question; a different one on screen hides it.
  const [error, setError] = useState({ error: '', key: '' })

  const press = async (n: number) => {
    if (busy !== null) return
    setBusy(n)
    setError({ error: '', key: '' })
    setError(await answer(approval, n))
    setBusy(null)
  }
  return (
    <div className="approval-options">
      {approval.partial && <p className="hint">Some options scrolled off the screen; the numbers still answer it.</p>}
      {approval.options.map((o) => (
        <button key={`${approval.key}:${o.n}`} className="option" disabled={busy !== null} onClick={() => press(o.n)}>
          <span className="n">{o.n}</span>
          <span className="label">
            {o.label}
            {o.detail && <small>{o.detail}</small>}
          </span>
          {busy === o.n && <span className="spinner" aria-label="answering" />}
        </button>
      ))}
      {error.error && error.key === approval.key && <p className="error">{error.error}</p>}
    </div>
  )
}

/** What the person has picked so far, per question. */
interface Pick {
  selected: number[]
  other: string
}

function initialPicks(questions: ApprovalQuestion[]): Pick[] {
  return questions.map((q) => ({
    selected: q.multiSelect ? q.options.filter((o) => o.checked).map((o) => o.n) : [],
    other: ''
  }))
}

const hasAnswer = (p: Pick | undefined) => !!p && (p.selected.length > 0 || p.other.trim() !== '')

/**
 * Which question this card is showing. A poll hands back an equal-but-new
 * `questions` array every few seconds (Home polls /dashboard); the picks
 * must only start over when the question itself changed — a 409, or the
 * next dialog — never on a refresh that says the same thing.
 */
function questionSig(key: string, questions: ApprovalQuestion[]): string {
  return JSON.stringify([key, questions.map((q) => [q.header, q.question, q.multiSelect, q.free_text, q.options.map((o) => [o.n, o.label])])])
}

/**
 * An AskUserQuestion on screen, answered from here (§6.4, the structured
 * form): one section per question — tap an option of a single-select, tick
 * the boxes of a multi-select, or write your own words under "Other" — and
 * one Send for them all. One single-select question sends on the tap, as the
 * numbered dialog always did. After a 409 the page swaps in the new question
 * and the picks start over.
 */
export function QuestionCard({ approval }: { approval: Approval }) {
  const { answer } = useContext(ThreadActionsContext)
  const questions = useMemo(() => approval.questions || [], [approval.questions])
  const [picks, setPicks] = useState<Pick[]>(() => initialPicks(questions))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState({ error: '', key: '' })
  // A different question (after a 409, or the next one) starts afresh; the
  // same question polled again leaves what has been picked alone.
  const sig = questionSig(approval.key, questions)
  const sigRef = useRef(sig)
  useEffect(() => {
    if (sigRef.current === sig) return
    sigRef.current = sig
    setPicks(initialPicks(questions))
  }, [sig, questions])

  const quick = questions.length === 1 && !questions[0].multiSelect
  const typing = !!picks[0]?.other.trim()
  const ready = questions.length > 0 && questions.every((_, i) => hasAnswer(picks[i]))

  const send = async (ps: Pick[]) => {
    if (busy) return
    setBusy(true)
    setError({ error: '', key: '' })
    const answers: QuestionAnswer[] = questions.map((_, i) => {
      const p = ps[i] || { selected: [], other: '' }
      const other = p.other.trim()
      return { question_index: i, selected: p.selected, ...(other ? { other_text: other } : {}) }
    })
    setError(await answer(approval, answers))
    setBusy(false)
  }

  const update = (i: number, f: (p: Pick) => Pick) =>
    setPicks((ps) => questions.map((_, j) => (j === i ? f(ps[j] || { selected: [], other: '' }) : ps[j] || { selected: [], other: '' })))

  const tap = (i: number, q: ApprovalQuestion, n: number) => {
    if (busy) return
    if (q.multiSelect) {
      update(i, (p) => ({ ...p, selected: p.selected.includes(n) ? p.selected.filter((x) => x !== n) : [...p.selected, n].sort((a, b) => a - b) }))
      return
    }
    // A single choice: an option or your own words, never both.
    const next = questions.map((_, j) => (j === i ? { selected: [n], other: '' } : picks[j] || { selected: [], other: '' }))
    setPicks(next)
    if (quick) void send(next)
  }

  return (
    <div className={`question-card${busy ? ' busy' : ''}`}>
      {!questions.length && <p className="hint">Part of this question is off the screen — answer it at the desk.</p>}
      {questions.map((q, i) => {
        const p = picks[i] || { selected: [], other: '' }
        return (
          <fieldset key={`${approval.key}:${i}`} className="question" disabled={busy}>
            <legend>
              {q.header && <span className="q-header">{q.header}</span>}
              <span className="q-text">{q.question}</span>
              {q.multiSelect && <span className="q-hint">choose any</span>}
            </legend>
            <div className="approval-options" role={q.multiSelect ? 'group' : 'radiogroup'}>
              {q.options.map((o) => {
                const on = p.selected.includes(o.n)
                return (
                  <button
                    key={o.n}
                    type="button"
                    className={`option${on ? ' on' : ''}`}
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => tap(i, q, o.n)}
                  >
                    <span className={q.multiSelect ? 'mark box' : 'mark round'} aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    <span className="label">
                      {o.label}
                      {(o.description || o.detail) && <small>{o.description || o.detail}</small>}
                    </span>
                  </button>
                )
              })}
              {q.free_text !== false && (
                <label className="other">
                  <span className="other-label">Other</span>
                  <input
                    type="text"
                    value={p.other}
                    placeholder="Your own words…"
                    aria-label={`Other answer to: ${q.question}`}
                    onChange={(e) => {
                      const other = e.target.value
                      // Single-select: your own words replace the option.
                      update(i, (x) => ({ selected: q.multiSelect || !other.trim() ? x.selected : [], other }))
                    }}
                  />
                </label>
              )}
            </div>
          </fieldset>
        )
      })}
      {questions.length > 0 && (!quick || typing) && (
        <button type="button" className="send-answer" disabled={!ready || busy} onClick={() => send(picks)}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      )}
      {error.error && error.key === approval.key && <p className="error">{error.error}</p>}
    </div>
  )
}

/** A permission prompt / Codex approval / any dialog, as its own message. */
export const ApprovalToolUI: ToolCallMessagePartComponent<ApprovalArgs> = ({ args }) => <ApprovalCard approval={args.approval} />

/**
 * The card for whatever a session is stopped on — a question card for an
 * AskUserQuestion, numbered options for anything else. Answers go through
 * the nearest ThreadActionsContext (the thread page, or the home screen).
 */
export function ApprovalCard({ approval }: { approval: Approval }) {
  if (approval.kind === 'question') {
    return (
      <div className="tool-card approval ask">
        {!(approval.questions || []).length && <p className="tool-title">{approval.question || 'The session is asking you something'}</p>}
        <QuestionCard approval={approval} />
      </div>
    )
  }
  return (
    <div className="tool-card approval">
      <p className="tool-title">{approval.question || 'The session is waiting on a question'}</p>
      <ApprovalOptions approval={approval} />
    </div>
  )
}

/** The words of an answer that are none of the options: what was written under "Other". */
export function otherWords(answer: string, labels: string[]): string {
  const known = new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))
  return (answer || '')
    .split(/,\s*/)
    .map((x) => x.trim())
    .filter((x) => x && !known.has(x.toLowerCase()))
    .join(', ')
}

/**
 * An AskUserQuestion, as asked (§14). While it is still the dialog on screen
 * (`args.approval`), it is the question card; otherwise it is answered and
 * read-only, with the chosen labels marked and any words of your own shown
 * as "Other".
 */
export const AskToolUI: ToolCallMessagePartComponent<AskArgs> = ({ args }) => {
  const { questions, approval, pending, answeredWith, answerText } = args
  const chosen = (label: string) => answeredWith.includes(label.trim().toLowerCase())
  if (approval) {
    return (
      <div className="tool-card ask approval">
        {approval.kind === 'question' ? <QuestionCard approval={approval} /> : <ApprovalOptions approval={approval} />}
      </div>
    )
  }
  const other = otherWords(answerText || '', questions.flatMap((q) => q.options.map((o) => o.label)))
  // Still waiting, with the form docked above the composer: the question
  // keeps its place in the conversation and says where it is answered.
  return (
    <div className={pending ? 'tool-card ask asking' : 'tool-card ask answered'}>
      {pending && <p className="tool-title">Waiting on your answer — the form is below.</p>}
      {questions.map((q, i) => (
        <div key={i}>
          {questions.length > 1 && <p className="tool-title">{q.question}</p>}
          <ul>
            {q.options.map((o, j) => (
              <li key={j} className={chosen(o.label) ? 'chosen' : ''}>
                {o.label}
                {o.description && <small>{o.description}</small>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {other && <p className="other-answer">Other: {other}</p>}
    </div>
  )
}

// ── The running turn ──────────────────────────────────────────────────────

const WORKING_SHOWN = 4

/**
 * `working` is not a message (§14): it is the thread's in-progress
 * indicator, where today's clients show the dots — with the step list and a
 * timer run on the local clock between polls.
 */
export function WorkingIndicator({ working, workingAt, thinking }: { working: Working | null; workingAt: number; thinking: boolean }) {
  const now = useTick(!!working, 1000)
  const [open, setOpen] = useState(false)
  if (!working) {
    if (!thinking) return null
    return (
      <div className="working">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
      </div>
    )
  }
  const seconds = Math.max(0, working.server_time - working.since + (now - workingAt) / 1000)
  const steps = open ? working.steps : working.steps.slice(-WORKING_SHOWN)
  return (
    <div className="working">
      <button className="working-head" onClick={() => setOpen((o) => !o)}>
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        Working {duration(seconds)} · {working.count} step{working.count === 1 ? '' : 's'}
      </button>
      <ol className="steps" start={Math.max(1, working.count - steps.length + 1)}>
        {steps.map((s, i) => (
          <li key={i} className={i === steps.length - 1 ? 'current' : ''}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  )
}
