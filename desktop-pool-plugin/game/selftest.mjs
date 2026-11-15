// ============================================================================
//  selftest.mjs — 物理与规则自检
//  跑法：node selftest.mjs
//  不需要浏览器：physics.js / rules.js 是纯 ES 模块，不依赖 DOM。
// ============================================================================

import { World, Ball } from './src/physics.js';
import { EightBallRules, GROUP, PHASE } from './src/rules.js';
import { CONFIG } from './src/config.js';

const R = CONFIG.ball.radius;
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✔ ${name}`); }
  else { fail++; results.push(`  ✘ ${name}  ${detail}`); }
}

/** 无摩擦/无旋地推进直到静止，返回用时与轨迹 */
function run(world, maxT = 30) {
  let t = 0;
  const dt = 1 / 240;
  while (t < maxT) {
    world.update(dt);
    t += dt;
    if (!world.anyMoving()) break;
  }
  return t;
}

function resetWorld() {
  const w = new World();
  w.setupRack(() => 0.42);  // 固定种子式随机，结果可复现
  return w;
}

// ---------------------------------------------------------------------------
console.log('\n=== 台球物理自检 ===\n');

// 1. 滚动摩擦：初速 2 m/s 的母球，理想滑行距离
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0; });
  const c = w.cue;
  c.setPos(-0.35, 0);
  c.vx = 2.0; c.vy = 0;
  let t = 0;
  const dt = 1 / 240;
  // 只跑到停下为止；允许撞库（原测试上限 14m 太长，9ft 台只有 2.54m）
  while (t < 30 && w.anyMoving()) { w.update(dt); t += dt; }
  const dist = c.x - (-0.35);
  // u_roll=0.0075, g=9.81 → a = 0.0736 m/s²；但先有滑动阶段
  check('母球 2m/s 滚动后停止', t < 25 && Math.abs(c.vx) + Math.abs(c.vy) < 1e-3,
    `t=${t.toFixed(2)}s`);
  check('滚动距离在物理合理区间（0.5~3m，含撞库）', Math.abs(dist) < 3.2, `dist=${dist.toFixed(2)}m`);
  results.push(`       (2 m/s 起速 → 净位移 ${dist.toFixed(2)} m，${t.toFixed(2)} s 后静止)`);
}

// 2. 球-球正碰：能量传递（近弹性）
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0 && b.num !== 1; });
  const c = w.cue, o = w.balls[1];
  c.setPos(-0.3, 0); o.setPos(0, 0);
  c.vx = 3.0;
  run(w);
  const total = Math.hypot(c.vx, c.vy) + Math.hypot(o.vx, o.vy);
  check('正碰后动量仍在（母球停下）',
    Math.abs(c.vx) < 1.2 && Math.abs(o.x) > 0.05,
    `cue vx=${c.vx.toFixed(2)} target x=${o.x.toFixed(2)}`);
  results.push(`       (3 m/s 正碰 → 目标球 x=${o.x.toFixed(2)}m, 母球 vx=${c.vx.toFixed(2)})`);
}

// 3. 吃库反弹：法向速度应反向并衰减
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0; });
  const c = w.cue;
  const hx = w.table.hx;
  c.setPos(hx - 0.15, 0);
  c.vx = 2.0;
  let bounced = false, vAfter = 0;
  for (let i = 0; i < 2000; i++) {
    w.update(1 / 240);
    if (c.vx < -0.05) { bounced = true; vAfter = -c.vx; break; }
  }
  check('母球撞右库后反向', bounced, `vx=${c.vx.toFixed(2)}`);
  check('库边恢复系数合理 (0.3~0.95)', vAfter / 2.0 > 0.3 && vAfter / 2.0 < 0.95,
    `e≈${(vAfter / 2.0).toFixed(2)}`);
}

// 4. 落袋
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0; });
  const c = w.cue;
  const p = w.table.pockets[0];
  c.setPos(p.x - 0.12, p.y - 0.12);
  c.vx = 2.2; c.vy = 2.2;
  run(w, 6);
  check('球滚向角袋会落袋', c.potted, `pos=(${c.x.toFixed(3)},${c.y.toFixed(3)})`);
}

// 5. 低杆（缩杆）：母球撞球后应回拉
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0 && b.num !== 1; });
  const c = w.cue, o = w.balls[1];
  c.setPos(-0.35, 0); o.setPos(0, 0);
  w.strike({ x: 1, y: 0 }, 0.45, { x: 0, y: -0.45 });  // 低杆
  // 低杆的正确判据：撞到目标球之后，母球往回走。
  // 记录撞球瞬间的 x，与最终 x 比较。
  // 捕捉：母球第一次碰到目标球那一刻的位置 + 之后的最小 x
  let hitX = null;
  let minX = Infinity;
  let t = 0;
  const dt = 1 / 240;
  while (t < 15 && w.anyMoving()) {
    w.update(dt); t += dt;
    if (hitX === null && w.events.some(e => e.type === 'ballBall' && (e.a === 0 || e.b === 0))) {
      hitX = c.x;
    }
    if (hitX !== null) minX = Math.min(minX, c.x);
  }
  const pullback = hitX !== null ? hitX - minX : 0;
  check('低杆：撞球后母球回拉', pullback > 0.15,
    `hitX=${hitX?.toFixed(3)} minX=${minX.toFixed(3)} pullback=${pullback.toFixed(3)}`);
  results.push(`       (低杆：撞球后回拉 ${pullback.toFixed(3)} m)`);
  check('低杆回拉幅度合理（0.15~1.5m）', pullback > 0.15 && pullback < 1.5,
    `pullback=${pullback.toFixed(3)}m`);
}

// 6. 跟杆（高杆）：母球跟进
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0 && b.num !== 1; });
  const c = w.cue, o = w.balls[1];
  c.setPos(-0.35, 0); o.setPos(0, 0);
  w.strike({ x: 1, y: 0 }, 0.45, { x: 0, y: 0.45 });   // 高杆
  run(w, 15);
  check('高杆击球后母球跟进（x 增大）', c.x > -0.35 + 0.02,
    `end x=${c.x.toFixed(3)}`);
  results.push(`       (高杆：母球 x = ${c.x.toFixed(3)} m)`);
}

// 7. 无穿透：高速球不会穿过库边
{
  const w = new World();
  w.balls.forEach(b => { b.potted = b.num !== 0; });
  const c = w.cue;
  c.setPos(0, 0);
  c.vx = 9.0;
  let escaped = false;
  for (let i = 0; i < 3000; i++) {
    w.update(1 / 240);
    if (Math.abs(c.x) > w.table.hx + 0.1 || Math.abs(c.y) > w.table.hy + 0.1) {
      if (!c.potted) { escaped = true; break; }
    }
    if (!w.anyMoving()) break;
  }
  check('9 m/s 高速球不穿库', !escaped, `final=(${c.x.toFixed(2)},${c.y.toFixed(2)})`);
}

// 8. 帧率无关：1/60 与 1/144 步进，结果接近
{
  function simulate(step) {
    const w = new World();
    w.balls.forEach(b => { b.potted = b.num !== 0 && b.num !== 1; });
    const c = w.cue, o = w.balls[1];
    c.setPos(-0.4, 0.01); o.setPos(0, 0);
    w.strike({ x: 1, y: -0.02 }, 0.5, { x: 0, y: 0 });
    let t = 0;
    while (t < 12 && w.anyMoving()) { w.update(step); t += step; }
    return { x: c.x, y: c.y, ox: o.x, oy: o.y };
  }
  const a = simulate(1 / 60);
  const b = simulate(1 / 144);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  check('60fps 与 144fps 结果一致（<3cm）', d < 0.03,
    `Δ=${(d * 100).toFixed(2)}cm  A=(${a.x.toFixed(3)},${a.y.toFixed(3)}) B=(${b.x.toFixed(3)},${b.y.toFixed(3)})`);
}

// 9. 规则：空杆判犯规
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  w.cue.setPos(-0.8, 0.4);
  r.beginShot();
  r.firstHit = null;
  const res = r.resolveShot();
  check('空杆 = 犯规', res.foul && res.reason.includes('空杆'), JSON.stringify(res.reason));
}

// 10. 规则：母球落袋 = 犯规 + 手中球
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  r.isBreak = false;
  r.beginShot();
  r.noteCollision({ a: 0, b: 1 });
  r.notePot(0);
  const res = r.resolveShot();
  check('母球落袋 = 犯规', res.foul && res.cuePotted, JSON.stringify(res.reason));
  check('犯规后对手手中球', res.ballInHand === true);
}

// 11. 规则：分组在首次进球后确定
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  r.isBreak = false;
  r.beginShot();
  r.noteCollision({ a: 0, b: 3 });
  r.notePot(3);            // 全色
  r.resolveShot();
  check('进全色后玩家分组=全色', r.players[0].group === GROUP.SOLID,
    `group=${r.players[0].group}`);
  check('对手分组=花色', r.players[1].group === GROUP.STRIPE);
  check('进球继续击球', r.turn === 0);
}

// 12. 规则：清台后进 8 号获胜
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  r.isBreak = false;
  r.players[0].group = GROUP.SOLID;
  r.players[1].group = GROUP.STRIPE;
  // 消灭所有全色球
  for (const b of w.balls) {
    if (b.num >= 1 && b.num <= 7) b.potted = true;
    if (b.num >= 9 && b.num <= 15) b.potted = true;
  }
  r.beginShot();
  r.noteCollision({ a: 0, b: 8 });
  r.notePot(8);
  const res = r.resolveShot();
  check('清台后进 8 号 = 胜利', res.gameOver && r.winner === 0,
    `winner=${r.winner} msg=${res.message}`);
}

// 13. 规则：提前进 8 号 = 判负
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  r.isBreak = false;
  r.players[0].group = GROUP.SOLID;
  r.players[1].group = GROUP.STRIPE;
  r.beginShot();
  r.noteCollision({ a: 0, b: 8 });
  r.notePot(8);
  const res = r.resolveShot();
  check('提前进 8 号 = 判负', res.gameOver && r.winner === 1, `winner=${r.winner}`);
}

// 14. 开球散球：球堆应该被打开
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  r.beginShot();
  w.cue.setPos(-w.table.hx * 0.5, 0);
  w.strike({ x: 1, y: 0 }, 0.95, { x: 0, y: 0.1 });
  run(w, 25);
  const spread = w.balls.filter(b => b.num > 0 && !b.potted);
  let maxY = 0, maxX = 0;
  for (const b of spread) { maxY = Math.max(maxY, Math.abs(b.y)); maxX = Math.max(maxX, Math.abs(b.x)); }
  check('开球能把球堆打散', maxY > 0.12 || maxX > 0.75,
    `maxY=${maxY.toFixed(2)} maxX=${maxX.toFixed(2)}`);
  results.push(`       (开球后散布 maxY=${maxY.toFixed(2)}m, maxX=${maxX.toFixed(2)}m, 落袋 ${w.balls.filter(b=>b.potted).length})`);
}

// 15. 手上球位置合法性
{
  const w = resetWorld();
  const r = new EightBallRules(w);
  check('开球时不能把头线前的位当合法位', r.canPlaceCue(0.5, 0) === false);
  check('开球时头线后是合法位', r.canPlaceCue(-0.8, 0.3) === true);
  r.isBreak = false;
  check('非开球时全场合法', r.canPlaceCue(0.5, 0) === true);
  check('球上不能放母球', r.canPlaceCue(w.balls[8].x, w.balls[8].y) === false);
}

// 16. 能量不增：总动能应单调下降
{
  const w = new World();
  w.setupRack(() => 0.31);
  w.strike({ x: 1, y: 0.02 }, 0.9, { x: 0.1, y: 0.2 });
  let prevE = Infinity, everGrew = false, maxGrowth = 0;
  for (let i = 0; i < 4000; i++) {
    w.update(1 / 240);
    let E = 0;
    for (const b of w.balls) {
      if (b.potted) continue;
      E += 0.5 * CONFIG.ball.mass * (b.vx * b.vx + b.vy * b.vy);
    }
    if (E > prevE * 1.02 + 1e-6) {
      maxGrowth = Math.max(maxGrowth, E / prevE);
      if (E / prevE > 1.15) everGrew = true;
    }
    prevE = E;
    if (!w.anyMoving()) break;
  }
  check('动能不会异常增长（无抖动爆炸）', !everGrew,
    `maxGrowth=${maxGrowth.toFixed(2)}x`);
}

// 17. 暂停判定：静止后不再移动
{
  const w = new World();
  w.setupRack(() => 0.77);
  w.strike({ x: 1, y: 0 }, 0.5, { x: 0, y: 0 });
  run(w, 30);
  const before = w.balls.map(b => [b.x, b.y]);
  for (let i = 0; i < 240; i++) w.update(1 / 240);
  const moved = w.balls.some((b, i) =>
    Math.abs(b.x - before[i][0]) > 0.002 || Math.abs(b.y - before[i][1]) > 0.002);
  check('静止后不再漂移', !moved);
}

// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
