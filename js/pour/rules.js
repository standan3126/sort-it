// Pour: the rules, with no drawing (works in Node too, for the tests and the level maker).
//
// A board is a list of tubes; a tube is a string of colour letters, bottom first ('' = empty).
// Every tube holds HEIGHT layers. A pour moves the top run of one colour from one tube onto
// another whose top is the same colour (or which is empty), as much as fits.

export const HEIGHT = 4

export const top = (tube) => tube[tube.length - 1]

// How many layers of the top colour sit together at the top.
export function topRun(tube) {
  let n = 0
  for (let k = tube.length - 1; k >= 0 && tube[k] === tube[tube.length - 1]; k--) n++
  return n
}

// A finished tube: full, and all one colour.
export const isComplete = (tube, height = HEIGHT) => tube.length === height && topRun(tube) === height

export const isSolved = (board, height = HEIGHT) => board.every((t) => t === '' || isComplete(t, height))

// How many layers would pour from tube a to tube b (0 = can't).
export function pourAmount(board, a, b, height = HEIGHT) {
  if (a === b) return 0
  const from = board[a]
  const to = board[b]
  if (!from || to.length >= height) return 0
  if (to && top(to) !== top(from)) return 0
  if (isComplete(from, height)) return 0
  return Math.min(topRun(from), height - to.length)
}

// A new board after pouring a into b (assumes pourAmount > 0).
export function pour(board, a, b, height = HEIGHT) {
  const n = pourAmount(board, a, b, height)
  const next = board.slice()
  next[a] = board[a].slice(0, board[a].length - n)
  next[b] = board[b] + top(board[a]).repeat(n)
  return { board: next, amount: n }
}

// Every pour that can be made. Pointless ones (a whole one-colour tube into an empty tube) count
// for being stuck, because the player can still make them.
export function legalMoves(board, height = HEIGHT) {
  const moves = []
  for (let a = 0; a < board.length; a++)
    for (let b = 0; b < board.length; b++) if (pourAmount(board, a, b, height)) moves.push([a, b])
  return moves
}

export const isStuck = (board, height = HEIGHT) => !isSolved(board, height) && legalMoves(board, height).length === 0

// Level text <-> board. Tubes are joined by '|', e.g. "abab|baba||".
export const parseLevel = (text) => text.split('|')
export const levelText = (board) => board.join('|')
