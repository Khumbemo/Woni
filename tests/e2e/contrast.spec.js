/**
 * WCAG 2.1 AA colour contrast on every main screen, in the dark and light
 * themes, measured on the rendered page by axe-core.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.setTimeout(120000);

async function setup(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise(r => { const req = indexedDB.deleteDatabase('woni_db'); req.onsuccess = req.onerror = req.onblocked = r; });
  });
  await page.reload();
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });
  await page.evaluate(() => window.app.continueAsGuest());
  await page.evaluate(() => window.app.showOnboarding());
  await page.locator('.exam-checkbox input[value="csir_net"]').check();
  await page.click('#save-exams-btn');
  await expect(page.locator('#onboarding-overlay')).toBeHidden();
  await page.evaluate(async () => {
    const app = window.app;
    const q = { exam: 'csir_net', text: 'Which enzyme unwinds DNA at the replication fork?', options: ['Primase', 'Ligase', 'Helicase', 'Gyrase'], answer: 'C', topic: 'Molecular Biology', explanation: 'Helicase separates the strands.', answerSource: 'ai', flagged: true };
    await app.dbAdd('questions', q);
    await app.dbAdd('flashcards', { questionSyncId: q.syncId, exam: 'csir_net', front: q.text, back: 'Answer: C) Helicase', topic: q.topic, nextReview: 0, interval: 0, repetition: 0, ease: 2.5 });
    await app.dbPut('topics', { id: 'csir_net_Molecular Biology', exam: 'csir_net', name: 'Molecular Biology', frequency: 60, priority: 'high', mastery: 40 });
    await app.dbAdd('papers', { name: 'june-2023.pdf', exam: 'csir_net', timestamp: Date.now(), text: '' });
    await app.dbAdd('mock_tests', { exam: 'csir_net', date: Date.now(), score: 50, qCount: 2, duration: '01:00', answers: ['C', 'A'], questions: [] });
  });
}

const screens = {
  dashboard: page => page.evaluate(() => window.app.showView('dashboard')),
  library: page => page.evaluate(() => window.app.showView('library')),
  upload: async page => {
    await page.evaluate(() => {
      const app = window.app;
      app.showView('upload');
      app.state.pendingAnalysis = {
        examId: 'csir_net',
        questions: [app.validateQuestion({ text: 'Which enzyme unwinds DNA at the fork?', options: ['A', 'B', 'C', 'D'], answer: 'C', explanation: 'x', topic: 'Molecular Biology', answerSource: 'ai', source: 'Which enzyme unwinds DNA', recheck: { answer: 'B', agrees: false, reason: 'Because.' } }, 'csir_net', 'nothing similar')],
        topics: [app.validateTopic({ name: 'Molecular Biology', frequency: 50, priority: 'high' }, 'csir_net')],
      };
      app.renderAnalysisReview();
    });
  },
  practice: page => page.evaluate(() => window.app.showView('practice')),
  progress: page => page.evaluate(() => window.app.showView('progress')),
  settings: page => page.evaluate(() => window.app.showView('settings')),
  'question bank': page => page.evaluate(() => window.app.showQuestionBank()),
  'test results': async page => {
    await page.evaluate(async () => {
      const app = window.app;
      const qs = await app.dbGetAll('questions');
      app.openSession('Mock Test', 'test', qs.map(q => ({ ...q, flagged: false })));
    });
    await page.locator('.option-btn').first().click();
    await page.click('#next-q-btn');
    await expect(page.locator('.results-review')).toBeVisible();
  },
  'practice feedback': async page => {
    await page.evaluate(async () => {
      const app = window.app;
      const qs = await app.dbGetAll('questions');
      app.openSession('Practice', 'test', [...qs, ...qs].map(q => ({ ...q, flagged: false })), { instant: true });
    });
    await page.locator('.option-btn').nth(2).click();
    await page.click('#next-q-btn');
    await page.locator('.option-btn').first().click();
    await expect(page.locator('#instant-feedback')).toBeVisible();
  },
  planner: async page => {
    await page.evaluate(async () => {
      const app = window.app;
      const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      await app.dbPut('progress', { id: 'exam:csir_net', exam: 'csir_net', date: d(30) });
      await app.dbAdd('tasks', { title: 'Overdue reading', due: d(-1), exam: 'csir_net', source: 'user', done: false, createdAt: 1 });
      await app.dbAdd('tasks', { title: 'Study Genetics', due: d(0), exam: 'csir_net', source: 'plan', kind: 'topic', topic: 'Genetics', done: false, createdAt: 2 });
      await app.dbAdd('tasks', { title: 'Finished task', exam: 'csir_net', source: 'user', done: true, doneAt: 3, createdAt: 3 });
      await app.showPlanner();
    });
    await expect(page.locator('#planner-list .task-row')).toHaveCount(3);
  },
  'today plan': async page => {
    await page.evaluate(() => { window.app.hideSubView('planner-overlay'); window.app.showView('dashboard'); });
    await expect(page.locator('#quest-list .quest').first()).toBeVisible();
  },
  'mixed formats': async page => {
    await page.evaluate(async () => {
      const app = window.app;
      const qs = (await app.dbGetAll('questions')).map(q => ({ ...q, flagged: false }));
      const base = qs[0];
      const many = Array.from({ length: 4 }, (_, i) => ({ ...base, id: undefined, text: `Question ${i}?`, options: [`Answer ${i}`, `Other ${i}`], answer: 'A' }));
      app.openSession('Mixed Practice', 'mixed', [
        { kind: 'tf', q: many[0], proposed: many[0].options[1], truth: false, topic: base.topic },
        { kind: 'typed', q: many[1], answer: 'Answer 1', topic: base.topic },
        { kind: 'match', pairs: many.slice(0, 3).map(q => ({ q, prompt: q.text, answer: q.options[0] })), choices: many.slice(0, 3).map(q => q.options[0]), topic: base.topic },
        { kind: 'multi', statements: many.map((q, i) => ({ q, answer: q.options[i % 2], truth: i % 2 === 0 })), topic: base.topic },
      ], { instant: true });
    });
    await page.keyboard.press('f');
    await page.click('#next-q-btn');
    await page.fill('#typed-answer', 'wrong');
    await page.click('#typed-submit');
    await page.click('#next-q-btn');
    for (let k = 0; k < 3; k++) await page.selectOption(`#match-${k}`, String((k + 1) % 3));
    await page.click('#match-submit');
    await page.click('#next-q-btn');
    await page.check('#multi-1');
    await page.click('#multi-submit');
    await expect(page.locator('#instant-feedback')).toContainText('Not quite');
  },
  'starred & notes': async page => {
    await page.evaluate(async () => {
      const app = window.app;
      const [q] = await app.dbGetAll('questions');
      await app.dbPut('questions', { ...q, starred: true, note: 'My note about this question.', mistake: { count: 2, lastWrong: Date.now(), streak: 0 } });
      app.hideSubView('active-session-overlay');
      await app.showStarred();
    });
    await expect(page.locator('#starred-list .item-note')).toBeVisible();
  },
  'note editor': async page => {
    await page.evaluate(async () => {
      const [q] = await window.app.dbGetAll('questions');
      await window.app.editNote(`q:${q.id}`);
    });
    await expect(page.locator('#note-overlay')).toBeVisible();
  },
  'ai notes': async page => {
    await page.evaluate(async () => {
      const app = window.app;
      app.hideSubView('starred-overlay');
      app.hideSubView('note-overlay');
      await app.showAiNotes();
      app.state.aiNotes = {
        cards: [{ front: 'What does helicase do?', back: 'Unwinds DNA.', keep: true }],
        summary: { title: 'DNA replication', points: ['Helicase unwinds DNA'], keyTerms: [{ term: 'Primer', meaning: 'Short RNA start' }] },
      };
      app._renderAiOutput();
      document.getElementById('ai-status').textContent = 'Summary ready.';
    });
    await expect(page.locator('.ai-summary')).toBeVisible();
  },
  'sign in': page => page.evaluate(() => document.getElementById('auth-overlay').classList.remove('hidden')),
  onboarding: page => page.evaluate(() => window.app.showOnboarding()),
  toasts: async page => {
    await page.evaluate(() => {
      window.app.showView('dashboard');
      for (const t of ['success', 'error', 'info']) window.app.showToast(`A ${t} message`, t);
    });
    await expect(page.getByText('A info message')).toBeVisible();
  },
  flashcard: page => page.evaluate(async () => {
    const app = window.app;
    app.openSession('Flashcards', 'flashcard', await app.dbGetAll('flashcards'));
  }),
};

for (const theme of ['dark', 'light']) {
  test(`colour contrast meets WCAG AA (${theme} theme)`, async ({ page }) => {
    await setup(page);
    await page.evaluate(t => { window.app.state.theme = t; window.app.applyTheme(); }, theme);
    const failures = [];
    for (const [name, open] of Object.entries(screens)) {
      await page.evaluate(() => {
        for (const id of ['question-bank-overlay', 'question-edit-overlay', 'active-session-overlay', 'auth-overlay', 'onboarding-overlay', 'planner-overlay', 'starred-overlay', 'note-overlay', 'ai-notes-overlay']) document.getElementById(id)?.classList.add('hidden');
      });
      await open(page);
      await page.waitForTimeout(700); // view transitions and animations settle
      const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).exclude('#particle-canvas').analyze();
      for (const v of violations) {
        for (const n of v.nodes) failures.push(`${name}: ${n.target.join(' ')} — ${n.any[0]?.message || v.help}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
