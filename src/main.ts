import './style.css'
import { Router, topIntents, wordTags, type Meta, type Prediction } from './lib/router'
import { hasWords, visibleLabel } from './lib/tokenizer'
import { concentration, cubePeak, drawField, fieldAt, peak, type AttentionCube } from './lib/attention'

/**
 * The number under the box, which used to be one unwarmed sample to a tenth of
 * a millisecond.
 *
 * The first inference of a fresh session is several times the steady state one,
 * and `boot()` ends by running one, so the first figure a visitor ever saw was
 * the worst one the page will ever produce, printed to a precision that implied
 * it was stable. Measured on the native runtime as a lower bound on the effect:
 * first run 0.98 ms against a 0.72 ms median.
 *
 * So: a median of the last five, and the first run labelled as what it is
 * rather than quietly averaged in.
 */
const latency = {
  samples: [] as number[],
  report(ms: number): string {
    this.samples.push(ms)
    if (this.samples.length > 5) this.samples.shift()
    if (this.samples.length === 1) return `${ms.toFixed(1)} ms, first run`
    const sorted = [...this.samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    return `${median.toFixed(1)} ms, median of ${this.samples.length}`
  },
}

const el = {
  input: document.querySelector<HTMLTextAreaElement>('#input')!,
  samples: document.querySelector<HTMLElement>('[data-samples]')!,
  status: document.querySelector<HTMLElement>('[data-status]')!,
  result: document.querySelector<HTMLElement>('[data-result]')!,
  intent: document.querySelector<HTMLElement>('[data-intent]')!,
  confidence: document.querySelector<HTMLElement>('[data-confidence]')!,
  race: document.querySelector<HTMLElement>('[data-race]')!,
  tags: document.querySelector<HTMLElement>('[data-tags]')!,
  standfirst: document.querySelector<HTMLElement>('[data-standfirst]')!,
  heads: document.querySelector<HTMLElement>('[data-heads]')!,
  field: document.querySelector<HTMLCanvasElement>('[data-field]')!,
  fieldCaption: document.querySelector<HTMLElement>('[data-field-caption]')!,
  attentionNote: document.querySelector<HTMLElement>('[data-attention-note]')!,
  axis: document.querySelector<HTMLElement>('[data-axis]')!,
  footer: document.querySelector<HTMLElement>('[data-footer]')!,
  announce: document.querySelector<HTMLElement>('[data-announce]')!,
}

/**
 * What a screen reader is told, and when.
 *
 * The only live region on this page used to be the telemetry line, which
 * changes on every keystroke, so the experience was "6 positions, 6 layers, 4
 * heads, 3.0 ms" repeated forever while the one number the page computes was
 * never spoken. The performance and access audit put it as: the one thing this
 * page exists to work out is the one thing a screen reader is never told.
 *
 * Announced once the typing has settled, not per keystroke. A live region that
 * fires on every input is one a screen reader user turns off, which is the same
 * outcome as not having one.
 */
const announce = {
  timer: 0,
  last: '',
  say(text: string): void {
    if (text === this.last) return
    this.last = text
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      el.announce.textContent = text
    }, 700)
  },
}

const SAMPLES = [
  'turn off the kitchen lights',
  'set an alarm for seven thirty tomorrow',
  'what is the weather in Thessaloniki tomorrow',
  'σβήσε τα φώτα στην κουζίνα',
  'βάλε ξυπνητήρι στις εφτά και μισή',
  'πάρε τηλέφωνο τη Μαρία',
]

let router: Router | null = null
let queued = 0

/**
 * The hue the attention field is drawn in, and deliberately not the page accent.
 *
 * It used to be 148, the same green as the brand, so the hottest cell of a
 * 98,304 cell heat map was louder than the answer. An accent that points at
 * 98,304 things points at nothing.
 *
 * 235 is cool, reads as a measurement rather than an opinion, and sits 170
 * degrees from flame, so the scale and the argument can never be confused. It
 * matches --scale-hue in style.css; the two are set in two places because one
 * is CSS and the other is canvas, and check:palette holds them together.
 */
const HEAT_HUE = 235

/**
 * Which of the twenty four fields is large, and which token is highlighted.
 *
 * The selection survives a new sentence on purpose. Finding the head that
 * watches the verb and then typing three sentences through it is the thing this
 * page is for, and resetting to layer zero head zero every keystroke would make
 * that impossible.
 */
let selected = { layer: 0, head: 0 }
let focusToken: number | null = null

/**
 * A token the visitor chose, as against one the pointer happens to be over.
 *
 * Hover was the only way to highlight a token, so on a phone there was no way
 * at all: `matchMedia('(hover: hover)')` is false there and the chips were
 * plain list items with no click handler. A pin survives the pointer moving
 * away, which is what makes the feature usable by tapping and by tabbing.
 */
let pinnedToken: number | null = null

/** Which way each arrow key moves inside the six by four grid of heads. */
const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
}

function render(p: Prediction) {
  const meta = router!.meta
  const top = topIntents(p, meta, 6)

  el.intent.textContent = top[0].intent
  el.confidence.textContent = `${(top[0].prob * 100).toFixed(1)}%`

  drawRace(top)

  /*
   * textContent and a real element, not innerHTML with a string in it.
   *
   * `word` comes from the tokenizer running over whatever the visitor typed, so
   * this was user input reaching innerHTML. Nothing exploitable was found, and
   * the reason is an accident of the word regex rather than a defence: a single
   * non word code point becomes its own token, so an injected tag arrives split
   * across several chips in several spans. That is a property of a regex that
   * exists for a different purpose, one edit away from not holding, and this
   * costs two lines.
   *
   * `visibleLabel` handles the other half: a zero width space is its own token
   * and rendered as an empty chip, and an empty chip can still be handed a slot
   * tag. A tag attached to nothing visible is worse than no chip at all.
   */
  el.tags.replaceChildren(
    ...wordTags(p, meta).map(({ word, tag }) => {
      const span = document.createElement('span')
      span.className = tag === 'O' ? 'word' : 'word word--slot'
      span.textContent = visibleLabel(word)
      if (tag !== 'O') {
        const small = document.createElement('small')
        small.textContent = tag
        span.append(small)
      }
      return span
    }),
  )

  /*
   * Plural where it is plural. The page printed "1 positions" during the hostile
   * stranger pass, on the line where it asks to be taken seriously about
   * measurement.
   */
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
  el.status.textContent =
    `${plural(p.dims.positions, 'position')}, ${plural(p.dims.layers, 'layer')}, ` +
    `${plural(p.dims.heads, 'head')}, ${latency.report(p.ms)}`
  el.result.hidden = false

  // The answer, the confidence, and the arguments, in a sentence rather than as
  // a layout. The runner up is included because a router that is 95 percent
  // sure and one that is 30 percent sure are different answers, and the visual
  // version shows that with a bar.
  const slots = wordTags(p, meta)
    .filter((t) => t.tag !== 'O')
    .map((t) => `${t.word} as ${t.tag.replace(/^[BI]-/, '')}`)
  // "Next likeliest timer.set at 0 percent" is what rounding a runner up of
  // 0.4 percent to no decimals produces, and it reads as though the page has
  // lost the number. Below one percent there is no contest, and saying so is
  // both shorter and truer.
  const runnerUp =
    top[1].prob >= 0.01
      ? `Next likeliest ${top[1].intent} at ${(top[1].prob * 100).toFixed(0)} percent.`
      : 'Nothing else close.'

  announce.say(
    `${top[0].intent}, ${(top[0].prob * 100).toFixed(0)} percent confident. ` +
      (slots.length ? `${slots.join(', ')}. ` : 'No arguments found. ') +
      runnerUp,
  )

  drawAttention(p)
}

/* ------------------------------------------------------------------- race */

/**
 * The race, rendered so that it moves.
 *
 * `.race .bar` has carried `transition: width 260ms` since the day it was
 * written and it has never once fired. The render called `replaceChildren`, so
 * every row was a brand new element every time, and a new element starts at its
 * final width: there is nothing to transition from. The one declared animation
 * on a page called "watch it think" was dead on arrival, and the design audit
 * found it by asking the browser for its running animations and being told
 * there were none.
 *
 * The data was never the problem. Typing one sentence changes the leader eight
 * times, several times a second, and all of it was thrown away and redrawn as a
 * blink.
 *
 * So rows are keyed by intent and survive a render. A row that stays gets its
 * width and its number updated, and the browser does the travelling. A row that
 * moves is animated from where it was to where it now is, measured rather than
 * guessed. A row that arrives fades up from the edge it came in at.
 */
const raceRows = new Map<string, HTMLLIElement>()

/**
 * One animation per row at a time, and none at all when motion is refused.
 *
 * Two things the second deep review found. A row that moves twice before the
 * first move finishes ended up with four transform animations running at once,
 * the newest replacing the others mid flight. And `prefers-reduced-motion` was
 * honoured by the stylesheet and ignored here, so the gate that reports "it all
 * stops when asked" was reading the one transition that had stopped while four
 * script driven animations carried on.
 *
 * Cancelling first is what makes a travel a travel rather than a pile.
 */
const stillMoving = new WeakMap<Element, Animation>()

function animate(row: Element, frames: Keyframe[]): void {
  stillMoving.get(row)?.cancel()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const a = row.animate(frames, { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' })
  stillMoving.set(row, a)
}

function drawRace(top: { intent: string; prob: number }[]): void {
  const arriving: HTMLLIElement[] = []
  // Where everything is now, before the DOM is touched. This is the F of FLIP
  // and it has to be read in one pass, or the first write forces a layout and
  // every later read is of the new position.
  const before = new Map<string, number>()
  for (const [intent, row] of raceRows) before.set(intent, row.getBoundingClientRect().top)

  const wanted = new Set(top.map((t) => t.intent))
  for (const [intent, row] of raceRows) {
    if (!wanted.has(intent)) {
      row.remove()
      raceRows.delete(intent)
    }
  }

  for (const [rank, { intent, prob }] of top.entries()) {
    let row = raceRows.get(intent)
    const isNew = !row
    if (!row) {
      row = document.createElement('li')
      // textContent per part, not innerHTML: an intent name is model output and
      // this page builds its tag row from the visitor's own words one section
      // down. Two audits have now checked that nothing can escape through
      // there, and the cheapest way to keep that true is to stop parsing.
      const bar = document.createElement('span')
      bar.className = 'bar'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = intent
      const pct = document.createElement('span')
      pct.className = 'pct'
      row.append(bar, name, pct)
      raceRows.set(intent, row)
    }

    row.style.setProperty('--p', String(prob))
    row.querySelector('.pct')!.textContent = `${(prob * 100).toFixed(1)}%`
    row.classList.toggle('is-leader', rank === 0)
    row.style.order = String(rank)
    if (!row.isConnected) el.race.append(row)
    if (isNew) arriving.push(row)
  }

  // Then put each row back where it was and let it travel. Reading every new
  // position first, in its own pass, for the same reason as above.
  const after = new Map<string, number>()
  for (const [intent, row] of raceRows) after.set(intent, row.getBoundingClientRect().top)

  for (const row of arriving) {
    // Entry is an animation, not a class.
    //
    // It used to add `is-new` here and remove it in the loop below, both inside
    // one task, so the browser never saw the element with the class on it and
    // the keyframes never ran. That is the same defect as the transition this
    // render was written to fix: a style applied and removed before a frame is
    // a style that did not happen. The second deep review found it in the code
    // that fixed the first one.
    animate(row, [
      { opacity: 0, transform: 'translateX(-6px)' },
      { opacity: 1, transform: 'translateX(0)' },
    ])
  }

  for (const [intent, row] of raceRows) {
    const was = before.get(intent)
    const now = after.get(intent)!
    if (was === undefined) continue
    const delta = was - now
    if (Math.abs(delta) < 1) continue
    animate(row, [
      { transform: `translateY(${delta}px)` },
      { transform: 'translateY(0)' },
    ])
  }
}

/* -------------------------------------------------------------- attention */

function cubeOf(p: Prediction): AttentionCube {
  return {
    layers: p.dims.layers,
    heads: p.dims.heads,
    positions: p.dims.positions,
    raw: p.attention,
  }
}

/**
 * The token at a position, or the marker for the sentence vector.
 *
 * The first piece of a word shows the word as it was typed, so the axis lines
 * up with the chips above it and keeps the original case. **Every other piece
 * shows itself**, which it did not: continuations all read `..`, so
 * `the hash is 9f86...a08 ok` gave sixty four chips of which fifty nine said
 * nothing, and the axis is the only label the 520 pixel field has. The grid
 * became unreadable exactly when it was fullest.
 *
 * Anything with no ink in it is shown as its code point, because a chip that
 * renders as an empty sliver can still be handed a slot tag, and a tag attached
 * to nothing visible is worse than no chip at all.
 */
function labelAt(p: Prediction, pos: number): string {
  if (pos === 0) return 'cls'
  const w = p.tokens[pos]?.word ?? -1
  if (w >= 0) return visibleLabel(p.words[w])
  const id = p.tokens[pos]?.id
  return id === undefined ? '..' : visibleLabel(router?.tokenizer.tokenText(id) ?? '..')
}

function drawSelected(p: Prediction) {
  const cube = cubeOf(p)
  const field = fieldAt(cube, selected.layer, selected.head)
  const ctx = el.field.getContext('2d')
  if (!ctx) return

  // The backing store follows the token count so each cell gets whole pixels.
  // The element's size on the page does not: see the note in style.css. One is
  // resolution, the other is layout, and tying them together is what made the
  // page jump while the picture sat still.
  const size = Math.min(520, Math.max(240, cube.positions * 26))
  if (el.field.width !== size) {
    el.field.width = size
    el.field.height = size
  }

  drawField(ctx, field, cube.positions, {
    focus: focusToken,
    hue: HEAT_HUE,
    grid: true,
  })

  const conc = concentration(field, cube.positions)

  // Twenty five canvases carry the entire argument of this page and no text.
  // This is the large one described in words: which field, how concentrated,
  // and where its strongest link goes, which is the thing a sighted reader
  // gets from looking at it.
  const strongest = peak(field)
  el.field.setAttribute(
    'aria-label',
    `Attention field, layer ${selected.layer + 1} of ${cube.layers}, head ` +
      `${selected.head + 1} of ${cube.heads}. Concentration ${(conc * 100).toFixed(0)} percent, ` +
      `strongest single link ${(strongest * 100).toFixed(0)} percent. ` +
      `A concentrated field means most tokens looked at the same few places.`,
  )

  el.fieldCaption.textContent =
    `layer ${selected.layer + 1} of ${cube.layers}, head ${selected.head + 1} of ` +
    `${cube.heads}. Rows are the token doing the looking, columns are what it looked at. ` +
    `Concentration ${(conc * 100).toFixed(0)} percent, strongest single link ` +
    `${(peak(field) * 100).toFixed(0)} percent.`
}

function drawAttention(p: Prediction) {
  const cube = cubeOf(p)

  /*
   * One scale for the whole grid, computed once.
   *
   * Every thumbnail used to divide by its own peak. Measured on the shipped
   * graph for one sentence, the twenty four peaks ran from 0.267 to 0.999, and
   * all twenty four rendered their hottest cell at full chroma, so the head that
   * had learned almost nothing looked exactly as decisive as the head that had
   * learned the most. The measurement audit put it as a chart whose panels have
   * different y axes with no labels saying so.
   */
  const gridMax = cubePeak(cube)

  // Twenty four thumbnails, each a real field rather than an icon.
  const frag = document.createDocumentFragment()
  for (let layer = 0; layer < cube.layers; layer++) {
    for (let head = 0; head < cube.heads; head++) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'headcell'
      b.role = 'tab'
      const on = layer === selected.layer && head === selected.head
      b.setAttribute('aria-selected', String(on))
      b.classList.toggle('is-on', on)
      // No title attribute: it was the only place these coordinates lived, and
      // a tooltip is not a label. They are on the face of the cell now.

      const c = document.createElement('canvas')
      // 128, not 44.
      //
      // drawField writes one pixel per cell and scales that up into the canvas,
      // so a 44 pixel backing store is a DOWNSCALE for any sentence past 44
      // tokens, with smoothing off, which drops cells rather than blending
      // them. At 61 tokens it was dropping 48 percent of the field and ten of
      // the twenty four thumbnails no longer contained their own strongest
      // link: the grid whose entire purpose is picking the interesting head was
      // showing a different picture from the one it was labelled with.
      //
      // 128 gives every cell at least two whole pixels at the 64 token maximum.
      // The CSS then scales 128 down to the ~58 the grid shows, smoothly, which
      // averages neighbours instead of discarding them.
      c.width = 128
      c.height = 128
      const cx = c.getContext('2d')
      if (cx) {
        // One scale across all twenty four, so a dim head looks dim. The large
        // canvas above keeps its own, because it is not being compared to
        // anything beside it and its caption prints the strongest link outright.
        drawField(cx, fieldAt(cube, layer, head), cube.positions, { hue: HEAT_HUE, max: gridMax })
      }
      // What this head is and how sharp it is, on the face of it.
      //
      // Twenty four unlabelled squares meant "find the head that watches the
      // verb" was an instruction to open twenty four things one at a time. The
      // layer and head are the coordinates a reader needs to say what they
      // found, and concentration is the number that tells them where to look
      // first: a head that sends every token to the same place scores near 100,
      // one that spreads attention evenly scores near 0.
      const conc = concentration(fieldAt(cube, layer, head), cube.positions)
      const tag = document.createElement('span')
      tag.className = 'headcell-tag'
      tag.textContent = `L${layer + 1}H${head + 1}`
      const score = document.createElement('span')
      score.className = 'headcell-score'
      score.textContent = `${(conc * 100).toFixed(0)}`
      // The sharpest heads are the interesting ones, so they are the ones that
      // read as bright rather than every cell shouting equally.
      b.style.setProperty('--conc', conc.toFixed(3))

      b.append(c, tag, score)

      // A roving tabindex: one stop for the whole grid, arrows to move within
      // it. Twenty four separate tab stops for one control is what the access
      // audit called a tablist that controls nothing, and tabbing through two
      // dozen unlabelled thumbnails to reach the footer is nobody's idea of
      // keyboard support.
      b.tabIndex = on ? 0 : -1
      b.setAttribute(
        'aria-label',
        `Layer ${layer + 1}, head ${head + 1}, concentration ${(conc * 100).toFixed(0)} percent`,
      )

      b.addEventListener('click', () => {
        selected = { layer, head }
        drawAttention(p)
      })
      b.addEventListener('keydown', (e) => {
        const step = ARROWS[e.key]
        if (!step) return
        e.preventDefault()
        const [dl, dh] = step
        const next = {
          layer: (layer + dl + cube.layers) % cube.layers,
          head: (head + dh + cube.heads) % cube.heads,
        }
        selected = next
        drawAttention(p)
        // The grid was just rebuilt, so the element to focus is the new one.
        el.heads.querySelector<HTMLElement>('.headcell[tabindex="0"]')?.focus()
      })
      frag.append(b)
    }
  }
  el.heads.replaceChildren(frag)

  // The tokens along the axis. Hover was the only way to use these, which meant
  // they did nothing at all on a phone and nothing at all from a keyboard: two
  // audits found that from opposite directions, and between them it is half the
  // interactivity on the page.
  //
  // Each is a real button now. Hover still previews, because that is the nicest
  // way to use it with a mouse, but a click pins and a second click unpins, and
  // the arrow keys walk the sentence.
  el.axis.replaceChildren(
    ...Array.from({ length: cube.positions }, (_, pos) => {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = labelAt(p, pos)
      b.className = pos === 0 ? 'axis-token axis-token--cls' : 'axis-token'
      b.setAttribute('aria-pressed', String(focusToken === pos))
      b.setAttribute(
        'aria-label',
        pos === 0
          ? 'The sentence vector, position 1'
          : `${labelAt(p, pos)}, position ${pos + 1} of ${cube.positions}`,
      )

      const preview = (on: boolean) => {
        // A pinned token is not disturbed by the pointer wandering over its
        // neighbours, which is the difference between a preview and a choice.
        if (pinnedToken !== null) return
        focusToken = on ? pos : null
        drawSelected(p)
        markAxis()
      }
      b.addEventListener('pointerenter', () => preview(true))
      b.addEventListener('pointerleave', () => preview(false))

      b.addEventListener('click', () => {
        pinnedToken = pinnedToken === pos ? null : pos
        focusToken = pinnedToken
        drawSelected(p)
        markAxis()
      })
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && pinnedToken !== null) {
          e.preventDefault()
          pinnedToken = null
          focusToken = null
          drawSelected(p)
          markAxis()
          return
        }
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!d) return
        e.preventDefault()
        const next = (pos + d + cube.positions) % cube.positions
        el.axis.querySelectorAll<HTMLElement>('.axis-token')[next]?.focus()
      })

      li.append(b)
      return li
    }),
  )

  el.attentionNote.textContent =
    `${cube.layers * cube.heads} fields for this sentence, one per layer and head. ` +
    `Every row sums to one, so a bright row is a token that made up its mind and a ` +
    `flat row is one that did not. The first position is the sentence vector, which ` +
    `is what the intent is read from. All twenty four share one scale, so a faint ` +
    `field really is a faint one, and the colour is the square root of the value ` +
    `so the weak ones stay readable. The exact figure is on every label.`

  drawSelected(p)
  markAxis()
}

function markAxis() {
  el.axis.querySelectorAll('.axis-token').forEach((n, i) => {
    n.classList.toggle('is-focus', i === focusToken)
    n.classList.toggle('is-pinned', i === pinnedToken)
    n.setAttribute('aria-pressed', String(i === pinnedToken))
  })
}

async function think() {
  if (!router) return
  /*
   * Untrimmed, deliberately. `String.prototype.trim` strips the byte order mark
   * that this tokenizer was written to preserve, so the page was correcting an
   * input the model was trained to see, and it leaves the characters Python
   * calls whitespace and JavaScript does not, so an input of one of those got a
   * full confident answer to nothing. `hasWords` asks the tokenizer instead,
   * which is whose question it is.
   */
  const text = el.input.value
  if (!hasWords(text)) {
    el.result.hidden = true
    el.status.textContent = 'type something'
    return
  }
  try {
    render(await router.run(text))
  } catch (err) {
    el.status.textContent = `that did not run: ${(err as Error).message}`
  }
}

/**
 * Whether the visitor has done anything to the box.
 *
 * A cold visit is 19.8 MB and takes about a minute on a phone connection, so
 * typing while you wait is the normal thing to do, and boot() used to end by
 * overwriting whatever was there with the first sample and answering that
 * instead. Not ignoring what the visitor wrote: replacing it, and showing a
 * confident answer for a sentence they had not written.
 *
 * A test for an empty box would not be enough. Clicking a sample chip fills the
 * box too, and a visitor who deliberately clears it has still acted. The
 * question is whether they have touched the page at all, so that is what is
 * recorded.
 */
let touched = false

function wire() {
  el.input.addEventListener('input', () => {
    touched = true
    cancelAnimationFrame(queued)
    queued = requestAnimationFrame(() => void think())
  })

  for (const s of SAMPLES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = s
    b.addEventListener('click', () => {
      touched = true
      el.input.value = s
      void think()
    })
    el.samples.append(b)
  }
}

/**
 * What the page can say about itself from `meta.json` alone.
 *
 * Called as soon as the 10 KB metadata lands, which is about a hundred
 * milliseconds, rather than after the 5.28 MB graph. Two things follow. Every
 * visitor reads the paragraph under the headline while the model downloads
 * instead of looking at a blank, and a visitor whose download fails still gets
 * a page that describes itself, which is the finding the hostile stranger pass
 * made twice, two days apart.
 */
/**
 * A duration a reader can feel, rather than a number.
 *
 * The footer printed `loadMs.toFixed(0)` with "ms" after it, so the minute long
 * download the hostile stranger pass measured was reported as **"61452 ms to
 * load"**. On the connection the performance pass measured against the live
 * host it would say "41203 ms". Milliseconds are the right unit for an
 * inference and the wrong one for a download.
 */
function howLong(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  const s = ms / 1000
  return s < 10 ? `${s.toFixed(1)} seconds` : `${s.toFixed(0)} seconds`
}

function describe(m: Meta) {
  el.standfirst.textContent =
    `${m.parameters.toLocaleString('en-US')} parameters, trained from nothing, ` +
    `${m.config.n_layers} layers and ${m.config.n_heads} attention heads. ` +
    `It decides which of ${m.intents.length} things you are asking for, on your ` +
    `machine, and nothing you type leaves this page.`
}

/**
 * The page when the model is not coming.
 *
 * The samples and the box stayed fully interactive and completely inert: every
 * chip still looked like a button and answered nothing. Saying so is better
 * than leaving a visitor to discover it by clicking.
 */
function inert(why: string) {
  el.status.textContent = why
  el.input.disabled = true
  el.input.placeholder = 'the model did not load'
  for (const b of el.samples.querySelectorAll('button')) b.disabled = true
}

async function boot() {
  wire()

  // The description first, from 10 KB, so the page is not blank for the length
  // of a 5.28 MB download and is not blank for ever if that download fails.
  // Deliberately not fatal on its own: if this is the request that is broken,
  // the graph will fail next and say so properly.
  try {
    describe(await Router.loadMeta())
  } catch {
    // The load below reports it.
  }

  const started = performance.now()
  try {
    /*
     * Say how far along the download is, in megabytes, while it happens.
     *
     * Measured on the live host the morning this published: 41.2 seconds to the
     * first answer at 1.6 Mbit with 150 ms of latency, and for all of it the
     * page said "loading the model" and nothing else. That string ships in
     * index.html so it is there from first paint, which is better than nothing
     * and is why the finding was corrected down from "no sign anything is
     * happening". It is still three words that never move, and a visitor cannot
     * tell a slow download from a stalled one by looking at a word.
     *
     * Throttled to four updates a second. The reader fires per chunk, which is
     * hundreds of times a second on a fast connection, and rewriting textContent
     * that often is work the page is doing instead of downloading. The
     * arithmetic is in bytes and only the display is throttled, so the last
     * update is always exact.
     */
    let painted = 0
    router = await Router.load('./model/', (received, total) => {
      const now = performance.now()
      const done = received >= total
      if (!done && now - painted < 250) return
      painted = now
      const mb = (n: number) => (n / 1e6).toFixed(1)
      el.status.textContent = done
        ? `${mb(total)} MB of model downloaded, starting it`
        : `downloading the model, ${mb(received)} of ${mb(total)} MB`
      el.status.setAttribute('role', 'progressbar')
      el.status.setAttribute('aria-valuemin', '0')
      el.status.setAttribute('aria-valuemax', String(total))
      el.status.setAttribute('aria-valuenow', String(received))
      // The bar is the background of the line rather than a second element, so
      // nothing moves when it appears and nothing is left behind when it goes.
      el.status.style.setProperty('--progress', `${((received / total) * 100).toFixed(1)}%`)
    })
  } catch (err) {
    inert(`The model did not load: ${(err as Error).message}. Reloading is worth a try.`)
    return
  } finally {
    /*
     * The line stops being a progress bar whatever happened, and `finally` is
     * the whole point of this block.
     *
     * These four lines used to sit after the `await` inside the `try`, so a
     * throw skipped them. Going offline mid download then wrote "The model did
     * not load" into an element still carrying `role="progressbar"` and
     * `aria-valuenow="5284077"`, and a screen reader was told a completed
     * progress bar while the text inside it said the opposite. The hostile
     * stranger pass found it by pulling the network out three hours after I
     * wrote it.
     *
     * `aria-valuemax` and `aria-valuemin` are here too, and they were missing
     * from the original cleanup on the success path as well: a line that is no
     * longer a progress bar was still carrying two of a progress bar's values.
     */
    for (const a of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow']) {
      el.status.removeAttribute(a)
    }
    el.status.style.removeProperty('--progress')
  }
  const loadMs = performance.now() - started
  const m = router.meta
  const q = m.quantisation

  // The numbers stay, under the claim rather than instead of it. Written from
  // meta.json alone, so it is already on the page by the time the graph starts
  // arriving. See describe().
  describe(m)

  // The sentence about the split used to be a string literal, printed whatever
  // file had been evaluated, including the training set. The quantiser now
  // records which file it read and whether that file is the adversarial split,
  // so the claim appears only when it is true of the run that produced these
  // numbers.
  const floor =
    q?.testSet?.split === 'adversarial'
      ? ' That set is the adversarial one, so it is a floor rather than a headline.'
      : ''

  // Both accuracy figures or neither. The argmax number is what this page
  // draws, because the page draws what the model predicts. The abstaining
  // number is what the same weights score when they are allowed to decline,
  // which is what a reader would meet if they used the assistant, and it is
  // nearly two points lower. Quoting the first alone is a different claim, and
  // this file quoted it alone for twenty eight ticks under a devlog entry
  // asserting that it could not.
  const a = q?.int8.withAbstain
  const both = a
    ? ` That is what it scores when it must answer; allowed to decline below ` +
      `${a.threshold} confidence it declines ${a.abstained.toLocaleString('en-US')} ` +
      `of them and scores ${a.intentAccuracy}%.`
    : ''

  /*
   * What this visit cost this visitor, measured, not recorded.
   *
   * This line used to print `q.bytesInt8`, which is meta.json's record of the
   * int8 graph **on disk**, under the words "over the wire". Measured against
   * the live host on the day it published: that file arrives as 4.33 MB, gzipped
   * by GitHub Pages, and a first visit is 8.23 MB across ten requests. So the
   * sentence overstated the file by 22 percent and understated the visit by 35.
   *
   * The README's version of the same claim was right the whole time, because
   * check:weight holds it against a measurement. The page's version was never
   * gated. The measurement existed and the gate existed and neither was pointed
   * here.
   *
   * `encodedBodySize` is what came down the wire after compression, per
   * resource, and everything this page loads is same origin so none of them are
   * zeroed. Adding it up makes the number true on every connection for the same
   * reason `loadMs` beside it is true on every connection: nothing is stored,
   * so nothing can go stale.
   */
  const wireBytes =
    performance.getEntriesByType('resource').reduce((sum, r) => sum + ((r as PerformanceResourceTiming).encodedBodySize || 0), 0) +
    ((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.encodedBodySize ?? 0)

  el.footer.textContent = q
    ? `${(wireBytes / 1e6).toFixed(2)} MB over the wire, ${howLong(loadMs)} to load. ` +
      `Intent accuracy ${q.int8.intentAccuracy}% on ${q.rowsEvaluated.toLocaleString('en-US')} ` +
      `held out sentences, against ${q.fp32.intentAccuracy}% before quantisation.` +
      both +
      floor
    : `${howLong(loadMs)} to load.`

  // The sample is an invitation, not an instruction. It is for the visitor who
  // waited out the download without touching anything; anyone who typed during
  // it gets their own sentence answered.
  //
  // Two conditions, and the second is the one that matters. `touched` is set by
  // listeners this file attaches, and it cannot be set before this file runs:
  // the box is in index.html and is typeable from first paint, so on a slow
  // connection there was a 1,356 ms window in which everything typed was
  // silently replaced. Asking whether the box already has something in it needs
  // no listener and therefore has no window.
  //
  // I also wrote an inline script in index.html to set a flag from first paint,
  // and then deleted it: the gate proved either one alone closes the case, and
  // shipping both would have meant shipping a non module script tag and a
  // window global for a case this line already covers. The one thing it caught
  // that this does not is somebody typing and then clearing the box before the
  // page loads, and an empty box should get the sample anyway.
  if (!touched && !el.input.value) el.input.value = SAMPLES[0]
  await think()
}

void boot()
