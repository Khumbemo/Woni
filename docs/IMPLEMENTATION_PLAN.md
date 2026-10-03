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

## Phase 2: Recommended next (needs your decision or Firebase console access)

These are real issues I did **not** change, because they alter behaviour or need credentials or console settings.

1. **Security: every signed-in user is effectively an admin.** The admin upload panel is shown to any logged-in user, and `firestore.rules`/`storage.rules` let any authenticated user create `library_books`, which every user then sees.
   *Plan:* set a custom claim (`admin: true`) with the Admin SDK on your account. Change the rules to `allow create: if request.auth.token.admin == true`, and show the panel only when `getIdTokenResult()` has `claims.admin`. Deploy with `firebase deploy --only firestore:rules,storage`.
2. **Security/cost: the AI proxy is open.** `worker/index.js` forwards any body to Groq with your key, and the 5-use freemium limit exists only in `localStorage`, which anyone can clear.
   *Plan:* in the Worker, allow only the `llama-3.3-70b-versatile` model, cap `max_tokens`, and add per-IP rate limiting (Cloudflare Rate Limiting binding or KV counter). Optionally require a Firebase ID token.
3. **Cloud sync will hit Firestore's 1 MiB document limit.** All papers (up to 10 KB of text each), questions and tests go into a single `users/{uid}` doc. Every sync after the first also asks "overwrite local?".
   *Plan:* move to per-record subcollections (`users/{uid}/questions/{id}` …) with `updatedAt`-based merge, and drop paper text from sync.
4. **Cloud books are hidden from guests**, even though the rules allow public read and the panel says "for all users". *Plan:* drop the `this.state.user` check in `renderLibraryContent` (the timeout from fix 16 makes this safe offline).
5. **Firebase web config uses the Android `appId`** (`1:…:android:…`). *Plan:* register a Web app in the Firebase console and use its config. The current config works for Auth and Firestore but not for Analytics or App Check.
6. **PWA manifest conflict.** `index.html` links `/manifest.json` (Vite logo icons), and the plugin injects `/manifest.webmanifest` (data-URI icon). The browser uses the first one. *Plan:* keep a single manifest (in `vite.config.js`) with real 192/512 PNG icons, and delete `public/manifest.json` and the unused `public/sw.js`.

## Phase 3: Quality and performance (lower priority)

- Main bundle is 1.68 MB (Firebase compat, pdf.js, tesseract, jsPDF, Chart.js). Lazy-load pdf.js/tesseract in Upload, jsPDF on export, and Chart.js in Stats. Migrate Firebase compat to the modular SDK.
- The "Hard" flashcard button sends quality 2, which SM-2 treats as a lapse (a reset to day 1). Consider relabelling it or mapping Hard to 3, as Anki does.
- Every AI call (including chat) uses up a "freemium analysis". Decide whether chat should count.
- `secondPassVerify`, `isRelevantToExam`, `makeFallbackTopics` and `runBenchmarkSuite` are defined but never called. Wire them in or remove them.
- Particle colour is fixed at start-up, so it doesn't follow a theme change.
- `openLocalBook` calls `window.open` after an `await`, which Safari's pop-up blocker may block.
