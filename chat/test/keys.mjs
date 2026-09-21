import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const b = await chromium.launch()
async function open(viewport, size) {
  const ctx = await b.newContext({ viewport, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  page.posts = []
  page.on('request', (r) => { if (r.method() === 'POST') page.posts.push({ p: new URL(r.url()).pathname, body: r.postData() }) })
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res, size]) => {
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
    localStorage.setItem('sasonica.chat.textSize', size)
  }, [BASE, pr, size])
  return page
}
const keysPer = (page) => page.evaluate(() => [...document.querySelectorAll('.msg.agent')].map((m) => ({ band: (() => { const v = document.querySelector('.viewport'); return v.clientHeight - document.querySelector('.footer').offsetHeight })(), h: Math.round(m.querySelector('.bubble').getBoundingClientRect().height), keys: m.querySelectorAll('.msg-keys .msg-key').length, labels: [...m.querySelectorAll('.msg-keys .msg-key')].map((k) => k.getAttribute('aria-label')), live: !!m.querySelector('.live-text') })))
const overlap = (page) => page.evaluate(() => {
  // A key's box must not intersect its bubble's text box.
  for (const m of document.querySelectorAll('.msg.agent')) {
    const bub = m.querySelector('.bubble').getBoundingClientRect()
    for (const k of m.querySelectorAll('.msg-key')) { const r = k.getBoundingClientRect(); if (r.left < bub.right - 1 && r.right > bub.left + 1 && r.top < bub.bottom && r.bottom > bub.top) return true }
  }
  return false
})

for (const [name, vp, size] of [['portrait', { width: 390, height: 780 }, 'default'], ['landscape', { width: 844, height: 390 }, 'default'], ['portrait-larger', { width: 390, height: 780 }, 'larger']]) {
  const page = await open(vp, size)
  // Spoken, ended replies: the long conversation (short bubbles) and the real-shaped one after it ends.
  await page.goto(BASE + '/t/' + sid('Mock: shelved conversation'))
  await page.waitForSelector('.msg.agent .msg-key')
  let ks = await keysPer(page)
  ok(ks.every((k) => k.keys === (k.h > Math.max(120, k.band) ? 2 : 1)), `${name}: one key when the bubble fits the band, two when not (band ${ks[0].band}px: ${ks.map((k) => k.h + 'px:' + k.keys).join(', ')})`)
  // the speaking fixture: a long live reply
  await page.goto(BASE + '/t/' + sid('Mock: speaking now'))
  await page.waitForSelector('.live-text', { timeout: 15000 })
  await page.waitForTimeout(800)
  ks = await keysPer(page)
  const live = ks.find((k) => k.live)
  console.log(`  ${name}: live bubble ${live?.h}px, keys ${live?.keys} ${JSON.stringify(live?.labels)}`)
  ok(!(await overlap(page)), `${name}: keys never overlap the bubble text`)
  if (live && live.keys === 2) {
    ok(live.labels.every((l) => l === 'Pause'), `${name}: both keys say Pause while live`)
    await page.locator('.msg.agent:has(.live-text) .msg-keys .msg-key').first().click()
    await page.waitForTimeout(250)
    const after = (await keysPer(page)).find((k) => k.live)
    ok(after.labels.every((l) => l === 'Resume'), `${name}: top key pauses; both keys now say Resume`)
    ok(page.posts.some((p) => p.p === '/speech/ctl' && JSON.parse(p.body).action === 'toggle'), `${name}: top key sent toggle`)
    await page.locator('.msg.agent:has(.live-text) .msg-keys .msg-key').last().click()
    await page.waitForTimeout(250)
    ok((await keysPer(page)).find((k) => k.live).labels.every((l) => l === 'Pause'), `${name}: bottom key resumes; both agree`)
  } else ok(size !== 'larger' ? true : false, `${name}: live bubble ${live?.h}px shows ${live?.keys} key(s)`)
  await page.screenshot({ path: `${SHOTS}/keys-${name}.png` })
  // tall ended reply → ▶ at top sends replay-id
  await fetch(BASE + '/mock/real/restart?ended=1') // ended, id present
  await page.goto(BASE + '/t/' + sid('Mock: real speech (streaming, appends)'))
  await page.waitForSelector('.msg.agent .msg-key')
  await page.waitForTimeout(600)
  ks = await keysPer(page)
  const tall = ks.reduce((a, k) => (k.h > a.h ? k : a))
  ok(tall.keys === 2 && tall.labels.every((l) => l === 'Play this reply'), `${name}: tall spoken reply (${tall.h}px) has ▶ at top and foot`)
  // scroll the top of it into view and press the top key
  const top = page.locator('.msg.agent').filter({ has: page.locator('.msg-keys .msg-key:nth-child(2)') }).last().locator('.msg-keys .msg-key').first()
  await top.scrollIntoViewIfNeeded()
  page.posts.length = 0
  await top.click()
  await page.waitForTimeout(300)
  const rp = page.posts.find((p) => p.p === '/speech/ctl')
  ok(rp && JSON.parse(rp.body).action === 'replay-id' && JSON.parse(rp.body).arg > 0, `${name}: top ▶ sends replay-id ${rp && JSON.parse(rp.body).arg}`)
  await page.screenshot({ path: `${SHOTS}/keys-${name}-tall-top.png` })
  await page.context().close()
}
await fetch(BASE + '/mock/real/restart?in=3')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
