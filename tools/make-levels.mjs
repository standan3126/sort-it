// Makes Pour's 600 levels: node tools/make-levels.mjs  →  data/pour-levels.json
// Each level is checked by the solver, and its fewest moves are found (A*).
// Existing levels must never change once the game is
// launched (players' progress points at them); new levels are only ever added at the end.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVEL_COUNT, makeLevel } from '../js/pour/levels.js'
import { levelText } from '../js/pour/rules.js'
import { minMoves } from '../js/pour/solver.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const levels = []
const min = [] // the fewest pours that finish each level (shown on the done card)
for (let n = 1; n <= LEVEL_COUNT; n++) {
  const { board, d } = makeLevel(n)
  levels.push(levelText(board))
  const m = minMoves(board)
  if (m == null) throw new Error(`level ${n}: fewest moves not found`)
  min.push(m)
  if (n % 50 === 0) console.log(`level ${n}: ${board.length} tubes, tricky ${d}, fewest moves ${m}`)
}
mkdirSync(join(root, 'data'), { recursive: true })
writeFileSync(join(root, 'data/pour-levels.json'), JSON.stringify({ version: 1, height: 4, levels, min }) + '\n')
console.log(`Wrote ${levels.length} levels to data/pour-levels.json`)
