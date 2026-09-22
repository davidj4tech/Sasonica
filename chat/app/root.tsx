import { useEffect, type ReactNode } from 'react'
import { Links, Meta, Navigate, Outlet, Scripts, ScrollRestoration, useLocation } from 'react-router'
import './app.css'
import { SpeechProvider } from './hooks/useSpeech'
import { Notices } from './components/Notices'
import { TEXT_SIZE_BOOT } from './lib/textSize'
import { Mark } from './components/Mark'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="color-scheme" content="dark light" />
        <meta name="theme-color" content="#0D1412" />
        <title>Sasonica</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* The brand faces (brand/README.md): Fraunces for the wordmark and
            headings, IBM Plex Sans for everything else. swap: the system face
            shows until they land, at the same rem sizes. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        />
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
  return (
    <div className="boot">
      <span className="wordmark">
        <Mark size={28} />
        Sasonica
      </span>
    </div>
  )
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
          Not on Home or the list, which already show what needs you, the
          dots and the states. */}
      {!['/pairing', '/', '/threads'].includes(location.pathname) && <Notices />}
    </SpeechProvider>
  )
}
