// Shared by the headless suites. Playwright is not a dependency of the app:
// point PLAYWRIGHT_CORE at any playwright-core (its browsers cached in
// ~/.cache/ms-playwright), e.g. PLAYWRIGHT_CORE=~/agent-config/node_modules/playwright-core
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const where = process.env.PLAYWRIGHT_CORE
const pw = await import(where ? pathToFileURL(path.join(where, 'index.mjs')).href : 'playwright-core')
export const chromium = pw.chromium
export const SHOTS = process.env.SHOTS || path.join(tmpdir(), 'sasonica-chat-shots')
mkdirSync(SHOTS, { recursive: true })
