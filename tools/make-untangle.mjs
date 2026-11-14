// Makes Untangle's 3000 levels: node tools/make-untangle.mjs  →  data/untangle-levels.json
// Each level: random tangles are tried until the solver says the fewest moves equals the
// level's target (after many tries, the closest one found is kept). Work is shared across the
// computer's cores; every level comes from its own seeds, so the result is the same however it's
// split. Once launched, existing levels must never change; new ones are only added at the end.
//   node tools/make-untangle.mjs [count]   (count: make only the first levels, for a quick look)
import { writeFileSync, mkdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { LEVEL_COUNT, plan, attempt, levelText } from '../js/untangle/levels.js'
import { fewestMoves, lowerBound } from '../js/untangle/solver.js'

const CANDIDATES = 60 // cheap random tangles made per level
const SOLVES = 8 // how many of the best-looking ones the solver checks
const LIMIT = 25000 // positions the solver may look at before a tangle counts as too slow to check

// One level: rank the candidates by the solver's lower bound (nearest the target first, then the
// messier one), solve them in that order, keep the first that hits the target exactly (or the
// nearest found). A bound near the target also makes the solver finish fast.
export function makeLevel(n) {
  const { target } = plan(n)
  const cands = []
  for (let t = 0; t < CANDIDATES; t++) {
    const a = attempt(n, t)
    const lb = lowerBound(a.state)
    if (lb <= target) cands.push({ a, lb, cross: a.state.word.length })
  }
  cands.sort((x, y) => y.lb - x.lb || y.cross - x.cross)
  let best = null
  for (const c of cands.slice(0, SOLVES)) {
    const res = fewestMoves(c.a.state, LIMIT)
    if (!res) continue // too hard to be sure of the fewest: skip it
    const off = Math.abs(res.moves - target)
    if (!best || off < best.off) best = { off, a: c.a, min: res.moves }
    if (off === 0) break
  }
  if (!best) throw new Error(`level ${n}: nothing solvable found`)
  return { text: levelText(best.a), min: best.min }
}

if (!isMainThread) {
  for (const n of workerData) parentPort.postMessage({ n, ...makeLevel(n) })
}
if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const count = Number(process.argv[2]) || LEVEL_COUNT
  const workers = Math.max(1, availableParallelism() - 1)
  const levels = new Array(count)
  const min = new Array(count)
  const shares = Array.from({ length: workers }, (_, w) => {
    const list = []
    for (let n = w + 1; n <= count; n += workers) list.push(n)
    return list
  })
  let done = 0
  const started = Date.now()
  await Promise.all(
    shares.map(
      (list) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: list, resourceLimits: { maxOldGenerationSizeMb: 700 } })
          worker.on('message', ({ n, text, min: m }) => {
            levels[n - 1] = text
            min[n - 1] = m
            if (++done % 100 === 0) console.log(`${done} levels made (${Math.round((Date.now() - started) / 1000)} s)`)
          })
          worker.on('error', reject)
          worker.on('exit', (code) => (code ? reject(new Error(`worker stopped (${code})`)) : resolve()))
        }),
    ),
  )
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data/untangle-levels.json'), JSON.stringify({ version: 1, levels, min }) + '\n')
  const off = min.filter((m, i) => m !== plan(i + 1).target).length
  console.log(`Wrote ${count} levels to data/untangle-levels.json (${off} off their target)`)
}
