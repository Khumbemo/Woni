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
  try {
    await page.locator('#guest-btn').click({ timeout: 3000 });
  } catch(e) {}

  // Complete Onboarding (if shown)
  try {
    await page.locator('.exam-card').first().click({ timeout: 3000 });
    await page.locator('button:has-text("Continue")').click({ timeout: 1000 });
  } catch(e) {}

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

  // Upload the dummy PDF
  await page.locator('#admin-book-file').setInputFiles(dummyPdfPath);

  // Submit
  await page.locator('#admin-upload-btn').click();

  // Wait for success toast (this also confirms Firebase Storage and Firestore succeeded)
  const toast = page.locator('.toast.success');
  await expect(toast).toBeVisible({ timeout: 15000 });
  await expect(toast).toContainText('Book uploaded successfully to cloud!');

  // Navigate to Library
  await page.locator('.nav-item[data-view="library"]').click();
  await expect(page.locator('#view-library')).toHaveClass(/active/);

  // The library should now fetch from Firestore
  // Wait for the loader to disappear
  await expect(page.locator('.loader')).toHaveCount(0, { timeout: 10000 });

  // Verify the book is rendered in the library under "Playwright Testing"
  await expect(page.locator('text=Playwright Testing')).toBeVisible();
  const bookCard = page.locator('.book-title', { hasText: 'Automated Test Book' });
  await expect(bookCard).toBeVisible();

  // Verify it has the cloud icon
  const cloudIcon = bookCard.locator('xpath=../div[@class="book-icon"]//i[@data-lucide="cloud"]');
  await expect(cloudIcon).toBeVisible();

  // Cleanup dummy file
  fs.unlinkSync(dummyPdfPath);
});
