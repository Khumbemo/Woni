/**
 * Woni — Unit Tests
 * Tests for pure functions: validation, parsing, SM-2, benchmarks, relevance guard.
 */
import { describe, it, expect } from 'vitest';

// We can't directly import from app.js since it has DOM dependencies.
// Extract the testable functions inline here for isolated testing.

// --- escapeHtml ---
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- parseJSON (copied from ai.js logic) ---
function parseJSON(raw) {
  try {
    let text = raw.trim();
    if (text.includes('\`\`\`')) {
      const matches = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
      if (matches && matches[1]) text = matches[1];
      else text = text.replace(/\`\`\`[a-z]*\n/gi, '').replace(/\n\`\`\`/g, '');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
    return JSON.parse(text);
  } catch (e) {
    try {
      const startArr = raw.indexOf('[');
      const endArr = raw.lastIndexOf(']');
      if (startArr !== -1 && endArr !== -1) return { questions: JSON.parse(raw.slice(startArr, endArr + 1)) };
    } catch (e2) {}
    return {};
  }
}

// --- validateQuestion ---
function validateQuestion(question) {
  const issues = [];
  const options = Array.isArray(question.options) ? question.options.filter(Boolean) : [];
  const text = String(question.text || '').trim();
  const answer = String(question.answer || '').trim();
  const explanation = String(question.explanation || '').trim();
  if (text.length < 12) issues.push('Question text too short');
  if (options.length < 2) issues.push('At least 2 options required');
  if (!explanation) issues.push('Explanation missing');
  const answerUpper = answer.toUpperCase();
  const byLetter = /^[A-Z]$/.test(answerUpper) ? options[answerUpper.charCodeAt(0) - 65] : null;
  const answerMatchesOption = options.some(opt => String(opt).trim().toLowerCase() === answer.toLowerCase());
  if (!answer || (!byLetter && !answerMatchesOption && !/^[A-Z]$/.test(answerUpper))) issues.push('Answer not aligned with options');
  let confidence = typeof question.confidence === 'number' ? question.confidence : 0.65;
  if (issues.length === 0) confidence += 0.2;
  if (issues.length >= 2) confidence -= 0.2;
  confidence = Math.max(0.2, Math.min(0.98, confidence));
  return { ...question, options, issues, confidence };
}

// --- validateTopic ---
function validateTopic(topic) {
  const issues = [];
  const name = String(topic.name || '').trim();
  if (!name) issues.push('Topic name missing');
  const frequency = Math.max(0, Math.min(100, Number(topic.frequency || 0)));
  const priority = ['high', 'med', 'low'].includes(String(topic.priority || '').toLowerCase())
    ? String(topic.priority).toLowerCase()
    : (frequency >= 35 ? 'high' : frequency >= 20 ? 'med' : 'low');
  let confidence = typeof topic.confidence === 'number' ? topic.confidence : 0.7;
  if (issues.length > 0) confidence -= 0.25;
  confidence = Math.max(0.2, Math.min(0.98, confidence));
  return { ...topic, name, frequency, priority, issues, confidence };
}

// --- isRelevantToExam ---
const EXAM_TOPIC_GUARD = {
  csir_net: ['biochem', 'molecular', 'cell', 'genetic', 'ecology', 'evolution', 'plant', 'animal', 'physiology', 'immunology', 'microbiology', 'biotechnology'],
  npsc_ncs: ['history', 'polity', 'geography', 'economy', 'nagaland', 'current affairs', 'aptitude'],
};
function isRelevantToExam(examId, topicName = '', questionText = '') {
  const guards = EXAM_TOPIC_GUARD[examId];
  if (!guards || guards.length === 0) return true;
  const hay = `${String(topicName).toLowerCase()} ${String(questionText).toLowerCase()}`;
  return guards.some(g => hay.includes(g));
}

// --- SM-2 Algorithm ---
function sm2(quality, card) {
  let { interval, repetition, ease } = card;
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
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ease = Math.max(1.3, ease);
  return { interval, repetition, ease };
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
