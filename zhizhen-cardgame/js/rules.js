/* ==========================================================================
   rules.js — 牌型判定与计分管线（纯逻辑，不含渲染）
   计分顺序：牌型基础 → 每张计分牌的筹码 → 小丑逐个生效（左→右）
   ========================================================================== */

export const HAND_TYPES = {
  high:        { name: '高牌',   chips: 5,   mult: 1 },
  pair:        { name: '一对',   chips: 10,  mult: 2 },
  twoPair:     { name: '两对',   chips: 20,  mult: 2 },
  three:       { name: '三条',   chips: 30,  mult: 3 },
  straight:    { name: '顺子',   chips: 30,  mult: 4 },
  flush:       { name: '同花',   chips: 35,  mult: 4 },
  fullHouse:   { name: '葫芦',   chips: 40,  mult: 4 },
  four:        { name: '四条',   chips: 60,  mult: 7 },
  straightFlush:{ name: '同花顺', chips: 100, mult: 8 },
  five:        { name: '五条',   chips: 120, mult: 12 },
  flushHouse:  { name: '同花葫芦', chips: 140, mult: 14 },
  flushFive:   { name: '同花五条', chips: 160, mult: 16 }
};

// 越大越强，用于"这手牌比上不足"的展示
export const HAND_RANK = {
  high: 0, pair: 1, twoPair: 2, three: 3, straight: 4, flush: 5,
  fullHouse: 6, four: 7, straightFlush: 8, five: 9, flushHouse: 10, flushFive: 11
};

const VAL = r => ({ '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 })[r];

function groupByRank(cards) {
  const m = new Map();
  for (const c of cards) {
    if (!m.has(c.rank)) m.set(c.rank, []);
    m.get(c.rank).push(c);
  }
  const groups = [...m.entries()].map(([rank, arr]) => ({ rank, cards: arr, n: arr.length, v: VAL(rank) }));
  groups.sort((a, b) => (b.n - a.n) || (b.v - a.v));
  return groups;
}

function straightHigh(cards) {
  if (cards.length !== 5) return 0;
  const vals = [...new Set(cards.map(c => VAL(c.rank)))].sort((a, b) => a - b);
  if (vals.length !== 5) return 0;
  if (vals[4] - vals[0] === 4) return vals[4];
  // A-2-3-4-5
  if (vals[0] === 2 && vals[4] === 14) return 5;
  return 0;
}

/**
 * 判定牌型
 * @returns {{key, name, chips, mult, scored: Array}}
 */
export function evaluate(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const groups = groupByRank(cards);
  const flush = n === 5 && cards.every(c => c.suit === cards[0].suit);
  const sHigh = straightHigh(cards);
  const straight = sHigh > 0;

  const allScored = () => cards.slice();
  const pack = (key, scored) => ({
    key, name: HAND_TYPES[key].name, chips: HAND_TYPES[key].chips, mult: HAND_TYPES[key].mult,
    scored: scored || allScored()
  });

  const g0 = groups[0], g1 = groups[1];

  if (g0.n === 5) return pack(flush ? 'flushFive' : 'five');
  if (g0.n === 4) return pack('four', g0.cards);
  if (g0.n === 3 && g1 && g1.n === 2) return pack(flush ? 'flushHouse' : 'fullHouse');
  if (flush && straight) return pack('straightFlush');
  if (flush) return pack('flush');
  if (straight) return pack('straight');
  if (g0.n === 3) return pack('three', g0.cards);
  if (g0.n === 2 && g1 && g1.n === 2) return pack('twoPair', g0.cards.concat(g1.cards));
  if (g0.n === 2) return pack('pair', g0.cards);

  // 高牌
  const best = cards.slice().sort((a, b) => VAL(b.rank) - VAL(a.rank))[0];
  return pack('high', [best]);
}

/**
 * 完整计分管线，返回可逐条播放的事件序列
 */
export function scoreSteps({ hand, cards, remaining, jokers, state }) {
  const steps = [];
  let chips = hand.chips;
  let mult = hand.mult;

  steps.push({ kind: 'hand', label: hand.name, chips, mult });

  // 每张计分牌
  for (const c of hand.scored) {
    if (c.debuffed) {
      steps.push({ kind: 'card', card: c, chips: 0, debuffed: true });
      continue;
    }
    steps.push({ kind: 'card', card: c, chips: c.chips });
    chips += c.chips;
  }

  // 小丑
  const scoredSet = hand.scored;
  for (const j of jokers) {
    if (!j.effect) continue;
    let r = null;
    try {
      r = j.effect({
        chips, mult, scored: scoredSet, all: cards, remaining,
        handType: hand.key, state, self: j
      });
    } catch (e) {
      console.warn('joker effect error', j.id, e);
      continue;
    }
    if (!r) continue;
    const addChips = r.chips || 0;
    const addMult = r.mult || 0;
    const xm = r.xmult || 1;
    if (!addChips && !addMult && xm === 1) continue;

    chips += addChips;
    mult += addMult;
    mult *= xm;

    steps.push({
      kind: 'joker', joker: j, chips: addChips, mult: addMult, xmult: xm,
      chipsAfter: chips, multAfter: mult
    });
  }

  return {
    steps,
    chips: Math.round(chips * 100) / 100,
    mult: Math.round(mult * 100) / 100,
    total: Math.max(0, Math.floor(chips * mult))
  };
}

/** 只算结果不算序列（HUD 预览用） */
export function preview(cards, remaining, jokers, state) {
  const hand = evaluate(cards);
  if (!hand) return null;
  const r = scoreSteps({ hand, cards, remaining, jokers, state });
  return { hand, chips: r.chips, mult: r.mult, total: r.total };
}
