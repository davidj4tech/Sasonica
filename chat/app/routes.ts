import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('threads', 'routes/threads.tsx'),
  route('find', 'routes/search.tsx'),
  route('t/:session', 'routes/thread.tsx'),
  route('t/:session/agents/:id', 'routes/agent.tsx'),
  route('new', 'routes/new.tsx'),
  route('share', 'routes/share.tsx'),
  route('settings', 'routes/settings.tsx'),
  route('settings/agents', 'routes/harnesses.tsx'),
  route('about', 'routes/about.tsx'),
  route('digests', 'routes/digests.tsx'),
  route('digests/:n', 'routes/digest.tsx'),
  route('pairing', 'routes/pairing.tsx'),
  route('organiser', 'routes/notes.tsx'),
  route('organiser/note', 'routes/note.tsx'),
  route('organiser/setup', 'routes/notes-setup.tsx')
] satisfies RouteConfig
