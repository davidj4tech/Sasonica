/**
 * Search (server-contract.md §6.14): every thread's messages, both sides,
 * live or closed or archived; thread titles, recaps and projects; and
 * long-term memory as its own section when the server has agent-memory.
 *
 * Reached from the ⌕ at the end of the Home | Threads switch (components/
 * Nav.tsx), at `/find` — not `/search`, which is the server's route, and a
 * page served from the same origin as the API (the mock) must not shadow it. As you type, after a pause; the previous request is cancelled.
 * A message hit opens its thread scrolled to that message, the words lit
 * (`/t/:session?at=<message>&t=<at>&hl=<terms>`, routes/thread.tsx). The
 * last few searches are kept per device (lib/recentSearches.ts).
 *
 * With the Advanced setting on (lib/advanced.ts), a "Tool steps" filter adds
 * the commands and files the agents touched (`tools=1`).
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { search, type SearchMessageHit, type SearchResponse } from '../api'
import { BackLink } from '../components/Nav'
import { useAdvanced } from '../lib/advanced'
import { Marked, termSpans } from '../lib/highlight'
import { forgetSearches, recentSearches, rememberSearch } from '../lib/recentSearches'

/** Typing pause before a search goes out. */
const DEBOUNCE_MS = 250
/** Shorter than this asks nothing: a one-letter prefix matches everything. */
const MIN_CHARS = 2

function when(at: number): string {
  const d = new Date(at * 1000)
  const days = (Date.now() - d.getTime()) / 86400000
  try {
    if (days < 1 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    if (days < 300) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

const WHO: Record<string, string> = { user: 'You', assistant: 'Agent' }

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(() => params.get('q') || '')
  const advanced = useAdvanced()
  const [tools, setTools] = useState(() => params.get('tools') === '1')
  const [res, setRes] = useState<SearchResponse | null>(null)
  const [more, setMore] = useState<{ loading: boolean; error: string }>({ loading: false, error: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<string[]>(() => recentSearches())
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const withTools = advanced && tools

  useEffect(() => {
    input.current?.focus()
  }, [])

  // As you type: the query goes into the URL (back from a thread comes back
  // to the same results), then out to the server after a pause.
  useEffect(() => {
    const q = text.trim()
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (withTools) next.set('tools', '1')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    if (q.length < MIN_CHARS) {
      setRes(null)
      setError('')
      setBusy(false)
      return
    }
    const ac = new AbortController()
    setBusy(true)
    const t = window.setTimeout(() => {
      search(q, { tools: withTools }, ac.signal)
        .then((r) => {
          setRes(r)
          setError('')
          setMore({ loading: false, error: '' })
        })
        .catch((err) => {
          if ((err as Error)?.name === 'AbortError') return
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!ac.signal.aborted) setBusy(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, withTools])

  const loadMore = async () => {
    if (!res?.next || more.loading) return
    setMore({ loading: true, error: '' })
    try {
      const page = await search(res.q, { tools: withTools, before: res.next })
      setRes((cur) => (cur && cur.q === res.q ? { ...cur, messages: [...cur.messages, ...page.messages], next: page.next } : cur))
      setMore({ loading: false, error: '' })
    } catch (err) {
      setMore({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const keep = () => setRecent(rememberSearch(text))

  const openMessage = (h: SearchMessageHit) => {
    keep()
    const p = new URLSearchParams({ at: h.message, t: String(h.at), hl: (res?.terms || []).join(' ') })
    navigate(`/t/${encodeURIComponent(h.session)}?${p}`, { state: { title: h.thread.title, fromSearch: true } })
  }

  const q = text.trim()
  const empty = res && !res.threads.length && !res.messages.length && !(res.memory?.available && res.memory.items.length)
  const memory = res?.memory?.available ? res.memory : null

  return (
    <div className="page search-page">
      <header className="bar search-bar">
        <BackLink />
        <form
          className="search-field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            keep()
            input.current?.blur()
          }}
        >
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {text && (
            <button type="button" className="icon search-clear" aria-label="Clear" title="Clear" onClick={() => (setText(''), input.current?.focus())}>
              ✕
            </button>
          )}
        </form>
      </header>

      {advanced && (
        <div className="search-filters" role="group" aria-label="Filters">
          <button type="button" className={tools ? 'chip on' : 'chip'} aria-pressed={tools} onClick={() => setTools((v) => !v)}>
            Tool steps
          </button>
        </div>
      )}

      <main className="search-results" aria-busy={busy}>
        {!q && recent.length > 0 && (
          <section>
            <h2 className="search-head">
              Recent
              <button type="button" className="link search-forget" onClick={() => (forgetSearches(), setRecent([]))}>
                Clear
              </button>
            </h2>
            <ul className="recent-searches">
              {recent.map((r) => (
                <li key={r}>
                  <button type="button" onClick={() => setText(r)}>
                    <span aria-hidden="true">↺</span> {r}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!q && !recent.length && <p className="notice">Words from any thread — yours or the agent's — and thread names, recaps and projects.</p>}
        {q && q.length < MIN_CHARS && <p className="notice">Keep typing…</p>}
        {error && <p className="notice error">{error}</p>}
        {busy && !res && <p className="notice delayed">Searching…</p>}
        {res?.indexing && <p className="notice search-indexing">Still indexing — the newest words may be missing.</p>}
        {empty && !busy && <p className="notice">Nothing found for “{res!.q}”.</p>}

        {res && res.threads.length > 0 && (
          <section aria-label="Threads">
            <h2 className="search-head">Threads</h2>
            <ul className="hits">
              {res.threads.map((t) => (
                <li key={t.session}>
                  <Link className="hit thread-hit" to={`/t/${encodeURIComponent(t.session)}`} state={{ title: t.title, fromSearch: true }} onClick={keep}>
                    <span className="hit-title">
                      <Marked text={t.title} match={t.match.title} />
                    </span>
                    <span className="hit-meta">
                      {t.project && (
                        <span className="hit-project">
                          <Marked text={t.project} match={t.match.project} />
                        </span>
                      )}
                      {t.live && <span className="hit-live">live</span>}
                      {t.archived && <span className="hit-archived">archived</span>}
                      {t.at ? <span className="hit-when">{when(t.at)}</span> : null}
                    </span>
                    {t.recap && (
                      <span className="hit-snippet">
                        <Marked text={t.recap} match={t.match.recap} />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {res && res.messages.length > 0 && (
          <section aria-label="Messages">
            <h2 className="search-head">Messages</h2>
            <ul className="hits">
              {res.messages.map((h) => (
                <li key={`${h.session}:${h.message}:${h.kind}`}>
                  <button type="button" className="hit message-hit" onClick={() => openMessage(h)}>
                    <span className="hit-meta">
                      <span className={`hit-who ${h.kind === 'tool' ? 'tool' : h.role}`}>{h.kind === 'tool' ? 'Tool step' : WHO[h.role] || h.role}</span>
                      <span className="hit-thread">{h.thread.title}</span>
                      {h.thread.project && <span className="hit-project">{h.thread.project}</span>}
                      <span className="hit-when">{when(h.at)}</span>
                    </span>
                    <span className={h.kind === 'tool' ? 'hit-snippet mono' : 'hit-snippet'}>
                      <Marked text={h.snippet.text} match={h.snippet.match} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {res.next && (
              <div className="search-more">
                <button type="button" className="earlier-button" disabled={more.loading} onClick={() => void loadMore()}>
                  {more.loading ? 'Loading…' : 'More'}
                </button>
                {more.error && <p className="error">{more.error}</p>}
              </div>
            )}
          </section>
        )}

        {memory && (memory.items.length > 0 || memory.error) && (
          <section aria-label="Memory">
            <h2 className="search-head">From memory</h2>
            {memory.error && <p className="notice">{memory.error}</p>}
            <ul className="hits">
              {memory.items.map((m) => (
                <li key={m.id || m.text} className="hit memory-item">
                  <span className="hit-snippet">
                    <Marked text={m.text} match={termSpans(m.text, res?.terms || [])} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
