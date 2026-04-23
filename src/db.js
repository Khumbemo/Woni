export const dbMixin = {
  async initDB() {
    return new Promise((resolve) => {
      const attemptInit = async () => {
        try {
          if (typeof idb === 'undefined') {
            console.error('idb library not loaded. Retrying in 1s...');
            setTimeout(attemptInit, 1000);
            return;
          }
          this.state.db = await idb.openDB('woni_db', 3, {
            upgrade(db, oldVersion, newVersion) {
              // Papers store
              if (!db.objectStoreNames.contains('papers')) {
                const pStore = db.createObjectStore('papers', { keyPath: 'id', autoIncrement: true });
                pStore.createIndex('exam', 'exam');
              }
              // Questions store
              if (!db.objectStoreNames.contains('questions')) {
                const qStore = db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
                qStore.createIndex('exam', 'exam');
                qStore.createIndex('topic', 'topic');
                qStore.createIndex('paperId', 'paperId');
              }
              // Flashcards store
              if (!db.objectStoreNames.contains('flashcards')) {
                const fStore = db.createObjectStore('flashcards', { keyPath: 'id', autoIncrement: true });
                fStore.createIndex('nextReview', 'nextReview');
                fStore.createIndex('topic', 'topic');
              }
              // Progress store
              if (!db.objectStoreNames.contains('progress')) {
                db.createObjectStore('progress', { keyPath: 'id' });
              }
              // Topics store (to store topic analysis)
              if (!db.objectStoreNames.contains('topics')) {
                const tStore = db.createObjectStore('topics', { keyPath: 'id' }); // id: exam_topicName
                tStore.createIndex('exam', 'exam');
              }
              // Mock tests store
              if (!db.objectStoreNames.contains('mock_tests')) {
                const mStore = db.createObjectStore('mock_tests', { keyPath: 'id', autoIncrement: true });
                mStore.createIndex('exam', 'exam');
              }
              // Library store
              if (!db.objectStoreNames.contains('library')) {
                const lStore = db.createObjectStore('library', { keyPath: 'id', autoIncrement: true });
                lStore.createIndex('exam', 'exam');
                lStore.createIndex('subject', 'subject');
              }
            },
          });
          console.log('IndexedDB initialized');
          resolve();
        } catch (e) {
          console.error('DB init failed', e);
          setTimeout(attemptInit, 2000);
        }
      };
      attemptInit();
    });
  },

  async dbAdd(storeName, data) {
    return this.state.db.add(storeName, data);
  },
  async dbPut(storeName, data) {
    return this.state.db.put(storeName, data);
  },
  async dbGet(storeName, key) {
    return this.state.db.get(storeName, key);
  },
  async dbGetAll(storeName) {
    return this.state.db.getAll(storeName);
  },
  async dbDelete(storeName, key) {
    return this.state.db.delete(storeName, key);
  },
  async dbGetFromIndex(storeName, indexName, value) {
    return this.state.db.getAllFromIndex(storeName, indexName, value);
  }
};
