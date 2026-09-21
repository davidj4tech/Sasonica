/**
 * Whether a thread shows ambient artwork — the small pictures the canvas
 * draws beside a reply (`figure: false`). Off by default: in a chat they are
 * decoration between the words. `[[visual:]]` figures (`figure: true`) are
 * always shown, as a thumbnail that opens on a tap (components/parts.tsx).
 *
 * Per device, in localStorage; blocked storage means the default. Changing
 * it tells every mounted picture at once (a window event), so Settings and
 * an open thread agree without a reload.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'sasonica.chat.showAmbient'
const EVENT = 'sasonica:showAmbient'

export function getShowAmbient(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setShowAmbient(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    // The setting just does not stick.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', fn)
  return () => {
    window.removeEventListener(EVENT, fn)
    window.removeEventListener('storage', fn)
  }
}

export function useShowAmbient(): boolean {
  return useSyncExternalStore(subscribe, getShowAmbient, () => false)
}
