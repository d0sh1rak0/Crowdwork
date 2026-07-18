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
        <rect x="40" y="44" width="8" height="14" rx="1.5" fill="#111"/>
        <rect x="41" y="45.5" width="6" height="9" rx="0.5" fill="#3a4a5a"/>
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
}) {
  let attention = 78;
  let silenceMs = 0;
  let speakingMsWindow = 0;
  let lastReactionAt = 0;
  let lastRecoverAt = 0;
  let lastLoseAt = 0;
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
    // Spawn near a random restless person
    const anchor = pick(members).el;
    const rect = audienceRow.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
    bubble.style.left = `${Math.max(8, aRect.left - rect.left + aRect.width / 2 - 18)}px`;
    bubble.style.bottom = `${rect.bottom - aRect.top + 6}px`;
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
    // mouth path by mood
    const mouth = el.querySelector(".mouth");
    if (mouth) {
      if (mood === "locked") mouth.setAttribute("d", "M27 33.5 Q32 37 37 33.5");
      else if (mood === "listening") mouth.setAttribute("d", "M27 34 Q32 36 37 34");
      else if (mood === "drifting") mouth.setAttribute("d", "M28 35 H36");
      else mouth.setAttribute("d", "M27 36 Q32 33 37 36");
    }
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
      m.el.classList.toggle("on-phone", local === "checked" || (local === "drifting" && m.restless > 4));
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
    members.forEach((m) => {
      if (Math.random() < 0.08) {
        m.el.classList.add("is-shift");
        setTimeout(() => m.el.classList.remove("is-shift"), 500);
      }
      if (mood === "drifting" || mood === "checked") {
        m.restless = Math.min(12, m.restless + (Math.random() < 0.3 ? 1 : 0));
      } else {
        m.restless = Math.max(0, m.restless - 0.4);
      }
    });

    if (mood === "checked" && Math.random() < 0.35) {
      triggerGiggleWave(Math.random() < 0.4);
    } else if (mood === "drifting" && Math.random() < 0.18) {
      triggerGiggleWave(false);
      pushReaction("murmur");
    }

    renderAttention();
  }

  function onAudioLevel(level, dtMs) {
    const speaking = level > 0.045;
    if (speaking) {
      silenceMs = 0;
      speakingMsWindow += dtMs;
      attention = clamp(attention + dtMs * 0.0045);
      if (pauseLatched && speakingMsWindow > 600) {
        pauseLatched = false;
        const now = performance.now();
        if (now - lastRecoverAt > 4000) {
          lastRecoverAt = now;
          pushReaction("recover");
          roomAudio.hush();
        }
      }
    } else {
      speakingMsWindow = 0;
      silenceMs += dtMs;
      if (silenceMs > 1200) {
        attention = clamp(attention - dtMs * 0.013);
      }
      if (silenceMs > 1800 && !pauseLatched) {
        pauseLatched = true;
        events.pauses += 1;
        attention = clamp(attention - 7);
        pushReaction("pause");
        if (attention < 50) triggerGiggleWave(attention < 35);
      }
      if (silenceMs > 4000) {
        attention = clamp(attention - dtMs * 0.022);
      }
    }
    renderAttention();
  }

  function onFillerHit(word) {
    events.fillers += 1;
    attention = clamp(attention - 9);
    pushReaction("filler", word ? `“${word}”` : undefined);
    if (attention < 60) triggerGiggleWave(attention < 40);
    renderAttention();
  }

  function onGoodStretch() {
    attention = clamp(attention + 2.5);
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
    attention = 78;
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
    onFillerHit,
    onGoodStretch,
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
