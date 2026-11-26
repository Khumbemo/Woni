/**
 * Mistake notebook, stars & notes, AI flashcards & summary, reminders, read-aloud.
 */
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

test.setTimeout(90000);
// Requests from a page controlled by the service worker can't be mocked in WebKit.
test.use({ serviceWorkers: 'block' });

async function setup(page) {
  // Record what the app asks the speech engine to say.
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__speaking = false;
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        get speaking() { return window.__speaking; },
        speak(u) { window.__spoken.push(u.text); window.__speaking = true; window.__lastUtterance = u; },
        cancel() { window.__speaking = false; window.__cancelled = (window.__cancelled || 0) + 1; },
      },
    });
  });
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
    app._questsFor = async () => [];
    for (let i = 0; i < 4; i++) {
      await app.dbAdd('questions', { exam: 'csir_net', text: `Question ${i + 1}: which enzyme?`, options: ['w1', 'w2', 'right', 'w3'], answer: 'C', topic: 'Genetics', explanation: 'Because.' });
    }
    await app.dbAdd('flashcards', { exam: 'csir_net', front: 'What is ATP?', back: 'The energy currency of the cell.', nextReview: 0, interval: 0, repetition: 0, ease: 2.5 });
  });
}

const question = (page, n) => page.evaluate(async n => (await window.app.dbGetAll('questions')).find(q => q.text.startsWith(`Question ${n}:`)), n);
const answerAll = async (page, letterFor) => {
  for (;;) {
    // Each step shows either the next question or the results.
    await page.locator('.q-text, .results-box').first().waitFor();
    if (await page.locator('.q-text').count() === 0) break;
    const text = await page.locator('.q-text').innerText();
    const n = Number(text.match(/Question (\d+)/)[1]);
    await page.locator('.option-btn').nth('ABCD'.indexOf(letterFor(n))).click();
    await page.click('#next-q-btn');
  }
};

test('mistake notebook: wrong answers are collected and cleared after 2 right in a row', async ({ page }) => {
  await setup(page);
  // Exam mode: questions 1 and 2 wrong.
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 4));
  await answerAll(page, n => (n <= 2 ? 'A' : 'C'));
  await page.click('[data-action="exitSession"][data-param="force"]');
  await expect.poll(async () => (await question(page, 1))?.mistake?.count).toBe(1);
  expect((await question(page, 3)).mistake).toBeUndefined();

  await page.evaluate(() => window.app.showView('practice'));
  await expect(page.locator('#mistake-count')).toHaveText('2 questions');

  // Review: only the 2 mistakes; get them right twice to clear them.
  for (let round = 1; round <= 2; round++) {
    await page.click('.practice-card[data-action="startMistakeReview"]');
    await expect(page.locator('#session-title')).toHaveText('Mistake Review');
    await expect(page.locator('.q-header')).toContainText('of 2');
    await answerAll(page, () => 'C');
    await page.click('[data-action="exitSession"][data-param="force"]');
    await page.evaluate(() => window.app.showView('practice'));
  }
  await expect(page.locator('#mistake-count')).toHaveText('');
  expect((await question(page, 1)).mistake).toMatchObject({ count: 1, streak: 2 });
  await page.click('.practice-card[data-action="startMistakeReview"]');
  await expect(page.getByText(/Your mistake notebook is empty/)).toBeVisible();

  // The Question Bank can show the notebook.
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 4, { instant: true }));
  await answerAll(page, n => (n === 4 ? 'B' : 'C'));
  await page.click('[data-action="exitSession"][data-param="force"]');
  await page.evaluate(() => window.app.showQuestionBank());
  await page.selectOption('#bank-filter', 'mistakes');
  await expect(page.locator('#bank-list .bank-item')).toHaveCount(1);
  await expect(page.locator('#bank-list .bank-item')).toContainText('Question 4');
  await expect(page.locator('#bank-list .bank-item')).toContainText('Missed 1×');
});

test('stars and notes on questions and flashcards, and practising starred items', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 1, { instant: true }));
  await page.locator('.option-btn').nth(2).click();
  const fb = page.locator('#instant-feedback');
  await fb.locator('[data-action="toggleStar"]').click();
  await expect(fb.locator('[data-action="toggleStar"]')).toHaveText('★ Starred');
  await fb.locator('[data-action="editNote"]').click();
  await expect(page.locator('#note-overlay')).toBeVisible();
  await page.fill('#note-text', 'Helicase unwinds; topoisomerase relieves the twist.');
  await page.click('[data-action="saveNote"]');
  await expect(fb.locator('.item-note')).toContainText('Helicase unwinds');
  await page.click('#next-q-btn');
  await page.click('[data-action="exitSession"][data-param="force"]');

  const starredQ = await page.evaluate(async () => (await window.app.dbGetAll('questions')).filter(q => q.starred).map(q => q.note));
  expect(starredQ).toEqual(['Helicase unwinds; topoisomerase relieves the twist.']);

  // Star a flashcard during review.
  await page.evaluate(() => window.app.startFlashcards());
  await page.locator('#session-content [data-action="toggleStar"]').click();
  await expect(page.locator('#session-content [data-action="toggleStar"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.app.exitSession('force'));

  await page.evaluate(() => window.app.showView('practice'));
  await expect(page.locator('#starred-count')).toHaveText('2 items');
  await page.click('.practice-card[data-action="showStarred"]');
  await expect(page.locator('#starred-list .bank-item')).toHaveCount(2);
  await expect(page.locator('#starred-list')).toContainText('Helicase unwinds');
  await expect(page.locator('#starred-practice-btn')).toHaveText('Practise 1 starred question');
  await page.click('#starred-practice-btn');
  await expect(page.locator('#session-title')).toHaveText('Starred Questions');
  await page.evaluate(() => window.app.exitSession('force'));
  await page.click('.practice-card[data-action="showStarred"]');
  await page.click('#starred-cards-btn');
  await expect(page.locator('#session-title')).toHaveText('Starred Flashcards');
  await expect(page.locator('.card-count')).toHaveText('Card 1 of 1');
  await page.evaluate(() => window.app.exitSession('force'));

  // Removing the note and the star.
  await page.click('.practice-card[data-action="showStarred"]');
  await page.locator('#starred-list [data-action="editNote"]').first().click();
  await page.fill('#note-text', '');
  await page.click('[data-action="saveNote"]');
  await page.locator('#starred-list [data-action="toggleStar"]').first().click();
  await expect(page.locator('#starred-list .bank-item')).toHaveCount(1);
});

test('AI flashcards and summary from pasted notes and from book pages', async ({ page }) => {
  await setup(page);
  const prompts = [];
  await page.route('**/woni-ai-proxy.khumbemo.workers.dev/**', async route => {
    const prompt = JSON.parse(route.request().postData()).messages[0].content;
    prompts.push(prompt);
    const reply = prompt.includes('flashcards')
      ? { cards: [
        { front: 'What does helicase do?', back: 'Unwinds the DNA double helix.' },
        { front: 'What does primase make?', back: 'RNA primers.' },
        { front: 'What is ATP?', back: 'Duplicate of an existing card.' },
      ] }
      : { title: 'DNA replication', points: ['Helicase unwinds DNA', 'Primase makes primers'], keyTerms: [{ term: 'Okazaki fragment', meaning: 'Short lagging-strand piece' }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) });
  });

  await page.evaluate(() => window.app.showView('practice'));
  await page.click('.practice-card[data-action="showAiNotes"]');
  await page.fill('#ai-text', 'Too short');
  await page.click('[data-action="makeAiCards"]');
  await expect(page.getByText(/not enough text/).first()).toBeVisible();

  const notes = 'DNA replication. Helicase unwinds the double helix at the replication fork. Primase lays down short RNA primers. DNA polymerase III extends them; the lagging strand is made in Okazaki fragments joined by ligase.';
  await page.fill('#ai-text', notes);
  await page.click('[data-action="makeAiCards"]');
  await expect(page.locator('.ai-card')).toHaveCount(3);
  expect(prompts.at(-1)).toContain('Okazaki fragments joined by ligase');
  await page.fill('[data-ai-front="0"]', 'What does helicase do at the fork?');
  await page.uncheck('[data-ai-keep="1"]');
  await page.click('[data-action="saveAiCards"]');
  await expect(page.getByText('Saved 1 flashcard (1 already in your deck). They\'re due for review now.')).toBeVisible();
  const fronts = await page.evaluate(async () => (await window.app.dbGetAll('flashcards')).map(c => c.front).sort());
  expect(fronts).toEqual(['What does helicase do at the fork?', 'What is ATP?']);

  await page.click('[data-action="makeAiSummary"]');
  await expect(page.locator('.ai-summary h3')).toHaveText('DNA replication');
  await expect(page.locator('.ai-summary')).toContainText('Okazaki fragment');
  const download = page.waitForEvent('download');
  await page.click('[data-action="exportSummaryPDF"]');
  expect((await download).suggestedFilename()).toMatch(/^Woni_Summary_\d+\.pdf$/);

  // A book on the shelf: only the chosen pages are sent.
  const { jsPDF } = require('jspdf');
  const doc = new jsPDF();
  for (let p = 1; p <= 4; p++) {
    if (p > 1) doc.addPage();
    doc.text(`Page ${p}: the citric acid cycle oxidises acetyl-CoA to carbon dioxide and makes NADH and FADH2.`, 10, 20, { maxWidth: 180 });
  }
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('base64');
  await page.evaluate(async pdf => {
    const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
    await window.app.dbAdd('library', { name: 'biochem.pdf', exam: 'csir_net', subject: 'Biochemistry', type: 'application/pdf', data: bytes.buffer });
  }, pdf);
  await page.click('[data-action="hideAiNotes"]');
  await page.click('.practice-card[data-action="showAiNotes"]');
  await page.selectOption('#ai-source', { label: 'Book: biochem.pdf' });
  await expect(page.locator('#ai-pages-wrap')).toBeVisible();
  await page.fill('#ai-page-from', '2');
  await page.fill('#ai-page-to', '3');
  await page.click('[data-action="makeAiSummary"]');
  await expect(page.locator('.ai-summary')).toBeVisible();
  const last = prompts.at(-1);
  expect(last).toContain('Page 2:');
  expect(last).toContain('Page 3:');
  expect(last).not.toContain('Page 1:');
  expect(last).not.toContain('Page 4:');
  await page.fill('#ai-page-to', '30');
  await page.click('[data-action="makeAiSummary"]');
  await expect(page.getByText('Choose at most 15 pages at a time.').first()).toBeVisible();
});

test('daily reminder: calendar file and in-app reminder', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.showView('settings'));
  await page.click('[data-action="saveReminder"]');
  await expect(page.getByText('Choose a time for your reminder.').first()).toBeVisible();
  await page.fill('#reminder-time', '19:30');
  await page.click('[data-action="saveReminder"]');
  await expect(page.getByText('Reminder set for 19:30.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('woni_reminder_time'))).toBe('19:30');

  const download = page.waitForEvent('download');
  await page.click('[data-action="addReminderToCalendar"]');
  const file = await download;
  expect(file.suggestedFilename()).toBe('woni-daily-study.ics');
  const ics = require('fs').readFileSync(await file.path(), 'utf8');
  expect(ics).toMatch(/DTSTART:\d{8}T193000/);
  expect(ics).toContain('RRULE:FREQ=DAILY');

  // When the time comes and the goal isn't met, Woni reminds you.
  await page.evaluate(() => window.app._fireReminder());
  await expect(page.getByText(/Time to study! 50 XP to today's goal\./)).toBeVisible();
  // After a reload the time is still set.
  await page.reload();
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });
  await page.evaluate(() => window.app.showView('settings'));
  await expect(page.locator('#reminder-time')).toHaveValue('19:30');
});

test('read aloud: questions with options, flashcard sides, and stop', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 1, { instant: true }));
  const listen = page.locator('.q-tools [data-action="readAloud"]');
  await listen.click();
  const spoken = await page.evaluate(() => window.__spoken.at(-1));
  expect(spoken).toMatch(/^Question \d: which enzyme\? Option A: w1\. Option B: w2\. Option C: right\. Option D: w3\.$/);
  await expect(listen).toHaveText('⏹ Stop');
  await listen.click(); // stop
  await expect(listen).toHaveText('🔊 Listen');
  // Moving on stops speech too.
  await listen.click();
  await page.locator('.option-btn').nth(2).click();
  await page.click('#next-q-btn');
  expect(await page.evaluate(() => window.__speaking)).toBe(false);
  await page.click('[data-action="exitSession"][data-param="force"]');

  await page.evaluate(() => window.app.startFlashcards());
  await page.locator('#session-content [data-action="readAloud"]').click();
  expect(await page.evaluate(() => window.__spoken.at(-1))).toBe('What is ATP?');
  await page.evaluate(() => { window.__speaking = false; window.__lastUtterance.onend(); }); // speech finished
  await page.click('#show-answer-btn');
  await page.locator('#session-content [data-action="readAloud"]').click();
  expect(await page.evaluate(() => window.__spoken.at(-1))).toBe('What is ATP?. Answer: The energy currency of the cell.');
});
