/**
 * One digest, to read (§6.17 `GET /alerts/digest?n=`): its title, when it
 * came, ▶ for its held read-out, and its whole body drawn as a document
 * (lib/markdownDoc.tsx). ← Earlier / Later → step through the same digest's
 * past ones; "All digests" is the list (routes/digests.tsx). Opened from a
 * Home Digests row's title. A digest that names an Organiser view (the org
 * agenda's) shows its lines as that view's live rows (DigestItems) instead;
 * a server without the notes routes gets the body.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { getDigest } from '../api'
import { hasCredential } from '../api/auth'
import type { DigestResponse } from '../api/types'
import { DigestItems } from '../components/DigestItems'
import { BackLink } from '../components/Nav'
import { IconPlay } from '../components/SpeechBar'
import { useSpeechActions } from '../hooks/useSpeech'
import { digestWhen } from '../lib/digests'
import { MarkdownDoc } from '../lib/markdownDoc'

export default function Digest() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <DigestScreen />
}

function DigestScreen() {
  const n = Number(useParams().n)
  const { replayId } = useSpeechActions()
  const [d, setD] = useState<DigestResponse['digest'] | null>(null)
  const [error, setError] = useState('')
  const [noView, setNoView] = useState(false)
  const onAbsent = useCallback(() => setNoView(true), [])

  useEffect(() => {
    const ac = new AbortController()
    setD(null)
    setError('')
    getDigest(n, ac.signal)
      .then((r) => setD(r.digest))
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') setError((e as Error).message || 'Could not load the digest')
      })
    return () => ac.abort()
  }, [n])

  const rid = d?.speech?.id ?? null
  return (
    <div className="page digest-page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">{d?.title || 'Digest'}</h1>
        {d?.speech && (
          <button className="msg-key digest-play" disabled={rid === null} aria-label={rid === null ? 'Read-out still being prepared' : 'Play the read-out'} onClick={() => rid !== null && replayId(rid)}>
            <IconPlay />
          </button>
        )}
      </header>
      <main className="digest-read">
        {error && <p className="notice error">{error}</p>}
        {!d && !error && <p className="notice delayed">Loading…</p>}
        {d && (
          <>
            <p className="digest-meta">
              {digestWhen(d.at)}
              {d.level === 'warn' || d.level === 'needs' ? <span className={`digest-level ${d.level}`}>{d.level}</span> : null}
            </p>
            {d.view && !noView ? (
              <DigestItems view={d.view} detail={d.detail} onAbsent={onAbsent} />
            ) : d.detail ? (
              <MarkdownDoc src={d.detail} />
            ) : (
              <p className="muted">This digest has no body.</p>
            )}
            <nav className="digest-nav">
              {d.prev ? (
                <Link to={`/digests/${d.prev}`} replace className="digest-prev">
                  ← Earlier
                </Link>
              ) : (
                <span />
              )}
              <Link to={`/digests?id=${encodeURIComponent(d.id)}`} className="digest-all">
                All of these
              </Link>
              {d.next ? (
                <Link to={`/digests/${d.next}`} replace className="digest-next">
                  Later →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        )}
      </main>
    </div>
  )
}
