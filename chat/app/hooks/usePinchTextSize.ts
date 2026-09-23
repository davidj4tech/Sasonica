import { useEffect } from 'react'
import { stepTextSize } from '../lib/textSize'

/** How far the fingers must spread (or close) for one step of text size. */
const STEP_RATIO = 1.25

const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

/**
 * Pinch anywhere to change the text size: two fingers spreading step it up,
 * closing step it down, one step per STEP_RATIO of spread, and each step is
 * saved — the same setting as Settings → Text size (lib/textSize.ts), so the
 * size a pinch leaves is the size the next visit opens at.
 *
 * The browser's own pinch-zoom is refused (touch-action on the root in
 * app.css, preventDefault here, gesturestart for Safari): it would magnify
 * the page instead of reflowing it. Window capture, so a pinch never reaches
 * the thread's touchmove listeners as a hand scroll that breaks off
 * follow-along.
 */
export function usePinchTextSize() {
  useEffect(() => {
    let from = 0
    const start = (e: TouchEvent) => {
      from = e.touches.length === 2 ? spread(e.touches) : 0
    }
    const move = (e: TouchEvent) => {
      if (!from || e.touches.length !== 2) return
      e.preventDefault()
      e.stopPropagation()
      const now = spread(e.touches)
      const ratio = now / from
      if (ratio >= STEP_RATIO || ratio <= 1 / STEP_RATIO) {
        stepTextSize(ratio > 1 ? 1 : -1)
        from = now
      }
    }
    const end = (e: TouchEvent) => {
      if (e.touches.length !== 2) from = 0
    }
    const gesture = (e: Event) => e.preventDefault()
    const opts = { capture: true, passive: false } as const
    window.addEventListener('touchstart', start, opts)
    window.addEventListener('touchmove', move, opts)
    window.addEventListener('touchend', end, opts)
    window.addEventListener('touchcancel', end, opts)
    window.addEventListener('gesturestart', gesture, opts)
    return () => {
      window.removeEventListener('touchstart', start, opts)
      window.removeEventListener('touchmove', move, opts)
      window.removeEventListener('touchend', end, opts)
      window.removeEventListener('touchcancel', end, opts)
      window.removeEventListener('gesturestart', gesture, opts)
    }
  }, [])
}
