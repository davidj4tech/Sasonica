/**
 * The chat box at the foot of a note or a to-do (§6.10 POST /notes/ask): like
 * a new chat, the words start a fresh session — opened in the notes tree, the
 * item named up front — and the app goes to its thread. The chats already
 * started about the item are listed above the box.
 *
 * Enter is a new line and Ctrl/Cmd+Enter sends, as in a thread's composer.
 * Unsent words are kept on this device under the item's own draft key.
 */
import { useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { askNote, type NoteChat } from '../api/notes'
import { draftSent, readDraft, writeDraft } from '../lib/drafts'
import { AutoGrowTextarea } from './AutoGrow'
import { SEND_KEYS } from './Thread'

export function NoteAsk({ path, at, title, chats }: { path: string; at: number; title: string; chats: NoteChat[] }) {
  const navigate = useNavigate()
  const key = `(note) ${path}#${at}`
  const [text, setText] = useState(() => readDraft(key).text)
  const [status, setStatus] = useState<{ text: string; failed?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const change = (v: string) => {
    setText(v)
    writeDraft(key, v)
  }

  const send = async () => {
    const words = text.trim()
    if (!words || busy) return
    setBusy(true)
    setStatus({ text: 'Opening a session…' })
    try {
      const res = await askNote(path, at, words)
      draftSent(key, text)
      setText('')
      if (res.session) {
        navigate(`/t/${encodeURIComponent(res.session)}`, { state: { title: `${title}: ${words}`.slice(0, 60) } })
        return
      }
      setStatus({ text: `Sent to ${res.pane || 'the host'}; its session id has not registered yet.` })
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="note-ask">
      {chats.length > 0 && (
        <nav className="note-chats" aria-label="Chats about this">
          {chats.slice(0, 3).map((c) => (
            <Link key={c.session} to={`/t/${encodeURIComponent(c.session)}`} state={{ title: c.title }}>
              💬 {c.title}
            </Link>
          ))}
        </nav>
      )}
      {status && <p className={status.failed ? 'status failed' : 'status'}>{status.text}</p>}
      <div className="composer">
        <AutoGrowTextarea
          className="input"
          rows={1}
          maxRows={6}
          enterKeyHint="enter"
          placeholder="Ask about this…"
          value={text}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="send" disabled={busy || !text.trim()} onClick={() => void send()} title="Start a chat about this">
          ↑
        </button>
      </div>
      <p className="send-hint">{SEND_KEYS} to send</p>
    </div>
  )
}
