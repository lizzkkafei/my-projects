// ============================================================================
//  physics.js — 台球物理内核
//  ---------------------------------------------------------------------------
//  模型：刚体球（质量 m、半径 R、转动惯量 I = 2/5 mR²），在水平台面上。
//  每个球维护 2D 位置/速度 + 3D 角速度（z 分量是"竖直自旋/塞"）。
//
//  三个阶段（Han 2005）：
//    sliding  接触点相对速度 u ≠ 0 → 滑动摩擦，同时把 u 拉回 0
//    rolling  u = 0 → 滚动摩擦让球自然减速
//    spinning 竖直自旋单独按旋转摩擦衰减
//
//  碰撞：
//    球-球  法向恢复系数 + 切向摩擦（产生 throw 偏移与传塞）
//    球-库  恢复系数 + 切向摩擦 + 接触点高于球心（产生回旋/吃库变线）
//
//  时间：固定步长 + 按速度自适应子步，保证单子步位移 < R/2，杜绝穿透。
// ============================================================================

import { CONFIG } from './config.js';

const R = CONFIG.ball.radius;
const M = CONFIG.ball.mass;
const I = 0.4 * M * R * R; // 实心球转动惯量
const G = CONFIG.physics.gravity;

// ---------------------------------------------------------------------------
// 台面几何：库边线段 + 袋口立柱 + 袋口捕获圆
// 坐标系：x 为长轴，y 为短轴，台面中心在原点。单位 m。
// 物理里用 (x, y)；渲染时映射到 three.js 的 (x, z)。
// ---------------------------------------------------------------------------
export function buildTableGeometry() {
  const T = CONFIG.table;
  const hx = T.length / 2;
  const hy = T.width / 2;
  const ce = T.cornerEndInset;
  const ces = T.cornerEndInsetShort;
  const sg = T.sideHalfGap;

  // 每条库用线段表示，法线指向台内
  const cushions = [];
  const add = (ax, ay, bx, by, nx, ny) => cushions.push({ ax, ay, bx, by, nx, ny });

  // 上库 (y = +hy)，法线 (0,-1)：被中袋分成两段
  add(-(hx - ce), hy, -sg, hy, 0, -1);
  add(sg, hy, hx - ce, hy, 0, -1);
  // 下库 (y = -hy)
  add(-(hx - ce), -hy, -sg, -hy, 0, 1);
  add(sg, -hy, hx - ce, -hy, 0, 1);
  // 右库 (x = +hx)
  add(hx, -(hy - ces), hx, hy - ces, -1, 0);
  // 左库
  add(-hx, -(hy - ces), -hx, hy - ces, 1, 0);

  // 袋口立柱（球撞上去会"弹袋口"，真实感关键）
  const jaws = [];
  const jr = T.jawRadius;
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sx, sy] of corners) {
    jaws.push({ x: sx * (hx - ce), y: sy * hy, r: jr });
    jaws.push({ x: sx * hx, y: sy * (hy - ces), r: jr });
  }
  // 中袋两侧
  for (const sy of [1, -1]) {
    jaws.push({ x: -sg, y: sy * hy, r: jr * 0.85 });
    jaws.push({ x: sg, y: sy * hy, r: jr * 0.85 });
  }

  // 袋口捕获点
  const pockets = [];
  for (const [sx, sy] of corners) {
    pockets.push({
      x: sx * (hx - 0.012), y: sy * (hy - 0.012),
      r: T.cornerCapture, type: 'corner', sx, sy,
      // 视觉锚点（略往台外，用于袋子模型）
      vx: sx * (hx + 0.012), vy: sy * (hy + 0.012),
    });
  }
  for (const sy of [1, -1]) {
    pockets.push({
      x: 0, y: sy * (hy - 0.004),
      r: T.sideCapture, type: 'side', sx: 0, sy,
      vx: 0, vy: sy * (hy + 0.016),
    });
  }

  return { hx, hy, cushions, jaws, pockets, length: T.length, width: T.width };
}

// ---------------------------------------------------------------------------
// 球
// ---------------------------------------------------------------------------
let _ballId = 0;

export class Ball {
  constructor(num) {
    this.id = _ballId++;
    this.num = num;            // 0 = 母球，1..15
    this.stripe = num >= 9;
    this.x = 0; this.y = 0;
    this.px = 0; this.py = 0;  // 上一步位置（渲染插值）
    this.vx = 0; this.vy = 0;
    this.wx = 0; this.wy = 0; this.wz = 0;
    this.potted = false;
    this.potTimer = 0;
    this.spinAngle = 0;        // 视觉：绕自身某轴的累计旋转
    this.rotM = null;          // 视觉：朝向矩阵（渲染层维护）
    this.sleepTimer = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  setPos(x, y) { this.x = x; this.y = y; this.px = x; this.py = y; }
  stop() { this.vx = this.vy = this.wx = this.wy = this.wz = 0; this.sleepTimer = 0; }
  reset() {
    this.vx = this.vy = this.wx = this.wy = this.wz = 0;
    this.potted = false; this.potTimer = 0; this.sleepTimer = 0;
  }
}

// ---------------------------------------------------------------------------
// 世界
// ---------------------------------------------------------------------------
export class World {
  constructor() {
    this.table = buildTableGeometry();
    /** @type {Ball[]} */
    this.balls = [];
    this.cue = null;
    this.time = 0;
    /** 本帧产生的事件（供音效/规则消费） */
    this.events = [];
    this.acc = 0;
    this.moving = false;
    /** 当前这一杆的完整事件记录 */
    this.shotLog = [];
    this.recording = false;
    this._genesis();
  }

  _genesis() {
    for (let n = 0; n <= 15; n++) this.balls.push(new Ball(n));
    this.cue = this.balls[0];
  }

  get liveBalls() {
    const out = [];
    for (const b of this.balls) if (!b.potted) out.push(b);
    return out;
  }

  anyMoving() {
    for (const b of this.balls) {
      if (b.potted) continue;
      if (Math.abs(b.vx) > CONFIG.physics.sleepLinear || Math.abs(b.vy) > CONFIG.physics.sleepLinear) return true;
      if (Math.hypot(b.wx, b.wy) > CONFIG.physics.sleepAngular) return true;
      if (Math.abs(b.wz) > CONFIG.physics.sleepAngular) return true;
    }
    return false;
  }

  allSleeping() {
    for (const b of this.balls) {
      if (b.potted) continue;
      if (b.sleepTimer < CONFIG.physics.sleepTime) return false;
    }
    return true;
  }

  emit(ev) {
    this.events.push(ev);
    if (this.recording) this.shotLog.push({ ...ev, t: this.time });
  }

  // ---------------------------------------------------------------- 摆球
  /** 标准 8 球开球阵型。返回摆放位置。 */
  rackEightBall(rng = Math.random) {
    const gap = R * 2 + CONFIG.ball.margin;
    const rowGap = gap * Math.sqrt(3) / 2;
    const apexX = this.table.hx * 0.5;  // 脚点(foot spot) = 距底库 1/4 台长 = +hx/2
    const nums = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    // 洗牌但有约束：8 号在第三排正中，后排两角一花一全
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    const slots = [];
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        slots.push({
          x: apexX + row * rowGap,
          y: (k - row / 2) * gap,
          row, k,
        });
      }
    }
    // 索引：row2 中间是 slots[3+1] = 4
    const order = new Array(15).fill(0);
    order[4] = 8;
    let ni = 0;
    for (let i = 0; i < 15; i++) {
      if (i === 4) continue;
      order[i] = nums[ni++];
    }
    // 后排两角：一全一花
    const backA = 10, backB = 14; // row4 的第一个和最后一个
    if ((order[backA] >= 9) === (order[backB] >= 9)) {
      // 找出一个不同组的球交换
      for (let i = 0; i < 15; i++) {
        if (i === 4 || i === backA || i === backB) continue;
        if ((order[i] >= 9) !== (order[backA] >= 9)) {
          [order[backA], order[i]] = [order[i], order[backA]];
          break;
        }
      }
    }
    return slots.map((s, i) => ({ num: order[i], x: s.x, y: s.y }));
  }

  /** 把 1..15 摆进三角，母球放在头线后 */
  setupRack(rng) {
    const layout = this.rackEightBall(rng);
    const byNum = new Map();
    for (const b of this.balls) { b.reset(); byNum.set(b.num, b); }
    for (const { num, x, y } of layout) {
      const b = byNum.get(num);
      b.setPos(x, y);
    }
    this.cue.setPos(-this.table.hx * 0.5, 0);
    this.time = 0;
    this.events.length = 0;
  }

  // ---------------------------------------------------------------- 击球
  /**
   * @param {{x:number,y:number}} dir 单位方向
   * @param {number} power 0..1
   * @param {{x:number,y:number}} spin 球面偏移，单位 R，限 0.45
   */
  strike(dir, power, spin = { x: 0, y: 0 }) {
    const b = this.cue;
    if (b.potted) return false;
    const P = CONFIG.physics;
    const speed = Math.max(0.05, Math.min(1, power)) * P.maxSpeed;

    // 速度
    b.vx = dir.x * speed;
    b.vy = dir.y * speed;

    // 杆头接触点：球面上位于"远离击球方向"的那一侧
    //   r = -R·d̂（沿击球轴的反向）+ 侧向偏移 + 高度偏移
    // 偏移量用球面坐标表达：sx 为横向（沿左法线），sy 为竖直（+y 为上旋）
    const nx = -dir.y, ny = dir.x;      // 左法线（垂直于击球方向）
    const lim = 0.45;
    const sx = Math.max(-lim, Math.min(lim, spin.x));
    const sy = Math.max(-lim, Math.min(lim, spin.y));
    const sMag2 = Math.min(1, sx * sx + sy * sy);
    // 接触点相对球心（三维：x, y(向上), 沿击球轴）
    const rz = sy * R * Math.sqrt(1 - sMag2);   // 竖直分量（sy>0 = 击打上半部 = 上旋）
    // 沿击球轴反向的分量
    const axial = -R * Math.sqrt(1 - sMag2);
    const rx = axial * dir.x + sx * R * nx;
    const ry = axial * dir.y + sx * R * ny;

    // 冲量 J = m·v 只沿击球方向（无摩擦时）
    const Jx = M * b.vx, Jy = M * b.vy;

    // ω = (r × J)/I，其中 r × J（J 的竖直分量为 0）
    //   (rx,ry,rz) × (Jx,Jy,0) = (ry*0 - rz*Jy, rz*Jx - rx*0, rx*Jy - ry*Jx)
    // 由于 r 的 xy 分量与 J 平行（axial 项），第三项会互相抵消 —— 这是对的：
    // 纯沿轴击打不会产生竖直自旋。竖直自旋来自"偏心"的那部分 r。
    b.wx = (-rz * Jy) / I;
    b.wy = (rz * Jx) / I;
    b.wz = (rx * Jy - ry * Jx) / I;

    // 但球桌台面会约束"侧向"自旋，现实中横向塞主要靠杆头斜击产生。
    // 这里用一个显式项补充：横向偏移 sx 直接产生绕竖直轴的角速度。
    b.wz += (sx * b.vx * M * R) / I * 0.5;

    // 自旋上限：真实杆法极限，超过这个值球会打滑/跳球而非转得更快
    const wMax = (Math.abs(speed) / R) * 1.45;
    const wMag = Math.hypot(b.wx, b.wy);
    if (wMag > wMax && wMag > 1e-9) {
      const k2 = wMax / wMag;
      b.wx *= k2; b.wy *= k2;
    }

    b.sleepTimer = 0;
    this.events.push({ type: 'cueStrike', power: Math.min(1, power), speed });
    if (this.recording) this.shotLog.push({ type: 'cueStrike', power, speed, t: this.time });
    return true;
  }

  // ---------------------------------------------------------------- 主循环
  /**
   * 推进物理。dt 为真实帧时间，内部用固定步长累积。
   * @returns {Array} 本帧事件
   */
  update(dt) {
    this.events.length = 0;
    const P = CONFIG.physics;
    const stepDt = 1 / P.hz;
    if (dt > P.maxFrameTime) dt = P.maxFrameTime;
    this.acc += dt;
    let guard = 0;
    while (this.acc >= stepDt && guard++ < 8) {
      this._fixedStep(stepDt);
      this.acc -= stepDt;
    }
    if (guard >= 8) this.acc = 0;
    return this.events;
  }

  _fixedStep(dt) {
    this.time += dt;
    // 按最快球的速度拆子步
    let vmax = 0;
    for (const b of this.balls) {
      if (b.potted) continue;
      const s = Math.abs(b.vx) + Math.abs(b.vy);
      if (s > vmax) vmax = s;
    }
    const P = CONFIG.physics;
    const maxMove = R * 0.45;
    let sub = Math.ceil((vmax * dt) / maxMove);
    if (sub < 1) sub = 1;
    if (sub > P.maxSubSteps) sub = P.maxSubSteps;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this._subStep(h);
  }

  _subStep(h) {
    const P = CONFIG.physics;
    const balls = this.balls;

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.potted) continue;
      b.px = b.x; b.py = b.y;

      // ---- 摩擦：先判断滑动还是滚动
      // 接触点（球底）相对速度：u = v + ω × r_contact，
      // 其中 r_contact = (0,-R,0)（从球心指向台面接触点）
      //   ω × r = (wx,wy,wz) × (0,-R,0) = (R·wz - 0, 0, -R·wx) ← 只看水平面
      // 但水平 ω 的 (wx,wy) 是绕 x/y 轴，与 2D 平面 (x,y) 的耦合是：
      //   纯滚动 ⇔ v = -ω × r  →  vx = R·wy, vy = -R·wx
      // 因此定义：
      //   ux = vx - R·wy
      //   uy = vy + R·wx
      const ux = b.vx - R * b.wy;
      const uy = b.vy + R * b.wx;
      const uMag = Math.hypot(ux, uy);

      if (uMag > 0.02) {
        // 滑动：接触点滑动摩擦 f = -u_s·g·û
        const a = P.uSlide * G;
        const uhx = ux / uMag, uhy = uy / uMag;
        b.vx -= a * uhx * h;
        b.vy -= a * uhy * h;
        // 力矩必须让 u 趋向 0：du/dt = -a·û - (5/2)·a·û = -(7/2)·a·û
        //   dux/dt = dvx/dt - R·dwy/dt = -a·uhx - R·dwy/dt
        //   要求 dux/dt = -k·uhx (k>0) ⇒ R·dwy/dt = -(k - a)·uhx
        //   取 k = (7/2)a ⇒ dwy/dt = -(5/2)(a/R)·uhx
        // ux = vx - R·wy  ⇒  dvx/dt = -a·uhx, 需要 dwy/dt = -(k·uhx)/R 且 k>a
        // 取 dwy/dt = +(5/2)(a/R)·uhx 会让 ux 减小吗？
        // dux/dt = dvx/dt - R·dwy/dt = -a·uhx - R·(5/2)(a/R)·uhx = -(7/2)a·uhx ✓ 减小
        const k = (2.5 * a) / R;
        b.wy += (uhx) * k * h;
        b.wx -= (uhy) * k * h;
      } else {
        // 滚动：强制纯滚动约束
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > P.sleepLinear * 2) {
          const dec = Math.min(P.uRoll * G * h, sp);
          b.vx -= (b.vx / sp) * dec;
          b.vy -= (b.vy / sp) * dec;
        } else {
          b.vx = 0; b.vy = 0;
        }
        // vx = R·wy, vy = -R·wx
        b.wy = b.vx / R;
        b.wx = -b.vy / R;
      }

      // 竖直自旋（塞）：靠台布摩擦持续衰减
      if (Math.abs(b.wz) > 1e-4) {
        const dws = (P.uSpin * G / R) * h;
        b.wz -= Math.sign(b.wz) * Math.min(Math.abs(b.wz), dws);
      }

      // ---- 位移
      b.x += b.vx * h;
      b.y += b.vy * h;

      // ---- 静止计数
      const spd = Math.hypot(b.vx, b.vy);
      if (spd < P.sleepLinear && Math.abs(b.wz) < P.sleepAngular) {
        b.sleepTimer += h;
        if (b.sleepTimer > P.sleepTime) {
          b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0;
        }
      } else {
        b.sleepTimer = 0;
      }
    }

    // ---- 碰撞
    this._collideBalls();
    this._collideCushions();
    this._checkPockets();
  }

  // ------------------------------------------------------------- 球-球
  // 采用"接触点相对速度 + 法向/切向冲量"的模型。
  // 关键：接触点 r_a = +R·n（从 a 球心指向接触点），r_b = -R·n。
  //      接触点速度 = v + ω × r
  _collideBalls() {
    const balls = this.balls;
    const P = CONFIG.physics;
    const d0 = R * 2;

    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.potted) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.potted) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= d0 * d0 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;

        // 1) 位置分离
        const overlap = d0 - d;
        a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;

        // 2) 法向相对速度（只用法向分量判断是否接近，避免把自旋误判）
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn <= 0) continue;   // 正在分离

        // 3) 法向冲量（等质量弹性 + 恢复系数）
        const e = P.eBallBall;
        const jn = ((1 + e) * vn * M) / 2;
        a.vx -= (jn * nx) / M; a.vy -= (jn * ny) / M;
        b.vx += (jn * nx) / M; b.vy += (jn * ny) / M;

        // 4) 切向：用接触点速度（含自旋）算 throw
        const rax = R * nx, ray = R * ny;         // a 的接触点（相对 a 球心）
        const rbx = -R * nx, rby = -R * ny;       // b 的接触点
        // contact velocity = v + ω × r，其中 ω=(wx,wy,wz)，r=(rx,ry,0)
        //   ω × r = (wy*0 - wz*ry, wz*rx - wx*0, wx*ry - wy*rx)
        const cax = a.vx - a.wz * ray;
        const cay = a.vy + a.wz * rax;
        const cbx = b.vx - b.wz * rby;
        const cby = b.vy + b.wz * rbx;
        let tx = (cax - cbx), ty = (cay - cby);
        // 去掉法向分量
        const tdotn = tx * nx + ty * ny;
        tx -= tdotn * nx; ty -= tdotn * ny;
        const tMag = Math.hypot(tx, ty);
        if (tMag > 1e-6) {
          tx /= tMag; ty /= tMag;
          // 等效质量（两球平动 + 两者自旋）：m_eff = 2m/7
          const mEff = (2 * M) / 7;
          let jt = -tMag * mEff;
          const maxJt = P.uBallBall * jn;
          if (jt < -maxJt) jt = -maxJt;
          if (jt > maxJt) jt = maxJt;

          a.vx += (jt * tx) / M; a.vy += (jt * ty) / M;
          b.vx -= (jt * tx) / M; b.vy -= (jt * ty) / M;
          // 力矩 τ = r × Jt，Jt 在切向 (tx,ty,0)
          //   (rax,ray,0) × (jx,jy,0) = (0, 0, rax*jy - ray*jx)
          const tqa = rax * (jt * ty) - ray * (jt * tx);
          const tqb = rbx * (-jt * ty) - rby * (-jt * tx);
          a.wz += tqa / I;
          b.wz += tqb / I;
        }

        const sp = Math.abs(vn);
        if (sp > 0.02) {
          this.emit({ type: 'ballBall', a: a.num, b: b.num, speed: sp, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
        a.sleepTimer = 0; b.sleepTimer = 0;
        a._rolling = false; b._rolling = false;
      }
    }
  }

  // ------------------------------------------------------------- 球-库
  _collideCushions() {
    const { cushions, jaws } = this.table;
    const P = CONFIG.physics;

    for (const b of this.balls) {
      if (b.potted) continue;

      // 线段
      for (let i = 0; i < cushions.length; i++) {
        const c = cushions[i];
        const ex = c.bx - c.ax, ey = c.by - c.ay;
        const len2 = ex * ex + ey * ey;
        let t = ((b.x - c.ax) * ex + (b.y - c.ay) * ey) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const cx = c.ax + ex * t, cy = c.ay + ey * t;
        let dx = b.x - cx, dy = b.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist >= R || dist < 1e-9) continue;
        const nx = dx / dist, ny = dy / dist;
        // 只处理朝台内的一侧
        if (nx * c.nx + ny * c.ny < 0.2) continue;
        b.x += nx * (R - dist);
        b.y += ny * (R - dist);
        this._bounce(b, nx, ny);
      }

      // 袋口立柱（圆形障碍）
      for (let i = 0; i < jaws.length; i++) {
        const j = jaws[i];
        let dx = b.x - j.x, dy = b.y - j.y;
        const rr = R + j.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        b.x += nx * (rr - d);
        b.y += ny * (rr - d);
        this._bounce(b, nx, ny, true);
      }
    }
  }

  /**
   * 撞库反弹。n 为从库边指向球心的法线（单位）。
   * 接触点高于球心 → 产生回旋（球会"咬"一下库边）。
   */
  _bounce(b, nx, ny, isJaw = false) {
    const P = CONFIG.physics;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) return; // 已经在离开

    // 接触点：球心 - R·n，高度 +cushionContactZ·R
    const cz = P.cushionContactZ * R;
    const rcx = -R * nx, rcy = -R * ny, rcz = cz;

    const e = isJaw ? Math.min(0.92, P.eCushion + 0.05) : P.eCushion;
    let jn = -(1 + e) * vn * M;

    b.vx += (jn * nx) / M;
    b.vy += (jn * ny) / M;

    // 法向力矩（因为接触点高于球心）
    const tqx = rcy * 0 - rcz * (jn * ny);
    const tqy = rcz * (jn * nx) - rcx * 0;
    const tqz = rcx * (jn * ny) - rcy * (jn * nx);
    b.wx += tqx / I; b.wy += tqy / I; b.wz += tqz / I;

    // 切向：接触点相对速度
    const tx = -ny, ty = nx;
    // 接触点速度 = v + ω × r
    const cvx = b.vx + (b.wy * rcz - b.wz * rcy);
    const cvy = b.vy + (b.wz * rcx - b.wx * rcz);
    let vt = cvx * tx + cvy * ty;

    const mEff = M / 3.5;
    let jt = -vt * mEff;
    const maxJt = P.uCushion * Math.abs(jn);
    if (jt > maxJt) jt = maxJt;
    if (jt < -maxJt) jt = -maxJt;

    b.vx += (jt * tx) / M;
    b.vy += (jt * ty) / M;
    const jx = jt * tx, jy = jt * ty;
    b.wx += (rcy * 0 - rcz * jy) / I;
    b.wy += (rcz * jx - rcx * 0) / I;
    b.wz += (rcx * jy - rcy * jx) / I;

    const sp = Math.abs(vn);
    if (sp > 0.03) {
      this.emit({ type: isJaw ? 'jawHit' : 'cushion', speed: sp, x: b.x, y: b.y });
    }
    b.sleepTimer = 0;
  }

  // ------------------------------------------------------------- 落袋
  _checkPockets() {
    const pockets = this.table.pockets;
    for (const b of this.balls) {
      if (b.potted) continue;
      for (let i = 0; i < pockets.length; i++) {
        const p = pockets[i];
        const dx = b.x - p.x, dy = b.y - p.y;
        if (dx * dx + dy * dy > p.r * p.r) continue;
        // 落袋
        b.potted = true;
        b.potTimer = 0;
        const sp = Math.hypot(b.vx, b.vy);
        this.emit({ type: 'pot', num: b.num, speed: sp, pocket: i, x: p.x, y: p.y, px: b.x, py: b.y });
        b.vx *= 0.2; b.vy *= 0.2; b.wx = b.wy = 0;
        b.stop();
        break;
      }
    }
  }

  // ------------------------------------------------------------- 辅助
  /** 球是否在台面上（未落袋且未掉落） */
  onTable(b) { return !b.potted; }

  ballByNum(n) { return this.balls[n]; }

  /** 射线与球体求交（用于球杆/落点判定），返回最近的球 */
  raycastBall(ox, oy, dx, dy, maxDist, ignore) {
    let best = null, bestT = maxDist;
    for (const b of this.balls) {
      if (b.potted) continue;
      if (b === ignore || b.num === 0) continue;   // 跳过母球自身
      const ex = b.x - ox, ey = b.y - oy;
      const proj = ex * dx + ey * dy;
      if (proj < 0) continue;
      const perp2 = ex * ex + ey * ey - proj * proj;
      const rr = R * R;
      if (perp2 > rr) continue;
      const t = proj - Math.sqrt(rr - perp2);
      if (t < bestT) { bestT = t; best = b; }
    }
    return best ? { ball: best, dist: bestT } : null;
  }
}
