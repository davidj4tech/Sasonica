/**
 * The reply box's attach button: images or files from the phone (the
 * WebView's own file chooser — Files, Photos, the camera) or the desk. Each
 * one goes to the host at once (§6.18 POST /upload, ~/shared/<day>/) and a
 * "Shared file: <path>" line lands at the caret, the same line the share
 * screen (routes/share.tsx) sends, so the assistant can open it.
 */
import { useRef, useState } from 'react'
import { uploadPicked } from '../api'

type Note = { text: string; failed?: boolean } | null

export function AttachButton(props: { onPicked: (text: string) => void; onStatus: (n: Note) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const send = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    const kept: string[] = []
    try {
      for (const [i, f] of files.entries()) {
        props.onStatus({ text: files.length > 1 ? `Sending ${i + 1} of ${files.length}…` : `Sending ${f.name}…` })
        kept.push((await uploadPicked(f)).path)
      }
      props.onStatus(null)
    } catch (err) {
      props.onStatus({ text: `${err instanceof Error ? err.message : String(err)}${kept.length ? ` (${kept.length} sent)` : ''}`, failed: true })
    } finally {
      setBusy(false)
      if (kept.length) props.onPicked(kept.map((p) => `Shared file: ${p}`).join('\n'))
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files || [])]
          // Cleared, so picking the same file again still fires.
          e.target.value = ''
          void send(files)
        }}
      />
      <button type="button" className={busy ? 'attach busy' : 'attach'} aria-label="Attach images or files" title="Attach images or files" disabled={busy} onClick={() => input.current?.click()}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
    </>
  )
}
