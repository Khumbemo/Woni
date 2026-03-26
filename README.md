# 📚 Woni — Exam Intelligence

> AI-powered study tool for **NPSC** (Nagaland PSC) and **CSIR NET** — two completely separate, independent tools under one roof.

**Live demo**: Deploy by dragging the folder to [Netlify Drop](https://app.netlify.com/drop)

---

## ✨ What Woni Does

### For NPSC (Nagaland PSC — CCE)
- Upload past NPSC CCE question papers (PDF/TXT)
- AI identifies high-frequency topics across years
- Filters: All / High / Medium / Low priority
- Generate targeted study notes, concise bullets, or practice MCQs
- Export notes and full topic reports as PDF

### For CSIR NET
- Completely separate tool — independent of NPSC
- Select your subject: Life Sciences, Chemical, Physical, Mathematical, Earth Sciences
- AI analyzes Part A / Part B / Part C topic distribution separately
- Filter by exam part + priority level
- Generate subject-specific notes with exam-style MCQs
- Export PDF study packs

---

## 🆓 100% Free — Powered by Groq

Uses [Groq's free API](https://console.groq.com/keys) for ultra-fast AI inference.

- **No credit card** required
- **No backend** — pure HTML + CSS + JS
- **No subscription** — runs entirely in your browser
- Model: `llama-3.3-70b-versatile` (free tier)

---

## 🚀 Quick Start

### Option 1 — Open directly (zero setup)
```bash
git clone https://github.com/your-username/woni.git
cd woni
open index.html        # macOS
# or double-click index.html on Windows
```

### Option 2 — Local server
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .

# Then open http://localhost:8080
```

### Option 3 — Deploy free
Drag the `woni/` folder to **[Netlify Drop](https://app.netlify.com/drop)** — live in 30 seconds.

Or push to GitHub and enable **GitHub Pages** (Settings → Pages → Deploy from branch).

---

## 🔑 Getting Your Free API Key

1. Go to **[console.groq.com/keys](https://console.groq.com/keys)**
2. Sign up (free, no credit card)
3. Click **Create API Key**
4. Open Woni → paste the key → click **Save Key**

Your key is saved in your browser's localStorage — never sent anywhere except Groq's API.

---

## 📁 Project Structure

```
woni/
├── index.html          # Home screen — choose NPSC or CSIR NET
├── css/
│   └── shared.css      # Design system shared by all pages
├── js/
│   └── woni.js         # Shared utilities (API, PDF, rendering)
├── pages/
│   ├── npsc.html       # NPSC CCE — fully independent tool
│   └── csir.html       # CSIR NET — fully independent tool
└── README.md
```

**NPSC and CSIR NET are completely separate** — different exams, different question formats, different syllabi, different AI prompts. They share only CSS and utility functions.

---

## ⚙️ How it Works

1. **Upload**: PDF text is extracted in-browser using `pdf.js` (no server needed)
2. **Analyze**: Text is sent to Groq API with an exam-specific prompt
3. **Results**: AI returns structured JSON with topics, frequencies, and priorities
4. **Notes**: AI generates HTML notes tailored to the topic and exam format
5. **Export**: `jsPDF` creates a downloadable PDF from the notes

---

## 🎛️ CSIR NET Subjects Supported

| Code | Subject |
|------|---------|
| `life` | Life Sciences |
| `chem` | Chemical Sciences |
| `phys` | Physical Sciences |
| `math` | Mathematical Sciences |
| `earth` | Earth Sciences |

---

## 📄 License

MIT — free to use, fork, and build on.

---

## 🙌 Contributing

Ideas welcome:
- Year-on-year trend charts within same exam
- Offline mode (service worker)
- Hindi/Nagamese UI language option
- Bookmark topics for quick-access
- Shared notes via URL (read-only link)

---

*Woni is not affiliated with NPSC or CSIR. All AI-generated content is for study assistance only.*
