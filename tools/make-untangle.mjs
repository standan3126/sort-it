// Makes Untangle's 3000 levels: node tools/make-untangle.mjs  →  data/untangle-levels.json
// Each level: cheap random tangles, ranked by the solver's lower bound; the best few are solved
// and the first whose fewest moves equals the level's target is kept. If none does in time, a
// tangle is built whose fewest moves is proven (levels.js exactAttempt). Every level is saved the
// moment it's made (data/untangle-progress.jsonl), so a stopped run picks up where it left off;
// the progress file is deleted when the full list is written. Work is shared across the cores;
// every level comes from its own seeds, so the result is the same however it's split.
// Once launched, existing levels must never change; new ones are only added at the end.
// Gentle on the computer (a full-speed run froze it on 2026-11-14): at most half the cores, lowest
// priority so the desktop always comes first, a small memory cap per worker, and it pauses new
// work if free memory gets low. A worker that hits its cap only loses its current level; run
// the maker again and it picks up from the progress file.
// No two levels may be the same: after making them, any level equal to an earlier one is made
// again (in level order, so the result is still the same every run).
//   node tools/make-untangle.mjs [count]   (count: make only the first levels, for a quick look)
//   node tools/make-untangle.mjs repeats   (only fix repeats in data/untangle-levels.json)
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { availableParallelism, freemem, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { LEVEL_COUNT, PLAN_VERSION, plan, attempt, exactAttempt, levelText, twistyEnough } from '../js/untangle/levels.js'
import { fewestMoves, lowerBound } from '../js/untangle/solver.js'

const CANDIDATES = 150 // tangles tried per level (most levels stop at the first few)
const SOLVES = 8 // how many of the best-looking ones the solver checks
const LIMIT = 25000 // positions the solver may look at before a tangle counts as too slow to check
const SECONDS = 20 // after this long on one level, stop solving and use the proven backup
const WORKER_MB = 1000 // memory cap for each worker (a hard level can use 500 MB-1 GB)
const KEEP_FREE_MB = 3000 // memory always left for the rest of the computer
const LOW_MEMORY_MB = 2500 // below this much free memory, workers wait before starting a level

// avoid: level texts already used by earlier levels (the repeat check); those are skipped and more
// tangles are tried.
export function makeLevel(n, avoid = null) {
  const { target } = plan(n)
  const tries = avoid ? 3000 : CANDIDATES
  const started = Date.now()
  const late = () => Date.now() - started > SECONDS * 1000
  const plain = []
  let best = null
  const solve = (c) => {
    const res = fewestMoves(c.a.state, LIMIT)
    if (!res) return false // too hard to be sure of the fewest: skip it
    const off = Math.abs(res.moves - target)
    if (!best || off < best.off) best = { off, a: c.a, min: res.moves }
    return off === 0
  }
  // Twisty tangles first: each is solved as soon as it's made, until one has exactly the
  // target's fewest moves.
  for (let t = 0; t < tries && !late(); t++) {
    const a = attempt(n, t)
    if (avoid?.has(levelText(a))) continue
    const lb = lowerBound(a.state)
    if (lb < 1 || lb > target) continue
    const c = { a, lb, cross: a.state.word.length }
    if (!twistyEnough(n, a.state)) {
      plain.push(c)
      continue
    }
    if (solve(c)) return { text: levelText(a), min: target, how: 'twisty' }
  }
  // None: the less twisty ones, nearest the target first, then the messier one.
  plain.sort((x, y) => y.lb - x.lb || y.cross - x.cross)
  for (const c of plain.slice(0, SOLVES)) {
    if (late()) break
    if (solve(c)) return { text: levelText(c.a), min: target, how: 'plain' }
  }
  for (let t = 0; t < (plan(n).ropes >= 6 ? 20 : 0); t++) {
    const e = exactAttempt(n, t)
    if (e && !avoid?.has(levelText(e))) return { text: levelText(e), min: target, how: 'proven' }
  }
  if (!best) throw new Error(`level ${n}: nothing found`)
  return { text: levelText(best.a), min: best.min, how: 'nearest' }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Remakes every level that's the same as an earlier one. Returns how many were remade. */
export function fixRepeats(levels, min) {
  const seen = new Set()
  let fixed = 0
  for (let i = 0; i < levels.length; i++) {
    if (seen.has(levels[i])) {
      const r = makeLevel(i + 1, seen)
      console.log(`level ${i + 1} repeated an earlier level; made again (${r.how}, fewest ${r.min})`)
      levels[i] = r.text
      min[i] = r.min
      fixed++
    }
    seen.add(levels[i])
  }
  return fixed
}

if (!isMainThread) {
  for (const n of workerData) {
    while (freemem() / 2 ** 20 < LOW_MEMORY_MB) await sleep(2000)
    parentPort.postMessage({ start: n })
    parentPort.postMessage({ n, ...makeLevel(n) })
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv[2] === 'repeats') {
    const file = join(root, 'data/untangle-levels.json')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const fixed = fixRepeats(data.levels, data.min)
    writeFileSync(file, JSON.stringify(data) + '\n')
    const off = data.min.filter((m, i) => m !== plan(i + 1).target).length
    console.log(`${fixed} repeats made again (${off} levels off their target)`)
    process.exit(0)
  }
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
  try {
    setPriority(19) // lowest priority; the workers share it
  } catch {}
  const byMemory = Math.floor((freemem() / 2 ** 20 - KEEP_FREE_MB) / WORKER_MB)
  const workers = Math.max(1, Math.min(todo.length, Math.floor(availableParallelism() / 2), byMemory))
  console.log(`Using ${workers} of ${availableParallelism()} cores at low priority, up to ${WORKER_MB} MB each`)
  const shares = Array.from({ length: workers }, (_, w) => todo.filter((_, i) => i % workers === w))
  const how = { twisty: 0, plain: 0, proven: 0, nearest: 0 }
  let done = 0
  const started = Date.now()
  const skipped = []
  // One worker for a list of levels; if it runs out of memory, the level it was on is skipped
  // (made on the next run) and a fresh worker carries on with the rest.
  const run = (list) =>
    new Promise((resolve, reject) => {
      let current = null
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: list, resourceLimits: { maxOldGenerationSizeMb: WORKER_MB } })
      worker.on('message', ({ start, n, text, min: m, how: h }) => {
        if (start) return void (current = start)
        current = null
        levels[n - 1] = text
        min[n - 1] = m
        how[h]++
        appendFileSync(progress, JSON.stringify({ n, text, min: m }) + '\n')
        if (++done % 50 === 0) console.log(`${done} made (${Math.round((Date.now() - started) / 1000)} s)`)
      })
      worker.on('error', (err) => {
        if (err.code !== 'ERR_WORKER_OUT_OF_MEMORY' || current == null) return reject(err)
        console.log(`level ${current} ran out of memory; skipped for now`)
        skipped.push(current)
        const rest = list.filter((n) => !levels[n - 1] && n !== current)
        current = null
        run(rest).then(resolve, reject)
      })
      worker.on('exit', (code) => (code ? null : resolve()))
    })
  await Promise.all(shares.map(run))
  if (skipped.length) {
    console.log(`${skipped.length} levels skipped (${skipped.join(', ')}); everything else is saved. Run again to make them.`)
    process.exit(1)
  }
  fixRepeats(levels, min)
  writeFileSync(join(root, 'data/untangle-levels.json'), JSON.stringify({ version: 1, levels, min }) + '\n')
  unlinkSync(progress)
  const off = min.filter((m, i) => m !== plan(i + 1).target).length
  console.log(`Wrote ${count} levels to data/untangle-levels.json in ${Math.round((Date.now() - started) / 1000)} s: ${how.twisty} twisty, ${how.plain} less twisty, ${how.proven} proven, ${how.nearest} nearest (${off} off their target)`)
}
