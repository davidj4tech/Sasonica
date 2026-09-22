/**
 * Messages → assistant-ui messages, per server-contract.md §14.
 *
 * | ThreadMessageLike | From the message (§6.2.2)                                 |
 * | id                | `message.id` — stable as the message grows                  |
 * | role              | `message.role`                                              |
 * | createdAt         | new Date(at * 1000)                                         |
 * | content           | text → text (shownText: markers and markdown off); the      |
 * |                   | trailing run of text parts — the reply that is spoken — is  |
 * |                   | one text part; reasoning → reasoning (redacted → text ""); |
 * |                   | tool → tool-call {args: {summary, title}, result} (no       |
 * |                   | result while running, isError on error); ask → tool-call    |
 * |                   | AskUserQuestion; pictures from `spoken.images`              |
 * | status            | running while `turn.running`, else complete                 |
 * | metadata.custom   | {command, spoken id, figure, live, liveText}                |
 *
 * `approval` (what is on screen now) is a message of its own at the foot of
 * the thread, answered with POST /session/answer — except a question
 * (`kind: "question"`) whose ask part is still pending among the messages
 * (a headless session streams it): the card goes on that part instead. A
 * pane session's AskUserQuestion is written to the transcript only once
 * answered (§6.2.2), so its card stands alone at the foot.
 */
import type { ThreadMessageLike } from '@assistant-ui/react'
import { pictureUrl } from '../api'
import type { Approval, AskQuestion, Message, SessionId } from '../api/types'
import type { LiveClock } from './followAlong'
import { replyStart, shownText, userText } from './messages'
import type { PendingSend } from './pending'

export const ASK_TOOL = 'AskUserQuestion'
export const APPROVAL_TOOL = 'SessionApproval'

/** What the thread view holds; one of these per rendered message. */
export type ChatItem =
  | {
      kind: 'message'
      session: SessionId
      message: Message
      live: LiveClock | null
      /** The question on screen, shown on this message's pending ask part `askPart`. */
      approval?: Approval
      askPart?: number
    }
  | { kind: 'approval'; session: SessionId; approval: Approval }
  /** Sent from here, not yet back (lib/pending.ts). */
  | { kind: 'optimistic'; session: SessionId; send: PendingSend }

export interface LineCustom {
  command?: Message['command']
  /** Sent by another session, not the listener: shown as a small note. */
  peer?: { name: string }
  /** Speech-history row for `replay-id`. */
  id?: number
  /** The thread, for `goto-sentence` ("read from here" in the live message). */
  session?: SessionId
  figure?: boolean
  live?: LiveClock | null
  /** The text part the follow-along bolds: the spoken reply, as shown. */
  liveText?: string
  optimistic?: boolean
  /** The pending send behind an optimistic message. */
  send?: PendingSend
  [k: string]: unknown
}

export interface AskArgs {
  session: SessionId
  questions: AskQuestion[]
  /** Kept for the tool UI's shape; the ask on screen is the approval item. */
  approval: Approval | null
  /** The chosen label(s), lower-cased. */
  answeredWith: string[]
  /** The answer as the agent got it, e.g. "Apple, Plum, kiwi". */
  answerText: string
  [k: string]: unknown
}

export interface ApprovalArgs {
  session: SessionId
  approval: Approval
  [k: string]: unknown
}

/** A tool step's args (§14: `{summary: input_summary, title}`), plus the name for the UI. */
export interface StepArgs {
  title: string
  summary: string
  status: 'running' | 'done' | 'error'
  [k: string]: unknown
}

type Part = Exclude<ThreadMessageLike['content'], string>[number]

function answeredWith(answer: string): string[] {
  return (answer || '')
    .split(/,\s*/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function convertItem(item: ChatItem): ThreadMessageLike {
  if (item.kind === 'optimistic') {
    return {
      id: `${item.session}:local:${item.send.id}`,
      role: 'user',
      createdAt: new Date(item.send.at * 1000),
      content: [{ type: 'text', text: item.send.text }],
      metadata: { custom: { optimistic: true, send: item.send } }
    }
  }

  if (item.kind === 'approval') {
    return {
      // Stable while the dialog changes, so the card updates in place.
      id: `${item.session}:approval`,
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: `${item.session}:approval`,
          toolName: APPROVAL_TOOL,
          args: { session: item.session, approval: item.approval } as unknown as Record<string, never>
        }
      ],
      status: { type: 'requires-action', reason: 'tool-calls' }
    }
  }

  const { message: m, session } = item
  const spoken = m.spoken
  const custom: LineCustom = {
    command: m.command ?? undefined,
    peer: m.peer ?? undefined,
    id: spoken?.id ?? undefined,
    figure: spoken?.figure,
    live: item.live,
    session
  }

  if (m.role === 'user') {
    return {
      id: m.id,
      role: 'user',
      createdAt: new Date(m.at * 1000),
      content: [{ type: 'text', text: userText(m) }],
      metadata: { custom }
    }
  }

  const content: Part[] = []
  const reply = replyStart(m.parts)
  m.parts.forEach((p, i) => {
    if (reply >= 0 && i > reply) return // merged into the reply part below
    if (reply >= 0 && i === reply) {
      const text = m.parts
        .slice(reply)
        .map((x) => (x.type === 'text' ? shownText(x.text) : ''))
        .filter(Boolean)
        .join('\n\n')
      if (text) {
        content.push({ type: 'text', text })
        custom.liveText = text
      }
      return
    }
    switch (p.type) {
      case 'text': {
        const text = shownText(p.text)
        if (text) content.push({ type: 'text', text })
        return
      }
      case 'reasoning':
        // assistant-ui drops a reasoning part with no text AND no summary
        // (thread-message-like.js), so a redacted one carries a summary:
        // it stays a part — the "thought" marker — with its text empty.
        if (p.redacted || !p.text) content.push({ type: 'reasoning', text: '', unstable_summary: 'thought' })
        else content.push({ type: 'reasoning', text: p.text })
        return
      case 'tool': {
        const args: StepArgs = { title: p.title || p.name, summary: p.input_summary || '', status: p.status, name: p.name }
        content.push({
          type: 'tool-call',
          toolCallId: p.tool_use_id || `${m.id}:${i}`,
          toolName: p.name || 'tool',
          args: args as unknown as Record<string, never>,
          ...(p.status === 'running' ? {} : { result: p.result_summary || '', isError: p.status === 'error' })
        })
        return
      }
      case 'ask': {
        const onScreen = item.askPart === i && item.approval ? item.approval : null
        const args: AskArgs = { session, questions: p.ask || [], approval: onScreen, answeredWith: answeredWith(p.answer), answerText: p.answer || '' }
        content.push({
          type: 'tool-call',
          toolCallId: p.tool_use_id || `${m.id}:${i}:ask`,
          toolName: ASK_TOOL,
          args: args as unknown as Record<string, never>,
          ...(onScreen ? {} : { result: { answered: args.answeredWith } })
        })
        return
      }
    }
  })
  for (const src of spoken?.images || []) {
    const url = pictureUrl(src)
    // §14: assistant-ui's converter keeps an image part only for https:,
    // blob: or data: URLs and silently drops the rest — and the canvas
    // serves plain http on the tailnet. So an http picture travels as a
    // `data-picture` part, rendered by the same component.
    if (/^(https:|blob:|data:image\/)/i.test(url)) content.push({ type: 'image', image: url })
    else content.push({ type: 'data-picture', data: { src: url } })
  }

  return {
    id: m.id,
    role: 'assistant',
    createdAt: new Date(m.at * 1000),
    content,
    status: m.turn?.running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { custom }
  }
}

/**
 * The thread's items: its messages (the live one carrying the clock), the
 * sends not back yet, and the dialog on screen at the foot.
 */
export function buildItems(args: {
  session: SessionId
  messages: Message[]
  approval: Approval | null
  live: LiveClock | null
  liveId: string | null
  optimistic: PendingSend[]
}): ChatItem[] {
  const { session, messages, approval, live, liveId } = args
  const items: ChatItem[] = messages.map((message) => ({ kind: 'message', session, message, live: live && message.id === liveId ? live : null }))
  const target = approval ? pendingAsk(messages, approval) : null
  if (target && approval) {
    const it = items[target.message]
    if (it.kind === 'message') {
      it.approval = approval
      it.askPart = target.part
    }
  }
  for (const send of args.optimistic) items.push({ kind: 'optimistic', session, send })
  if (approval && !target) items.push({ kind: 'approval', session, approval })
  return items
}

/**
 * The still-pending ask part a question approval belongs to: the one with
 * its `tool_use_id` when both carry one, else the latest running ask. None
 * for a pane session, whose ask is written only once answered.
 */
export function pendingAsk(messages: Message[], approval: Approval): { message: number; part: number } | null {
  if (approval.kind !== 'question') return null
  let latest: { message: number; part: number } | null = null
  for (let mi = 0; mi < messages.length; mi++) {
    const parts = messages[mi].parts || []
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]
      if (p.type !== 'ask' || p.status !== 'running') continue
      if (approval.tool_use_id && p.tool_use_id) {
        if (p.tool_use_id === approval.tool_use_id) return { message: mi, part: pi }
        continue
      }
      latest = { message: mi, part: pi }
    }
  }
  return latest
}

/**
 * How the thread groups an assistant message's parts: each maximal run of
 * tool calls and reasoning that holds at least one tool is one "Worked · N
 * steps" block (the terminal folds them the same way); a run of reasoning
 * alone stays as its own parts (a "Thinking" disclosure, or a small
 * "thought" marker when redacted). Text, asks and pictures are never in a
 * block.
 */
export function groupParts(parts: readonly { type: string; toolName?: string }[]): { groupKey: string | undefined; indices: number[] }[] {
  const groups: { groupKey: string | undefined; indices: number[] }[] = []
  const isStep = (p: { type: string; toolName?: string }) => p.type === 'reasoning' || (p.type === 'tool-call' && p.toolName !== ASK_TOOL && p.toolName !== APPROVAL_TOOL)
  let i = 0
  while (i < parts.length) {
    if (!isStep(parts[i])) {
      groups.push({ groupKey: undefined, indices: [i] })
      i++
      continue
    }
    let j = i
    while (j < parts.length && isStep(parts[j])) j++
    const run = Array.from({ length: j - i }, (_, k) => i + k)
    if (run.some((k) => parts[k].type === 'tool-call')) groups.push({ groupKey: `work:${i}`, indices: run })
    else for (const k of run) groups.push({ groupKey: undefined, indices: [k] })
    i = j
  }
  return groups
}
