// Makes Untangle's 3000 levels: node tools/make-untangle.mjs  →  data/untangle-levels.json
// Each level: cheap random tangles, ranked by the solver's lower bound; the best few are solved
// and the first whose fewest moves equals the level's target is kept. If none does in time, a
// tangle is built whose fewest moves is proven (levels.js exactAttempt). Every level is saved the
// moment it's made (data/untangle-progress.jsonl), so a stopped run picks up where it left off;
// the progress file is deleted when the full list is written. Work is shared across the cores;
// every level comes from its own seeds, so the result is the same however it's split.
// Once launched, existing levels must never change; new ones are only added at the end.
//   node tools/make-untangle.mjs [count]   (count: make only the first levels, for a quick look)
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { LEVEL_COUNT, PLAN_VERSION, plan, attempt, exactAttempt, levelText } from '../js/untangle/levels.js'
import { fewestMoves, lowerBound } from '../js/untangle/solver.js'

const CANDIDATES = 60 // cheap random tangles made per level
const SOLVES = 8 // how many of the best-looking ones the solver checks
const LIMIT = 25000 // positions the solver may look at before a tangle counts as too slow to check
const SECONDS = 20 // after this long on one level, stop solving and use the proven backup

export function makeLevel(n) {
  const { target } = plan(n)
  const started = Date.now()
  const cands = []
  for (let t = 0; t < CANDIDATES; t++) {
    const a = attempt(n, t)
    const lb = lowerBound(a.state)
    if (lb >= 1 && lb <= target) cands.push({ a, lb, cross: a.state.word.length })
  }
  // Nearest the target first (that also makes the solver finish fast), then the messier one.
  cands.sort((x, y) => y.lb - x.lb || y.cross - x.cross)
  let best = null
  for (const c of cands.slice(0, SOLVES)) {
    if (Date.now() - started > SECONDS * 1000) break
    const res = fewestMoves(c.a.state, LIMIT)
    if (!res) continue // too hard to be sure of the fewest: skip it
    const off = Math.abs(res.moves - target)
    if (!best || off < best.off) best = { off, a: c.a, min: res.moves }
    if (off === 0) return { text: levelText(c.a), min: res.moves, how: 'random' }
  }
  for (let t = 0; t < (plan(n).ropes >= 6 ? 20 : 0); t++) {
    const e = exactAttempt(n, t)
    if (e) return { text: levelText(e), min: target, how: 'proven' }
  }
  if (!best) throw new Error(`level ${n}: nothing found`)
  return { text: levelText(best.a), min: best.min, how: 'nearest' }
}

if (!isMainThread) {
  for (const n of workerData) parentPort.postMessage({ n, ...makeLevel(n) })
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const count = Number(process.argv[2]) || LEVEL_COUNT
  mkdirSync(join(root, 'data'), { recursive: true })
  const progress = join(root, 'data/untangle-progress.jsonl')
  const levels = new Array(count)
  const min = new Array(count)
  // Pick up a stopped run (only if it was made with the same plan).
  if (existsSync(progress)) {
    const lines = readFileSync(progress, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    if (lines[0]?.plan === PLAN_VERSION) {
      for (const l of lines.slice(1)) if (l.n <= count) [levels[l.n - 1], min[l.n - 1]] = [l.text, l.min]
    } else unlinkSync(progress)
  }
  if (!existsSync(progress)) writeFileSync(progress, JSON.stringify({ plan: PLAN_VERSION }) + '\n')
  const todo = []
  for (let n = 1; n <= count; n++) if (!levels[n - 1]) todo.push(n)
  console.log(`${count - todo.length} levels already made, ${todo.length} to go`)
  const workers = Math.max(1, Math.min(todo.length, availableParallelism() - 1))
  const shares = Array.from({ length: workers }, (_, w) => todo.filter((_, i) => i % workers === w))
  const how = { random: 0, proven: 0, nearest: 0 }
  let done = 0
  const started = Date.now()
  await Promise.all(
    shares.map(
      (list) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: list, resourceLimits: { maxOldGenerationSizeMb: 700 } })
          worker.on('message', ({ n, text, min: m, how: h }) => {
            levels[n - 1] = text
            min[n - 1] = m
            how[h]++
            appendFileSync(progress, JSON.stringify({ n, text, min: m }) + '\n')
            if (++done % 250 === 0) console.log(`${done} made (${Math.round((Date.now() - started) / 1000)} s)`)
          })
          worker.on('error', reject)
          worker.on('exit', (code) => (code ? reject(new Error(`worker stopped (${code})`)) : resolve()))
        }),
    ),
  )
  writeFileSync(join(root, 'data/untangle-levels.json'), JSON.stringify({ version: 1, levels, min }) + '\n')
  unlinkSync(progress)
  const off = min.filter((m, i) => m !== plan(i + 1).target).length
  console.log(`Wrote ${count} levels to data/untangle-levels.json in ${Math.round((Date.now() - started) / 1000)} s: ${how.random} random, ${how.proven} proven, ${how.nearest} nearest (${off} off their target)`)
}
