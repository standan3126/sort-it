// Pour's sounds, all made in code and played into the toolbox's "notes" bus, so the game-sounds
// volume, Mute and pausing when the app is hidden work as in every game.
import { INSTRUMENTS } from '/shared/v1/sound/instruments.js'
import { burst, filter, gain, mtof, rand } from '/shared/v1/sound/noise.js'

export class PourSounds {
  constructor(sound) {
    this.sound = sound
    // A sound must never stop the game (2026-11-13: an instrument missing from the live toolbox
    // threw after the last pour, so level 1 never finished). Every sound is wrapped.
    for (const name of ['pour', 'pick', 'drop', 'nope', 'complete', 'win', 'firework', 'stuck']) {
      const play = this[name].bind(this)
      this[name] = (...args) => {
        try {
          play(...args)
        } catch (e) {
          console.warn('Pour sound', name, e)
        }
      }
    }
  }

  get ready() {
    return !!(this.sound.ctx && this.sound.buses)
  }

  out(level = 1) {
    const g = gain(this.sound.ctx, level)
    g.connect(this.sound.buses.notes)
    return g
  }

  now(delay = 0) {
    return this.sound.ctx.currentTime + 0.01 + delay
  }

  // One bubble: a sine whose pitch springs upward, the sound of liquid.
  bubble(when, freq, level) {
    const ctx = this.sound.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, when)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.9, when + 0.06)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(level, when + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.08)
    osc.connect(env).connect(this.out())
    osc.start(when)
    osc.stop(when + 0.1)
  }

  // A pour: a soft stream with bubbles that rise in pitch as the tube fills. Longer for more layers.
  // `fill` is how full the tube is before (0-1), so a nearly full tube sounds higher.
  pour(amount, fill = 0, seconds) {
    if (!this.ready) return
    const ctx = this.sound.ctx
    const t = this.now()
    const len = seconds ?? 0.3 + amount * 0.2
    // The stream: low, soft noise.
    const f = filter(ctx, 'lowpass', 900, 0.8)
    f.frequency.setValueAtTime(600 + fill * 500, t)
    f.frequency.linearRampToValueAtTime(900 + (fill + amount / 4) * 700, t + len)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.16, t + 0.05)
    env.gain.setValueAtTime(0.16, t + len - 0.08)
    env.gain.linearRampToValueAtTime(0, t + len)
    f.connect(env).connect(this.out())
    burst(ctx, t, f, len + 0.05)
    // The bubbles.
    let at = 0.02
    while (at < len) {
      const p = at / len
      const base = 260 + (fill + (p * amount) / 4) * 520
      this.bubble(t + at, base * rand(0.85, 1.2), 0.11 * rand(0.6, 1))
      at += rand(0.035, 0.075)
    }
  }

  // Picking up a tube.
  pick() {
    if (!this.ready) return
    INSTRUMENTS.marimba.play(this.sound.ctx, this.out(0.5), { freq: mtof(79), when: this.now(), vel: 0.6 })
  }

  // Putting it back down without pouring.
  drop() {
    if (!this.ready) return
    INSTRUMENTS.marimba.play(this.sound.ctx, this.out(0.4), { freq: mtof(72), when: this.now(), vel: 0.5 })
  }

  // A pour that can't happen: a soft low knock.
  nope() {
    if (!this.ready) return
    INSTRUMENTS.marimba.play(this.sound.ctx, this.out(0.6), { freq: mtof(50), when: this.now(), vel: 0.6 })
  }

  // A tube finished: a bright little run that climbs higher with each tube done.
  complete(count = 0) {
    if (!this.ready) return
    const t = this.now(0.15)
    const root = 72 + ([0, 2, 4, 7, 9][count % 5] ?? 0)
    ;[0, 4, 7, 12].forEach((step, k) =>
      INSTRUMENTS.musicBox.play(this.sound.ctx, this.out(1.1), { freq: mtof(root + step), when: t + k * 0.07, vel: 0.8 }),
    )
  }

  // The level is done.
  win() {
    if (!this.ready) return
    const t = this.now(0.2)
    const tune = [72, 76, 79, 84, 79, 84, 88]
    const gaps = [0, 0.12, 0.24, 0.36, 0.6, 0.72, 0.84]
    tune.forEach((m, k) => INSTRUMENTS.kalimba.play(this.sound.ctx, this.out(1.2), { freq: mtof(m), when: t + gaps[k], vel: 0.8 }))
  }

  // A firework: a soft pop and a gentle crackle (never loud).
  firework() {
    if (!this.ready) return
    const ctx = this.sound.ctx
    const t = this.now()
    const f = filter(ctx, 'lowpass', 700, 0.7)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.22, t + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    f.connect(env).connect(this.out())
    burst(ctx, t, f, 0.4)
    for (let k = 0; k < 7; k++) {
      const when = t + 0.15 + rand(0, 0.5)
      const c = filter(ctx, 'bandpass', rand(3000, 6000), 6)
      const e = ctx.createGain()
      e.gain.setValueAtTime(0, when)
      e.gain.linearRampToValueAtTime(0.06, when + 0.002)
      e.gain.exponentialRampToValueAtTime(0.0001, when + 0.03)
      c.connect(e).connect(this.out())
      burst(ctx, when, c, 0.05)
    }
  }

  // Stuck: two soft falling notes.
  stuck() {
    if (!this.ready) return
    const t = this.now()
    INSTRUMENTS.marimba.play(this.sound.ctx, this.out(0.7), { freq: mtof(67), when: t, vel: 0.6 })
    INSTRUMENTS.marimba.play(this.sound.ctx, this.out(0.7), { freq: mtof(60), when: t + 0.22, vel: 0.6 })
  }
}
