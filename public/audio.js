// ---------- Sound effects and music ----------
// Sounds come from sfx.js (made in code). Your own sounds play at full volume; other players' taps, claims and
// takes play only near what you're looking at, quieter with distance and panned by where they are on screen.
// A few play at once at most, so a busy map doesn't become noise. Music loops quietly after the first tap or
// click (browsers block sound before that). Volumes and mutes are remembered on this device.
// Works in the browser (window.gameAudio) and in Node (require), where only the pure functions are used.
(function (exports) {
  // The options Xoren picked on the sound test page (Q7). Button wasn't picked, so it stays on A.
  const PICKS = { tap: 'B', claim: 'B', taken: 'A', grow: 'A', achievement: 'B', menuOpen: 'B', menuClose: 'B',
    button: 'A', denied: 'B', wipe: 'A', spawn: 'C' };
  const MUSIC = 'music/keep-your-dream-alive.mp3';   // Music A (CREDITS.md)

  const MAX_VOICES = 6;          // sounds playing at once; other players' sounds are dropped past this
  const HEARING = 1.2;           // how far away others are heard, in half-screen-diagonals from the centre
  const OTHERS_VOLUME = 0.6;     // other players' sounds at the centre of the screen, compared with your own
  const DEFAULTS = { sfx: { volume: 0.7, muted: false }, music: { volume: 0.25, muted: false } };

  // Where another player's sound sits: { gain, pan } for a point (sx, sy) on a w-by-h screen, or null when it's
  // too far to hear. Gain falls off with distance from the centre; pan follows the left-right position.
  function placement(sx, sy, w, h) {
    const half = Math.hypot(w, h) / 2;
    const d = Math.hypot(sx - w / 2, sy - h / 2) / half;
    if (!(d < HEARING)) return null;
    const near = 1 - d / HEARING;
    return { gain: OTHERS_VOLUME * near * near, pan: Math.max(-1, Math.min(1, (sx - w / 2) / (w / 2))) * 0.8 };
  }

  // A 'hit' event is a new tap when crack progress went up; when it went down, the crack is only fading.
  const isTap = (before, after) => after > (before ?? 0);

  exports.PICKS = PICKS;
  exports.placement = placement;
  exports.isTap = isTap;
  if (typeof window === 'undefined') return;

  // ---------- Browser only ----------
  const load = key => {
    try { return { ...DEFAULTS[key], ...JSON.parse(localStorage.getItem('territory-' + key) || '{}') }; } catch { return { ...DEFAULTS[key] }; }
  };
  const settings = { sfx: load('sfx'), music: load('music') };
  let ctx = null, sfxBus, musicBus, musicStarted = false;
  const buffers = {}, playing = new Set();

  const level = key => settings[key].muted ? 0 : settings[key].volume;
  function applyLevels() {
    if (sfxBus) sfxBus.gain.value = level('sfx');
    if (musicBus) musicBus.gain.value = level('music');
  }

  // Starts audio on the first tap or click, then the music.
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      sfxBus = ctx.createGain(); sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.connect(ctx.destination);
      applyLevels();
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (!musicStarted) { musicStarted = true; startMusic(); }
  }
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);

  async function startMusic() {
    try {
      const buf = await ctx.decodeAudioData(await (await fetch(MUSIC)).arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(musicBus);
      src.start();
    } catch { musicStarted = false; }   // try again on the next tap
  }

  function buffer(event) {
    const option = PICKS[event];
    if (!buffers[event]) {
      const data = sfx.render(sfx.SOUNDS[event][option], ctx.sampleRate);
      buffers[event] = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffers[event].getChannelData(0).set(data);
    }
    return buffers[event];
  }

  // Plays one sound. at: { sx, sy } screen position of another player's sound (omit for your own).
  function play(event, at) {
    if (!ctx || ctx.state !== 'running' || !level('sfx')) return;
    let gain = 1, pan = 0;
    if (at) {
      const p = placement(at.sx, at.sy, innerWidth, innerHeight);
      if (!p || playing.size >= MAX_VOICES) return;
      ({ gain, pan } = p);
    } else if (playing.size >= MAX_VOICES) {
      const oldest = playing.values().next().value;   // your own sounds always play: make room
      try { oldest.stop(); } catch {}
      playing.delete(oldest);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer(event);
    let node = src;
    if (gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; node.connect(g); node = g; }
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
    node.connect(sfxBus);
    playing.add(src);
    src.onended = () => playing.delete(src);
    src.start();
  }

  function set(key, change) {
    Object.assign(settings[key], change);
    try { localStorage.setItem('territory-' + key, JSON.stringify(settings[key])); } catch {}
    applyLevels();
  }

  Object.assign(exports, { play, set, settings });
})(typeof module === 'object' ? module.exports : (window.gameAudio = {}));
