import type { Config } from '@react-router/dev/config'

// SPA mode: no server rendering. `react-router build` writes one
// build/client/index.html that hydrates any path — the static bundle the
// Capacitor shell will load later. Loaders are allowed on the root route
// only in this mode, so every screen fetches from the client.
export default {
  ssr: false,
  appDirectory: 'app',
  // Opt in to the v8 behaviour now, so the upgrade is a version bump.
  future: {
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true
  }
} satisfies Config
