/**
 * Everything on this page can be reached without a mouse.
 *
 *   npm run check:keyboard
 *
 * Two audits found the same hole from opposite sides. The hostile stranger
 * tapped a token on a phone and nothing happened. The performance and access
 * pass tabbed to one and could not get there at all. Both were the same cause:
 * the axis tokens were plain list items with `pointerenter` and nothing else,
 * so on a device where `(hover: hover)` is false they were a picture, and from
 * a keyboard they did not exist.
 *
 * Between them that is half the interactivity on the page, failing silently, in
 * a way that reads as "this part is just decoration" rather than as a bug.
 *
 * The head grid had the opposite problem: twenty four separate tab stops for
 * one control, a `role="tablist"` pointing at no panel, arrow keys that did
 * nothing, and a focus ring the same colour as the selection, so a keyboard
 * visitor could not tell where they were from what they had chosen.
 *
 * Emulated touch is a real check here and not a proxy: the failure was
 * specifically that `matchMedia('(hover: hover)')` is false on a phone, so a
 * desktop run would have passed while the page stayed unusable.
 */

import { spawn } from 'node:child_process'
import { chromium, devices } from 'playwright'

const PORT = 5187
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

const ready = async (page) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.axis-token'), null, { timeout: 120_000 })
  await page.waitForTimeout(500)
}

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
  const browser = await chromium.launch()

  // ---- touch, on a device where hover does not exist ----------------------
  {
    const context = await browser.newContext({ ...devices['Pixel 5'] })
    const page = await context.newPage()
    await ready(page)

    const hoverless = await page.evaluate(() => !window.matchMedia('(hover: hover)').matches)
    if (!hoverless) {
      fail('the touch context still reports hover, so this check proves nothing')
    }

    await page.locator('.axis-token').nth(2).tap()
    await page.waitForTimeout(400)
    const pinned = await page.evaluate(
      () => document.querySelectorAll('.axis-token.is-pinned, .axis-token[aria-pressed="true"]').length,
    )
    if (pinned === 0) {
      fail('tapping a token on a phone highlights nothing', 'the chips are a picture on the device most people will open this on')
    } else {
      console.log('  ok      a tap pins a token on a device with no hover')
    }

    // Tapping it again lets go, or there is no way to undo a tap.
    await page.locator('.axis-token').nth(2).tap()
    await page.waitForTimeout(400)
    const stillPinned = await page.evaluate(() => document.querySelectorAll('.axis-token.is-pinned').length)
    if (stillPinned !== 0) {
      fail('tapping a pinned token again does not let go of it')
    } else {
      console.log('  ok      a second tap lets go')
    }

    await context.close()
  }

  // ---- keyboard -----------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    await ready(page)

    // The grid is one tab stop, not twenty four.
    const stops = await page.evaluate(
      () => document.querySelectorAll('.headcell:not([tabindex="-1"])').length,
    )
    if (stops !== 1) {
      fail(`the head grid is ${stops} tab stops`, 'one control should be one stop, with arrows to move inside it')
    } else {
      console.log('  ok      the head grid is one tab stop')
    }

    // Arrow keys move the selection.
    const before = await page.textContent('[data-field-caption]')
    await page.locator('.headcell[tabindex="0"]').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    const after = await page.textContent('[data-field-caption]')
    if (before === after) {
      fail('an arrow key on the head grid changed nothing', `caption stayed at ${JSON.stringify(before?.slice(0, 48))}`)
    } else {
      console.log('  ok      arrow keys move through the heads')
    }

    // A token can be reached and chosen from the keyboard alone.
    await page.locator('.axis-token').nth(1).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    let pinned = await page.evaluate(() => document.querySelectorAll('.axis-token.is-pinned').length)
    if (pinned !== 1) {
      fail('Enter on a focused token pinned nothing')
    } else {
      console.log('  ok      Enter pins the focused token')
    }

    // Arrows walk the sentence, Escape lets go.
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    const moved = await page.evaluate(
      () => [...document.querySelectorAll('.axis-token')].indexOf(document.activeElement),
    )
    if (moved !== 2) {
      fail(`ArrowRight left focus on token ${moved} rather than 2`)
    } else {
      console.log('  ok      arrow keys walk the sentence')
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    pinned = await page.evaluate(() => document.querySelectorAll('.axis-token.is-pinned').length)
    if (pinned !== 0) {
      fail('Escape did not let go of the pinned token')
    } else {
      console.log('  ok      Escape lets go')
    }

    // Focus must not look like selection, and the ring must be a colour
    // somebody chose.
    //
    // The first version of this compared the first token, which is the sentence
    // vector and is green for its own reasons, against the selection. It passed
    // while the rule named an undefined custom property and the outline was
    // falling back to currentColor: a gate that reads a computed value has to
    // check the value is the intended one, not merely that two things differ.
    const rings = await page.evaluate(() => {
      const t = document.querySelectorAll('.axis-token')[3]
      const declared = getComputedStyle(document.documentElement).getPropertyValue('--focus').trim()
      t.focus()
      const focusColour = getComputedStyle(t).outlineColor
      const textColour = getComputedStyle(t).color
      t.classList.add('is-focus')
      const selectedColour = getComputedStyle(t).backgroundColor
      t.classList.remove('is-focus')
      return { focusColour, selectedColour, textColour, declared }
    })

    if (!rings.declared) {
      fail('--focus is not defined, so the focus ring falls back to currentColor')
    } else if (rings.focusColour === rings.textColour) {
      fail(
        'the focus ring is currentColor, which means its rule names something undefined',
        `outline ${rings.focusColour} equals the text colour`,
      )
    } else if (rings.focusColour === rings.selectedColour) {
      fail('the focus ring is the same colour as the selection', 'a keyboard visitor cannot tell where they are from what they chose')
    } else {
      console.log(`  ok      focus ${rings.focusColour} is neither the text nor the selection`)
    }

    await context.close()
  }

  await browser.close()
} finally {
  stop()
}

if (failed > 0) {
  console.error(`\n${failed} things on this page need a mouse.`)
  process.exit(1)
}

console.log('keyboard and touch: every control is reachable without a mouse, and focus is not selection')
