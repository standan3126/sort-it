// Sort It: the launch page (a card per game), the levels book, Pour (tube colour sort) and
// Untangle (3D ropes; untangle/game.js plays a level, this file keeps its pages and saves).
//   pour/rules.js   the rules (no drawing)      pour/board.js  drawing and the pour animation
//   pour/sounds.js  every sound                 fireworks.js   the end-of-level fireworks
//   data/pour-levels.json  the 600 levels (made by tools/make-levels.mjs, checked by the solver)
import { Book } from '/shared/v1/book.js'
import { gameFrame, setupPage, tapToStart, warmOffline } from '/shared/v1/kit.js'
import { gameStore } from '/shared/v1/save.js'
import { SettingsPanel, toggle } from '/shared/v1/settings.js'
import { Sound } from '/shared/v1/sound/index.js'
import { Fireworks } from './fireworks.js'
import { BoardView, drawMini } from './pour/board.js'
import { isComplete, isSolved, isStuck, parseLevel, pour, pourAmount, top } from './pour/rules.js'
import { PourSounds } from './pour/sounds.js'
import { Untangle, UNDOS as U_UNDOS } from './untangle/game.js'
import { parseLevel as parseUntangle } from './untangle/levels.js'
import { play as playRopes } from './untangle/rules.js'
import { COLORS as ROPE_COLORS } from './untangle/view.js'

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
// untangle: { reached, results: { n: { moves, time, undos, cut } }, run (see untangle/game.js),
//             cutsUsed: Cuts spent so far (one is earned at level 50, 100, 150 ...) }
let usave = store.get('untangle', null) || { reached: 1, results: {}, run: null, cutsUsed: 0 }
const saveUntangle = () => store.set('untangle', usave)
let seenUntangleRules = store.get('seen-untangle-rules', false)
// The chosen card on the launch page.
let game = store.get('game', 'pour') === 'untangle' ? 'untangle' : 'pour'
const saveAll = () => {
  saveGame()
  saveUntangle()
}

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
let ULEVELS = []
let UFEWEST = []
const untangleReady = fetch('data/untangle-levels.json')
  .then((r) => r.json())
  .then((d) => {
    ULEVELS = d.levels
    UFEWEST = d.min
  })
const ucount = () => ULEVELS.length
const cutsEarned = () => Math.floor(usave.reached / 50)
let urun = null // the Untangle level being played (same object as usave.run)
let untangle = null
const cutsLeft = () => Math.max(0, cutsEarned() - (usave.cutsUsed || 0) - (urun?.cuts || 0))

// ---- Sound, Settings, night ----
const sound = new Sound({ notes: 0.8, nature: 0.4, music: 0.3 })
const sounds = new PourSounds(sound)
const panel = new SettingsPanel({
  gameId: GAME_ID,
  store,
  sound,
  // A Challenge game (contract rule 9): livelier music by default than the Cozy games' Quiet
  // Words music. GameHub's or the player's own Music choice still wins.
  defaults: { marks: false, music: 'island' },
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
    fields: [
      { id: 'level', label: 'Pour level', min: 1, get: () => save.reached },
      { id: 'ulevel', label: 'Untangle level', min: 1, get: () => usave.reached },
    ],
    onSet: ({ level, ulevel }) => {
      save.reached = Math.max(1, Math.min(level, levelCount() || 600))
      // The level set by hand is the one Play opens next: a level in progress is let go of
      // (before 2026-11-13 it was kept, so Play still said "Continue level 1").
      if (save.run && save.run.n !== save.reached) save.run = null
      usave.reached = Math.max(1, Math.min(ulevel ?? usave.reached, ucount() || 3000))
      if (usave.run && usave.run.n !== usave.reached) usave.run = null
      saveAll()
      showHome()
      return `Set: Pour level ${save.reached}, Untangle level ${usave.reached}.`
    },
  },
  credits: [
    'Sort It was made for GameHub. Every level is made and checked by our own code.',
    'Every sound and all the music are made in code by the GameHub toolbox.',
    'Untangle’s 3D ropes are drawn with Three.js (MIT licence, © 2010-2022 three.js authors).',
  ],
  beforeExport: () => saveAll(),
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
  // Untangle has its own night: night paintings with fireflies and warm light on the ropes,
  // already without blue, so the filter stays off over it.
  $('night-filter').hidden = !night || !$('untangle-screen').hidden
  untangle?.setNight(night)
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
  // A level saved already solved (it happened when a sound error stopped the game after the
  // last pour, 2026-11-13) is finished now.
  if (isSolved(run.board)) return levelDone()
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
    $('done-replay').dataset.level = String(n)
    $('done').dataset.game = 'pour'
    $('done').hidden = false
    fireworks.show(6)
  }, 700)
}

$('done-next').onclick = () => {
  fireworks.stop()
  $('done').hidden = true
  const next = Number($('done-next').dataset.next)
  if (next) ($('done').dataset.game === 'untangle' ? startUntangle(next) : startLevel(next))
  else showHome()
}
// Replay the level just finished, from the start (a fresh clock and undos), to beat the score.
$('done-replay').onclick = () => {
  fireworks.stop()
  $('done').hidden = true
  const n = Number($('done-replay').dataset.level)
  $('done').dataset.game === 'untangle' ? startUntangle(n, true) : startLevel(n, true)
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

// ---- Untangle ----
// Made the first time Untangle is played (its 3D drawing isn't needed for Pour).
const makeUntangle = () => (untangle ??= new Untangle($('untangle-stage'), $('untangle-scenery'), {
  sounds,
  onMove: () => {
    saveUntangle()
    showUntangleBar()
  },
  onDone: () => untangleDone(),
  onCutMode: (on) => {
    $('cut-note').hidden = !on
    $('u-cut').classList.toggle('cutting', on)
    if (urun) showUntangleBar()
  },
}))

function startUntangle(n, fresh = false) {
  makeUntangle()
  if (!fresh && usave.run?.n === n) urun = usave.run
  else urun = { n, actions: [], moves: 0, undosLeft: U_UNDOS, time: 0, cuts: 0 }
  const r = urun
  usave.run = r
  saveUntangle()
  hideAll()
  urun = r
  $('untangle-screen').hidden = false
  frame.setPage('play')
  applyTheme()
  $('untangle-clock').textContent = clockText(r.time)
  showUntangleBar()
  untangle.load(r, ULEVELS[n - 1]).then(showUntangleBar)
  if (!seenUntangleRules) openUntangleRules()
}

function showUntangleBar() {
  const r = urun
  if (!r) return
  $('untangle-name').textContent = `Level ${r.n}`
  $('untangle-moves').textContent = `${r.moves} move${r.moves === 1 ? '' : 's'}`
  $('u-undo-label').textContent = `Undo · ${r.undosLeft}`
  $('u-undo').disabled = !untangle.canUndo()
  const left = cutsLeft()
  $('u-cut').hidden = !left && !untangle.cutting
  $('u-cut-label').textContent = untangle.cutting ? 'Cancel' : `Cut · ${left}`
  $('u-cut').disabled = untangle.busy || untangle.done
}

$('u-undo').onclick = () => untangle?.undo().then(showUntangleBar)
$('u-cut').onclick = () => {
  if (!urun || untangle.busy || untangle.done) return
  untangle.setCutting(!untangle.cutting)
}
// Restart asks for a second tap (same as Pour). The clock keeps running; Cuts used come back.
let uArmedAt = 0
function disarmU() {
  uArmedAt = 0
  $('u-restart').classList.remove('armed')
  $('u-restart-label').textContent = 'Restart'
}
$('u-restart').onclick = () => {
  if (!urun || untangle.busy) return
  if (Date.now() - uArmedAt > 3000) {
    uArmedAt = Date.now()
    $('u-restart').classList.add('armed')
    $('u-restart-label').textContent = 'Tap again'
    setTimeout(() => Date.now() - uArmedAt >= 3000 && disarmU(), 3100)
    return
  }
  disarmU()
  Object.assign(urun, { actions: [], moves: 0, undosLeft: U_UNDOS, cuts: 0 })
  untangle.restart()
  saveUntangle()
  showUntangleBar()
}

function untangleDone() {
  const r = urun
  const n = r.n
  const used = r.cuts || 0
  const result = { moves: r.moves, time: Math.round(r.time), undos: U_UNDOS - r.undosLeft, cut: used > 0 }
  const best = usave.results[n]
  const rank = (x) => [x.cut ? 1 : 0, x.moves, x.time]
  const better = (a, b) => {
    const [p, q] = [rank(a), rank(b)]
    for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] < q[i]
    return false
  }
  if (!best || better(result, best)) usave.results[n] = result
  usave.cutsUsed = (usave.cutsUsed || 0) + used
  r.cuts = 0 // now counted in cutsUsed
  usave.reached = Math.max(usave.reached, Math.min(n + 1, ucount()))
  usave.run = null
  saveUntangle()
  showUntangleBar()
  setTimeout(() => {
    if (urun !== r) return // left the level meanwhile
    sounds.win()
    $('done-title').textContent = `Level ${n} untangled!`
    const fewest = UFEWEST[n - 1]
    const extra = result.moves - fewest
    $('done-moves').textContent = result.moves
    $('done-min').textContent = fewest
    $('done-score').textContent = used
      ? 'Untangled with a Cut. Try it without one for a Perfect.'
      : extra <= 0
        ? 'Perfect! The fewest moves possible.'
        : `${extra} more than the fewest. Can you match it?`
    $('done-score').classList.toggle('perfect', !used && extra <= 0)
    $('done-time').textContent = clockText(result.time)
    $('done-undos').textContent = `${result.undos} of ${U_UNDOS}`
    $('done-best').textContent = best ? `Your best on this level: ${best.moves} moves${best.cut ? ' (with a Cut)' : ''}` : ''
    const last = n >= ucount()
    $('done-next').textContent = last ? 'Home' : 'Next level'
    $('done-next').dataset.next = last ? '' : String(n + 1)
    $('done-replay').dataset.level = String(n)
    $('done').dataset.game = 'untangle'
    $('done').hidden = false
    fireworks.show(6)
  }, 900)
}

// A small picture for the levels book: each rope a straight line from its top peg to where it
// ends up at the bottom, so the tile shows how crossed the level is.
function drawUntangleTile(tile, n) {
  const locked = n > usave.reached
  tile.disabled = locked
  tile.querySelector('.tile-name').textContent = `Level ${n}`
  const r = usave.results[n]
  const fewest = UFEWEST[n - 1]
  tile.querySelector('.tile-state').textContent = locked
    ? 'Locked'
    : r
      ? r.cut
        ? `${r.moves} moves, with a Cut`
        : r.moves <= fewest
          ? `Perfect · ${r.moves} moves`
          : `${r.moves} moves, fewest ${fewest}`
      : usave.run?.n === n
        ? 'Started'
        : 'New'
  requestAnimationFrame(() => {
    const c = tile.querySelector('.tile-pic')
    const w = (c.width = c.clientWidth * 2)
    const h = (c.height = c.clientHeight * 2)
    const g = c.getContext('2d')
    const lv = parseUntangle(ULEVELS[n - 1])
    const end = playRopes(lv.start, lv.moves)
    const k = lv.start.top.length
    const x = (i) => w * (0.15 + (0.7 * (i + 0.5)) / k)
    g.lineWidth = Math.max(3, w / 40)
    g.lineCap = 'round'
    for (const rope of lv.start.top) {
      g.strokeStyle = '#' + ROPE_COLORS[rope].toString(16).padStart(6, '0')
      g.beginPath()
      g.moveTo(x(rope), h * 0.12)
      g.lineTo(x(end.order.indexOf(rope)), h * 0.88)
      g.stroke()
    }
  })
}

// ---- The clock: counts only while the tubes are in view ----
const clockText = (s) => {
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const inView = () =>
  (run ? !$('play-screen').hidden : urun ? !$('untangle-screen').hidden && !untangle.busy && !untangle.done : false) &&
  document.visibilityState === 'visible' &&
  $('rules').hidden &&
  $('untangle-rules').hidden &&
  $('stuck').hidden &&
  $('done').hidden &&
  !document.querySelector('dialog[open]')
let lastTick = performance.now()
setInterval(() => {
  const now = performance.now()
  if (inView()) {
    const r = run || urun
    r.time += (now - lastTick) / 1000
    $(run ? 'level-clock' : 'untangle-clock').textContent = clockText(r.time)
  }
  lastTick = now
}, 250)
setInterval(() => (run || urun) && saveAll(), 5000)

// ---- Rules ----
function openRules() {
  $('rules').hidden = false
  seenRules = true
  store.set('seen-rules', true)
}
$('rules').onclick = () => ($('rules').hidden = true)
function openUntangleRules() {
  $('untangle-rules').hidden = false
  seenUntangleRules = true
  store.set('seen-untangle-rules', true)
}
$('untangle-rules').onclick = () => ($('untangle-rules').hidden = true)

// ---- Pages ----
const frame = gameFrame({
  onSettings: () => panel.open(),
  beforeExit: () => saveAll(),
  onHome: () => {
    saveAll()
    showHome()
  },
  onHelp: () => (game === 'untangle' ? openUntangleRules() : openRules()),
})

function hideAll() {
  for (const id of ['home', 'book-screen', 'play-screen', 'untangle-screen', 'stuck', 'done', 'rules', 'untangle-rules']) $(id).hidden = true
  fireworks.stop()
  untangle?.stop()
  urun = null
  applyTheme()
}

function showHome() {
  hideAll()
  run = null
  picked = null
  $('home').hidden = false
  frame.setPage('launch')
  const n = save.run?.n ?? save.reached
  $('pour-level').textContent = `Level ${n} of ${levelCount() || 600}`
  const un = usave.run?.n ?? usave.reached
  $('untangle-level').textContent = `Level ${un} of ${ucount() || 3000}`
  for (const g of ['pour', 'untangle']) $(`card-${g}`).setAttribute('aria-checked', String(g === game))
  const s = game === 'untangle' ? usave : save
  const at = s.run?.n ?? s.reached
  $('play').textContent = s.run ? `Continue level ${at}` : s.reached > 1 ? `Play level ${at}` : 'Play'
  $('levels').hidden = s.reached <= 1 && !s.run
}
for (const g of ['pour', 'untangle'])
  $(`card-${g}`).onclick = () => {
    game = g
    store.set('game', g)
    showHome()
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
  count: () => (game === 'untangle' ? ucount() : levelCount()),
  buildTile: (tile) => {
    tile.innerHTML = '<canvas class="tile-pic"></canvas><span class="tile-name"></span><span class="tile-state"></span>'
  },
  drawTile: (tile, n) => {
    if (game === 'untangle') return drawUntangleTile(tile, n)
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
  startLabel: (n) => ((game === 'untangle' ? usave : save).run?.n === n ? `Continue level ${n}` : `Play level ${n}`),
  emptyLabel: 'Pick a level',
  onStart: (n) => (game === 'untangle' ? startUntangle(n) : startLevel(n)),
})

function showBook() {
  hideAll()
  $('book-screen').hidden = false
  $('book-title').textContent = game === 'untangle' ? 'Untangle levels' : 'Pour levels'
  frame.setPage('play') // Home goes back to the launch page
  const s = game === 'untangle' ? usave : save
  book.open(s.run?.n ?? s.reached)
}

$('play').onclick = () => (game === 'untangle' ? startUntangle(usave.run?.n ?? usave.reached) : startLevel(save.run?.n ?? save.reached))
$('levels').onclick = showBook

addEventListener('pagehide', saveAll)
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveAll())
addEventListener('resize', () => !$('untangle-screen').hidden && untangle.resize())

await Promise.all([levelsReady, untangleReady])
showHome()

tapToStart({
  title: 'Sort It',
  subtitle: 'Sorting puzzles.',
  onStart: () => {
    sound.unlock()
    panel.applySound()
  },
})

// Save the whole game for offline play in the background (GameHub's offline helper; the list is
// made when the site is published, so it's missing when played from this computer).
warmOffline('offline-files.json')

// For tests and the phone preview.
window.sortIt = {
  save: () => save, run: () => run, tap, undo, restart, startLevel, levels: () => LEVELS, fewest: () => FEWEST, panel, sound, store, board,
  untangle: { game: () => untangle, save: () => usave, run: () => urun, start: startUntangle, levels: () => ULEVELS, fewest: () => UFEWEST },
}
