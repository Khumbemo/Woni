/**
 * Woni — mistake notebook, AI study-note parsing, reminders and read-aloud
 * text (pure functions).
 */

// --- Mistake notebook ----------------------------------------------------------

/** Right answers in a row (after the last mistake) that clear a question from the notebook. */
export const CLEAR_AFTER = 2;
export const MISTAKE_SESSION_SIZE = 10;

/**
 * A question's mistake record after another answer.
 * { count: times wrong, lastWrong: ms, streak: right answers since the last mistake }.
 * A question that was never wrong stays without a record.
 */
export function updateMistake(prev, right, now = Date.now()) {
  if (!prev) return right ? null : { count: 1, lastWrong: now, streak: 0 };
  if (right) return { ...prev, streak: (prev.streak || 0) + 1 };
  return { count: (prev.count || 0) + 1, lastWrong: now, streak: 0 };
}

/** Is the question currently in the mistake notebook? */
export function inNotebook(q) {
  return !!q?.mistake && (q.mistake.streak || 0) < CLEAR_AFTER && !q.flagged;
}

/** Questions to retry: most-missed first, then most recent. */
export function pickMistakes(questions, n = MISTAKE_SESSION_SIZE) {
  return (questions || []).filter(inNotebook)
    .sort((a, b) => (b.mistake.count - a.mistake.count) || (b.mistake.lastWrong - a.mistake.lastWrong))
    .slice(0, n);
}

// --- AI study notes --------------------------------------------------------------

export const MAX_AI_CARDS = 15;
export const NOTES_MAX_CHARS = 12000;

/** Flashcards from an AI reply: { cards: [{ front, back }] }, cleaned and de-duplicated. */
export function cleanAiCards(parsed) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(parsed?.cards) ? parsed.cards : []) {
    const front = String(c?.front ?? '').trim().slice(0, 500);
    const back = String(c?.back ?? '').trim().slice(0, 1500);
    const key = front.toLowerCase().replace(/\s+/g, ' ');
    if (front.length < 3 || !back || seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
    if (out.length === MAX_AI_CARDS) break;
  }
  return out;
}

/** A summary from an AI reply: { title, points: [..], keyTerms: [{ term, meaning }] }. */
export function cleanAiSummary(parsed) {
  const points = (Array.isArray(parsed?.points) ? parsed.points : [])
    .map(p => String(p ?? '').trim()).filter(Boolean).slice(0, 20);
  const keyTerms = (Array.isArray(parsed?.keyTerms) ? parsed.keyTerms : [])
    .map(k => ({ term: String(k?.term ?? '').trim(), meaning: String(k?.meaning ?? '').trim() }))
    .filter(k => k.term && k.meaning).slice(0, 15);
  if (points.length === 0 && keyTerms.length === 0) return null;
  return { title: String(parsed?.title ?? '').trim().slice(0, 120) || 'Revision summary', points, keyTerms };
}

/** Plain-text version of a summary (for copying and the PDF). */
export function summaryText(s) {
  if (!s) return '';
  const lines = [s.title, '', ...s.points.map(p => `• ${p}`)];
  if (s.keyTerms.length) lines.push('', 'Key terms', ...s.keyTerms.map(k => `${k.term}: ${k.meaning}`));
  return lines.join('\n');
}

// --- Reminders -------------------------------------------------------------------

/** 'HH:MM' -> { h, m } or null. */
export function parseTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

const icsEscape = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/**
 * A calendar file (iCalendar, RFC 5545) with a daily event at `time` in the
 * device's local time and an alert when it starts. Calendars on phones and
 * computers then remind the student every day, even with Woni closed.
 */
export function buildReminderIcs(time, { now = Date.now(), uid = 'woni-daily-study', minutes = 25 } = {}) {
  const t = parseTime(time);
  if (!t) return null;
  const pad = n => String(n).padStart(2, '0');
  const local = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  const start = new Date(now);
  start.setHours(t.h, t.m, 0, 0);
  const finish = new Date(start);
  finish.setMinutes(finish.getMinutes() + minutes); // may roll over to the next day
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Woni//Study reminder//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@woni`,
    `DTSTAMP:${stamp}`,
    // Floating local time: the reminder follows the device's time zone.
    `DTSTART:${local(start)}`,
    `DTEND:${local(finish)}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${icsEscape('Study with Woni')}`,
    `DESCRIPTION:${icsEscape('Your daily study session: daily challenge, flashcards and today\'s plan.')}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape('Time to study with Woni')}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** When the next reminder is due (ms), from `now`: today at `time` if still ahead, else tomorrow. */
export function nextReminderAt(time, now = Date.now()) {
  const t = parseTime(time);
  if (!t) return null;
  const d = new Date(now);
  d.setHours(t.h, t.m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// --- Read aloud --------------------------------------------------------------------

/** What to read for a multiple-choice question: the question, then "Option A: ...". */
export function questionSpeech(q) {
  const opts = (q?.options || []).map((o, i) => `Option ${String.fromCharCode(65 + i)}: ${o}.`);
  return [String(q?.text || '').trim(), ...opts].filter(Boolean).join(' ');
}
