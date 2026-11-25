/**
 * Practice mode, XP, daily goal, daily challenge, badges, calendar.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

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
    app.confirmAction = async () => true;
    // Every question's answer is C, so tests can answer right or wrong on purpose.
    const topics = ['Genetics', 'Ecology', 'Cell Biology'];
    for (let i = 0; i < 6; i++) {
      const topic = topics[i % 3];
      const q = { exam: 'csir_net', text: `${topic} question ${i + 1}?`, options: ['w1', 'w2', 'right', 'w3'], answer: 'C', topic, explanation: `Because ${i + 1}.` };
      await app.dbAdd('questions', q);
      await app.dbAdd('flashcards', { questionSyncId: q.syncId, exam: 'csir_net', front: q.text, back: 'C', topic, nextReview: 0, interval: 0, repetition: 0, ease: 2.5 });
    }
    await app.dbPut('topics', { id: 'csir_net_Genetics', exam: 'csir_net', name: 'Genetics', mastery: 90 });
    await app.dbPut('topics', { id: 'csir_net_Ecology', exam: 'csir_net', name: 'Ecology', mastery: 5 });
    await app.dbPut('topics', { id: 'csir_net_Cell Biology', exam: 'csir_net', name: 'Cell Biology', mastery: 50 });
    app.showView('dashboard');
  });
}

const totalXp = page => page.evaluate(async () => (await window.app.getStudyStats()).totalXp);
const answer = (page, letter) => page.locator('.option-btn').nth('ABCD'.indexOf(letter)).click();

test('practice mode shows each answer at once, counts combos and awards XP', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.showView('practice'));
  await page.click('.practice-card[data-action="showMockTestSetup"]');
  await page.fill('#mock-q-count', '4');
  await page.check('#mock-instant');
  await page.click('[data-action="startMockTest"]');
  await expect(page.locator('.q-header')).toContainText('Practice mode');

  // Wrong answer: marked, the right one shown, explanation, locked.
  await answer(page, 'A');
  const fb = page.locator('#instant-feedback');
  await expect(fb).toContainText('Not quite');
  await expect(fb).toContainText('Answer: C) right');
  await expect(fb).toContainText('+2 XP');
  await expect(page.locator('.option-btn.wrong')).toHaveCount(1);
  await expect(page.locator('.option-btn.correct')).toHaveCount(1);
  await expect(page.locator('.option-btn').nth(2)).toBeDisabled();
  await page.keyboard.press('c'); // ignored: the first answer is final
  await expect(fb).toContainText('Not quite');
  await page.keyboard.press('Enter');

  // Three right answers in a row.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('c');
    await expect(fb).toContainText('Correct!');
    await expect(fb).toContainText('+10 XP');
    if (i >= 1) await expect(fb).toContainText(`${i + 1} in a row`);
    await page.click('#next-q-btn');
  }
  await expect(page.locator('.xp-earned')).toHaveText('+32 XP · best streak 3 in a row 🔥');
  await expect.poll(() => totalXp(page)).toBe(32);
  await page.click('[data-action="exitSession"][data-param="force"]');

  // The choice is remembered for next time.
  await page.click('.practice-card[data-action="showMockTestSetup"]');
  await expect(page.locator('#mock-instant')).toBeChecked();
});

test('exam mode reveals nothing until the end, then awards XP', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 2));
  await expect(page.locator('.q-header')).not.toContainText('Practice mode');
  await answer(page, 'C');
  await expect(page.locator('#instant-feedback')).toBeHidden();
  await expect(page.locator('.option-btn.correct')).toHaveCount(0);
  await answer(page, 'B'); // can still change the answer
  await expect(page.locator('.option-btn.selected')).toHaveCount(1);
  await page.click('#next-q-btn');
  await answer(page, 'C');
  await page.click('#next-q-btn');
  await expect(page.locator('.xp-earned')).toHaveText('+12 XP');
  await expect.poll(() => totalXp(page)).toBe(12);
});

test('daily challenge: 5 mixed questions, weakest topic first, bonus once a day', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#challenge-note')).toContainText('5 mixed questions');
  await page.click('#challenge-btn');
  await expect(page.locator('#session-title')).toHaveText('Daily Challenge');
  await expect(page.locator('.q-text')).toHaveText(/^Ecology question/);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('.q-header')).toContainText(`Question ${i + 1} of 5`);
    seen.push((await page.locator('.q-text').innerText()).split(' question')[0]);
    await answer(page, 'C');
    await page.click('#next-q-btn');
  }
  expect(seen).toEqual(['Ecology', 'Cell Biology', 'Genetics', 'Ecology', 'Cell Biology']);
  await expect(page.locator('.challenge-done')).toContainText('+50 XP bonus');
  await expect.poll(() => totalXp(page)).toBe(100);
  await page.click('[data-action="exitSession"][data-param="force"]');
  await expect(page.locator('#challenge-note')).toContainText('done');
  await expect(page.locator('#challenge-btn')).toHaveText('Play again');

  // Replaying gives question XP but no second bonus.
  await page.click('#challenge-btn');
  for (let i = 0; i < 5; i++) { await answer(page, 'C'); await page.click('#next-q-btn'); }
  await expect(page.locator('.challenge-done')).toHaveCount(0);
  await expect.poll(() => totalXp(page)).toBe(150);
});

test('daily goal ring, celebration, badges and calendar', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.showView('settings'));
  await page.selectOption('#daily-goal-select', '30');
  await page.evaluate(() => window.app.showView('dashboard'));
  await expect(page.locator('#goal-ring')).toHaveAttribute('aria-label', 'Daily goal: 0 of 30 XP');
  await expect(page.locator('#level-name')).toHaveText('Level 1 · Novice');

  await page.evaluate(() => window.app.startTopicTest('csir_net', [], 3, { instant: true }));
  // The first answer unlocks a badge; the third reaches the goal. Toasts last ~4s, so check each as it happens.
  await answer(page, 'C');
  await expect(page.getByText('Badge unlocked: 🌱 First Steps!')).toBeVisible();
  await page.click('#next-q-btn');
  for (let i = 0; i < 2; i++) { await answer(page, 'C'); await page.click('#next-q-btn'); }
  await expect(page.getByText(/Daily goal reached: 30 XP today!/)).toBeVisible();
  await page.click('[data-action="exitSession"][data-param="force"]');
  await expect(page.locator('#goal-ring')).toHaveAttribute('aria-label', 'Daily goal: 30 of 30 XP');
  await expect(page.locator('#goal-ring .ring-fill.done')).toHaveCount(1);
  await expect(page.locator('#dash-streak')).toHaveText('1d');
  await expect(page.locator('#level-detail')).toHaveText('30 XP total · 20 XP to level 2');

  await page.evaluate(() => window.app.showView('progress'));
  await expect(page.locator('#badges-count')).toHaveText(/^1 of \d+$/);
  await expect(page.locator('.badge-tile.unlocked')).toContainText('First Steps');
  await expect(page.locator('.study-calendar .cal-cell.l4')).toHaveCount(1);
  await expect(page.locator('#calendar-summary')).toContainText('Current streak 1 day');
});

test('flashcards and focus sessions earn XP and study time', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.startFlashcards());
  for (let i = 0; i < 2; i++) {
    await page.click('#show-answer-btn');
    await page.click('#sm2-btns [data-param="4"]');
  }
  await expect.poll(() => totalXp(page)).toBe(10);
  await page.evaluate(() => window.app.exitSession('force'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('woni-focus-complete')));
  await expect(page.getByText(/Focus session complete: \+25 XP/)).toBeVisible();
  await expect.poll(() => totalXp(page)).toBe(35);
  const stats = await page.evaluate(() => window.app.getStudyStats());
  expect(stats.cards).toBe(2);
  expect(stats.focusSessions).toBe(1);
  expect(stats.seconds).toBeGreaterThanOrEqual(25 * 60);
});

test('confetti is skipped when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.evaluate(() => window.app.celebrate('Well done'));
  await expect(page.getByText('Well done')).toBeVisible();
  await expect(page.locator('.confetti')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.app.celebrate('Again'));
  await expect(page.locator('.confetti span')).toHaveCount(60);
});
