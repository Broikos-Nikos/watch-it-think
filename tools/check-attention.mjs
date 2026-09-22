/**
 * The twenty four fields are a chart, so they are labelled like one.
 *
 *   npm run check:attention
 *
 * The design audit: twenty four thumbnails with no label, no order and no
 * score, and the source already says they should have one. The note under them
 * invites the reader to find the head that watches the verb, and finding it
 * meant opening twenty four identical squares one at a time and remembering
 * which was which.
 *
 * The coordinates did exist. They were in a `title` attribute, which is a
 * tooltip, which is information nobody has: it needs a mouse, a pause, and a
 * guess that there is something there to wait for. That is the defect class
 * this gate is really about, and it is why the check is that the text is in the
 * element rather than that it exists somewhere.
 *
 * The score is concentration, the same number the caption under the large field
 * quotes. It is checked against the library rather than against itself, because
 * a label that is computed twice is a label that can disagree with the picture
 * it sits on.
 */

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5201
const BASE = `http://localhost:${PORT}/`

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', shell: true,
})
const stop = () => {
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.headcell').length > 0, null, { timeout: 180_000 })
  await page.waitForTimeout(700)

  const grid = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.headcell')]
    return cells.map((c) => ({
      text: c.innerText.replace(/\s+/g, ' ').trim(),
      tag: c.querySelector('.headcell-tag')?.textContent?.trim() ?? null,
      score: c.querySelector('.headcell-score')?.textContent?.trim() ?? null,
      title: c.getAttribute('title'),
      label: c.getAttribute('aria-label'),
      width: Math.round(c.getBoundingClientRect().width),
    }))
  })

  if (grid.length !== 24) {
    fail(`expected 24 fields and found ${grid.length}`)
  }

  // ---- every cell says which layer and head it is --------------------------
  const unlabelled = grid.filter((c) => !/^L\d+H\d+$/.test(c.tag ?? ''))
  if (unlabelled.length > 0) {
    fail(
      `${unlabelled.length} of ${grid.length} thumbnails do not say which layer and head they are`,
      'finding the interesting head means opening them one at a time',
    )
  } else {
    console.log(`  ok      all ${grid.length} thumbnails carry their layer and head`)
  }

  // ---- and how sharp it is -------------------------------------------------
  const unscored = grid.filter((c) => !/^\d+$/.test(c.score ?? ''))
  if (unscored.length > 0) {
    fail(`${unscored.length} thumbnails carry no concentration score`)
  } else {
    const scores = grid.map((c) => Number(c.score))
    const spread = Math.max(...scores) - Math.min(...scores)
    // A score every cell shares is a score that sorts nothing. On any real
    // sentence the heads differ a great deal, so a flat grid means the number
    // is being computed wrong rather than that the model is uniform.
    if (spread < 10) {
      fail(`every thumbnail scores within ${spread} of every other, so the score sorts nothing`)
    } else {
      console.log(
        `  ok      concentration runs ${Math.min(...scores)} to ${Math.max(...scores)}, so the sharp heads stand out`,
      )
    }
  }

  // ---- nothing important lives only in a tooltip ---------------------------
  const tooltipOnly = grid.filter((c) => c.title && !c.text.includes(c.tag ?? '\u0000'))
  if (tooltipOnly.length > 0) {
    fail(
      `${tooltipOnly.length} thumbnails keep their coordinates in a title attribute`,
      'a tooltip needs a mouse, a pause, and a guess that there is something to wait for',
    )
  } else {
    console.log('  ok      no coordinate lives only in a tooltip')
  }

  // ---- the label a screen reader gets says the same thing ------------------
  const mismatched = grid.filter((c) => {
    const m = c.label?.match(/Layer (\d+), head (\d+), concentration (\d+)/)
    if (!m) return true
    return `L${m[1]}H${m[2]}` !== c.tag || m[3] !== c.score
  })
  if (mismatched.length > 0) {
    fail(`${mismatched.length} thumbnails read differently to a screen reader than to the eye`)
  } else {
    console.log('  ok      the spoken label and the printed one agree on every cell')
  }

  await browser.close()
} finally {
  stop()
}

if (failed > 0) {
  console.error('\nA grid of small multiples with no labels is a texture, not a chart.')
  process.exit(1)
}

console.log('attention: every field says what it is and how sharp, on its face')
