# 📚 Woni — AI Exam Intelligence

Woni is a specialized exam preparation app designed for students targeting **CSIR NET**, **GATE Life Science**, **SLET**, and **NPSC** exams. It uses AI-powered content analysis to extract key topics, identify high-frequency questions, and provide personalized study recommendations.

## ✨ Features

- **Multi-Exam Support**: Choose from CSIR NET, GATE Life Science, SLET, or NPSC CCE.
- **Offline-First Storage**: All your papers, questions, and progress are stored locally using IndexedDB.
- **Cloud Sync & Authentication**: Securely back up your data to Firebase and sync across devices.
- **Guest Mode**: Use the app entirely offline without creating an account.
- **AI-Powered Analysis**: Upload PDFs, images, or text files to extract questions and identify important topics via Groq API.
- **Mock Tests**: Generate custom tests based on specific exams and topics.
- **Spaced Repetition Flashcards**: Auto-generated flashcards with an SM-2 algorithm to optimize retention.
- **Progress Tracking**: Visualized performance trends and topic mastery heatmaps.
- **PDF Export**: Export your mock test results as study-friendly PDFs.
- **Dark/Light Mode**: Customizable UI themes.

## 🚀 Getting Started

### Prerequisites

- A modern web browser.
- A free Groq API Key (get one at [console.groq.com](https://console.groq.com/keys)).

### Running the App Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/woni.git
   cd woni
   ```

2. Start a local development server:
   ```bash
   # Python
   python3 -m http.server 8080

   # Node.js
   npx serve .
   ```

3. Open your browser and navigate to `http://localhost:8080`.

4. Go to **Settings**, paste your **Groq API Key**, and click **Save**.

### ☁️ Firebase Setup (Cloud Sync)

To enable Cloud Sync, you'll need a Firebase project:

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** (Email/Password provider).
3. Create a **Firestore Database** and a **Storage** bucket.
4. Add a **Web app** to your project. Copy `.env.example` to `.env` and fill in its config values (defaults live in `src/auth.js`).
5. Deploy the security rules:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```

Cloud Sync stores one Firestore document per record (`users/{uid}/{store}/{id}`) and merges changes from several devices; the most recent edit wins.

### 👑 Admin accounts (shared library uploads)

Only accounts with the `admin` custom claim can upload books to the shared cloud library, and the Firestore and Storage rules enforce this. To make an account an admin:

1. Firebase console → Project settings → Service accounts → **Generate new private key**. Save it as `service-account.json` (it is git-ignored; never commit it).
2. Run:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-admin.mjs you@example.com
   ```
3. Sign out and back in. The **Admin Cloud Upload** panel appears in Settings.

Revoke with `--revoke`.

### 🤖 AI proxy

New users without a Groq key use the proxy in `worker/`. See [`worker/README.md`](worker/README.md) for deployment and its rate limits.

## 📱 Mobile Deployment (Capacitor)

Woni is designed to be mobile-friendly and can be bundled using Capacitor:

1. Install Capacitor:
   ```bash
   npm install @capacitor/core @capacitor/cli
   ```

2. Initialize Capacitor:
   ```bash
   npx cap init
   ```

3. Add platforms:
   ```bash
   npx cap add android
   npx cap add ios
   ```

4. Build and sync:
   ```bash
   npx cap copy
   npx cap open android
   ```

## 🛠️ Built With

- **Vanilla JavaScript**: Lightweight and modular SPA architecture.
- **IndexedDB (idb)**: For robust client-side data persistence.
- **Tesseract.js**: For OCR text extraction from images.
- **pdf.js**: For PDF text parsing.
- **Chart.js**: For progress visualizations.
- **jsPDF**: For generating result PDFs.
- **Groq API**: Powered by `llama-3.3-70b-versatile` for high-speed AI analysis.

## ⚙️ How it Works

1. **Extraction**: `pdf.js` and `Tesseract.js` extract raw text from your uploads.
2. **Parsing**: The text is sent to the Groq API with a specialized prompt to identify structured questions and topics.
3. **Storage**: Extracted data is saved locally to IndexedDB.
4. **Practice**: The app selects questions from your local bank for tests or schedules flashcard reviews using spaced repetition.
5. **Insights**: Your performance in tests updates your topic mastery, which is then visualized on the dashboard.

---
*Woni is an open-source tool for study assistance. It is not affiliated with the official exam boards.*

## 📏 Accuracy Benchmarking (50-100 papers)

Woni includes a lightweight benchmark helper in `app.runBenchmarkSuite(...)`.

1. Create a benchmark JSON file using `benchmark-template.json`.
2. Use 50-100 manually labeled papers with:
   - `predictedTopics`: topics extracted by AI
   - `truthTopics`: verified ground-truth topics
3. Run in app console:
   ```js
   app.runBenchmarkSuite(yourBenchmarkArray)
   ```
4. Review average Precision / Recall / F1 to track extraction quality.
