/**
 * Keep the sentence being spoken on screen.
 *
 * A thread normally sticks to its bottom (assistant-ui's auto-scroll). While
 * a live line is being spoken that is wrong: a reply taller than the screen
 * keeps its foot in view and the bold sentence goes off the top. So while
 * this thread has a live line, this hook owns the viewport's scrolling:
 *
 * - FOLLOWING = a live line exists in this thread, it is not paused, and the
 *   reader has not taken over. Nothing else — not the number of messages,
 *   not lines appended after the live one, not `working` updates, not the
 *   live line's sentences growing — starts or stops it. Every
 *   FOLLOW_TICK_MS the bold sentence is checked against the visible band
 *   (the viewport less the sticky footer); only when it is leaving the band
 *   does the view move, smoothly, to put it at FOLLOW_AT of the band.
 *
 * - THE GUARD: while a live line exists (paused or not), every
 *   `viewport.scrollTo` that is not this hook's own is dropped. That is the
 *   only way assistant-ui scrolls (useThreadViewportAutoScroll, 0.15.x), and
 *   `autoScroll={false}` is NOT enough to stop it: once any scroll-to-bottom
 *   was requested (initialize, run start, a send) while the view was already
 *   at the bottom, no scroll event ever clears its "scrolling to bottom"
 *   flag, and from then on EVERY content resize scrolls to the bottom,
 *   whatever `autoScroll` says. Real replies resize constantly (the live
 *   line's text streams in, `working` steps change, lines are appended), so
 *   on the phone the view was yanked to the bottom again and again. (The
 *   browser's own scroll anchoring and the reader's hand are not scrollTo
 *   calls and are untouched.)
 *
 * - A reader who scrolls by hand (wheel, touch drag, paging keys) is left
 *   alone: following stops and `detached` is set, for a "Follow along" pill
 *   that calls `resume()`. A new live line starts following again.
 *
 * - Messages that arrive below the live line while it plays do not move the
 *   view; the thread shows a "New messages ↓" hint instead (`toFoot()`).
 *
 * - Paused: nothing moves. Ended: if the reader was following, the view goes
 *   to the foot, where the thread normally sits; if not, their place is
 *   kept, and assistant-ui's pending scroll-to-bottom (if any) is cancelled
 *   the way its own code cancels it on a pointer press.
 *
 * - Settings → Follow along off (lib/followOn.ts): every live line starts
 *   as if the reader had taken over — the guard still keeps their place,
 *   nothing follows, and no pill is offered.
 *
 * Sits beside hooks/useBottomFirst.ts: that pin (scrollTop writes, not
 * scrollTo) owns the first moments of a thread (FOLLOW_START_MS).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

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

/**
 * @param liveKey  the live message's identity (its `id`), or null when this
 *                 thread has none
 * @param playing  the live line is not paused
 * @param enabled  Settings → Follow along
 */
export function useFollowAlong(viewportRef: RefObject<HTMLElement | null>, liveKey: string | null, playing: boolean, enabled = true) {
  const [detached, setDetached] = useState(!enabled)
  const [ready, setReady] = useState(false)
  const movingUntilRef = useRef(0)
  const followedRef = useRef(false)

  const hasLive = liveKey !== null
  const following = ready && hasLive && playing && !detached

  // ── The guard ───────────────────────────────────────────────────────────
  const guardRef = useRef(false)
  guardRef.current = hasLive
  const ownRef = useRef(false)
  /** Blocked foreign scrolls, for tests and debugging (window.__followBlocked). */
  const blockedRef = useRef(0)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const native = el.scrollTo
    // An own property shadows Element.prototype.scrollTo for this element
    // only; removed again on unmount.
    el.scrollTo = function guarded(this: HTMLElement, ...args: unknown[]) {
      if (guardRef.current && !ownRef.current) {
        blockedRef.current += 1
        ;(window as unknown as { __followBlocked?: number }).__followBlocked = blockedRef.current
        return
      }
      return (native as (...a: unknown[]) => void).apply(this, args)
    } as typeof el.scrollTo
    return () => {
      delete (el as { scrollTo?: unknown }).scrollTo
    }
  }, [viewportRef])

  /** This hook's own scroll: the only kind the guard lets through. */
  const scrollOwn = useCallback(
    (top: number, behavior: ScrollBehavior) => {
      const el = viewportRef.current
      if (!el) return
      ownRef.current = true
      try {
        el.scrollTo({ top, behavior })
      } finally {
        ownRef.current = false
      }
    },
    [viewportRef]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), FOLLOW_START_MS)
    return () => window.clearTimeout(t)
  }, [])

  // A new live line: follow it, whatever happened to the last one — unless
  // following is switched off, which also stops one under way.
  useEffect(() => {
    setDetached(!enabled)
    if (!enabled) followedRef.current = false
  }, [liveKey, enabled])

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
      scrollOwn(target, 'smooth')
    },
    [viewportRef, scrollOwn]
  )

  // The tick, while following.
  useEffect(() => {
    if (!following) return
    followedRef.current = true
    place(false)
    const id = window.setInterval(() => place(false), FOLLOW_TICK_MS)
    return () => window.clearInterval(id)
  }, [following, place])

  // A hand on the scroll stops following — listened for whenever there is a
  // live line, paused or not, so a reader who scrolls during a pause gets
  // the pill too. Programmatic scrolls fire none of these.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !hasLive) return
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
  }, [hasLive, viewportRef])

  // The reply ended. Following it: back to the foot. Not following: stay
  // put, and cancel whatever scroll-to-bottom assistant-ui still has
  // pending (its viewport drops it on a pointerdown), so lifting the guard
  // does not yank the reader down on the next resize.
  const hadLiveRef = useRef(false)
  useEffect(() => {
    if (hasLive) {
      hadLiveRef.current = true
      return
    }
    if (!hadLiveRef.current) return
    hadLiveRef.current = false
    const el = viewportRef.current
    if (!el) return
    if (followedRef.current) {
      followedRef.current = false
      scrollOwn(el.scrollHeight, 'smooth')
    } else {
      el.dispatchEvent(new Event('pointerdown'))
    }
  }, [hasLive, viewportRef, scrollOwn])

  const resume = useCallback(() => {
    setDetached(false)
    movingUntilRef.current = 0
    // Straight to it, not "only if leaving": the reader asked.
    window.requestAnimationFrame(() => place(true))
  }, [place])

  /** To the foot of the thread (the "New messages" hint, or a send): the reader takes over. */
  const toFoot = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    if (hasLive) {
      followedRef.current = false
      setDetached(true)
    }
    movingUntilRef.current = 0
    scrollOwn(el.scrollHeight, 'smooth')
  }, [viewportRef, hasLive, scrollOwn])

  /** To the top of the thread (the ↑ pill): the reader takes over. */
  const toTop = useCallback(() => {
    if (hasLive) {
      followedRef.current = false
      setDetached(true)
    }
    movingUntilRef.current = 0
    scrollOwn(0, 'smooth')
  }, [hasLive, scrollOwn])

  return {
    following,
    /** The reader took over from a live line: offer "Follow along". */
    detached: detached && hasLive && enabled,
    /** A live line exists: assistant-ui's own scrolling is held off. */
    guarded: hasLive,
    resume,
    toFoot,
    toTop
  }
}
