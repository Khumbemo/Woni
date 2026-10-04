import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

/**
 * Firebase web config. Override any value with a VITE_FIREBASE_* variable in
 * .env (see .env.example). The appId default is the project's Android app;
 * register a Web app in the Firebase console and set VITE_FIREBASE_APP_ID to
 * its id so web-only services (Analytics, App Check) work.
 */
const env = import.meta.env || {};
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBCc6JdOtYhgvINHgdNHyIMVBw_8v1INgk',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'woni-f6a2a.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'woni-f6a2a',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'woni-f6a2a.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '802707408926',
  appId: env.VITE_FIREBASE_APP_ID || '1:802707408926:android:f561524d07bee95524c60f',
};

export const authMixin = {
  initFirebase() {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  },

  /** Firestore, loaded on first use (guests who never sync or browse cloud books skip it). */
  getDb() {
    this._dbPromise ??= import('firebase/compat/firestore').then(() => {
      const db = firebase.firestore();
      // Locally-generated records can contain undefined fields (e.g. a missing
      // explanation); Firestore rejects those unless told to drop them.
      try { db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch {}
      return db;
    });
    return this._dbPromise;
  },

  /** Firebase Storage, loaded on first use (admin uploads only). */
  getStorage() {
    this._storagePromise ??= import('firebase/compat/storage').then(() => firebase.storage());
    return this._storagePromise;
  },

  updateAuthUI() {
    const statusEl = document.getElementById('sync-status');
    const emailEl = document.getElementById('user-email-display');
    const authBtn = document.getElementById('auth-action-btn');
    const syncContainer = document.getElementById('sync-now-container');
    const adminPanel = document.getElementById('admin-upload-panel');

    if (this.state.user) {
      if (statusEl) statusEl.textContent = 'Cloud Sync Active';
      if (emailEl) emailEl.textContent = this.state.user.email;
      if (authBtn) {
        authBtn.textContent = 'Sign Out';
        authBtn.onclick = () => this.signOut();
      }
      if (syncContainer) syncContainer.classList.remove('hidden');
      if (adminPanel) adminPanel.classList.toggle('hidden', !this.state.isAdmin);
    } else {
      if (statusEl) statusEl.textContent = 'Cloud Sync (Offline)';
      if (emailEl) emailEl.textContent = 'Not signed in';
      if (authBtn) {
        authBtn.textContent = 'Sign In';
        authBtn.onclick = () => this.showAuth();
      }
      if (syncContainer) syncContainer.classList.add('hidden');
      if (adminPanel) adminPanel.classList.add('hidden');
    }
  },

  /** Admins carry an `admin: true` custom claim (set with scripts/set-admin.mjs). */
  async refreshAdminStatus(user) {
    this.state.isAdmin = false;
    if (!user?.getIdTokenResult) return;
    try {
      const { claims } = await user.getIdTokenResult();
      this.state.isAdmin = claims.admin === true;
    } catch (e) {
      console.warn('Could not read account claims', e);
    }
  },

  showAuth() {
    document.getElementById('auth-overlay').classList.remove('hidden');
  },

  async handleAuth() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('auth-submit-btn');

    if (!email || !password) {
      this.showToast('Please enter email and password', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      // Try to sign in; if that fails, try to sign up. With Firebase email
      // enumeration protection (on by default for new projects) an unknown
      // email reports auth/invalid-credential instead of auth/user-not-found.
      try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      } catch (e) {
        if (!['auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(e.code)) {
          throw e;
        }
        try {
          await firebase.auth().createUserWithEmailAndPassword(email, password);
        } catch (createErr) {
          if (createErr.code === 'auth/email-already-in-use') {
            throw new Error('Incorrect password for this account.');
          }
          throw createErr;
        }
      }
      localStorage.removeItem('woni_guest_mode');
    } catch (e) {
      this.showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In / Sign Up';
    }
  },

  signOut() {
    firebase.auth().signOut().then(() => {
      localStorage.removeItem('woni_guest_mode');
      location.reload();
    });
  },

  continueAsGuest() {
    localStorage.setItem('woni_guest_mode', 'true');
    this.enterApp();
  }
};
