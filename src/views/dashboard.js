/**
 * Woni — Dashboard View Module
 */

export const dashboardMixin = {
  async updateDashboard() {
    if (!this.state.db) return;
    const allTests = await this.dbGetAll('mock_tests');
    const examId = this.state.activeExam?.id;
    const filtered = examId ? allTests.filter(t => t.exam === examId) : allTests;

    this.updateQuote();
    this.updateBuddy();

    const mastery = filtered.length > 0
      ? Math.round(filtered.reduce((s, t) => s + t.score, 0) / filtered.length)
      : 0;

    const masteryEl = document.getElementById('dash-mastery');
    if (masteryEl) masteryEl.textContent = `${mastery}%`;

    const studyEl = document.getElementById('dash-study-time');
    if (studyEl) studyEl.textContent = `${filtered.length * 20}m`;

    const streakEl = document.getElementById('dash-streak');
    if (streakEl) streakEl.textContent = `${new Set(allTests.map(t => new Date(t.date).toDateString())).size}d`;

    if (examId) {
      const topics = await this.dbGetFromIndex('topics', 'exam', examId);
      const recList = document.getElementById('recommendations-list');
      if (recList) {
        if (topics.length > 0) {
          const top = topics.sort((a, b) => (a.mastery || 0) - (b.mastery || 0)).slice(0, 3);
          recList.className = 'rec-list';
          recList.innerHTML = top.map(t => `
            <div class="rec-card" data-action="showTopicStudy" data-param="${this.escapeHtml(t.name)}">
              <div class="rec-name">${this.escapeHtml(t.name)}</div>
              <div class="rec-bar"><div class="rec-fill" style="width:${t.mastery || 0}%"></div></div>
              <div class="rec-label">${t.mastery || 0}% mastery · ${t.frequency || 0}% importance</div>
            </div>
          `).join('');
        } else {
          recList.className = 'empty-list';
          recList.innerHTML = 'Upload papers to see recommendations.';
        }
      }
      this.updateLucide();
    }
  },

  showTopicStudy(topicName) {
    this.showToast('Topic focus: ' + topicName, 'info');
  },

  async updateBuddy() {
    if (!this.state.db) return;
    const tests = await this.dbGetAll('mock_tests');
    const streakEl = document.getElementById('dash-streak');
    const streak = (streakEl && parseInt(streakEl.textContent)) || 0;

    // Time-of-day aware greetings
    const hour = new Date().getHours();
    let greeting;
    if (hour < 6) greeting = "Burning the midnight oil? Your dedication is legendary!";
    else if (hour < 12) greeting = "Good morning, scholar! A fresh start to conquer your goals.";
    else if (hour < 17) greeting = "Good afternoon! Keep the momentum going strong.";
    else if (hour < 21) greeting = "Evening study session? Smart move — consistency wins.";
    else greeting = "Late-night revision? Remember to rest well too!";

    let msg = greeting;
    let icon = "smile";

    if (streak >= 7) {
      msg = `🔥 ${streak} day streak! You're in the elite zone of focus!`;
      icon = "zap";
    } else if (tests.length > 0) {
      const lastTest = tests[tests.length - 1];
      if (lastTest.score > 80) {
        msg = `Incredible! ${lastTest.score}% on your last test. Your mastery is growing!`;
        icon = "award";
      } else if (lastTest.score < 50) {
        msg = "That last test was tough, but remember: failure is just data for success. Let's review!";
        icon = "frown";
      }
    }

    const msgEl = document.getElementById('buddy-msg');
    const iconContainer = document.getElementById('buddy-icon-container');
    if (msgEl) msgEl.textContent = msg;
    if (iconContainer) {
      iconContainer.innerHTML = `<i data-lucide="${icon}"></i>`;
    }
    this.updateLucide();
  },

  async updateQuote() {
    const quotes = [
      { text: "Science is a way of thinking much more than it is a body of knowledge.", author: "Carl Sagan" },
      { text: "The important thing is not to stop questioning.", author: "Albert Einstein" },
      { text: "Everything is theoretically impossible, until it is done.", author: "Robert A. Heinlein" },
      { text: "The good thing about science is that it's true whether or not you believe in it.", author: "Neil deGrasse Tyson" },
      { text: "Science and everyday life cannot and should not be separated.", author: "Rosalind Franklin" },
      { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
      { text: "Don't let what you cannot do interfere with what you can do.", author: "John Wooden" }
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    const textEl = document.getElementById('quote-text');
    const authorEl = document.getElementById('quote-author');
    if (textEl) textEl.textContent = `"${q.text}"`;
    if (authorEl) authorEl.textContent = `— ${q.author}`;
  },

  updateActiveExamBadge() {
    const dashBadge = document.getElementById('active-exam-badge-dash');
    const pracBadge = document.getElementById('active-exam-badge-practice');
    const name = this.state.activeExam ? this.state.activeExam.name : '';
    [dashBadge, pracBadge].forEach(el => {
      if (el) {
        if (name) { el.textContent = name; el.classList.remove('hidden'); }
        else { el.classList.add('hidden'); }
      }
    });
  },
};
