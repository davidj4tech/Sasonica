/**
 * Every call the chat front end makes to the canvas, in one place.
 *
 * Shapes are in ./types.ts; credentials are ./auth.ts's business. Threads
 * are keyed by session throughout (server-contract.md §10, built 22 Sep
 * 2026): the log and /reply take the session, so no ABS item is ever looked
 * up. Still to come (§8): the stream replaces the poll, stop becomes real,
 * and errors gain a `code`.
 */
import { authHeaders, serverBase } from './auth'
import type {
  AnswerRequest,
  AnswerResponse,
  AskRequest,
  AskResponse,
  Approval,
  ConversationLog,
  ReplyRequest,
  ReplyResponse,
  SessionId,
  SessionRow,
  SessionsStateResponse,
  SpeechAction,
  SpeechCtlResponse,
  SpeechNow,
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

/** Per-call fetch options beyond the method and body. */
export interface CallOptions {
  signal?: AbortSignal
  /**
   * `'low'` for background work (prefetch), so the browser schedules it
   * behind anything the person is waiting for. A hint; ignored where unsupported.
   */
  priority?: 'high' | 'low' | 'auto'
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: AbortSignal | CallOptions = {}): Promise<T> {
  const { signal, priority } = opts instanceof AbortSignal ? { signal: opts, priority: undefined } : opts
  const base = serverBase()
  if (!base) throw new ApiError('No server address — set one in Settings', 0)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      signal,
      ...(priority ? ({ priority } as RequestInit) : {}),
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

/**
 * The thread's transcript, by session (§10). Answers from speech history
 * even before the conversation is on the shelf, so a thread started seconds
 * ago is readable at once. 404 "no conversation for that session yet" only
 * when there is no manifest, no line, no pane and no transcript.
 */
export function getConversationLog(session: SessionId, opts?: AbortSignal | CallOptions) {
  return request<ConversationLog>('GET', `/conversation/log?session=${q(session)}`, undefined, opts)
}

/**
 * A log answer that may hold only the newest lines. `complete: false` means
 * older lines exist and a full getConversationLog should follow.
 */
export type LogTail = ConversationLog & { complete: boolean }

/**
 * HOOK for the server's future `?tail=N` (newest N lines only) — the cold
 * open of a thread with nothing cached asks for this first, so the bottom of
 * the conversation arrives in a fraction of the bytes, and the full log
 * follows to fill in above it.
 *
 * TODAY the server has no `tail`, so this IS the full log and says
 * `complete: true` (no second request). When the server gains it, the switch
 * is this function's body:
 *
 *   const res = await request<ConversationLog & { truncated?: boolean }>(
 *     'GET', `/conversation/log?session=${q(session)}&tail=${n}`, undefined, opts)
 *   return { ...res, complete: !res.truncated }
 *
 * (An older server ignores the unknown parameter and returns everything with
 * no `truncated`, which reads as complete — so the switch is safe to ship
 * before the server.)
 */
export async function fetchLogTail(session: SessionId, n: number, opts?: AbortSignal | CallOptions): Promise<LogTail> {
  void n
  const res = await getConversationLog(session, opts)
  return { ...res, complete: true }
}

// ── Sending ───────────────────────────────────────────────────────────────

/**
 * A reply into an existing thread: `POST /reply {session, text}` (§10),
 * shelved or not. A closed session is reopened (`opened: true`); one with
 * no pane and no transcript is 404 "no such session".
 */
export function reply(session: SessionId, text: string) {
  return request<ReplyResponse>('POST', '/reply', { session, text } satisfies ReplyRequest)
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

// ── Speech (§6.5) ─────────────────────────────────────────────────────────

/** What the voice is saying now. Polled by the one SpeechProvider. */
export function getSpeechNow(signal?: AbortSignal) {
  return request<SpeechNow>('GET', '/speech/now', undefined, signal)
}

/**
 * A listening key: `toggle`, `skip-`/`skip+`, `replay-id` + a history row id…
 * REAL on the canvas: it pauses the voice David is hearing. Test on the mock.
 */
export function speechCtl(action: SpeechAction, arg?: number) {
  return request<SpeechCtlResponse>('POST', '/speech/ctl', arg === undefined ? { action } : { action, arg })
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
