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
3. Create a **Firestore Database** in test mode or with appropriate security rules.
4. Add a Web App to your project and copy the `firebaseConfig` object.
5. Paste your configuration into the `initFirebase()` function in `app.js`.

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
