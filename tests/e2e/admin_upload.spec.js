import { test, expect } from '@playwright/test';

test('Admin Upload Panel and Cloud Library Sync', async ({ page }) => {
  await page.goto('/');

  // Wait for full init (IndexedDB ready) instead of racing the auth overlay;
  // the first load can be slow while Vite optimises dependencies.
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });

  // Enter guest mode via the real button.
  await page.locator('#guest-btn').click();
  await expect(page.locator('#auth-overlay')).toBeHidden();

  // First run: onboarding must appear for a new guest.
  const onboarding = page.locator('#onboarding-overlay');
  await expect(onboarding).toBeVisible();
  await page.locator('.exam-checkbox input[type="checkbox"]').first().check();
  await page.locator('#save-exams-btn').click();
  await expect(onboarding).toBeHidden();

  await expect(page.locator('#view-dashboard')).toHaveClass(/active/, { timeout: 15000 });

  // Navigate to Settings
  await page.locator('.nav-item[data-view="settings"]').click();
  await expect(page.locator('#view-settings')).toHaveClass(/active/);

  // Inject a fake user to reveal the Admin Upload Panel
  await page.evaluate(() => {
    window.app.state.user = { uid: 'test_admin_123', email: 'admin@test.com' };
    window.app.updateAuthUI();
  });

  const adminPanel = page.locator('#admin-upload-panel');
  await expect(adminPanel).not.toHaveClass(/hidden/);

  // Fill out the Admin Book Upload Form
  await page.locator('#admin-book-title').fill('Automated Test Book');
  await page.locator('#admin-book-subject').fill('Playwright Testing');
  await page.locator('#admin-book-exam').selectOption('csir_net');
  await expect(page.locator('#admin-book-title')).toHaveValue('Automated Test Book');

  // Navigate to Library; curated content for the selected exam should render.
  await page.locator('.nav-item[data-view="library"]').click();
  await expect(page.locator('#view-library')).toHaveClass(/active/);
  await expect(page.locator('#lib-subjects .lib-subject-group').first()).toBeVisible({ timeout: 15000 });
});
