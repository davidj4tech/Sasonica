/**
 * Where the app was when it last stopped, so it opens there again.
 *
 * Asked for after a reinstall — "it would be nice to land on the same page
 * that I was on before it installed" (David, 23 Sep 2026) — but a reinstall
 * is not a case the web app can detect, and it does not need to: an install
 * ends with the app starting, and so does being killed, swiped away or
 * updated. One rule covers all of them. Returning from the background is not
 * one of them: the page is still loaded, so nothing here runs.
 *
 * localStorage rather than the IndexedDB cache (lib/store.ts): this is read
 * during the first render, which cannot wait on a promise, and one path is
 * small enough that the synchronous cost does not matter.
 *
 * Blocked storage means the app opens on Home, exactly as it did before.
 */

const KEY = 'sasonica.lastRoute'

/** Screens it would be wrong to come back to. */
function restorable(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  // Pairing is a one-time flow reached from a link, and landing on it with no
  // code in hand is a dead end.
  return !path.startsWith('/pairing')
}

export function rememberRoute(path: string): void {
  try {
    if (restorable(path)) window.localStorage.setItem(KEY, path)
  } catch {
    // Blocked storage: the app simply opens where it always did.
  }
}

/** The saved screen, or '' when there is none worth going back to. */
export function savedRoute(): string {
  try {
    const path = window.localStorage.getItem(KEY) || ''
    return restorable(path) && path !== '/' ? path : ''
  } catch {
    return ''
  }
}
