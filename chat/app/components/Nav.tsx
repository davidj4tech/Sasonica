/**
 * Getting around: the Home | Threads | Organiser switch at the top of the
 * three, and the ← that leaves a thread (or new chat, settings, a note).
 *
 * The back gesture is the browser's history (Capacitor's back button is
 * `history.back()` while there is one), so both are written to keep that
 * history honest: Home → Threads pushes (back returns Home), Threads → Home
 * pops that entry rather than stacking another, and ← is a real back when
 * the app has somewhere to go back to — the screen you came from, Home or
 * Threads — else Home.
 *
 * Search (routes/search.tsx) is not in the switch: it looks through threads,
 * so it sits with the other thread-list controls (Show / Sort) on Threads —
 * `ThreadSearchLink` below, used by routes/threads.tsx. The Organiser keeps
 * its own ⌕ for notes.
 */
import type { MouseEvent, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import '../search.css'

type Tab = 'home' | 'threads' | 'organiser'

const TAB_PATH: Record<Tab, string> = { home: '/', threads: '/threads', organiser: '/organiser' }

/** The history entry React Router is on (0 = the first page this app loaded). */
const historyIdx = () => (typeof window === 'undefined' ? 0 : Number((window.history.state as { idx?: number } | null)?.idx) || 0)

export function HomeTabs({ current }: { current: Tab }) {
  const navigate = useNavigate()
  const location = useLocation()
  const go = (to: Tab) => {
    if (to === current) return
    const fromHome = (location.state as { fromHome?: boolean } | null)?.fromHome && historyIdx() > 0
    // From Home a tab pushes (back returns Home); between the other two it
    // replaces, so back still means Home; to Home it pops that entry.
    if (to !== 'home') navigate(TAB_PATH[to], { state: { fromHome: current === 'home' || fromHome }, replace: current !== 'home' })
    else if (fromHome) navigate(-1)
    else navigate('/', { replace: true })
  }
  const tab = (id: Tab, label: ReactNode) => (
    <button type="button" role="tab" aria-selected={current === id} className={current === id ? 'tab on' : 'tab'} onClick={() => go(id)}>
      {label}
    </button>
  )
  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      {tab('home', 'Home')}
      {tab('threads', 'Threads')}
      {tab('organiser', <><span className="tab-org">Org</span>aniser</>)}
    </nav>
  )
}

/** ⌕ : search every thread (routes/search.tsx), from the thread list. */
export function ThreadSearchLink() {
  return (
    <Link className="tab-search" to="/find" title="Search threads" aria-label="Search threads">
      <svg viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15.5 15.5 L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </Link>
  )
}

/** What ← does, for code that leaves a screen itself: back, else Home. */
export function useGoBack() {
  const navigate = useNavigate()
  return () => (historyIdx() > 0 ? navigate(-1) : navigate('/', { replace: true }))
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
    <Link className="icon back" to="/" title={title} aria-label={title} onClick={onClick}>
      {children}
    </Link>
  )
}
