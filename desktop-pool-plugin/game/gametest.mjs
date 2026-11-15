// ============================================================================
//  gametest.mjs — 整局模拟：用 AI 自动对战，验证规则引擎不会卡死/出错
//  跑法：node gametest.mjs [局数]
// ============================================================================

import { World } from './src/physics.js';
import { EightBallRules, GROUP, PHASE } from './src/rules.js';
import { AI } from './src/ai.js';
import { CONFIG } from './src/config.js';

const R = CONFIG.ball.radius;
const GAMES = +(process.argv[2] || 5);
let failures = 0;
const notes = [];

function log(s) { notes.push(s); }

/**
 * 推进物理直到全部静止，并把事件喂给规则引擎。
 * （主循环 main.js 里是同一套接线，这里必须一致，否则规则判定会失真）
 */
function settle(world, rules, maxT = 20) {
  let t = 0;
  const dt = 1 / 120;
  while (t < maxT) {
    const evs = world.update(dt);
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.type === 'ballBall') {
        rules.noteCollision(ev);
      } else if (ev.type === 'cushion' || ev.type === 'jawHit') {
        rules.noteCushion();
      } else if (ev.type === 'pot') {
        rules.notePot(ev.num);
      }
    }
    t += dt;
    if (!world.anyMoving()) break;
  }
  if (world.anyMoving()) {
    for (const b of world.balls) b.stop();
    return { timedOut: true, t };
  }
  return { timedOut: false, t };
}

function playGame(seed) {
  // 简易确定性随机
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const w = new World();
  w.setupRack(rnd);
  const rules = new EightBallRules(w);
  const ais = [new AI(w, rules), new AI(w, rules)];
  const stats = { shots: 0, fouls: 0, pots: 0, turns: 0, maxSettle: 0, timeouts: 0 };

  // 开球：母球摆头线后
  let spot = rules.cueStartSpot();
  if (!rules.canPlaceCue(spot.x, spot.y)) {
    spot = { x: -w.table.hx * 0.52, y: 0 };
    w.cue.setPos(spot.x, spot.y);
  } else {
    rules.confirmBallInHand(spot.x, spot.y);
  }

  let guard = 0;
  const MAX_SHOTS = 400;

  while (rules.winner === null && guard++ < MAX_SHOTS) {
    const turn = rules.turn;
    stats.turns++;

    // 手中球
    if (rules.phase === PHASE.BALL_IN_HAND) {
      const p = ais[turn].bestPlacement();
      if (rules.canPlaceCue(p.x, p.y)) {
        rules.confirmBallInHand(p.x, p.y);
      } else {
        // 兜底：扫描合法点
        let placed = false;
        for (let i = 0; i < 800 && !placed; i++) {
          const x = (rnd() - 0.5) * (w.table.length - R * 4);
          const y = (rnd() - 0.5) * (w.table.width - R * 4);
          if (rules.canPlaceCue(x, y)) { rules.confirmBallInHand(x, y); placed = true; }
        }
        if (!placed) return { stats, error: 'no legal ball-in-hand spot' };
      }
    }

    // 出杆
    const plan = ais[turn].decide();
    if (!plan) return { stats, error: 'AI produced no plan' };

    rules.beginShot();
    w.strike({ x: Math.cos(plan.angle), y: Math.sin(plan.angle) },
      Math.max(0.15, Math.min(1, plan.power)), plan.spin || { x: 0, y: 0 });

    const r = settle(w, rules);
    if (r.timedOut) stats.timeouts++;
    stats.maxSettle = Math.max(stats.maxSettle, r.t);

    const res = rules.resolveShot();
    stats.shots++;
    if (res.foul) stats.fouls++;
    stats.pots += res.potted.length;

    // 母球落袋：必须立刻复位（真实游戏里是"手中球"，AI/玩家都要重新摆）
    if (w.cue.potted && !res.gameOver) {
      w.cue.potted = false;
      w.cue.stop();
      // 找合法落点
      let placed = false;
      const p2 = ais[rules.turn].bestPlacement();
      if (rules.canPlaceCue(p2.x, p2.y)) {
        w.cue.setPos(p2.x, p2.y);
        placed = true;
      }
      for (let i = 0; i < 600 && !placed; i++) {
        const x = (rnd() - 0.5) * (w.table.length - R * 6);
        const y = (rnd() - 0.5) * (w.table.width - R * 6);
        if (rules.canPlaceCue(x, y)) { w.cue.setPos(x, y); placed = true; }
      }
      if (!placed) return { stats, error: 'no spot for cue ball' };
      rules.phase = PHASE.AWAIT_SHOT;
    }

    // 一致性检查
    if (w.cue.potted) {
      // 母球落袋后必须在 BALL_IN_HAND
      if (rules.phase !== PHASE.BALL_IN_HAND && !res.gameOver) {
        return { stats, error: 'cue potted but phase=' + rules.phase };
      }
      w.cue.potted = false;
      w.cue.stop();
    }

    // 分组一致性
    if (rules.players[0].group !== GROUP.NONE &&
      rules.players[0].group === rules.players[1].group) {
      return { stats, error: 'both players same group' };
    }

    // 卡死检测：如果连续 60 杆没人进球，说明球被卡在某处
    if (stats.shots > 60 && stats.pots === 0) {
      return { stats, error: 'no ball potted in 60 shots' };
    }
  }

  if (rules.winner === null) return { stats, error: `no winner after ${guard} shots` };
  return { stats, winner: rules.winner, groups: rules.players.map(p => p.group) };
}

// ---------------------------------------------------------------------------
console.log(`\n=== 整局模拟 ${GAMES} 局 ===\n`);
let totalShots = 0, totalFouls = 0, totalPots = 0, wins = [0, 0], wins0 = 0;

for (let g = 0; g < GAMES; g++) {
  const r = playGame(1234 + g * 977);
  if (r.error) {
    failures++;
    log(`  第 ${g + 1} 局  ✘  ${r.error}  (shots=${r.stats?.shots})`);
  } else {
    totalShots += r.stats.shots;
    totalFouls += r.stats.fouls;
    totalPots += r.stats.pots;
    wins[r.winner]++;
    log(`  第 ${g + 1} 局  ✔  ${r.stats.shots} 杆 / ${r.stats.fouls} 犯规 / ${r.stats.pots} 进球 / 最长静止 ${r.stats.maxSettle.toFixed(1)}s / 胜者 P${r.winner + 1}`);
  }
}

console.log(notes.join('\n'));
if (totalShots > 0) {
  console.log(`\n合计：${totalShots} 杆，犯规率 ${(totalFouls / totalShots * 100).toFixed(1)}%，平均每杆 ${(totalPots / totalShots).toFixed(2)} 球`);
  console.log(`胜负：玩家 ${wins[0]} / AI ${wins[1]}`);
}
console.log(failures === 0 ? '\n✔ 全部通过\n' : `\n✘ ${failures} 局失败\n`);
process.exit(failures === 0 ? 0 : 1);
