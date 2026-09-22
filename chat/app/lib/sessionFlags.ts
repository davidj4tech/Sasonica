/**
 * Exit and Archive, ahead of the server — the same shape as lib/titles.ts.
 *
 * An archive (POST /session/archive) files the thread at once, in the list
 * and in its header; an exit (POST /session/close) drops the live badge at
 * once. Both are rolled back if the server refuses.
 *
 * - archived: dropped when a fresh /targets row agrees, on rollback, or
 *   after OVERRIDE_TTL_MS (so a change made elsewhere is not masked long).
 * - ended: dropped when a message is sent from here (sending resumes the
 *   session), on rollback, after the TTL, or when /targets says the session
 *   is live again well after the exit (resumed elsewhere). Not on the first
 *   list that still shows it live: a headless session takes a few seconds
 *   to stop (§6.4, MEDIA_SESSIOND_CLOSE_GRACE).
 */
import { useSyncExternalStore } from 'react'

const OVERRIDE_TTL_MS = 10 * 60 * 1000
/** A live row this long after the exit means it was resumed, not slow to stop. */
const ENDED_GRACE_MS = 30 * 1000

const archived = new Map<string, { value: boolean; at: number }>()
const ended = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  for (const fn of listeners) fn()
}

export function setArchivedOverride(session: string, value: boolean) {
  archived.set(session, { value, at: Date.now() })
  changed()
}
export function clearArchivedOverride(session: string) {
  if (archived.delete(session)) changed()
}
export function setEnded(session: string) {
  ended.set(session, Date.now())
  changed()
}
export function clearEnded(session: string) {
  if (ended.delete(session)) changed()
}

/** A fresh /targets: overrides it agrees with (or that it has overtaken) go. */
export function confirmFlags(rows: { session: string; live: boolean; archived?: boolean }[]) {
  let any = false
  const t = Date.now()
  for (const row of rows) {
    const a = archived.get(row.session)
    if (a && a.value === !!row.archived) {
      archived.delete(row.session)
      any = true
    }
    const e = ended.get(row.session)
    if (e !== undefined && row.live && t - e > ENDED_GRACE_MS) {
      ended.delete(row.session)
      any = true
    }
  }
  if (any) changed()
}

/** Whether the thread is archived: this app's change if there is one, else the server's flag. */
export function archivedOf(session: string, server: boolean | undefined): boolean {
  const a = archived.get(session)
  if (a && Date.now() - a.at <= OVERRIDE_TTL_MS) return a.value
  if (a) archived.delete(session)
  return !!server
}

/** Exited from here and not resumed since. */
export function endedHere(session: string): boolean {
  const e = ended.get(session)
  if (e === undefined) return false
  if (Date.now() - e > OVERRIDE_TTL_MS) {
    ended.delete(session)
    return false
  }
  return true
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Re-render when an exit or archive changes anything. */
export function useSessionFlags(): number {
  return useSyncExternalStore(subscribe, () => version, () => version)
}
