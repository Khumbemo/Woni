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

## Phase 3: Done (second audit)

### Dependencies
| Package | Before | After | Why |
|---|---|---|---|
| pdfjs-dist | 3.11 | 6.4 (legacy build) | CVE-2024-4367: a crafted PDF could run JavaScript in versions up to 4.1. Uploaded PDFs are also opened with `isEvalSupported: false`. |
| jspdf | 2.5 | 4.2 | Several published vulnerabilities (critical) in 2.x/3.x. |
| firebase | 10.7 | 12.19 (compat API kept) | Advisories in transitive packages; 12.x keeps `firebase/compat/*`. |
| vite | 8.0 | 8.3 | Dev-server advisories. |

Build-only tools (`vite`, `@preact/preset-vite`, `@capacitor/cli`) moved to devDependencies, and CI now runs on Node 22.
The one remaining production advisory is `@grpc/grpc-js` via Firestore. Even the latest Firestore pins grpc 1.9, the advisories concern grpc **servers**, and the browser build doesn't include grpc (checked: no grpc code in `www/assets`). Remaining dev-tool advisories (firebase-tools, firebase-admin, Capacitor CLI) only affect tools run on a developer machine and have no non-breaking fix yet.

### App bugs
| Area | Bug | Fix |
|---|---|---|
| Import | Importing any JSON (e.g. the wrong file) cleared all study data first | The file is validated before anything is touched, and the replacement happens in one transaction (all or nothing) |
| Reset | `deleteDatabase` was blocked by the app's own open connection, so data could survive "Reset" | Close the connection, wait for the delete, then reload |
| Analysis | Re-analysing a paper reset topic mastery to 0 | Keep mastery and attempts when a topic already exists |
| Analysis | The review list showed only the first 8 items but saved all approved ones | Every item is shown and reviewable |
| Analysis | Duplicates within one batch weren't caught; the "Saved N" count included skipped duplicates | De-duplication across the bank and the batch, with accurate counts |
| Analysis | Scanned PDFs with no text, or an empty AI result, still used a free analysis and showed "complete" | A clear error for each case, and the free use isn't spent; papers are saved only after a successful analysis |
| Flashcards | Showed "Answer: B" without the option text, and mixed cards from every exam | Answer text included; cards record their exam and practice is filtered to the current exam |
| Flashcards | A fast double-tap rated a card twice and skipped the next one | Ratings are ignored while one is saving |
| Mastery | The first test was averaged with 0, so a perfect first test showed 50% | First session sets mastery; later sessions use a 60/40 weighted average |
| Mock test | A negative or empty question count dropped questions | Clamped to 1–100 |
| PDF export | Greek letters and symbols (α, β, ΔG, ≤, H₂O) came out garbled; long questions ran off the page | Symbols are spelled out for the PDF fonts, and text wraps with page breaks; the correct exam name is used |
| Dashboard | "Recommended" cards only showed a toast; the buddy read a stale streak | Tapping a card starts a 10-question test on that topic; the streak is computed directly |
| Focus timer | Counted ticks, so it drifted badly in background tabs (throttled to ~1/min); the progress bar used undefined CSS variables and was invisible | Counts down to a wall-clock end time and catches up when you return; styled card and visible progress bar |
| Sign-in | Enter didn't submit; raw Firebase error text; no password reset | A real form (Enter, password managers), friendly messages, and "Forgot password?" |
| Navigation | Diagonal scrolls and swipes in the exam tabs switched views | Only clearly horizontal swipes outside scrollers and inputs switch views |
| Accessibility | Clickable cards weren't reachable by keyboard | `role="button"`, `tabindex`, and Enter/Space activation for all action cards |
| Settings | "Change exams" opened with nothing ticked; "System" theme ignored OS changes; corrupted saved exams stopped start-up | Pre-ticked current exams; live theme updates; corrupted values ignored |
| Library | Adding a book with no file did nothing; read errors were silent; admin could pick non-PDFs and get a cryptic rules error | Clear messages, storage-full handling, and a PDF/50 MB check before upload |
| Sync | Deletions didn't sync, so an Import was undone by the next sync | Deletion markers ("tombstones") sync like records; newest change wins |
| Offline | pdf.js 6's `.mjs` worker wasn't in the offline cache | `mjs` added to the service-worker precache |

## Phase 4: Done (phone, tablet and desktop)

Checked every page at 390×844 (phone), 844×390 (phone landscape), 820×1180 and 1180×820 (tablet), 1440×900 (laptop) and 1920×1080 (desktop).

| Problem | Fix |
|---|---|
| Test and Focus Timer screens were clipped inside the Practice page, with the tab bar on top (the page's entrance animation leaves a `transform`, which traps `position: fixed` children). Option D was cut off on phones; on laptops the options were a sliver. | Overlays moved out of the views; the test screen fills the screen with a centred 760px column |
| Desktop: the bottom tab bar stretched across the whole screen | From 1024px wide, navigation becomes a left sidebar with the Woni brand; content is centred up to 1080px (1240px on large monitors) |
| Tablets: single-column cards with large empty areas | Two-column practice cards, exam picker and recommendations; three-column topic heatmap |
| Wide screens: the chart and heatmap were stacked with a very tall chart | Side by side from 1280px |
| Phone landscape: the 72px tab bar took a fifth of the screen; the exam picker couldn't scroll to Continue | Compact 52px bar; overlays scroll when taller than the screen |
| `100vh` on phones includes the area behind the address bar, so the tab bar could sit partly off-screen | `100dvh`, plus iPhone safe-area padding (`viewport-fit=cover`) |
| Zoom was disabled (`user-scalable=no`), and 14px inputs made iPhones zoom in on every tap | Zoom allowed; 16px inputs and 44px minimum targets on touch screens |
| Laptops had no keyboard support in tests | A–D/1–4 to answer, Enter for next, Esc to exit; flashcards: Space shows the answer, 1–4 rate (hints show only with a mouse and keyboard) |

Covered by `tests/e2e/responsive.spec.js`: no sideways scrolling on any page, the right navigation per size, and a full-screen session at four sizes.

## Steps only you can do

These need your Firebase or Cloudflare accounts:

1. **Make yourself admin:** `node scripts/set-admin.mjs you@example.com` with a service-account key (see README).
2. **Deploy the new rules:** `npm run deploy:rules` (tested by `npm run test:rules` in the emulators). Until you do, the old rules (any signed-in user can upload) stay live, and per-record sync is refused by the old Firestore rules.
3. **Register a Web app** in the Firebase console and put its `appId` in `.env` as `VITE_FIREBASE_APP_ID`.
4. **Redeploy the Worker** (`cd worker && wrangler deploy`). Optionally create the `USAGE` KV namespace for the daily quota (see `worker/README.md`).

## Known limits

- Reset is per device: a signed-in user's cloud copy is kept and comes back on the next sync (Import is the way to replace data everywhere).
- Sync compares device clocks. A device whose clock is badly wrong can win or lose conflicts it shouldn't. The incremental pull re-checks a 5-minute overlap.
- Firebase still uses the compat SDK. Moving to the modular SDK would shrink the bundle further.
