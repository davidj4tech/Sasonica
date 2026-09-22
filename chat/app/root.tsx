import { useEffect, type ReactNode } from 'react'
import { Links, Meta, Navigate, Outlet, Scripts, ScrollRestoration, useLocation } from 'react-router'
import './app.css'
import { SpeechProvider } from './hooks/useSpeech'
import { Notices } from './components/Notices'
import { TEXT_SIZE_BOOT } from './lib/textSize'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="color-scheme" content="dark light" />
        <title>Sasonica</title>
        {/* The saved text size, on the root before first paint (lib/textSize.ts). */}
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

/** Rendered into index.html at build time, shown until the SPA hydrates. */
export function HydrateFallback() {
  return <div className="boot">Sasonica</div>
}

/**
 * --vvh: the visible height, for browsers whose soft keyboard overlays the
 * page rather than resizing it (app.css .page). Where the keyboard resizes
 * the layout (Chrome on Android, per the viewport meta) this equals 100dvh.
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const set = () => {
      // Pinch-zoom shrinks the visual viewport too; that is not a keyboard.
      if (vv.scale > 1.01) return
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
    }
    set()
    vv.addEventListener('resize', set)
    return () => {
      vv.removeEventListener('resize', set)
      root.style.removeProperty('--vvh')
    }
  }, [])
}

export default function App() {
  useVisualViewportHeight()
  // A pairing link opened straight into the app (`/?pair=<code>&server=<base>`,
  // e.g. the preview server's redirect): hand it to the pairing screen, which
  // pairs at once.
  const location = useLocation()
  if (location.pathname !== '/pairing' && new URLSearchParams(location.search).has('pair')) {
    return <Navigate to={`/pairing${location.search}`} replace />
  }
  // One /speech/now poll for every screen (hooks/useSpeech.tsx).
  return (
    <SpeechProvider>
      <Outlet />
      {/* Replies in other threads: told here, never followed (lib/arrivals.ts).
          Not on the list, whose rows already carry the dots and states. */}
      {location.pathname !== '/pairing' && location.pathname !== '/' && <Notices />}
    </SpeechProvider>
  )
}
