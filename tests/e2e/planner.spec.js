/**
 * Study planner, exam countdown and plan, daily quests, mixed question formats.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90000);

const dayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function setup(page, { withData = true } = {}) {
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
  if (!withData) return;
  await page.evaluate(async () => {
    const app = window.app;
    app.confirmAction = async () => true;
    const topics = ['Genetics', 'Ecology', 'Cell Biology'];
    const answers = ['Helicase', 'Ligase', 'Primase', 'Gyrase', 'Telomerase', 'Polymerase', 'Kinase', 'Lipase', 'Amylase', 'Protease', 'Nuclease', 'Synthase', 'Catalase', 'Oxidase', 'Reductase', 'Hydrolase'];
    for (let i = 0; i < 16; i++) {
      const topic = topics[i % 3];
      const right = answers[i];
      const options = [right, `Wrong ${i}a`, `Wrong ${i}b`, `Wrong ${i}c`];
      await app.dbAdd('questions', { exam: 'csir_net', text: `Which enzyme number ${i + 1}?`, options, answer: 'A', topic, explanation: `It is ${right}.` });
    }
    await app.dbPut('topics', { id: 'csir_net_Genetics', exam: 'csir_net', name: 'Genetics', frequency: 80, mastery: 10 });
    await app.dbPut('topics', { id: 'csir_net_Ecology', exam: 'csir_net', name: 'Ecology', frequency: 40, mastery: 40 });
    await app.dbPut('topics', { id: 'csir_net_Cell Biology', exam: 'csir_net', name: 'Cell Biology', frequency: 60, mastery: 80 });
    app.showView('dashboard');
  });
}

const totalXp = page => page.evaluate(async () => (await window.app.getStudyStats()).totalXp);

test('existing data survives the database upgrade that adds planner tasks', async ({ page }) => {
  // Prepare the old database from a page of the same site where the app isn't running.
  await page.goto('/icons/icon.svg');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise(r => { const req = indexedDB.deleteDatabase('woni_db'); req.onsuccess = req.onerror = req.onblocked = r; });
    // An old (version 4) database with one question, as an existing user has.
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('woni_db', 4);
      req.onupgradeneeded = () => {
        const q = req.result.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
        q.createIndex('exam', 'exam');
        q.add({ exam: 'csir_net', text: 'Old question?', options: ['a', 'b'], answer: 'A' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });
  const after = await page.evaluate(async () => ({
    version: window.app.state.db.version,
    stores: [...window.app.state.db.objectStoreNames],
    questions: (await window.app.dbGetAll('questions')).map(q => q.text),
  }));
  expect(after.version).toBe(5);
  expect(after.stores).toContain('tasks');
  expect(after.questions).toEqual(['Old question?']);
});

test('planner: add, tick (XP once), untick and delete tasks; due tasks show on the dashboard', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#today-tasks')).toContainText('No tasks yet.');
  await page.click('#plan-card [data-action="showPlanner"]');
  await expect(page.locator('#planner-overlay')).toBeVisible();
  await expect(page.locator('#task-title-input')).toBeFocused();

  await page.fill('#task-due-input', dayKey(0));
  await page.fill('#task-title-input', 'Read Lehninger chapter 5');
  await page.keyboard.press('Enter'); // Enter in the title box adds the task
  await expect(page.locator('#task-title-input')).toHaveValue('');
  await page.fill('#task-title-input', 'Make notes on the Krebs cycle');
  await page.click('[data-action="addTask"]');
  await page.fill('#task-title-input', 'Old overdue task');
  await page.fill('#task-due-input', dayKey(-2));
  await page.click('[data-action="addTask"]');
  await page.click('[data-action="addTask"]'); // empty: refused
  await expect(page.getByText('Write what you want to do.').first()).toBeVisible();

  const list = page.locator('#planner-list');
  await expect(list.locator('.task-group')).toHaveText(['Overdue 1', 'Today 1', 'No date 1']);

  const row = list.locator('.task-row', { hasText: 'Read Lehninger' });
  await row.locator('input[type="checkbox"]').click();
  await expect(page.getByText('Task done: +5 XP')).toBeVisible();
  await expect(list.locator('.task-group').last()).toHaveText('Done 1');
  // +5 for the task, and +20 more if today's quests include "Tick off a planner task".
  const taskQuest = await page.evaluate(async () => (await window.app.getTodayQuests()).some(q => q.id === 'task'));
  const expected = 5 + (taskQuest ? 20 : 0);
  await expect.poll(() => totalXp(page)).toBe(expected);
  // Untick and tick again: no second reward.
  await list.locator('.task-row', { hasText: 'Read Lehninger' }).locator('input').click();
  await list.locator('.task-row', { hasText: 'Read Lehninger' }).locator('input').click();
  await page.waitForTimeout(300);
  expect(await totalXp(page)).toBe(expected);

  await list.locator('.task-row', { hasText: 'Krebs' }).locator('[data-action="deleteTask"]').click();
  await expect(list).not.toContainText('Krebs');

  await page.click('[data-action="hidePlanner"]');
  await expect(page.locator('#today-tasks .task-row')).toHaveCount(1); // only the overdue one is still due
  await expect(page.locator('#today-tasks .task-row.overdue')).toContainText('Old overdue task');
});

test('exam date, countdown and a study plan that can be rebuilt and started', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.showPlanner());
  await expect(page.locator('#planner-countdown')).toContainText('Set the date');
  await page.click('[data-action="buildPlan"]');
  await expect(page.getByText('Set your exam date first.')).toBeVisible();

  await page.fill('#exam-date-input', dayKey(21));
  await page.click('[data-action="saveExamDate"]');
  await expect(page.locator('#planner-countdown')).toHaveText(`21 days to CSIR NET (${dayKey(21)})`);
  await page.click('[data-action="buildPlan"]');
  await expect(page.getByText(/Study plan ready: 21 daily tasks/)).toBeVisible();
  const count = () => page.evaluate(async () => (await window.app.dbGetAll('tasks')).filter(t => t.source === 'plan').length);
  expect(await count()).toBe(21);
  await expect(page.locator('#planner-list .task-group').first()).toHaveText('Today 1');
  await expect(page.locator('#planner-list')).toContainText('Full mock test');
  await expect(page.locator('#planner-list')).toContainText('Revise weakest topics: Genetics');

  // Rebuilding replaces the plan instead of adding a second copy.
  await page.click('[data-action="buildPlan"]');
  await expect.poll(count).toBe(21);

  // The dashboard shows the countdown and today's plan task; Start opens practice for that topic.
  await page.click('[data-action="hidePlanner"]');
  await expect(page.locator('#plan-countdown')).toContainText('21 days to CSIR NET');
  const todayTask = page.locator('#today-tasks .task-row');
  await expect(todayTask).toHaveCount(1);
  const topic = (await todayTask.innerText()).match(/Study (.+?):/)[1];
  await todayTask.locator('[data-action="startTask"]').click();
  await expect(page.locator('#session-title')).toHaveText('Practice');
  const topics = await page.evaluate(() => window.app.state.session.data.map(q => q.topic));
  expect(new Set(topics)).toEqual(new Set([topic]));
});

test('daily quests show progress, complete as you study, and pay +20 XP once', async ({ page }) => {
  await setup(page);
  const quests = page.locator('#quest-list .quest');
  await expect(quests).toHaveCount(3);
  const list = await page.evaluate(() => window.app.getTodayQuests());
  // Do exactly what each quest asks.
  await page.evaluate(async list => {
    const delta = { answered: { answered: 1 }, correct: { correct: 1 }, cards: { cards: 1 }, focus: { focus: 1 }, challenge: { challenge: true }, bestCombo: { bestCombo: 1 }, tasks: { tasks: 1 }, mixed: { mixed: 1 } };
    for (const q of list) {
      const d = delta[q.metric];
      const step = q.metric === 'bestCombo' ? { bestCombo: q.target } : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === true ? true : v * q.target]));
      await window.app.logActivity(step);
    }
    window.app.showView('dashboard');
  }, list);
  await expect(page.locator('#quest-list .quest.done')).toHaveCount(3);
  await expect(page.locator('#quest-list .quest-count').first()).toHaveText('+20 XP');
  const stats = await page.evaluate(() => window.app.getStudyStats());
  expect(stats.totalXp).toBe(60);
  await page.evaluate(() => window.app.logActivity({ answered: 50, correct: 50, cards: 50, focus: 2, tasks: 5, mixed: 20, bestCombo: 9 }));
  expect(await totalXp(page)).toBe(60);
});

test('mixed practice: every format, right and wrong answers, XP and results', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.app.showView('practice'));
  await page.click('.practice-card[data-action="startMixedPractice"]');
  await expect(page.locator('#session-title')).toHaveText('Mixed Practice');
  const n = await page.evaluate(() => window.app.state.session.data.length);
  expect(n).toBe(10);
  const kinds = new Set();
  for (let i = 0; i < n; i++) {
    const item = await page.evaluate(() => {
      const it = window.app.state.session.data[window.app.state.session.index];
      return JSON.parse(JSON.stringify(it));
    });
    kinds.add(item.kind);
    const wrongOnPurpose = i === 1; // answer one item wrong
    if (item.kind === 'tf') {
      await page.keyboard.press((item.truth !== wrongOnPurpose) ? 't' : 'f');
    } else if (item.kind === 'typed') {
      await expect(page.locator('#typed-answer')).toBeFocused();
      await page.fill('#typed-answer', wrongOnPurpose ? 'Something else' : item.answer.toLowerCase());
      await page.keyboard.press('Enter');
      if (wrongOnPurpose) await expect(page.locator('#instant-feedback')).toContainText(`The answer is ${item.answer}`);
    } else if (item.kind === 'match') {
      for (let k = 0; k < item.pairs.length; k++) {
        await page.selectOption(`#match-${k}`, String(item.choices.indexOf(item.pairs[(k + (wrongOnPurpose ? 1 : 0)) % item.pairs.length].answer)));
      }
      await page.click('#match-submit');
    } else {
      for (let k = 0; k < item.statements.length; k++) {
        if (item.statements[k].truth !== (wrongOnPurpose && k === 0)) await page.check(`#multi-${k}`);
      }
      await page.click('#multi-submit');
    }
    await expect(page.locator('#instant-feedback')).toContainText(wrongOnPurpose ? 'Not quite' : 'Correct!');
    await page.click('#next-q-btn');
  }
  expect(kinds).toEqual(new Set(['tf', 'typed', 'match', 'multi']));
  await expect(page.locator('.res-score')).toHaveText('90%');
  await expect(page.locator('.xp-earned')).toContainText('+92 XP');
  await expect.poll(() => totalXp(page)).toBeGreaterThanOrEqual(92);
  const stats = await page.evaluate(async () => {
    const days = [...(await window.app.getStudyStats()).days.values()];
    return { mixed: days[0].mixed, answered: days[0].answered };
  });
  expect(stats).toEqual({ mixed: 10, answered: 10 });
  // Topic mastery moved.
  const mastery = await page.evaluate(async () => (await window.app.dbGet('topics', 'csir_net_Cell Biology')).mastery);
  expect(mastery).not.toBe(80);
});
