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
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import type { Approval, Working } from '../api/types'
import { useSpeechActions } from '../hooks/useSpeech'
import { IconPause, IconPlay } from './SpeechBar'
import type { ApprovalArgs, AskArgs, LineCustom, StepArgs } from '../lib/convert'
import { useShowAmbient } from '../lib/pictures'
import { duration, liveParts, sentenceAt, type LiveClock } from '../lib/followAlong'

/** What the tool UIs need from the thread page. */
export interface ThreadActions {
  /**
   * POST /session/answer. Resolves to '' on success, else the sentence to
   * show and the key of the question it belongs to (after a 409 that is the
   * NEW question's key, so the message survives the re-render).
   */
  answer: (approval: Approval, choice: number) => Promise<{ error: string; key: string }>
  /** Send a failed message again (it becomes a new send). */
  retry?: (sendId: string) => void
  /** Drop a failed message. */
  discard?: (sendId: string) => void
}
export const ThreadActionsContext = createContext<ThreadActions>({ answer: async (a) => ({ error: 'not wired', key: a.key }) })

function useCustom(): LineCustom {
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

function LiveText({ text, clock }: { text: string; clock: LiveClock }) {
  // A quarter-second tick is what moves the bold between polls.
  const now = useTick(!clock.paused, 250)
  const current = sentenceAt(clock, now)
  const { parts, tail } = liveParts(text, clock.sentences)
  return (
    <p className="line-text live-text">
      {parts.map((p, i) => (
        <span key={i}>
          {p.lead}
          <span className={i === current ? 'sentence now' : i < current ? 'sentence said' : 'sentence'}>{p.text}</span>
        </span>
      ))}
      {/* Not rendered to speech yet: shown, never bold (the sentences grow into it). */}
      {tail && <span className="sentence pending">{tail}</span>}
    </p>
  )
}

/**
 * Text part: plain, or — the spoken reply of the message being said — with
 * its sentence in bold (§6.2). The whole text is shown from the start.
 */
export const LineText: TextMessagePartComponent = ({ text }) => {
  const custom = useCustom()
  if (custom.live && text === custom.liveText) return <LiveText text={text} clock={custom.live} />
  return <p className="line-text">{text}</p>
}

// ── Reasoning and tool steps ──────────────────────────────────────────────

/**
 * A reasoning part: the model's words behind a collapsed "Thinking"
 * disclosure (rendered only when opened), or — REALITY on red5, ~90 % of
 * them — thinking whose text Claude Code does not keep: a small "thought"
 * marker, never an empty box.
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
      <button className="msg-key on" aria-label={live.paused ? 'Resume' : 'Pause'} onClick={toggle}>
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

/** A permission prompt / Codex approval / any dialog, as its own message. */
export const ApprovalToolUI: ToolCallMessagePartComponent<ApprovalArgs> = ({ args }) => {
  const approval = args.approval
  return (
    <div className="tool-card approval">
      <p className="tool-title">{approval.question || 'The session is waiting on a question'}</p>
      <ApprovalOptions approval={approval} />
    </div>
  )
}

/**
 * An AskUserQuestion, as asked (§14). While it is still the dialog on screen
 * (`args.approval`), its options are live buttons; otherwise it is answered
 * and read-only, with the chosen labels marked.
 */
export const AskToolUI: ToolCallMessagePartComponent<AskArgs> = ({ args }) => {
  const { questions, approval, answeredWith } = args
  const multi = questions.some((q) => q.multiSelect)
  const chosen = (label: string) => answeredWith.includes(label.trim().toLowerCase())
  if (approval) {
    return (
      <div className="tool-card ask">
        {multi ? (
          // v0 gap (§16): a multi-select or free-text answer cannot be pressed
          // by number. The contract's fallback is /focus ("answer at the desk").
          <p className="hint">This question takes several answers — answer it at the desk.</p>
        ) : (
          <ApprovalOptions approval={approval} />
        )}
      </div>
    )
  }
  return (
    <div className="tool-card ask answered">
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
