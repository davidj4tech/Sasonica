/**
 * The composer's box: ONE line when empty, growing with its content up to
 * `maxRows`, then scrolling.
 *
 * Why not assistant-ui's own (react-textarea-autosize): it measures once
 * against a hidden clone and again only on a value change or a window
 * resize. In Sasonica Next the WebView can lay the composer out before it
 * has its width, so the clone wraps the placeholder a character per line and
 * the box is drawn at its full 8 rows (David, 22 Sep 2026: "seems fully
 * expanded"); nothing resizes the window afterwards, so it stays that way.
 * This one measures the box itself (height auto → scrollHeight), and again
 * whenever its WIDTH changes (a ResizeObserver: the first real layout, a
 * rotation, the keyboard), when the faces load, and on every value.
 *
 * The cap is the smaller of `maxRows` lines and the CSS max-height (app.css
 * caps it further on a short, landscape screen), and the box scrolls only
 * once past it.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number }

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea({ maxRows = 8, rows = 1, ...rest }, forwarded) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el
      if (typeof forwarded === 'function') forwarded(el)
      else if (forwarded) forwarded.current = el
    },
    [forwarded]
  )

  const fit = useCallback(() => {
    const el = ref.current
    if (!el || !el.isConnected) return
    const cs = window.getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const cssMax = parseFloat(cs.maxHeight)
    const max = Math.min(line * maxRows + pad + border, Number.isFinite(cssMax) ? cssMax : Infinity)
    const min = line * Math.max(1, Number(rows) || 1) + pad + border
    el.style.height = 'auto'
    const want = el.scrollHeight + border
    const h = Math.max(min, Math.min(want, max))
    el.style.height = `${Math.ceil(h)}px`
    el.style.overflowY = want > max + 1 ? 'auto' : 'hidden'
    el.dataset.rows = String(Math.max(1, Math.round((h - pad - border) / line)))
  }, [maxRows, rows])

  // Every value (typed, a draft restored, cleared by a send).
  useLayoutEffect(fit, [fit, rest.value])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let width = el.clientWidth
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          // Only a width change re-flows the text; our own height change must not loop.
          if (el.clientWidth !== width) {
            width = el.clientWidth
            fit()
          }
        })
      : null
    ro?.observe(el)
    window.addEventListener('resize', fit)
    void document.fonts?.ready.then(fit)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fit])

  return <textarea ref={setRef} rows={rows} {...rest} />
})
