/**
 * A small menu dropped from a button (the thread's ⋮, the list's sort
 * control), over a clear scrim that covers the page: a tap outside closes it
 * and is swallowed, so it never also presses what was underneath. Escape and
 * Android back close it too (lib/layers.ts). Portalled to the body so the
 * scrim is above everything, and placed under its anchor by measurement.
 */
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
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
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="popover-scrim" data-testid="popover-scrim" {...scrim}>
      {pos && (
        <div className={`menu popover ${props.className || ''}`} role={props.role || 'menu'} aria-label={props.label} style={pos}>
          {props.children}
        </div>
      )}
    </div>,
    document.body
  )
}
