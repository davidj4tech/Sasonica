/**
 * "Advanced", per device (Settings → Advanced; David, 23 Sep 2026 — the name
 * may change). Off by default. What it turns on:
 *
 *  - search gains a "Tool steps" filter (the commands and files agents
 *    touched, §6.14 `tools=1`);
 *  - Settings shows the follow-along lead, the device's id and server
 *    address, and the legacy connection form (when paired; unpaired, that
 *    form is how you get in, so it always shows).
 *
 * localStorage like the text size; a change reaches every screen at once.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'sasonica.chat.advanced'
const listeners = new Set<() => void>()
let cached: boolean | null = null

export function getAdvanced(): boolean {
  if (cached !== null) return cached
  let v = false
  try {
    v = window.localStorage.getItem(KEY) === '1'
  } catch {
    // No storage: off.
  }
  cached = v
  return v
}

export function setAdvanced(on: boolean) {
  cached = on
  try {
    if (on) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    // This visit only.
  }
  for (const fn of listeners) fn()
}

export function useAdvanced(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getAdvanced,
    () => false
  )
}
