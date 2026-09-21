/**
 * The thread list: /targets.sessions (live first, with a live badge) and
 * what each live one is doing from /sessions/state, polled every 5 s.
 * Paints from the last saved answer; once the fresh one lands, the top few
 * threads are warmed in the background (hooks/usePrefetch.ts).
 */
import { Link } from 'react-router'
import { hasToken } from '../api/auth'
import type { SessionState } from '../api/types'
import { usePrefetch } from '../hooks/usePrefetch'
import { useSessionStates, useTargets } from '../hooks/useThreads'

const STATE_LABEL: Record<SessionState, string> = {
  working: 'working',
  waiting: 'your turn',
  approval: 'needs you'
}

function ago(at?: number): string {
  if (!at) return ''
  const s = Date.now() / 1000 - at
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export default function Threads() {
  const { sessions, error, loading, stale, reload } = useTargets()
  const states = useSessionStates()
  usePrefetch(sessions, !stale && !loading && !error)

  return (
    <div className="page">
      <header className="bar">
        <h1>Sasonica</h1>
        {stale && loading && <span className="updating">updating…</span>}
        <button className="icon" onClick={() => reload()} title="Refresh">
          ↻
        </button>
        <Link className="icon" to="/settings" title="Settings">
          ⚙
        </Link>
      </header>

      {!hasToken() && (
        <p className="notice">
          No token set. <Link to="/settings">Settings</Link>
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      {loading && !sessions.length && <p className="notice">Loading…</p>}

      <ul className="threads">
        {sessions.map((row) => {
          const state = states[row.session]
          return (
            <li key={row.session}>
              <Link to={`/t/${encodeURIComponent(row.session)}`} state={{ title: row.title }} className="thread-row">
                <span className={`dot ${row.live ? state || 'live' : 'shelved'}`} />
                <span className="title">{row.title || row.session.slice(0, 8)}</span>
                {row.live ? (
                  <span className={`badge ${state || ''}`}>{state ? STATE_LABEL[state] : 'live'}</span>
                ) : (
                  <span className="when">{ago(row.at)}</span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      <Link to="/new" className="fab" title="New chat">
        +
      </Link>
    </div>
  )
}
