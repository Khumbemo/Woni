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
      // Simple logic: try to sign in, if fails, try to sign up
      try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          await firebase.auth().createUserWithEmailAndPassword(email, password);
        } else {
          throw e;
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
    document.getElementById('auth-overlay').classList.add('hidden');
    this.loadState();
    this.updateDashboard();
  }
};
