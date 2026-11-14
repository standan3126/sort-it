# Sort It

Sorting puzzles in GameHub. The first game is **Pour**: pour coloured liquid between tubes until
every tube holds just one colour.

- 3000 levels in one line, getting harder as they go: 2 colours at level 1, 12 from level 420,
  then trickier mixes, the climb slowing as the levels go up.
  Every level is checked by our own solver, which also finds its fewest possible moves.
- 5 undos a level, no hints; Restart is always free. A clock counts up while you play.
- When a level is done: your moves next to the fewest possible, your time and undos used.
- No ads, no lives, no purchases, no countdowns.

Play: https://standan3126.github.io/sort-it/ (best inside GameHub: https://standan3126.github.io/)

| File | What it holds |
|---|---|
| `index.html`, `css/game.css` | Screens and looks (black, white glass, bright colours; a warm filter at night) |
| `js/main.js` | Launch page, levels, the play screen, undo and restart, clock, saves, settings |
| `js/pour/rules.js` | Pour's rules |
| `js/pour/solver.js` | A solver (proves each level can be done) and a fewest-moves search |
| `js/pour/levels.js`, `tools/make-levels.mjs` | How the levels are made → `data/pour-levels.json` |
| `js/pour/board.js` | Drawing the tubes and the pour |
| `js/pour/sounds.js`, `js/fireworks.js` | Sounds (made in code) and the end-of-level fireworks |

```
npm install
npm run serve     # http://localhost:4240/sort-it/  (phone preview: /tools/phone.html)
npm test          # rules and all 3000 levels, then the game at three phone sizes
npm run levels    # remake the levels (same every time; uses every core, a few minutes)
```

Uses the GameHub toolbox (`/shared/v1/`) from
[standan3126.github.io](https://github.com/standan3126/standan3126.github.io).
