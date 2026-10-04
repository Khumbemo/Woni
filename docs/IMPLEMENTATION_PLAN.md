# Woni — Fix Report & Implementation Plan

_Audit date: 2026-10-03 · branch `claude/app-fix-plan-slctdq`_

## How the app was checked

| Check | Before | After |
|---|---|---|
| `npm ci` (no flags) | ❌ ERESOLVE: `vite-plugin-pwa@1.2.0` doesn't allow `vite@8` | ✅ clean install |
| `npm run build` | ✅ (only with `--legacy-peer-deps` install) | ✅ |
| Unit tests (`vitest`) | 26 pass, but they tested **copies** of the code, not the app | 39 pass, importing the real modules |
| E2E (`playwright`, cold dev server) | 35/36 (admin upload test fails) | 36/36 |

The fixes were also checked by driving the app in Chromium: a new guest now sees onboarding, a mock test whose answer is stored as option text scores 100% when answered correctly, flashcard backs keep their line breaks, the streak counts consecutive days, and pausing/resuming the particle animation reuses the same loop.

---

## Phase 1: Done in this branch

### Build / CI
1. **`npm ci` failed.** `vite-plugin-pwa@1.2.0` only declares peer support up to Vite 7, and the project uses Vite 8. Bumped it to `^1.3.0`, which supports Vite 8, and removed the `--legacy-peer-deps` workaround from CI.
2. **Dev-server forced reload.** On a cold start Vite discovered `workbox-window` late and reloaded the page about 1 s after load. That broke the E2E run and caused a visible flash for developers. It is now pre-bundled through `optimizeDeps.include`.
3. **`dev-dist/` is generated output** and is no longer tracked; it is added to `.gitignore`. `www/` was rebuilt so the Capacitor/Android bundle matches the fixed source.

### App bugs
| # | Bug | Effect on users | Fix |
|---|---|---|---|
| 4 | New guests never saw onboarding (`continueAsGuest` skipped it) | No exam selected, empty Library tabs, and Upload kept asking for an exam | `continueAsGuest` → shared `enterApp()`, which shows onboarding on first run |
| 5 | Returning guests waited on Firebase before the UI appeared | Blank screen on slow or no network, even though guest mode is local-only | Show the app immediately when guest mode is set |
| 6 | Unstyled flash: the stylesheet loads through JS, so `.hidden` elements showed and could be clicked before it arrived | Dead buttons visible on slow connections | Inline critical `.hidden` rule in `index.html` |
| 7 | Sign-up never ran on new Firebase projects | Firebase email-enumeration protection (default since Sept 2023) returns `auth/invalid-credential`, not `auth/user-not-found`, so "Sign In / Sign Up" could only sign in | Fall back to create-user on those codes; map `email-already-in-use` to "Incorrect password" |
| 8 | Mock-test scoring compared the chosen letter with the raw `answer` | Correct answers were marked wrong whenever the AI returned option text or "B) …" | `answerToLetter()` normalises the answer before comparing (also used in the PDF export) |
| 9 | Validation accepted any single letter (e.g. "D" with 2 options) | Broken questions passed review | Validation now uses the same `answerToLetter()` |
| 10 | Question shuffle used `sort(() => 0.5 - Math.random())` | Biased ordering. This comparator is not a uniform shuffle, and the bias depends on the engine | Fisher–Yates `shuffle()`, with a statistical unit test |
| 11 | "Streak" counted every distinct day ever studied | Number was inflated and never reset, and the buddy's "7-day streak" message was wrong | `computeStreak()` counts consecutive days ending today or yesterday |
| 12 | "Study time" was `tests × 20m` | Made-up number | Sum of the recorded session durations |
| 13 | Flashcard back used `/\\n/` (a literal backslash-n), so real newlines were collapsed | "Answer" and "Explanation" ran together on one line | `white-space: pre-line` on `.card-back` |
| 14 | Library opened on CSIR NET even when the user hadn't picked it | Wrong shelf, with no active tab | `syncLibExam()` after loading state or saving exams |
| 15 | Each particle pause/resume re-ran `initParticles()` | `mousemove`/`resize`/`visibilitychange` listeners leaked on every tab switch or practice session | Resume restarts the existing loop |
| 16 | Library waited indefinitely on Firestore when signed in and offline | Skeleton stayed up forever | 5 s timeout, then fall back to local and curated books; stale renders after a tab switch are ignored |
| 17 | Cloud sync failed if any record had an `undefined` field | "Sync failed: Unsupported field value: undefined" | `ignoreUndefinedProperties: true` |
| 18 | Two toasts in the same millisecond shared an ID | Both toasts were dismissed together, with duplicate keys | Incrementing counter |
| 19 | Export revoked the blob URL synchronously, and re-importing the same file did nothing | Download could be cancelled (Firefox/Safari); selecting the same file again didn't trigger import | Revoke after a delay; reset the file input |

### Tests
- Moved pure logic into `src/utils.js` (`shuffle`, `answerToLetter`, `computeStreak`, `parseDuration`, `formatStudyTime`, `sm2`, `parseJSON`) and pointed the unit tests at the real code.
- Rewrote `admin_upload.spec.js`. It used a selector that doesn't exist (`.exam-card`), raced app start-up, and checked for a `.loader` element the app never renders. It now also asserts that a new guest sees onboarding.

---

## Phase 2: Done (security, reliability, polish)

| # | Issue | Fix |
|---|---|---|
| 1 | Any signed-in user could upload books to the shared library | Uploads now require an `admin: true` custom claim, enforced by `firestore.rules` and `storage.rules`; the panel only shows for admins. `scripts/set-admin.mjs` grants or revokes the claim. |
| 2 | The AI proxy forwarded any request with the master Groq key | The Worker fixes the model, caps tokens (2,048), prompt size (60k chars) and messages (20), allows only the app's origins, and rate-limits per IP: 10/min burst and an optional 30/day KV quota. 7 unit tests; `wrangler deploy --dry-run` validates the config. |
| 3 | Cloud sync used one Firestore document (1 MiB cap) and asked "overwrite?" on every sync | One document per record under `users/{uid}/{store}/{syncId}`. Two-way merge where the newest `updatedAt` wins, an incremental pull, and a one-time import of the old format. Covered by a two-device test against a fake Firestore. |
| 4 | Guests couldn't see shared cloud books | The shelf renders local and built-in books immediately, then fetches public cloud books in the background for everyone. |
| 5 | The web build used the Android `appId` | The Firebase config can now be overridden with `VITE_FIREBASE_*` variables (`.env.example`). |
| 6 | Settings: the API key row broke at phone width | Stacked layout, styled input/select, no horizontal overflow at 390 px. |
| 7 | Two conflicting manifests with placeholder icons | A single manifest from `vite.config.js` with 192/512 PNG, maskable and SVG icons plus an Apple touch icon; removed `public/manifest.json`, `sw.js` and `vite.svg`. |
| 8 | Main bundle was 1,676 kB | pdf.js, Tesseract, jsPDF, Chart.js, Firestore and Storage load on first use. Main bundle is now 255 kB (79 kB gzip). |
| 9 | Flashcard "Hard" reset the card | Buttons now use SM-2's own scale (Again 0, Hard 3, Good 4, Easy 5): Hard advances the card and lowers its ease by 0.14. |
| 10 | Smaller items | Only completed analyses use a free analysis. The proxy's own error is shown to the user. The syllabus-relevance check flags off-syllabus items for review. Fallback topics are derived when the AI returns none. Removed the unused `secondPassVerify`/`getImportantTopics`. Particles follow the theme. Local books open with pop-up blockers on. |

## Steps only you can do

These need your Firebase or Cloudflare accounts:

1. **Make yourself admin:** `node scripts/set-admin.mjs you@example.com` with a service-account key (see README).
2. **Deploy the new rules:** `firebase deploy --only firestore:rules,storage`. Until you do, the old rules (any signed-in user can upload) stay live, and per-record sync is refused by the old Firestore rules.
3. **Register a Web app** in the Firebase console and put its `appId` in `.env` as `VITE_FIREBASE_APP_ID`.
4. **Redeploy the Worker** (`cd worker && wrangler deploy`). Optionally create the `USAGE` KV namespace for the daily quota (see `worker/README.md`).

## Known limits

- Sync does not propagate deletions. The app only deletes through Reset and Import, and a reset device re-downloads its data on the next sync.
- Sync compares device clocks. A device whose clock is badly wrong can win or lose conflicts it shouldn't. The incremental pull re-checks a 5-minute overlap.
- Firebase still uses the compat SDK. Moving to the modular SDK would shrink the bundle further.
