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

  for (let q = 0; q < positions; q++) {
    for (let k = 0; k < positions; k++) {
      const v = field.values[q * positions + k] / max
      if (v <= 0.002) continue

      // Lightness carries the value and chroma follows it, so a weak cell is
      // dim and grey rather than a pale version of a saturated colour.
      const l = 0.18 + v * 0.62
      const c = 0.03 + v * 0.17
      const dimmed = focus !== null && q !== focus && k !== focus
      ctx.fillStyle = `oklch(${l} ${dimmed ? c * 0.25 : c} ${hue})`
      ctx.fillRect(k * cell, q * cell, Math.ceil(cell), Math.ceil(cell))
    }
  }

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
