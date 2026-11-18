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

/**
 * Stores that sync to the cloud.
 * - autoKey: local keys are auto-incremented (device-specific), so they never
 *   leave the device; otherwise `key` names the meaningful key field.
 * - binary: the record's `data` (an ArrayBuffer) goes to Cloud Storage and
 *   Firestore keeps only the metadata.
 */
export const SYNC_STORES = {
  papers: { autoKey: true },
  questions: { autoKey: true },
  flashcards: { autoKey: true },
  mock_tests: { autoKey: true },
  topics: { autoKey: false, key: 'id' },
  progress: { autoKey: false, key: 'id' },
  chat_history: { autoKey: false, key: 'exam' },
  library: { autoKey: true, binary: true },
};

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Older browsers (Safari < 15.4): RFC 4122 v4 from getRandomValues.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable cross-device id for a record; also its Firestore document id. */
export function makeSyncId(store, record, uuid = randomId) {
  const cfg = SYNC_STORES[store];
  if (cfg && !cfg.autoKey && record[cfg.key] != null) {
    // Same topic on two devices must map to the same document. Encoding keeps '/' out of the doc id.
    return `${store}:${encodeURIComponent(String(record[cfg.key]))}`;
  }
  return uuid();
}

/**
 * Decide what to upload and download for one store. Newest `updatedAt` wins.
 * @param local       every local record (each has syncId, updatedAt)
 * @param cloud       cloud records changed since lastSync
 * @param lastSync    ms timestamp of the previous successful sync (0 = never)
 */
export function planSync(local, cloud, lastSync = 0) {
  const localById = new Map(local.map(r => [r.syncId, r]));
  const cloudById = new Map(cloud.map(r => [r.syncId, r]));
  const push = local.filter(r =>
    (r.updatedAt || 0) > lastSync && !((cloudById.get(r.syncId)?.updatedAt || 0) > (r.updatedAt || 0)));
  const pull = cloud.filter(r =>
    !((localById.get(r.syncId)?.updatedAt || 0) >= (r.updatedAt || 0)));
  return { push, pull };
}

/**
 * jsPDF's built-in fonts only cover Latin-1 (WinAnsi). Spell out the Greek
 * letters and symbols common in science questions, and replace anything
 * else outside Latin-1 with '?', instead of printing garbage.
 */
const PDF_REPLACEMENTS = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta',
  'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi',
  'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma',
  'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
  '→': '->', '←': '<-', '↔': '<->', '⇌': '<=>', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=',
  '≈': '~', '∞': 'infinity', '−': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
};
export function toPdfText(str) {
  return Array.from(String(str ?? ''), ch => {
    if (PDF_REPLACEMENTS[ch] !== undefined) return PDF_REPLACEMENTS[ch];
    return ch.codePointAt(0) <= 0xff ? ch : '?';
  }).join('');
}

/**
 * Topic mastery after a practice session: the first session sets it
 * directly; later sessions are an exponentially weighted average, so recent
 * performance counts most without one session erasing the history.
 */
export function updateMastery(previous, attempts, sessionScore, weight = 0.4) {
  if (!attempts || previous == null) return Math.round(sessionScore);
  return Math.round(previous * (1 - weight) + sessionScore * weight);
}

/** ArrayBuffer -> base64 (chunked so large files don't overflow the call stack). */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 -> ArrayBuffer. */
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Lower-case words of a text, without punctuation (keeps letters and digits in any script). */
export function words(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Whether a question the AI returned actually appears in the paper text.
 * True if its source quote is found verbatim (ignoring case, spacing and
 * punctuation), or if nearly all of the question's longer words occur in the paper.
 */
export function foundInPaper(question, paperText) {
  const paper = words(paperText);
  if (paper.length === 0) return true; // nothing to check against
  const flat = ' ' + paper.join(' ') + ' ';
  const quote = words(question.source);
  if (quote.length >= 4 && flat.includes(' ' + quote.join(' ') + ' ')) return true;
  const vocab = new Set(paper);
  const key = words(question.text).filter(w => w.length >= 4);
  if (key.length === 0) return false;
  return key.filter(w => vocab.has(w)).length / key.length >= 0.8;
}

// --- Long papers -------------------------------------------------------------

// "12.", "Q12)", "Q. 12:", "Question 12." at the start of a line or after a space.
const QUESTION_START = /(?:^|\s)(?:Q\.\s*|Q(?=\d)|Question\s*)?\d{1,3}\s*[.):]\s/gi;

/**
 * Split a paper into pieces of about `size` characters, cutting just before a
 * question number where possible (else at a space), so no question is split.
 */
export function splitIntoChunks(text, size = 6000) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length > size) {
    let cut = -1;
    QUESTION_START.lastIndex = 0;
    // Look a little past the limit: a question number that starts before it counts.
    const lookahead = rest.slice(0, size + 20);
    for (let m; (m = QUESTION_START.exec(lookahead));) {
      if (m.index >= size * 0.5 && m.index <= size) cut = m.index;
    }
    const window = rest.slice(0, size);
    if (cut <= 0) cut = window.lastIndexOf(' ') > size * 0.5 ? window.lastIndexOf(' ') : size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * The paper's answer key, if it has one: text from an "Answer key" heading in
 * the second half of the paper, up to `max` characters. Sent with every part
 * so questions far from the key still get its answers.
 */
export function findAnswerKey(text, max = 3000) {
  const t = String(text || '');
  const re = /\b(answer\s*key|key\s*to\s*answers|answer\s*sheet|answers\s*key)\b/gi;
  let last = -1;
  for (let m; (m = re.exec(t));) last = m.index;
  if (last < 0 || last < t.length * 0.5) return '';
  return t.slice(last, last + max).trim();
}

/**
 * Complete objects from a JSON array that may have been cut off, e.g. an AI
 * reply that hit its length limit: '{"questions":[{...},{...},{"te' -> 2 objects.
 */
export function salvageArray(raw, key) {
  const s = String(raw || '');
  const at = s.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (at < 0) return [];
  const out = [];
  let i = s.indexOf('[', at) + 1;
  let depth = 0, start = -1, inStr = false, esc = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}') {
      if (--depth === 0 && start >= 0) {
        try { out.push(JSON.parse(s.slice(start, i + 1))); } catch { /* skip a malformed item */ }
        start = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return out;
}

const normText = t => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
const PRIORITY_RANK = { high: 3, med: 2, medium: 2, low: 1 };

/** Combine the results of analysing a paper in parts: no repeated questions, one entry per topic. */
export function mergeAnalyses(parts) {
  const questions = [];
  const seen = new Set();
  const topics = new Map();
  for (const p of parts) {
    for (const q of p.questions || []) {
      const k = normText(q.text);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      questions.push(q);
    }
    for (const t of p.topics || []) {
      const k = normText(t.name);
      if (!k) continue;
      const prev = topics.get(k);
      if (!prev) { topics.set(k, { ...t }); continue; }
      prev.frequency = Math.max(Number(prev.frequency) || 0, Number(t.frequency) || 0);
      if ((PRIORITY_RANK[t.priority] || 0) > (PRIORITY_RANK[prev.priority] || 0)) prev.priority = t.priority;
    }
  }
  return { questions, topics: [...topics.values()] };
}

/**
 * The part of `text` after the question that starts with `questionText`: from
 * the next question number on. '' if it was the last question; null if the
 * question can't be found in the text.
 */
export function textAfterQuestion(text, questionText) {
  const ws = words(questionText).slice(0, 8);
  if (ws.length < 3) return null;
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(ws.map(esc).join('[^\\p{L}\\p{N}]+'), 'iu');
  const m = re.exec(text);
  if (!m) return null;
  const from = m.index + m[0].length;
  const next = new RegExp(QUESTION_START.source, 'gi');
  next.lastIndex = from;
  const n = next.exec(text);
  return n ? text.slice(n.index).trim() : '';
}
