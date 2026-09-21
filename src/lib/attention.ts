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

export interface DrawOptions {
  /** Highlight one query row and one key column, or neither. */
  focus?: number | null
  /** oklch hue for the heat. */
  hue: number
  /** Leave a hairline between cells once they are big enough to see it. */
  grid?: boolean
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
  const max = peak(field) || 1
  const { focus = null, hue, grid = false } = options

  ctx.clearRect(0, 0, width, height)

  const { normal, dim } = rampFor(hue)
  const sctx = scratchCtx(positions)
  const img = sctx.createImageData(positions, positions)
  const px = img.data

  for (let q = 0; q < positions; q++) {
    const rowFocused = focus !== null && q === focus
    for (let k = 0; k < positions; k++) {
      const v = field.values[q * positions + k] / max
      const o = (q * positions + k) * 4
      if (v <= 0.002) continue

      const step = v >= 1 ? RAMP_STEPS - 1 : (v * (RAMP_STEPS - 1)) | 0
      const ramp = focus !== null && !rowFocused && k !== focus ? dim : normal
      px[o] = ramp[step * 3]
      px[o + 1] = ramp[step * 3 + 1]
      px[o + 2] = ramp[step * 3 + 2]
      px[o + 3] = 255
    }
  }

  sctx.putImageData(img, 0, 0)
  const wasSmoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(scratch!, 0, 0, positions, positions, 0, 0, positions * cell, positions * cell)
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
