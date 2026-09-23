/**
 * Text size, per device: one root CSS variable (`--text-size`, the html
 * font-size) that every size in app.css is a rem of, so one setting scales
 * message text, the composer, list titles, cards and the work summary
 * together.
 *
 * Stored in localStorage (a per-device preference, read synchronously so it
 * applies before first paint — see TEXT_SIZE_BOOT in root.tsx). Blocked
 * storage means the default, every time.
 *
 * Default is 15 px. The small end goes down to 9 px for
 * smart glasses, where a line has to fit a narrow display — three steps
 * below Default, three above.
 */

export const TEXT_SIZES = [
  { id: 'smallest', label: 'Smallest', px: 9 },
  { id: 'smaller', label: 'Smaller', px: 11 },
  { id: 'small', label: 'Small', px: 13 },
  { id: 'default', label: 'Default', px: 15 },
  { id: 'large', label: 'Large', px: 17 },
  { id: 'larger', label: 'Larger', px: 19 },
  { id: 'largest', label: 'Largest', px: 21 }
] as const

export type TextSizeId = (typeof TEXT_SIZES)[number]['id']

/** The key moved when the scale did; a choice saved under the first key is
 * carried over to the same size. */
export const TEXT_SIZE_KEY = 'sasonica.chat.textSize2'
const OLD_KEY = 'sasonica.chat.textSize'
const OLD_TO_NEW: Record<string, TextSizeId> = { small: 'large', large: 'largest', larger: 'largest' }
const DEFAULT: TextSizeId = 'default'

export function getTextSize(): TextSizeId {
  try {
    const v = window.localStorage.getItem(TEXT_SIZE_KEY)
    if (TEXT_SIZES.some((s) => s.id === v)) return v as TextSizeId
    const old = window.localStorage.getItem(OLD_KEY)
    if (old !== null) {
      window.localStorage.removeItem(OLD_KEY)
      const id = OLD_TO_NEW[old] || 'small'
      if (id !== DEFAULT) window.localStorage.setItem(TEXT_SIZE_KEY, id)
      return id
    }
  } catch {
    // Private mode or blocked storage: the default.
  }
  return DEFAULT
}

/** Takes effect at once: the variable changes, every rem follows. */
export function applyTextSize(id: TextSizeId) {
  const size = TEXT_SIZES.find((s) => s.id === id) || TEXT_SIZES[3]
  document.documentElement.style.setProperty('--text-size', `${size.px}px`)
}

/** Fired on window when the size changes, so an open Settings follows a pinch. */
export const TEXT_SIZE_EVENT = 'sasonica:textsize'

export function setTextSize(id: TextSizeId) {
  try {
    if (id === DEFAULT) window.localStorage.removeItem(TEXT_SIZE_KEY)
    else window.localStorage.setItem(TEXT_SIZE_KEY, id)
  } catch {
    // Applies for this visit only.
  }
  applyTextSize(id)
  window.dispatchEvent(new CustomEvent(TEXT_SIZE_EVENT, { detail: id }))
}

/** One step larger (+1) or smaller (-1), saved; stops at either end. */
export function stepTextSize(by: 1 | -1): TextSizeId {
  const cur = getTextSize()
  const i = TEXT_SIZES.findIndex((s) => s.id === cur)
  const next = TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + by))].id
  if (next !== cur) setTextSize(next)
  return next
}

/**
 * The same, as a string for an inline <script> in the document head, so the
 * saved size is on the root before the first paint (no flash of the default
 * size while the bundle loads).
 */
export const TEXT_SIZE_BOOT = `try{var m=${JSON.stringify(Object.fromEntries(TEXT_SIZES.map((s) => [s.id, s.px])))},o=${JSON.stringify(OLD_TO_NEW)},v=localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)}),w=localStorage.getItem(${JSON.stringify(OLD_KEY)});if(!m[v]&&w!==null)v=o[w]||'small';if(m[v])document.documentElement.style.setProperty('--text-size',m[v]+'px')}catch(e){}`
