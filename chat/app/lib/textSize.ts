/**
 * Text size, per device: one root CSS variable (`--text-size`, the html
 * font-size) that every size in app.css is a rem of, so one setting scales
 * message text, the composer, list titles, cards and the work summary
 * together.
 *
 * Stored in localStorage (a per-device preference, read synchronously so it
 * applies before first paint — see TEXT_SIZE_BOOT in root.tsx). Blocked
 * storage means the default, every time.
 */

export const TEXT_SIZES = [
  { id: 'small', label: 'Small', px: 15 },
  { id: 'default', label: 'Default', px: 17 },
  { id: 'large', label: 'Large', px: 19 },
  { id: 'larger', label: 'Larger', px: 22 }
] as const

export type TextSizeId = (typeof TEXT_SIZES)[number]['id']

export const TEXT_SIZE_KEY = 'sasonica.chat.textSize'
const DEFAULT: TextSizeId = 'default'

export function getTextSize(): TextSizeId {
  try {
    const v = window.localStorage.getItem(TEXT_SIZE_KEY)
    if (TEXT_SIZES.some((s) => s.id === v)) return v as TextSizeId
  } catch {
    // Private mode or blocked storage: the default.
  }
  return DEFAULT
}

/** Takes effect at once: the variable changes, every rem follows. */
export function applyTextSize(id: TextSizeId) {
  const size = TEXT_SIZES.find((s) => s.id === id) || TEXT_SIZES[1]
  document.documentElement.style.setProperty('--text-size', `${size.px}px`)
}

export function setTextSize(id: TextSizeId) {
  try {
    if (id === DEFAULT) window.localStorage.removeItem(TEXT_SIZE_KEY)
    else window.localStorage.setItem(TEXT_SIZE_KEY, id)
  } catch {
    // Applies for this visit only.
  }
  applyTextSize(id)
}

/**
 * The same, as a string for an inline <script> in the document head, so the
 * saved size is on the root before the first paint (no flash of the default
 * size while the bundle loads).
 */
export const TEXT_SIZE_BOOT = `try{var m=${JSON.stringify(Object.fromEntries(TEXT_SIZES.map((s) => [s.id, s.px])))},v=localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)});if(m[v])document.documentElement.style.setProperty('--text-size',m[v]+'px')}catch(e){}`
