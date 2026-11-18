import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'firebase/auth';
import { firebaseApp, firebaseAuth, loadFirestore, loadStorage } from './firebase.js';

export { firebaseConfig } from './firebase.js';

const AUTH_ERRORS = {
  'auth/invalid-email': "That email address doesn't look right.",
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No internet connection. Check your connection, or continue as a guest.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/operation-not-allowed': 'Email sign-in is not enabled for this app yet.',
};

/** A message a student can act on, instead of Firebase's raw error text. */
export function authErrorMessage(e) {
  return AUTH_ERRORS[e?.code] || e?.message || 'Something went wrong. Please try again.';
}

export const authMixin = {
  initFirebase() {
    firebaseApp();
  },

  /** Call `callback(user)` now and whenever the signed-in user changes. */
  watchAuth(callback) {
    return onAuthStateChanged(firebaseAuth(), callback);
  },

  /** Firestore functions + `db`, loaded on first use (guests who never sync or browse cloud books skip it). */
  getDb() {
    return loadFirestore();
  },

  /** Storage functions + `storage`, loaded on first use. */
  getStorage() {
    return loadStorage();
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
    const email = document.getElementById('auth-email').value.trim();
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
        await signInWithEmailAndPassword(firebaseAuth(), email, password);
      } catch (e) {
        if (!['auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(e.code)) {
          throw e;
        }
        try {
          await createUserWithEmailAndPassword(firebaseAuth(), email, password);
        } catch (createErr) {
          if (createErr.code === 'auth/email-already-in-use') {
            throw new Error('Incorrect password for this account.');
          }
          throw createErr;
        }
      }
      localStorage.removeItem('woni_guest_mode');
    } catch (e) {
      this.showToast(authErrorMessage(e), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In / Sign Up';
    }
  },

  async sendPasswordReset() {
    const email = document.getElementById('auth-email')?.value.trim();
    if (!email) {
      this.showToast('Enter your email address above, then tap "Forgot password?" again.', 'info');
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth(), email);
      // Same message whether or not the account exists (don't reveal which emails are registered).
      this.showToast(`If an account exists for ${email}, a password reset link is on its way.`, 'success');
    } catch (e) {
      this.showToast(authErrorMessage(e), 'error');
    }
  },

  signOut() {
    signOut(firebaseAuth()).then(() => {
      localStorage.removeItem('woni_guest_mode');
      location.reload();
    });
  },

  continueAsGuest() {
    localStorage.setItem('woni_guest_mode', 'true');
    this.enterApp();
  }
};
