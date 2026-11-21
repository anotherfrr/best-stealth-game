// All sound is synthesised with WebAudio oscillators — no audio files, no network. The context
// is created lazily on the first user gesture (autoplay rules), and every effect is a short
// envelope on a sine or triangle wave. Mute is a single gain node.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let stepFlip = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, volume, slideTo) {
    if (!ensure() || muted) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    } catch {
      // Audio is decoration; a failure here must never break the game.
    }
  }

  return {
    unlock() { ensure(); },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
    isMuted() { return muted; },
    /** Soft shoe scuff, alternating pitch so steps do not drone. */
    step(sneak) {
      stepFlip = !stepFlip;
      tone(stepFlip ? 150 : 130, 0.07, 'sine', sneak ? 0.05 : 0.11, 90);
    },
    /** A two-note chime when an artifact is lifted. */
    pickup() {
      tone(660, 0.14, 'triangle', 0.22);
      setTimeout(() => tone(990, 0.2, 'triangle', 0.22), 90);
    },
    /** Rising "?" blip when a guard first gets suspicious. */
    spotted() {
      tone(520, 0.12, 'square', 0.12, 760);
    },
    /** Harsh two-tone alarm when a guard starts the chase. */
    alarm() {
      tone(880, 0.16, 'square', 0.16, 620);
      setTimeout(() => tone(880, 0.16, 'square', 0.16, 620), 180);
    },
    /** Low thud when caught. */
    caught() {
      tone(220, 0.4, 'sawtooth', 0.2, 55);
    },
    /** Level clear: a short rising arpeggio. */
    levelClear() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.2), i * 110));
    },
    /** Win fanfare. */
    win() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.24, 'triangle', 0.22), i * 130));
    },
  };
}
