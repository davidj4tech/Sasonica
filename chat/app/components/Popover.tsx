/**
 * A small menu dropped from a button (the thread's ⋮, the list's sort
 * control), over a clear scrim that covers the page: a tap outside closes it
 * and is swallowed, so it never also presses what was underneath. Escape and
 * Android back close it too (lib/layers.ts). Portalled to the body so the
 * scrim is above everything, and placed under its anchor by measurement.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useScrim } from '../lib/layers'

export function Popover(props: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  label: string
  className?: string
  /** Which edge of the anchor the menu lines up with. */
  align?: 'right' | 'left'
  role?: string
}) {
  const scrim = useScrim(props.onClose)
  const menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    const el = props.anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // A long menu (the filter's: Show, the projects, the states) would run
    // off the foot of the screen, so it takes the room there is and scrolls.
    const top = r.bottom + 4
    const maxHeight = Math.max(160, window.innerHeight - top - 8)
    setPos(props.align === 'left' ? { top, left: Math.max(8, r.left), maxHeight } : { top, right: Math.max(8, window.innerWidth - r.right), maxHeight })
  }, [props.anchor, props.align])
  // Lined up with its anchor, a menu near the right of a narrow window would
  // hang off the edge with its words cut off — so, once it has a width, it is
  // pulled back inside (both edges: 8 px of air either side).
  useLayoutEffect(() => {
    const el = menu.current
    if (!el || !pos) return
    const w = el.getBoundingClientRect().width
    if (pos.left !== undefined) {
      const left = Math.max(8, Math.min(pos.left, window.innerWidth - w - 8))
      if (Math.abs(left - pos.left) > 0.5) setPos({ ...pos, left })
    } else if (pos.right !== undefined) {
      const right = Math.max(8, Math.min(pos.right, window.innerWidth - w - 8))
      if (Math.abs(right - pos.right) > 0.5) setPos({ ...pos, right })
    }
  }, [pos])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="popover-scrim" data-testid="popover-scrim" {...scrim}>
      {pos && (
        <div ref={menu} className={`menu popover ${props.className || ''}`} role={props.role || 'menu'} aria-label={props.label} style={pos}>
          {props.children}
        </div>
      )}
    </div>,
    document.body
  )
}
