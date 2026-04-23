/**
 * Woni E2E Test Suite
 * 
 * Tests the primary user flows with robust state management.
 * Since Firebase uses placeholder credentials, we work WITH the auth
 * flow rather than against it, and use direct JS evaluation for setup.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to app and fully reset state. After this, the page is loaded
 * and we wait for the app to initialize. Because Firebase uses placeholder
 * keys, we may see either the auth overlay or the dashboard depending on
 * Firebase's behavior. This helper normalizes that.
 */
async function freshLoad(page) {
  await page.goto('/');

  // Clear ALL persistent state
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    // Unregister service workers that may cache stale responses
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
    }
  });

  // Reload so the app re-initializes with a clean slate
  await page.reload();

  // Wait for the full app to initialize:
  //  1. window.app exists (module loaded + DOMContentLoaded fired)
  //  2. window.app.state.db is not null (IndexedDB ready)
  await page.waitForFunction(() => {
    return window.app &&
           window.app.state &&
           window.app.state.db !== null;
  }, { timeout: 25000 });
}

/**
 * Enter Guest mode and complete onboarding.
 * Uses direct app method calls to bypass Firebase auth timing issues.
 */
async function enterGuestAndOnboard(page) {
  await freshLoad(page);

  // Force guest mode using app API
  await page.evaluate(() => window.app.continueAsGuest());
  
  // Wait a tick for continueAsGuest to finish its async work
  await page.waitForTimeout(500);

  // Show onboarding overlay
  await page.evaluate(() => window.app.showOnboarding());

  // Wait for onboarding overlay to appear
  await page.waitForFunction(() => {
    const el = document.getElementById('onboarding-overlay');
    return el && !el.classList.contains('hidden');
  }, { timeout: 5000 });

  // Select the first two exams
  const checkboxes = page.locator('.exam-checkbox input[type="checkbox"]');
  await checkboxes.nth(0).check();  // CSIR NET
  await checkboxes.nth(1).check();  // UGC NET ENV

  // Save exams
  await page.click('#save-exams-btn');
  
  // Wait for onboarding to complete
  await page.waitForFunction(() => {
    const el = document.getElementById('onboarding-overlay');
    return el && el.classList.contains('hidden');
  }, { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('1. App Bootstrap', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Woni/);
  });

  test('app container becomes visible after init', async ({ page }) => {
    await freshLoad(page);
    const app = page.locator('#app');
    await expect(app).not.toHaveClass(/hidden/);
  });

  test('IndexedDB initializes without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await freshLoad(page);
    await page.waitForTimeout(2000);
    const dbErrors = consoleErrors.filter((e) => e.includes('DB init failed'));
    expect(dbErrors).toHaveLength(0);
  });

  test('IndexedDB is accessible via window.app', async ({ page }) => {
    await freshLoad(page);
    await page.waitForTimeout(2000);
    const dbReady = await page.evaluate(() => window.app && window.app.state.db !== null);
    expect(dbReady).toBe(true);
  });
});

test.describe('2. Guest Mode & Onboarding', () => {
  test('guest mode sets localStorage flag', async ({ page }) => {
    await freshLoad(page);
    // Trigger guest mode directly
    await page.evaluate(() => window.app.continueAsGuest());
    const flag = await page.evaluate(() => localStorage.getItem('woni_guest_mode'));
    expect(flag).toBe('true');
  });

  test('onboarding shows 5 exam options', async ({ page }) => {
    await freshLoad(page);
    await page.evaluate(() => window.app.showOnboarding());
    await page.waitForSelector('#onboarding-overlay:not(.hidden)', { timeout: 5000 });
    const count = await page.locator('.exam-checkbox').count();
    expect(count).toBe(5);
  });

  test('selecting exams and saving completes onboarding', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const dashboard = page.locator('#view-dashboard');
    await expect(dashboard).toHaveClass(/active/);
  });

  test('saving with no exams selected triggers error toast', async ({ page }) => {
    await freshLoad(page);
    await page.evaluate(() => window.app.showOnboarding());
    await page.waitForSelector('#onboarding-overlay:not(.hidden)', { timeout: 5000 });

    // Uncheck all just in case
    const checkboxes = page.locator('.exam-checkbox input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).uncheck();
    }

    await page.click('#save-exams-btn');
    const toast = page.locator('#toast-mount');
    await expect(toast).toContainText('select at least one exam', { timeout: 5000 });
  });
});

test.describe('3. Dashboard', () => {
  test('displays stats grid with study time, mastery, and streak', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await expect(page.locator('#dash-study-time')).toBeVisible();
    await expect(page.locator('#dash-mastery')).toBeVisible();
    await expect(page.locator('#dash-streak')).toBeVisible();
  });

  test('displays a motivational quote', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const quoteText = page.locator('#quote-text');
    await expect(quoteText).not.toBeEmpty();
  });

  test('shows the buddy message', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const buddyMsg = page.locator('#buddy-msg');
    await expect(buddyMsg).not.toBeEmpty();
  });

  test('active exam badge shows after onboarding', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const badge = page.locator('#active-exam-badge-dash');
    await expect(badge).not.toHaveClass(/hidden/);
    await expect(badge).toContainText(/CSIR NET/);
  });
});

test.describe('4. Tab Navigation', () => {
  const views = [
    { label: 'Library', view: 'library' },
    { label: 'Upload', view: 'upload' },
    { label: 'Practice', view: 'practice' },
    { label: 'Stats', view: 'progress' },
    { label: 'Settings', view: 'settings' },
    { label: 'Home', view: 'dashboard' },
  ];

  for (const { label, view } of views) {
    test(`navigating to ${label} activates view-${view}`, async ({ page }) => {
      await enterGuestAndOnboard(page);
      await page.click(`.nav-item[data-view="${view}"]`);
      const section = page.locator(`#view-${view}`);
      await expect(section).toHaveClass(/active/);
    });
  }
});

test.describe('5. Settings', () => {
  test('API key input is visible in settings', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await expect(page.locator('#api-key-input')).toBeVisible();
  });

  test('saving invalid API key shows error toast', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await page.fill('#api-key-input', 'bad_key_123');
    await page.evaluate(() => window.app.saveApiKey());
    const toast = page.locator('#toast-mount');
    await expect(toast).toContainText('gsk_', { timeout: 5000 });
  });

  test('saving valid API key shows success toast', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await page.fill('#api-key-input', 'gsk_test_valid_key_1234567890');
    await page.evaluate(() => window.app.saveApiKey());
    const toast = page.locator('#toast-mount');
    await expect(toast).toContainText('saved', { timeout: 5000 });
  });

  test('theme select has 3 options', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await expect(page.locator('#theme-select option')).toHaveCount(3);
  });

  test('switching to light theme updates body class', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await page.selectOption('#theme-select', 'light');
    await expect(page.locator('body')).toHaveClass(/light-theme/);
  });

  test('switching to dark theme updates body class', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="settings"]');
    await page.selectOption('#theme-select', 'dark');
    await expect(page.locator('body')).toHaveClass(/dark-theme/);
  });
});

test.describe('6. Upload View', () => {
  test('shows file input and analyze button', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="upload"]');
    await expect(page.locator('#view-upload')).toHaveClass(/active/);
    await expect(page.locator('#file-input')).toBeAttached();
    await expect(page.locator('#start-analysis-btn')).toBeVisible();
  });
});

test.describe('7. Library View', () => {
  test('renders exam tabs and subject content', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="library"]');
    await expect(page.locator('#lib-exam-tabs')).not.toBeEmpty();
    await expect(page.locator('#lib-subjects')).not.toBeEmpty();
  });
});

test.describe('8. Practice View', () => {
  test('practice view activates', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.click('.nav-item[data-view="practice"]');
    await expect(page.locator('#view-practice')).toHaveClass(/active/);
  });
});

test.describe('9. Toast System', () => {
  test('toast mount exists in DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#toast-mount')).toBeAttached();
  });

  test('custom toast event renders a visible toast', async ({ page }) => {
    await freshLoad(page);
    await page.waitForTimeout(2000); // let Preact mount

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('woni-toast', {
        detail: { message: 'E2E Test Toast', type: 'success' }
      }));
    });

    await expect(page.locator('#toast-mount')).toContainText('E2E Test Toast', { timeout: 5000 });
  });

  test('toast auto-dismisses after ~4 seconds', async ({ page }) => {
    await freshLoad(page);
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('woni-toast', {
        detail: { message: 'AutoDismiss', type: 'info' }
      }));
    });

    await expect(page.locator('#toast-mount')).toContainText('AutoDismiss', { timeout: 3000 });
    await page.waitForTimeout(5000);
    await expect(page.locator('#toast-mount')).not.toContainText('AutoDismiss');
  });

  test('showToast helper works through app object', async ({ page }) => {
    await freshLoad(page);
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.app.showToast('Helper Toast', 'error'));
    await expect(page.locator('#toast-mount')).toContainText('Helper Toast', { timeout: 5000 });
  });
});

test.describe('10. Data Integrity', () => {
  test('selected exams persist to localStorage', async ({ page }) => {
    await enterGuestAndOnboard(page);

    const exams = await page.evaluate(() => localStorage.getItem('woni_user_exams'));
    expect(exams).toBeTruthy();
    const parsed = JSON.parse(exams);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('csir_net');
    expect(parsed[1].id).toBe('ugc_net_env');
  });

  test('setup_done flag is set after onboarding', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const setupDone = await page.evaluate(() => localStorage.getItem('woni_setup_done'));
    expect(setupDone).toBe('true');
  });

  test('guest_mode flag is set', async ({ page }) => {
    await enterGuestAndOnboard(page);
    const guestMode = await page.evaluate(() => localStorage.getItem('woni_guest_mode'));
    expect(guestMode).toBe('true');
  });

  test('API key persists to localStorage when saved', async ({ page }) => {
    await enterGuestAndOnboard(page);
    await page.evaluate(() => {
      document.getElementById('api-key-input').value = 'gsk_persistence_test';
      window.app.saveApiKey();
    });
    const key = await page.evaluate(() => localStorage.getItem('woni_groq_key'));
    expect(key).toBe('gsk_persistence_test');
  });
});
