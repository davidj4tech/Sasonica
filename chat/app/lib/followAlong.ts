/**
 * Follow-along: which sentence of the live line the voice is on
 * (server-contract.md §6.2 "Follow-along").
 *
 * The contract's formula is: the last offset ≤ elapsed + (now − server_time)
 * − delay. That mixes the server's clock (`server_time`) with ours (`now`),
 * so any skew between the phone and red5 moves the bold. Sasonica's
 * ConversationLog.vue measures the interval on the local clock instead —
 * `elapsed` plus however long ago WE received it — which is skew-free; that
 * is what this does. The answer's transit is taken off (TRANSIT_CAP_MS),
 * and the bold leads the clock by the per-device lead (lib/followLead.ts),
 * because a sentence is taken in as it starts.
 */
import type { Line, LiveFields } from '../api/types'
import { getFollowLead } from './followLead'

/**
 * How long ago, at most, `elapsed` was true when its answer arrives.
 * MEASURED (red5, 22 Sep 2026, on the canvas's own host so one clock): the
 * server stamps `server_time` — and ages `elapsed` to it — at the very END
 * of /conversation/log (receive − server_time: 0.00 s median over 979
 * polls, while the request itself took 0.2–2.6 s). So the age at receipt is
 * the one-way trip back, not half the round trip: half a 2 s poll would
 * push the bold ~1 s ahead. Capped at a phone→red5 hop (RTT ~0.43 s).
 */
const TRANSIT_CAP_MS = 250
/** Speaking rate for the estimate when a live line has no offsets and no index. */
const EST_CHARS_PER_S = 14

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
  return liveClockFrom(line as LiveFields, receivedAtMs, roundTripMs)
}

/**
 * The clock from §6.2.2 `spoken.live` or a §11 `live` event. For a stream
 * event the "round trip" is the connection's (headers back after the
 * request went): the server ages `elapsed` to the moment it reads it and
 * sends the event at once, so the age at receipt is the one-way trip.
 */
export function liveClockFrom(f: Partial<LiveFields>, receivedAtMs: number, roundTripMs: number): LiveClock | null {
  if (!f.sentences?.length) return null
  const paused = !!f.paused
  return {
    sentences: f.sentences,
    offsets: f.offsets || [],
    sentence: f.sentence ?? null,
    elapsed: Number(f.elapsed) || 0,
    delay: Number(f.delay) || 0,
    paused,
    anchorMs: paused ? receivedAtMs : receivedAtMs - Math.min(roundTripMs / 2, TRANSIT_CAP_MS)
  }
}

/**
 * The live message's words grew (streamed clips) without the clock moving:
 * take the longer sentence list, keep the anchor. (§11 sends `live` when
 * the offsets change; with no offsets, only the message's `spoken.live`
 * shows the growth.)
 */
export function withGrowth(clock: LiveClock, f: Partial<LiveFields>): LiveClock {
  const s = f.sentences || []
  const o = f.offsets || []
  if (s.length <= clock.sentences.length && o.length <= clock.offsets.length) return clock
  return { ...clock, sentences: s.length > clock.sentences.length ? s : clock.sentences, offsets: o.length > clock.offsets.length ? o : clock.offsets }
}

/** The sentence to bold at local time `nowMs`, or -1. Never moves while paused. */
export function sentenceAt(clock: LiveClock, nowMs: number): number {
  const raw = clock.paused ? clock.elapsed : clock.elapsed + (nowMs - clock.anchorMs) / 1000
  // The per-device lead (Settings), read per tick from a cached value.
  const heard = raw - clock.delay + getFollowLead()
  if (!clock.offsets.length) {
    if (clock.sentence !== null && clock.sentence >= 0) return Math.min(clock.sentence, clock.sentences.length - 1)
    // Neither offsets nor an index: estimate from speaking rate, so there is
    // still a sentence to bold and to follow (never -1 while there is text).
    let chars = heard * EST_CHARS_PER_S
    for (let i = 0; i < clock.sentences.length; i++) {
      chars -= clock.sentences[i].length + 1
      if (chars < 0) return i
    }
    return clock.sentences.length - 1
  }
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
 *
 * `tail` is the text the sentences do not cover yet. REALITY (red5, 22 Sep
 * 2026, streamed clips): a live reply's `sentences` (and `offsets`) GROW
 * while it is spoken — the first poll of a 1188-character reply carried 7
 * sentences covering 519 characters, the fourth 17. Rendering only the
 * sentences made the bubble shrink to 44 % when the line went live and grow
 * back poll by poll, and every growth was a content resize that the
 * thread's auto-scroll answered by jumping to the bottom. The whole text is
 * shown from the start; the uncovered part is plain, unsaid text.
 */
export function liveParts(text: string, sentences: string[]): { parts: { lead: string; text: string }[]; tail: string } {
  const gap = (from: number) => {
    let p = from
    while (p < text.length && /\s/.test(text[p])) p++
    const breaks = text.slice(from, p).replace(/[^\n]/g, '')
    return { end: p, ws: breaks || ' ' }
  }
  const fallback = () => {
    const parts = sentences.map((t, i) => ({ lead: i ? ' ' : '', text: t }))
    // Where the last sentence ends in the real text, by its last few words.
    const last = sentences[sentences.length - 1] || ''
    const probe = last.slice(-24)
    const at = probe ? text.lastIndexOf(probe) : -1
    return { parts, tail: at >= 0 ? text.slice(at + probe.length) : '' }
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
        if (!/\s/.test(text[p] || '')) return fallback()
        const run = gap(p)
        p = run.end
        out += run.ws
      } else if (sentence[k] === text[p]) {
        out += sentence[k++]
        p++
      } else {
        return fallback()
      }
    }
    parts.push({ lead: i ? lead.ws : '', text: out })
  }
  return { parts, tail: text.slice(p) }
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

/**
 * The clock with `skewS` more playout delay: the bold held back by that
 * much. For the log's `elapsed` running ahead of what the listener hears
 * (see useElapsedSkew in routes/thread.tsx).
 */
export function withSkew(clock: LiveClock, skewS: number): LiveClock {
  if (!skewS) return clock
  return { ...clock, delay: clock.delay + skewS }
}
