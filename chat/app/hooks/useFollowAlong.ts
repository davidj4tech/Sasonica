/**
 * Keep the sentence being spoken on screen.
 *
 * A thread normally sticks to its bottom (assistant-ui's auto-scroll). While
 * a live line is being spoken that is wrong: a reply taller than the screen
 * keeps its foot in view and the bold sentence — near the top of the reply,
 * early on — goes off the top. So while the live line plays, this takes
 * over: the page's Viewport gets `autoScroll={false}` (the `following` this
 * returns), and every FOLLOW_TICK_MS the bold sentence is checked against
 * the visible band — the viewport less the sticky footer (composer, speech
 * bar). Only when it is leaving that band does the view move, smoothly, to
 * put the sentence's top at FOLLOW_AT of the band: a little above the
 * middle, so it can advance a good way before the next move. No move per
 * tick, so no jitter.
 *
 * A reader who scrolls by hand (wheel, touch drag, paging keys) is left
 * alone: following stops and `detached` is set, for a "Follow along" pill
 * that calls `resume()`. A new live line starts following again.
 *
 * Paused: nothing moves, and the thread's normal behaviour is back (the
 * auto-scroll re-reads "at the bottom?" when it is re-enabled). Ended: if
 * the reader was following, the view goes to the foot, where the thread
 * normally sits.
 *
 * Sits beside hooks/useBottomFirst.ts: that pin owns the first moments of
 * a thread (FOLLOW_START_MS), and its settle ends well before this starts.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const FOLLOW_TICK_MS = 250
/** Let useBottomFirst's opening pin settle first. */
const FOLLOW_START_MS = 1200
/** Where the sentence's top is put, as a fraction of the visible band. */
const FOLLOW_AT = 0.38
/** Band edges kept clear, as a fraction of its height. */
const EDGE = 0.06
/** A smooth scroll in flight: do not measure against it. */
const SCROLL_SETTLE_MS = 700

const PAGING_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '])

export function useFollowAlong(viewportRef: RefObject<HTMLElement | null>, liveKey: number | null, playing: boolean) {
  const [detached, setDetached] = useState(false)
  const [ready, setReady] = useState(false)
  const movingUntilRef = useRef(0)
  const followedRef = useRef(false)

  const following = ready && liveKey !== null && playing && !detached

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), FOLLOW_START_MS)
    return () => window.clearTimeout(t)
  }, [])

  // A new live line: follow it, whatever happened to the last one.
  useEffect(() => {
    setDetached(false)
  }, [liveKey])

  /** Move only if the bold sentence is leaving the band. `force` re-centres it. */
  const place = useCallback(
    (force: boolean) => {
      const el = viewportRef.current
      if (!el || Date.now() < movingUntilRef.current) return
      const now = el.querySelector<HTMLElement>('.live-text .sentence.now')
      if (!now) return
      const view = el.getBoundingClientRect()
      const footer = el.querySelector<HTMLElement>('.footer')
      const bandTop = view.top
      const bandBottom = footer ? Math.min(view.bottom, footer.getBoundingClientRect().top) : view.bottom
      const band = bandBottom - bandTop
      if (band < 40) return
      const r = now.getBoundingClientRect()
      const inside = r.top >= bandTop + band * EDGE && r.bottom <= bandBottom - band * EDGE
      // A sentence taller than the band: its top in view is all we can do.
      const tooTall = r.height > band * (1 - 2 * EDGE)
      if (!force && (inside || (tooTall && r.top >= bandTop && r.top <= bandTop + band * FOLLOW_AT))) return
      const at = tooTall ? band * EDGE : band * FOLLOW_AT
      const top = el.scrollTop + (r.top - bandTop) - at
      const max = el.scrollHeight - el.clientHeight
      const target = Math.max(0, Math.min(max, top))
      if (Math.abs(target - el.scrollTop) < 4) return
      movingUntilRef.current = Date.now() + SCROLL_SETTLE_MS
      el.scrollTo({ top: target, behavior: 'smooth' })
    },
    [viewportRef]
  )

  // The tick, while following.
  useEffect(() => {
    if (!following) return
    followedRef.current = true
    place(false)
    const id = window.setInterval(() => place(false), FOLLOW_TICK_MS)
    return () => window.clearInterval(id)
  }, [following, place])

  // A hand on the scroll stops following. Programmatic scrolls fire none of
  // these, so the tick's own moves never detach it.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !following) return
    const off = () => {
      movingUntilRef.current = 0
      followedRef.current = false
      setDetached(true)
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if (PAGING_KEYS.has(e.key)) off()
    }
    el.addEventListener('wheel', off, { passive: true })
    el.addEventListener('touchmove', off, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', off)
      el.removeEventListener('touchmove', off)
      window.removeEventListener('keydown', onKey)
    }
  }, [following, viewportRef])

  // The reply ended while it was being followed: back to the foot.
  useEffect(() => {
    if (liveKey !== null || !followedRef.current) return
    followedRef.current = false
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [liveKey, viewportRef])

  const resume = useCallback(() => {
    setDetached(false)
    movingUntilRef.current = 0
    // Straight to it, not "only if leaving": the reader asked.
    window.requestAnimationFrame(() => place(true))
  }, [place])

  return { following, detached: detached && liveKey !== null && playing, resume }
}
