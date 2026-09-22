/**
 * Getting around: the Home | Threads switch at the top of both screens, and
 * the ← that leaves a thread (or new chat, settings, notes).
 *
 * The back gesture is the browser's history (Capacitor's back button is
 * `history.back()` while there is one), so both are written to keep that
 * history honest: Home → Threads pushes (back returns Home), Threads → Home
 * pops that entry rather than stacking another, and ← is a real back when
 * the app has somewhere to go back to — the screen you came from, Home or
 * Threads — else Home.
 */
import type { MouseEvent, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

type Tab = 'home' | 'threads'

/** The history entry React Router is on (0 = the first page this app loaded). */
const historyIdx = () => (typeof window === 'undefined' ? 0 : Number((window.history.state as { idx?: number } | null)?.idx) || 0)

export function HomeTabs({ current }: { current: Tab }) {
  const navigate = useNavigate()
  const location = useLocation()
  const go = (to: Tab) => {
    if (to === current) return
    if (to === 'threads') navigate('/threads', { state: { fromHome: true } })
    else if ((location.state as { fromHome?: boolean } | null)?.fromHome && historyIdx() > 0) navigate(-1)
    else navigate('/', { replace: true })
  }
  const tab = (id: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={current === id} className={current === id ? 'tab on' : 'tab'} onClick={() => go(id)}>
      {label}
    </button>
  )
  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      {tab('home', 'Home')}
      {tab('threads', 'Threads')}
    </nav>
  )
}

/** ← : back where you came from inside the app, else Home. */
export function BackLink({ title = 'Back', children = '←' }: { title?: string; children?: ReactNode }) {
  const navigate = useNavigate()
  const onClick = (e: MouseEvent) => {
    if (historyIdx() > 0) {
      e.preventDefault()
      navigate(-1)
    }
  }
  return (
    <Link className="icon" to="/" title={title} aria-label={title} onClick={onClick}>
      {children}
    </Link>
  )
}
