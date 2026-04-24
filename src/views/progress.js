/**
 * Woni — Progress View Module
 * Performance chart and topic mastery heatmap.
 */
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

export const progressMixin = {
  async updateProgressView() {
    if (!this.state.db) return;
    const allTests = await this.dbGetAll('mock_tests');
    const activeExamId = this.state.activeExam?.id;
    const tests = activeExamId ? allTests.filter(t => t.exam === activeExamId) : allTests;

    const topics = activeExamId
      ? await this.dbGetFromIndex('topics', 'exam', activeExamId)
      : await this.dbGetAll('topics');

    const ctxEl = document.getElementById('performance-chart');
    if (ctxEl) {
      const ctx = ctxEl.getContext('2d');
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: tests.map(t => new Date(t.date).toLocaleDateString()).slice(-10),
          datasets: [{
            label: 'Mock Test Score',
            data: tests.map(t => t.score).slice(-10),
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, max: 100 } }
        }
      });
    }

    const heatmap = document.getElementById('mastery-heatmap');
    if (heatmap) {
      if (topics.length > 0) {
        heatmap.innerHTML = topics.map(t => {
          const mastery = t.mastery || 0;
          return `<div class="heatmap-topic" style="background: rgba(16, 185, 129, ${mastery / 100 + 0.1})"><span class="ht-name">${this.escapeHtml(t.name)}</span><span class="ht-freq">${mastery}% Mastery</span><span class="ht-subtext">${t.frequency || 0}% Importance</span></div>`;
        }).join('');
      } else {
        heatmap.innerHTML = '<p class="muted">No topics analyzed yet.</p>';
      }
    }
  },
};
