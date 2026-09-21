/**
 * Nothing a visitor can paste makes the page scroll sideways.
 *
 *   npm run check:layout
 *
 * The hostile stranger audit pasted a sha256 at 390 by 844 and the document
 * went to 631 pixels wide inside a 390 pixel viewport: the chip ran off the
 * right edge, the tag box's border was cut mid air, and the page gained a
 * horizontal scrollbar. On a desktop width a 32,000 character word gave a
 * scrollWidth of 285,214.
 *
 * A hash, a base64 fragment, a German compound and a long identifier are all
 * ordinary things to put in a box that asks for a sentence, and a token has no
 * spaces in it by construction, so this was reachable by one paste on the
 * device most people will open the page on.
 *
 * This has to be a real browser. The defect is a number the layout engine
 * computes, and no amount of reading the stylesheet produces it: the rule that
 * fixes it is `overflow-wrap: anywhere` rather than `break-word` specifically
 * because only `anywhere` changes min-content width, which is what the flex
 * container is reading. Asserting the text of the CSS would assert the fix and
 * not the property.
 *
 * It starts and stops its own preview server, because a gate that assumes
 * somebody already ran `npm run dev` is a gate that fails on the one machine
 * that matters.
 */

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5177
const BASE = `http://localhost:${PORT}/`

/** Widths a phone actually is, plus a desktop one for the long word case. */
const VIEWPORTS = [
  { name: '360x640, a small android', width: 360, height: 640 },
  { name: '390x844, an iphone', width: 390, height: 844 },
  { name: '1280x800, a laptop', width: 1280, height: 800 },
]

const INPUTS = [
  { name: 'a sha256', text: 'the hash is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok' },
  { name: 'base64', text: 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IHN0cmluZyB0aGF0IGtlZXBzIGdvaW5n' },
  { name: 'a german compound', text: 'Donaudampfschifffahrtsgesellschaftskapitaensmuetze' },
  { name: 'a 4,000 character word', text: 'a'.repeat(4000) },
  { name: 'a long greek word', text: 'παρασκευοσκευαστικοσυμβουλευτικος'.repeat(6) },
  { name: 'an ordinary sentence', text: 'turn off the kitchen lights' },
]

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true,
})

const stop = () => {
  if (server.pid) {
    spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
  }
}
process.on('exit', stop)

let failed = 0

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })

  const browser = await chromium.launch()

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await page.goto(BASE, { waitUntil: 'load' })
    // The model has to arrive before there is a tag row or an axis to overflow.
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 120_000 })

    for (const input of INPUTS) {
      await page.fill('textarea', input.text)
      await page.waitForTimeout(700)

      const m = await page.evaluate(() => {
        const d = document.documentElement
        // Which element is the widest thing sticking out, so a failure names
        // the culprit instead of only the symptom.
        let worst = null
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.right > d.clientWidth + 1 && (!worst || r.right > worst.right)) {
            worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: el.className || '' }
          }
        }
        return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, worst }
      })

      const over = m.scrollWidth - m.clientWidth
      if (over > 1) {
        failed++
        console.error(`FAIL  ${vp.name}, ${input.name}: ${m.scrollWidth} wide inside ${m.clientWidth}, over by ${over}`)
        if (m.worst) {
          console.error(`        widest overhang: <${m.worst.tag} class="${m.worst.cls}"> reaching ${m.worst.right}`)
        }
      }
    }

    console.log(`  ok      ${vp.name}: ${INPUTS.length} inputs, no horizontal overflow`)
    await context.close()
  }

  await browser.close()
} finally {
  stop()
}

if (failed > 0) {
  console.error(`\n${failed} of ${VIEWPORTS.length * INPUTS.length} checks scroll sideways.`)
  process.exit(1)
}

console.log(
  `${VIEWPORTS.length} viewports by ${INPUTS.length} inputs, nothing overflows`,
)
