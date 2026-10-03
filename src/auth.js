import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

export const authMixin = {
  initFirebase() {
    // Replace with your actual Firebase config
    const firebaseConfig = {
      apiKey: "AIzaSyBCc6JdOtYhgvINHgdNHyIMVBw_8v1INgk",
      authDomain: "woni-f6a2a.firebaseapp.com",
      projectId: "woni-f6a2a",
      storageBucket: "woni-f6a2a.firebasestorage.app",
      messagingSenderId: "802707408926",
      appId: "1:802707408926:android:f561524d07bee95524c60f"
    };
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    this.db = firebase.firestore();
    // Locally-generated records can contain undefined fields (e.g. a missing
    // explanation); Firestore rejects those unless told to drop them.
    try { this.db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch {}
    this.storage = firebase.storage();
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
      if (adminPanel) adminPanel.classList.remove('hidden');
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
