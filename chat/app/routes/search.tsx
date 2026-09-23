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
 *
 * The thread list's narrowing follows you here, as its own Show button at
 * the top of the screen (lib/threadFilter.ts `searchFilterOf`): Show,
 * project and agent, seeded from the list but shown and changeable, so a
 * missing hit always has a visible reason. It rides in the URL, so coming
 * back from a thread comes back to the same results. The server is asked
 * for everything either way (§6.14); the filter is applied to the hits.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { search, type SearchMessageHit, type SearchResponse } from '../api'
import type { Harness } from '../api/types'
import { BackLink } from '../components/Nav'
import { Popover } from '../components/Popover'
import { useAdvanced } from '../lib/advanced'
import {
  EVERYTHING,
  HARNESSES,
  HARNESS_LABEL,
  SHOWS,
  SHOW_LABEL,
  type HitFilter,
  type ThreadShow,
  hitFilterLabel,
  isEverything,
  loadThreadFilter,
  matchesHit,
  searchFilterOf
} from '../lib/threadFilter'
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

/**
 * The narrowing this screen opens with: what the URL says (coming back from
 * a thread, or a shared link), else the thread list's own.
 */
function fromParams(params: URLSearchParams): HitFilter {
  if (!params.has('show') && !params.has('project') && !params.has('agent')) {
    try {
      return searchFilterOf(loadThreadFilter())
    } catch {
      return EVERYTHING
    }
  }
  const show = params.get('show')
  const agent = params.get('agent')
  return {
    show: SHOWS.includes(show as ThreadShow) ? (show as ThreadShow) : 'all',
    project: params.get('project') || null,
    harness: HARNESSES.includes(agent as Harness) ? (agent as Harness) : null
  }
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(() => params.get('q') || '')
  const advanced = useAdvanced()
  const [tools, setTools] = useState(() => params.get('tools') === '1')
  const [filter, setFilter] = useState<HitFilter>(() => fromParams(params))
  const [filterOpen, setFilterOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
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

  // The screen, in the URL: back from a thread comes back to the same words
  // and the same narrowing.
  useEffect(() => {
    const q = text.trim()
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (withTools) next.set('tools', '1')
    if (filter.show !== 'all') next.set('show', filter.show)
    if (filter.project) next.set('project', filter.project)
    if (filter.harness) next.set('agent', filter.harness)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, withTools, filter])

  // As you type, out to the server after a pause. The filter is not in this:
  // the index is asked for everything, and the hits are sifted here.
  useEffect(() => {
    const q = text.trim()
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
  // What the filter leaves. Memory is not a thread and is never narrowed.
  const threads = (res?.threads || []).filter((t) => matchesHit(t, filter))
  const messages = (res?.messages || []).filter((h) => matchesHit(h.thread, filter))
  const memory = res?.memory?.available ? res.memory : null
  const empty = res && !threads.length && !messages.length && !(memory && memory.items.length)
  const hidden = res ? res.threads.length - threads.length + (res.messages.length - messages.length) : 0
  // The projects the menu offers: those this search actually turned up, and
  // the one already picked even when nothing here is in it.
  const projects = [...new Set([...(res?.threads || []).map((t) => t.project), ...(res?.messages || []).map((h) => h.thread.project)].map((p) => p || 'Other'))].sort(
    (a, b) => Number(a === 'Other') - Number(b === 'Other') || a.localeCompare(b)
  )
  if (filter.project && !projects.includes(filter.project)) projects.push(filter.project)
  const harnesses = HARNESSES.filter((h) =>
    h === filter.harness || (res?.threads || []).some((t) => t.harness === h) || (res?.messages || []).some((m) => m.thread.harness === h)
  )

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

      <div className="search-filters" role="group" aria-label="Filters">
        <button
          ref={filterButton}
          type="button"
          className={isEverything(filter) ? 'filter-button' : 'filter-button on'}
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((o) => !o)}
        >
          Show: {hitFilterLabel(filter)} <span aria-hidden="true">▾</span>
        </button>
        {advanced && (
          <button type="button" className={tools ? 'chip on' : 'chip'} aria-pressed={tools} onClick={() => setTools((v) => !v)}>
            Tool steps
          </button>
        )}
      </div>

      {filterOpen && (
        <Popover anchor={filterButton} label="Filter results" align="left" className="sort-menu filter-menu" onClose={() => setFilterOpen(false)}>
          <div className="menu-head" role="presentation">Show</div>
          {SHOWS.filter((k) => k !== 'active').map((k) => (
            <button key={k} role="menuitemradio" aria-checked={filter.show === k} className={filter.show === k ? 'on' : ''} onClick={() => setFilter({ ...filter, show: k })}>
              <span className="mark" aria-hidden="true">
                {filter.show === k ? '✓' : ''}
              </span>
              {SHOW_LABEL[k]}
            </button>
          ))}
          <div className="menu-head" role="presentation">Agent</div>
          {[null, ...harnesses].map((hn) => (
            <button key={hn ?? ''} role="menuitemradio" aria-checked={filter.harness === hn} className={filter.harness === hn ? 'on' : ''} onClick={() => setFilter({ ...filter, harness: hn })}>
              <span className="mark" aria-hidden="true">
                {filter.harness === hn ? '✓' : ''}
              </span>
              {hn ? HARNESS_LABEL[hn] : 'All agents'}
            </button>
          ))}
          <div className="menu-head" role="presentation">Project</div>
          {[null, ...projects].map((pr) => (
            <button key={pr ?? ''} role="menuitemradio" aria-checked={filter.project === pr} className={filter.project === pr ? 'on' : ''} onClick={() => setFilter({ ...filter, project: pr })}>
              <span className="mark" aria-hidden="true">
                {filter.project === pr ? '✓' : ''}
              </span>
              {pr ?? 'All projects'}
            </button>
          ))}
        </Popover>
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
        {empty && !busy && (
          <p className="notice">
            Nothing found for “{res!.q}”
            {isEverything(filter) ? '.' : ` under ${hitFilterLabel(filter)}.`}{' '}
            {!isEverything(filter) && (
              <button type="button" className="link" onClick={() => setFilter(EVERYTHING)}>
                Search everything
              </button>
            )}
          </p>
        )}
        {!empty && hidden > 0 && !busy && (
          <p className="notice search-hidden">
            {hidden} more {hidden === 1 ? 'hit is' : 'hits are'} outside {hitFilterLabel(filter)}.{' '}
            <button type="button" className="link" onClick={() => setFilter(EVERYTHING)}>
              Search everything
            </button>
          </p>
        )}

        {threads.length > 0 && (
          <section aria-label="Threads">
            <h2 className="search-head">Threads</h2>
            <ul className="hits">
              {threads.map((t) => (
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

        {messages.length > 0 && (
          <section aria-label="Messages">
            <h2 className="search-head">Messages</h2>
            <ul className="hits">
              {messages.map((h) => (
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
            {res?.next && (
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
