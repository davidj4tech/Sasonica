/**
 * Follow-along: which sentence of the live line the voice is on
 * (server-contract.md §6.2 "Follow-along").
 *
 * The contract's formula is: the last offset ≤ elapsed + (now − server_time)
 * − delay. That mixes the server's clock (`server_time`) with ours (`now`),
 * so any skew between the phone and red5 moves the bold. Sasonica's
 * ConversationLog.vue measures the interval on the local clock instead —
 * `elapsed` plus however long ago WE received it — which is skew-free; that
 * is what this does. It also borrows two of that file's measured tweaks:
 * half the round trip is added for the answer's transit, and the bold leads
 * the clock by 0.3 s, because a sentence is taken in as it starts.
 */
import type { Line } from '../api/types'

/** How far ahead of the clock the bold moves on (ConversationLog.vue). */
export const FOLLOW_LEAD_S = 0.3

export interface LiveClock {
  sentences: string[]
  offsets: number[]
  /** Server's own sentence index, used when there are no offsets. */
  sentence: number | null
  elapsed: number
  delay: number
  paused: boolean
  /** Local epoch ms when `elapsed` was true (receipt, less half the trip). */
  anchorMs: number
}

export function liveClockOf(line: Line, receivedAtMs: number, roundTripMs: number): LiveClock | null {
  if (!line.live || !line.sentences?.length) return null
  const paused = !!line.paused
  return {
    sentences: line.sentences,
    offsets: line.offsets || [],
    sentence: line.sentence ?? null,
    elapsed: Number(line.elapsed) || 0,
    delay: Number(line.delay) || 0,
    paused,
    anchorMs: paused ? receivedAtMs : receivedAtMs - roundTripMs / 2
  }
}

/** The sentence to bold at local time `nowMs`, or -1. Never moves while paused. */
export function sentenceAt(clock: LiveClock, nowMs: number): number {
  if (!clock.offsets.length) return clock.sentence ?? -1
  const raw = clock.paused ? clock.elapsed : clock.elapsed + (nowMs - clock.anchorMs) / 1000
  const heard = raw - clock.delay + FOLLOW_LEAD_S
  let idx = 0
  clock.offsets.forEach((off, i) => {
    if (heard + 0.001 >= off) idx = i
  })
  return idx
}

/**
 * The live line's sentences with the whitespace the reply really had between
 * and inside them (ported from ConversationLog.vue `liveParts`). The speech
 * splitter joins and trims on any whitespace, so a newline between list items
 * would come back as a space until the turn ended. Walked character by
 * character; anything that does not line up falls back to space-joined.
 */
export function liveParts(text: string, sentences: string[]): { lead: string; text: string }[] {
  const plain = sentences.map((t, i) => ({ lead: i ? ' ' : '', text: t }))
  const gap = (from: number) => {
    let p = from
    while (p < text.length && /\s/.test(text[p])) p++
    const breaks = text.slice(from, p).replace(/[^\n]/g, '')
    return { end: p, ws: breaks || ' ' }
  }
  const parts: { lead: string; text: string }[] = []
  let p = 0
  for (let i = 0; i < sentences.length; i++) {
    const lead = gap(p)
    p = lead.end
    const sentence = sentences[i]
    let out = ''
    for (let k = 0; k < sentence.length; ) {
      if (/\s/.test(sentence[k])) {
        while (k < sentence.length && /\s/.test(sentence[k])) k++
        if (!/\s/.test(text[p] || '')) return plain
        const run = gap(p)
        p = run.end
        out += run.ws
      } else if (sentence[k] === text[p]) {
        out += sentence[k++]
        p++
      } else {
        return plain
      }
    }
    parts.push({ lead: i ? lead.ws : '', text: out })
  }
  return parts
}

/** 42s, 3m 38s, 1h 5m — the terminal's own shorthand. */
export function duration(seconds: number): string {
  const s = Math.round(Number(seconds) || 0)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * The live clock as the speech bar says it is, between a tap and the log
 * poll that confirms it: paused at the moment of the tap (the bold stops
 * where the voice did), or running on from where it was frozen. Pure in
 * (clock, paused, atMs), so a memo holds it steady across renders.
 */
export function withPaused(clock: LiveClock, paused: boolean, atMs: number): LiveClock {
  if (clock.paused === paused) return clock
  if (paused) {
    const elapsed = clock.elapsed + Math.max(0, atMs - clock.anchorMs) / 1000
    return { ...clock, paused: true, elapsed, anchorMs: atMs }
  }
  return { ...clock, paused: false, anchorMs: atMs }
}
