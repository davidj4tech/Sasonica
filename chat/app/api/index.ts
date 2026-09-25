/**
 * Every call the chat front end makes to the canvas, in one place.
 *
 * Shapes are in ./types.ts; credentials are ./auth.ts's business. Threads
 * are keyed by session throughout (server-contract.md §10, built 22 Sep
 * 2026): the log and /reply take the session, so no ABS item is ever looked
 * up. A thread is read from its stream (§11, openThreadStream) with the
 * polled log as the fallback. Still to come (§8): stop becomes real, and
 * errors gain a `code`.
 */
import { authHeaders, serverBase } from './auth'
import { readSse } from '../lib/sse'
import { refsIn } from '../lib/refs'
import type {
  Agent,
  AgentLogResponse,
  AgentsResponse,
  AnswerRequest,
  ArchiveResponse,
  PriorityResponse,
  SpeechLevel,
  MoveResponse,
  CloseResponse,
  AnswerResponse,
  AskRequest,
  AskResponse,
  Approval,
  AudioChannel,
  AudioTargetsResponse,
  DashboardResponse,
  DigestResponse,
  DigestsResponse,
  Envelope,
  ConversationLog,
  DraftResponse,
  HarnessesResponse,
  HarnessRun,
  RenameResponse,
  ReplyRequest,
  SearchResponse,
  ReplyResponse,
  SessionId,
  SessionRow,
  SessionsStateResponse,
  SpeechAction,
  SpeechCtlResponse,
  SpeechSentencesResponse,
  SpeechNow,
  StopRequest,
  StopResponse,
  TargetsResponse,
  ThreadEvent
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
  /**
   * Let the request outlive the page (a draft flushed as the tab is hidden
   * or closed). `sendBeacon` cannot carry the Authorization header, so it is
   * a keepalive fetch.
   */
  keepalive?: boolean
}

/** Exported for the notes calls (./notes.ts). */
export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: AbortSignal | CallOptions = {}): Promise<T> {
  const { signal, priority, keepalive } = opts instanceof AbortSignal ? { signal: opts, priority: undefined, keepalive: undefined } : opts
  const base = serverBase()
  if (!base) throw new ApiError('No server address — set one in Settings', 0)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      signal,
      ...(keepalive ? { keepalive: true } : {}),
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

/** `older`: lift the 30-day window on each harness's store (§6.16). */
export function getTargets(signal?: AbortSignal, older = false) {
  return request<TargetsResponse>('GET', `/targets${older ? '?history=all' : ''}`, undefined, signal)
}

export function getSessionsState(signal?: AbortSignal) {
  return request<SessionsStateResponse>('GET', '/sessions/state', undefined, signal)
}

// ── One conversation ──────────────────────────────────────────────────────

/** What to ask the polled log for (§6.2). */
export interface LogQuery {
  /** Include §6.2.2 `messages` (the polled log leaves them out without `messages=1`). */
  messages?: boolean
  /** A message id: only messages before it (the next page back). */
  before?: string
  /** How many messages (default 60, at most 500). */
  limit?: number
  /** A message id: the page holding it, from a few before it to the newest (§6.14 jump). */
  around?: string
}

/**
 * The thread's transcript, by session (§10). Answers from speech history
 * even before the conversation is on the shelf, so a thread started seconds
 * ago is readable at once. 404 "no conversation for that session yet" only
 * when there is no manifest, no line, no pane and no transcript.
 *
 * The thread page reads the stream (openThreadStream) and comes here only
 * as its fallback, for older pages (`before`) and for prefetch.
 */
export function getConversationLog(session: SessionId, opts?: AbortSignal | CallOptions, query: LogQuery = { messages: true }) {
  let path = `/conversation/log?session=${q(session)}`
  if (query.messages) path += '&messages=1'
  if (query.before) path += `&before=${q(query.before)}`
  if (query.limit) path += `&limit=${query.limit}`
  if (query.around) path += `&around=${q(query.around)}`
  return request<ConversationLog>('GET', path, undefined, opts)
}

// ── Search (§6.14) ────────────────────────────────────────────────────────

export interface SearchQuery {
  /** Include tool steps (the Advanced setting). */
  tools?: boolean
  /** The next page: a `next` from the last answer. */
  before?: number | null
  limit?: number
}

/** Every thread's messages, titles, recaps and projects, and memory when the host has it. */
export function search(text: string, query: SearchQuery = {}, signal?: AbortSignal) {
  let path = `/search?q=${q(text)}`
  if (query.tools) path += '&tools=1'
  if (query.before) path += `&before=${query.before}`
  if (query.limit) path += `&limit=${query.limit}`
  return request<SearchResponse>('GET', path, undefined, signal)
}

/** The page of messages before `before` (§6.2 paging). */
export function getEarlier(session: SessionId, before: string, limit = 60, signal?: AbortSignal) {
  return getConversationLog(session, signal, { messages: true, before, limit })
}

/**
 * Open `GET /threads/{session}/events` (§11) with the Authorization header
 * (fetch, not EventSource) and read it until it ends or `signal` aborts.
 * Rejects with an ApiError before the stream opens (401/403/404/503: the
 * server's JSON refusal), or with a network error; resolves when the
 * server closes the stream. `onOpen` gets the time to the response headers
 * (about one round trip), for the follow-along's transit estimate.
 */
export async function openThreadStream(
  session: SessionId,
  handlers: { onOpen?: (rttMs: number) => void; onEvent: (ev: ThreadEvent) => void; onBytes?: () => void },
  signal: AbortSignal
): Promise<void> {
  const base = serverBase()
  if (!base) throw new ApiError('No server address — set one in Settings', 0)
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${base}/threads/${q(session)}/events`, {
      signal,
      cache: 'no-store',
      headers: { ...authHeaders(), Accept: 'text/event-stream' }
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new ApiError(`Could not reach ${base}`, 0)
  }
  if (!res.ok || !res.body || !(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
    let payload: Record<string, unknown> = {}
    try {
      payload = await res.json()
    } catch {
      // not JSON
    }
    throw new ApiError(String(payload.error || res.statusText || `HTTP ${res.status}`), res.status || 0, payload)
  }
  handlers.onOpen?.(Date.now() - t0)
  await readSse(
    res.body,
    {
      onBytes: handlers.onBytes,
      onFrame: (f) => {
        let data: unknown
        try {
          data = JSON.parse(f.data)
        } catch {
          return
        }
        handlers.onEvent({ type: f.event, data } as ThreadEvent)
      }
    },
    signal
  )
}

// ── Background agents (§6.12) ─────────────────────────────────────────────

/** A thread's subagents, in start order, with running/total counts. */
export function getAgents(session: SessionId, signal?: AbortSignal) {
  return request<AgentsResponse>('GET', `/threads/${q(session)}/agents`, undefined, signal)
}

/** One subagent's transcript as messages (read-only); page back with `before`. */
export function getAgentLog(session: SessionId, id: string, opts: { before?: string; limit?: number } = {}, signal?: AbortSignal) {
  let path = `/threads/${q(session)}/agents/${q(id)}/log?messages=1&limit=${opts.limit || 30}`
  if (opts.before) path += `&before=${q(opts.before)}`
  return request<AgentLogResponse>('GET', path, undefined, signal)
}

// ── Sending ───────────────────────────────────────────────────────────────

/**
 * A reply into an existing thread: `POST /reply {session, text}` (§10),
 * shelved or not. A closed session is reopened (`opened: true`); one with
 * no pane and no transcript is 404 "no such session".
 */
export function reply(session: SessionId, text: string) {
  const body: ReplyRequest = { session, text }
  const refs = refsIn(text)
  if (refs) body.refs = refs
  return request<ReplyResponse>('POST', '/reply', body)
}

/** A fresh session: `POST /ask {text, target: "new", cwd?, agent?}`. */
export function askNew(text: string, opts: { cwd?: string; agent?: AskRequest['agent'] } = {}) {
  const body: AskRequest = { text, target: 'new', parse: false }
  const refs = refsIn(text)
  if (refs) body.refs = refs
  if (opts.cwd) body.cwd = opts.cwd
  if (opts.agent) body.agent = opts.agent
  return request<AskResponse>('POST', '/ask', body)
}

// ── Drafts (§6.2) ──────────────────────────────────────────────────────────

/** The server's copy of a thread's unsent words; none is `{text: "", at: 0}`. */
export function getDraft(session: SessionId, signal?: AbortSignal) {
  return request<DraftResponse>('GET', `/draft?session=${q(session)}`, undefined, signal)
}

/**
 * Keep a thread's unsent words on the server. `at` is this device's clock
 * (epoch s), stored as given; empty text deletes. Only the words — nothing
 * is typed anywhere.
 */
export function postDraft(session: SessionId, text: string, at: number, opts: CallOptions = {}) {
  return request<DraftResponse>('POST', '/draft', { session, text, at }, opts)
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
 * Rename a thread, live or ended (§6.4). REAL on the canvas: it types
 * `/rename <title>` into a running session. Test on the mock.
 */
export function renameThread(session: SessionId, title: string) {
  return request<RenameResponse>('POST', '/rename', { session, title })
}

/** Rename a thread with a name the server thinks of from what was said (§6.4 Auto). */
export function autoRenameThread(session: SessionId) {
  return request<RenameResponse>('POST', '/rename', { session, auto: true })
}

/**
 * POST /session/close (§6.4): end the running session (pane or headless).
 * REAL on the canvas: it kills the agent. The next message resumes it.
 */
export function closeSession(session: SessionId) {
  return request<CloseResponse>('POST', '/session/close', { session })
}

/** POST /session/priority (§6.4): the thread's speech level. */
export function prioritySession(session: SessionId, level: SpeechLevel) {
  return request<PriorityResponse>('POST', '/session/priority', { session, level })
}

/** POST /session/archive (§6.4): file the thread under Archived, or take it out. */
export function archiveSession(session: SessionId, archived: boolean) {
  return request<ArchiveResponse>('POST', '/session/archive', { session, archived })
}

/**
 * POST /session/move (§6.15): move the thread to another project. Name it by
 * `project`, or by `cwd` for a directory the thread list has no project for.
 * REAL on the canvas: a live session is closed and reopened there, so the
 * agent restarts (refused, 409, while it is working).
 */
export function moveSession(session: SessionId, dest: { project?: string; cwd?: string }) {
  return request<MoveResponse>('POST', '/session/move', { session, ...dest })
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
export function speechCtl(action: SpeechAction, arg?: number, extra?: { sentence?: number; session?: string }) {
  return request<SpeechCtlResponse>('POST', '/speech/ctl', { action, ...(arg === undefined ? {} : { arg }), ...extra })
}

/**
 * GET /speech/sentences (§6.5 "Read from here"): a spoken reply's sentences
 * as `replay-id` + `sentence` counts them — the server's list, so the app
 * never re-splits the words. `[]`: it can only be replayed from the top.
 */
/** Past digests, newest first (§6.17): all, or one id's; `before` an `n` to page back. */
export function getDigests(opts: { id?: string; before?: number } = {}, signal?: AbortSignal) {
  const qs = [opts.id ? `id=${q(opts.id)}` : '', opts.before ? `before=${opts.before}` : ''].filter(Boolean).join('&')
  return request<DigestsResponse>('GET', `/alerts/digests${qs ? `?${qs}` : ''}`, undefined, signal)
}

/** One digest with its body (§6.17). */
export function getDigest(n: number, signal?: AbortSignal) {
  return request<DigestResponse>('GET', `/alerts/digest?n=${n}`, undefined, signal)
}

export function getSpeechSentences(id: number, signal?: AbortSignal) {
  return request<SpeechSentencesResponse>('GET', `/speech/sentences?id=${encodeURIComponent(String(id))}`, undefined, signal)
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

// ── The home screen (§6.11) ───────────────────────────────────────────────

/** Everything the home screen shows, in one answer. Polled every 5 s while visible. */
export function getDashboard(signal?: AbortSignal) {
  return request<DashboardResponse>('GET', '/dashboard', undefined, signal)
}

// ── Audio destinations (§6.9) ─────────────────────────────────────────────

export function getAudioTargets(signal?: AbortSignal) {
  return request<AudioTargetsResponse>('GET', '/audio/targets', undefined, signal)
}

/**
 * Where the NEXT reply plays (null = back to the default). REAL on the
 * canvas: it moves David's speech. Test on the mock.
 */
export function setAudioTarget(channel: 'speech' | 'music', target: string | null) {
  return request<Envelope & AudioChannel & { channel: string }>('POST', '/audio/target', { channel, target })
}

// ── Harnesses (§6.6) ──────────────────────────────────────────────────────

/** Which of Claude, Codex, pi and Hermes the server has, and signed in or not. */
export function getHarnesses(signal?: AbortSignal) {
  return request<HarnessesResponse>('GET', '/harnesses', undefined, signal)
}

/**
 * Install (or update) a harness, or sign into it, in a window on the server;
 * watch it with components/SetupWindow. REAL on the canvas: it runs npm or
 * the sign-in there. Test on the mock.
 */
export function runHarness(agent: Agent, action: 'install' | 'login') {
  return request<HarnessRun>('POST', '/harnesses/run', { agent, action })
}

export type { SessionRow }
