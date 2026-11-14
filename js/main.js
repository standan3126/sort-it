// Sort It: the launch page, the levels book, and Pour (tube colour sort).
//   pour/rules.js   the rules (no drawing)      pour/board.js  drawing and the pour animation
//   pour/sounds.js  every sound                 fireworks.js   the end-of-level fireworks
//   data/pour-levels.json  the 600 levels (made by tools/make-levels.mjs, checked by the solver)
import { Book } from '/shared/v1/book.js'
import { gameFrame, setupPage, tapToStart } from '/shared/v1/kit.js'
import { gameStore } from '/shared/v1/save.js'
import { SettingsPanel, toggle } from '/shared/v1/settings.js'
import { Sound } from '/shared/v1/sound/index.js'
import { Fireworks } from './fireworks.js'
import { BoardView, drawMini } from './pour/board.js'
import { isComplete, isSolved, isStuck, parseLevel, pour, pourAmount, top } from './pour/rules.js'
import { PourSounds } from './pour/sounds.js'

const GAME_ID = 'sort-it'
const UNDOS = 5 // undos each level
const store = gameStore(GAME_ID)
const $ = (id) => document.getElementById(id)

setupPage()

// ---- Saved progress ----
// pour: { reached: the furthest level open, results: { n: { moves, time, undos } } (best per level),
//         run: the level being played { n, board, history: [[a, b, amount]], moves, undosLeft, time } }
let save = store.get('pour', null) || { reached: 1, results: {}, run: null }
const saveGame = () => store.set('pour', save)
let seenRules = store.get('seen-rules', false)

// ---- Levels ----
let LEVELS = []
let FEWEST = [] // the fewest pours that finish each level (found by the level maker)
const levelsReady = fetch('data/pour-levels.json')
  .then((r) => r.json())
  .then((d) => {
    LEVELS = d.levels
    FEWEST = d.min
  })
const levelCount = () => LEVELS.length

// ---- Sound, Settings, night ----
const sound = new Sound({ notes: 0.8, nature: 0.4, music: 0.3 })
const sounds = new PourSounds(sound)
const panel = new SettingsPanel({
  gameId: GAME_ID,
  store,
  sound,
  defaults: { marks: false },
  sections: [
    {
      title: 'Pour',
      build: (el, panel) =>
        el.append(
          toggle({
            label: 'Colour marks',
            hint: 'A small shape on each colour, so colours can be told apart without seeing colour.',
            checked: panel.settings.marks,
            onToggle: (marks) => panel.set({ marks }),
          }),
        ),
    },
  ],
  manual: {
    fields: [{ id: 'level', label: 'Pour level', min: 1, get: () => save.reached }],
    onSet: ({ level }) => {
      save.reached = Math.max(1, Math.min(level, levelCount() || 600))
      // The level set by hand is the one Play opens next: a level in progress is let go of
      // (before 2026-11-13 it was kept, so Play still said "Continue level 1").
      if (save.run && save.run.n !== save.reached) save.run = null
      saveGame()
      if ($('play-screen').hidden || run?.n !== save.reached) showHome()
      return `Set: Pour level ${save.reached}.`
    },
  },
  credits: [
    'Sort It was made for GameHub. Every level is made and checked by our own code.',
    'Every sound and all the music are made in code by the GameHub toolbox. Nothing is borrowed.',
  ],
  beforeExport: () => saveGame(),
  onRestore: () => location.reload(),
  onChange: () => {
    applyTheme()
    board.marks = !!panel.settings.marks
    board.draw()
  },
})

function applyTheme() {
  const night = panel.night
  document.documentElement.dataset.theme = night ? 'night' : 'day'
  $('night-filter').hidden = !night
}

// ---- The board ----
const board = new BoardView($('board'), { onTap: (i) => tap(i) })
board.marks = !!panel.settings.marks
applyTheme()

let run = null // the level being played (same object as save.run)
let picked = null
let busy = false // during a pour

function startLevel(n, fresh = false) {
  if (!fresh && save.run?.n === n) run = save.run
  else run = { n, board: parseLevel(LEVELS[n - 1]), history: [], moves: 0, undosLeft: UNDOS, time: 0 }
  save.run = run
  saveGame()
  picked = null
  busy = false
  board.anim = null
  board.glow.clear()
  board.sparks = []
  showPlay()
  board.set(run.board)
  showBar()
  if (isStuck(run.board)) showStuck()
}

function showBar() {
  $('level-name').textContent = `Level ${run.n}`
  $('undo-label').textContent = `Undo · ${run.undosLeft}`
  $('undo').disabled = !run.history.length || run.undosLeft <= 0
  disarmRestart()
}

async function tap(i) {
  if (!run || busy || !$('stuck').hidden || !$('done').hidden) return
  const tubes = run.board
  if (picked == null) {
    if (!tubes[i] || isComplete(tubes[i])) return sounds.nope()
    picked = i
    sounds.pick()
    board.set(tubes, { picked })
    return
  }
  if (picked === i) {
    picked = null
    sounds.drop()
    board.set(tubes)
    return
  }
  const amount = pourAmount(tubes, picked, i)
  if (!amount) {
    // Can't pour there: pick that tube up instead, if it can be.
    if (tubes[i] && !isComplete(tubes[i])) {
      picked = i
      sounds.pick()
    } else sounds.nope()
    board.set(tubes, { picked })
    return
  }
  const from = picked
  picked = null
  busy = true
  const seconds = 0.3 + amount * 0.18
  const color = top(tubes[from])
  const fill = tubes[i].length / 4
  setTimeout(() => sounds.pour(amount, fill, seconds), 200)
  board.picked = null
  await board.pour(from, i, amount, color, seconds)
  run.board = pour(tubes, from, i).board
  run.history.push([from, i, amount])
  run.moves++
  saveGame()
  board.set(run.board)
  busy = false
  showBar()
  if (isComplete(run.board[i])) {
    board.finished(i)
    sounds.complete(run.board.filter((t) => isComplete(t)).length - 1)
  }
  if (isSolved(run.board)) return levelDone()
  if (isStuck(run.board)) showStuck()
}

function undo() {
  if (!run || busy || !run.history.length || run.undosLeft <= 0) return
  const [a, b, amount] = run.history.pop()
  const tubes = run.board.slice()
  const color = top(tubes[b])
  tubes[b] = tubes[b].slice(0, tubes[b].length - amount)
  tubes[a] = tubes[a] + color.repeat(amount)
  run.board = tubes
  run.undosLeft--
  picked = null
  board.glow.delete(b)
  saveGame()
  board.set(run.board)
  sounds.drop()
  showBar()
}

// Restart asks for a second tap, so a stray tap can't throw a level away.
let armedAt = 0
function disarmRestart() {
  armedAt = 0
  $('restart').classList.remove('armed')
  $('restart-label').textContent = 'Restart'
}
function restart(confirmed = false) {
  if (!run || busy) return
  if (!confirmed && Date.now() - armedAt > 3000) {
    armedAt = Date.now()
    $('restart').classList.add('armed')
    $('restart-label').textContent = 'Tap again'
    setTimeout(() => Date.now() - armedAt >= 3000 && disarmRestart(), 3100)
    return
  }
  const time = run.time // the clock keeps running across restarts of the same level
  startLevel(run.n, true)
  run.time = time
  saveGame()
}

function showStuck() {
  sounds.stuck()
  const left = run.undosLeft
  $('stuck-text').textContent = left
    ? `You have ${left} undo${left === 1 ? '' : 's'} left, or start the level again.`
    : 'No undos left. Start the level again: Restart is free.'
  $('stuck-undo').hidden = !left || !run.history.length
  $('stuck').hidden = false
}

// ---- Level done ----
const fireworks = new Fireworks($('fireworks'), { onBurst: () => sounds.firework() })

function levelDone() {
  const n = run.n
  const result = { moves: run.moves, time: Math.round(run.time), undos: UNDOS - run.undosLeft }
  const best = save.results[n]
  if (!best || result.moves < best.moves || (result.moves === best.moves && result.time < best.time)) save.results[n] = result
  save.reached = Math.max(save.reached, Math.min(n + 1, levelCount()))
  save.run = null
  saveGame()
  run = null
  setTimeout(() => {
    sounds.win()
    $('done-title').textContent = `Level ${n} done!`
    const fewest = FEWEST[n - 1]
    const extra = result.moves - fewest
    $('done-moves').textContent = result.moves
    $('done-min').textContent = fewest
    $('done-score').textContent =
      extra <= 0 ? 'Perfect! The fewest moves possible.' : `${extra} more than the fewest. Can you match it?`
    $('done-score').classList.toggle('perfect', extra <= 0)
    $('done-time').textContent = clockText(result.time)
    $('done-undos').textContent = `${result.undos} of ${UNDOS}`
    $('done-best').textContent = best ? `Your best on this level: ${best.moves} moves` : ''
    const last = n >= levelCount()
    $('done-next').textContent = last ? 'Home' : `Next level`
    $('done-next').dataset.next = last ? '' : String(n + 1)
    $('done').hidden = false
    fireworks.show(6)
  }, 700)
}

$('done-next').onclick = () => {
  fireworks.stop()
  $('done').hidden = true
  const next = Number($('done-next').dataset.next)
  if (next) startLevel(next)
  else showHome()
}
$('done-home').onclick = () => {
  fireworks.stop()
  $('done').hidden = true
  showHome()
}
$('stuck-undo').onclick = () => {
  $('stuck').hidden = true
  undo()
}
$('stuck-restart').onclick = () => {
  $('stuck').hidden = true
  restart(true)
}
$('undo').onclick = undo
$('restart').onclick = () => restart()

// ---- The clock: counts only while the tubes are in view ----
const clockText = (s) => {
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const inView = () =>
  run &&
  !$('play-screen').hidden &&
  document.visibilityState === 'visible' &&
  $('rules').hidden &&
  $('stuck').hidden &&
  $('done').hidden &&
  !document.querySelector('dialog[open]')
let lastTick = performance.now()
setInterval(() => {
  const now = performance.now()
  if (inView()) {
    run.time += (now - lastTick) / 1000
    $('level-clock').textContent = clockText(run.time)
  }
  lastTick = now
}, 250)
setInterval(() => run && saveGame(), 5000)

// ---- Rules ----
function openRules() {
  $('rules').hidden = false
  seenRules = true
  store.set('seen-rules', true)
}
$('rules').onclick = () => ($('rules').hidden = true)

// ---- Pages ----
const frame = gameFrame({
  onSettings: () => panel.open(),
  beforeExit: () => saveGame(),
  onHome: () => {
    saveGame()
    showHome()
  },
  onHelp: openRules,
})

function hideAll() {
  for (const id of ['home', 'book-screen', 'play-screen', 'stuck', 'done', 'rules']) $(id).hidden = true
  fireworks.stop()
}

function showHome() {
  hideAll()
  run = null
  picked = null
  $('home').hidden = false
  frame.setPage('launch')
  const n = save.run?.n ?? save.reached
  $('pour-level').textContent = `Level ${n} of ${levelCount() || 600}`
  $('play').textContent = save.run ? `Continue level ${n}` : save.reached > 1 ? `Play level ${n}` : 'Play'
  $('levels').hidden = save.reached <= 1 && !save.run
}

function showPlay() {
  hideAll()
  $('play-screen').hidden = false
  frame.setPage('play')
  $('level-clock').textContent = clockText(run.time)
  board.resize()
  if (!seenRules) openRules()
}

// The levels book: six a page; levels not reached yet are locked.
const book = new Book({
  root: $('book'),
  perPage: 6,
  count: () => levelCount(),
  buildTile: (tile) => {
    tile.innerHTML = '<canvas class="tile-pic"></canvas><span class="tile-name"></span><span class="tile-state"></span>'
  },
  drawTile: (tile, n) => {
    const locked = n > save.reached
    tile.disabled = locked
    tile.querySelector('.tile-name').textContent = `Level ${n}`
    const r = save.results[n]
    tile.querySelector('.tile-state').textContent = locked
      ? 'Locked'
      : r
        ? r.moves <= FEWEST[n - 1]
          ? `Perfect · ${r.moves} moves`
          : `${r.moves} moves, fewest ${FEWEST[n - 1]}`
        : save.run?.n === n
          ? 'Started'
          : 'New'
    requestAnimationFrame(() => drawMini(tile.querySelector('.tile-pic'), parseLevel(LEVELS[n - 1])))
  },
  startLabel: (n) => (save.run?.n === n ? `Continue level ${n}` : `Play level ${n}`),
  emptyLabel: 'Pick a level',
  onStart: (n) => startLevel(n),
})

function showBook() {
  hideAll()
  $('book-screen').hidden = false
  frame.setPage('play') // Home goes back to the launch page
  book.open(save.run?.n ?? save.reached)
}

$('play').onclick = () => startLevel(save.run?.n ?? save.reached)
$('levels').onclick = showBook

addEventListener('pagehide', saveGame)
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveGame())

await levelsReady
showHome()

tapToStart({
  title: 'Sort It',
  subtitle: 'Sorting puzzles.',
  onStart: () => {
    sound.unlock()
    panel.applySound()
  },
})

// For tests and the phone preview.
window.sortIt = { save: () => save, run: () => run, tap, undo, restart, startLevel, levels: () => LEVELS, fewest: () => FEWEST, panel, sound, store, board }
