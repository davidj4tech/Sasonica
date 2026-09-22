/**
 * "New reply · <title>" — a reply in another thread, said and left there
 * (lib/arrivals.ts). Tap to open it; ▶ to hear a waiting one now; × or time
 * to dismiss. Never opens anything by itself.
 */
import { useNavigate } from 'react-router'
import { useSpeech } from '../hooks/useSpeech'
import { dismissNotice, useNotices } from '../lib/arrivals'
import { useTitle } from '../lib/titles'
import type { Notice } from '../lib/arrivals'

export function Notices() {
  const notices = useNotices()
  if (!notices.length) return null
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <NoticeRow key={n.id} n={n} />
      ))}
    </div>
  )
}

function NoticeRow({ n }: { n: Notice }) {
  const navigate = useNavigate()
  const speech = useSpeech()
  const title = useTitle(n.session, n.title) || n.session.slice(0, 8)
  const queued = speech.now?.queued || []
  // ▶ only where it can do what it says: this reply is next in line behind
  // what is playing, so ending that plays it.
  const next = n.kind === 'waiting' && speech.now?.live && queued[0]?.session === n.session
  const label = n.urgent ? (n.kind === 'waiting' ? 'Needs you · waiting' : 'Needs you') : n.kind === 'waiting' ? 'Reply waiting' : 'New reply'
  return (
    <div className={n.urgent ? 'notice-toast urgent' : 'notice-toast'}>
      <button
        className="notice-open"
        onClick={() => {
          dismissNotice(n.id)
          navigate(`/t/${encodeURIComponent(n.session)}`, { state: { title } })
        }}
      >
        <span className="notice-kind">{label}</span> · <span className="notice-title">{title}</span>
      </button>
      {next && (
        <button className="notice-key" aria-label="Hear it now" title="Hear it now (ends what is playing)" onClick={() => void speech.ctl('jump-end')}>
          ▶
        </button>
      )}
      <button className="notice-key" aria-label="Dismiss" onClick={() => dismissNotice(n.id)}>
        ×
      </button>
    </div>
  )
}
