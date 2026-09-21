/**
 * Log lines → assistant-ui messages, per server-contract.md §14.
 *
 * | ThreadMessageLike | From the line                                         |
 * | id                | `${session}:${line.at}` — stable across live → done  |
 * | role              | who == "you" → user, else assistant                    |
 * | createdAt         | new Date(at * 1000)                                    |
 * | content           | text; one image part per `images`; `ask` → tool-call   |
 * | status            | complete; running for the live line while speaking     |
 * | metadata.custom   | {work, command, id, figure, live}                      |
 *
 * `approval` (what is on screen now) is attached to the latest ask's tool
 * call when that ask is still the last thing said; otherwise it becomes a
 * message of its own at the foot of the thread, rendered by the same kind of
 * tool UI. Either way it is answered with POST /session/answer.
 */
import type { ThreadMessageLike } from '@assistant-ui/react'
import { pictureUrl } from '../api'
import type { Approval, AskQuestion, Line, SessionId, WorkSummary } from '../api/types'
import type { LiveClock } from './followAlong'

export const ASK_TOOL = 'AskUserQuestion'
export const APPROVAL_TOOL = 'SessionApproval'

/** What the thread view holds; one of these per rendered message. */
export type ChatItem =
  | { kind: 'line'; session: SessionId; line: Line; live: LiveClock | null; approval: Approval | null; answeredWith: string[] }
  | { kind: 'approval'; session: SessionId; approval: Approval }
  /** Sent from here, not yet back in the log. */
  | { kind: 'optimistic'; session: SessionId; text: string; at: number }

export interface LineCustom {
  work?: WorkSummary
  command?: Line['command']
  id?: number
  figure?: boolean
  live?: LiveClock | null
  optimistic?: boolean
  [k: string]: unknown
}

export interface AskArgs {
  session: SessionId
  questions: AskQuestion[]
  /** Present while this ask is still the dialog on screen. */
  approval: Approval | null
  /** The listener's answer (the next "you" line), split on commas. */
  answeredWith: string[]
  [k: string]: unknown
}

export interface ApprovalArgs {
  session: SessionId
  approval: Approval
  [k: string]: unknown
}

type Part = Exclude<ThreadMessageLike['content'], string>[number]

export function convertItem(item: ChatItem): ThreadMessageLike {
  if (item.kind === 'optimistic') {
    return {
      id: `${item.session}:local:${item.at}`,
      role: 'user',
      createdAt: new Date(item.at * 1000),
      content: [{ type: 'text', text: item.text }],
      metadata: { custom: { optimistic: true } }
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

  const { line, session } = item
  const custom: LineCustom = {
    work: line.work,
    command: line.command ?? undefined,
    id: line.id,
    figure: line.figure,
    live: item.live
  }

  if (line.who === 'you') {
    return {
      id: `${session}:${line.at}`,
      role: 'user',
      createdAt: new Date(line.at * 1000),
      content: [{ type: 'text', text: line.text }],
      metadata: { custom }
    }
  }

  const content: Part[] = [{ type: 'text', text: line.text }]
  for (const src of line.images || []) {
    const url = pictureUrl(src)
    // §14 says image parts. assistant-ui's converter keeps an image part only
    // for https:, blob: or data: URLs and silently drops the rest — and the
    // canvas serves plain http on the tailnet. So an http picture travels as
    // a `data-picture` part, rendered by the same component.
    if (/^(https:|blob:|data:image\/)/i.test(url)) content.push({ type: 'image', image: url })
    else content.push({ type: 'data-picture', data: { src: url } })
  }
  if (line.ask?.length) {
    const args: AskArgs = { session, questions: line.ask, approval: item.approval, answeredWith: item.answeredWith }
    content.push({
      type: 'tool-call',
      toolCallId: `${session}:${line.at}:ask`,
      toolName: ASK_TOOL,
      args: args as unknown as Record<string, never>,
      // Answered and read-only once it is no longer the dialog on screen.
      ...(item.approval ? {} : { result: { answered: item.answeredWith } })
    })
  }

  return {
    id: `${session}:${line.at}`,
    role: 'assistant',
    createdAt: new Date(line.at * 1000),
    content,
    status: line.live && !line.paused ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { custom }
  }
}

/**
 * Build the thread's items from a log poll. `approval` is attached to the
 * last line when it is an agent ask (that ask is still on screen, §14), else
 * appended as its own item.
 */
export function buildItems(args: {
  session: SessionId
  lines: Line[]
  approval: Approval | null
  live: LiveClock | null
  optimistic: { text: string; at: number }[]
}): ChatItem[] {
  const { session, lines, approval, live } = args
  const items: ChatItem[] = []
  const last = lines[lines.length - 1]
  const askOnScreen = !!approval && !!last && last.who === 'agent' && !!last.ask?.length
  lines.forEach((line, i) => {
    const next = lines[i + 1]
    const answeredWith =
      line.ask && next && next.who === 'you'
        ? next.text
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        : []
    items.push({
      kind: 'line',
      session,
      line,
      live: line.live ? live : null,
      approval: askOnScreen && line === last ? approval : null,
      answeredWith
    })
  })
  for (const o of args.optimistic) items.push({ kind: 'optimistic', session, ...o })
  if (approval && !askOnScreen) items.push({ kind: 'approval', session, approval })
  return items
}
