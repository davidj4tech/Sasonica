/**
 * Thread titles renamed from this app, ahead of the server.
 *
 * A rename (POST /rename) shows at once everywhere a title is drawn — the
 * list, the thread header, the speech bar — by reading `useTitle(session,
 * fallback)` instead of the server's title directly. The override is
 * dropped when the rename fails (rolled back), when a fresh /targets row
 * carries the same title (the server caught up), or after OVERRIDE_TTL_MS
 * (so a later rename made elsewhere is not masked for long).
 */
import { useSyncExternalStore } from 'react'

const OVERRIDE_TTL_MS = 10 * 60 * 1000

const overrides = new Map<string, { title: string; at: number }>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  for (const fn of listeners) fn()
}

export function setTitleOverride(session: string, title: string) {
  overrides.set(session, { title, at: Date.now() })
  changed()
}

export function clearTitleOverride(session: string) {
  if (overrides.delete(session)) changed()
}

/** A fresh server answer: overrides it already agrees with are no longer needed. */
export function confirmTitles(rows: { session: string; title: string }[]) {
  let any = false
  for (const row of rows) {
    const o = overrides.get(row.session)
    if (o && o.title === row.title) {
      overrides.delete(row.session)
      any = true
    }
  }
  if (any) changed()
}

export function titleOverride(session: string | null | undefined): string | undefined {
  if (!session) return undefined
  const o = overrides.get(session)
  if (!o) return undefined
  if (Date.now() - o.at > OVERRIDE_TTL_MS) {
    overrides.delete(session)
    return undefined
  }
  return o.title
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The title to draw: this app's rename if there is one, else `fallback`. */
export function useTitle(session: string | null | undefined, fallback: string): string {
  useSyncExternalStore(subscribe, () => version, () => version)
  return titleOverride(session) ?? fallback
}
