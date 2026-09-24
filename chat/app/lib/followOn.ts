/**
 * Follow along, per device (Settings → Follow along; David, 25 Sep 2026).
 * On by default. Off, the view no longer scrolls to keep the sentence being
 * spoken on screen (hooks/useFollowAlong.ts): it stays where the reader put
 * it, as if they had taken over, and no "Follow along" pill is offered. The
 * bold still marks the sentence.
 *
 * localStorage like Advanced; a change reaches every screen at once.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'sasonica.chat.followOff'
const listeners = new Set<() => void>()
let cached: boolean | null = null

export function getFollowOn(): boolean {
  if (cached !== null) return cached
  let v = true
  try {
    v = window.localStorage.getItem(KEY) !== '1'
  } catch {
    // No storage: on.
  }
  cached = v
  return v
}

export function setFollowOn(on: boolean) {
  cached = on
  try {
    if (on) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, '1')
  } catch {
    // This visit only.
  }
  for (const fn of listeners) fn()
}

export function useFollowOn(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getFollowOn,
    () => true
  )
}
