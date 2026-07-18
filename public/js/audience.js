/** Live attention meter + audience reactions to pauses and parasite words. */

const MOODS = ["locked", "listening", "drifting", "checked"];

const REACTIONS = {
  pause: [
    "They're waiting…",
    "Silence stretches",
    "Someone glances at their phone",
    "A few seats shift",
    "Eyes wander",
  ],
  filler: [
    "Heard a filler",
    "That “um” landed",
    "Parasite word spotted",
    "Audience winces",
    "Focus dips",
  ],
  recover: [
    "They're back with you",
    "Heads lift",
    "Good pace",
    "Room leans in",
  ],
  speak: ["Listening", "With you", "Locked in"],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function moodFromAttention(score) {
  if (score >= 75) return "locked";
  if (score >= 55) return "listening";
  if (score >= 35) return "drifting";
  return "checked";
}

function faceForMood(mood) {
  switch (mood) {
    case "locked":
      return "◉";
    case "listening":
      return "◍";
    case "drifting":
      return "◌";
    default:
      return "·";
  }
}

export function createAudienceEngine({
  attentionFill,
  attentionValue,
  attentionLabel,
  audienceRow,
  reactionHost,
  memberCount = 7,
}) {
  let attention = 78;
  let silenceMs = 0;
  let speakingMsWindow = 0;
  let lastReactionAt = 0;
  let lastRecoverAt = 0;
  let pauseLatched = false;
  let samples = [];
  let events = { pauses: 0, fillers: 0 };

  // Build audience seats
  audienceRow.innerHTML = "";
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const el = document.createElement("div");
    el.className = "audience-member mood-listening";
    el.innerHTML = `<span class="face">${faceForMood("listening")}</span>`;
    audienceRow.appendChild(el);
    members.push(el);
  }

  function clamp(n) {
    return Math.max(0, Math.min(100, n));
  }

  function pushReaction(kind, detail) {
    const now = performance.now();
    if (now - lastReactionAt < 900) return;
    lastReactionAt = now;
    const text =
      detail ||
      pick(REACTIONS[kind] || REACTIONS.speak);

    const bubble = document.createElement("div");
    bubble.className = `reaction-bubble reaction-${kind}`;
    bubble.textContent = text;
    reactionHost.appendChild(bubble);
    requestAnimationFrame(() => bubble.classList.add("show"));
    setTimeout(() => {
      bubble.classList.remove("show");
      setTimeout(() => bubble.remove(), 220);
    }, 2200);
  }

  function renderAttention() {
    attention = clamp(attention);
    samples.push(attention);
    if (samples.length > 600) samples.shift();

    const mood = moodFromAttention(attention);
    attentionFill.style.height = `${attention}%`;
    attentionFill.dataset.mood = mood;
    attentionValue.textContent = `${Math.round(attention)}`;
    const labels = {
      locked: "Locked in",
      listening: "Listening",
      drifting: "Drifting",
      checked: "Checked out",
    };
    attentionLabel.textContent = labels[mood];
    attentionLabel.dataset.mood = mood;

    members.forEach((el, i) => {
      // Stagger moods slightly so the row feels alive
      const jitter = ((i % 3) - 1) * 6;
      const localMood = moodFromAttention(attention + jitter);
      el.className = `audience-member mood-${localMood}`;
      el.querySelector(".face").textContent = faceForMood(localMood);
    });
  }

  function onAudioLevel(level, dtMs) {
    // level 0..1
    const speaking = level > 0.045;
    if (speaking) {
      silenceMs = 0;
      speakingMsWindow += dtMs;
      attention = clamp(attention + dtMs * 0.004);
      if (pauseLatched && speakingMsWindow > 600) {
        pauseLatched = false;
        const now = performance.now();
        if (now - lastRecoverAt > 4000) {
          lastRecoverAt = now;
          pushReaction("recover");
        }
      }
    } else {
      speakingMsWindow = 0;
      silenceMs += dtMs;
      // Natural breath < 1.2s is fine; longer pauses hurt attention
      if (silenceMs > 1200) {
        attention = clamp(attention - dtMs * 0.012);
      }
      if (silenceMs > 1800 && !pauseLatched) {
        pauseLatched = true;
        events.pauses += 1;
        attention = clamp(attention - 6);
        pushReaction("pause");
      }
      if (silenceMs > 4000) {
        attention = clamp(attention - dtMs * 0.02);
      }
    }
    renderAttention();
  }

  function onFillerHit(word) {
    events.fillers += 1;
    attention = clamp(attention - 8);
    pushReaction("filler", word ? `“${word}” landed soft` : undefined);
    renderAttention();
  }

  function onGoodStretch() {
    attention = clamp(attention + 2);
    renderAttention();
  }

  function getSnapshot() {
    const avg =
      samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : attention;
    return {
      attention: Math.round(attention),
      averageAttention: Math.round(avg),
      peakAttention: Math.round(Math.max(...samples, attention)),
      lowAttention: Math.round(Math.min(...samples, attention)),
      pauses: events.pauses,
      fillerHits: events.fillers,
      mood: moodFromAttention(attention),
    };
  }

  function reset() {
    attention = 78;
    silenceMs = 0;
    speakingMsWindow = 0;
    pauseLatched = false;
    samples = [];
    events = { pauses: 0, fillers: 0 };
    reactionHost.innerHTML = "";
    renderAttention();
  }

  renderAttention();

  return {
    onAudioLevel,
    onFillerHit,
    onGoodStretch,
    getSnapshot,
    reset,
    MOODS,
  };
}

export function createAudioMonitor(stream, onLevel) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !stream?.getAudioTracks?.().length) {
    return { stop() {}, resume() {} };
  }

  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  let running = true;
  let last = performance.now();
  let raf = 0;

  function tick(now) {
    if (!running) return;
    const dt = now - last;
    last = now;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    onLevel(rms, dt);
    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);

  return {
    async resume() {
      if (ctx.state === "suspended") await ctx.resume();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
        analyser.disconnect();
        ctx.close();
      } catch {
        /* ignore */
      }
    },
  };
}
