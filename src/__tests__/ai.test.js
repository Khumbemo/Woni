/**
 * AI accuracy safeguards: the paper reaches the prompt, invented questions
 * are flagged, and the blind second check is parsed defensively.
 */
import { describe, it, expect, vi } from 'vitest';
import { aiMixin } from '../ai.js';
import { uploadMixin } from '../views/upload.js';
import { foundInPaper, words, splitIntoChunks, findAnswerKey, salvageArray, mergeAnalyses, textAfterQuestion } from '../utils.js';

const PAPER = `CSIR NET June 2023. Part B.
21. Which enzyme unwinds the DNA double helix at the replication fork?
(A) Primase (B) DNA ligase (C) Helicase (D) Topoisomerase I
22. The Michaelis constant is the substrate concentration at which velocity is half of Vmax.`;

function fakeAI(reply) {
  const prompts = [];
  return {
    ...aiMixin,
    prompts,
    groqCall: async p => { prompts.push(p); return typeof reply === 'function' ? reply(p) : reply; },
  };
}

describe('paper analysis prompt', () => {
  it('sends the paper text to the AI', async () => {
    const ai = fakeAI('{"questions":[],"topics":[]}');
    await ai.performAIAnalysis('csir_net', [{ name: 'june.pdf', text: PAPER }]);
    expect(ai.prompts).toHaveLength(1);
    expect(ai.prompts[0]).toContain('"june.pdf"');
    expect(ai.prompts[0]).toContain('Which enzyme unwinds the DNA double helix');
    expect(ai.prompts[0]).toMatch(/Do not invent new questions/);
  });

  it('normalises answerSource and drops non-object items', async () => {
    const ai = fakeAI(JSON.stringify({
      questions: [{ text: 'Q', answerSource: 'paper' }, { text: 'R', answerSource: 'magic', source: 5 }, null, 'junk'],
      topics: [{ name: 'Genetics' }, {}, null],
    }));
    const { questions, topics } = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: PAPER }]);
    expect(questions.map(q => q.answerSource)).toEqual(['paper', 'ai']);
    expect('source' in questions[1]).toBe(false);
    expect(topics.map(t => t.id)).toEqual(['csir_net_Genetics']);
  });
});

describe('second-opinion answer check', () => {
  const qs = Array.from({ length: 12 }, (_, i) => ({ text: `Question ${i}`, options: ['a', 'b', 'c', 'd'], answer: 'A' }));

  it('asks in batches without revealing the first answers', async () => {
    const ai = fakeAI(p => JSON.stringify({ answers: [{ n: 1, answer: 'b', reason: 'because' }] }));
    const res = await ai.recheckAnswers('csir_net', qs);
    expect(ai.prompts).toHaveLength(2); // 10 + 2
    expect(ai.prompts[0]).not.toMatch(/"answer":\s*"A"|Answer: A/);
    expect(res).toEqual([
      { index: 0, answer: 'B', reason: 'because' },
      { index: 10, answer: 'B', reason: 'because' },
    ]);
  });

  it('ignores malformed or out-of-range entries', async () => {
    const ai = fakeAI(JSON.stringify({ answers: [{ n: 0, answer: 'A' }, { n: 99, answer: 'A' }, { n: 2, answer: '?' }, { n: '3', answer: 'C) Helicase' }, null] }));
    expect(await ai.recheckAnswers('x', qs.slice(0, 5))).toEqual([{ index: 2, answer: 'C', reason: '' }]);
  });

  it('returns nothing when the reply is not JSON', async () => {
    expect(await fakeAI('sorry, no').recheckAnswers('x', qs.slice(0, 3))).toEqual([]);
  });
});

describe('foundInPaper', () => {
  it('finds a question copied from the paper, even with different spacing and case', () => {
    expect(foundInPaper({ text: 'Which enzyme UNWINDS the DNA double-helix at the replication fork?' }, PAPER)).toBe(true);
    expect(foundInPaper({ text: 'Rephrased', source: 'Which enzyme unwinds the DNA double helix' }, PAPER)).toBe(true);
  });

  it('flags a question the paper does not contain', () => {
    expect(foundInPaper({ text: 'What is the role of auxin in apical dominance of plants?' }, PAPER)).toBe(false);
  });

  it('does not flag when there is no paper text to compare with', () => {
    expect(foundInPaper({ text: 'Anything at all here' }, '')).toBe(true);
  });

  it('splits words in any script', () => {
    expect(words('Café — ATP, 2pq!')).toEqual(['cafe', 'atp', '2pq']);
  });

  it('validateQuestion adds the issue only for untraceable questions', () => {
    const v = q => uploadMixin.validateQuestion.call(uploadMixin, { options: ['a', 'b'], answer: 'A', explanation: 'x', ...q }, '', PAPER);
    expect(v({ text: 'Which enzyme unwinds the DNA double helix at the replication fork?' }).issues).toEqual([]);
    expect(v({ text: 'What is the role of auxin in apical dominance?' }).issues).toContain('Not found in your paper (may be AI-invented)');
  });
});

// --- Long papers ---------------------------------------------------------------

/** A paper of `n` numbered questions (~330 characters each) and optionally an answer key. */
function longPaper(n, withKey = false) {
  let text = 'CSIR NET Life Sciences, Part C.\n';
  for (let i = 1; i <= n; i++) {
    text += `${i}. Question number ${i} about enzyme kinetics, membrane transport and gene regulation in eukaryotic cells, asked carefully so the text is long enough? (A) first option ${i} (B) second option ${i} (C) third option ${i} (D) fourth option ${i}\n`;
  }
  if (withKey) text += 'ANSWER KEY\n' + Array.from({ length: n }, (_, i) => `${i + 1}-${'ABCD'[i % 4]}`).join(' ');
  return text;
}

/** Fake AI that "reads" the question numbers in each prompt's paper and returns them. */
function readingAI({ truncateAbove = Infinity, failOnCall = 0, error } = {}) {
  let call = 0;
  return fakeAI(p => {
    call++;
    if (call === failOnCall) throw error;
    const paper = p.slice(p.lastIndexOf('<paper>'));
    const nums = [...paper.matchAll(/(?:^|\s)(\d{1,3})\. Question number/g)].map(m => Number(m[1]));
    const qs = nums.map(n => ({ text: `Question number ${n}?`, options: ['a', 'b', 'c', 'd'], answer: 'A', answerSource: 'paper', topic: 'Biochemistry' }));
    const json = JSON.stringify({ questions: qs, topics: [{ name: 'Biochemistry', frequency: 40, priority: 'med' }] });
    // A reply that hits its length limit stops mid-way.
    return qs.length > truncateAbove ? json.slice(0, Math.floor(json.length * 0.6)) : json;
  });
}

const nums = r => r.questions.map(q => Number(q.text.match(/\d+/)[0])).sort((a, b) => a - b);
const range = n => Array.from({ length: n }, (_, i) => i + 1);

describe('long papers', () => {
  it('analyses a 150-question paper in parts and finds every question once', async () => {
    const ai = readingAI();
    const progress = [];
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'paper.pdf', text: longPaper(150) }], m => progress.push(m));
    expect(ai.prompts.length).toBeGreaterThan(5);
    for (const p of ai.prompts) expect(p.slice(p.lastIndexOf('<paper>')).length).toBeLessThan(6100);
    expect(nums(res)).toEqual(range(150));
    expect(res.topics).toHaveLength(1);
    expect(res.failedParts).toBe(0);
    expect(progress).toContain(`AI is analyzing part 2 of ${ai.prompts.length}...`);
  });

  it('never cuts a question in half between parts', async () => {
    const ai = readingAI();
    await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(60) }]);
    for (const p of ai.prompts) {
      const paper = p.slice(p.lastIndexOf('<paper>') + 8, p.lastIndexOf('</paper>')).trim();
      expect(paper).toMatch(/^(CSIR|\d+\. Question)/);
      expect(paper).toMatch(/\(D\) fourth option \d+$/);
    }
  });

  it('gives every part the answer key from the end of the paper', async () => {
    const ai = readingAI();
    await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(60, true) }]);
    expect(ai.prompts.length).toBeGreaterThan(1);
    for (const p of ai.prompts) expect(p).toMatch(/ANSWER KEY[\s\S]*1-A 2-B 3-C/);
  });

  it('continues after a cut-off reply: all 150 questions with replies capped at ~10 questions', async () => {
    const ai = readingAI({ truncateAbove: 10 });
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(150) }]);
    expect(nums(res)).toEqual(range(150));
    expect(ai.prompts.length).toBeLessThanOrEqual(20);
    expect(res.failedParts).toBe(0);
  });

  it('splits a part again when the reply was cut off, so no questions are lost', async () => {
    const ai = readingAI({ truncateAbove: 8 });
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(40) }]);
    expect(nums(res)).toEqual(range(40));
  });

  it('keeps the complete questions even when every reply is cut off', async () => {
    const ai = readingAI({ truncateAbove: 0 });
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(4) }]);
    expect(res.questions.length).toBeGreaterThan(0);
    expect(res.questions.length).toBeLessThan(4);
  });

  it('returns what it found when the AI stops responding part-way', async () => {
    const ai = readingAI({ failOnCall: 3, error: new Error('Network error: Could not reach Groq API.') });
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(150) }]);
    expect(res.questions.length).toBeGreaterThan(20);
    expect(res.failedParts).toBeGreaterThan(0);
    expect(res.partsTotal).toBeGreaterThan(res.failedParts);
  });

  it('reports the error when nothing could be analysed', async () => {
    const ai = readingAI({ failOnCall: 1, error: new Error('Daily free limit reached.') });
    await expect(ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(10) }])).rejects.toThrow('Daily free limit');
  });

  it('waits and retries on the per-minute limit, but not on the daily one', async () => {
    const ai = readingAI();
    const waits = [];
    ai._sleep = async ms => { waits.push(ms); };
    let n = 0;
    const real = ai.groqCall;
    ai.groqCall = async (p, o) => {
      if (++n <= 2) throw new Error('Too many requests. Wait a minute and try again.');
      return real(p, o);
    };
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(5) }]);
    expect(waits).toEqual([20000, 40000]);
    expect(nums(res)).toEqual(range(5));

    const daily = readingAI({ failOnCall: 1, error: new Error('Daily free limit reached. Too many requests.') });
    daily._sleep = vi.fn();
    await expect(daily.performAIAnalysis('x', [{ name: 'p', text: longPaper(5) }])).rejects.toThrow('Daily');
    expect(daily._sleep).not.toHaveBeenCalled();
  });

  it('stops asking about more than MAX_PARTS parts and says how many were skipped', async () => {
    const ai = readingAI();
    const res = await ai.performAIAnalysis('csir_net', [{ name: 'p', text: longPaper(700) }]);
    expect(ai.prompts).toHaveLength(16);
    expect(res.skippedParts).toBeGreaterThan(0);
    expect(res.partsTotal).toBe(16 + res.skippedParts);
  });

  it('second check keeps the answers it got before an error', async () => {
    let n = 0;
    const ai = fakeAI(() => {
      if (++n === 2) throw new Error('Network error');
      return JSON.stringify({ answers: [{ n: 1, answer: 'B' }] });
    });
    const qs = Array.from({ length: 25 }, (_, i) => ({ text: `Q${i}`, options: ['a', 'b'], answer: 'A' }));
    expect(await ai.recheckAnswers('x', qs)).toEqual([{ index: 0, answer: 'B', reason: '' }]);
  });
});

describe('long-paper helpers', () => {
  it('splitIntoChunks keeps all text, respects the size, and copes with no question numbers', () => {
    const prose = 'word '.repeat(5000).trim();
    const parts = splitIntoChunks(prose, 1000);
    expect(parts.every(p => p.length <= 1000)).toBe(true);
    expect(parts.join(' ')).toBe(prose);
    const solid = 'x'.repeat(2500); // no spaces at all
    expect(splitIntoChunks(solid, 1000).map(p => p.length)).toEqual([1000, 1000, 500]);
    expect(splitIntoChunks('', 1000)).toEqual([]);
    expect(splitIntoChunks('short', 1000)).toEqual(['short']);
  });

  it('splitIntoChunks recognises common numbering styles', () => {
    const text = ['Q.1 alpha', 'Q2) beta', 'Question 3. gamma', '4: delta'].map(t => t + ' filler'.repeat(30)).join(' ');
    for (const p of splitIntoChunks(text, 450)) expect(p).toMatch(/^(Q\.?\d|Question \d|\d:)/);
  });

  it('findAnswerKey finds a key near the end, not a passing mention early on', () => {
    const body = 'Read the answer key instructions. ' + 'question text '.repeat(500);
    expect(findAnswerKey(body)).toBe('');
    const key = findAnswerKey(body + 'Answer Key: 1-A 2-C 3-B');
    expect(key).toBe('Answer Key: 1-A 2-C 3-B');
    expect(findAnswerKey(body + 'ANSWER KEY ' + 'x'.repeat(5000), 100)).toHaveLength(100);
  });

  it('salvageArray copes with braces and quotes inside strings', () => {
    const raw = '{"questions":[{"text":"Is {x} \\"quoted\\"?","options":["a}","b"]},{"text":"second"},{"text":"cut off';
    expect(salvageArray(raw, 'questions')).toEqual([{ text: 'Is {x} "quoted"?', options: ['a}', 'b'] }, { text: 'second' }]);
    expect(salvageArray('not json', 'questions')).toEqual([]);
    expect(salvageArray('{"questions":[{"a":1}],"topics":[{"name":"T"}', 'topics')).toEqual([{ name: 'T' }]);
  });

  it('textAfterQuestion finds where to continue', () => {
    const text = '1. What is ATP used for in cells? (A) x (B) y 2. Define the Km of an enzyme. (A) p (B) q 3. Last one here? (A) r';
    expect(textAfterQuestion(text, 'What is ATP used for in cells?')).toBe('2. Define the Km of an enzyme. (A) p (B) q 3. Last one here? (A) r');
    expect(textAfterQuestion(text, 'Define the KM of an  enzyme')).toBe('3. Last one here? (A) r');
    expect(textAfterQuestion(text, 'Last one here?')).toBe('');
    expect(textAfterQuestion(text, 'Something not in the paper at all')).toBeNull();
    expect(textAfterQuestion(text, 'Hi')).toBeNull();
  });

  it('mergeAnalyses removes repeated questions and merges topics', () => {
    const merged = mergeAnalyses([
      { questions: [{ text: 'What is ATP?' }, { text: 'Define Km.' }], topics: [{ name: 'Biochemistry', frequency: 30, priority: 'low' }] },
      { questions: [{ text: '  what is   ATP? ' }, { text: '' }, { text: 'Hardy-Weinberg?' }], topics: [{ name: 'biochemistry', frequency: 70, priority: 'high' }, { name: 'Genetics' }] },
    ]);
    expect(merged.questions.map(q => q.text)).toEqual(['What is ATP?', 'Define Km.', 'Hardy-Weinberg?']);
    expect(merged.topics).toEqual([{ name: 'Biochemistry', frequency: 70, priority: 'high' }, { name: 'Genetics' }]);
  });
});
