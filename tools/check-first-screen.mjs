/**
 * The ten seconds most people give this say the thing worth saying.
 *
 *   npm run check:first-screen
 *
 * The recruiter audit read this repository the way a recruiter does and did not
 * keep scrolling. The sentence that matters:
 *
 *   "Thirty eight of my forty candidates wrapped somebody else's model in an
 *    API call. I cannot tell this one apart from them in ten seconds."
 *
 * The fact that the model was trained from nothing by the author was on line 39
 * of the README, in the passive voice, in a section called "What it is", after
 * a paragraph about quantisation. It is the single most unusual thing about the
 * project and it was below everything.
 *
 * Every other gate in this repository checks whether something is true. This
 * one checks whether it is reachable, which is a different question and the one
 * seven audits never asked.
 *
 * It is deliberately crude. It cannot tell good writing from bad, and it does
 * not try. It asserts that the claim exists above the picture, that the page
 * makes the same claim, and that the first thing a reader meets after the
 * picture is not a shell command.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5209
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

// Everything before the first image is what a reader sees before they have
// scrolled past the thing that stopped them.
const imageAt = readme.indexOf('![')
if (imageAt < 0) {
  fail('there is no image in the README, and a project named for motion leads with one')
}
const above = readme.slice(0, imageAt < 0 ? 600 : imageAt)

// ---- the claim, in the first person, above the picture ---------------------
const saysTrained = /\btrained\b/i.test(above)
const firstPerson = /\b(I|my|mine)\b/.test(above)

if (!saysTrained) {
  fail(
    'nothing above the picture says the model was trained',
    'this is the one fact that separates the project from wrapping somebody else\'s model',
  )
} else if (!firstPerson) {
  fail(
    'the training claim above the picture is not in the first person',
    'the passive voice reads as a fact about a model rather than as a thing a person did',
  )
} else {
  const line = above.split('\n').find((l) => /\btrained\b/i.test(l))?.trim()
  console.log(`  ok      the claim is above the picture: ${JSON.stringify(line?.slice(0, 68))}`)
}

// ---- the proof is linked where the claim is made ---------------------------
if (!/github\.com\/Broikos-Nikos\/bslm/.test(above)) {
  fail(
    'the training repository is not linked above the picture',
    'a claim to have trained a model should be one click from the evidence',
  )
} else {
  console.log('  ok      the training repository is linked above the picture')
}

// ---- and the first thing after it is not a command -------------------------
const after = readme.slice(imageAt).split('\n').slice(1).join('\n')
const firstBlock = after.split('##')[1] ?? ''
const firstProse = after.trimStart().slice(0, 200)
if (/^```/.test(firstProse)) {
  fail('the first thing under the picture is a code block', 'a reader who does not run commands has nowhere to go')
} else {
  console.log('  ok      the first thing under the picture is prose')
}
void firstBlock

// ---- the page makes the same promise ---------------------------------------
const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', shell: true,
})
const stop = () => {
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1')

  const h1 = (await page.textContent('h1'))?.trim() ?? ''
  if (!/\btrained\b/i.test(h1)) {
    fail(
      `the page headline does not say the model was trained: ${JSON.stringify(h1)}`,
      'it used to give a parameter count, which is a specification and not a reason',
    )
  } else {
    console.log(`  ok      the page headline says it too: ${JSON.stringify(h1)}`)
  }

  // On the device most people will open it on, the claim has to be visible
  // without scrolling.
  const visible = await page.evaluate(() => {
    const h = document.querySelector('h1')
    const r = h.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  })
  if (!visible) {
    fail('the headline is not fully visible at 390 by 844 without scrolling')
  } else {
    console.log('  ok      the headline is fully on screen at phone size')
  }

  await browser.close()
} finally {
  stop()
}

if (failed > 0) {
  console.error('\nBeing true is not the same as being reachable.')
  process.exit(1)
}

console.log('first screen: the claim is above the picture, linked to its proof, and on the page')
