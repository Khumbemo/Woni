/**
 * Woni — Library View Module
 * Handles curated resources, cloud books, local book uploads, and admin panel.
 */
import firebase from 'firebase/compat/app';

export const libraryMixin = {
  updateLibraryView() {
    const tabs = document.getElementById('lib-exam-tabs');
    if (tabs) {
      tabs.innerHTML = this.state.userExams.map(ex => `
        <button class="lib-tab ${ex.id === this.state.activeLibExam ? 'active' : ''}"
                data-action="switchLibTab" data-param="${this.escapeHtml(ex.id)}">${this.escapeHtml(ex.name)}</button>
      `).join('');
    }
    this.renderLibraryContent();
  },

  switchLibTab(examId) {
    this.state.activeLibExam = examId;
    this.updateLibraryView();
  },

  async renderLibraryContent() {
    const container = document.getElementById('lib-subjects');
    if (!container) return;

    const examId = this.state.activeLibExam;
    const curated = JSON.parse(JSON.stringify(this.CURATED_RESOURCES[examId] || {}));

    container.innerHTML = '<div class="skeleton-card" style="height:120px"></div><div class="skeleton-card" style="height:120px"></div>';

    const userBooks = await this.dbGetFromIndex('library', 'exam', examId);
    let cloudBooks = [];

    // Fetch from Firestore (graceful degradation)
    try {
      if (this.db && this.state.user) {
        const snapshot = await this.db.collection('library_books')
          .where('exam', '==', examId)
          .get();
        snapshot.forEach(doc => { cloudBooks.push(doc.data()); });
      }
    } catch (e) {
      if (e.code === 'permission-denied') {
        console.warn('Cloud Library: Firestore access denied. Using local + curated resources only.');
      } else {
        console.error('Failed to fetch cloud books', e);
      }
    }

    // Group user books by subject
    const groupedUser = {};
    userBooks.forEach(b => {
      if (!groupedUser[b.subject]) groupedUser[b.subject] = [];
      groupedUser[b.subject].push({ title: b.name, id: b.id, isLocal: true });
    });

    // Group cloud books into curated
    cloudBooks.forEach(b => {
      if (!curated[b.subject]) curated[b.subject] = [];
      curated[b.subject].push({ title: b.title, url: b.url, isCloud: true });
    });

    // Merge subjects
    const allSubjects = Array.from(new Set([...Object.keys(curated), ...Object.keys(groupedUser)]));

    // Search filtering
    const searchInput = document.getElementById('lib-search');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filteredSubjects = query
      ? allSubjects.filter(sub => {
          if (sub.toLowerCase().includes(query)) return true;
          const books = [...(curated[sub] || []), ...(groupedUser[sub] || [])];
          return books.some(b => b.title.toLowerCase().includes(query));
        })
      : allSubjects;

    if (filteredSubjects.length === 0) {
      container.innerHTML = '<div class="empty-list">No books found. Try a different search or add your own!</div>';
      return;
    }

    container.innerHTML = filteredSubjects.map(sub => `
      <div class="lib-subject-group">
        <h3>${this.escapeHtml(sub)}</h3>
        <div class="bookshelf">
          ${(curated[sub] || []).map(b => `
            <div class="book-card" data-action="openExternal" data-param="${this.escapeHtml(b.url || '')}">
              <div class="book-icon"><i data-lucide="${b.isCloud ? 'cloud' : 'external-link'}"></i></div>
              <span class="book-title">${this.escapeHtml(b.title)}</span>
            </div>
          `).join('')}
          ${(groupedUser[sub] || []).map(b => `
            <div class="book-card" data-action="openLocalBook" data-param="${b.id}">
              <div class="book-icon"><i data-lucide="file-text"></i></div>
              <span class="book-title">${this.escapeHtml(b.title)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    this.updateLucide();
  },

  openExternal(url) {
    if (url) window.open(url, '_blank');
  },

  // --- Library Upload (now uses ArrayBuffer instead of base64) ---
  showLibraryUploadModal() {
    const modal = document.getElementById('library-upload-modal');
    if (modal) modal.classList.remove('hidden');
  },

  hideLibraryUploadModal() {
    const modal = document.getElementById('library-upload-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleLibraryUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const subjectInput = document.getElementById('lib-upload-subject');
    const subject = subjectInput ? subjectInput.value.trim() : 'General';
    if (!subject) {
      this.showToast('Please enter a subject name.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      // Store as ArrayBuffer (not base64) to save ~33% storage
      await this.dbAdd('library', {
        name: file.name,
        exam: this.state.activeLibExam,
        subject: subject,
        data: e.target.result,  // ArrayBuffer
        type: file.type
      });
      this.hideLibraryUploadModal();
      this.renderLibraryContent();
      this.showToast('Book added to your shelf!', 'success');
    };
    reader.readAsArrayBuffer(file);
  },

  async openLocalBook(id) {
    const book = await this.dbGet('library', parseInt(id));
    if (!book) return;

    try {
      let blob;
      if (book.data instanceof ArrayBuffer || book.data instanceof Uint8Array) {
        blob = new Blob([book.data], { type: book.type || 'application/pdf' });
      } else {
        // Legacy: handle old base64/dataURL entries
        const fetchRes = await fetch(book.data);
        blob = await fetchRes.blob();
      }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      console.error('Failed to open book', e);
      this.showToast('Could not open this book.', 'error');
    }
  },

  // --- Admin Cloud Upload ---
  async adminUploadBook() {
    const title = document.getElementById('admin-book-title')?.value.trim();
    const subject = document.getElementById('admin-book-subject')?.value.trim();
    const exam = document.getElementById('admin-book-exam')?.value;
    const fileInput = document.getElementById('admin-book-file');
    const file = fileInput?.files[0];

    if (!title || !subject || !file) {
      this.showToast('Please fill all fields and select a PDF.', 'error');
      return;
    }
    if (!this.state.user) {
      this.showToast('You must be signed in to upload cloud books.', 'error');
      return;
    }

    const btn = document.getElementById('admin-upload-btn');
    const originalText = btn?.textContent;
    if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }

    try {
      const storageRef = this.storage.ref(`library_books/${exam}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);
      const snapshot = await storageRef.put(file);
      const downloadURL = await snapshot.ref.getDownloadURL();

      await this.db.collection('library_books').add({
        title, subject, exam, url: downloadURL,
        addedBy: this.state.user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.showToast('Book uploaded successfully to cloud!', 'success');
      if (document.getElementById('admin-book-title')) document.getElementById('admin-book-title').value = '';
      if (document.getElementById('admin-book-subject')) document.getElementById('admin-book-subject').value = '';
      if (fileInput) fileInput.value = '';
      if (this.state.currentView === 'library') this.renderLibraryContent();
    } catch (e) {
      console.error(e);
      this.showToast('Upload failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  },
};
