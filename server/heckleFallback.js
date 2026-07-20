/**
 * Local heckle lines that mock the speaker's recent words (no AI required).
 */

function recentPhrase(transcript, maxWords = 6) {
  const words = String(transcript || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return "";
  return words.slice(-Math.min(maxWords, words.length)).join(" ");
}

/**
 * @param {{ transcript?: string, language?: string, slideScript?: string }} opts
 */
export function buildMockHeckle(opts = {}) {
  const ru = opts.language === "ru";
  const phrase = recentPhrase(opts.transcript, 6);
  const scriptBit = recentPhrase(opts.slideScript, 4);

  if (phrase) {
    const templates = ru
      ? [
          `«${phrase}» — и это ваш питч? Серьёзно?`,
          `Повторите: «${phrase}». Звучит слабо.`,
          `«${phrase}» — инвесторы уже зевают.`,
          `Ой, «${phrase}». Так вы и продаёте?`,
        ]
      : [
          `"${phrase}" — that's your pitch? Seriously?`,
          `Say "${phrase}" again. Sounds thin.`,
          `"${phrase}" — investors already checked out.`,
          `Oh, "${phrase}." That's how you sell it?`,
        ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (scriptBit) {
    return ru
      ? `Где «${scriptBit}»? Мы ждём доказательств.`
      : `Where's "${scriptBit}"? We're waiting on proof.`;
  }

  const generic = ru
    ? [
        "Тишина. Повторите мысль — громче и яснее.",
        "Мы вас слушаем — или вы уже закончили?",
        "Мёртвый эфир. Где следующий тезис?",
      ]
    : [
        "Dead air. Replay that point — louder, clearer.",
        "We're listening — or did you already quit?",
        "Still with us? Hit the next beat.",
      ];
  return generic[Math.floor(Math.random() * generic.length)];
}
