/* ==========================================================================
   main.js — 游戏流程 / 交互 / 动画编排
   ========================================================================== */

import * as THREE from 'three';
import { Stage } from './table.js';
import { sfx } from './audio.js';
import { makeDeck, shuffle, SUITS } from './cards.js';
import { evaluate, preview, scoreSteps, HAND_RANK, HAND_TYPES } from './rules.js';
import { JOKERS, rollJokers, jokerDataURL, descOf, rarityOf } from './jokers.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 配置（想改难度就改这里） ---------------- */
const CONFIG = {
  maxAnte: 6,
  anteBase: [200, 500, 1200, 2800, 6000, 12000],
  handsPerRound: 4,
  discardsPerRound: 4,
  handSize: 8,
  maxJokers: 5,
  startMoney: 5,
  interestPer: 5,
  interestMax: 5,
  jokerSlots: 3,
  rerollBase: 3,
  anim: {
    dealStagger: 55,
    playFly: 430,
    cardStep: 105,
    jokerStep: 300,
    resolvePause: 420
  }
};

const BLINDS = [
  { key: 'small', name: '小盲注', mult: 1.0, reward: 3 },
  { key: 'big', name: '大盲注', mult: 1.5, reward: 4 },
  { key: 'boss', name: 'BOSS 盲注', mult: 2.0, reward: 5 }
];

const BOSSES = [
  { id: 'hook', name: '钩子', desc: '每打完一手，随机弃掉 2 张手牌' },
  { id: 'wall', name: '高墙', desc: '目标分数额外 ×1.5' },
  { id: 'needle', name: '针', desc: '本关只有 1 次出牌机会' },
  { id: 'water', name: '死水', desc: '本关没有弃牌次数' },
  { id: 'head', name: '头颅', desc: '所有 ♥ 红心牌不产生筹码' },
  { id: 'mouth', name: '嘴', desc: '只能重复使用第一次打出的牌型' }
];

/* ---------------- 状态 ---------------- */
const G = {
  phase: 'boot',
  deck: [], drawPile: [], discardPile: [], hand: [],
  selected: [],
  jokers: [],
  money: CONFIG.startMoney,
  ante: 1,
  blindIdx: 0,
  handsLeft: 4, discardsLeft: 4,
  score: 0, target: 200,
  handsPlayed: 0,
  busy: false,
  boss: null,
  usedTypes: new Set(),
  roundEarn: 0,
  seenHover: 0
};

let stage, hoverCard = null, hoverJoker = null;
let titleViews = [];
let shopOffers = [], shopSold = [], shopRerollCost = 3;

/* ---------------- 初始化 ---------------- */
const canvas = $('stage');
stage = new Stage(canvas);

/* ---------------- HUD ---------------- */
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

function updateHUD() {
  $('anteVal').textContent = G.ante;
  $('moneyVal').textContent = G.money;
  $('handsVal').textContent = G.handsLeft;
  $('discardsVal').textContent = G.discardsLeft;
  $('deckVal').textContent = G.drawPile.length;
  $('jokerVal').textContent = `${G.jokers.length}/${CONFIG.maxJokers}`;
  $('scoreVal').textContent = fmt(G.score);
  $('targetVal').textContent = fmt(G.target);

  const b = BLINDS[G.blindIdx];
  const nm = G.blindIdx === 2 && G.boss ? `BOSS · ${G.boss.name}` : b.name;
  $('blindName').textContent = nm;
  $('blindBadge').classList.toggle('boss', G.blindIdx === 2);

  $('btnPlay').disabled = G.busy || G.phase !== 'play' || G.selected.length === 0;
  $('btnDiscard').disabled = G.busy || G.phase !== 'play' || G.selected.length === 0 || G.discardsLeft <= 0;
}

function setChips(v, kick) {
  const el = $('chipsVal');
  el.textContent = fmt(v);
  if (kick) { const b = $('chipsBox'); b.classList.remove('kick'); void b.offsetWidth; b.classList.add('kick'); }
}
function setMult(v, kick) {
  const el = $('multVal');
  el.textContent = typeof v === 'number' ? fmt(v) : v;
  if (kick) { const b = $('multBox'); b.classList.remove('kick'); void b.offsetWidth; b.classList.add('kick'); }
}
function setTotal(v, kick) {
  $('totalVal').textContent = fmt(v);
  if (kick) { const b = $('totalBox'); b.classList.remove('kick'); void b.offsetWidth; b.classList.add('kick'); }
}

function refreshPreview() {
  const nameEl = $('handName');
  if (!G.selected.length) {
    nameEl.textContent = '选择 1–5 张牌';
    nameEl.classList.add('empty');
    setChips(0); setMult(0); setTotal(0);
    updateHUD();
    return;
  }
  const p = preview(G.selected, G.hand.filter(c => !G.selected.includes(c)),
    G.jokers, { discardsLeft: G.discardsLeft, money: G.money, handsPlayed: G.handsPlayed, jokers: G.jokers });
  if (!p) return;
  nameEl.textContent = p.hand.name;
  nameEl.classList.remove('empty');
  setChips(p.chips); setMult(p.mult); setTotal(p.total);
  updateHUD();
}

function layout() {
  const views = G.hand.map(c => stage.cardView(c));
  const selViews = G.selected.map(c => stage.cardView(c));
  stage.poseHand(views, selViews, hoverCard);
}

function syncJokers() {
  const views = G.jokers.map(j => stage.jokerView(j, j.id));
  stage.poseJokers(views, null);
}

/* ---------------- 弹层 ---------------- */
const overlay = $('overlay');
const overlayBody = $('overlayBody');

function showOverlay(html, soft) {
  overlayBody.innerHTML = html;
  overlay.classList.toggle('soft', !!soft);
  overlay.classList.add('on');
}
function closeOverlay() {
  overlay.classList.remove('on');
  setTimeout(() => { if (!overlay.classList.contains('on')) overlayBody.innerHTML = ''; }, 320);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), 1500);
}

/* ---------------- 开局 ---------------- */
function startRun() {
  $('hud').classList.remove('dim');
  G.deck = shuffle(makeDeck());
  G.drawPile = G.deck.slice();
  G.discardPile = [];
  G.jokers = [];
  G.money = CONFIG.startMoney;
  G.ante = 1;
  G.blindIdx = 0;
  G.handsPlayed = 0;
  G.selected = [];
  G.score = 0;
  G.usedTypes.clear();
  for (const v of stage.jokerViews.values()) v.group.visible = false;
  for (const v of titleViews) stage.hideCard(v);
  titleViews = [];
  stage.titleViews = [];
  startBlind();
}

function currentBlind() { return BLINDS[G.blindIdx]; }

function computeTarget() {
  const base = CONFIG.anteBase[Math.min(G.ante - 1, CONFIG.anteBase.length - 1)];
  let t = base * currentBlind().mult;
  if (G.blindIdx === 2 && G.boss && G.boss.id === 'wall') t *= 1.5;
  return Math.round(t / 10) * 10;
}

function startBlind() {
  G.phase = 'blind';
  G.boss = G.blindIdx === 2 ? BOSSES[(G.ante - 1) % BOSSES.length] : null;

  // 清桌
  for (const c of G.hand) {
    const v = stage.cards.get(c.id);
    if (v) v.group.visible = false;
  }
  G.hand = [];
  G.selected = [];
  G.score = 0;
  G.usedTypes.clear();
  G.handsLeft = CONFIG.handsPerRound;
  G.discardsLeft = CONFIG.discardsPerRound;
  if (G.boss && G.boss.id === 'needle') G.handsLeft = 1;
  if (G.boss && G.boss.id === 'water') G.discardsLeft = 0;

  G.target = computeTarget();

  // 按 Boss 特性涂debuff
  for (const c of G.deck) {
    c.debuffed = !!(G.boss && G.boss.id === 'head' && c.suit === 'H');
    c.inHand = false;
  }

  // 重洗
  G.drawPile = shuffle(G.deck.slice());
  G.discardPile = [];

  updateHUD();
  setChips(0); setMult(0); setTotal(0);
  $('handName').textContent = '选择 1–5 张牌';
  $('handName').classList.add('empty');

  const b = currentBlind();
  const bossBlock = G.boss
    ? `<div class="m-sub" style="color:#ff9aa4;margin-top:18px">BOSS 特性 · ${G.boss.name}<br><b style="color:#ffbcc2">${G.boss.desc}</b></div>`
    : `<div class="m-sub">凑出尽可能强的牌型，达到目标分数即可过关</div>`;

  showOverlay(`
    <div class="modal">
      <div class="m-kicker">底注 ${G.ante} · ${b.name}</div>
      <div class="m-sub" style="margin:0 0 6px;letter-spacing:.3em;font-size:10px;opacity:.55">目标分数</div>
      <div class="m-title" style="font-size:clamp(38px,5.6vw,66px)">${fmt(G.target)}</div>
      <div class="m-stats">
        <div class="m-stat"><span>出牌次数</span><b>${G.handsLeft}</b></div>
        <div class="m-stat"><span>弃牌次数</span><b>${G.discardsLeft}</b></div>
        <div class="m-stat"><span>过关奖励</span><b class="green">$${b.reward}</b></div>
      </div>
      ${bossBlock}
      <div class="m-actions" style="margin-top:26px">
        <button class="btn play" id="mStart" style="min-width:180px">开始<small>SPACE</small></button>
      </div>
    </div>`);

  $('mStart').onclick = () => { sfx.click(); beginPlay(); };
}

function beginPlay() {
  closeOverlay();
  G.phase = 'play';
  G.busy = false;
  syncJokers();
  drawToHand(CONFIG.handSize);
  updateHUD();
}

/* ---------------- 发牌 ---------------- */
function drawToHand(count) {
  const added = [];
  for (let i = 0; i < count; i++) {
    if (G.hand.length >= CONFIG.handSize) break;
    let card = G.drawPile.pop();
    if (!card) {
      if (!G.discardPile.length) break;
      G.drawPile = shuffle(G.discardPile.slice());
      G.discardPile = [];
      card = G.drawPile.pop();
      if (!card) break;
    }
    card.inHand = true;
    G.hand.push(card);
    const v = stage.cardView(card);
    v.snapTo(stage.deckPose());
    v.delay = added.length * (CONFIG.anim.dealStagger / 1000);
    v.kick(2.4);
    added.push(v);
  }
  if (added.length) sfx.deal(added.length);
  layout();
  updateHUD();
}

/* ---------------- 选牌 ---------------- */
function toggleCard(card) {
  const i = G.selected.indexOf(card);
  if (i >= 0) {
    G.selected.splice(i, 1);
    sfx.deselect();
  } else {
    if (G.selected.length >= 5) { toast('最多选择 5 张'); return; }
    G.selected.push(card);
    sfx.select(G.selected.length - 1);
    const v = stage.cardView(card);
    v.punch = 0.16;
    stage.sparkAt(v, {
      count: 16, color: 0xffd166, speed: 1.9, life: 0.45, size: 4.5, gravity: -1.5, spread: 0.3
    });
  }
  refreshPreview();
  layout();
}

function clearSelection() {
  if (!G.selected.length) return;
  G.selected = [];
  sfx.deselect();
  refreshPreview();
  layout();
}

/* ---------------- 出牌 ---------------- */
async function playSelected() {
  if (G.busy || G.phase !== 'play' || !G.selected.length) return;
  G.busy = true;
  updateHUD();

  const played = G.selected.slice();
  const views = played.map(c => stage.cardView(c));
  G.selected = [];
  G.hand = G.hand.filter(c => !played.includes(c));
  hoverCard = null;

  // 飞到出牌区
  stage.posePlay(views, { glow: 0.4 });
  layout();
  sfx.play();
  stage.shake(0.12);
  await sleep(CONFIG.anim.playFly);

  // 判定
  const hand = evaluate(played);
  const remaining = G.hand.slice();

  // Boss：嘴 — 只允许重复第一次的牌型
  let blocked = false;
  if (G.boss && G.boss.id === 'mouth') {
    if (G.usedTypes.size === 0) G.usedTypes.add(hand.key);
    else if (!G.usedTypes.has(hand.key)) blocked = true;
  }

  const state = {
    discardsLeft: G.discardsLeft, money: G.money,
    handsPlayed: G.handsPlayed, jokers: G.jokers
  };
  const res = scoreSteps({ hand, cards: played, remaining, jokers: G.jokers, state });

  // 牌型横幅
  const nameEl = $('handName');
  nameEl.textContent = hand.name;
  nameEl.classList.remove('empty');
  nameEl.classList.add('flash');
  setTimeout(() => nameEl.classList.remove('flash'), 420);
  sfx.handUp(HAND_RANK[hand.key]);
  stage.flash(0.22);

  setChips(hand.chips);
  setMult(hand.mult);
  setTotal(0);

  await sleep(320);

  if (blocked) {
    toast('牌型被封锁：本关只能重复使用「' + (HAND_TYPES[[...G.usedTypes][0]]?.name || '同一种牌型') + '」');
    for (const v of views) { v.shakeT = 0.4; stage.sparkAt(v, { count: 10, color: 0xff5566, speed: 1.3, life: 0.4, size: 4.5, gravity: -2 }); }
    sfx.lose();
    await sleep(700);
    await finishHand(played, views, 0);
    return;
  }

  // 逐张计分
  let chips = hand.chips, mult = hand.mult;
  let jokerIdx = 0;
  for (const step of res.steps) {
    if (step.kind === 'hand') continue;

    if (step.kind === 'card') {
      const v = stage.cardView(step.card);
      if (step.chips > 0) {
        v.punch = 0.2;
        v.glowV.kick(1.6);
        stage.sparkAt(v, {
          count: 18, color: 0x7fd4ff, speed: 2.4, life: 0.55, size: 5, gravity: -4.0, spread: 0.4
        });
        chips += step.chips;
        setChips(chips, true);
        sfx.chip(played.indexOf(step.card));
      } else {
        v.shakeT = 0.35;
        stage.sparkAt(v, { count: 8, color: 0xff5566, speed: 1.1, life: 0.4, size: 4, gravity: -2 });
      }
      await sleep(CONFIG.anim.cardStep);
    } else if (step.kind === 'joker') {
      const v = stage.jokerViews.get(step.joker.id);
      if (v && v.group.visible) {
        v.punch = 0.28;
        v.glowV.kick(2.2);
        v.kick(1.4);
        stage.sparkAt(v, {
          count: 26, color: step.xmult > 1 ? 0xffd166 : (step.chips ? 0x8fe6ff : 0xff8a96),
          speed: 3.0, life: 0.75, size: 6, gravity: -4.5, spread: 0.5
        });
        sfx.joker(jokerIdx);
      }
      chips = step.chipsAfter;
      mult = step.multAfter;
      setChips(chips, true);
      setMult(mult, true);
      if (step.xmult > 1) { stage.flash(0.18); stage.shake(0.16); sfx.multUp(step.xmult * 2); }
      jokerIdx++;
      await sleep(CONFIG.anim.jokerStep);
    }
  }

  // 总分
  const total = res.total;
  setMult(res.mult);
  setTotal(total, true);
  sfx.slam(Math.min(1, total / G.target));
  stage.shake(0.3 + Math.min(0.5, total / (G.target * 2)));
  stage.flash(0.4);

  const scoreEl = $('scoreVal');
  const from = G.score;
  G.score += total;
  rollNumber(scoreEl, from, G.score, total > 0 ? 520 : 260);
  scoreEl.classList.add('pop');
  setTimeout(() => scoreEl.classList.remove('pop'), 200);

  await sleep(CONFIG.anim.resolvePause);
  await finishHand(played, views, total);
}

function rollNumber(el, from, to, dur) {
  const t0 = performance.now();
  if (el._raf) cancelAnimationFrame(el._raf);
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(tick);
    else { el.textContent = fmt(to); el._raf = null; }
  };
  el._raf = requestAnimationFrame(tick);
}

async function finishHand(played, views, total) {
  // 牌散成粒子飞走
  for (const v of views) {
    stage.sparkAt(v, {
      count: 12, color: 0xfff3d0, speed: 2.0, life: 0.5, size: 4.5, gravity: -3, spread: 0.45
    });
    v.setTarget({ sc: 0.3, glow: 0, z: 0.4, y: 0.2 });
    v.sy.kick(3);
  }
  await sleep(240);
  for (const c of played) {
    const v = stage.cardView(c);
    stage.hideCard(v);
    v.snapTo(stage.deckPose());
    c.inHand = false;
    G.discardPile.push(c);
  }

  G.handsLeft--;
  G.handsPlayed++;
  G.roundEarn += total;

  // Boss：钩子
  if (G.boss && G.boss.id === 'hook' && G.hand.length > 0) {
    const kill = [];
    const pool = G.hand.slice();
    for (let i = 0; i < 2 && pool.length; i++) {
      const k = Math.floor(Math.random() * pool.length);
      kill.push(pool.splice(k, 1)[0]);
    }
    for (const c of kill) {
      G.hand = G.hand.filter(x => x !== c);
      const v = stage.cardView(c);
      stage.sparkAt(v, { count: 14, color: 0xff7a86, speed: 1.8, life: 0.5, size: 4.5, gravity: -3 });
      v.setTarget(stage.offscreenPose(1));
      setTimeout(() => { stage.hideCard(v); v.snapTo(stage.deckPose()); }, 360);
      G.discardPile.push(c);
    }
    toast('钩子：随机弃掉 2 张');
    await sleep(300);
  }

  updateHUD();
  layout();

  if (G.score >= G.target) { await sleep(200); roundWin(); return; }
  if (G.handsLeft <= 0) { await sleep(200); roundLose(); return; }

  setChips(0); setMult(0); setTotal(0);
  $('handName').textContent = '选择 1–5 张牌';
  $('handName').classList.add('empty');
  drawToHand(CONFIG.handSize - G.hand.length);
  G.busy = false;
  updateHUD();
}

/* ---------------- 弃牌 ---------------- */
async function discardSelected() {
  if (G.busy || G.phase !== 'play' || G.discardsLeft <= 0 || !G.selected.length) return;
  G.busy = true;
  updateHUD();
  const sel = G.selected.slice();
  G.selected = [];
  hoverCard = null;

  G.discardsLeft--;
  G.hand = G.hand.filter(c => !sel.includes(c));
  sfx.discard();
  stage.shake(0.1);

  sel.forEach((c, i) => {
    const v = stage.cardView(c);
    v.setTarget(stage.offscreenPose(1));
    v.setTarget({ sc: 0.45, glow: 0 });
    v.rz.kick(-6);
    setTimeout(() => { stage.hideCard(v); v.snapTo(stage.deckPose()); }, 330 + i * 25);
    c.inHand = false;
    G.discardPile.push(c);
  });

  layout();
  updateHUD();
  await sleep(300);
  drawToHand(CONFIG.handSize - G.hand.length);
  G.busy = false;
  updateHUD();
}

/* ---------------- 结算 ---------------- */
function confettiBurst() {
  for (let i = 0; i < 7; i++) {
    const col = new THREE.Color().setHSL(i / 7, 0.85, 0.62);
    stage.sparkWorld((Math.random() - 0.5) * 9, 1.4 + Math.random() * 1.6, 1.2, {
      count: 34, color: col, speed: 7, life: 1.7, size: 7, gravity: -8, spread: 0.9, drag: 0.9
    });
  }
}

function roundWin() {
  G.phase = 'settle';
  const b = currentBlind();
  const interest = Math.min(CONFIG.interestMax, Math.floor(G.money / CONFIG.interestPer));
  const handBonus = G.handsLeft;
  const total = b.reward + interest + handBonus;

  sfx.win();
  confettiBurst();
  stage.flash(0.5);
  stage.shake(0.25);

  const last = G.ante >= CONFIG.maxAnte && G.blindIdx === 2;

  showOverlay(`
    <div class="modal">
      <div class="m-kicker">${last ? 'RUN COMPLETE' : 'BLIND CLEARED'}</div>
      <div class="m-title">过关</div>
      <div class="m-stats">
        <div class="m-stat"><span>盲注奖励</span><b class="green">$${b.reward}</b></div>
        <div class="m-stat"><span>利息</span><b class="green">$${interest}</b></div>
        <div class="m-stat"><span>剩余手数</span><b class="green">$${handBonus}</b></div>
        <div class="m-stat"><span>合计</span><b>$${total}</b></div>
      </div>
      <div class="m-sub">得分 ${fmt(G.score)} / 目标 ${fmt(G.target)}</div>
      <div class="m-actions" style="margin-top:26px">
        <button class="btn gold" id="mNext">${last ? '完成整局' : '前往商店'}</button>
      </div>
    </div>`);

  let acc = 0;
  const tickCoins = setInterval(() => {
    if (acc >= total) { clearInterval(tickCoins); return; }
    acc++;
    G.money++;
    $('moneyVal').textContent = G.money;
    sfx.coin();
  }, 90);

  $('mNext').onclick = () => {
    clearInterval(tickCoins);
    G.money += Math.max(0, total - acc);
    sfx.click();
    if (last) { victory(); return; }
    openShop();
  };
}

function roundLose() {
  G.phase = 'over';
  sfx.lose();
  stage.shake(0.6);
  showOverlay(`
    <div class="modal">
      <div class="m-kicker">RUN FAILED</div>
      <div class="m-title danger">没有达到目标</div>
      <div class="m-stats">
        <div class="m-stat"><span>得分</span><b>${fmt(G.score)}</b></div>
        <div class="m-stat"><span>目标</span><b class="blue">${fmt(G.target)}</b></div>
        <div class="m-stat"><span>到达底注</span><b>${G.ante}</b></div>
      </div>
      <div class="m-sub">差 ${fmt(Math.max(0, G.target - G.score))} 分。再来一局？</div>
      <div class="m-actions" style="margin-top:26px">
        <button class="btn play" id="mRetry">再来一局</button>
      </div>
    </div>`);
  $('mRetry').onclick = () => { sfx.click(); closeOverlay(); startRun(); };
}

function victory() {
  G.phase = 'over';
  sfx.win();
  confettiBurst();
  showOverlay(`
    <div class="modal">
      <div class="m-kicker">VICTORY</div>
      <div class="m-title">通关</div>
      <div class="m-sub">你打通了全部 ${CONFIG.maxAnte} 层底注。牌桌记住你了。</div>
      <div class="m-stats">
        <div class="m-stat"><span>最终资金</span><b class="green">$${G.money}</b></div>
        <div class="m-stat"><span>小丑数量</span><b>${G.jokers.length}</b></div>
      </div>
      <div class="m-actions" style="margin-top:26px">
        <button class="btn play" id="mAgain">再来一局</button>
      </div>
    </div>`);
  $('mAgain').onclick = () => { sfx.click(); closeOverlay(); startRun(); };
}

/* ---------------- 商店 ---------------- */
function openShop() {
  G.phase = 'shop';
  shopOffers = rollJokers(CONFIG.jokerSlots, G.jokers);
  shopSold = [];
  shopRerollCost = CONFIG.rerollBase;
  renderShop();
}

function renderShop() {
  const items = shopOffers.map((j, i) => {
    const sold = shopSold.includes(i);
    const cant = G.money < j.cost || G.jokers.length >= CONFIG.maxJokers;
    return `
      <div class="shop-item ${sold ? 'sold' : ''} ${cant ? 'cant' : ''}" data-i="${i}">
        <div class="rare">${rarityOf(j)}</div>
        <img src="${jokerDataURL(j)}" alt="">
        <div class="nm">${j.name}</div>
        <div class="ds">${descOf(j, { handsPlayed: G.handsPlayed })}</div>
        <div class="pr">$${j.cost}</div>
      </div>`;
  }).join('');

  const owned = G.jokers.length
    ? G.jokers.map((j, i) => `
        <div class="shop-item" data-sell="${i}" style="padding:6px">
          <img src="${jokerDataURL(j)}" style="width:52px">
          <div class="nm" style="font-size:11px">${j.name}</div>
          <div class="pr" style="font-size:11px;padding:2px 9px">卖出 +$${Math.max(1, Math.floor(j.cost / 2))}</div>
        </div>`).join('')
    : '<div class="empty-slot" style="min-height:96px">还没有小丑</div>';

  showOverlay(`
    <div class="modal">
      <div class="m-kicker">SHOP · 资金 $${G.money}</div>
      <div class="m-title" style="font-size:clamp(22px,2.6vw,34px)">小丑商店</div>
      <div class="shop-grid">${items}</div>
      <div class="m-rule"></div>
      <div style="font-size:10px;letter-spacing:.3em;color:rgba(247,241,225,.4);margin-bottom:10px">已拥有 · 点击卖出</div>
      <div class="shop-grid" style="grid-template-columns:repeat(${Math.max(3, CONFIG.maxJokers)},1fr)">${owned}</div>
      <div class="m-actions" style="margin-top:22px">
        <button class="btn ghost" id="shopReroll">换一批 $${shopRerollCost}</button>
        <button class="btn gold" id="shopNext">进入下一关<small>下一关</small></button>
      </div>
    </div>`);

  overlayBody.querySelectorAll('[data-i]').forEach(el => {
    el.onclick = () => buyJoker(parseInt(el.dataset.i, 10));
  });
  overlayBody.querySelectorAll('[data-sell]').forEach(el => {
    el.onclick = () => sellJoker(parseInt(el.dataset.sell, 10));
  });
  $('shopReroll').onclick = () => {
    if (G.money < shopRerollCost) { toast('钱不够'); return; }
    G.money -= shopRerollCost;
    shopRerollCost += 1;
    sfx.click();
    shopOffers = rollJokers(CONFIG.jokerSlots, G.jokers);
    shopSold = [];
    updateHUD();
    renderShop();
  };
  $('shopNext').onclick = () => { sfx.click(); closeOverlay(); nextBlind(); };
}

function buyJoker(i) {
  const j = shopOffers[i];
  if (!j || shopSold.includes(i)) return;
  if (G.jokers.length >= CONFIG.maxJokers) { toast('小丑栏位已满'); return; }
  if (G.money < j.cost) { toast('钱不够'); return; }
  G.money -= j.cost;
  const inst = { ...j, boughtAt: G.handsPlayed, effect: j.effect, dynamicDesc: j.dynamicDesc };
  G.jokers.push(inst);
  shopSold.push(i);
  sfx.buy();
  confettiBurst();
  syncJokers();
  updateHUD();
  renderShop();
}

function sellJoker(i) {
  const j = G.jokers[i];
  if (!j) return;
  G.money += Math.max(1, Math.floor(j.cost / 2));
  G.jokers.splice(i, 1);
  const v = stage.jokerViews.get(j.id);
  if (v) {
    stage.sparkAt(v, { count: 22, color: 0xffd166, speed: 2.2, life: 0.6, size: 5, gravity: -4 });
    stage.releaseJoker(j.id);
  }
  sfx.coin();
  syncJokers();
  updateHUD();
  renderShop();
}

function nextBlind() {
  G.blindIdx++;
  if (G.blindIdx > 2) { G.blindIdx = 0; G.ante++; }
  if (G.ante > CONFIG.maxAnte) { victory(); return; }
  startBlind();
}

/* ---------------- 输入 ---------------- */
function ndcFromEvent(e) {
  return {
    x: (e.clientX / window.innerWidth) * 2 - 1,
    y: -(e.clientY / window.innerHeight) * 2 + 1
  };
}

let lastHoverSound = 0;

canvas.addEventListener('pointermove', (e) => {
  const p = ndcFromEvent(e);
  stage.pointer.set(p.x, p.y);

  if (G.phase !== 'play' || G.busy) { hoverCard = null; hoverJoker = null; return; }

  const handViews = G.hand.map(c => stage.cardView(c));
  const hv = stage.pick(p.x, p.y, handViews);
  if (hv !== hoverCard) {
    hoverCard = hv;
    layout();
    if (hv) {
      const now = performance.now();
      if (now - lastHoverSound > 70) { sfx.hover(); lastHoverSound = now; }
    }
  }
  canvas.classList.toggle('pointing', !!hv);

  // 小丑提示
  const jViews = G.jokers.map(j => stage.jokerViews.get(j.id)).filter(Boolean);
  const jv = stage.pick(p.x, p.y, jViews);
  if (jv !== hoverJoker) {
    hoverJoker = jv;
    stage.poseJokers(jViews, jv);
    const tip = $('tip');
    if (jv) {
      const j = jv.joker;
      tip.querySelector('.t-nm').textContent = j.name;
      tip.querySelector('.t-ds').textContent = descOf(j, { handsPlayed: G.handsPlayed });
      tip.querySelector('.t-pr').textContent = `价值 $${j.cost}`;
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
      tip.classList.add('on');
    } else {
      tip.classList.remove('on');
    }
  } else if (jv) {
    const tip = $('tip');
    tip.style.left = e.clientX + 'px';
    tip.style.top = e.clientY + 'px';
  }
});

canvas.addEventListener('pointerleave', () => {
  hoverCard = null;
  hoverJoker = null;
  $('tip').classList.remove('on');
  stage.poseJokers(G.jokers.map(j => stage.jokerViews.get(j.id)).filter(Boolean), null);
  if (G.phase === 'play') layout();
});

canvas.addEventListener('pointerdown', (e) => {
  sfx.init();
  if (G.phase !== 'play' || G.busy) return;
  const p = ndcFromEvent(e);
  const handViews = G.hand.map(c => stage.cardView(c));
  const v = stage.pick(p.x, p.y, handViews);
  if (v && v.card) toggleCard(v.card);
});

$('btnPlay').onclick = () => { sfx.init(); playSelected(); };
$('btnDiscard').onclick = () => { sfx.init(); discardSelected(); };

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    if (overlay.classList.contains('on')) {
      const b = overlayBody.querySelector('.btn');
      if (b) { e.preventDefault(); b.click(); }
      return;
    }
    e.preventDefault();
    playSelected();
  } else if (e.code === 'KeyD') {
    discardSelected();
  } else if (e.code === 'Escape') {
    clearSelection();
  } else if (e.code === 'KeyM') {
    const m = sfx.toggle();
    toast(m ? '静音' : '声音开启');
  } else if (e.code === 'F3') {
    e.preventDefault();
    $('debug').classList.toggle('on');
  }
});

window.addEventListener('resize', () => stage.resize());

/* ---------------- 主循环 ---------------- */
let last = performance.now();
let timeAcc = 0;
let frameSamples = [];
let fpsAcc = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  timeAcc += dt;

  stage.update(dt, timeAcc);
  stage.render();

  // 调试
  fpsAcc += dt;
  frameSamples.push(dt);
  if (frameSamples.length > 120) frameSamples.shift();
  if ($('debug').classList.contains('on') && fpsAcc > 0.25) {
    fpsAcc = 0;
    const sorted = frameSamples.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] * 1000;
    $('debug').textContent =
      `FPS      ${(1 / (frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length)).toFixed(0)}
帧耗时   p95 ${p95.toFixed(1)}ms
阶段     ${G.phase}${G.busy ? ' (busy)' : ''}
手牌     ${G.hand.length} 选 ${G.selected.length}
小丑     ${G.jokers.length}
目标     ${fmt(G.target)} / 得分 ${fmt(G.score)}`;
  }
}

/* ---------------- 开场 ---------------- */
function showTitle() {
  G.phase = 'boot';
  $('hud').classList.add('dim');

  // 桌面上的展示扇形
  const demo = shuffle(makeDeck()).slice(0, 7);
  titleViews = demo.map(c => stage.cardView(c));
  titleViews.forEach((v, i) => {
    v.snapTo({ x: 0, y: -3.2, z: 0, rx: 0, ry: 0, rz: 0, sc: 0.7, glow: 0 });
    v.delay = i * 0.06;
    v.kick(2.2);
  });
  stage.poseTitle(titleViews);
  showOverlay(`
    <div class="modal" style="max-width:640px">
      <div class="m-kicker">POKER ROGUELIKE</div>
      <div class="title-logo">小丑之桌</div>
      <div class="title-logo-en">JESTER'S TABLE</div>
      <div class="m-sub" style="margin-top:22px">
        选牌 → 出牌 → 筹码 × 倍率。<br>
        用 4 次出牌凑够目标分数，靠小丑把倍率叠成雪球。<br>
        6 层底注，每层 3 个盲注。
      </div>
      <div class="m-rule"></div>
      <div class="m-sub" style="font-size:12px;opacity:.7">
        点牌选中 · <b>空格</b> 出牌 · <b>D</b> 弃牌 · <b>Esc</b> 取消 · <b>M</b> 静音
      </div>
      <div class="m-actions" style="margin-top:24px">
        <button class="btn gold" id="mBegin" style="min-width:200px">开始游戏</button>
      </div>
    </div>`, true);
  $('mBegin').onclick = () => {
    sfx.init();
    sfx.click();
    closeOverlay();
    startRun();
  };
}

requestAnimationFrame(loop);
showTitle();

// 调试接口：便于自动化验证，不影响正常玩法
window.__wb = { G, stage, toggleCard, playSelected, discardSelected, startRun, startBlind, beginPlay, sfx, CONFIG, JOKERS, syncJokers, updateHUD, layout, refreshPreview };
