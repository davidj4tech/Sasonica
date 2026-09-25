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
import { BLOCK_CLOSE, BLOCK_OPEN, LINK_CLOSE, LINK_OPEN, LINK_URL, SAY_AS, SAY_CLOSE, SAY_OPEN } from './messages'
import type { Line, LiveFields, Message, SpeechNow, Timeline } from '../api/types'
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
 * The clock for a turn the server is NOT calling live (§6.2 `timeline`,
 * §6.5 `turn`).
 *
 * `live` exists only while the server's now-playing row names the reply, and
 * a barge-in — or a submit that died, or a phone playing clips it was already
 * handed — takes that row away while the audio plays on. The bold then had
 * nothing to ride and stopped for the rest of the reply.
 *
 * The turn's words and offsets survive on `spoken.timeline`; the position
 * comes from the player instead of from a dead `elapsed`. `/speech/now.turn`
 * is what makes `pos` usable — it says which turn the position is INTO, so a
 * message only takes it when the player names that same turn (`at`, or the
 * history row on a replay).
 *
 * `delay` is 0: `pos` is where the player itself has got to, so the hop to it
 * has already happened. `paused` freezes the clock exactly as it does live.
 */
export function playerClockOf(
  message: Message,
  now: SpeechNow | null,
  askedAtMs: number
): LiveClock | null {
  const timeline = message.spoken?.timeline
  if (!timeline?.sentences?.length || !now?.live || now.pos == null) return null
  if (!isThisTurn(message, now)) return null
  return {
    sentences: timeline.sentences,
    offsets: timeline.offsets || [],
    sentence: null,
    elapsed: Number(now.pos) || 0,
    delay: 0,
    paused: !!now.paused,
    // `pos` is no newer than the moment its request was SENT (useSpeech's
    // `nowAskedAt`) — the same rule the skew estimate uses, for the same
    // reason: dating it to receipt would run the bold ahead by the trip.
    anchorMs: askedAtMs
  }
}

/** Is the voice on this very turn? `id` wins on a replay; else the line's `at`. */
export function isThisTurn(message: Message, now: SpeechNow | null): boolean {
  const turn = now?.turn
  const spoken = message.spoken
  if (!turn || !spoken) return false
  if (turn.id && spoken.id) return turn.id === spoken.id
  return Math.abs(Number(turn.at) - Number(spoken.at)) < 0.01
}

/** Does this message carry a timeline nothing is claiming to play? */
export function timelineOf(message: Message): Timeline | null {
  return message.spoken?.timeline?.sentences?.length ? message.spoken.timeline : null
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
 * A table or code block (lib/messages.ts BLOCK_OPEN) is one step: the voice
 * describes it, so the sentence(s) saying it are bold on the block itself.
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
export type LivePart = {
  /** Whitespace (and any block the voice skipped) before the sentence. */
  lead: string
  /** The sentence as shown — or a whole table/code block the voice described. */
  text: string
  /** The first sentence index this part is; `span` sentences in all (a described block can take several). */
  i: number
  span: number
}

/** How many sentences a described table or code block may take before the walk gives up on it. */
const BLOCK_SENTENCES = 4

export function liveParts(text: string, sentences: string[]): { parts: LivePart[]; tail: string } {
  const gap = (from: number) => {
    let p = from
    while (p < text.length && /\s/.test(text[p])) p++
    const breaks = text.slice(from, p).replace(/[^\n]/g, '')
    return { end: p, ws: breaks || ' ' }
  }
  const fallback = () => {
    const parts = sentences.map((t, i) => ({ lead: i ? ' ' : '', text: t, i, span: 1 }))
    // Where the last sentence ends in the real text, by its last few words.
    const last = sentences[sentences.length - 1] || ''
    const probe = last.slice(-24)
    const at = probe ? text.lastIndexOf(probe) : -1
    return { parts, tail: at >= 0 ? text.slice(at + probe.length) : '' }
  }
  // A link's marks are copied, never compared: its open and close are zero
  // width, its url is not spoken. `opens` is false at a sentence's end, so a
  // link that follows starts the next part rather than trailing this one.
  const hidden = (p: number, opens = true) => {
    for (;;) {
      if (text[p] === LINK_CLOSE || (opens && text[p] === LINK_OPEN)) p++
      else if (text[p] === LINK_URL) {
        const c = text.indexOf(LINK_CLOSE, p)
        p = c < 0 ? text.length : c + 1
      } else return p
    }
  }
  const match = (sentence: string, from: number): { out: string; end: number } | null => {
    let p = from
    let out = ''
    for (let k = 0; k < sentence.length; ) {
      const h = hidden(p)
      out += text.slice(p, h)
      p = h
      if (text[p] === SAY_OPEN) {
        // A bare address: shown as itself, said as "<host> link".
        const as = text.indexOf(SAY_AS, p)
        const close = text.indexOf(SAY_CLOSE, p)
        if (as < 0 || close < as) return null
        const said = text.slice(as + 1, close)
        if (!sentence.startsWith(said, k)) return null
        out += text.slice(p, close + 1)
        p = close + 1
        k += said.length
      } else if (/\s/.test(sentence[k])) {
        while (k < sentence.length && /\s/.test(sentence[k])) k++
        if (!/\s/.test(text[p] || '')) return null
        const run = gap(p)
        p = run.end
        out += run.ws
      } else if (sentence[k] === text[p]) {
        out += sentence[k++]
        p++
      } else {
        return null
      }
    }
    const h = hidden(p, false)
    return { out: out + text.slice(p, h), end: h }
  }
  const blockEnd = (p: number) => {
    const c = text.indexOf(BLOCK_CLOSE, p)
    return c < 0 ? text.length : c + 1
  }
  const parts: LivePart[] = []
  let p = 0
  for (let i = 0; i < sentences.length; i++) {
    const lead = gap(p)
    p = lead.end
    let before = i ? lead.ws : ''
    let described = false
    while (text[p] === BLOCK_OPEN) {
      const end = blockEnd(p)
      const after = gap(end)
      if (match(sentences[i], after.end)) {
        // Not spoken at all: the block is part of the gap before this sentence.
        before += text.slice(p, end) + after.ws
        p = after.end
        continue
      }
      // Said as a description: this sentence and any after it that do not
      // yet line up with the words past the block.
      let span = 1
      while (i + span < sentences.length && !match(sentences[i + span], after.end)) {
        if (++span > BLOCK_SENTENCES) return fallback()
      }
      parts.push({ lead: before, text: text.slice(p, end), i, span })
      i += span - 1
      p = end
      described = true
      break
    }
    if (described) continue
    const m = match(sentences[i], p)
    if (!m) return fallback()
    parts.push({ lead: before, text: m.out, i, span: 1 })
    p = m.end
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

