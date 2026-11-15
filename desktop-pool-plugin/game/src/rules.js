// ============================================================================
//  rules.js — 8 球规则引擎
//  ---------------------------------------------------------------------------
//  规则依据：WPA 世界标准 8 球（与 tailuge/billiards 的 eightball.ts 实现一致）
//
//  犯规（母球手中球）：
//    1. 母球落袋（未碰到任何球直接落袋）
//    2. 母球先碰到错误的球（分组前不能先碰 8 号；分组后须先碰本组）
//    3. 母球未碰到任何球（空杆）
//    4. 没有任何球进袋，且碰球之后没有球吃库
//    5. 提前打进 8 号（未清完本组）→ 8 号重摆
//    6. 母球跳出台面
//
//  胜负：
//    · 清完本组后合法打进 8 号 → 胜
//    · 提前打进 8 号 / 打 8 号时同时犯规 → 负
// ============================================================================

export const PHASE = {
  AWAIT_SHOT: 'awaitShot',
  BALL_IN_HAND: 'ballInHand',
  SHOOTING: 'shooting',
  GAME_OVER: 'gameOver',
};

export const GROUP = { NONE: 0, SOLID: 1, STRIPE: 2 };

export class EightBallRules {
  constructor(world) {
    this.world = world;
    this.players = [
      { name: '你', group: GROUP.NONE, score: 0, isAI: false },
      { name: 'AI', group: GROUP.NONE, score: 0, isAI: true },
    ];
    this.turn = 0;              // 当前玩家索引
    this.phase = PHASE.BALL_IN_HAND;
    this.isBreak = true;        // 是否还是开球
    this.breakDone = false;
    this.winner = null;
    this.lastFoul = null;
    /** 中球记录：本杆第一次碰到的球 */
    this.firstHit = null;
    this.pottedThisShot = [];
    this.cushionAfterContact = 0;
    this.shotStarted = false;
    this.messages = [];
  }

  get current() { return this.players[this.turn]; }
  get opponent() { return this.players[1 - this.turn]; }

  reset() {
    this.players[0].group = GROUP.NONE;
    this.players[1].group = GROUP.NONE;
    this.players[0].score = 0;
    this.players[1].score = 0;
    this.turn = 0;
    this.phase = PHASE.BALL_IN_HAND;
    this.isBreak = true;
    this.breakDone = false;
    this.winner = null;
    this.lastFoul = null;
    this.messages = [];
    this.firstHit = null;
    this.pottedThisShot = [];
  }

  // --------------------------------------------------------------- 局面查询
  ballsOf(group) {
    return this.world.balls.filter(b => b.num !== 0 && !b.potted &&
      (group === GROUP.SOLID ? (b.num >= 1 && b.num <= 7) : (b.num >= 9 && b.num <= 15)));
  }

  get eightBall() { return this.world.balls[8]; }

  remainingOf(group) { return this.ballsOf(group).length; }

  /** 当前玩家该打什么 */
  targetGroup() {
    const g = this.current.group;
    if (g === GROUP.NONE) return GROUP.NONE;      // 开放台面：全色随便打
    if (this.remainingOf(g) === 0) return 8;      // 该打 8 号
    return g;
  }

  // --------------------------------------------------------------- 开球前
  beginShot() {
    if (this.phase === PHASE.GAME_OVER) return false;
    this.firstHit = null;
    this.pottedThisShot = [];
    this.cushionAfterContact = 0;
    this.shotStarted = true;
    this.phase = PHASE.SHOOTING;
    return true;
  }

  /** 母球从手中球变成正常状态 */
  confirmBallInHand(x, y) {
    const c = this.world.cue;
    c.potted = false;
    c.setPos(x, y);
    c.stop();
    this.phase = PHASE.AWAIT_SHOT;
  }

  // --------------------------------------------------------------- 判罚
  /**
   * 记录一次球-球碰撞（由物理事件驱动）
   */
  noteCollision(ev) {
    if (!this.shotStarted) return;
    if (ev.a === 0 || ev.b === 0) {
      if (this.firstHit === null) {
        this.firstHit = ev.a === 0 ? ev.b : ev.a;
      }
    }
  }

  noteCushion() {
    if (!this.shotStarted) return;
    if (this.firstHit !== null) this.cushionAfterContact++;
  }

  notePot(num) {
    if (!this.shotStarted) return;
    this.pottedThisShot.push(num);
  }

  /**
   * 一杆结束后结算。返回 { foul, reason, potted, ballInHand, turnChanged, gameOver }
   */
  resolveShot() {
    // 已经结束的比赛不再结算，防止重复计分
    if (this.phase === PHASE.GAME_OVER) {
      return { foul: false, reason: null, potted: [], cuePotted: false,
        eightPotted: false, ballInHand: false, turnChanged: false,
        gameOver: true, message: '比赛已结束', keepTurn: false,
        winner: this.winner };
    }
    this.shotStarted = false;
    const P = CONFIG_GROUPS;
    const pots = this.pottedThisShot.slice();
    const cuePotted = pots.includes(0) || this.world.cue.potted;
    const eightPotted = pots.includes(8);
    const reason = this.foulReason(pots, cuePotted);
    const wasBreak = this.isBreak;

    const result = {
      foul: reason !== null,
      reason,
      potted: pots.filter(n => n !== 0),
      cuePotted,
      eightPotted,
      ballInHand: false,
      turnChanged: false,
      gameOver: false,
      message: '',
      keepTurn: false,
    };

    // ---------------------------------------------------------- 开球特判
    if (wasBreak) {
      this.isBreak = false;
      this.breakDone = true;
      // 开球进袋不犯规（除了母球）；WPA：开球必须碰球堆 + 4 颗球碰库或进球
      if (!result.foul && result.potted.length > 0) {
        result.message = '开球进球！继续';
        result.ballInHand = true;
        result.keepTurn = true;
      } else if (!result.foul) {
        result.message = '开球完成，对方击球';
        result.ballInHand = true;
        result.turnChanged = true;
      } else {
        result.message = `开球犯规：${reason} · 手中球`;
        result.ballInHand = true;
        result.turnChanged = true;
      }
      // 开球分组：只进一种花色时直接定组
      this.assignGroupsOnBreak(result.potted);
      this.applyScore(result);
      this.advanceTurn(result);
      result.winner = this.winner;
      return result;
    }

    // ---------------------------------------------------------- 8 号球
    if (eightPotted) {
      const own = this.current.group;
      // 本组是否已全部清空（8 号球不在本组内）
      const ownCleared = own !== GROUP.NONE && this.ballsOf(own).length === 0;
      // 合法获胜：没有犯规 + 已分花色 + 本组清空
      const legalWin = !result.foul && ownCleared;
      if (legalWin) {
        this.winner = this.turn;
        result.gameOver = true;
        result.message = '打进 8 号球，胜利！';
        this.phase = PHASE.GAME_OVER;
        this.applyScore(result);
        result.winner = this.winner;
      return result;
      }
      // 非法打进 8 号 → 输
      this.winner = 1 - this.turn;
      result.gameOver = true;
      result.foul = true;
      result.reason = result.foul ? `${reason} 且打进 8 号球` : '提前打进 8 号球';
      result.message = `8 号球非法入袋，${this.opponent.name}获胜`;
      this.phase = PHASE.GAME_OVER;
      result.winner = this.winner;
      return result;
    }

    // ---------------------------------------------------------- 犯规
    if (result.foul) {
      result.ballInHand = true;
      result.turnChanged = true;
      result.message = `犯规：${reason} · 对手手中球`;
      this.passTurn(result);
      result.winner = this.winner;
      return result;
    }

    // ---------------------------------------------------------- 分组
    if (wasBreak === false || true) {
      if (this.current.group === GROUP.NONE && result.potted.length > 0) {
        this.assignGroupsAfterPot(result.potted);
      }
    }

    // ---------------------------------------------------------- 进球
    if (result.potted.length > 0) {
      const g = this.current.group;
      const ownPots = g === GROUP.NONE
        ? result.potted
        : result.potted.filter(n => this.isOfGroup(n, g));
      if (ownPots.length > 0) {
        result.keepTurn = true;
        result.message = `${this.current.name} 进球，继续击球`;
        this.applyScore(result);
        this.phase = PHASE.AWAIT_SHOT;
        result.winner = this.winner;
      return result;
      }
      // 只进了对方的球（或开放台面进了混色）→ 换人
      result.message = '进了对方的球，换手';
      result.turnChanged = true;
      this.applyScore(result);
      this.passTurn(result);
      result.winner = this.winner;
      return result;
    }

    // ---------------------------------------------------------- 没进球
    result.message = '未进球，换手';
    result.turnChanged = true;
    this.passTurn(result);
    result.winner = this.winner;
      return result;
  }

  isOfGroup(num, group) {
    if (group === GROUP.SOLID) return num >= 1 && num <= 7;
    if (group === GROUP.STRIPE) return num >= 9 && num <= 15;
    return false;
  }

  foulReason(pots, cuePotted) {
    if (cuePotted) return '母球入袋';
    if (this.firstHit === null) return '空杆，未碰到任何球';

    const target = this.targetGroup();
    const g = this.current.group;

    if (g === GROUP.NONE) {
      if (this.firstHit === 8) return '开放台面先碰 8 号球';
    } else if (target === 8) {
      if (this.firstHit !== 8) return '应先碰 8 号球';
    } else {
      if (!this.isOfGroup(this.firstHit, g)) return '先碰到对方的球';
    }

    // 没进球时必须有球吃库
    if (pots.length === 0 && this.cushionAfterContact === 0) {
      return '碰球后无球吃库';
    }
    return null;
  }

  assignGroupsOnBreak(pots) {
    const solids = pots.filter(n => n >= 1 && n <= 7).length;
    const stripes = pots.filter(n => n >= 9 && n <= 15).length;
    if (solids > 0 && stripes === 0) {
      this.players[this.turn].group = GROUP.SOLID;
      this.players[1 - this.turn].group = GROUP.STRIPE;
    } else if (stripes > 0 && solids === 0) {
      this.players[this.turn].group = GROUP.STRIPE;
      this.players[1 - this.turn].group = GROUP.SOLID;
    }
    // 混合进袋 → 台面保持开放
  }

  assignGroupsAfterPot(pots) {
    const solids = pots.filter(n => n >= 1 && n <= 7).length;
    const stripes = pots.filter(n => n >= 9 && n <= 15).length;
    if (solids > 0 && stripes === 0) {
      this.players[this.turn].group = GROUP.SOLID;
      this.players[1 - this.turn].group = GROUP.STRIPE;
      this.messages.push('花色已确定');
    } else if (stripes > 0 && solids === 0) {
      this.players[this.turn].group = GROUP.STRIPE;
      this.players[1 - this.turn].group = GROUP.SOLID;
      this.messages.push('花色已确定');
    }
  }

  applyScore(result) {
    const mine = result.potted.filter(n => {
      const g = this.current.group;
      return g === GROUP.NONE || this.isOfGroup(n, g);
    }).length;
    this.current.score += mine;
  }

  advanceTurn(result) {
    if (result.ballInHand) this.phase = PHASE.BALL_IN_HAND;
    if (result.turnChanged) {
      this.turn = 1 - this.turn;
      this.lastFoul = result.foul ? result.reason : null;
    } else {
      this.lastFoul = null;
    }
    if (!result.ballInHand && !result.gameOver) this.phase = PHASE.AWAIT_SHOT;
  }

  passTurn(result) {
    this.turn = 1 - this.turn;
    this.lastFoul = result.foul ? result.reason : null;
    if (result.ballInHand) this.phase = PHASE.BALL_IN_HAND;
    else this.phase = PHASE.AWAIT_SHOT;
  }

  /** 母球复位到手牌区（开球前） */
  cueStartSpot() {
    return { x: -this.world.table.hx * 0.5, y: 0 };
  }

  /** 手中球是否允许放在此位置 */
  canPlaceCue(x, y) {
    const T = this.world.table;
    const R = 0.028575;
    if (Math.abs(x) > T.hx - R || Math.abs(y) > T.hy - R) return false;
    // 不能和任何球重叠
    for (const b of this.world.balls) {
      if (b.num === 0 || b.potted) continue;
      if (Math.hypot(b.x - x, b.y - y) < R * 2.05) return false;
    }
    // 不能放在袋口里
    for (const p of T.pockets) {
      if (Math.hypot(p.x - x, p.y - y) < p.r + R) return false;
    }
    // 开球时必须在头线后
    if (this.isBreak && x > -T.hx * 0.5) return false;
    return true;
  }
}

const CONFIG_GROUPS = { SOLID: 1, STRIPE: 2 };
