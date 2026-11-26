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

## Phase 5: Done (features, AI accuracy, quality, code health)

### AI accuracy
| Problem | Fix |
|---|---|
| **The paper's text was never sent to the AI.** The prompt asked for questions "from the text" but didn't include it, so every analysis made questions up. | The prompt now contains the paper (up to ~12,000 characters, shared between files) and says to extract only questions that appear in it |
| No way to tell a real question from an invented one | The AI must quote the paper for each question. A question whose quote and wording can't be found in the extracted text gets "Not found in your paper (may be AI-invented)" and starts unticked |
| No way to tell where an answer came from | Each answer is labelled "from the paper's key" or "chosen by AI" (in review, the Question Bank and test results) |
| Answers were only format-checked | **Double-check answers with AI**: the AI answers every question again without seeing the first answers; disagreements are flagged, unticked and shown with the reason. It doesn't use a free analysis |
| Wrong answers stayed in the bank | **Report wrong answer** on every question in the test results, and on flashcards. Reported questions leave tests and reviews until fixed in the Question Bank |

The second check catches many mistakes but not all: two AI answers can agree and both be wrong. Answers marked "chosen by AI" are worth checking against a textbook.

### Missing features
- **Question Bank** (Practice): search, filter (reported, disputed, AI answers), edit (question, options, answer, explanation, topic) and delete. Editing updates the question's flashcard; deleting removes it too, on every synced device.
- **Delete** uploaded papers (Upload → Your papers) and your own library books.
- **Scanned PDFs**: pages without a text layer are rendered and read with OCR (up to 10 pages per PDF).
- **Offline OCR**: Tesseract's worker, engine and English data are served by the app (`vite.config.js`), so photo/scan OCR works offline and in the Android app. The files (~11 MB) are cached on first use, not on install.
- **Sync and backups now include library books** (files in Cloud Storage under `users/{uid}/library/`, 50 MB per file) **and Study Assistant chats**. Backup files are version 2; version 1 files still import.

### Quality
- **Colour contrast** is measured with axe-core on 12 screens in both themes (`tests/e2e/contrast.spec.js`). It found white text on orange buttons (2.8:1), orange/amber/red text on the light theme (1.9–3.4:1), grey text just under the limit (4.2:1), heatmap labels (~2:1) and toasts (2.5–3.8:1). All now meet WCAG AA (4.5:1): dark text on orange in the dark theme, a deeper orange (#c2410c) with white text in the light theme, darker status colours in the light theme.
- **Light theme** checked on phone and laptop.
- **Safari / iPhone / iPad**: the build targets Safari and iOS 16.4+ (Vite's default). The code was checked for newer APIs (none used), pop-up blocking after `await` (handled) and input zoom (16px inputs). The whole end-to-end suite now also runs on Safari's engine (WebKit) as desktop Safari, iPhone 13 and iPad, locally and in CI: 162 of 162 passed. Offline OCR was also checked on WebKit.

### Code health
- **ESLint** (`npm run lint`), now part of CI. It found the paper-text bug above.
- **Firebase modular SDK** (`src/firebase.js`) instead of compat: startup JavaScript went from 84.7 KB to 73.8 KB gzipped, even with the new features.
- **Clock-safe sync**: each sync measures the device's offset from Firebase's server clock, and cloud timestamps are stored in server time, so a device with a wrong clock no longer wins conflicts it shouldn't.

### Tests
84 unit tests (sync between simulated devices with wrong clocks, library and chat sync, missing cloud files, AI prompt and second check), 7 rules tests (new: personal library files), 54 end-to-end tests (new: Question Bank, reporting, deletions, contrast in both themes), plus browser checks of offline OCR on a photo and a scanned PDF with all outside network blocked.

## Phase 6: Done (whole papers, security update)

### Long papers are analysed in full
| Problem | Fix |
|---|---|
| Only ~12,000 characters of a paper reached the AI (its start, middle and end), and PDFs were read only to page 20, so most of a 100+ question paper was skipped | Papers are split into parts of ~6,000 characters, cut just before a question number, and every part is analysed. PDFs are read to page 60 (OCR up to 30 scanned pages) |
| The proxy caps each reply at 2,048 tokens (~10 questions of JSON). A longer reply was cut off mid-JSON and the whole analysis came back empty | Complete questions are recovered from a cut-off reply, and the AI is asked again for the text after the last one |
| The answer key at the end of a paper never reached questions far from it | The key is found and sent with every part |
| Hitting the per-minute AI limit failed the analysis | Waits 20, 40 then 60 seconds and retries (not for the daily limit) |
| A failure part-way lost everything | Questions from the parts already done are kept, with a message saying how many parts were missed |

Checked with a generated 13-page, 150-question PDF through the real Upload screen in Chromium and WebKit, with the AI mocked to cut replies off at ~10 questions like the current proxy: all 150 questions found once, in 17 AI requests. With the Worker redeployed (its reply cap is now 8,192 tokens) a paper like that needs about 6 requests.

Each part is one AI request, so the proxy's daily limit (`DAILY_LIMIT`, 30 requests per person) now covers fewer papers. Raise it in `worker/wrangler.toml` if you want to allow more; each request costs you Groq usage. One analysis still counts as one of the 5 free analyses.

### Security
- `npm audit` reported 4 high-severity issues in `@grpc/grpc-js` 1.9, bundled with Firebase's Firestore. Firebase 13 still uses 1.9, so upgrading Firebase would not fix it. An npm `override` moves Firestore to grpc-js 1.14.7: `npm audit --omit=dev` now reports 0 vulnerabilities. The browser app never loads grpc-js (it is used when Firestore runs in Node, e.g. the rules tests, which pass with 1.14.7).

## Phase 7: Done (making study engaging)

Chosen for what the research on learning supports, not only for fun:

| Feature | Why |
|---|---|
| **Practice mode** (instant feedback): after each answer, the right one, the explanation and "Report wrong answer"; an "N in a row" combo. On for the daily challenge and recommended topics, optional for mock tests (remembered). Exam mode is unchanged. | Testing yourself and then seeing the answer improves long-term retention more than re-reading (Roediger & Karpicke 2006; Butler & Roediger 2008) |
| **Daily Challenge**: 5 questions, weakest topics first, one topic after another; +50 XP bonus once a day | Mixing topics (interleaving) improves learning compared with practising one topic at a time (Rohrer & Taylor 2007) |
| **XP and levels**: 10 XP per right answer, 2 per attempt, 5 per flashcard, 25 per completed focus session. Each level needs 50 XP more than the last | Game elements have small-to-moderate positive effects on motivation and learning in a meta-analysis (Sailer & Homner 2020) |
| **Daily goal** (30/50/100/200 XP, in Settings), shown as a ring on the dashboard, with a celebration when reached | Specific, reachable goals help people keep going |
| **11 achievements** (First Steps, On Fire, Week Warrior, Perfect Score, Centurion, Card Shark, Goal Getter, Challenger, Deep Focus, ...) on the Stats tab | |
| **Study calendar** (last 12 weeks) and a streak that counts tests, practice, flashcards and focus sessions (before, only mock tests counted) | Makes consistent study visible; spacing study over days helps memory (Cepeda et al. 2006) |

Study activity is kept per device per day in the synced `progress` store (`day:YYYY-MM-DD:<device>`), so two devices never overwrite each other's XP. Writes are queued so quick answers can't lose XP; a unit test proves the queue is needed. Confetti is skipped when the system asks for reduced motion.

Tests: 16 new unit tests (levels, badges, challenge mixing, calendar, cross-device totals, concurrent logging) and 6 new end-to-end tests (practice mode, exam mode, daily challenge, goal ring and celebration, badges and calendar, flashcard/focus XP, reduced motion). The contrast audit now also covers the practice-mode feedback.

## Phase 8: Done (tasks, plan, quests, question formats)

| Feature | How it works |
|---|---|
| **Daily quests** | 3 a day from a pool of 8 (answer 15, get 10 right, review 10 cards, a focus session, the daily challenge, 5 in a row, tick off a task, 5 mixed-format questions), only ones you have content for. The same 3 on every device (chosen from the date). Each finished quest pays +20 XP once, even across devices, and counts towards the daily goal. |
| **Study planner** | Tasks with optional due dates, grouped Overdue / Today / Upcoming / No date / Done. Ticking a task gives +5 XP once. Overdue and today's tasks show on the dashboard. Tasks sync and are in backups (new `tasks` store, database version 5; existing data is kept, tested). |
| **Exam countdown and plan** | Set the exam date; "Build my study plan" fills the planner with a task per day (up to 8 weeks): topics get days in proportion to importance × what's left to learn, spread out (weighted round-robin), a mock test every 7th day and revision on the last 2 days. Rebuilding replaces the plan's upcoming tasks; "Start" opens practice for that day's topic. |
| **Mixed practice** | 10 items made from your multiple-choice questions: true/false, type the answer, match 3-4 pairs, and select every correct question→answer pair. All with instant feedback, XP, combos and topic mastery. |

Typed answers ignore case, accents, punctuation and "the/a/an", but forgive typos only in longer answers (1 for 8-11 letters, 2 for 12+), because many short terms differ by one letter (lipase/ligase, IgG/IgA); numbers must match, and typing one of the wrong options is always wrong.

Found and fixed while testing: the planner cleared its input boxes after saving, which could wipe a task typed straight after the previous one.

Tests: 21 new unit tests and 5 new end-to-end tests (database upgrade, planner, plan, quests, every mixed format); the contrast audit now covers the planner, the Today panel and all four formats.

## Phase 9: Done (mistakes, stars & notes, AI study notes, reminders, read-aloud)

| Feature | How it works |
|---|---|
| **Mistake notebook** | Every answer to a saved question is recorded (exam mode at the end, practice and mixed formats straight away; match/multi per question). A wrong answer puts the question in the notebook; 2 right answers in a row take it out (the history is kept). "Mistake Notebook" in Practice retries the most-missed first; the Question Bank can filter to it. Re-testing what you got wrong is retrieval practice aimed where it helps most. |
| **Stars & notes** | ☆ Star and 📝 note on questions (practice feedback, test review, Question Bank) and flashcards (during review). "Starred & Notes" lists them and starts a starred-questions practice or a starred-cards review. Stored on the question/card, so they sync. |
| **AI flashcards & summary** | Source: pasted text, a saved paper, or 1-15 pages of a book on your shelf (PDF text, with OCR for scanned pages). The AI writes up to 15 cards (edit, untick, save; duplicates skipped) or a summary (points + key terms; copy or save as PDF). Up to 12,000 characters per request. |
| **Daily reminder** | "Add to calendar" downloads an iCalendar file with a daily event and an alert at your time, so any phone or computer calendar reminds you even when Woni is closed. While Woni is open it also reminds you at that time if today's goal isn't met (a system notification if allowed and the tab is in the background). |
| **Read aloud** | 🔊 Listen reads the question and lettered options, mixed-format items, or the flashcard (the answer too once shown), using the device's built-in speech. Moving on or exiting stops it. Hidden where speech isn't available. |

A web app can't wake itself on a schedule without a push server, so true background notifications aren't offered; the calendar event covers that on every platform. Native Android notifications would need the Capacitor Local Notifications plugin and an APK build, which couldn't be built or tested here.

Found and fixed while testing: the note editor opened behind the test screen when used during a session.

Tests: 9 new unit tests and 5 new end-to-end tests (with the AI server and speech engine mocked); the contrast audit covers the new dialogs.

## Steps only you can do

These need your Firebase or Cloudflare accounts:

1. **Make yourself admin:** `node scripts/set-admin.mjs you@example.com` with a service-account key (see README).
2. **Deploy the new rules:** add the `FIREBASE_SERVICE_ACCOUNT` repository secret and the Deploy workflow does it on every rules change (or run `npm run deploy:rules` yourself; see README, "Automatic deploys"). Until you do, the old rules (any signed-in user can upload) stay live, and per-record sync is refused by the old Firestore rules. Library-book sync also needs the new Storage rule (`users/{uid}/library/`).
3. **Register a Web app** in the Firebase console and put its `appId` in `.env` as `VITE_FIREBASE_APP_ID`.
4. **Redeploy the Worker:** add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and run the Deploy workflow (or `cd worker && wrangler deploy`). Optionally create the `USAGE` KV namespace for the daily quota (see `worker/README.md`).

## Known limits

- Reset is per device: a signed-in user's cloud copy is kept and comes back on the next sync (Import is the way to replace data everywhere).
- Library books over 50 MB stay on the device they were added on.
- OCR reads English only, and at most 30 scanned pages per PDF. PDFs are read to page 60, and one analysis covers up to 16 parts (~96,000 characters, a few full papers); upload more as a second analysis.
- The answer check is a second AI opinion, not proof. Answers from a paper's own key are the most reliable.
- Safari is tested with Playwright's WebKit build, which is the same engine but not Apple's own browser; a quick check on a real iPhone or iPad is still worthwhile.
