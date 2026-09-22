/**
 * Open menus and sheets, as one stack, so every one of them closes the same
 * three ways (David, 22 Sep 2026: "tapping outside the menu doesn't close it"):
 *
 *  - a tap on its scrim (see `scrimProps`): the scrim covers the page, so
 *    the tap that dismisses never reaches — never activates — what is
 *    underneath;
 *  - Escape (web): the TOP layer only;
 *  - Android's back gesture / button (Sasonica Next): the shell's
 *    MainActivity asks `window.__sasonicaBack()` first; it closes the top
 *    layer and answers true, and only when nothing is open does back go
 *    back (the WebView's history, else leave the app).
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'

type Layer = { id: number; close: () => void }
const stack: Layer[] = []
let seq = 0

/** Close the top layer. True when there was one. */
export function closeTopLayer(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}

export function openLayers(): number {
  return stack.length
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __sasonicaBack?: () => boolean }).__sasonicaBack = closeTopLayer
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return
    e.preventDefault()
    e.stopPropagation()
    closeTopLayer()
  })
}

/** Register a layer while `open`; `onClose` is how it is dismissed. */
export function useLayer(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const layer: Layer = { id: ++seq, close: () => closeRef.current() }
    stack.push(layer)
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
}

/**
 * A layer and its scrim in one: registers it while mounted, and returns the
 * props for the scrim element — a tap that both started and ended on the
 * scrim itself closes it (a drag out of the sheet is not a dismiss), and the
 * tap is swallowed so nothing beneath sees it.
 */
export function useScrim(onClose: () => void, open = true) {
  useLayer(open, onClose)
  const downRef = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      downRef.current = e.target === e.currentTarget
    },
    onClick: (e: ReactMouseEvent) => {
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      e.stopPropagation()
      if (downRef.current) closeRef.current()
      downRef.current = false
    }
  }
}
