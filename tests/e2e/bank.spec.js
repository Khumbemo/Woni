/**
 * Question Bank, answer review and reporting, paper and book deletion.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function guestWithQuestions(page) {
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
    app.confirmAction = async () => true;
    const add = async (text, answer, extra = {}) => {
      const q = { exam: 'csir_net', text, options: ['Primase', 'Ligase', 'Helicase', 'Gyrase'], answer, topic: 'Molecular Biology', explanation: 'Because.', ...extra };
      await app.dbAdd('questions', q);
      await app.dbAdd('flashcards', { questionSyncId: q.syncId, exam: 'csir_net', front: text, back: 'Answer: ' + answer, topic: q.topic, nextReview: 0, interval: 0, repetition: 0, ease: 2.5 });
    };
    await add('Which enzyme unwinds DNA at the replication fork?', 'C', { answerSource: 'paper' });
    await add('Which enzyme seals nicks in the DNA backbone?', 'A', { answerSource: 'ai' });
    await add('Which enzyme relieves supercoiling in bacteria?', 'D', { recheck: { answer: 'B', agrees: false } });
    await app.dbAdd('papers', { name: 'june-2023.pdf', exam: 'csir_net', timestamp: Date.now(), text: '...' });
  });
}

test('search, filter, edit and delete questions; edits reach the flashcard', async ({ page }) => {
  await guestWithQuestions(page);
  await page.evaluate(() => window.app.showView('practice'));
  await page.click('.practice-card[data-action="showQuestionBank"]');
  const items = page.locator('#bank-list .bank-item');
  await expect(items).toHaveCount(3);
  await expect(page.locator('#bank-summary')).toHaveText('3 of 3 questions');

  await page.fill('#bank-search', 'nicks');
  await expect(items).toHaveCount(1);
  await page.fill('#bank-search', '');
  await page.selectOption('#bank-filter', 'ai');
  await expect(items).toHaveCount(2); // 'ai' and unknown source
  await page.selectOption('#bank-filter', 'disputed');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Disputed');
  await page.selectOption('#bank-filter', 'all');

  // Edit the "nicks" question: fix the answer and the wording.
  await page.fill('#bank-search', 'nicks');
  await items.first().locator('[data-action="editQuestion"]').click();
  await expect(page.locator('#question-edit-overlay')).toBeVisible();
  await page.fill('#qe-answer', 'Z');
  await page.click('[data-action="saveQuestionEdit"]');
  await expect(page.getByText('The answer must be one of A–D.')).toBeVisible(); // rejected
  await expect(page.locator('#question-edit-overlay')).toBeVisible();
  await page.fill('#qe-answer', 'b');
  await page.fill('#qe-text', 'Which enzyme seals nicks in DNA?');
  await page.click('[data-action="saveQuestionEdit"]');
  await expect(page.locator('#question-edit-overlay')).toBeHidden();
  await page.fill('#bank-search', '');
  await expect(page.locator('#bank-list')).toContainText('Which enzyme seals nicks in DNA?');

  const card = await page.evaluate(async () => (await window.app.dbGetAll('flashcards')).find(c => c.front.includes('seals')));
  expect(card.front).toBe('Which enzyme seals nicks in DNA?');
  expect(card.back).toMatch(/^Answer: B\) Ligase/);

  // Delete it: the question and its flashcard go, and deletions are queued for sync.
  await page.fill('#bank-search', 'seals');
  await items.first().locator('[data-action="deleteQuestion"]').click();
  await expect(items).toHaveCount(0);
  const left = await page.evaluate(async () => ({
    q: (await window.app.dbGetAll('questions')).length,
    c: (await window.app.dbGetAll('flashcards')).length,
    tomb: JSON.parse(localStorage.getItem('woni_tombstones')),
  }));
  expect(left.q).toBe(2);
  expect(left.c).toBe(2);
  expect(Object.keys(left.tomb.questions)).toHaveLength(1);
  expect(Object.keys(left.tomb.flashcards)).toHaveLength(1);
});

test('test results list every answer; a reported question leaves tests until fixed', async ({ page }) => {
  await guestWithQuestions(page);
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 3));
  for (let i = 0; i < 3; i++) {
    await page.locator('.option-btn').first().click();
    await page.click('#next-q-btn');
  }
  const review = page.locator('.results-review .review-item');
  await expect(review).toHaveCount(3);
  await expect(page.locator('.results-review')).toContainText('Your answer: A) Primase');
  await expect(page.locator('.results-review')).toContainText('Correct: C) Helicase');

  const target = review.filter({ hasText: 'unwinds' });
  await target.locator('[data-action="reportQuestion"]').click();
  await expect(target.locator('[data-action="reportQuestion"]')).toHaveText('Reported');
  await page.click('[data-action="exitSession"][data-param="force"]');

  const flagged = await page.evaluate(async () => ({
    q: (await window.app.dbGetAll('questions')).filter(q => q.flagged).map(q => q.text),
    c: (await window.app.dbGetAll('flashcards')).filter(c => c.flagged).length,
  }));
  expect(flagged.q).toEqual(['Which enzyme unwinds DNA at the replication fork?']);
  expect(flagged.c).toBe(1);

  // New tests leave it out.
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 10));
  await expect(page.locator('.q-header')).toHaveText('Question 1 of 2');
  await page.evaluate(() => window.app.exitSession('force'));

  // Fixing it in the bank clears the report.
  await page.evaluate(() => window.app.showQuestionBank());
  await page.selectOption('#bank-filter', 'reported');
  await expect(page.locator('#bank-list .bank-item')).toHaveCount(1);
  await page.locator('#bank-list [data-action="editQuestion"]').click();
  await expect(page.locator('#qe-note')).toBeVisible();
  await page.click('[data-action="saveQuestionEdit"]');
  await expect(page.locator('#bank-list .bank-item')).toHaveCount(0);
  const stillFlagged = await page.evaluate(async () => (await window.app.dbGetAll('flashcards')).filter(c => c.flagged).length);
  expect(stillFlagged).toBe(0);
});

test('reporting a flashcard reports its question and skips it next time', async ({ page }) => {
  await guestWithQuestions(page);
  await page.evaluate(() => window.app.startFlashcards());
  await expect(page.locator('.card-count')).toHaveText('Card 1 of 3');
  await page.click('#report-card-btn');
  await expect(page.locator('#report-card-btn')).toHaveText('Reported');
  await page.evaluate(() => window.app.exitSession('force'));
  expect(await page.evaluate(async () => (await window.app.dbGetAll('questions')).filter(q => q.flagged).length)).toBe(1);
  await page.evaluate(() => window.app.startFlashcards());
  await expect(page.locator('.card-count')).toHaveText('Card 1 of 2');
});

test('papers and own library books can be deleted', async ({ page }) => {
  await guestWithQuestions(page);
  await page.evaluate(() => window.app.showView('upload'));
  await expect(page.locator('#paper-list')).toContainText('june-2023.pdf');
  await page.click('[data-action="deletePaper"]');
  await expect(page.locator('#paper-list-wrap')).toBeHidden();

  await page.evaluate(async () => {
    const app = window.app;
    app.state.activeLibExam = 'csir_net';
    await app.dbAdd('library', { name: 'my-notes.pdf', exam: 'csir_net', subject: 'Genetics', type: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]).buffer });
    app.showView('library');
  });
  await expect(page.locator('.book-del')).toHaveCount(1);
  await page.click('.book-del');
  await expect(page.locator('.book-del')).toHaveCount(0);
  expect(await page.evaluate(async () => (await window.app.dbGetAll('library')).length)).toBe(0);
});
