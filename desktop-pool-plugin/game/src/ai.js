// ============================================================================
//  ai.js — 对手 AI
//  ---------------------------------------------------------------------------
//  策略（不是随便打）：
//    1. 枚举所有"目标球 × 6 个袋口"，检查是否存在幽灵球位（不被遮挡）
//    2. 给每个候选打一个分：角度越正越好、距离越近越好、不阻挡越多越好
//    3. 选分最高的，按难度加入角度/力度误差
//    4. 会简单处理走位：力度按距离调，避免白球跟着掉袋
// ============================================================================

import { CONFIG } from './config.js';
import { GROUP } from './rules.js';

const R = CONFIG.ball.radius;

export class AI {
  constructor(world, rules) {
    this.world = world;
    this.rules = rules;
  }

  /** 这个位置放母球可行吗（不与其他球/袋口冲突） */
  _freeSpot(x, y, ignore, ignore2) {
    const T = this.world.table;
    if (Math.abs(x) > T.hx - R * 1.2 || Math.abs(y) > T.hy - R * 1.2) return false;
    for (const b of this.world.balls) {
      if (b.potted || b === ignore || b === ignore2 || b.num === 0) continue;
      // 允许 1.98R 的紧贴（幽灵球位天然就在目标球 2R 处）
      if (Math.hypot(b.x - x, b.y - y) < R * 1.98) return false;
    }
    for (const p of T.pockets) {
      if (Math.hypot(p.x - x, p.y - y) < p.r * 0.9) return false;
    }
    return true;
  }

  /** 线段是否被其他球挡住 */
  _clearPath(x1, y1, x2, y2, ignore) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return true;
    const ux = dx / len, uy = dy / len;
    for (const b of this.world.balls) {
      if (b.potted || b === ignore || b.num === 0) continue;
      const px = b.x - x1, py = b.y - y1;
      const proj = px * ux + py * uy;
      // 只在"线段中段"做遮挡判断；两端附近的球（就是起点球和终点球）跳过
      if (proj < R * 2.2 || proj > len - R * 2.2) continue;
      const perp = Math.abs(px * uy - py * ux);
      if (perp < R * 1.90) return false;
    }
    return true;
  }

  /** 找所有可行击球 */
  candidates() {
    const cue = this.world.cue;
    const g = this.rules.current.group;
    const target = this.rules.targetGroup();
    const T = this.world.table;
    const out = [];

    let pool;
    if (target === 8) {
      pool = [this.world.balls[8]];
    } else if (g === GROUP.NONE) {
      pool = this.world.balls.filter(b => b.num !== 0 && b.num !== 8 && !b.potted);
    } else {
      pool = this.rules.ballsOf(g);
    }
    if (pool.length === 0) pool = [this.world.balls[8]];

    for (const ball of pool) {
      if (!ball || ball.potted) continue;
      for (const p of T.pockets) {
        // 目标球 → 袋口 方向
        const dx = p.x - ball.x, dy = p.y - ball.y;
        const dist = Math.hypot(dx, dy);
        if (dist < R) continue;
        const ux = dx / dist, uy = dy / dist;

        // 幽灵球位置
        const gx = ball.x - ux * R * 2;
        const gy = ball.y - uy * R * 2;
        if (!this._freeSpot(gx, gy, cue, ball)) continue;
        if (!this._clearPath(ball.x, ball.y, p.x, p.y, ball)) continue;
        if (!this._clearPath(cue.x, cue.y, gx, gy, cue)) continue;

        // 入射方向
        const ax = gx - cue.x, ay = gy - cue.y;
        const ad = Math.hypot(ax, ay);
        if (ad < R * 0.5) continue;
        const dirx = ax / ad, diry = ay / ad;

        // 角度：入射方向与"球-袋"方向的夹角，越接近 0 越好
        const cosA = dirx * ux + diry * uy;
        if (cosA < 0.10) continue; // 太薄（>84°），放弃
        const cutDeg = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;

        // 目标球到袋口的距离（越近越稳）
        const potDist = dist;

        // 计分：角度优先
        let score = 100 * Math.pow(cosA, 3.2);
        score -= potDist * 14;
        score -= ad * 3.5;
        score -= cutDeg * 0.32;

        // 检查母球撞后是否容易跟着进袋（简化：母球走向与袋口方向）
        const cueAfter = { x: dirx - ux * cosA, y: diry - uy * cosA };

        out.push({
          ball, pocket: p, gx, gy,
          angle: Math.atan2(diry, dirx),
          cutDeg, score, dist: ad, potDist, cueAfter,
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * 决定这一杆
   * @returns {{angle:number, power:number, spin:{x,y}}|null}
   */
  decide() {
    const g = CONFIG.gameplay;
    const cands = this.candidates();
    // 只保留"值得打"的候选：切角过薄或分数太低的球，命中率极低还容易犯规
    const viable = cands.filter(c => c.score > -120 && c.cutDeg < 78);
    if (viable.length > 0) cands.length = 0, cands.push(...viable);

    if (cands.length === 0) {
      // 没有好球：朝最近的合法目标球轻推
      const cue = this.world.cue;
      const pool = this.rules.current.group === GROUP.NONE
        ? this.world.balls.filter(b => b.num > 0 && b.num !== 8 && !b.potted)
        : this.rules.ballsOf(this.rules.current.group);
      const tgt = pool[0] || this.world.balls[8];
      if (!tgt) return null;
      return {
        angle: Math.atan2(tgt.y - cue.y, tgt.x - cue.x),
        power: 0.46, spin: { x: 0, y: 0.10 },
      };
    }

    const best = cands[0];
    const skill = g.aiSkill;

    // 误差：球越远、切角越大，误差越大
    const baseErr = g.aiAimErrorDeg * (1.35 - skill) * 2.2;
    const errScale = 1 + best.dist * 0.55 + best.cutDeg * 0.028;
    const errDeg = baseErr * errScale * (Math.random() * 2 - 1);
    const angle = best.angle + (errDeg * Math.PI) / 180;

    // 力度：按距离估算，留余量
    // 力度必须够：让球能走完 母球→目标球→袋口 的距离，并留 25% 余量
    const need = ((best.dist + best.potDist) / 2.54) * 0.75 + 0.30;
    let power = Math.min(0.94, Math.max(0.40, need));
    power *= 0.94 + Math.random() * 0.16;

    // 杆法：干净球加一点低杆稳住母球
    const spin = { x: (Math.random() - 0.5) * 0.12, y: 0.1 + Math.random() * 0.12 };

    return { angle, power, spin };
  }

  /** 手中球：找一个能打进的最好位置 */
  bestPlacement() {
    const cue = this.world.cue;
    const T = this.world.table;
    const g = CONFIG.gameplay;
    if (this.rules.isBreak) {
      return { x: -T.hx * 0.5, y: (Math.random() - 0.5) * 0.02 };
    }

    const pool = this.rules.current.group === GROUP.NONE
      ? this.world.balls.filter(b => b.num > 0 && b.num !== 8 && !b.potted)
      : this.rules.ballsOf(this.rules.current.group);
    if (pool.length === 0) return { x: -T.hx * 0.5, y: 0 };

    let best = null;
    // 采样网格：以每个目标球为中心，尝试几个落点
    for (const ball of pool.slice(0, 6)) {
      for (let i = 0; i < 40; i++) {
        // 围绕目标球向四周 + 向台中心撒点
        const a = (i / 40) * Math.PI * 2;
        const rad = 0.35 + (i % 5) * 0.14;
        const x = ball.x + Math.cos(a) * rad;
        const y = ball.y + Math.sin(a) * rad;
        if (!this._freeSpot(x, y, cue)) continue;
        const tmp = { x: cue.x, y: cue.y };
        cue.x = x; cue.y = y;
        const cands = this.candidates();
        cue.x = tmp.x; cue.y = tmp.y;
        if (cands.length && (!best || cands[0].score > best.score)) {
          best = { x, y, score: cands[0].score };
        }
      }
    }
    return best || { x: -T.hx * 0.5, y: 0 };
  }
}
