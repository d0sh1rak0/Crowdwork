/** Living house audience — idle motion, laughs when you lose the room. */

import { createRoomAudio } from "./room-audio.js";

const NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Riley",
  "Casey",
  "Morgan",
  "Quinn",
  "Avery",
  "Drew",
  "Sage",
  "Reese",
  "Blake",
];

const SKIN_TONES = [
  "#c4a484",
  "#dbb896",
  "#8d5524",
  "#e0ac69",
  "#a67c52",
  "#f1c27d",
  "#6b3f2a",
  "#ffdbac",
];
const SHIRTS = [
  "#2a2d33",
  "#3a3028",
  "#243044",
  "#35282e",
  "#2c3326",
  "#403528",
  "#1e2430",
];

const REACTIONS = {
  pause: [
    "…",
    "waiting",
    "phone check",
    "hmm",
  ],
  filler: [
    "um?",
    "heh",
    "ouch",
    "again?",
  ],
  lose: [
    "hehe",
    "ha",
    "lol",
    "giggle",
    "lost them",
  ],
  recover: [
    "shhh",
    "back",
    "listening",
    "ok go",
  ],
  murmur: ["whisper", "…", "side chat"],
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

function personSVG(skin, shirt) {
  return `
    <svg class="person-svg" viewBox="0 0 64 80" aria-hidden="true">
      <ellipse class="shoulder" cx="32" cy="62" rx="22" ry="14" fill="${shirt}"/>
      <circle class="head" cx="32" cy="28" r="14" fill="${skin}"/>
      <g class="eyes">
        <ellipse cx="27" cy="27" rx="1.6" ry="2" fill="#1a1208"/>
        <ellipse cx="37" cy="27" rx="1.6" ry="2" fill="#1a1208"/>
      </g>
      <path class="mouth" d="M27 34 Q32 36 37 34" fill="none" stroke="#1a1208" stroke-width="1.4" stroke-linecap="round"/>
      <g class="phone" opacity="0">
        <rect x="38" y="40" width="10" height="18" rx="2" fill="#0d0d0f" stroke="#555" stroke-width="0.6"/>
        <rect x="39.2" y="42" width="7.6" height="12" rx="0.8" fill="#4a7ab5"/>
        <circle cx="43" cy="55.5" r="1.1" fill="#888"/>
      </g>
      <g class="laugh-marks" opacity="0">
        <text x="46" y="22" font-size="10" fill="#F2A33C">ha</text>
      </g>
    </svg>`;
}

export function createAudienceEngine({
  attentionFill,
  attentionValue,
  attentionLabel,
  audienceRow,
  reactionHost,
  houseEl,
  memberCount = 12,
  levelConfig = null,
}) {
  const level = levelConfig || {
    startAttention: 84,
    pauseDecay: 0.65,
    rushPenalty: 5,
    fillerPenalty: 5,
    steadyBonus: 4,
    difficultyMult: 1,
  };
  let attention = level.startAttention;
  let silenceMs = 0;
  let speakingMsWindow = 0;
  let lastReactionAt = 0;
  let lastRecoverAt = 0;
  let lastLoseAt = 0;
  let lastClearBonusAt = 0;
  let pauseLatched = false;
  let samples = [];
  let events = { pauses: 0, fillers: 0, laughs: 0 };
  let prevMood = "listening";
  let lifeTimer = null;
  const roomAudio = createRoomAudio();

  audienceRow.innerHTML = "";
  if (houseEl) houseEl.dataset.mood = "listening";

  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const el = document.createElement("div");
    const skin = SKIN_TONES[i % SKIN_TONES.length];
    const shirt = SHIRTS[i % SHIRTS.length];
    const name = NAMES[i % NAMES.length];
    const delay = (i * 0.17).toFixed(2);
    el.className = "house-person mood-listening";
    el.style.setProperty("--idle-delay", `${delay}s`);
    el.style.setProperty("--idle-dur", `${3.2 + (i % 5) * 0.35}s`);
    el.dataset.name = name;
    el.innerHTML = `
      ${personSVG(skin, shirt)}
      <span class="person-chip" hidden>${name}</span>
    `;
    audienceRow.appendChild(el);
    members.push({
      el,
      bias: ((i % 5) - 2) * 4,
      restless: 0,
    });
  }

  function clamp(n) {
    return Math.max(0, Math.min(100, n));
  }

  function pushReaction(kind, detail) {
    const now = performance.now();
    if (now - lastReactionAt < 700) return;
    lastReactionAt = now;
    const text = detail || pick(REACTIONS[kind] || REACTIONS.murmur);

    const bubble = document.createElement("div");
    bubble.className = `house-bubble reaction-${kind}`;
    bubble.textContent = text;
    // Spawn above a random person in the house
    const idx = Math.floor(Math.random() * members.length);
    const pct = ((idx + 0.5) / members.length) * 100;
    bubble.style.left = `calc(${pct}% - 18px)`;
    bubble.style.bottom = `${58 + Math.random() * 28}px`;
    reactionHost.appendChild(bubble);
    requestAnimationFrame(() => bubble.classList.add("show"));
    setTimeout(() => {
      bubble.classList.remove("show");
      setTimeout(() => bubble.remove(), 240);
    }, 1800);
  }

  function setPersonMood(member, mood) {
    const { el } = member;
    el.className = `house-person mood-${mood}`;
    const mouth = el.querySelector(".mouth");
    if (mouth) {
      if (mood === "locked") mouth.setAttribute("d", "M27 33.5 Q32 37 37 33.5");
      else if (mood === "listening" || mood === "engaged")
        mouth.setAttribute("d", "M27 34 Q32 36 37 34");
      else if (mood === "expectant")
        mouth.setAttribute("d", "M29 34 Q32 35 35 34");
      else if (mood === "confused" || mood === "drifting")
        mouth.setAttribute("d", "M28 35 H36");
      else if (mood === "restless" || mood === "heckle" || mood === "checked")
        mouth.setAttribute("d", "M27 36 Q32 33 37 36");
      else mouth.setAttribute("d", "M28 35 H36");
    }
    el.classList.toggle(
      "on-phone",
      mood === "checked" || mood === "restless" || mood === "heckle"
    );
    el.classList.toggle("is-watch", mood === "restless" || mood === "heckle");
    el.classList.toggle("is-confused", mood === "confused" || mood === "expectant");
  }

  /** Silence Sentinel — hesitation: soft nudge, not a meter dump */
  function onHesitationWarning() {
    attention = clamp(attention - 2.5);
    attentionFill.dataset.mood = "drifting";
    attentionLabel.textContent = "Hesitation";
    attentionLabel.dataset.mood = "drifting";
    if (houseEl) houseEl.dataset.mood = "confused";
    members.forEach((m, i) => {
      setPersonMood(m, i % 2 === 0 ? "confused" : "expectant");
      m.restless = Math.min(14, m.restless + 1);
      if (i % 3 === 0) m.el.classList.add("on-phone");
    });
    pushReaction("pause", pick(["…", "waiting", "phone?", "hmm"]));
    roomAudio.setTension(0.45);
    renderAttention();
  }

  /**
   * Gemini / Silence Sentinel priority override.
   * @param {"RESTLESS"|"HECKLE"|"CONFUSED"|"EXPECTANT"|string} crowdState
   * @param {{ heckleLine?: string, stageDirection?: string }} [meta]
   */
  function applyCrowdState(crowdState, meta = {}) {
    const state = String(crowdState || "RESTLESS").toUpperCase();
    const map = {
      RESTLESS: "restless",
      HECKLE: "heckle",
      CONFUSED: "confused",
      EXPECTANT: "expectant",
    };
    const mood = map[state] || "restless";

    if (state === "HECKLE" || state === "RESTLESS") {
      attention = clamp(attention - (state === "HECKLE" ? 8 : 5));
      events.pauses += 1;
      triggerGiggleWave(state === "HECKLE");
    } else {
      attention = clamp(attention - 2);
    }

    if (houseEl) {
      houseEl.dataset.mood = mood;
      houseEl.classList.add("house-override");
      setTimeout(() => houseEl.classList.remove("house-override"), 1800);
    }

    members.forEach((m, i) => {
      const local =
        mood === "heckle"
          ? i % 3 === 0
            ? "heckle"
            : "restless"
          : mood;
      setPersonMood(m, local);
      m.el.classList.add("is-sigh");
      setTimeout(() => m.el.classList.remove("is-sigh"), 900);
    });

    if (meta.heckleLine) {
      pushReaction("lose", meta.heckleLine.slice(0, 42));
    } else if (meta.stageDirection) {
      pushReaction("murmur", meta.stageDirection.slice(0, 36));
    } else {
      pushReaction("pause", pick(["sigh", "watch check", "restless", "come on"]));
    }

    roomAudio.setTension(state === "HECKLE" ? 1 : 0.85);
    renderAttention();
  }

  function triggerGiggleWave(strong = false) {
    const now = performance.now();
    if (now - lastLoseAt < (strong ? 2200 : 1600)) return;
    lastLoseAt = now;
    events.laughs += 1;

    const count = strong
      ? 4 + Math.floor(Math.random() * 4)
      : 2 + Math.floor(Math.random() * 3);
    const shuffled = [...members].sort(() => Math.random() - 0.5).slice(0, count);

    shuffled.forEach((m, i) => {
      setTimeout(() => {
        m.el.classList.add(strong ? "is-laughing" : "is-giggling");
        pushReaction("lose", strong ? pick(["ha", "hah", "lol"]) : pick(["heh", "hehe", "hih"]));
        setTimeout(() => {
          m.el.classList.remove("is-laughing", "is-giggling");
        }, strong ? 1400 : 900);
      }, i * (120 + Math.random() * 160));
    });

    if (strong) roomAudio.laugh();
    else roomAudio.giggle();

    if (houseEl) {
      houseEl.classList.add(strong ? "house-roar" : "house-titter");
      setTimeout(
        () => houseEl.classList.remove("house-roar", "house-titter"),
        strong ? 1200 : 800
      );
    }
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
      checked: "Lost the room",
    };
    attentionLabel.textContent = labels[mood];
    attentionLabel.dataset.mood = mood;

    if (houseEl) {
      houseEl.dataset.mood = mood;
      houseEl.style.setProperty("--room-energy", String((100 - attention) / 100));
    }

    // Tension for ambient murmur
    const tension =
      mood === "checked" ? 0.9 : mood === "drifting" ? 0.55 : mood === "listening" ? 0.2 : 0.08;
    roomAudio.setTension(tension);

    members.forEach((m) => {
      const local = moodFromAttention(attention + m.bias - m.restless);
      setPersonMood(m, local);
      const onPhone =
        local === "checked" ||
        (local === "drifting" && m.restless > 2) ||
        (local === "listening" && m.restless > 7 && Math.random() < 0.02);
      m.el.classList.toggle("on-phone", onPhone);
      m.el.classList.toggle(
        "is-bored",
        local === "drifting" || local === "checked"
      );
      m.el.classList.toggle(
        "is-look-away",
        local === "checked" || (local === "drifting" && m.restless > 5)
      );
    });

    // Crossing into lose-the-room triggers laughs
    if (mood === "checked" && prevMood !== "checked") {
      triggerGiggleWave(true);
    } else if (mood === "drifting" && prevMood === "listening") {
      // early restless giggles
      if (Math.random() < 0.55) triggerGiggleWave(false);
    } else if (
      (mood === "listening" || mood === "locked") &&
      (prevMood === "drifting" || prevMood === "checked")
    ) {
      const now = performance.now();
      if (now - lastRecoverAt > 3500) {
        lastRecoverAt = now;
        roomAudio.hush();
        pushReaction("recover");
        members.forEach((m) => m.el.classList.add("is-leaning"));
        setTimeout(() => {
          members.forEach((m) => m.el.classList.remove("is-leaning"));
        }, 900);
      }
    }
    prevMood = mood;
  }

  function lifeTick() {
    // Micro-behaviors so the house never feels frozen
    const mood = moodFromAttention(attention);
    members.forEach((m, i) => {
      if (Math.random() < 0.12) {
        m.el.classList.add("is-shift");
        setTimeout(() => m.el.classList.remove("is-shift"), 500);
      }
      if (mood === "drifting" || mood === "checked") {
        m.restless = Math.min(14, m.restless + (Math.random() < 0.45 ? 1 : 0));
        // Pull phones more aggressively when bored
        if (Math.random() < (mood === "checked" ? 0.55 : 0.28)) {
          m.el.classList.add("on-phone");
        }
        if (mood === "checked" && i % 3 === 0 && Math.random() < 0.25) {
          m.el.classList.add("is-arms-crossed");
          setTimeout(() => m.el.classList.remove("is-arms-crossed"), 1800);
        }
      } else if (mood === "listening") {
        m.restless = Math.max(0, m.restless - 0.25);
      } else {
        m.restless = Math.max(0, m.restless - 0.55);
        m.el.classList.remove("on-phone", "is-bored", "is-look-away");
      }
    });

    // Soft ceiling — don’t pin forever at 100, but don’t bleed while strong
    if (attention >= 96) {
      attention = clamp(attention - 0.2);
    } else if (attention >= 90 && mood === "locked") {
      attention = clamp(attention - 0.08);
    }

    if (mood === "checked" && Math.random() < 0.4) {
      triggerGiggleWave(Math.random() < 0.45);
      if (Math.random() < 0.35) {
        pushReaction("lose", pick(["phone out", "scrolling", "checked out", "lol"]));
      }
    } else if (mood === "drifting" && Math.random() < 0.22) {
      triggerGiggleWave(false);
      pushReaction("murmur", pick(["phone?", "whisper", "side chat", "…"]));
    }

    renderAttention();
  }

  /**
   * Ambient mic level is visualization-only now.
   * Attention / crowd penalties come from Whisper text metrics (≥1.5s pause).
   */
  function onAudioLevel(_level, _dtMs) {
    /* no-op for attention — kept for API compatibility */
  }

  /** Precise text-gap pause from Whisper (≥ pause threshold, throttled ~1/sec). */
  function onTextPause(pauseMs) {
    if (pauseMs < 4000) return;
    if (!pauseLatched) {
      pauseLatched = true;
      events.pauses += 1;
      attention = clamp(attention - 2);
      pushReaction("pause", pick(["…", "waiting", "phone check", "go on?"]));
      members.forEach((m, i) => {
        if (i % 4 === 0) m.el.classList.add("on-phone");
      });
    } else {
      // Ongoing decay — once per throttled callback (~1/s)
      attention = clamp(attention - level.pauseDecay);
      if (pauseMs >= 6000 && attention < 55) {
        members.forEach((m) => {
          if (Math.random() < 0.35) m.el.classList.add("on-phone", "is-bored");
        });
      }
      if (pauseMs >= 7000 && pauseMs < 7200 && attention < 48) {
        triggerGiggleWave(false);
      }
    }
    silenceMs = pauseMs;
    renderAttention();
  }

  function onSpeechResume() {
    if (pauseLatched) {
      pauseLatched = false;
      const now = performance.now();
      if (now - lastRecoverAt > 2200) {
        lastRecoverAt = now;
        pushReaction("recover");
        roomAudio.hush();
        attention = clamp(attention + 3);
        members.forEach((m) => {
          m.el.classList.remove("on-phone", "is-bored", "is-look-away");
        });
      }
    }
    silenceMs = 0;
    speakingMsWindow = 0;
    renderAttention();
  }

  function onFillerHit(word) {
    events.fillers += 1;
    attention = clamp(attention - level.fillerPenalty);
    pushReaction("filler", word ? `“${word}”` : undefined);
    // Negative crowd shift: look away / cross arms
    members.forEach((m, i) => {
      if (i % 3 === 0) {
        m.el.classList.add("is-look-away", "is-arms-crossed");
        setTimeout(() => {
          m.el.classList.remove("is-look-away", "is-arms-crossed");
        }, 1200);
      }
    });
    if (attention < 45) triggerGiggleWave(attention < 30);
    renderAttention();
  }

  /** High-velocity panic > rush threshold */
  function onRushed(wpm) {
    attention = clamp(attention - level.rushPenalty);
    if (houseEl) houseEl.dataset.delivery = "rushed";
    members.forEach((m) => {
      m.el.classList.add("is-lean-back");
      setTimeout(() => m.el.classList.remove("is-lean-back"), 1400);
    });
    pushReaction("lose", wpm ? `${wpm} wpm` : "too fast");
    roomAudio.setTension(0.55);
    renderAttention();
  }

  /** Flat delivery — boredom / yawn */
  function onMonotone() {
    attention = clamp(attention - 3);
    if (houseEl) houseEl.dataset.delivery = "monotone";
    members.forEach((m, i) => {
      m.el.classList.add("is-bored");
      if (i % 4 === 0) m.el.classList.add("is-yawn");
      setTimeout(() => {
        m.el.classList.remove("is-bored", "is-yawn");
      }, 1600);
    });
    pushReaction("murmur", pick(["yawn", "flat", "zoning out", "zzz"]));
    roomAudio.setTension(0.35);
    renderAttention();
  }

  function onGoodStretch() {
    attention = clamp(attention + 3);
    if (houseEl) houseEl.dataset.delivery = "steady";
    renderAttention();
  }

  /** Sustained healthy WPM across a sampling block */
  function onSteadyPacing(wpm) {
    attention = clamp(attention + level.steadyBonus);
    if (houseEl) houseEl.dataset.delivery = "steady";
    members.forEach((m) => {
      m.el.classList.remove(
        "is-look-away",
        "is-arms-crossed",
        "is-lean-back",
        "is-bored"
      );
      m.el.classList.add("is-engaged");
      setTimeout(() => m.el.classList.remove("is-engaged"), 1200);
    });
    pushReaction("recover", wpm ? `${wpm} wpm` : "steady pace");
    roomAudio.setTension(0.15);
    renderAttention();
  }

  /** Confident STT — modest, throttled so the meter doesn’t pin at 100. */
  function onClearSpeech() {
    const now = performance.now();
    if (now - lastClearBonusAt < 3200) {
      members.forEach((m) => {
        m.el.classList.remove("is-confused", "is-arms-crossed");
      });
      return;
    }
    lastClearBonusAt = now;
    attention = clamp(attention + 2);
    if (houseEl) houseEl.dataset.delivery = "steady";
    members.forEach((m, i) => {
      m.el.classList.remove(
        "is-look-away",
        "is-arms-crossed",
        "is-confused",
        "on-phone",
        "is-bored"
      );
      if (i % 2 === 0) m.el.classList.add("is-welcoming");
      setTimeout(() => m.el.classList.remove("is-welcoming"), 1100);
    });
    renderAttention();
  }

  /** Mic energy but empty / junk STT */
  function onUnclearSpeech() {
    attention = clamp(attention - 1.5);
    if (houseEl) houseEl.dataset.delivery = "unclear";
    members.forEach((m, i) => {
      if (i % 3 === 0) {
        m.el.classList.add("is-confused", "on-phone");
        setTimeout(() => {
          m.el.classList.remove("is-confused");
        }, 1200);
      }
    });
    pushReaction("confused", pick(["huh?", "say again?", "muddy", "lost it"]));
    renderAttention();
  }

  function onTooSlow(wpm) {
    attention = clamp(attention - 2.5);
    if (houseEl) houseEl.dataset.delivery = "slow";
    members.forEach((m, i) => {
      m.el.classList.add("is-bored");
      if (i % 3 === 0) m.el.classList.add("on-phone");
      setTimeout(() => m.el.classList.remove("is-bored"), 1600);
    });
    pushReaction("murmur", wpm ? `${wpm} wpm` : "too slow");
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
      laughs: events.laughs,
      mood: moodFromAttention(attention),
    };
  }

  function reset() {
    attention = level.startAttention;
    silenceMs = 0;
    speakingMsWindow = 0;
    pauseLatched = false;
    samples = [];
    events = { pauses: 0, fillers: 0, laughs: 0 };
    prevMood = "listening";
    reactionHost.innerHTML = "";
    members.forEach((m) => {
      m.restless = 0;
      m.el.classList.remove("is-laughing", "is-giggling", "is-leaning", "on-phone");
    });
    renderAttention();
  }

  function start() {
    roomAudio.resume();
    if (lifeTimer) clearInterval(lifeTimer);
    lifeTimer = setInterval(lifeTick, 1600);
    renderAttention();
  }

  function stop() {
    if (lifeTimer) clearInterval(lifeTimer);
    lifeTimer = null;
    roomAudio.stop();
  }

  renderAttention();

  return {
    onAudioLevel,
    onTextPause,
    onSpeechResume,
    onFillerHit,
    onRushed,
    onMonotone,
    onGoodStretch,
    onSteadyPacing,
    onClearSpeech,
    onUnclearSpeech,
    onTooSlow,
    onHesitationWarning,
    applyCrowdState,
    getSnapshot,
    reset,
    start,
    stop,
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
