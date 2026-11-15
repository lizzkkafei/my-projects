// ============================================================================
//  aim.js — 瞄准系统
//  ---------------------------------------------------------------------------
//  组成：
//    1. 鼠标位置 → 台面上的瞄准方向（射线与台面求交）
//    2. 幽灵球（ghost ball）：母球碰到目标球时的位置，这是判断薄厚的核心
//    3. 辅助线：母球线 / 目标球预测线 / 库边反弹线
//    4. 杆法（spin）：球面上的击球点，控制跟杆/缩杆/左右塞
//    5. 力度：蓄力条
// ============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';

const R = CONFIG.ball.radius;

/** 把角度规约到 (-π, π] */
function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class AimSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.angle = 0;          // 瞄准角（弧度），物理坐标系
    // ---- 精细瞄准 ----
    // fineMode: 按住 Shift 时鼠标灵敏度降到 1/8，用于微调
    // subPx:    鼠标的"亚像素"累积量。原始鼠标事件是整数像素，
    //           近距离瞄准时 1px ≈ 0.5°，完全不足以做毫米级控制，
    //           因此把高精度指针增量（pointerrawupdate / movementX 的分数部分）
    //           累积起来，等攒够 1px 再应用。
    this.fineMode = false;
    this.fineScale = 0.125;      // Shift 精调倍率
    this.subX = 0; this.subY = 0;
    this.pointerRawX = null; this.pointerRawY = null;
    // fineOffset：精调期间累积的角度偏移。
    // 普通模式 = 光标角度 + fineOffset，这样"微调过的角度"不会被下一次
    // 光标移动覆盖掉；切换模式时把差值吸收进 fineOffset，画面不跳。
    this.fineOffset = 0;
    this._lastCursorAngle = null;
    this.power = 0.55;
    this.spin = { x: 0, y: 0 };  // -0.45..0.45
    this.active = true;
    this.pointer = new THREE.Vector2(0, 0);

    this.group = new THREE.Group();
    this.group.name = 'aim';
    scene.add(this.group);

    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
    });
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false,
    });
    const aimLineMat = new THREE.LineDashedMaterial({
      color: 0x9be7c4, dashSize: 0.022, gapSize: 0.016,
      transparent: true, opacity: 0.9, depthWrite: false,
    });

    // 母球出发线
    this.cueLine = new THREE.Line(new THREE.BufferGeometry(), lineMat);
    // 幽灵球
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), ghostMat);
    // 目标球预测线
    this.targetLine = new THREE.Line(new THREE.BufferGeometry(), aimLineMat);
    // 母球撞后走向（切线）
    this.cueAfterLine = new THREE.Line(new THREE.BufferGeometry(), aimLineMat);
    // 落点指示环
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 1.06, R * 1.22, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;

    for (const o of [this.cueLine, this.ghost, this.targetLine, this.cueAfterLine, this.ring]) {
      o.renderOrder = 10;
      this.group.add(o);
    }
    this.group.visible = false;
  }

  setVisible(v) { this.group.visible = v; }

  /** 物理平面坐标 → three 世界坐标 */
  _to3(x, y, h = 0.001) { return new THREE.Vector3(x, h, -y); }

  updateCueBall() {
    const c = this.world.cue;
    this.ring.position.copy(this._to3(c.x, c.y, 0.0015));
  }

  /**
   * 根据瞄准角与母球位置，计算射线命中的第一个球
   * @returns {{hit:null|{ball,dist,ghostX,ghostY}}}
   */
  trace() {
    const c = this.world.cue;
    const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
    const hit = this.world.raycastBall(c.x, c.y, dx, dy, CONFIG.gameplay.guideLength * 2, c);
    if (!hit) return { hit: null, dx, dy };

    const b = hit.ball;
    // 幽灵球位置：母球球心在接触瞬间的位置
    const gx = b.x - dx * R * 2;
    const gy = b.y - dy * R * 2;
    const dist = Math.hypot(gx - c.x, gy - c.y);
    return { hit: { ball: b, dist, gx, gy }, dx, dy };
  }

  refresh() {
    const c = this.world.cue;
    const n = CONFIG.gameplay.guideLength;
    const t = this.trace();
    const y = 0.002;

    const px = c.x + Math.cos(this.angle) * n;
    const py = c.y + Math.sin(this.angle) * n;

    if (t.hit) {
      const { gx, gy, ball, dist } = t.hit;

      // 母球线：母球 → 幽灵球
      this._setLine(this.cueLine, c.x, c.y, gx, gy, y);

      // 幽灵球
      this.ghost.visible = true;
      this.ghost.position.copy(this._to3(gx, gy, R));

      // 目标球预测线：从目标球心出发，沿球心连线
      const nx = ball.x - gx, ny = ball.y - gy;
      const nl = Math.hypot(nx, ny) || 1;
      const ux = nx / nl, uy = ny / nl;
      const tl = Math.min(0.85, n * 0.75);
      this._setLine(this.targetLine, ball.x, ball.y, ball.x + ux * tl, ball.y + uy * tl, y);
      this.targetLine.computeLineDistances();

      // 母球撞后走向：切线方向（薄厚决定强度）
      // 法线分量给目标球，切向分量留给母球
      const cosT = Math.max(0, Math.min(1, Math.cos(this.angle - Math.atan2(uy, ux))));
      const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const tx = Math.cos(this.angle), ty = Math.sin(this.angle);
      // 切向 = 入射方向 - 法向分量
      let cx = tx - ux * (tx * ux + ty * uy);
      let cy = ty - uy * (tx * ux + ty * uy);
      const cl = Math.hypot(cx, cy) || 1;
      cx /= cl; cy /= cl;
      const afterLen = Math.min(0.5, n * 0.42) * sinT;
      this.cueAfterLine.visible = sinT > 0.08;
      this._setLine(this.cueAfterLine, ball.x - ux * R * 2, ball.y - uy * R * 2,
        ball.x - ux * R * 2 + cx * afterLen, ball.y - uy * R * 2 + cy * afterLen, y);
      this.cueAfterLine.computeLineDistances();
    } else {
      this._setLine(this.cueLine, c.x, c.y, px, py, y);
      this.ghost.visible = false;
      this.targetLine.visible = false;
      this.cueAfterLine.visible = false;
    }
    if (t.hit) this.targetLine.visible = true;
    this.updateCueBall();
  }

  _setLine(line, x1, y1, x2, y2, h) {
    const pos = line.geometry.attributes.position;
    if (!pos || pos.count !== 2) {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    }
    const a = line.geometry.attributes.position.array;
    a[0] = x1; a[1] = h; a[2] = -y1;
    a[3] = x2; a[4] = h; a[5] = -y2;
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  /** 把屏幕坐标转成瞄准角 */
  aimAtScreen(ndcX, ndcY, camera, raycaster, plane) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, p)) return;
    const c = this.world.cue;
    const dx = p.x - c.x;
    const dy = -(p.z - (-c.y)); // 世界 z = -物理 y
    this.angle = Math.atan2(dy, dx);
    this.refresh();
  }

  /** 键盘/按钮微调。delta 为弧度 */
  nudge(delta) {
    this.angle += delta;
    // 保持在 (-π, π]，避免长期累积后精度损失
    if (this.angle > Math.PI) this.angle -= Math.PI * 2;
    if (this.angle <= -Math.PI) this.angle += Math.PI * 2;
    this.refresh();
  }

  /**
   * 光标位置 → 瞄准角（绝对指向）。
   * 这一步给的是"全向自由度"：光标在台面上绕母球转一圈，杆就能指一圈。
   * 精调偏移 fineOffset 会叠加在上面，所以微调结果不会被覆盖。
   * @returns {boolean} 是否成功求交（光标射线没打到台面时返回 false）
   */
  aimFromCursor(ndcX, ndcY, camera, raycaster, plane) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, p)) return false;
    const c = this.world.cue;
    const dx = p.x - c.x;
    const dy = -p.z - c.y;          // 世界 z = -物理 y
    // 光标几乎压在母球上时方向不可靠，保持原角度
    if (Math.hypot(dx, dy) < 0.02) return false;
    const cursorAngle = Math.atan2(dy, dx);
    this._lastCursorAngle = cursorAngle;
    this.angle = wrapPi(cursorAngle + this.fineOffset);
    this.refresh();
    return true;
  }

  /**
   * 精调：只按像素增量转，不受光标位置影响。
   * @param {number} dx 水平像素增量
   * @param {number} dy 垂直像素增量
   * @param {number} pxPerRad 每弧度对应多少像素
   */
  rotateByPixels(dx, degPerPx) {
    const d = (dx * (degPerPx ?? 0.125)) * Math.PI / 180;
    this.angle = wrapPi(this.angle + d);
    this.fineOffset = 0;      // 纯增量模式不再需要偏移补偿
    this.refresh();
  }

  /** 切换精调模式：把当前角度差吸收进 fineOffset，避免画面跳动 */
  setFineMode(on) {
    const want = !!on;
    if (want === this.fineMode) return;
    if (!want && this._lastCursorAngle !== null) {
      // 退出精调：重新对齐到"光标角度 + 已累积偏移"
      this.fineOffset = wrapPi(this.angle - this._lastCursorAngle);
    }
    this.fineMode = want;
  }

  /** 重置精调偏移（换杆/重开时用） */
  resetFineOffset() { this.fineOffset = 0; this._lastCursorAngle = null; }

  resetSpin() { this.spin.x = 0; this.spin.y = 0; }
}
