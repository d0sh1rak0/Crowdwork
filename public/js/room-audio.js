/** Lightweight Web Audio ambience: room hush, murmurs, giggles, laughs. */

function preferReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

export function createRoomAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || preferReducedMotion()) {
    return {
      resume: async () => {},
      setTension: () => {},
      giggle: () => {},
      laugh: () => {},
      hush: () => {},
      stop: () => {},
    };
  }

  let ctx = null;
  let master = null;
  let murmurGain = null;
  let murmurNodes = [];
  let tension = 0; // 0 calm … 1 lost the room

  function ensure() {
    if (ctx) return;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    murmurGain = ctx.createGain();
    murmurGain.gain.value = 0.02;
    murmurGain.connect(master);

    // Soft filtered noise as room presence
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    noise.connect(filter);
    filter.connect(murmurGain);
    noise.start();
    murmurNodes = [noise, filter];
  }

  function tone(freq, dur, type, gainVal, dest) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gainVal, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function giggleBurst(intensity = 0.5) {
    ensure();
    const base = 380 + Math.random() * 220;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (!ctx) return;
        tone(
          base + i * 40 + Math.random() * 30,
          0.07 + Math.random() * 0.05,
          "triangle",
          0.04 * intensity,
          master
        );
        tone(
          base * 1.5 + Math.random() * 20,
          0.05,
          "sine",
          0.025 * intensity,
          master
        );
      }, i * (70 + Math.random() * 40));
    }
  }

  function laughBurst(intensity = 0.8) {
    ensure();
    const base = 220 + Math.random() * 80;
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (!ctx) return;
        tone(
          base + Math.sin(i) * 30 + Math.random() * 25,
          0.1 + Math.random() * 0.08,
          i % 2 ? "triangle" : "sine",
          0.055 * intensity,
          master
        );
      }, i * (95 + Math.random() * 50));
    }
    // low chuckle undercurrent
    setTimeout(() => {
      if (!ctx) return;
      tone(110 + Math.random() * 20, 0.35, "sine", 0.03 * intensity, master);
    }, 40);
  }

  return {
    async resume() {
      ensure();
      if (ctx.state === "suspended") await ctx.resume();
    },
    setTension(t) {
      ensure();
      tension = Math.max(0, Math.min(1, t));
      if (!murmurGain) return;
      const now = ctx.currentTime;
      // Louder restless murmur as you lose the room
      murmurGain.gain.cancelScheduledValues(now);
      murmurGain.gain.linearRampToValueAtTime(0.015 + tension * 0.07, now + 0.25);
    },
    giggle() {
      giggleBurst(0.55 + tension * 0.3);
    },
    laugh() {
      laughBurst(0.75 + tension * 0.25);
    },
    hush() {
      ensure();
      if (!murmurGain) return;
      const now = ctx.currentTime;
      murmurGain.gain.cancelScheduledValues(now);
      murmurGain.gain.linearRampToValueAtTime(0.012, now + 0.4);
    },
    stop() {
      try {
        murmurNodes.forEach((n) => {
          try {
            n.stop?.();
          } catch {
            /* ignore */
          }
        });
        ctx?.close();
      } catch {
        /* ignore */
      }
      ctx = null;
      master = null;
      murmurGain = null;
      murmurNodes = [];
    },
  };
}
