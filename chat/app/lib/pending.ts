/**
 * Messages sent from this device and not yet back in the log as the
 * listener's own line ("you") — and the rule that retires them.
 *
 * REALITY (David's phone, 22 Sep 2026): a sent message showed twice, the
 * "sending…" copy and the server's line, because the old rule matched on
 * time (`line.at >= sentAt − 5 s`), and `at` is the SERVER's clock while
 * `sentAt` was the phone's: any skew past five seconds, or a line that came
 * back in a poll before /reply had even answered, and the two never met.
 *
 * The rule now needs no clock. A send remembers which "you" lines the
 * thread already had when it went out (`before`); the first "you" line
 * that is NOT one of those and says the same words retires it. The words
 * are compared whitespace-normalised (the server keeps the text as typed,
 * but a pane may flatten it), allowing for a `Re: “quote” — ` prefix and a
 * slash command recorded as a chip. A generous time floor
 * (MATCH_WINDOW_S, in either clock) keeps an old, identical message out,
 * should the "before" set have come from a stale snapshot.
 */
import type { Line, Message } from '../api/types'
import { userText } from './messages'

/** What the matcher reads of a line or a message: who said it, when, the words, the chip. */
export type Said = Pick<Line, 'who' | 'at' | 'text' | 'command'>

/** The listener's messages as matcher input (§6.2.2: `role: "user"`, its text parts). */
export function saidOf(messages: Message[]): Said[] {
  return messages.filter((m) => m.role === 'user' && !m.peer).map((m) => ({ who: 'you', at: m.at, text: userText(m), command: m.command ?? undefined }))
}

export type SendState = 'sending' | 'sent' | 'failed' | 'untaken'

export interface PendingSend {
  /** Local id: `${local ms}-${n}`. */
  id: string
  text: string
  /** Local epoch seconds when it was sent (display order only). */
  at: number
  /** `at` of every "you" line the thread had when this was sent. */
  before: number[]
  state: SendState
  /** What went wrong (failed / untaken). */
  error?: string
}

/** Two messages this far apart (in either clock) are never the same send. */
const MATCH_WINDOW_S = 15 * 60
/** A send the server accepted but never echoed is given up after this. */
export const SENT_HOLD_MS = 5 * 60 * 1000

export function normaliseWords(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** `Re: “…” — ` (or straight quotes / a hyphen) in front of a quoted reply. */
const QUOTE_PREFIX = /^Re:\s*[“"][\s\S]*?[”"]\s*[—–-]\s*/

function sameWords(line: Said, sent: string): boolean {
  const want = normaliseWords(sent)
  if (!want) return false
  const got = normaliseWords(line.text || '')
  if (got === want) return true
  if (normaliseWords((line.text || '').replace(QUOTE_PREFIX, '')) === want) return true
  const chip = line.command && typeof line.command.text === 'string' ? normaliseWords(line.command.text) : ''
  if (chip && (chip === want || `${chip} ${got}`.trim() === want)) return true
  return false
}

/**
 * The sends still waiting, given the lines now on screen. Each "you" line
 * retires at most one send (two identical messages need two lines).
 */
export function unmatched(sends: PendingSend[], lines: Said[], nowMs = Date.now()): PendingSend[] {
  if (!sends.length) return sends
  const claimed = new Set<number>()
  const out: PendingSend[] = []
  for (const s of sends) {
    if (s.state === 'sent' && nowMs - s.at * 1000 > SENT_HOLD_MS) continue
    if (s.state === 'failed' || s.state === 'untaken') {
      out.push(s)
      continue
    }
    const before = new Set(s.before)
    const hit = lines.find((l) => l.who === 'you' && !before.has(l.at) && !claimed.has(l.at) && Math.abs(l.at - s.at) < MATCH_WINDOW_S && sameWords(l, s.text))
    if (hit) claimed.add(hit.at)
    else out.push(s)
  }
  return out.length === sends.length ? sends : out
}
