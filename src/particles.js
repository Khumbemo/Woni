/**
 * Woni — Particle Background Module
 * Handles the animated particle canvas with mouse interaction.
 * Supports pause/resume for battery conservation.
 */

export const particleMixin = {
  _particleAnimId: null,
  _particlesPaused: false,

  initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const mouse = { x: null, y: null, radius: 150 };

    window.addEventListener('mousemove', e => { mouse.x = e.x; mouse.y = e.y; });

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();

    const self = this;

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.baseX = this.x;
        this.baseY = this.y;
        this.size = Math.random() * 2 + 1;
        this.density = Math.random() * 30 + 1;
        this.speedX = Math.random() * 0.5 - 0.25;
        this.speedY = Math.random() * 0.5 - 0.25;
        this.color = document.body.classList.contains('dark-theme')
          ? 'rgba(255,255,255,0.15)'
          : 'rgba(0,0,0,0.08)';
      }
      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        let dx = mouse.x - this.x, dy = mouse.y - this.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let forceX = dx / dist, forceY = dy / dist;
        let maxDist = mouse.radius;
        let force = (maxDist - dist) / maxDist;
        let dirX = forceX * force * this.density;
        let dirY = forceY * force * this.density;
        if (dist < mouse.radius) { this.x -= dirX; this.y -= dirY; }
        if (this.x > canvas.width) this.x = 0;
        if (this.x < 0) this.x = canvas.width;
        if (this.y > canvas.height) this.y = 0;
        if (this.y < 0) this.y = canvas.height;
      }
      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const createParticles = () => {
      particles = [];
      const count = Math.min(Math.floor(canvas.width * canvas.height / 15000), 100);
      for (let i = 0; i < count; i++) particles.push(new Particle());
    };

    const animate = () => {
      if (self._particlesPaused) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => { p.update(); p.draw(); });
      self._particleAnimId = requestAnimationFrame(animate);
    };

    createParticles();
    animate();

    // Pause when tab is hidden (battery optimization)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        self.pauseParticles();
      } else {
        self.resumeParticles();
      }
    });
  },

  pauseParticles() {
    this._particlesPaused = true;
    if (this._particleAnimId) {
      cancelAnimationFrame(this._particleAnimId);
      this._particleAnimId = null;
    }
  },

  resumeParticles() {
    if (!this._particlesPaused) return;
    this._particlesPaused = false;
    // Re-trigger the animation loop
    this.initParticles();
  },
};
