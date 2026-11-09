/* ==========================================================================
   cards.js — 牌面数据 + 程序化贴图（Canvas 绘制，无外部素材）
   ========================================================================== */

import * as THREE from 'three';

export const TEX_W = 320;
export const TEX_H = 464;

export const SUITS = {
  S: { sym: '\u2660', name: '黑桃', ink: '#1b2136', ink2: '#3a4670', red: false },
  H: { sym: '\u2665', name: '红心', ink: '#c01d2f', ink2: '#e8464f', red: true },
  D: { sym: '\u2666', name: '方块', ink: '#c01d2f', ink2: '#e8464f', red: true },
  C: { sym: '\u2663', name: '梅花', ink: '#1b2136', ink2: '#3a4670', red: false }
};

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_KEYS = ['S', 'H', 'D', 'C'];

export function rankValue(r) { return RANKS.indexOf(r) + 2; }
export function isFace(c) { return c.rank === 'J' || c.rank === 'Q' || c.rank === 'K'; }
export function isBlack(c) { return c.suit === 'S' || c.suit === 'C'; }

/** 牌面筹码值：A=11，J/Q/K=10，其余按点数 */
export function cardChips(c) {
  const v = rankValue(c.rank);
  if (v === 14) return 11;
  if (v > 10) return 10;
  return v;
}

export function makeDeck() {
  const deck = [];
  let id = 0;
  for (const s of SUIT_KEYS) {
    for (const r of RANKS) {
      const c = { id: id++, rank: r, suit: s, uid: r + s, chips: 0 };
      c.chips = cardChips(c);
      deck.push(c);
    }
  }
  return deck;
}

export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---------------- 工具 ---------------- */

let ANISO = 4;
export function setAnisotropy(a) { ANISO = a; }

function newCanvas(w = TEX_W, h = TEX_H) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function grain(g, w, h, count, alpha) {
  g.save();
  for (let i = 0; i < count; i++) {
    g.globalAlpha = Math.random() * alpha;
    g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
  g.restore();
}

function toTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  return t;
}

/* ---------------- 牌面 ---------------- */

const faceCache = new Map();

export function getFaceTexture(card) {
  let t = faceCache.get(card.uid);
  if (t) return t;
  const cv = newCanvas();
  drawFace(cv.getContext('2d'), card);
  t = toTex(cv);
  faceCache.set(card.uid, t);
  return t;
}

export function drawFace(g, card) {
  const W = TEX_W, H = TEX_H;
  const s = SUITS[card.suit];

  /* 1. 纸底 */
  const bg = g.createLinearGradient(0, 0, W * 0.7, H);
  bg.addColorStop(0, '#fffdf6');
  bg.addColorStop(0.45, '#f8f2e3');
  bg.addColorStop(1, '#e9dcc0');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  /* 2. 中央柔光 */
  const glow = g.createRadialGradient(W * 0.5, H * 0.46, 6, W * 0.5, H * 0.48, H * 0.62);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)');
  glow.addColorStop(0.55, 'rgba(255,253,245,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  /* 3. 双线内框 */
  g.strokeStyle = 'rgba(170,143,96,0.38)';
  g.lineWidth = W * 0.0095;
  roundRect(g, W * 0.042, W * 0.042, W - W * 0.084, H - W * 0.084, W * 0.05);
  g.stroke();
  g.strokeStyle = 'rgba(170,143,96,0.13)';
  g.lineWidth = W * 0.0035;
  roundRect(g, W * 0.072, W * 0.072, W - W * 0.144, H - W * 0.144, W * 0.038);
  g.stroke();

  /* 4. 中央花色（带柔光盘衬底） */
  const cx = W * 0.5, cy = H * 0.515;
  const discR = W * 0.345;
  const disc = g.createRadialGradient(cx, cy - discR * 0.18, discR * 0.1, cx, cy, discR);
  disc.addColorStop(0, 'rgba(255,255,255,0.92)');
  disc.addColorStop(0.62, 'rgba(255,250,235,0.28)');
  disc.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = disc;
  g.beginPath(); g.arc(cx, cy, discR, 0, Math.PI * 2); g.fill();

  g.save();
  g.translate(cx, cy);
  g.fillStyle = s.ink;
  g.shadowColor = 'rgba(40,26,8,0.30)';
  g.shadowBlur = W * 0.03;
  g.shadowOffsetY = W * 0.012;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(W * 0.70)}px "Helvetica Neue", "Arial Unicode MS", Arial, sans-serif`;
  g.fillText(s.sym, 0, W * 0.012);
  g.restore();

  /* 5. 角标 */
  const ix = W * 0.108, iy = H * 0.055;
  const isTen = card.rank === '10';

  const corner = (flip) => {
    g.save();
    if (flip) { g.translate(W - ix, H - iy); g.rotate(Math.PI); }
    else g.translate(ix, iy);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = s.ink;
    g.shadowColor = 'rgba(255,255,255,0.75)';
    g.shadowBlur = W * 0.008;
    g.shadowOffsetY = W * 0.004;
    g.font = `800 ${Math.round(H * (isTen ? 0.148 : 0.166))}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(card.rank, 0, 0);
    g.font = `${Math.round(H * 0.115)}px "Helvetica Neue", "Arial Unicode MS", Arial, sans-serif`;
    g.fillText(s.sym, 0, H * (isTen ? 0.150 : 0.168));
    g.restore();
  };
  corner(false);
  corner(true);

  /* 6. 印刷光泽 */
  const sheen = g.createLinearGradient(0, 0, W, H * 0.75);
  sheen.addColorStop(0, 'rgba(255,255,255,0.26)');
  sheen.addColorStop(0.32, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.66, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);

  grain(g, W, H, 1100, 0.05);
}

/* ---------------- 牌背 ---------------- */

let backTex = null;

export function getBackTexture() {
  if (backTex) return backTex;
  const W = TEX_W, H = TEX_H;
  const cv = newCanvas();
  const g = cv.getContext('2d');

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#243167');
  bg.addColorStop(0.45, '#151d42');
  bg.addColorStop(1, '#080c1e');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // 放射细纹
  g.save();
  g.translate(W / 2, H / 2);
  g.strokeStyle = 'rgba(243,201,97,0.11)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 36; i++) {
    g.rotate(Math.PI * 2 / 36);
    g.beginPath(); g.moveTo(0, 44); g.lineTo(0, H * 0.8); g.stroke();
  }
  g.restore();

  // 同心菱形
  g.save();
  g.translate(W / 2, H / 2);
  for (let i = 5; i >= 1; i--) {
    const r = i * 29;
    g.beginPath();
    g.moveTo(0, -r * 1.34); g.lineTo(r, 0); g.lineTo(0, r * 1.34); g.lineTo(-r, 0);
    g.closePath();
    g.strokeStyle = i % 2 ? 'rgba(243,201,97,0.32)' : 'rgba(243,201,97,0.15)';
    g.lineWidth = i === 1 ? 2.4 : 1.2;
    g.stroke();
  }
  // 中心星
  g.fillStyle = 'rgba(248,213,120,0.95)';
  g.shadowColor = 'rgba(255,210,110,0.8)';
  g.shadowBlur = 16;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? 12 : 33;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  g.restore();

  // 金色边框
  g.strokeStyle = 'rgba(243,201,97,0.66)';
  g.lineWidth = 3.2;
  roundRect(g, 13, 13, W - 26, H - 26, 13);
  g.stroke();
  g.strokeStyle = 'rgba(243,201,97,0.24)';
  g.lineWidth = 1.2;
  roundRect(g, 22, 22, W - 44, H - 44, 9);
  g.stroke();

  // 角花
  g.fillStyle = 'rgba(243,201,97,0.6)';
  [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]].forEach(([x, y]) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const r = i % 2 ? 3.2 : 10;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  });

  grain(g, W, H, 800, 0.055);
  backTex = toTex(cv);
  return backTex;
}
