// Makes Pour's 3000 levels: node tools/make-levels.mjs  →  data/pour-levels.json
// Each level is checked by the solver, and its fewest moves are found (A*). The work is shared
// across the computer's cores; every level comes from its own seed, so the result is the same
// however it's split. Existing levels must never change once the game is launched (players'
// progress points at them); new levels are only ever added at the end.
import { writeFileSync, mkdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { LEVEL_COUNT, makeLevel } from '../js/pour/levels.js'
import { levelText } from '../js/pour/rules.js'
import { minMoves } from '../js/pour/solver.js'

if (!isMainThread) {
  // A worker: makes every level it's handed, one at a time.
  for (const n of workerData) {
    const { board } = makeLevel(n)
    const m = minMoves(board)
    if (m == null) throw new Error(`level ${n}: fewest moves not found`)
    parentPort.postMessage({ n, text: levelText(board), min: m })
  }
} else {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const workers = Math.max(1, availableParallelism() - 1)
  const levels = new Array(LEVEL_COUNT)
  const min = new Array(LEVEL_COUNT) // the fewest pours that finish each level (on the done card)
  // Deal levels out in turn, so each worker gets a share of the slow late ones.
  const shares = Array.from({ length: workers }, (_, w) => {
    const list = []
    for (let n = w + 1; n <= LEVEL_COUNT; n += workers) list.push(n)
    return list
  })
  let done = 0
  const started = Date.now()
  await Promise.all(
    shares.map(
      (list) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: list })
          worker.on('message', ({ n, text, min: m }) => {
            levels[n - 1] = text
            min[n - 1] = m
            if (++done % 250 === 0) console.log(`${done} levels made (${Math.round((Date.now() - started) / 1000)} s)`)
          })
          worker.on('error', reject)
          worker.on('exit', (code) => (code ? reject(new Error(`worker stopped (${code})`)) : resolve()))
        }),
    ),
  )
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data/pour-levels.json'), JSON.stringify({ version: 1, height: 4, levels, min }) + '\n')
  console.log(`Wrote ${levels.length} levels to data/pour-levels.json`)
}
