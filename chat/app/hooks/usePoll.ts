import { useCallback, useEffect, useRef } from 'react'

/**
 * A visibility-aware setTimeout loop. `delay()` is asked after every tick, so
 * the cadence can change between ticks (the log's adaptive poll). Stops while
 * the page is hidden — a backgrounded app would otherwise queue requests and
 * fire them all on resume — and ticks at once when it comes back.
 *
 * Returns a `kick()` that runs a tick now and re-arms the timer.
 */
export function usePoll(tick: () => Promise<void> | void, delay: () => number, enabled: boolean, deps: unknown[] = []) {
  const tickRef = useRef(tick)
  const delayRef = useRef(delay)
  tickRef.current = tick
  delayRef.current = delay
  const kickRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: number | null = null
    let running = false

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
    const arm = () => {
      clear()
      if (cancelled || document.hidden) return
      timer = window.setTimeout(run, delayRef.current())
    }
    const run = async () => {
      timer = null
      if (running) return
      running = true
      try {
        await tickRef.current()
      } finally {
        running = false
      }
      arm()
    }
    const onVisibility = () => {
      if (document.hidden) clear()
      else void run()
    }

    kickRef.current = () => {
      clear()
      void run()
    }
    void run()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clear()
      document.removeEventListener('visibilitychange', onVisibility)
      kickRef.current = () => {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  return useCallback(() => kickRef.current(), [])
}
