/**
 * AI accuracy safeguards: the paper reaches the prompt, invented questions
 * are flagged, and the blind second check is parsed defensively.
 */
import { describe, it, expect } from 'vitest';
import { aiMixin } from '../ai.js';
import { uploadMixin } from '../views/upload.js';
import { foundInPaper, words } from '../utils.js';

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
    expect(ai.prompts[0]).toContain('SOURCE: june.pdf');
    expect(ai.prompts[0]).toContain('Which enzyme unwinds the DNA double helix');
    expect(ai.prompts[0]).toMatch(/Do not invent new questions/);
  });

  it('keeps the total paper text within budget across several files', async () => {
    const ai = fakeAI('{}');
    const big = 'x'.repeat(50000);
    await ai.performAIAnalysis('csir_net', [{ name: 'a', text: big }, { name: 'b', text: big }, { name: 'c', text: big }]);
    expect(ai.prompts[0].length).toBeLessThan(16000);
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
