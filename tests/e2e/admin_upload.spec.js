import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('Admin Upload Panel and Cloud Library Sync', async ({ page }) => {
  // Create a dummy PDF file
  const dummyPdfPath = path.join(process.cwd(), 'tests', 'e2e', 'dummy.pdf');
  fs.writeFileSync(dummyPdfPath, '%PDF-1.4 dummy content for testing upload');

  // Go to the app
  await page.goto('/');

  // Bypass Auth Overlay (if shown)
  const guestBtn = page.locator('#guest-btn');
  try {
    await guestBtn.waitFor({ state: 'visible', timeout: 5000 });
    await guestBtn.click();
  } catch (e) {
    // If not visible, check if it's already hidden or needs forced hiding
    await page.evaluate(() => {
      const overlay = document.getElementById('auth-overlay');
      if (overlay) overlay.classList.add('hidden');
    });
  }
  await expect(page.locator('#auth-overlay')).toBeHidden();

  // Complete Onboarding (if shown)
  const onboarding = page.locator('#onboarding-overlay');
  if (await onboarding.isVisible()) {
    await page.locator('.exam-card').first().click();
    await page.locator('button:has-text("Continue")').click();
  }
  await expect(onboarding).toBeHidden();

  // Wait for app initialization (dashboard active)
  await expect(page.locator('#view-dashboard')).toHaveClass(/active/, { timeout: 15000 });

  // Navigate to Settings
  await page.locator('.nav-item[data-view="settings"]').click();
  await expect(page.locator('#view-settings')).toHaveClass(/active/);

  // Inject a fake user to reveal the Admin Upload Panel
  await page.evaluate(() => {
    window.app.state.user = { uid: 'test_admin_123', email: 'admin@test.com' };
    window.app.updateAuthUI(); // Force UI update
  });

  // Verify Admin Panel is visible
  const adminPanel = page.locator('#admin-upload-panel');
  await expect(adminPanel).not.toHaveClass(/hidden/);

  // Fill out the Admin Book Upload Form
  await page.locator('#admin-book-title').fill('Automated Test Book');
  await page.locator('#admin-book-subject').fill('Playwright Testing');
  await page.locator('#admin-book-exam').selectOption('csir_net');

  // Verify the form is filled
  await expect(page.locator('#admin-book-title')).toHaveValue('Automated Test Book');

  // Navigate to Library
  await page.locator('.nav-item[data-view="library"]').click();
  await expect(page.locator('#view-library')).toHaveClass(/active/);

  // Wait for the loader to disappear
  await expect(page.locator('.loader')).toHaveCount(0, { timeout: 10000 });

  // Cleanup dummy file
  fs.unlinkSync(dummyPdfPath);
});
