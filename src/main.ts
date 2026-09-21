import './style.css'
import { Router, topIntents, wordTags, type Prediction } from './lib/router'

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
    `${p.dims.positions} tokens, ${p.dims.layers} layers, ${p.dims.heads} heads, ` +
    `${p.ms.toFixed(1)} ms`
  el.result.hidden = false
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

function wire() {
  el.input.addEventListener('input', () => {
    cancelAnimationFrame(queued)
    queued = requestAnimationFrame(() => void think())
  })

  for (const s of SAMPLES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = s
    b.addEventListener('click', () => {
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

  el.footer.textContent = q
    ? `${(q.bytesInt8 / 1e6).toFixed(2)} MB over the wire, ${loadMs.toFixed(0)} ms to load. ` +
      `Intent accuracy ${q.int8.intentAccuracy}% on ${q.heldOutSentences.toLocaleString('en-US')} ` +
      `held out sentences, against ${q.fp32.intentAccuracy}% before quantisation. ` +
      `That set is the adversarial one, so it is a floor rather than a headline.`
    : `${loadMs.toFixed(0)} ms to load.`

  el.input.value = SAMPLES[0]
  await think()
}

void boot()
