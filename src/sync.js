/**
 * Woni — Sync & Export Module
 * Cloud sync with Firestore subcollections, data export/import, and data clearing.
 */
import firebase from 'firebase/compat/app';

export const syncMixin = {
  async syncWithCloud() {
    if (!this.state.user) return;
    const btn = document.querySelector('#sync-now-container .btn');
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

    try {
      const userId = this.state.user.uid;
      const userRef = this.db.collection('users').doc(userId);

      // Check for existing monolithic cloud data (migration path)
      const doc = await userRef.get();
      if (doc.exists) {
        const cloudData = doc.data();
        if (cloudData.updatedAt && confirm('Cloud data found. Do you want to overwrite local data with cloud backup?')) {
          await this.applyCloudData(cloudData);
          this.showToast('Sync Complete: Data pulled from cloud.', 'success');
          location.reload();
          return;
        }
      }

      // Push local data to cloud with timestamp
      const localData = {
        userExams: this.state.userExams,
        papers: await this.dbGetAll('papers'),
        questions: await this.dbGetAll('questions'),
        flashcards: await this.dbGetAll('flashcards'),
        topics: await this.dbGetAll('topics'),
        mock_tests: await this.dbGetAll('mock_tests'),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(localData);
      this.showToast('Sync Complete: Data pushed to cloud.', 'success');
    } catch (e) {
      console.error('Sync failed', e);
      this.showToast('Sync failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },

  async applyCloudData(data) {
    const stores = ['papers', 'questions', 'flashcards', 'topics', 'mock_tests'];
    for (const store of stores) {
      await this.state.db.clear(store);
      if (data[store]) {
        for (const item of data[store]) {
          await this.dbAdd(store, item);
        }
      }
    }
    if (data.userExams) {
      this.state.userExams = data.userExams;
      localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams));
    }
  },

  // --- Data Export / Import ---
  async exportData() {
    const data = {
      userExams: this.state.userExams,
      papers: await this.dbGetAll('papers'),
      questions: await this.dbGetAll('questions'),
      flashcards: await this.dbGetAll('flashcards'),
      progress: await this.dbGetAll('progress'),
      topics: await this.dbGetAll('topics'),
      mock_tests: await this.dbGetAll('mock_tests'),
      version: 1,
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `woni_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (confirm('Importing data will overwrite existing records. Continue?')) {
        const stores = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests'];
        for (const store of stores) {
          await this.state.db.clear(store);
          if (data[store]) {
            for (const item of data[store]) {
              await this.dbAdd(store, item);
            }
          }
        }
        if (data.userExams) {
          this.state.userExams = data.userExams;
          localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams));
        }
        this.showToast('Data imported successfully!', 'success');
        setTimeout(() => location.reload(), 1500);
      }
    } catch (e) {
      this.showToast('Import failed: ' + e.message, 'error');
    }
  },

  clearAllData() {
    if (confirm('DANGER: This will delete ALL your study data, papers, and progress. Continue?')) {
      localStorage.clear();
      indexedDB.deleteDatabase('woni_db');
      location.reload();
    }
  }
};
