/* ==========================================================================
   jokers.js — 小丑牌数据 + 卡面绘制
   所有 effect 都是纯函数：给定上下文返回 { chips, mult, xmult } 或 null
   ========================================================================== */

import * as THREE from 'three';
import { SUITS, isFace, rankValue } from './cards.js';

const JOKER_W = 200;
const JOKER_H = 290;

const val = c => rankValue(c.rank);
const n = (arr, fn) => arr.reduce((s, c) => s + (fn(c) ? 1 : 0), 0);

/* --------------------------------------------------------------------------
   定义
   -------------------------------------------------------------------------- */
export const JOKERS = [
  {
    id: 'joker', name: '小丑', sym: '★', cost: 2, c1: '#ff8a5c', c2: '#c1121f',
    desc: '+4 倍率',
    effect: () => ({ mult: 4 })
  },
  {
    id: 'greedy', name: '贪婪小丑', sym: '♦', cost: 5, c1: '#ffd166', c2: '#e07a00',
    desc: '每张计分的 ♦ +3 倍率',
    effect: c => { const k = n(c.scored, x => x.suit === 'D'); return k ? { mult: 3 * k } : null; }
  },
  {
    id: 'lusty', name: '情欲小丑', sym: '♥', cost: 5, c1: '#ff9fb2', c2: '#9d0208',
    desc: '每张计分的 ♥ +3 倍率',
    effect: c => { const k = n(c.scored, x => x.suit === 'H'); return k ? { mult: 3 * k } : null; }
  },
  {
    id: 'wrathful', name: '暴怒小丑', sym: '♠', cost: 5, c1: '#8ecae6', c2: '#023047',
    desc: '每张计分的 ♠ +3 倍率',
    effect: c => { const k = n(c.scored, x => x.suit === 'S'); return k ? { mult: 3 * k } : null; }
  },
  {
    id: 'glutton', name: '暴食小丑', sym: '♣', cost: 5, c1: '#95d5b2', c2: '#1b4332',
    desc: '每张计分的 ♣ +3 倍率',
    effect: c => { const k = n(c.scored, x => x.suit === 'C'); return k ? { mult: 3 * k } : null; }
  },
  {
    id: 'half', name: '半张小丑', sym: '◐', cost: 5, c1: '#b8c0ff', c2: '#3f37c9',
    desc: '打出 ≤3 张牌时 +20 倍率',
    effect: c => (c.all.length <= 3 ? { mult: 20 } : null)
  },
  {
    id: 'banner', name: '旗帜', sym: '⚑', cost: 5, c1: '#ffb703', c2: '#c05600',
    desc: '每次剩余弃牌 +30 筹码',
    effect: c => (c.state.discardsLeft > 0 ? { chips: 30 * c.state.discardsLeft } : null)
  },
  {
    id: 'abstract', name: '抽象小丑', sym: '✧', cost: 4, c1: '#c77dff', c2: '#5a189a',
    desc: '每个小丑 +3 倍率（含自身）',
    effect: c => ({ mult: 3 * c.state.jokers.length })
  },
  {
    id: 'fibonacci', name: '斐波那契', sym: 'φ', cost: 8, c1: '#ffe066', c2: '#e07a00',
    desc: 'A / 2 / 3 / 5 / 8 每张 +8 倍率',
    effect: c => {
      const k = n(c.scored, x => ['A', '2', '3', '5', '8'].includes(x.rank));
      return k ? { mult: 8 * k } : null;
    }
  },
  {
    id: 'scary', name: '恐怖面孔', sym: '☾', cost: 4, c1: '#b06bff', c2: '#240046',
    desc: 'J / Q / K 每张 +30 筹码',
    effect: c => { const k = n(c.scored, isFace); return k ? { chips: 30 * k } : null; }
  },
  {
    id: 'even', name: '偶数史蒂文', sym: '⚖', cost: 4, c1: '#4cc9f0', c2: '#3a0ca3',
    desc: '偶数点每张 +4 倍率',
    effect: c => { const k = n(c.scored, x => val(x) % 2 === 0 && val(x) <= 10); return k ? { mult: 4 * k } : null; }
  },
  {
    id: 'odd', name: '奇数托德', sym: '⚔', cost: 4, c1: '#f72585', c2: '#7209b7',
    desc: '奇数点每张 +31 筹码',
    effect: c => { const k = n(c.scored, x => val(x) % 2 === 1); return k ? { chips: 31 * k } : null; }
  },
  {
    id: 'scholar', name: '学者', sym: '✜', cost: 4, c1: '#ffd60a', c2: '#003566',
    desc: '每张 A +20 筹码 +4 倍率',
    effect: c => {
      const k = n(c.scored, x => x.rank === 'A');
      return k ? { chips: 20 * k, mult: 4 * k } : null;
    }
  },
  {
    id: 'blackboard', name: '黑板', sym: '▤', cost: 7, c1: '#5c677d', c2: '#0b090a',
    desc: '手牌全是黑色时 ×3 倍率',
    effect: c => (c.remaining.every(x => x.suit === 'S' || x.suit === 'C') ? { xmult: 3 } : null)
  },
  {
    id: 'duo', name: '二重奏', sym: 'Ⅱ', cost: 8, c1: '#ef476f', c2: '#073b4c',
    desc: '牌型含对子时 ×2 倍率',
    effect: c => (['pair', 'twoPair', 'three', 'fullHouse', 'four', 'five', 'flushHouse', 'flushFive'].includes(c.handType) ? { xmult: 2 } : null)
  },
  {
    id: 'icecream', name: '冰淇淋', sym: '❄', cost: 5, c1: '#a2d2ff', c2: '#c9184a',
    desc: '+100 筹码，每打一手 -5',
    effect: c => {
      const lost = 5 * Math.max(0, c.state.handsPlayed - (c.self.boughtAt || 0));
      const chips = Math.max(0, 100 - lost);
      return chips > 0 ? { chips } : null;
    },
    dynamicDesc: (j, state) => {
      const lost = 5 * Math.max(0, state.handsPlayed - (j.boughtAt || 0));
      return `+${Math.max(0, 100 - lost)} 筹码，每打一手 -5`;
    }
  },
  {
    id: 'photo', name: '照片', sym: '▣', cost: 5, c1: '#caf0f8', c2: '#0077b6',
    desc: '第一张计分的人头牌 ×2 倍率',
    effect: c => (c.scored.some(isFace) ? { xmult: 2 } : null)
  },
  {
    id: 'supernova', name: '超新星', sym: '✷', cost: 5, c1: '#ff477e', c2: '#3a0ca3',
    desc: '本局每打过一手 +1 倍率',
    effect: c => ({ mult: c.state.handsPlayed + 1 })
  },
  {
    id: 'bull', name: '公牛', sym: '¥', cost: 6, c1: '#adb5bd', c2: '#212529',
    desc: '每持有 $1 +2 筹码',
    effect: c => (c.state.money > 0 ? { chips: 2 * c.state.money } : null)
  },
  {
    id: 'jolly', name: '快活小丑', sym: '☺', cost: 3, c1: '#ffd6a5', c2: '#e85d04',
    desc: '牌型含对子时 +8 倍率',
    effect: c => (['pair', 'twoPair', 'three', 'fullHouse', 'four', 'five', 'flushHouse', 'flushFive'].includes(c.handType) ? { mult: 8 } : null)
  }
];

export const JOKER_BY_ID = Object.fromEntries(JOKERS.map(j => [j.id, j]));

export function rarityOf(j) {
  if (j.cost >= 7) return '稀有';
  if (j.cost >= 5) return '罕见';
  return '普通';
}

export function descOf(j, state) {
  return j.dynamicDesc ? j.dynamicDesc(j, state) : j.desc;
}

/** 从池子里随机抽 n 个不重复、且未拥有的 */
export function rollJokers(count, owned, rnd = Math.random) {
  const ownedIds = new Set(owned.map(j => j.id));
  const pool = JOKERS.filter(j => !ownedIds.has(j.id));
  const picked = [];
  const copy = pool.slice();
  for (let i = 0; i < count && copy.length; i++) {
    const k = Math.floor(rnd() * copy.length);
    picked.push(copy.splice(k, 1)[0]);
  }
  return picked;
}

/* --------------------------------------------------------------------------
   绘制
   -------------------------------------------------------------------------- */
const texCache = new Map();
const urlCache = new Map();

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawJoker(g, j) {
  const W = JOKER_W, H = JOKER_H;

  // 深色底
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141a33');
  bg.addColorStop(0.55, '#0e1226');
  bg.addColorStop(1, '#080a14');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // 顶部角色光
  const glow = g.createRadialGradient(W * 0.5, H * 0.12, 6, W * 0.5, H * 0.3, H * 0.85);
  glow.addColorStop(0, j.c1);
  glow.addColorStop(0.34, j.c2);
  glow.addColorStop(1, 'rgba(8,10,20,0)');
  g.globalAlpha = 0.62;
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;

  // 暗角
  const vg = g.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.5, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.78)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // 放射刻线
  g.save();
  g.translate(W / 2, H * 0.46);
  g.strokeStyle = 'rgba(255,255,255,0.09)';
  g.lineWidth = 1.1;
  for (let i = 0; i < 24; i++) {
    g.rotate(Math.PI * 2 / 24);
    g.beginPath(); g.moveTo(0, 52); g.lineTo(0, 132); g.stroke();
  }
  g.restore();

  // 主符号
  g.save();
  g.translate(W / 2, H * 0.46);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,214,130,0.75)';
  g.shadowBlur = 14;
  g.fillStyle = '#fbe6ac';
  g.font = '700 132px "Fredoka", "Apple Symbols", "Segoe UI Symbol", "PingFang SC", serif';
  g.fillText(j.sym, 0, 6);
  g.restore();

  // 上下装饰线
  g.fillStyle = 'rgba(243,201,97,0.16)';
  g.fillRect(W * 0.16, H * 0.075, W * 0.68, 1.4);
  g.fillRect(W * 0.16, H * 0.925, W * 0.68, 1.4);
  g.fillStyle = 'rgba(243,201,97,0.6)';
  [[W * 0.5, H * 0.075], [W * 0.5, H * 0.925]].forEach(([x, y]) => {
    g.beginPath();
    g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y);
    g.closePath(); g.fill();
  });

  // 金色边框
  g.strokeStyle = 'rgba(243,201,97,0.72)';
  g.lineWidth = 2.6;
  roundRect(g, 6, 6, W - 12, H - 12, 12);
  g.stroke();
  g.strokeStyle = 'rgba(243,201,97,0.18)';
  g.lineWidth = 1;
  roundRect(g, 12, 12, W - 24, H - 24, 8);
  g.stroke();
}

export function jokerTexture(j) {
  let t = texCache.get(j.id);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = JOKER_W; cv.height = JOKER_H;
  drawJoker(cv.getContext('2d'), j);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(j.id, t);
  return t;
}

export function jokerDataURL(j) {
  let u = urlCache.get(j.id);
  if (u) return u;
  const cv = document.createElement('canvas');
  cv.width = JOKER_W; cv.height = JOKER_H;
  drawJoker(cv.getContext('2d'), j);
  u = cv.toDataURL('image/png');
  urlCache.set(j.id, u);
  return u;
}
