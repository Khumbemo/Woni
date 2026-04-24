/**
 * Woni — Router Module
 * Handles SPA view switching, swipe navigation, and sub-view overlays.
 */

export const routerMixin = {
  VIEWS: ['dashboard', 'library', 'upload', 'practice', 'progress', 'settings'],

  initNavigation() {
    // Views array is set above
  },

  showView(viewId) {
    this.state.currentView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');

    // Smooth scroll content area to top
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });

    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewId);
    });

    if (viewId === 'dashboard') this.updateDashboard();
    if (viewId === 'library') this.updateLibraryView();
    if (viewId === 'upload') this.updateUploadView();
    if (viewId === 'practice') this.updatePracticeView();
    if (viewId === 'progress') this.updateProgressView();
    this.updateLucide();
  },

  handleSwipe(startX, endX) {
    const threshold = 100;
    const diff = endX - startX;
    if (Math.abs(diff) < threshold) return;
    if (!document.getElementById('active-session-overlay').classList.contains('hidden')) return;

    const idx = this.VIEWS.indexOf(this.state.currentView);
    if (diff > 0 && idx > 0) this.showView(this.VIEWS[idx - 1]);
    else if (diff < 0 && idx < this.VIEWS.length - 1) this.showView(this.VIEWS[idx + 1]);
  },

  showSubView(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  },

  hideSubView(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  },
};
