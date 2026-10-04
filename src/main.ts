import './style.css'
import { makeLatency } from './lib/latency'
import { Router, topIntents, wordTags, type Meta, type Prediction } from './lib/router'
import { hasWords, normalize, visibleLabel, wordTokenize } from './lib/tokenizer'
import {
  concentration,
  cubePeak,
  drawField,
  fieldAt,
  paletteFrom,
  peakAt,
  type AttentionCube,
  type Palette,
} from './lib/attention'

/*
 * The number under the box. The rule, and the two ways it was wrong, are in
 * src/lib/latency.ts: it lives there because a median that could not be tested
 * without a browser was a median nobody tested.
 */
const latency = makeLatency()

const el = {
  main: document.querySelector<HTMLElement>('main')!,
  input: document.querySelector<HTMLTextAreaElement>('#input')!,
  samples: document.querySelector<HTMLElement>('[data-samples]')!,
  status: document.querySelector<HTMLElement>('[data-status]')!,
  capNote: document.querySelector<HTMLElement>('[data-cap-note]')!,
  unknownNote: document.querySelector<HTMLElement>('[data-unknown-note]')!,
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
  fieldRows: document.querySelector<HTMLElement>('[data-field-rows]')!,
  field_: document.querySelector<HTMLElement>('.field')!,
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

/**
 * The six sentences offered to a visitor, each with the language it is in.
 *
 * WP-F11. Three of them are Greek and all six sat inside `lang="en"`, so a
 * screen reader read "σβήσε τα φώτα στην κουζίνα" with an English voice: the
 * one sentence on this page a Greek speaker is most likely to press, and the
 * one it is least able to say. The language is data about the sentence, so it
 * is written beside it rather than sniffed from the letters at render time: a
 * regex over code points would also have to decide what to do with "Θα είμαι
 * εκεί σε δέκα λεπτά", which is Greek, and with "Thessaloniki", which is not.
 */
const SAMPLES: { text: string; lang: 'en' | 'el' }[] = [
  { text: 'turn off the kitchen lights', lang: 'en' },
  { text: 'set an alarm for seven thirty tomorrow', lang: 'en' },
  { text: 'what is the weather in Thessaloniki tomorrow', lang: 'en' },
  { text: 'σβήσε τα φώτα στην κουζίνα', lang: 'el' },
  { text: 'βάλε ξυπνητήρι στις εφτά και μισή', lang: 'el' },
  { text: 'πάρε τηλέφωνο τη Μαρία', lang: 'el' },
]

let router: Router | null = null
let queued = 0

/**
 * A sentence typed or clicked before the model arrived, and where the download
 * had got to when that happened.
 *
 * WH-F4. `think()` began `if (!router) return`, and every control on this page
 * routes through it: six sample chips and the box. Measured at tick 166 at
 * 8 Mbit, clicking a chip during the download put its sentence in the box and
 * answered nothing, and the page said the same three words it had been saying
 * since first paint. The sentence was not lost, `boot()` ends by answering
 * whatever is in the box, so the only thing missing was the page admitting it.
 */
let waitingFor: string | null = null
let downloadAt: { received: number; total: number } | null = null

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
 * The colours to draw the fields in when the page is not choosing them.
 *
 * WP-F9. Forced colours repaints the page and leaves the canvas alone, because
 * a canvas is pixels. Measured at tick 175 with forced colours active: the
 * background went from rgb(8, 6, 4) to white while the field stayed exactly as
 * drawn, so the weakest cells, which are black, became the highest contrast
 * thing on the screen at 21:1, and the strongest cell fell to 1.9:1 against the
 * new background. Every reading of the picture inverts: faint is loud.
 *
 * So when the system takes the palette over, the ramp is built from the two
 * colours it gives us, `Canvas` and `CanvasText`, read from the page rather
 * than guessed, with `Highlight` for the focused row. A weak cell is then the
 * background it sits on and a strong one is the text colour, which is the
 * ordering the picture means, in whatever two colours the reader chose.
 */
const forced = window.matchMedia('(forced-colors: active)')
let forcedPalette: Palette | null = null

function systemPalette(): Palette | undefined {
  if (!forced.matches) return undefined
  if (forcedPalette) return forcedPalette

  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;background:Canvas;color:CanvasText'
  document.body.append(probe)
  const seen = getComputedStyle(probe)
  const rgb = (value: string): [number, number, number] => {
    const n = value.match(/\d+(\.\d+)?/g)?.map(Number) ?? []
    return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0]
  }
  const bg = rgb(seen.backgroundColor)
  const fg = rgb(seen.color)
  probe.remove()

  forcedPalette = paletteFrom(bg, fg, 'Highlight')
  return forcedPalette
}

/**
 * The last answer, kept so the picture can be redrawn when nothing about the
 * sentence changed and everything about the colours did.
 */
let lastPrediction: Prediction | null = null

/* Turning high contrast on is not a reload, so the fields have to be told. The
   cached palette goes with it: the system's two colours are what changed. */
forced.addEventListener('change', () => {
  forcedPalette = null
  if (lastPrediction) drawAttention(lastPrediction)
})

/*
 * Plural where it is plural. The page printed "1 positions" during the hostile
 * stranger pass, on the line where it asks to be taken seriously about
 * measurement. At module scope since tick 168, because the note about unknown
 * tokens needs the same rule and two copies of a rule is how the two drift.
 */
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

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
  const tagged = wordTags(p, meta)
  el.tags.replaceChildren(
    ...tagged.map(({ word, tag }) => {
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
   * WDR-F7. `wordTags` builds its array by word index and then filters out the
   * holes, so a word past the 64 token context leaves no gap: the row just ends
   * early. Measured on the live page at tick 160 with a 67 word sentence: 58
   * tagged words, the row ending at "alarm" while the sentence ended at
   * "morning", and the status line saying "64 positions" as though that were the
   * whole thing.
   *
   * On a page whose argument is showing the working, a row that quietly stops is
   * the one kind of omission it cannot afford. `p.words` is every word the
   * tokenizer was given, so the difference is the count, and the sentence names
   * the words rather than the tokens because the reader typed words.
   */
  const dropped = p.words.length - tagged.length
  el.capNote.hidden = dropped <= 0
  if (dropped > 0) {
    el.capNote.textContent =
      `The last ${dropped} ${dropped === 1 ? 'word' : 'words'} did not fit the ` +
      `${meta.maxLen} token context, so ${dropped === 1 ? 'it is' : 'they are'} not ` +
      `in the row above and the model never saw ${dropped === 1 ? 'it' : 'them'}.`
  }

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
      /*
       * The bar lives in a track of its own, which is the name's column.
       *
       * WD-F5. It used to be absolutely positioned against the whole row, so
       * its width was a percentage of a box that included the percentage
       * label, and a confident answer drew the bar across its own number: at
       * 95.8 percent, 15 of the label's 41 pixels sat on saturated orange and
       * it read as "95." then "8%". Naming the grid column on an absolutely
       * positioned child is not enough in practice, so the track is an element
       * and the bar is positioned against that.
       */
      const track = document.createElement('span')
      track.className = 'track'
      const bar = document.createElement('span')
      bar.className = 'bar'
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = intent
      track.append(bar, name)
      const pct = document.createElement('span')
      pct.className = 'pct'
      row.append(track, pct)
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
  const full = fullLabelAt(p, pos)
  /* Only a word is cut. A continuation piece is one token by construction, so
     its own text is never longer than the vocabulary allows, and cutting it
     would take the tail off `##απενεργοποίησε`. */
  const isWord = pos !== 0 && (p.tokens[pos]?.word ?? -1) >= 0
  return isWord ? cut(full) : full
}

/**
 * A label no longer than the longest token this vocabulary holds.
 *
 * WH-F11 named the axis going quiet on a long word, and tick 103 fixed that half:
 * every continuation piece shows itself, so nothing reads `..` any more. Measured
 * at tick 169 on `the hash is 9f86…a08 ok`, 64 chips, none of them `..` and none
 * empty, and the axis was still unreadable for the opposite reason: the first
 * piece of a word is labelled with the whole word, so one chip was **454 pixels
 * wide against a median of 32** on a desktop, and **358 of the 358 available** on
 * a phone, wrapping to two lines inside itself.
 *
 * The cut is the vocabulary's own longest token, 14 characters here, because a
 * label longer than that is necessarily showing more than the token underneath
 * it. Nothing is lost: `aria-label` and `title` carry the whole word and its
 * length, which is where a screen reader and a pointer both look.
 */
/** The same label, uncut, for the places that have room for it. */
function fullLabelAt(p: Prediction, pos: number): string {
  if (pos === 0) return 'cls'
  const w = p.tokens[pos]?.word ?? -1
  if (w >= 0) return visibleLabel(p.words[w])
  const id = p.tokens[pos]?.id
  return id === undefined ? '..' : visibleLabel(router?.tokenizer.tokenText(id) ?? '..')
}

function cut(label: string): string {
  const longest = router?.tokenizer.longest ?? 0
  if (longest === 0 || label.length <= longest) return label
  return label.slice(0, longest) + '…'
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

  /*
   * WP-F13. `peak` ran three times over a field that had not changed, on every
   * hover: once inside `drawField`, which falls back to it when no max is
   * given, once for the aria-label and once for the caption. It is the same
   * number each time and the field is 4,096 cells at a full sentence. Passing
   * it in is also what keeps the large canvas on its own scale explicitly
   * rather than by omission.
   */
  const top = peakAt(field, cube.positions)
  const strongest = top.value

  drawField(ctx, field, cube.positions, {
    focus: focusToken,
    hue: HEAT_HUE,
    grid: true,
    max: strongest,
    palette: systemPalette(),
  })

  const conc = concentration(field, cube.positions)

  /*
   * Where the strongest link is, and not only how strong it is.
   *
   * WD2-F8. Both descriptions below said "where its strongest link goes" and
   * neither said where: a reader got a percentage and a grid to hunt through,
   * 36 cells on the opening sentence and 2,209 on a long one. Naming the pair
   * is the sentence the picture was already making, and it is also the only
   * coordinate this page publishes, so it is the one thing a gate can hold the
   * drawing to. `check:draw` reads it and requires the brightest drawn cell to
   * be at that row and that column, which is the caption's "rows are the token
   * doing the looking" stated as an assertion rather than as a promise.
   */
  el.field.dataset.strongest = `${top.q},${top.k}`
  const fromTok = fullLabelAt(p, top.q)
  const toTok = fullLabelAt(p, top.k)
  const link =
    top.q === top.k
      ? `strongest single link ${(strongest * 100).toFixed(0)} percent, "${fromTok}" looking at itself`
      : `strongest single link ${(strongest * 100).toFixed(0)} percent, from "${fromTok}" to "${toTok}"`

  // Twenty five canvases carry the entire argument of this page and no text.
  // This is the large one described in words: which field, how concentrated,
  // and where its strongest link goes, which is the thing a sighted reader
  // gets from looking at it.
  el.field.setAttribute(
    'aria-label',
    `Attention field, layer ${selected.layer + 1} of ${cube.layers}, head ` +
      `${selected.head + 1} of ${cube.heads}. Concentration ${(conc * 100).toFixed(0)} percent, ` +
      `${link}. A concentrated field means most tokens looked at the same few places.`,
  )

  el.fieldCaption.textContent =
    `layer ${selected.layer + 1} of ${cube.layers}, head ${selected.head + 1} of ` +
    `${cube.heads}. Rows are the token doing the looking, columns are what it looked at. ` +
    `Concentration ${(conc * 100).toFixed(0)} percent, ${link}.`
}

function drawAttention(p: Prediction) {
  const cube = cubeOf(p)

  /*
   * A pin cannot outlive the sentence it was put in.
   *
   * WD2-F6. Pinning token 40 of a 47 token sentence and then typing a five
   * token one left `pinnedToken` at 40: no chip could show it, because there
   * is no fortieth chip, and `preview()` returns early whenever a pin exists,
   * so hovering stopped doing anything at all with nothing on screen to undo.
   * Measured at tick 180 on the same five token sentence, drawn twice:
   *
   *   clean            mean 75.4, brightest 166, hover lights 1 chip
   *   after a stale pin  mean 84.1, brightest 190, hover lights 0
   *
   * The field is drawn through the dim ramp for every cell, because every row
   * is "not the focused row" and every column is "not the focused column".
   * That reads as washed out and measures as brighter, since the dim ramp is
   * the same lightness at a quarter of the chroma and a desaturated blue has a
   * higher relative luminance than a saturated one.
   *
   * A pin that still fits survives, the way the chosen head does. One that
   * does not is dropped here, where the new prediction arrives.
   */
  if (pinnedToken !== null && pinnedToken >= cube.positions) pinnedToken = null
  if (focusToken !== null && focusToken >= cube.positions) focusToken = null

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
      // Which head this is, on the element, so `markGrid` can set the selected
      // state without rebuilding anything and without index arithmetic that
      // would have to agree with this loop.
      b.dataset.layer = String(layer)
      b.dataset.head = String(head)
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
        drawField(cx, fieldAt(cube, layer, head), cube.positions, {
          hue: HEAT_HUE,
          max: gridMax,
          palette: systemPalette(),
        })
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
      // keyboard support. `markGrid` sets it, here and on every change.
      b.setAttribute(
        'aria-label',
        `Layer ${layer + 1}, head ${head + 1}, concentration ${(conc * 100).toFixed(0)} percent`,
      )

      b.addEventListener('click', () => {
        selected = { layer, head }
        choose(p)
      })
      b.addEventListener('keydown', (e) => {
        const step = ARROWS[e.key]
        if (!step) return
        e.preventDefault()
        const [dl, dh] = step
        selected = {
          layer: (layer + dl + cube.layers) % cube.layers,
          head: (head + dh + cube.heads) % cube.heads,
        }
        choose(p)
        // The cells are the same elements as before, and the one carrying the
        // tab stop has moved.
        el.heads.querySelector<HTMLElement>('.headcell[tabindex="0"]')?.focus()
      })
      frag.append(b)
    }
  }
  el.heads.replaceChildren(frag)
  // The selected state, from the one place that knows what it is.
  markGrid()

  // The tokens along the axis. Hover was the only way to use these, which meant
  // they did nothing at all on a phone and nothing at all from a keyboard: two
  // audits found that from opposite directions, and between them it is half the
  // interactivity on the page.
  //
  // Each is a real button now. Hover still previews, because that is the nicest
  // way to use it with a mouse, but a click pins and a second click unpins, and
  // the arrow keys walk the sentence.
  /*
   * The axis reads in the direction of the sentence, taken from the box rather
   * than from the axis's own contents.
   *
   * `dir="auto"` on the axis was the obvious fix and it does not work here: the
   * first token drawn is the model's `cls` marker, so the first strong
   * character is Latin and the whole row resolved to ltr for
   * "اضبط مؤقتا لعشر دقائق." while the box beside it resolved to rtl. Asking
   * the box for what the browser already decided about the visitor's text uses
   * the same bidi rules without reimplementing them, and without the marker
   * getting a vote.
   */
  el.axis.dir = getComputedStyle(el.input).direction

  /*
   * One track per token, for both axes and the pixels between them.
   *
   * WD-F7. The chips were a wrapped flex row whose widths came from their own
   * words, 25 to 94 pixels against columns a uniform 42.8, so nothing but
   * counting connected a chip to a column. `--n` puts the two axes and the
   * canvas on the same division: a label is one column wide because the grid
   * says so, not because a number was computed twice and happened to agree.
   *
   * The left gutter is a constant, and that is a decision rather than laziness.
   * Sizing it to the longest label is the obvious thing and it was tried first:
   * `check:layout` caught it immediately, because the longest label changes on
   * every keystroke and the canvas is sized from what is left, so the field
   * took **6 different widths while a sentence was being typed**. A label
   * clipped at four characters is a small cost; a picture that changes size
   * under the reader is not.
   */
  el.field_.style.setProperty('--n', String(cube.positions))
  const rowLabels = Array.from({ length: cube.positions }, (_, pos) => cut(fullLabelAt(p, pos)))

  /*
   * The same tokens down the left edge, as labels rather than as controls.
   *
   * `aria-hidden` on the strip: a screen reader is given this sentence's tokens
   * once, as the buttons of the column axis, and hearing all 47 again to be
   * told the matrix is square is worse than not hearing them. The canvas
   * carries its own description for the same reason.
   */
  el.fieldRows.replaceChildren(
    ...rowLabels.map((text) => {
      const d = document.createElement('div')
      d.className = 'field-row'
      d.textContent = text
      return d
    }),
  )

  /*
   * And the page decides when a label stops being one.
   *
   * Measured at tick 197: a column is 99.9 pixels at 6 tokens, 42.8 at 14 and
   * 8.1 at 64. Under about 24 pixels a monospace label holds two characters,
   * which names nothing, and the row axis has the same problem in the other
   * direction. Rather than let the browser squeeze them into a texture, both
   * axes go away and the caption keeps saying which way round the matrix is,
   * which is the state every sentence was in before this tick.
   */
  const FITS = 24
  el.field_.dataset.axisFits = el.field_.clientWidth / Math.max(1, cube.positions) >= FITS ? 'yes' : 'no'

  el.axis.replaceChildren(
    ...Array.from({ length: cube.positions }, (_, pos) => {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = labelAt(p, pos)
      b.className = pos === 0 ? 'axis-token axis-token--cls' : 'axis-token'
      b.setAttribute('aria-pressed', String(focusToken === pos))
      /*
       * The whole word here, never the cut one. `cut` exists so that one chip
       * cannot take the row, and a screen reader has no row to take: it would
       * only hear a hash truncated at fourteen characters with no way to ask for
       * the rest. The title does the same job for a pointer.
       */
      const full = fullLabelAt(p, pos)
      if (full !== labelAt(p, pos)) b.title = `${full}, ${plural(full.length, 'character')}`
      b.setAttribute(
        'aria-label',
        pos === 0
          ? 'The sentence vector, position 1'
          : `${full}, position ${pos + 1} of ${cube.positions}`,
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
    `flat row is one that did not. The first position is the cls token, and the ` +
    `intent is read from it and from the average of every position together, so ` +
    `every row here is part of the answer. All twenty four share one scale, so a faint ` +
    `field really is a faint one, and the colour is the square root of the value ` +
    `so the weak ones stay readable. The exact figure is on every label.`

  drawSelected(p)
  markAxis()
}

/**
 * Which thumbnail is the chosen one, written onto the cells that already exist.
 *
 * WP-F3. Choosing a head used to call `drawAttention`, which rebuilds
 * everything: measured at tick 173 on a 64 position sentence, one click
 * replaced **all 24 thumbnails, all 24 canvases and all 64 axis buttons**, zero
 * of the 112 nodes surviving, for a change that altered no data. The cost is
 * small now that the drawing is fast, 7 ms, so this is waste rather than a
 * delay, and waste is what makes a page feel like it is thinking when it is
 * not: the axis a reader is pointing at is replaced under the pointer, and
 * every canvas repaints to show what it already showed.
 *
 * Three attributes on twenty four buttons is the whole of what a head change
 * is, and this is the only place they are set, including when the grid is
 * first built, so the rule cannot drift between the two paths.
 */
/** A head was chosen: the picture, its caption, and which cell is lit. */
function choose(p: Prediction) {
  markGrid()
  drawSelected(p)
}

function markGrid() {
  for (const cell of el.heads.querySelectorAll<HTMLElement>('.headcell')) {
    const on = Number(cell.dataset.layer) === selected.layer && Number(cell.dataset.head) === selected.head
    cell.classList.toggle('is-on', on)
    cell.setAttribute('aria-selected', String(on))
    // One tab stop for the whole grid: see the note where the cells are built.
    cell.tabIndex = on ? 0 : -1
  }
}

function markAxis() {
  el.axis.querySelectorAll('.axis-token').forEach((n, i) => {
    n.classList.toggle('is-focus', i === focusToken)
    n.classList.toggle('is-pinned', i === pinnedToken)
    n.setAttribute('aria-pressed', String(i === pinnedToken))
  })
}

/**
 * How many characters the tokenizer cuts into more than one word.
 *
 * Asked of the rule itself rather than of a list of ranges: a grapheme cluster
 * is run through `wordTokenize`, and if it comes back as more than one word the
 * page says so. The Greek flag is two regional indicators, a skin toned thumb is
 * a thumb and a swatch, and a family is several people joined by zero width
 * joiners, and every one of those is several tokens to the model whatever the
 * reader sees. `[^\w\s]` matches one code point at a time in Python too, so this
 * is not the port drifting: it is what the model was given.
 */
function splitCharacters(text: string): number {
  if (typeof Intl?.Segmenter !== 'function') return 0
  let n = 0
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) {
    if (wordTokenize(segment).length > 1) n++
  }
  return n
}

/**
 * The tokens the model has never seen, counted and said.
 *
 * WH-F10. This vocabulary is 4,000 tokens built from Greek and English
 * assistant requests, so every emoji in it is `<unk>`: measured at tick 168, the
 * fixture sentence with one smiling face in it is 1 unknown of 11 positions, the
 * Greek flag alone is 2 of 3, and a skin toned thumb is 2 of 3, which is
 * U+1F44D followed by U+1F3FD. The page drew those chips with no
 * mark on them, so a visitor watched the model confidently resolve a sentence
 * containing symbols it cannot read, and the two halves of the flag drew as G
 * and R, which is a lie about their own text.
 *
 * Said rather than hidden or prettified: grouping the halves back together would
 * make the page disagree with the token count beside it, and this page exists to
 * show what the model is given.
 */
function sayUnknown(text: string, p: Prediction) {
  const unknown = p.tokens.filter((t) => t.id === router!.tokenizer.unk).length
  el.unknownNote.hidden = unknown === 0
  if (unknown === 0) {
    el.unknownNote.textContent = ''
    return
  }

  const split = splitCharacters(normalize(text))
  const vocab = router!.tokenizer.size.toLocaleString('en-US')
  const halves =
    split > 0
      ? ` ${plural(split, 'character')} of yours ${split === 1 ? 'reaches' : 'reach'} it as more than one token, which is why ${split === 1 ? 'it is' : 'they are'} drawn in pieces.`
      : ''

  el.unknownNote.textContent =
    `${plural(unknown, 'token')} here ${unknown === 1 ? 'is' : 'are'} outside the model's ` +
    `${vocab} token vocabulary, so it sees ${unknown === 1 ? 'it' : 'them'} as unknown.${halves}`
}

async function think() {
  if (!router) {
    /*
     * The model is still arriving, and this is the only place that knows a
     * visitor has asked for something. Saying so is the whole of WH-F4: the
     * sentence is kept, `boot()` answers whatever is in the box the moment the
     * graph is here, and until tick 166 the page let a visitor watch a chip do
     * nothing and draw the obvious conclusion.
     *
     * The announcement goes to the live region rather than the status line
     * because the status line is a progress bar with a byte count in it, and
     * `sayProgress` owns that text.
     */
    const asked = el.input.value
    if (hasWords(asked)) {
      waitingFor = asked
      el.announce.textContent = `The model is still downloading. It will answer this when it arrives: ${asked}`
      if (downloadAt) sayProgress(downloadAt.received, downloadAt.total)
    }
    return
  }
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
    const p = await router.run(text)
    lastPrediction = p
    render(p)
    /* With the text, not with `el.input.value`: the note is about the sentence
       that was answered, and by the time this runs the box may hold another. */
    sayUnknown(text, p)
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

  for (const sample of SAMPLES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = sample.text
    b.lang = sample.lang
    b.addEventListener('click', () => {
      touched = true
      el.input.value = sample.text
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
/**
 * The download, in one line, plus what is waiting for it.
 *
 * A function rather than four statements inside the progress callback, because
 * a chip clicked mid download has to change this line straight away and the
 * callback fires at most four times a second. It reads `waitingFor`, so the
 * clause appears on the next paint either way.
 */
function sayProgress(received: number, total: number) {
  downloadAt = { received, total }
  const mb = (n: number) => (n / 1e6).toFixed(1)
  const done = received >= total
  el.status.textContent =
    (done ? `${mb(total)} MB of model downloaded, starting it` : `downloading the model, ${mb(received)} of ${mb(total)} MB`) +
    (waitingFor ? ', then it answers what is in the box' : '')
  el.status.setAttribute('role', 'progressbar')
  el.status.setAttribute('aria-valuemin', '0')
  el.status.setAttribute('aria-valuemax', String(total))
  el.status.setAttribute('aria-valuenow', String(received))
  // The bar is the background of the line rather than a second element, so
  // nothing moves when it appears and nothing is left behind when it goes.
  el.status.style.setProperty('--progress', `${((received / total) * 100).toFixed(1)}%`)
}

function inert(why: string) {
  /*
   * The promise goes with the page's ability to keep it. A visitor who clicked
   * a chip during a download that then failed was told the model would answer
   * what is in the box, and `inert` is the one place that knows it will not.
   */
  waitingFor = null
  el.main.removeAttribute('aria-busy')
  el.announce.textContent = why
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
      sayProgress(received, total)
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
  /*
   * The model is here, so the page is no longer busy and nothing is waiting.
   * Both of these are true from this line and not from the last one in `boot`:
   * the footer and the standfirst below are writing, not loading.
   */
  el.main.removeAttribute('aria-busy')
  waitingFor = null

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
   * `transferSize`, not `encodedBodySize`, and that was a correction.
   *
   * The first version of this summed `encodedBodySize`, which is a response's
   * body size **wherever it came from**, cache included. The measurement audit
   * reloaded the live page and found the footer still saying 8.24 MB when
   * nothing had been fetched at all: "8.24 MB in 278 ms" is 237 Mbit/s, and the
   * comment here used to claim that nothing is stored so nothing can go stale.
   * The browser stores it. The host sends `Cache-Control: max-age=600`, so every
   * return inside ten minutes printed a download that did not happen.
   *
   * `transferSize` is 0 for a cache hit and includes the response headers for
   * everything else, which is what a visitor actually paid.
   */
  const wireBytes =
    performance.getEntriesByType('resource').reduce((sum, r) => sum + ((r as PerformanceResourceTiming).transferSize || 0), 0) +
    ((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.transferSize ?? 0)

  /*
   * And when that is nothing, it says nothing rather than 0.00 MB, because a
   * visit served entirely from cache is the interesting case: it is the whole
   * argument for shipping a model to the browser rather than calling an API.
   */
  const cost =
    wireBytes < 50_000
      ? `nothing over the wire, served from your cache, ready in ${howLong(loadMs)}`
      : `${(wireBytes / 1e6).toFixed(2)} MB over the wire, ${howLong(loadMs)} to load`

  el.footer.textContent = q
    ? `${cost}. ` +
      `Intent accuracy ${q.int8.intentAccuracy}% on ${q.rowsEvaluated.toLocaleString('en-US')} ` +
      `held out sentences, against ${q.fp32.intentAccuracy}% before quantisation.` +
      both +
      floor
    : `${cost}.`

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
  if (!touched && !el.input.value) el.input.value = SAMPLES[0].text
  await think()
}

void boot()
