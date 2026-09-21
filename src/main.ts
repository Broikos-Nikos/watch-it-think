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

/** The hue everything attention coloured uses, matching the page accent. */
const HEAT_HUE = 148

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

function render(p: Prediction) {
  const meta = router!.meta
  const top = topIntents(p, meta, 6)

  el.intent.textContent = top[0].intent
  el.confidence.textContent = `${(top[0].prob * 100).toFixed(1)}%`

  el.race.replaceChildren(
    ...top.map(({ intent, prob }) => {
      const li = document.createElement('li')
      li.style.setProperty('--p', String(prob))
      li.innerHTML =
        `<span class="bar"></span><span class="name">${intent}</span>` +
        `<span class="pct">${(prob * 100).toFixed(1)}%</span>`
      return li
    }),
  )

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

  drawAttention(p)
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
      b.title = `layer ${layer + 1}, head ${head + 1}`

      const c = document.createElement('canvas')
      c.width = 44
      c.height = 44
      const cx = c.getContext('2d')
      if (cx) {
        drawField(cx, fieldAt(cube, layer, head), cube.positions, { hue: HEAT_HUE })
      }
      b.append(c)
      b.addEventListener('click', () => {
        selected = { layer, head }
        drawAttention(p)
      })
      frag.append(b)
    }
  }
  el.heads.replaceChildren(frag)

  // The tokens along the axis, hoverable, so a row can be read as a sentence
  // rather than as a row index.
  el.axis.replaceChildren(
    ...Array.from({ length: cube.positions }, (_, pos) => {
      const li = document.createElement('li')
      li.textContent = labelAt(p, pos)
      li.className = pos === 0 ? 'axis-token axis-token--cls' : 'axis-token'
      li.addEventListener('pointerenter', () => {
        focusToken = pos
        drawSelected(p)
        markAxis()
      })
      li.addEventListener('pointerleave', () => {
        focusToken = null
        drawSelected(p)
        markAxis()
      })
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
