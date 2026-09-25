/**
 * Something shared to the app from another app's share sheet: text, a link,
 * or files (ShareInPlugin.java → components/NativeHooks.tsx, with the share
 * in the navigation state; or, on the web, `?text=&title=&url=`, the Web
 * Share Target's shape). It asks where it goes:
 *
 * - New chat, or Into a thread… (found by title, as Share into… finds one):
 *   the words land at the end of that thread's draft and the thread opens,
 *   so they can be added to before sending.
 * - Organiser inbox: captured as a TODO (§6.10 /notes/capture), no chat.
 * - Play it: a link, played by agent-media (§6.3 /share).
 * - Just keep them: the files only.
 *
 * Files go to the host first (§6.18 /upload, ~/shared/<day>/), once however
 * many places the share goes, and a "Shared file: <path>" line per file goes
 * with the words, so the assistant can open it.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { playShared, uploadFile, type Uploaded } from '../api'
import { hasCredential } from '../api/auth'
import { captureNote } from '../api/notes'
import { BackLink } from '../components/Nav'
import { NEW_CHAT, pushDraft, readDraft, writeDraft } from '../lib/drafts'
import { clearShared, type SharedIn } from '../lib/native'
import { candidates, matching, type RefCandidate } from '../lib/refs'

const KEPT = 'sasonica.chat.shared'
const URL_RE = /https?:\/\/\S+/

/** The share on screen: from the navigation state, else kept for a reload, else the web's query. */
function useShared(): SharedIn | null {
  const state = useLocation().state as { share?: SharedIn } | null
  const [params] = useSearchParams()
  return useMemo(() => {
    if (state?.share) {
      try {
        sessionStorage.setItem(KEPT, JSON.stringify(state.share))
      } catch {
        // Not kept for a reload; it is on screen.
      }
      return state.share
    }
    try {
      const raw = sessionStorage.getItem(KEPT)
      if (raw) return JSON.parse(raw) as SharedIn
    } catch {
      // Nothing kept.
    }
    const text = [params.get('text'), params.get('url')].filter(Boolean).join('\n')
    if (!text && !params.get('title')) return null
    return { at: 0, text, subject: params.get('title') || '', files: [], failed: 0 }
  }, [state, params])
}

/** The words as shared: the subject first when the text does not already carry it. */
function wordsOf(s: SharedIn): string {
  const text = (s.text || '').trim()
  const subject = (s.subject || '').trim()
  if (subject && !text.includes(subject)) return text ? `${subject}\n${text}` : subject
  return text
}

export function sizeOf(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1 << 20) return `${Math.round(n / 1024)} KB`
  return `${(n / (1 << 20)).toFixed(n < 10 << 20 ? 1 : 0)} MB`
}

/** The words, then a line per kept file. */
export function messageOf(words: string, kept: Uploaded[]): string {
  const lines = kept.map((u) => `Shared file: ${u.path}`)
  return [words.trim(), lines.join('\n')].filter(Boolean).join('\n\n')
}

/** After whatever the draft under `key` holds already. */
function intoDraft(key: string, text: string) {
  const prev = readDraft(key).text.replace(/\s+$/, '')
  writeDraft(key, prev ? `${prev}\n\n${text}` : text)
  void pushDraft(key)
}

export default function Share() {
  if (!hasCredential()) return <Navigate to="/pairing" replace />
  return <ShareScreen />
}

function ShareScreen() {
  const navigate = useNavigate()
  const shared = useShared()
  const [words, setWords] = useState(() => (shared ? wordsOf(shared) : ''))
  const [kept, setKept] = useState<Uploaded[] | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<{ text: string; failed?: boolean } | null>(null)
  const [picking, setPicking] = useState(false)
  const [rows, setRows] = useState<RefCandidate[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!picking) return
    let live = true
    void candidates().then((all) => live && setRows(all))
    return () => {
      live = false
    }
  }, [picking])

  if (!shared) {
    return (
      <div className="page share-page">
        <header className="bar">
          <BackLink />
          <h1 className="grow">Shared</h1>
        </header>
        <main className="dash">
          <p className="notice">Nothing was shared. Share text, a link or files to Sasonica from another app.</p>
        </main>
      </div>
    )
  }

  const files = shared.files
  const link = files.length === 0 && URL_RE.test(words)

  /** Every file kept on the host, once. */
  const keep = async (): Promise<Uploaded[]> => {
    if (kept) return kept
    const out: Uploaded[] = []
    for (const [i, f] of files.entries()) {
      setBusy(files.length > 1 ? `Sending ${i + 1} of ${files.length}…` : `Sending ${f.name}…`)
      out.push(await uploadFile(f))
    }
    setKept(out)
    if (files.length) void clearShared()
    return out
  }

  const done = () => {
    try {
      sessionStorage.removeItem(KEPT)
    } catch {
      // Nothing kept.
    }
  }

  const run = async (what: () => Promise<void>) => {
    if (busy) return
    setNote(null)
    try {
      await what()
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy('')
    }
  }

  const toThread = (to: RefCandidate | 'new') =>
    run(async () => {
      const text = messageOf(words, await keep())
      if (!text) return
      done()
      intoDraft(to === 'new' ? NEW_CHAT : to.session, text)
      navigate(to === 'new' ? '/new' : `/t/${encodeURIComponent(to.session)}`, {
        replace: true,
        state: to === 'new' ? undefined : { title: to.title }
      })
    })

  const toInbox = () =>
    run(async () => {
      const up = await keep()
      const text = messageOf(words || (up.length ? `Shared: ${up.map((u) => u.name).join(', ')}` : ''), up)
      if (!text) return
      setBusy('Capturing…')
      await captureNote(text, 'todo')
      done()
      setNote({ text: 'In the Organiser’s inbox.' })
    })

  const play = () =>
    run(async () => {
      setBusy('Sending to agent-media…')
      const r = await playShared(words)
      done()
      setNote({ text: r.line || `Playing ${r.title || r.url}` })
    })

  const justKeep = () =>
    run(async () => {
      const up = await keep()
      done()
      setNote({ text: `Kept on the host: ${up.map((u) => u.path).join(', ')}` })
    })

  const hits = matching(rows, query, 40)

  return (
    <div className="page share-page">
      <header className="bar">
        <BackLink />
        <h1 className="grow">Shared to Sasonica</h1>
      </header>
      <main className="dash share-main">
        <textarea
          className="share-words"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder={files.length ? 'Add a few words (optional)' : 'Nothing but the files'}
          aria-label="What was shared"
          rows={Math.min(8, Math.max(3, words.split('\n').length + 1))}
        />
        {files.length > 0 && (
          <ul className="share-files">
            {files.map((f, i) => (
              <li key={f.path}>
                <span className="share-file-name">{f.name}</span>
                <span className="share-file-size">{kept?.[i] ? kept[i].path : sizeOf(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        {shared.failed > 0 && <p className="notice error">{shared.failed === 1 ? 'One file' : `${shared.failed} files`} could not be read.</p>}
        {busy && <p className="status">{busy}</p>}
        {note && <p className={note.failed ? 'status failed' : 'status'}>{note.text}</p>}
        {!picking ? (
          <div role="menu" className="action-list share-where">
            <button role="menuitem" onClick={() => void toThread('new')} disabled={!!busy}>
              New chat
            </button>
            <button role="menuitem" onClick={() => setPicking(true)} disabled={!!busy}>
              Into a thread…
            </button>
            <button role="menuitem" onClick={() => void toInbox()} disabled={!!busy}>
              Organiser inbox
            </button>
            {link && (
              <button role="menuitem" onClick={() => void play()} disabled={!!busy}>
                Play it
              </button>
            )}
            {files.length > 0 && (
              <button role="menuitem" onClick={() => void justKeep()} disabled={!!busy || !!kept}>
                Just keep {files.length === 1 ? 'it' : 'them'}
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              className="share-find"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a thread"
              aria-label="Find a thread"
              enterKeyHint="search"
              autoFocus
            />
            <div role="menu" className="action-list project-list share-where">
              {hits.map((r) => (
                <button key={r.session} role="menuitem" onClick={() => void toThread(r)} disabled={!!busy}>
                  <span className="share-title">{r.title}</span>
                  {r.project && <span className="share-project">{r.project}</span>}
                </button>
              ))}
              {rows.length > 0 && hits.length === 0 && <p className="action-note">No thread by that name.</p>}
              <button className="quiet" onClick={() => setPicking(false)}>
                Back
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
