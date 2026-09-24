/**
 * Drawing what the model looked at.
 *
 * The model emits attention as [layer][batch][head][query][key], already
 * softmaxed, so every query row sums to one: a row is how one token divided its
 * attention across the sentence. Six layers, four heads, twenty four fields for
 * a single sentence, and the interesting thing is almost never one of them
 * alone. It is how they differ.
 *
 * So the page draws all twenty four small and one large, and the small ones are
 * not decoration: picking out the head that has learned to look at the verb, or
 * the layer where everything collapses onto the first token, is the whole
 * activity.
 *
 * Canvas rather than DOM. A sixty four token sentence is 4,096 cells per field
 * and 98,304 across all of them, which is nothing for a canvas and a great deal
 * of layout for a browser.
 */

export interface Field {
  layer: number
  head: number
  /** positions x positions, row major, each row summing to one. */
  values: Float32Array
}

export interface AttentionCube {
  layers: number
  heads: number
  positions: number
  raw: Float32Array
}

export function fieldAt(cube: AttentionCube, layer: number, head: number): Field {
  const { heads, positions } = cube
  // [layer][batch=1][head][query][key], batch is always one here.
  const stride = positions * positions
  const offset = ((layer * heads + head) * stride)
  return {
    layer,
    head,
    values: cube.raw.subarray(offset, offset + stride),
  }
}

/**
 * The largest value in a field, used to scale the colour.
 *
 * Scaling to the row sum would be wrong: every row already sums to one, so a
 * field where one token takes everything and a field where attention is spread
 * evenly would look identical. Scaling to the maximum is what makes the
 * difference between those two visible, which is the difference worth seeing.
 */
export function peak(field: Field): number {
  let max = 0
  for (const v of field.values) if (v > max) max = v
  return max
}

/**
 * The largest value anywhere in the cube, so the small multiples share a scale.
 *
 * Computed once per cube and handed to all twenty four thumbnails. Without it
 * each one divides by its own peak and a head whose strongest link is 0.267
 * renders exactly as hot as one whose strongest link is 0.999, which erases the
 * difference the grid exists to show.
 */
export function cubePeak(cube: AttentionCube): number {
  let max = 0
  for (const v of cube.raw) if (v > max) max = v
  return max
}

export interface DrawOptions {
  /** Highlight one query row and one key column, or neither. */
  focus?: number | null
  /** oklch hue for the heat. */
  hue: number
  /** Leave a hairline between cells once they are big enough to see it. */
  grid?: boolean
  /**
   * What full chroma means. Defaults to this field's own peak.
   *
   * Pass the whole cube's peak for the small multiples and they become
   * comparable; leave it out for the large canvas, where the caption prints the
   * strongest link as a percentage and the field is not being compared to
   * anything beside it.
   *
   * The measurement audit's line, and it is the right one: a grid of small
   * multiples is a chart, and a chart whose panels have different y axes and no
   * labels saying so is the standard example of an unfair comparison. Measured
   * on the shipped graph for one sentence, the twenty four field peaks ran from
   * 0.267 to 0.999, and every one of them rendered its hottest cell at full
   * chroma.
   */
  max?: number
}

/**
 * One field onto a canvas, sized to the canvas.
 *
 * Deliberately not a gradient across several colours. A single hue ramped from
 * the page background to full chroma reads as one quantity, and a rainbow reads
 * as several.
 */
/**
 * oklch to sRGB, in JavaScript, because the browser will not do this per pixel.
 *
 * The drawing loop used to build an `oklch(...)` string and assign it to
 * `fillStyle` once per cell, which for a 64 token sentence is 4,096 strings
 * built, parsed and converted for a single field, and 98,304 across the grid.
 * Measured by the performance audit: 144 ms to paint one field where 1.1 ms
 * draws the same picture.
 *
 * Verified against the browser rather than trusted: `check:draw` renders each
 * colour both ways, the browser's own `oklch()` parser against this function,
 * and requires them to agree to within one unit per channel.
 */
export function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]

  return lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(g * 255)))
  }) as [number, number, number]
}

/**
 * The value to colour ramp, built once per hue instead of per cell.
 *
 * Both lightness and chroma are linear in the normalised value, so the whole
 * palette is one dimensional and 256 steps is finer than the eye or the 8 bit
 * canvas can resolve. Two ramps per hue, because a focused row dims everything
 * off the cross to a quarter chroma.
 */
/*
 * The square root between the value and the ramp, and it is declared on the page.
 *
 * Both lightness and chroma are linear in the step, which was right while every
 * panel was scaled to its own peak and reached the top of the ramp. With one
 * scale across the cube it stopped being right: a head whose strongest link is 5
 * percent against a peak of 94 draws at L 0.21 against a background of 0.18.
 * Measured across the twenty four, peak luminance ran from 46 to 166, and the
 * bottom six were near black squares whose structure could not be read. The
 * shared scale made the grid honest and made a third of it unreadable in the
 * same commit.
 *
 * On `check:draw`'s own sentence the dimmest panel went from **40 to 75** when
 * the curve went in, which is the pair the gate's floor sits between.
 *
 * `sqrt` maps 0.053 to 0.23 and 0.94 to 0.97, so the order is preserved exactly
 * and every panel stays comparable. The exact figure is printed on every label
 * and in the caption, so nothing is lost to the curve, and the caption says the
 * curve is there: an undeclared transform on a heat map is the other kind of
 * dishonest.
 */
const RAMP_STEPS = 256
const ramps = new Map<number, { normal: Uint8ClampedArray; dim: Uint8ClampedArray }>()

function rampFor(hue: number) {
  let r = ramps.get(hue)
  if (r) return r
  const normal = new Uint8ClampedArray(RAMP_STEPS * 3)
  const dim = new Uint8ClampedArray(RAMP_STEPS * 3)
  for (let i = 0; i < RAMP_STEPS; i++) {
    const v = i / (RAMP_STEPS - 1)
    const L = 0.18 + v * 0.62
    const C = 0.03 + v * 0.17
    const [nr, ng, nb] = oklchToRgb(L, C, hue)
    const [dr, dg, db] = oklchToRgb(L, C * 0.25, hue)
    normal[i * 3] = nr; normal[i * 3 + 1] = ng; normal[i * 3 + 2] = nb
    dim[i * 3] = dr; dim[i * 3 + 1] = dg; dim[i * 3 + 2] = db
  }
  r = { normal, dim }
  ramps.set(hue, r)
  return r
}

/**
 * One offscreen canvas, reused. The field is written at one pixel per cell and
 * then scaled up with smoothing off, which is what the per cell `fillRect` was
 * doing by hand and is what the compositor is for.
 */
let scratch: HTMLCanvasElement | null = null
function scratchCtx(size: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== size || scratch.height !== size) {
    scratch.width = size
    scratch.height = size
  }
  return scratch.getContext('2d')!
}

export function drawField(
  ctx: CanvasRenderingContext2D,
  field: Field,
  positions: number,
  options: DrawOptions,
): void {
  const { width, height } = ctx.canvas
  const cell = Math.min(width, height) / positions
  const { focus = null, hue, grid = false } = options
  const max = options.max || peak(field) || 1

  ctx.clearRect(0, 0, width, height)

  const { normal, dim } = rampFor(hue)

  /*
   * How many pixels the field is drawn into, which decides whether this is an
   * upscale or a downscale, and they need different treatment.
   *
   * The large canvas is always an upscale: 520 pixels for at most 64 cells, so
   * one source pixel per cell scaled with smoothing off is exact.
   *
   * The thumbnails are 128 wide at device scale for up to 64 cells, and the
   * deep review found what happens past the point where they are not. Drawing
   * one pixel per cell and letting `drawImage` scale it down with smoothing off
   * is **point sampling**: at 61 cells into 44 pixels it reads 44 rows and 44
   * columns and never touches the other 17 of each, so 48 percent of the field
   * is not drawn. Measured on the real page at 61 tokens, 10 of the 24
   * thumbnails had a lower maximum than the head they claim to show.
   *
   * The fix is to pool rather than to sample, and **max** rather than mean.
   * Averaging would keep every cell but divide a lone strong link by the size
   * of its block, so the honest picture of "somewhere in here is a strong link"
   * becomes a faint one. These thumbnails exist to be scanned for exactly that.
   * Max pooling keeps every peak at full strength, drops nothing, and makes the
   * gate a real invariant rather than a tolerance: each thumbnail's maximum is
   * its own field's maximum, at any number of tokens.
   */
  const drawn = Math.max(1, Math.round(positions * cell))
  const pooled = drawn < positions
  const size = pooled ? drawn : positions
  const sctx = scratchCtx(size)
  const img = sctx.createImageData(size, size)
  const px = img.data

  const paint = (o: number, v: number, ramp: Uint8ClampedArray) => {
    if (v <= 0.002) return
    const shown = v >= 1 ? 1 : Math.sqrt(v)
    const step = (shown * (RAMP_STEPS - 1)) | 0
    px[o] = ramp[step * 3]
    px[o + 1] = ramp[step * 3 + 1]
    px[o + 2] = ramp[step * 3 + 2]
    px[o + 3] = 255
  }

  if (!pooled) {
    for (let q = 0; q < positions; q++) {
      const rowFocused = focus !== null && q === focus
      for (let k = 0; k < positions; k++) {
        const v = field.values[q * positions + k] / max
        const ramp = focus !== null && !rowFocused && k !== focus ? dim : normal
        paint((q * positions + k) * 4, v, ramp)
      }
    }
  } else {
    // One pass over every cell, each one folded into the destination pixel it
    // lands in. Every cell is read exactly once, which is the whole point, and
    // it is cheaper than the per pixel gather it replaces.
    const best = new Float32Array(size * size)
    const bestDim = new Uint8Array(size * size)
    for (let q = 0; q < positions; q++) {
      const dq = ((q * size) / positions) | 0
      const rowFocused = focus !== null && q === focus
      for (let k = 0; k < positions; k++) {
        const v = field.values[q * positions + k] / max
        const d = dq * size + (((k * size) / positions) | 0)
        if (v > best[d]) {
          best[d] = v
          // The dimming follows the cell that won, so a focused row still reads
          // as the bright one at thumbnail size.
          bestDim[d] = focus !== null && !rowFocused && k !== focus ? 1 : 0
        }
      }
    }
    for (let d = 0; d < best.length; d++) paint(d * 4, best[d], bestDim[d] ? dim : normal)
  }

  sctx.putImageData(img, 0, 0)
  const wasSmoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(scratch!, 0, 0, size, size, 0, 0, positions * cell, positions * cell)
  ctx.imageSmoothingEnabled = wasSmoothing

  if (grid && cell > 6) {
    ctx.strokeStyle = 'oklch(0.3 0.02 285 / 0.5)'
    ctx.lineWidth = 1
    for (let i = 1; i < positions; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cell, 0)
      ctx.lineTo(i * cell, positions * cell)
      ctx.moveTo(0, i * cell)
      ctx.lineTo(positions * cell, i * cell)
      ctx.stroke()
    }
  }

  if (focus !== null) {
    ctx.strokeStyle = `oklch(0.85 0.16 ${hue})`
    ctx.lineWidth = 1.5
    ctx.strokeRect(0, focus * cell, positions * cell, cell)
    ctx.strokeRect(focus * cell, 0, cell, positions * cell)
  }
}

/**
 * How concentrated a field is, as a number between 0 and 1.
 *
 * One minus the normalised entropy of the average row. A head that sends every
 * token to the same place scores near 1; a head that spreads attention evenly
 * scores near 0. It is what the thumbnails are sorted and labelled by, so the
 * visitor can find the sharp heads without hunting through twenty four
 * pictures.
 */
export function concentration(field: Field, positions: number): number {
  if (positions < 2) return 1
  let total = 0
  for (let q = 0; q < positions; q++) {
    let h = 0
    for (let k = 0; k < positions; k++) {
      const v = field.values[q * positions + k]
      if (v > 1e-9) h -= v * Math.log(v)
    }
    total += h / Math.log(positions)
  }
  return 1 - total / positions
}
