/**
 * Woni — Pure helpers (no DOM / no Firebase) so they can be unit-tested directly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Unbiased Fisher–Yates shuffle. Returns a new array. */
export function shuffle(items, rand = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Normalise a question's answer to an option letter ('A', 'B', ...).
 * Accepts a bare letter, a prefixed letter ("A)", "(B)", "C. foo", "Option D")
 * or the full option text. Returns null when it cannot be mapped.
 */
export function answerToLetter(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const answer = String(question?.answer ?? '').trim();
  if (!answer) return null;

  // Exact option text first, so an option like "A protein" isn't read as letter A.
  const textIdx = options.findIndex(opt => String(opt).trim().toLowerCase() === answer.toLowerCase());
  if (textIdx >= 0) return String.fromCharCode(65 + textIdx);

  const letterMatch = answer.match(/^(?:option\s*)?\(?([A-Za-z])\)?(?:[.):\s]|$)/i);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return String.fromCharCode(65 + idx);
  }
  return null;
}

/** Start of the local calendar day for a timestamp. */
function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Consecutive-day study streak. Counts back from today (or yesterday, so a
 * streak isn't lost before the user has studied today).
 */
export function computeStreak(timestamps, now = Date.now()) {
  const days = new Set(timestamps.filter(Boolean).map(dayStart));
  let cursor = dayStart(now);
  if (!days.has(cursor)) cursor = dayStart(cursor - DAY_MS / 2);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = dayStart(cursor - DAY_MS / 2);
  }
  return streak;
}

/** Parse "mm:ss" (or "h:mm:ss") into seconds; returns 0 for anything else. */
export function parseDuration(str) {
  const parts = String(str ?? '').split(':').map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** Format seconds as "45m" or "2h 5m". */
export function formatStudyTime(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * SM-2 spaced-repetition update (quality 0–5).
 * https://super-memory.com/english/ol/sm2.htm
 */
export function sm2(quality, { interval = 0, repetition = 0, ease = 2.5 } = {}) {
  ease = ease || 2.5;
  if (quality >= 3) {
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.round(interval * ease);
    repetition++;
  } else {
    repetition = 0;
    interval = 1;
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { interval, repetition, ease };
}

/** Lenient JSON extraction from an LLM response. Returns {} on failure. */
export function parseJSON(raw) {
  try {
    let text = String(raw ?? '').trim();
    if (text.includes('```')) {
      const matches = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (matches && matches[1]) text = matches[1];
      else text = text.replace(/```[a-z]*\n/gi, '').replace(/\n```/g, '');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
    return JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse JSON', e, raw);
    try {
      const startArr = raw.indexOf('[');
      const endArr = raw.lastIndexOf(']');
      if (startArr !== -1 && endArr !== -1) {
        return { questions: JSON.parse(raw.slice(startArr, endArr + 1)) };
      }
    } catch { }
    return {};
  }
}
