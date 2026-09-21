/**
 * Every call the chat front end makes to the canvas, in one place.
 *
 * Shapes are in ./types.ts; credentials are ./auth.ts's business. When the v1
 * routes land (server-contract.md §8), the changes are here: `item` becomes
 * `session` on the log and reply, the stream replaces the poll, stop becomes
 * real, and errors gain a `code`.
 */
import { authHeaders, serverBase } from './auth'
import type {
  AnswerRequest,
  AnswerResponse,
  AskRequest,
  AskResponse,
  Approval,
  ConversationLog,
  ItemId,
  ReplyResponse,
  SessionConversation,
  SessionId,
  SessionRow,
  SessionsStateResponse,
  StopRequest,
  StopResponse,
  TargetsResponse
} from './types'

export * from './types'

/**
 * A refusal, carrying the server's own sentence (§3: "phrased to be put on
 * screen") and the whole payload — a 300 from /ask brings its candidates, a
 * 409 from /session/answer brings the new question, a 502 from /reply says
 * `submitted: false`.
 */
export class ApiError extends Error {
  status: number
  payload: Record<string, unknown>
  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
  /** §3: only 401 means the credential was rejected. 503 never logs out. */
  get badCredential() {
    return this.status === 401
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const base = serverBase()
  if (!base) throw new ApiError('No server address — set one in Settings', 0)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      signal,
      headers: {
        ...authHeaders(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new ApiError(`Could not reach ${base}`, 0)
  }
  let payload: Record<string, unknown> = {}
  try {
    payload = await res.json()
  } catch {
    // Something else on that port, or a canvas that fell over mid-answer.
  }
  // §3: `ok: false` is failure whatever the status. /focus refuses with
  // `{"error"}` and no `ok` (§15), which !res.ok catches.
  if (!res.ok || payload.ok === false) {
    throw new ApiError(String(payload.error || res.statusText || `HTTP ${res.status}`), res.status, payload)
  }
  return payload as T
}

const q = encodeURIComponent

/** Canvas-relative (`/img/…`) or absolute, as the server chose (§3). */
export function pictureUrl(src: string): string {
  return src.startsWith('/') ? `${serverBase()}${src}` : src
}

// ── Threads ───────────────────────────────────────────────────────────────

export function getTargets(signal?: AbortSignal) {
  return request<TargetsResponse>('GET', '/targets', undefined, signal)
}

export function getSessionsState(signal?: AbortSignal) {
  return request<SessionsStateResponse>('GET', '/sessions/state', undefined, signal)
}

// ── One conversation ──────────────────────────────────────────────────────

/** Resolve a session to its ABS item (v0 needs the item for the log). */
export function getSessionConversation(session: SessionId, signal?: AbortSignal) {
  return request<SessionConversation>('GET', `/conversation?session=${q(session)}`, undefined, signal)
}

/** v0: keyed by item. v1 (§10): `/conversation/log?session=`. */
export function getConversationLog(item: ItemId, signal?: AbortSignal) {
  return request<ConversationLog>('GET', `/conversation/log?item=${q(item)}`, undefined, signal)
}

// ── Sending ───────────────────────────────────────────────────────────────

/**
 * A reply into an existing thread. v0's /reply takes an item; a thread that is
 * not on the shelf yet has none, so it goes through /ask with the session as
 * the picked target instead (`how: "picked"`), which needs no item.
 * v1 (§10): `POST /reply {session, text}` for both.
 */
export async function reply(thread: { session: SessionId; item: ItemId | null }, text: string): Promise<ReplyResponse | AskResponse> {
  if (thread.item) return request<ReplyResponse>('POST', '/reply', { item: thread.item, text })
  return request<AskResponse>('POST', '/ask', { text, target: thread.session, parse: false } satisfies AskRequest)
}

/** A fresh session: `POST /ask {text, target: "new", cwd?, agent?}`. */
export function askNew(text: string, opts: { cwd?: string; agent?: AskRequest['agent'] } = {}) {
  const body: AskRequest = { text, target: 'new', parse: false }
  if (opts.cwd) body.cwd = opts.cwd
  if (opts.agent) body.agent = opts.agent
  return request<AskResponse>('POST', '/ask', body)
}

// ── Managing a thread ─────────────────────────────────────────────────────

export type AnswerResult =
  | { ok: true; res: AnswerResponse }
  /** 409 "the question has changed": re-render from this and ask again. */
  | { ok: false; changed: true; approval: Approval | null; error: string }
  | { ok: false; changed: false; error: string }

/** Press option `choice` on the dialog fingerprinted by `key`. */
export async function answer(body: AnswerRequest): Promise<AnswerResult> {
  try {
    const res = await request<AnswerResponse>('POST', '/session/answer', body)
    return { ok: true, res }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && 'approval' in err.payload) {
      return { ok: false, changed: true, approval: (err.payload.approval as Approval) || null, error: err.message }
    }
    return { ok: false, changed: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * STUB — v1 (§12), not built on the server: `POST /session/stop`.
 *
 * The runtime's onCancel will call this. The first press sends
 * `speech: "auto"` (interrupt the turn if it is working, else stop this
 * thread's speech); a second press within 5 s sends `speech: "silence"`.
 * The double-press bookkeeping lives in the caller (useStop in Thread.tsx) so
 * that when the route exists, only the body of this function changes.
 */
export async function stopSession(body: StopRequest): Promise<StopResponse> {
  void body
  // When §12 lands: return request<StopResponse>('POST', '/session/stop', body)
  throw new ApiError('Stop is not available yet (needs POST /session/stop, server-contract.md §12)', 0)
}

export type { SessionRow }
