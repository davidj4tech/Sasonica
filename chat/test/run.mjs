#!/usr/bin/env node
// Headless suites against the mock (never the real canvas):
//   pnpm build && PLAYWRIGHT_CORE=<dir> node test/run.mjs
//
//   pair    fresh install → pair with a code → list → open a thread by
//           session in ONE log request → reply; unpair; spent/wrong code;
//           auto-pair link; pasted sasonica:// link; revoked token; legacy
//           ABS token
//   follow  real-shaped speech (sentences growing, paused start, working
//           under it, lines appended below, no offsets): the bold stays on
//           screen and the view is never yanked to the bottom; hand scroll →
//           "Follow along"; "New messages ↓"; at default and Larger text
//   skew    the bold follows /speech/now's pos when `elapsed` runs ahead
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mockAt = (port, env) => {
  const p = spawn(process.execPath, [path.join(here, '..', 'mock', 'server.mjs'), '--port', String(port)], { env: { ...process.env, ...env }, stdio: 'ignore' })
  return new Promise((r) => setTimeout(() => r(p), 800))
}
const run = (file, env = {}) =>
  new Promise((r) => {
    const p = spawn(process.execPath, [path.join(here, file)], { env: { ...process.env, ...env }, stdio: 'inherit' })
    p.on('exit', (code) => r(code || 0))
  })

const mock = await mockAt(8811, { MOCK_SPEECH_REST_S: '0' })
const skewMock = await mockAt(8812, { MOCK_REAL_VOICE: '1' })
let failed = 0
try {
  for (const [file, env] of [['pair.mjs'], ['follow.mjs'], ['follow.mjs', { SIZE: 'larger' }], ['skew.mjs']]) {
    console.log(`\n── ${file} ${env ? JSON.stringify(env) : ''}`)
    failed += (await run(file, env)) ? 1 : 0
  }
} finally {
  mock.kill()
  skewMock.kill()
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites pass')
process.exit(failed ? 1 : 0)
