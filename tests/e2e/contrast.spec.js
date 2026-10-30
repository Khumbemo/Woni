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
        for (const id of ['question-bank-overlay', 'question-edit-overlay', 'active-session-overlay', 'auth-overlay', 'onboarding-overlay']) document.getElementById(id)?.classList.add('hidden');
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
