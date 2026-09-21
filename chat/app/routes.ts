import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/threads.tsx'),
  route('t/:session', 'routes/thread.tsx'),
  route('new', 'routes/new.tsx'),
  route('settings', 'routes/settings.tsx'),
  route('pairing', 'routes/pairing.tsx')
] satisfies RouteConfig
