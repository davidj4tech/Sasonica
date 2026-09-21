/**
 * Where the server is, and what proves who we are to it.
 *
 * This is the ONE module that knows about credentials. Everything else asks
 * `serverBase()` and `authHeaders()` and does not care what is behind them.
 *
 * v0 (today): the caller's Audiobookshelf bearer, which the canvas hands back
 * to ABS's /api/authorize (server-contract.md §4.1), and a base URL typed into
 * Settings. Both live in localStorage for the prototype.
 *
 * v1 (§9): a device token minted by `POST /pair` from a one-time code, kept
 * in the Android keystore, and the base URL the pairing link carried. The swap
 * is this file: `pair()` fills the same two slots, and `authHeaders()` goes on
 * returning `Authorization: Bearer <token>` — the header does not change.
 */

const BASE_KEY = 'sasonica.chat.baseUrl'
const TOKEN_KEY = 'sasonica.chat.token'

/** The canvas's port when the base URL is left blank (§2 "Base URL"). */
const CANVAS_PORT = '8781'

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    // Private mode or blocked storage: behave as "not set".
    return ''
  }
}

function write(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Nothing to be done; the setting just does not stick.
  }
}

/** What Settings shows in the box (may be blank). */
export function storedBaseUrl(): string {
  return read(BASE_KEY)
}

/**
 * The canvas address: what this device was told, else this page's own host
 * on 8781 — right when the bundle is served from the same machine. Inside the
 * Capacitor shell the page's host is `localhost`, so there it must be set.
 */
export function serverBase(): string {
  const set = read(BASE_KEY)
  if (set) return set.replace(/\/+$/, '')
  if (typeof window === 'undefined') return ''
  try {
    const url = new URL(window.location.origin)
    url.port = CANVAS_PORT
    return url.origin
  } catch {
    return ''
  }
}

export function setBaseUrl(url: string) {
  write(BASE_KEY, url.trim().replace(/\/+$/, ''))
}

export function hasToken(): boolean {
  return !!read(TOKEN_KEY)
}

export function setToken(token: string) {
  write(TOKEN_KEY, token.trim())
}

/** Headers every app route takes. */
export function authHeaders(): Record<string, string> {
  const token = read(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * v1 (§9): redeem a pairing code. Not built on the server yet; kept here so
 * the device-token swap lands in this file.
 *
 *   POST /pair {code, device} → {ok, token, device_id, server: {name, base}}
 *   then setBaseUrl(server.base); setToken(token)  (keystore, not localStorage)
 */
export async function pair(_code: string, _device: string): Promise<never> {
  throw new Error('Pairing is v1 (server-contract.md §9) and not built yet')
}
