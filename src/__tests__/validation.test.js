/**
 * Woni — Unit Tests
 * Tests for pure functions: validation, parsing, SM-2, benchmarks, relevance guard.
 */
import { describe, it, expect } from 'vitest';

import { uploadMixin } from '../views/upload.js';
import { shuffle, answerToLetter, computeStreak, parseDuration, formatStudyTime, sm2, parseJSON } from '../utils.js';

// app.js / ai.js pull in DOM, Firebase and pdf.js, so test the pure pieces directly.
const { validateQuestion, validateTopic } = uploadMixin;
const isRelevantToExam = (...args) => uploadMixin.isRelevantToExam.apply(uploadMixin, args);

// --- escapeHtml (mirrors app.escapeHtml) ---
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Freemium hash ---
function freemiumHash(count) {
  return btoa(`woni_fc_${count}_salt_x7k`);
}

// ============================================================
// TEST SUITES
// ============================================================

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });
  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('parseJSON', () => {
  it('parses clean JSON', () => {
    const result = parseJSON('{"questions": [{"text": "What is DNA?"}]}');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].text).toBe('What is DNA?');
  });

  it('parses JSON wrapped in markdown code blocks', () => {
    const raw = '```json\n{"questions": [], "topics": [{"name": "Cell Biology"}]}\n```';
    const result = parseJSON(raw);
    expect(result.topics).toHaveLength(1);
  });

  it('handles garbage input gracefully', () => {
    const result = parseJSON('this is not json');
    expect(result).toEqual({});
  });

  it('parses JSON with leading text', () => {
    const raw = 'Here is the analysis:\n{"questions": []}';
    const result = parseJSON(raw);
    expect(result.questions).toEqual([]);
  });
});

describe('validateQuestion', () => {
  it('accepts a valid question with high confidence', () => {
    const q = validateQuestion({
      text: 'What is the powerhouse of the cell?',
      options: ['Mitochondria', 'Nucleus', 'Ribosome', 'Golgi body'],
      answer: 'A',
      explanation: 'Mitochondria produce ATP through oxidative phosphorylation.',
    });
    expect(q.issues).toHaveLength(0);
    expect(q.confidence).toBeGreaterThan(0.8);
  });

  it('flags short question text', () => {
    const q = validateQuestion({ text: 'What?', options: ['A', 'B'], answer: 'A', explanation: 'Because.' });
    expect(q.issues).toContain('Question text too short');
  });

  it('flags missing explanation', () => {
    const q = validateQuestion({ text: 'What is a valid long enough question?', options: ['A', 'B', 'C', 'D'], answer: 'A', explanation: '' });
    expect(q.issues).toContain('Explanation missing');
  });

  it('flags too few options', () => {
    const q = validateQuestion({ text: 'Long enough question text here?', options: ['Only one'], answer: 'A', explanation: 'Test.' });
    expect(q.issues).toContain('At least 2 options required');
  });
});

describe('validateTopic', () => {
  it('validates a proper topic', () => {
    const t = validateTopic({ name: 'Cell Biology', frequency: 45, priority: 'high' });
    expect(t.issues).toHaveLength(0);
    expect(t.priority).toBe('high');
    expect(t.confidence).toBeGreaterThan(0.5);
  });

  it('flags missing topic name', () => {
    const t = validateTopic({ name: '', frequency: 10 });
    expect(t.issues).toContain('Topic name missing');
  });

  it('auto-assigns priority from frequency', () => {
    const t = validateTopic({ name: 'Genetics', frequency: 50, priority: 'invalid' });
    expect(t.priority).toBe('high');
  });
});

describe('isRelevantToExam', () => {
  it('matches relevant CSIR NET topics', () => {
    expect(isRelevantToExam('csir_net', 'Cell Biology')).toBe(true);
    expect(isRelevantToExam('csir_net', 'Molecular Genetics')).toBe(true);
  });

  it('rejects irrelevant topics for CSIR NET', () => {
    expect(isRelevantToExam('csir_net', 'Indian Polity')).toBe(false);
  });

  it('matches NPSC NCS topics', () => {
    expect(isRelevantToExam('npsc_ncs', '', 'History of Nagaland')).toBe(true);
  });

  it('returns true for unknown exams', () => {
    expect(isRelevantToExam('unknown_exam', 'Anything')).toBe(true);
  });
});

describe('SM-2 Algorithm', () => {
  it('first correct answer sets interval to 1', () => {
    const result = sm2(3, { interval: 0, repetition: 0, ease: 2.5 });
    expect(result.interval).toBe(1);
    expect(result.repetition).toBe(1);
  });

  it('second correct answer sets interval to 6', () => {
    const result = sm2(4, { interval: 1, repetition: 1, ease: 2.5 });
    expect(result.interval).toBe(6);
    expect(result.repetition).toBe(2);
  });

  it('incorrect answer resets repetition and interval', () => {
    const result = sm2(0, { interval: 6, repetition: 2, ease: 2.5 });
    expect(result.interval).toBe(1);
    expect(result.repetition).toBe(0);
  });

  it('ease factor never drops below 1.3', () => {
    const result = sm2(0, { interval: 1, repetition: 0, ease: 1.3 });
    expect(result.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('easy rating increases ease factor', () => {
    const result = sm2(5, { interval: 0, repetition: 0, ease: 2.5 });
    expect(result.ease).toBeGreaterThan(2.5);
  });
});

describe('Freemium hash', () => {
  it('generates consistent hashes', () => {
    expect(freemiumHash(0)).toBe(freemiumHash(0));
    expect(freemiumHash(3)).toBe(freemiumHash(3));
  });

  it('different counts produce different hashes', () => {
    expect(freemiumHash(1)).not.toBe(freemiumHash(2));
  });
});

describe('validateQuestion answer alignment', () => {
  const base = { text: 'Which organelle produces ATP?', explanation: 'Oxidative phosphorylation.' };

  it('flags a letter outside the option range', () => {
    const q = validateQuestion({ ...base, options: ['Mitochondria', 'Nucleus'], answer: 'D' });
    expect(q.issues).toContain('Answer not aligned with options');
  });

  it('accepts the answer given as option text', () => {
    const q = validateQuestion({ ...base, options: ['Mitochondria', 'Nucleus'], answer: 'Mitochondria' });
    expect(q.issues).toHaveLength(0);
  });
});

describe('answerToLetter', () => {
  const options = ['A protein', 'Lipid', 'Carbohydrate', 'Nucleic acid'];
  it('maps bare and decorated letters', () => {
    expect(answerToLetter({ options, answer: 'b' })).toBe('B');
    expect(answerToLetter({ options, answer: '(C)' })).toBe('C');
    expect(answerToLetter({ options, answer: 'D) Nucleic acid' })).toBe('D');
    expect(answerToLetter({ options, answer: 'Option B' })).toBe('B');
  });
  it('prefers exact option text over a leading letter', () => {
    expect(answerToLetter({ options: ['Lipid', 'A protein'], answer: 'A protein' })).toBe('B');
  });
  it('returns null when unmappable', () => {
    expect(answerToLetter({ options, answer: 'E' })).toBeNull();
    expect(answerToLetter({ options, answer: '' })).toBeNull();
  });
});

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input).sort((a, b) => a - b)).toEqual(input);
  });
  it('is roughly uniform (each element lands in position 0 ~1/n of the time)', () => {
    const n = 4, trials = 20000, counts = Array(n).fill(0);
    for (let t = 0; t < trials; t++) counts[shuffle([0, 1, 2, 3])[0]]++;
    counts.forEach(c => expect(Math.abs(c / trials - 1 / n)).toBeLessThan(0.02));
  });
});

describe('computeStreak', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date(2026, 5, 15, 12).getTime();
  it('counts consecutive days ending today', () => {
    expect(computeStreak([now, now - day, now - 2 * day], now)).toBe(3);
  });
  it('still counts when the latest session was yesterday', () => {
    expect(computeStreak([now - day, now - 2 * day], now)).toBe(2);
  });
  it('breaks on a gap and ignores duplicate sessions on one day', () => {
    expect(computeStreak([now, now, now - 2 * day, now - 3 * day], now)).toBe(1);
  });
  it('is 0 when the last session was over a day ago', () => {
    expect(computeStreak([now - 3 * day], now)).toBe(0);
  });
});

describe('study time helpers', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(parseDuration('05:30')).toBe(330);
    expect(parseDuration('1:00:00')).toBe(3600);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
  });
  it('formats minutes and hours', () => {
    expect(formatStudyTime(45 * 60)).toBe('45m');
    expect(formatStudyTime(125 * 60)).toBe('2h 5m');
    expect(formatStudyTime(120 * 60)).toBe('2h');
  });
});
