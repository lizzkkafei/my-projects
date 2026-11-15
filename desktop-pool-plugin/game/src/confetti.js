// ============================================================================
//  confetti.js — 胜利礼花
//  ---------------------------------------------------------------------------
//  纯 Canvas2D 粒子，无依赖。做成两段式：
//    1) 从屏幕下方两侧斜向射出的"礼花炮"，带拖尾
//    2) 空中炸开后受重力与空气阻力下落的彩色碎片，边落边旋转
//  帧循环里不分配内存（粒子对象池化），离开时自动停止。
// ============================================================================

const COLORS = [
  '#ffd76e', '#ffb347', '#ff6b6b', '#f06292',
  '#7dd3fc', '#4ade80', '#c084fc', '#fff3c4',
];

class Particle {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.w = 0; this.h = 0;
    this.rot = 0; this.vrot = 0;
    this.color = '#fff';
    this.life = 0; this.maxLife = 1;
    this.kind = 0;      // 0 = 碎片, 1 = 拖尾点
    this.grav = 1;
    this.drag = 1;
  }
}

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.pool = [];
    this.max = 900;
    for (let i = 0; i < this.max; i++) this.pool.push(new Particle());
    this.cursor = 0;
    this.t = 0;
    this.last = 0;
    this._raf = 0;
    this.bursts = [];
  }

  _spawn(x, y, vx, vy, kind, color, size) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[(this.cursor + i) % this.pool.length];
      if (p.active) continue;
      this.cursor = (this.cursor + i + 1) % this.pool.length;
      p.active = true;
      p.x = x; p.y = y;
      p.vx = vx; p.vy = vy;
      p.kind = kind;
      p.color = color || COLORS[(Math.random() * COLORS.length) | 0];
      p.w = size || (4 + Math.random() * 5);
      p.h = p.w * (0.45 + Math.random() * 0.5);
      p.rot = Math.random() * Math.PI * 2;
      p.vrot = (Math.random() - 0.5) * 14;
      p.maxLife = kind === 1 ? 0.5 + Math.random() * 0.4 : 2.2 + Math.random() * 1.6;
      p.life = p.maxLife;
      p.grav = kind === 1 ? 260 : 760;
      p.drag = kind === 1 ? 0.90 : 0.988;
      return p;
    }
    return null;
  }

  /** 一次礼花炮：从 (x,y) 朝 angle 方向喷出 */
  cannon(x, y, angle, count = 90, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * 0.55;
      const sp = (420 + Math.random() * 620) * power;
      this._spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0, null,
        5 + Math.random() * 7);
    }
  }

  /** 空中爆开：一圈均匀撒开 */
  burst(x, y, count = 70, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const sp = (260 + Math.random() * 560) * power;
      this._spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0, null,
        4 + Math.random() * 6);
    }
  }

  /** 胜利编排：两门礼花炮 + 三轮空中炸开 */
  celebrate() {
    const w = this.canvas.width / this.dpr();
    const h = this.canvas.height / this.dpr();
    this.bursts = [
      // 两侧礼花炮（从屏幕底角斜射）
      { t: 0.00, fn: () => this.cannon(-20, h + 20, -Math.PI / 3.1, 80, 1.05) },
      { t: 0.00, fn: () => this.cannon(w + 20, h + 20, -Math.PI * 2 / 3.1, 80, 1.05) },
      // 空中炸开（位置在画面上部，趁粒子还在飞）
      { t: 0.28, fn: () => this.burst(w * 0.26, h * 0.30, 70, 1.0) },
      { t: 0.46, fn: () => this.burst(w * 0.74, h * 0.26, 70, 1.0) },
      { t: 0.72, fn: () => this.burst(w * 0.50, h * 0.18, 95, 1.15) },
      // 二次喷射，延长庆祝时间
      { t: 1.15, fn: () => this.cannon(-20, h + 20, -Math.PI / 3.3, 55, 0.9) },
      { t: 1.15, fn: () => this.cannon(w + 20, h + 20, -Math.PI * 2 / 3.3, 55, 0.9) },
    ];
  }

  dpr() { return Math.min(window.devicePixelRatio || 1, 2); }

  resize() {
    const dpr = this.dpr();
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t = 0;
    this.resize();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.celebrate();
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      this.step(dt);
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const p of this.pool) p.active = false;
    this.bursts = [];
    // 清空必须用"缓冲区原始坐标系"，否则 setTransform(dpr) 之后
    // clearRect(0,0,width,height) 只会清掉左上角一小块，残留旧帧。
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  step(dt) {
    // 定时触发编排里的爆点
    for (const b of this.bursts) {
      if (!b.done && this.t >= b.t) { b.done = true; b.fn(); }
    }
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      // 飘出屏幕外就回收
      if (p.y > this.canvas.height / this.dpr() + 80) p.active = false;
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr();
    const h = this.canvas.height / this.dpr();
    ctx.clearRect(0, 0, w, h);
    for (const p of this.pool) {
      if (!p.active) continue;
      const a = Math.min(1, p.life / 0.45);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      // 碎片画成小矩形（有厚度感），拖尾点画成圆
      if (p.kind === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  }
}
