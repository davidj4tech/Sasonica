import { reactRouter } from '@react-router/dev/vite'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// The build's own version, for About: the commit it was built from and when.
// Outside a git checkout (or without git) it is "dev".
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [reactRouter()],
  define: {
    __APP_SHA__: JSON.stringify(gitSha()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString())
  },
  server: { host: '127.0.0.1', port: 5173 }
})
