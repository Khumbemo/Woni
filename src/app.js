/**
 * Woni — Core Application Orchestrator (SPA)
 *
 * This file has been refactored from a 1500-line monolith into a slim
 * orchestrator that merges domain-specific modules via Object.assign.
 */

import { ALLOWED_EXAMS, EXAM_ID_MIGRATION, CURATED_RESOURCES } from './config.js';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { authMixin } from './auth.js';
import { dbMixin } from './db.js';
import { aiMixin } from './ai.js';
import { routerMixin } from './router.js';
import { particleMixin } from './particles.js';
import { dashboardMixin } from './views/dashboard.js';
import { libraryMixin } from './views/library.js';
import { uploadMixin } from './views/upload.js';
import { practiceMixin } from './views/practice.js';
import { progressMixin } from './views/progress.js';
import { syncMixin } from './sync.js';
import { h, render } from 'preact';
import Toast from './components/Toast.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Tree-shaken Lucide icons — only import what we use
import { createIcons,
  Home, BookOpen, Upload, Target, TrendingUp, Settings,
  Microscope, Leaf, Dna, Landmark, GraduationCap,
  Sparkles, Smile, Zap, Award, Frown,
  FileText, Layers, BarChart3, Timer,
  Plus, HelpCircle, Cloud, ExternalLink, File, X,
  Send, ChevronDown
} from 'lucide';

const usedIcons = {
  Home, BookOpen, Upload, Target, TrendingUp, Settings,
  Microscope, Leaf, Dna, Landmark, GraduationCap,
  Sparkles, Smile, Zap, Award, Frown,
  FileText, Layers, BarChart3, Timer,
  Plus, HelpCircle, Cloud, ExternalLink, File, X,
  Send, ChevronDown
};

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

const app = {
  ALLOWED_EXAMS,
  EXAM_ID_MIGRATION,
  CURATED_RESOURCES,

  // --- State ---
  state: {
    userExams: [],
    activeExam: null,
    apiKey: localStorage.getItem('woni_groq_key') || '',
    theme: localStorage.getItem('woni_theme') || 'dark',
    isFirstRun: !localStorage.getItem('woni_setup_done'),
    db: null,
    currentView: 'dashboard',
    uploadFiles: [],
    analysisStatus: '',
    analysisProgress: 0,
    session: null,
    activeLibExam: 'csir_net',
    user: null,
  },

  // --- Initialization ---
  async init() {
    console.log('Woni initializing...');
    this.initFirebase();
    this.applyTheme();
    this.initEventListeners();
    this.initNavigation();
    this.initParticles();
    this.updateLucide();

    await this.initDB();

    // Mount Global Toast Provider
    const toastRoot = document.getElementById('toast-mount');
    if (toastRoot) render(h(Toast, null), toastRoot);

    firebase.auth().onAuthStateChanged(async (user) => {
      this.state.user = user;
      this.updateAuthUI();
      if (user || localStorage.getItem('woni_guest_mode')) {
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('auth-overlay').classList.add('hidden');
        this.loadState();
        if (this.state.isFirstRun) this.showOnboarding();
        else this.updateDashboard();
        this.showView(this.state.currentView);
      } else {
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('auth-overlay').classList.remove('hidden');
      }
    });
  },

  // --- State Loading ---
  loadState() {
    const examsRaw = localStorage.getItem('woni_user_exams');
    if (examsRaw) {
      let exams = JSON.parse(examsRaw)
        .map(ex => ({ ...ex, id: this.EXAM_ID_MIGRATION[ex.id] || ex.id }))
        .filter(ex => this.ALLOWED_EXAMS.includes(ex.id));
      this.state.userExams = exams;
      this.state.activeExam = exams[0] || null;
      if (exams.length > 0) localStorage.setItem('woni_user_exams', JSON.stringify(exams));
      this.updateActiveExamBadge();
    }
    const apiKey = localStorage.getItem('woni_groq_key');
    if (apiKey) {
      this.state.apiKey = apiKey;
      const input = document.getElementById('api-key-input');
      if (input) input.value = apiKey;
    }
    const theme = localStorage.getItem('woni_theme');
    if (theme) {
      this.state.theme = theme;
      const select = document.getElementById('theme-select');
      if (select) select.value = theme;
      this.applyTheme();
    }
  },

  // --- Event Delegation System ---
  // Replaces all inline onclick="app.X()" handlers with data-action attributes.
  initEventListeners() {
    let touchStartX = 0;
    const mainContent = document.getElementById('main-content');

    mainContent.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    mainContent.addEventListener('touchend', e => {
      const endX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, endX);
    }, { passive: true });

    // --- Central Event Delegation ---
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const param = target.dataset.param;

      if (typeof this[action] === 'function') {
        e.preventDefault();
        this[action](param);
      }
    });

    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        this.showView(view);
      });
    });

    // --- Static element bindings ---
    const saveExamsBtn = document.getElementById('save-exams-btn');
    if (saveExamsBtn) saveExamsBtn.addEventListener('click', () => this.saveExams());

    const authBtn = document.getElementById('auth-submit-btn');
    if (authBtn) authBtn.addEventListener('click', () => this.handleAuth());

    const guestBtn = document.getElementById('guest-btn');
    if (guestBtn) guestBtn.addEventListener('click', () => this.continueAsGuest());

    // Upload zone
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); this.handleFiles(e.dataTransfer.files); });
    }
    if (fileInput) fileInput.addEventListener('change', e => this.handleFiles(e.target.files));

    const analysisBtn = document.getElementById('start-analysis-btn');
    if (analysisBtn) analysisBtn.addEventListener('click', () => this.startAnalysis());

    const chatSend = document.getElementById('analysis-chat-send');
    const chatInput = document.getElementById('analysis-chat-input');
    if (chatSend) chatSend.addEventListener('click', () => this.askAnalysisAssistant());
    if (chatInput) chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.askAnalysisAssistant(); });

    const saveReviewBtn = document.getElementById('save-reviewed-analysis-btn');
    if (saveReviewBtn) saveReviewBtn.addEventListener('click', () => this.saveReviewedAnalysis());

    // Library search
    const libSearch = document.getElementById('lib-search');
    if (libSearch) libSearch.addEventListener('input', () => this.renderLibraryContent());

    // Library upload save
    const libUploadSave = document.getElementById('lib-upload-save');
    const libUploadFile = document.getElementById('lib-upload-file');
    if (libUploadSave && libUploadFile) {
      libUploadSave.addEventListener('click', () => this.handleLibraryUpload({ target: libUploadFile }));
    }

    // Theme select
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.addEventListener('change', e => this.setTheme(e.target.value));

    // Import trigger
    const importBtn = document.getElementById('trigger-import-btn');
    const importFile = document.getElementById('import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', e => this.importData(e));
    }

    // Drop zone tap to open file picker
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
    }
  },

  // --- Lucide (tree-shaken) ---
  updateLucide() {
    try { createIcons({ icons: usedIcons }); } catch {}
  },

  // --- Onboarding ---
  showOnboarding() {
    this.showSubView('onboarding-overlay');
  },

  saveExams() {
    const selected = [];
    document.querySelectorAll('.exam-checkbox input:checked').forEach(cb => {
      selected.push({ id: cb.value, name: cb.dataset.name });
    });
    const valid = selected.filter(ex => this.ALLOWED_EXAMS.includes(ex.id));
    if (valid.length === 0) {
      this.showToast('Please select at least one exam.', 'error');
      return;
    }
    this.state.userExams = valid;
    this.state.activeExam = valid[0];
    this.state.isFirstRun = false;
    localStorage.setItem('woni_user_exams', JSON.stringify(valid));
    localStorage.setItem('woni_setup_done', 'true');
    this.updateActiveExamBadge();
    this.hideSubView('onboarding-overlay');
    this.updateDashboard();
    this.showView('dashboard');
  },

  // --- Settings ---
  saveApiKey() {
    const input = document.getElementById('api-key-input');
    const key = input ? input.value.trim() : '';
    if (key && !key.startsWith('gsk_')) {
      this.showToast('Key should start with gsk_', 'error');
      return;
    }
    this.state.apiKey = key;
    if (key) {
      localStorage.setItem('woni_groq_key', key);
      this.showToast('API Key saved successfully!', 'success');
    } else {
      localStorage.removeItem('woni_groq_key');
      this.showToast('API Key cleared.', 'info');
    }
  },

  setTheme(theme) {
    this.state.theme = theme;
    localStorage.setItem('woni_theme', theme);
    this.applyTheme();
    const select = document.getElementById('theme-select');
    if (select && select.value !== theme) select.value = theme;
  },

  applyTheme() {
    const isDark = this.state.theme === 'dark' || (this.state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('light-theme', !isDark);
  },

  // --- Utility ---
  escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  showToast(message, type = 'info') {
    window.dispatchEvent(new CustomEvent('woni-toast', { detail: { message, type } }));
  },
};

// --- Merge all domain modules ---
Object.assign(app, authMixin, dbMixin, aiMixin, routerMixin, particleMixin,
  dashboardMixin, libraryMixin, uploadMixin, practiceMixin, progressMixin, syncMixin);

// Expose for legacy compatibility (inline handlers in index.html that haven't been migrated yet)
window.app = app;

// Start the app
window.addEventListener('DOMContentLoaded', () => app.init());
