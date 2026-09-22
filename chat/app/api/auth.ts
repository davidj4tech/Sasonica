/**
 * Where the server is, and what proves who we are to it.
 *
 * This is the ONE module that knows about credentials. Everything else asks
 * `serverBase()`, `authHeaders()` and `hasCredential()` and does not care
 * what is behind them.
 *
 * Two credentials, tried in this order (server-contract.md §9 "Migration":
 * the canvas checks a device token first and falls back to ABS):
 *
 * 1. A DEVICE TOKEN (v1, §9) — the default. `pair()` redeems a one-time code
 *    minted at the desk (`sasonica pair --device NAME`) with
 *    `POST /pair {code, device}` and keeps `{token, device_id, server}`. The
 *    server address becomes the base the pairing answered from.
 * 2. The caller's Audiobookshelf bearer (v0, §4.1) — "Advanced / legacy" in
 *    Settings, and what the preview server's own /pair link stores. Kept so
 *    nothing already set up breaks; it goes at the ABS exit.
 *
 * PROTOTYPE STORAGE: both live in WebView/browser localStorage, every access
 * in try/catch (private mode, blocked site data → "not set"). The Capacitor
 * build MUST move the device token to the Android keystore (§9 step 3:
 * "not WebView localStorage") — `readDevice()` / `writeDevice()` below are
 * the only two functions that change; nothing outside this file reads the
 * token.
 */

const BASE_KEY = 'sasonica.chat.baseUrl'
/** v0: the Audiobookshelf bearer (the preview server's pairing page writes this key too). */
const TOKEN_KEY = 'sasonica.chat.token'
/** v1: the paired device, as JSON (see Device). */
const DEVICE_KEY = 'sasonica.chat.device'

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

// ── The server address ────────────────────────────────────────────────────

/** What Settings shows in the box (may be blank). */
export function storedBaseUrl(): string {
  return read(BASE_KEY)
}

/**
 * The canvas address: what this device was told (by pairing, or typed in
 * Settings), else this page's own host on 8781 — right when the bundle is
 * served from the same machine. Inside the Capacitor shell the page's host
 * is `localhost`, so there pairing must set it.
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

// ── The device token (v1, §9) ─────────────────────────────────────────────

/** A paired device, as this app keeps it. */
export interface Device {
  token: string
  device_id: string
  /**
   * The name the server knows it by, if it said. The desk's `--device` name
   * wins over ours (§9), and `POST /pair` does not echo it today, so this is
   * often only the name we asked for.
   */
  name: string
  server: { name: string; base: string }
  /** Epoch ms. */
  pairedAt: number
}

// KEYSTORE SWAP: these two, and only these two, move to the Android
// keystore (a Capacitor secure-storage plugin) in the shell build.
function readDevice(): Device | null {
  const raw = read(DEVICE_KEY)
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Device
    return d && typeof d.token === 'string' && d.token ? d : null
  } catch {
    return null
  }
}
function writeDevice(d: Device | null) {
  write(DEVICE_KEY, d ? JSON.stringify(d) : '')
}

/** The paired device, without its token (for Settings). */
export function pairedDevice(): Omit<Device, 'token'> | null {
  const d = readDevice()
  if (!d) return null
  const { token: _t, ...rest } = d
  return rest
}

/** Forget the device token on this device. The server keeps its row until
 * it is revoked at the desk (`sasonica devices --revoke <id>`). */
export function unpair() {
  writeDevice(null)
}

// ── The legacy ABS bearer (v0, §4.1) ──────────────────────────────────────

export function hasLegacyToken(): boolean {
  return !!read(TOKEN_KEY)
}

export function setLegacyToken(token: string) {
  write(TOKEN_KEY, token.trim())
}

// ── What the rest of the app asks ─────────────────────────────────────────

/** Anything to prove who we are: a device token, else an ABS bearer. */
export function hasCredential(): boolean {
  return !!readDevice() || hasLegacyToken()
}

/** Which one `authHeaders()` is sending. */
export function credentialKind(): 'device' | 'legacy' | null {
  if (readDevice()) return 'device'
  return hasLegacyToken() ? 'legacy' : null
}

/** Headers every app route takes. The header is the same for both kinds. */
export function authHeaders(): Record<string, string> {
  const token = readDevice()?.token || read(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── Pairing ───────────────────────────────────────────────────────────────

/** What a pairing link or form says: where, and the one-time code. */
export interface PairRequest {
  server: string
  code: string
}

/** 8 hex from `sasonica pair`; accepted loosely, the server judges. */
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/

/**
 * Read a pasted pairing link. Accepts:
 *  - `sasonica://pair?server=<base>&code=<code>` (what the desk prints for the app);
 *  - `http(s)://<canvas>/pair?c=<code>[&device=1]` (the desk's browser link:
 *    its origin IS the canvas);
 *  - `http(s)://<anything>/?pair=<code>&server=<base>` (this app's own
 *    auto-pair address, e.g. from the preview server's redirect).
 * Returns null for anything else. `server` may be '' when the link does not
 * carry one (the caller then asks for it).
 */
export function parsePairLink(text: string): PairRequest | null {
  const s = text.trim()
  if (!s) return null
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  const p = url.searchParams
  const clean = (base: string) => base.trim().replace(/\/+$/, '')
  if (url.protocol === 'sasonica:') {
    const code = p.get('code') || p.get('c') || ''
    return CODE_RE.test(code) ? { server: clean(p.get('server') || ''), code } : null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (p.get('pair')) {
    const code = p.get('pair') || ''
    return CODE_RE.test(code) ? { server: clean(p.get('server') || ''), code } : null
  }
  if (url.pathname.replace(/\/+$/, '') === '/pair') {
    const code = p.get('c') || p.get('code') || ''
    return CODE_RE.test(code) ? { server: clean(p.get('server') || url.origin), code } : null
  }
  return null
}

/** Normalise a typed address: `red5:8781` → `http://red5:8781`. */
export function normaliseServer(text: string): string {
  const s = text.trim().replace(/\/+$/, '')
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `http://${s}`
}

/**
 * Why a bare host name may not be reachable: the Android build allows plain
 * http only to tailnet addresses (network_security_config), so `red5` alone
 * — a MagicDNS short name — can be refused before it is ever asked. '' for
 * an address with a dot or an IP.
 */
export function shortHostHint(base: string): string {
  let host = ''
  try {
    host = new URL(base).hostname
  } catch {
    return ''
  }
  if (!host || host.includes('.') || host.includes(':') || host === 'localhost') return ''
  return '. This build only allows tailnet addresses: use 100.x.y.z or name.<tailnet>.ts.net'
}

/** A name to offer the server; the desk's name wins (§9). */
export function defaultDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const kind = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : 'browser'
  return `Sasonica chat (${kind})`
}

/** A refused pairing, with the server's own words (§3). */
export class PairError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'PairError'
    this.status = status
    this.code = code
  }
}

/**
 * Redeem a pairing code (§9):
 *   POST <server>/pair {code, device} → {ok, token, device_id, name, server: {name, base}}
 * `name` is the device's name as given at the desk, which wins over the one
 * asked for here; an older server leaves it out, and ours is kept.
 * No credential is sent. On success the device is stored and the server
 * address becomes the base the server answered with (the address the
 * request came in on). A 403 is "invalid or expired pairing code" whether
 * the code was wrong, used or old; 429 is the rate limit.
 */
export async function pair(req: PairRequest, device = defaultDeviceName()): Promise<Omit<Device, 'token'>> {
  const base = normaliseServer(req.server)
  if (!base) throw new PairError('Which server? Paste the whole link, or type its address.', 0)
  let res: Response
  try {
    res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req.code.trim(), device })
    })
  } catch {
    throw new PairError(`Could not reach ${base}${shortHostHint(base)}`, 0)
  }
  let payload: Record<string, unknown> = {}
  try {
    payload = await res.json()
  } catch {
    // Not the canvas on that port.
  }
  if (!res.ok || payload.ok !== true || typeof payload.token !== 'string') {
    throw new PairError(String(payload.error || res.statusText || `HTTP ${res.status}`), res.status, String(payload.code || ''))
  }
  const server = (payload.server || {}) as { name?: string; base?: string }
  const d: Device = {
    token: payload.token,
    device_id: String(payload.device_id || ''),
    name: String(payload.name || payload.device || device),
    server: { name: String(server.name || ''), base: String(server.base || base).replace(/\/+$/, '') },
    pairedAt: Date.now()
  }
  writeDevice(d)
  setBaseUrl(d.server.base)
  const { token: _t, ...rest } = d
  return rest
}
