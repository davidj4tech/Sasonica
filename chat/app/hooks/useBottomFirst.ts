/**
 * Open a thread at its foot, newest first, with no visible sweep or jump.
 *
 * The first render shows only the newest FIRST_WINDOW messages — the part of
 * the thread that is on screen at the bottom, and cheap to lay out. Once they
 * are painted, the window lifts and the older ones are added above.
 *
 * Adding content ABOVE the reader would push what they are looking at down,
 * so for the opening moments (until SETTLE_MS after the window lifts) the
 * viewport is pinned by its distance from the bottom: a MutationObserver
 * (whose callback runs before the next paint) resets `scrollTop` to
 * `scrollHeight − distance` after every DOM change, and scroll events keep
 * `distance` current, so a reader who has already scrolled up keeps their
 * place too. Browser scroll anchoring is switched off meanwhile so the two
 * mechanisms cannot both adjust the same growth.
 *
 * How this sits with assistant-ui's own auto-scroll
 * (ThreadPrimitive.Viewport → useThreadViewportAutoScroll, 0.15.x): it
 * scrolls to the bottom on "initialize" (the first frame with messages, via
 * requestAnimationFrame) and, while the reader is at the bottom, again on
 * every content resize. Both agree with the pin — at the bottom the pin's
 * distance IS "at the bottom" — so nothing fights. What it does not do is
 * hold a scrolled-up reader in place while content grows above them; that
 * is the part this adds. After SETTLE_MS everything is assistant-ui's again.
 *
 * Messages keep their ids (`${session}:${at}`), so lifting the window mounts
 * only the older ones; the newest stay mounted.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export const FIRST_WINDOW = 20
/** How long after the window lifts the pin stays on (images, late layout). */
const SETTLE_MS = 800
/** Give up waiting for the first messages to reach the DOM after this many frames. */
const MAX_WAIT_FRAMES = 60

export function useBottomFirst<T>(items: T[], viewportRef: RefObject<HTMLElement | null>): T[] {
  const [windowed, setWindowed] = useState(true)
  const hasItems = items.length > 0

  // The pin: active from mount until SETTLE_MS after the window lifts.
  const pinningRef = useRef(true)
  const stopRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    // Distance from the bottom edge of the content to the top of the view.
    // clientHeight means "at the bottom" (it is where a fresh thread starts).
    let distance = el.clientHeight
    const prevAnchor = el.style.overflowAnchor
    el.style.overflowAnchor = 'none'
    const pin = () => {
      if (!pinningRef.current) return
      const top = Math.max(0, el.scrollHeight - distance)
      if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
    }
    const onScroll = () => {
      if (!pinningRef.current) return
      distance = el.scrollHeight - el.scrollTop
    }
    const mo = new MutationObserver(pin)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    pin()
    const stop = () => {
      pinningRef.current = false
      mo.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.style.overflowAnchor = prevAnchor
    }
    stopRef.current = stop
    return stop
    // Once per mount: the page is keyed by session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lift the window once the newest messages are on screen.
  useEffect(() => {
    if (!windowed || !hasItems) return
    let frames = 0
    let raf = 0
    const check = () => {
      const el = viewportRef.current
      // assistant-ui renders the runtime's messages a commit or two after
      // `items` changes; wait until they are really in the DOM, then give
      // the browser one frame to paint them before adding the rest.
      if ((el && el.querySelector('.msg')) || ++frames > MAX_WAIT_FRAMES) {
        raf = requestAnimationFrame(() => setWindowed(false))
        return
      }
      raf = requestAnimationFrame(check)
    }
    raf = requestAnimationFrame(check)
    return () => cancelAnimationFrame(raf)
  }, [windowed, hasItems, viewportRef])

  // …and let go of the pin once the older ones have settled.
  useEffect(() => {
    if (windowed) return
    const t = window.setTimeout(() => stopRef.current(), SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [windowed])

  return windowed && items.length > FIRST_WINDOW ? items.slice(-FIRST_WINDOW) : items
}
