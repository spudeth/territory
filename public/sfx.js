// Retro sound effects, made in code (no recordings, so nothing to license). Each sound is a short list of
// numbers that a tiny synthesizer turns into audio, in the spirit of sfxr.
// Works in the browser (as a plain script, window.sfx) and in Node (require), so the sound test page and the
// game use the same sounds.
(function (exports) {
  // One voice:
  //   wave    'square' | 'saw' | 'triangle' | 'sine' | 'noise'
  //   freq    starting pitch in Hz (for noise: how often the noise changes, which sets its color)
  //   slide   pitch change in octaves per second (+ up, - down)
  //   duty    square wave pulse width, 0-1 (0.5 is a plain square)
  //   attack, hold, decay   the volume envelope, in seconds
  //   vol     0-1
  //   steps   [[seconds, ratio], …]: jump the pitch to freq × ratio at that time (arpeggios, two-note sounds)
  //   vib     [depth as a pitch ratio, speed in Hz]
  //   at      start time in seconds, when a sound has several voices
  // A sound is one voice or an array of voices.

  // The events, with options labelled A, B, C for picking on the sound test page.
  const SOUNDS = {
    tap: {
      label: 'Tap on a block', note: 'Same pitch every tap.',
      A: { wave: 'square', freq: 520, duty: 0.25, attack: 0, hold: 0.012, decay: 0.035, vol: 0.45 },
      B: { wave: 'noise', freq: 2400, attack: 0, hold: 0.008, decay: 0.05, vol: 0.5 },
      C: { wave: 'triangle', freq: 880, slide: -2, attack: 0, hold: 0.01, decay: 0.03, vol: 0.6 },
    },
    claim: {
      label: 'You claim a block',
      A: { wave: 'square', freq: 523, duty: 0.5, attack: 0, hold: 0.12, decay: 0.12, vol: 0.4, steps: [[0.06, 1.5], [0.12, 2]] },
      B: { wave: 'square', freq: 988, duty: 0.5, attack: 0, hold: 0.07, decay: 0.2, vol: 0.35, steps: [[0.07, 1.335]] },
      C: { wave: 'triangle', freq: 330, slide: 3.5, attack: 0, hold: 0.06, decay: 0.12, vol: 0.6 },
    },
    taken: {
      label: 'One of your blocks is taken',
      A: { wave: 'square', freq: 440, slide: -3, duty: 0.5, attack: 0, hold: 0.12, decay: 0.15, vol: 0.4 },
      B: [{ wave: 'noise', freq: 900, attack: 0, hold: 0.04, decay: 0.18, vol: 0.5 },
          { wave: 'square', freq: 196, duty: 0.3, attack: 0, hold: 0.05, decay: 0.12, vol: 0.25 }],
      C: { wave: 'square', freq: 392, duty: 0.5, attack: 0, hold: 0.1, decay: 0.15, vol: 0.35, steps: [[0.1, 0.84]] },
    },
    grow: {
      label: 'The map grows',
      A: { wave: 'sine', freq: 400, slide: 2.5, attack: 0.01, hold: 0.05, decay: 0.12, vol: 0.45 },
      B: { wave: 'triangle', freq: 1319, attack: 0, hold: 0.09, decay: 0.08, vol: 0.4, steps: [[0.03, 1.26], [0.06, 1.5]] },
      C: { wave: 'noise', freq: 6000, slide: -1.5, attack: 0.03, hold: 0.03, decay: 0.15, vol: 0.25 },
    },
    achievement: {
      label: 'Achievement earned',
      A: { wave: 'square', freq: 523, duty: 0.5, attack: 0, hold: 0.36, decay: 0.25, vol: 0.38, steps: [[0.09, 1.26], [0.18, 1.5], [0.27, 2]] },
      B: { wave: 'triangle', freq: 784, attack: 0, hold: 0.3, decay: 0.3, vol: 0.6, vib: [0.02, 7], steps: [[0.1, 1.26], [0.2, 1.5]] },
      C: [{ wave: 'saw', freq: 659, attack: 0, hold: 0.08, decay: 0.08, vol: 0.25 },
          { wave: 'saw', freq: 988, attack: 0, hold: 0.25, decay: 0.3, vol: 0.25, vib: [0.015, 6], at: 0.12 }],
    },
    menuOpen: {
      label: 'Menu opens',
      A: { wave: 'square', freq: 440, slide: 3, duty: 0.25, attack: 0, hold: 0.04, decay: 0.05, vol: 0.3 },
      B: { wave: 'triangle', freq: 587, attack: 0, hold: 0.08, decay: 0.05, vol: 0.5, steps: [[0.045, 1.335]] },
    },
    menuClose: {
      label: 'Menu closes',
      A: { wave: 'square', freq: 660, slide: -3, duty: 0.25, attack: 0, hold: 0.04, decay: 0.05, vol: 0.3 },
      B: { wave: 'triangle', freq: 784, attack: 0, hold: 0.08, decay: 0.05, vol: 0.5, steps: [[0.045, 0.75]] },
    },
    button: {
      label: 'Button click',
      A: { wave: 'square', freq: 660, duty: 0.5, attack: 0, hold: 0.015, decay: 0.02, vol: 0.3 },
      B: { wave: 'noise', freq: 4000, attack: 0, hold: 0.005, decay: 0.025, vol: 0.35 },
      C: { wave: 'triangle', freq: 1046, attack: 0, hold: 0.02, decay: 0.03, vol: 0.5 },
    },
    denied: {
      label: "A tap that isn't allowed",
      A: { wave: 'square', freq: 110, duty: 0.5, attack: 0, hold: 0.12, decay: 0.05, vol: 0.35 },
      B: { wave: 'square', freq: 196, duty: 0.25, attack: 0, hold: 0.14, decay: 0.04, vol: 0.3, steps: [[0.07, 0.75]] },
      C: { wave: 'noise', freq: 300, attack: 0, hold: 0.05, decay: 0.08, vol: 0.45 },
    },
    wipe: {
      label: 'You wipe your territory',
      A: { wave: 'noise', freq: 5000, slide: -4, attack: 0, hold: 0.25, decay: 0.45, vol: 0.4 },
      B: { wave: 'square', freq: 784, duty: 0.5, attack: 0, hold: 0.4, decay: 0.15, vol: 0.3, steps: [[0.1, 0.79], [0.2, 0.63], [0.3, 0.5]] },
      C: [{ wave: 'saw', freq: 600, slide: -5, attack: 0, hold: 0.3, decay: 0.2, vol: 0.25 },
          { wave: 'noise', freq: 1500, attack: 0.1, hold: 0.1, decay: 0.3, vol: 0.25 }],
    },
    spawn: {
      label: 'Spawn (setup screen)',
      A: [{ wave: 'saw', freq: 220, slide: 4, attack: 0, hold: 0.18, decay: 0.05, vol: 0.25 },
          { wave: 'square', freq: 880, duty: 0.5, attack: 0, hold: 0.12, decay: 0.2, vol: 0.3, steps: [[0.06, 1.25]], at: 0.2 }],
      B: { wave: 'triangle', freq: 262, slide: 5, attack: 0, hold: 0.25, decay: 0.15, vol: 0.6, vib: [0.03, 18] },
      C: { wave: 'square', freq: 392, duty: 0.5, attack: 0, hold: 0.24, decay: 0.2, vol: 0.32, steps: [[0.08, 1.26], [0.16, 1.5]] },
    },
  };

  // Renders a sound to samples: a Float32Array at `rate` samples per second.
  function render(sound, rate = 44100) {
    const voices = Array.isArray(sound) ? sound : [sound];
    const length = Math.max(...voices.map(v => (v.at ?? 0) + (v.attack ?? 0) + (v.hold ?? 0) + (v.decay ?? 0)));
    const out = new Float32Array(Math.ceil(length * rate) + 1);
    let seed = 0x2f6b1a3d;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
    for (const v of voices) {
      const a = v.attack ?? 0, h = v.hold ?? 0, d = v.decay ?? 0, start = Math.round((v.at ?? 0) * rate);
      const n = Math.ceil((a + h + d) * rate), steps = v.steps ?? [], duty = v.duty ?? 0.5;
      let phase = 0, noise = random();
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        let f = v.freq * 2 ** ((v.slide ?? 0) * t);
        for (const [at, ratio] of steps) if (t >= at) f = v.freq * ratio * 2 ** ((v.slide ?? 0) * t);
        if (v.vib) f *= 1 + v.vib[0] * Math.sin(2 * Math.PI * v.vib[1] * t);
        const last = phase;
        phase = (phase + f / rate) % 1;
        let s;
        switch (v.wave) {
          case 'square': s = phase < duty ? 1 : -1; break;
          case 'saw': s = 2 * phase - 1; break;
          case 'triangle': s = 1 - 4 * Math.abs(phase - 0.5); break;
          case 'sine': s = Math.sin(2 * Math.PI * phase); break;
          default: if (phase < last) noise = random(); s = noise;   // noise: a new random level each period
        }
        const env = t < a ? t / a : t < a + h ? 1 : Math.max(0, 1 - (t - a - h) / d);
        out[start + i] += s * env * (v.vol ?? 0.5);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]);   // soft limit where voices overlap
    return out;
  }

  exports.SOUNDS = SOUNDS;
  exports.render = render;
})(typeof module === 'object' ? module.exports : (window.sfx = {}));
