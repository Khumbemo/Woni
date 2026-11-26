/**
 * Woni — other question formats, made from the multiple-choice questions in
 * the bank (pure functions):
 *   tf     True or false: "Q — proposed answer: X. Is that right?"
 *   typed  Type the answer (for short answers), checked leniently
 *   match  Match 3-4 questions to their answers
 *   multi  Select every statement (question + answer pair) that is true
 */
import { answerToLetter } from './utils.js';

export const MIXED_SIZE = 10;
const KIND_ORDER = ['tf', 'typed', 'multi', 'tf', 'match', 'typed', 'tf', 'multi', 'typed', 'match'];
const SHORT = 40;   // longest answer people can reasonably type
const MATCH_MAX = 60;

/** The correct option's text, or null if the question's answer doesn't match an option. */
export function correctText(q) {
  const letter = answerToLetter(q);
  if (!letter) return null;
  const text = (q.options || [])[letter.charCodeAt(0) - 65];
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function wrongTexts(q) {
  const right = correctText(q);
  return (q.options || []).map(o => String(o || '').trim()).filter(o => o && o !== right);
}

const usable = q => q && !q.flagged && correctText(q) && wrongTexts(q).length > 0;

function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeTrueFalse(q, rand = Math.random) {
  if (!usable(q)) return null;
  const truth = rand() < 0.5;
  const wrong = wrongTexts(q);
  const proposed = truth ? correctText(q) : wrong[Math.floor(rand() * wrong.length)];
  return { kind: 'tf', q, proposed, truth, topic: q.topic };
}

export function makeTyped(q) {
  if (!usable(q)) return null;
  const answer = correctText(q);
  if (answer.length > SHORT || /^(all|none|both|neither)\b|of the above/i.test(answer)) return null;
  return { kind: 'typed', q, answer, topic: q.topic };
}

/** Match 3-4 questions with distinct short answers. */
export function makeMatch(qs, rand = Math.random) {
  const seen = new Set();
  const pairs = [];
  for (const q of qs) {
    if (!usable(q)) continue;
    const a = correctText(q);
    const key = normalise(a);
    if (a.length > MATCH_MAX || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ q, prompt: q.text, answer: a });
    if (pairs.length === 4) break;
  }
  if (pairs.length < 3) return null;
  return { kind: 'match', pairs, choices: shuffled(pairs.map(p => p.answer), rand), topic: pairs[0].q.topic };
}

/** Four question → answer statements from different questions; at least one true and one false. */
export function makeMulti(qs, rand = Math.random) {
  const pool = qs.filter(usable).slice(0, 4);
  if (pool.length < 4) return null;
  const truths = pool.map(() => rand() < 0.5);
  if (truths.every(Boolean)) truths[Math.floor(rand() * 4)] = false;
  if (!truths.some(Boolean)) truths[Math.floor(rand() * 4)] = true;
  const statements = pool.map((q, i) => {
    const wrong = wrongTexts(q);
    return { q, answer: truths[i] ? correctText(q) : wrong[Math.floor(rand() * wrong.length)], truth: truths[i] };
  });
  return { kind: 'multi', statements, topic: pool[0].topic };
}

/** Lower-case, accents and punctuation removed, single spaces. */
export function normalise(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Is a typed answer right? Ignores case, accents, punctuation, spacing and a
 * leading "the"/"a"/"an". Typos are forgiven only in longer answers (1 for
 * 8-11 letters, 2 for 12+), because short terms often differ by one letter
 * (lipase/ligase, IgG/IgA). Numbers must match exactly, and an answer that is
 * one of the question's wrong options is always wrong.
 */
export function checkTyped(input, answer, wrongOptions = []) {
  const strip = s => normalise(s).replace(/^(the|a|an) /, '');
  const a = strip(input), b = strip(answer);
  if (!a || !b) return false;
  if (a === b) return true;
  if (wrongOptions.some(w => strip(w) === a)) return false;
  const digits = s => (s.match(/\d+/g) || []).join(',');
  if (digits(a) !== digits(b)) return false;
  const allowed = b.length < 8 ? 0 : b.length < 12 ? 1 : 2;
  return editDistance(a, b) <= allowed;
}

/** Wrong options of a question (for checkTyped). */
export function wrongOptions(q) {
  return wrongTexts(q);
}

/**
 * A practice session of `n` items in mixed formats. Formats that can't be made
 * from the available questions fall back to true/false. Each question is used
 * at most once.
 */
export function buildMixedSession(questions, n = MIXED_SIZE, rand = Math.random) {
  let pool = shuffled((questions || []).filter(usable), rand);
  const items = [];
  const take = k => pool.splice(0, k);
  for (let i = 0; items.length < n && pool.length > 0; i++) {
    const kind = KIND_ORDER[i % KIND_ORDER.length];
    let item = null;
    if (kind === 'typed') {
      const idx = pool.findIndex(q => makeTyped(q));
      if (idx >= 0) item = makeTyped(pool.splice(idx, 1)[0]);
    } else if (kind === 'match' && pool.length >= 3) {
      const made = makeMatch(pool, rand);
      if (made) {
        item = made;
        pool = pool.filter(q => !made.pairs.some(p => p.q === q));
      }
    } else if (kind === 'multi' && pool.length >= 4) {
      item = makeMulti(pool, rand);
      if (item) pool = pool.filter(q => !item.statements.some(s => s.q === q));
    }
    if (!item) item = makeTrueFalse(take(1)[0], rand);
    if (item) items.push(item);
  }
  return items;
}
