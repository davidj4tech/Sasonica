/**
 * How far the bold runs ahead of the voice, per device (Settings →
 * Follow-along lead). A sentence is taken in as it starts, and the phone's
 * player has its own output latency that no server number shows, so this is
 * the knob for "the bold is a little behind / ahead".
 *
 * Default 0.5 s (22 Sep 2026): the clock corrections in followAlong.ts and
 * useElapsedSkew leave the bold ~0.2–0.3 s behind what red5 can measure
 * (the skew estimate is conservative by the phone→red5 hop and the pos
 * rounding), plus the 0.3 s "taken in as it starts" lead the Nuxt app used.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'sasonica.chat.followLead'
export const LEAD_DEFAULT_S = 0.5
export const LEAD_MIN_S = 0
export const LEAD_MAX_S = 2
export const LEAD_STEP_S = 0.1

let cached: number | null = null
const listeners = new Set<() => void>()

export function getFollowLead(): number {
  if (cached !== null) return cached
  let v = LEAD_DEFAULT_S
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) v = Number(raw)
  } catch {
    // No storage: the default.
  }
  cached = Math.min(LEAD_MAX_S, Math.max(LEAD_MIN_S, v))
  return cached
}

export function setFollowLead(seconds: number) {
  const v = Math.round(Math.min(LEAD_MAX_S, Math.max(LEAD_MIN_S, seconds)) * 10) / 10
  cached = v
  try {
    window.localStorage.setItem(KEY, String(v))
  } catch {
    // Kept for this page load only.
  }
  for (const fn of listeners) fn()
}

export function useFollowLead(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    getFollowLead,
    () => LEAD_DEFAULT_S
  )
}
