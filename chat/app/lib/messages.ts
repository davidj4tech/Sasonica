/**
 * Helpers over §6.2.2 messages: the words as shown, the live message, the
 * cache's plain copy, and applying the stream's events.
 */
import type { LiveEvent, LiveFields, Message, MessagePart } from '../api/types'

// ── The words as shown ────────────────────────────────────────────────────

/** `[[visual: …]]` / `[[reveal: …]]` (intake/_visual.py `_MARKER`). */
const MARKER = /\[\[\s*(?:visual|reveal)\s*:\s*[\s\S]+?\s*\]\]/gi

/**
 * A text part as the chat shows it. REALITY (red5, 22 Sep 2026): message
 * text is the transcript's own — markdown and `[[visual:]]` markers
 * included — where lines were the spoken, stripped words. The speech's
 * `sentences` are stripped the server's way (intake/_text.py
 * `strip_markdown`), and the follow-along walks the shown text against
 * them character by character, so the same inline rules are applied here:
 * markers out, emphasis/code/heading/bullet/quote markers off, a link's
 * text kept. Paragraph breaks are kept (the walk skips whitespace).
 * Code fences are left as they are (the server speaks a placeholder for
 * them; the reader wants the code), which only puts the bold back on its
 * space-joined fallback for that reply.
 */
export function shownText(raw: string): string {
  if (!raw) return ''
  let out = raw.replace(MARKER, ' ')
  out = out.replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, '$1')
  out = out.replace(/^#{1,6}\s+/gm, '')
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, '$1')
  out = out.replace(/(?<!\*)\*([^*\n]+)\*/g, '$1')
  out = out.replace(/`([^`\n]+)`/g, '$1')
  out = out.replace(/^[ \t]*[-*][ \t]+/gm, '')
  out = out.replace(/^[ \t]*>[ \t]?/gm, '')
  out = out.replace(/\*\*/g, '')
  // A marker alone on a line leaves spaces behind; tidy the ends of lines.
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

/**
 * The trailing run of text parts — the reply itself, what the Stop hook
 * speaks (§6.2.2 "the text parts after its last tool, joined") — as the
 * index of its first part, or -1 when the message ends in a tool.
 */
export function replyStart(parts: MessagePart[]): number {
  let i = parts.length
  while (i > 0 && parts[i - 1].type === 'text') i--
  return i < parts.length ? i : -1
}

/** A user message's words (its text parts, joined). */
export function userText(m: Message): string {
  return m.parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n\n')
}

// ── Live ──────────────────────────────────────────────────────────────────

/** The message being spoken, as the `live` event carries it (`transcript.live_of`). */
export function liveOf(messages: Message[]): LiveEvent {
  for (const m of messages) {
    const live = m.spoken?.live
    if (live) return { id: m.id, at: m.spoken!.at, ...live }
  }
  return null
}

/** The live fields alone (for liveClockOf). */
export function liveFields(ev: NonNullable<LiveEvent>): LiveFields {
  const { sentences, sentence, offsets, elapsed, server_time, delay, paused } = ev
  return { sentences, sentence, offsets, elapsed, server_time, delay, paused }
}

// ── The cache's copy ──────────────────────────────────────────────────────

/**
 * A cached message is history, never "now": no follow-along clock (it would
 * bold the wrong sentence) and no running turn (it would show a spinner
 * that nothing will stop). The first fresh snapshot puts both back.
 */
export function plainMessage(m: Message): Message {
  const live = !!m.spoken?.live
  if (!live && !m.turn?.running) return m
  const spoken = m.spoken && live ? (({ live: _l, ...rest }) => rest)(m.spoken) : m.spoken
  return { ...m, spoken, turn: { running: false } }
}

// ── Stream events ─────────────────────────────────────────────────────────

/**
 * Apply a `message` event (§11): keep messages by id; `append` adds at the
 * end unless the id is held already (possible between a snapshot and the
 * first event), then it replaces; `replace` replaces in place (and appends
 * if, somehow, the id was never seen).
 */
export function applyMessage(list: Message[], op: 'append' | 'replace', m: Message): Message[] {
  const i = list.findIndex((x) => x.id === m.id)
  if (i >= 0) {
    const next = list.slice()
    next[i] = m
    return next
  }
  void op
  return [...list, m]
}

/**
 * A fresh snapshot replaces the thread (§11 "a client replaces its thread
 * state with each snapshot") — except the older pages loaded by hand above
 * it: whatever is held before the snapshot's first message stays, when that
 * message is still held (no gap between them). Returns the merged list and
 * whether more exist before its first message.
 */
export function mergeSnapshot(held: Message[], heldOlder: boolean, snap: Message[], snapOlder: boolean): { messages: Message[]; older: boolean } {
  if (!snap.length) return { messages: snap, older: snapOlder }
  const at = held.findIndex((m) => m.id === snap[0].id)
  if (at > 0) return { messages: [...held.slice(0, at), ...snap], older: heldOlder }
  return { messages: snap, older: snapOlder }
}

/** A compact change signature of a list (for the cache and the fast cadence). */
export function signature(list: Message[]): string {
  const last = list[list.length - 1]
  if (!last) return '0'
  return `${list.length}|${last.id}|${last.parts.length}|${last.turn?.running ? 1 : 0}|${last.spoken?.id ?? ''}`
}

/**
 * A jump's page (`?around=`, §6.14) — from a few before the message searched
 * for through the newest — laid over what is held: the page's messages in
 * its order (the held copy of any the stream has updated since), then any
 * held ones newer than its last. The next snapshot joins on below it
 * (`mergeSnapshot` keeps what is held before its first message).
 */
export function mergeAround(held: Message[], page: Message[]): Message[] {
  if (!page.length) return held
  const byId = new Map(held.map((m) => [m.id, m]))
  const ids = new Set(page.map((m) => m.id))
  const lastAt = page[page.length - 1].at
  return [...page.map((m) => byId.get(m.id) || m), ...held.filter((m) => !ids.has(m.id) && m.at > lastAt)]
}

/** The message a jump lands on when its id is not held: the last one at or before `at`. */
export function nearestAt(list: Message[], at: number): Message | null {
  let best: Message | null = null
  for (const m of list) if (m.at <= at + 0.5) best = m
  return best || list[0] || null
}
