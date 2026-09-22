import './style.css'
import { Router, topIntents, wordTags, type Prediction } from './lib/router'
import { concentration, drawField, fieldAt, peak, type AttentionCube } from './lib/attention'

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

  el.tags.replaceChildren(
    ...wordTags(p, meta).map(({ word, tag }) => {
      const span = document.createElement('span')
      span.className = tag === 'O' ? 'word' : 'word word--slot'
      span.innerHTML = `${word}${tag === 'O' ? '' : `<small>${tag}</small>`}`
      return span
    }),
  )

  el.status.textContent =
    `${p.dims.positions} positions, ${p.dims.layers} layers, ${p.dims.heads} heads, ` +
    `${latency.report(p.ms)}`
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

function drawRace(top: { intent: string; prob: number }[]): void {
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
    if (isNew) row.classList.add('is-new')
    if (!row.isConnected) el.race.append(row)
  }

  // Then put each row back where it was and let it travel. Reading every new
  // position first, in its own pass, for the same reason as above.
  const after = new Map<string, number>()
  for (const [intent, row] of raceRows) after.set(intent, row.getBoundingClientRect().top)

  for (const [intent, row] of raceRows) {
    const was = before.get(intent)
    const now = after.get(intent)!
    if (was === undefined) {
      row.classList.remove('is-new')
      continue
    }
    const delta = was - now
    if (Math.abs(delta) < 1) continue
    row.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
      { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' },
    )
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

/** The token at a position, or the marker for the sentence vector. */
function labelAt(p: Prediction, pos: number): string {
  const w = p.tokens[pos]?.word ?? -1
  if (pos === 0) return 'cls'
  return w >= 0 ? p.words[w] : '..'
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
      c.width = 44
      c.height = 44
      const cx = c.getContext('2d')
      if (cx) {
        drawField(cx, fieldAt(cube, layer, head), cube.positions, { hue: HEAT_HUE })
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
    `is what the intent is read from.`

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
  const text = el.input.value.trim()
  if (text === '') {
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

async function boot() {
  wire()
  const started = performance.now()
  try {
    router = await Router.load()
  } catch (err) {
    el.status.textContent =
      `The model did not load: ${(err as Error).message}. Reloading is worth a try.`
    return
  }
  const loadMs = performance.now() - started
  const m = router.meta
  const q = m.quantisation

  el.standfirst.textContent =
    `It has ${m.parameters.toLocaleString('en-US')} of them, ${m.config.n_layers} layers ` +
    `and ${m.config.n_heads} attention heads, and it decides which of ` +
    `${m.intents.length} things you are asking for. Nothing you type leaves this page.`

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

  el.footer.textContent = q
    ? `${(q.bytesInt8 / 1e6).toFixed(2)} MB over the wire, ${loadMs.toFixed(0)} ms to load. ` +
      `Intent accuracy ${q.int8.intentAccuracy}% on ${q.rowsEvaluated.toLocaleString('en-US')} ` +
      `held out sentences, against ${q.fp32.intentAccuracy}% before quantisation.` +
      both +
      floor
    : `${loadMs.toFixed(0)} ms to load.`

  // The sample is an invitation, not an instruction. It is for the visitor who
  // waited out the download without touching anything; anyone who typed during
  // it gets their own sentence answered.
  if (!touched) el.input.value = SAMPLES[0]
  await think()
}

void boot()
