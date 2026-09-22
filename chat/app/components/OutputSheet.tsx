/**
 * Where the voice plays (§6.9): the speech channel's options from
 * GET /audio/targets, a tap to choose (POST /audio/target), "Default" to hand
 * speech back to the lane. From the next reply on — a reply already speaking
 * finishes where it is, which the sheet says.
 *
 * Optimistic: the tapped row is marked at once and rolled back if refused.
 */
import { useEffect, useState } from 'react'
import { getAudioTargets, setAudioTarget } from '../api'
import type { AudioChannel } from '../api/types'
import { Sheet } from './SessionSheets'

export function OutputSheet({ onClose, onChanged }: { onClose: () => void; onChanged?: (label: string) => void }) {
  const [ch, setCh] = useState<AudioChannel | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let off = false
    getAudioTargets()
      .then((r) => !off && setCh(r.channels.speech))
      .catch((e) => !off && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      off = true
    }
  }, [])

  const choose = async (name: string | null) => {
    if (!ch || busy) return
    const before = ch
    setBusy(name || 'default')
    setError('')
    setCh({ ...ch, current: name || ch.default || ch.current, overridden: !!name })
    try {
      const r = await setAudioTarget('speech', name)
      const next: AudioChannel = { current: r.current, default: r.default, overridden: r.overridden, options: r.options || before.options }
      setCh(next)
      onChanged?.(next.options.find((o) => o.name === next.current)?.label || next.current || '')
    } catch (e) {
      setCh(before)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <Sheet label="Speech output" onClose={onClose} className="output-sheet">
      <h2 className="sheet-title">Speech plays on</h2>
      {!ch && !error && <p className="hint">Loading…</p>}
      {ch && (
        <div className="output-options" role="radiogroup" aria-label="Speech output">
          {ch.options.map((o) => {
            const on = ch.current === o.name
            return (
              <button
                key={o.name}
                type="button"
                role="radio"
                aria-checked={on}
                className={`option${on ? ' on' : ''}`}
                disabled={!o.available || !!busy}
                onClick={() => choose(o.name)}
              >
                <span className="mark round" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="label">
                  {o.label}
                  {(o.why || !o.available) && <small>{o.why || 'not available'}</small>}
                  {o.name === ch.default && <small>default</small>}
                </span>
              </button>
            )
          })}
          {ch.overridden && (
            <button type="button" className="quiet reset-output" disabled={!!busy} onClick={() => choose(null)}>
              Back to the default
            </button>
          )}
        </div>
      )}
      <p className="hint">From the next reply; one already speaking finishes where it is.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="quiet" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}
