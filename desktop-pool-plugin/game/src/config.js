// ============================================================================
//  CONFIG — 所有可调参数集中在这里
//  改手感/物理/相机，只改这个文件；逻辑代码里不应出现魔法数字。
//  物理常量来源：pooltool (ekiefl) 与 tailuge/billiards 的实测参数，
//  两者都基于 Han 2005 / Mathavan 2007 / Stronge 的台球碰撞模型。
// ============================================================================

export const CONFIG = {
  // ------------------------------------------------------------------ 球
  ball: {
    radius: 0.028575,      // 2.25in 直径 → 半径 (m)
    mass: 0.170097,        // 170 g，美式 8 球标准
    margin: 0.0002,        // 球与球之间的微小间隙容差
  },

  // ------------------------------------------------------------------ 台面
  table: {
    // 9ft 台：100in × 50in 比赛区
    length: 2.54,
    width: 1.27,
    railWidth: 0.115,      // 库边（含胶边）宽度，纯视觉+物理边界
    // 袋口
    cornerEndInset: 0.098, // 长库从角袋中心往内让出的长度
    cornerEndInsetShort: 0.098,
    sideHalfGap: 0.076,    // 中袋半宽
    cornerCapture: 0.056,  // 角袋捕获半径（到球心）
    sideCapture: 0.052,    // 中袋捕获半径
    jawRadius: 0.0125,     // 袋角/袋口立柱半径
    // 视觉
    clothThickness: 0.012,
    slateThickness: 0.04,
    bedHeight: 0.75,       // 台面离地高度（只用于构图参考）
  },

  // ------------------------------------------------------------------ 物理
  physics: {
    hz: 240,               // 固定步长频率
    maxSubSteps: 24,       // 单个固定步内最多再拆多少子步
    maxFrameTime: 0.1,     // 单帧最多补多少秒（防死亡螺旋）
    gravity: 9.81,

    // 摩擦系数（pooltool POOL_GENERIC / tailuge 实测）
    uSlide: 0.2,           // 滑动摩擦
    uRoll: 0.0125,         // 滚动摩擦（实测：2m/s → 约 4m 滑行）
    uSpin: 0.055,          // 旋转摩擦（竖直自旋衰减，乘 g/R 使用）
    uBallBall: 0.06,       // 球-球切向摩擦（产生"throw"偏移）
    uCushion: 0.2,         // 库边切向摩擦

    // 恢复系数
    eBallBall: 0.95,
    eCushion: 0.85,

    // 库边鼻线高度（相对球心，单位 R）。0.28R ≈ 真实 63% 球径
    cushionContactZ: 0.30,

    // 静止判定
    sleepLinear: 0.012,
    sleepAngular: 0.45,
    sleepTime: 0.20,

    maxSpeed: 9.2,         // 母球最大初速 (m/s)
    pocketSpeedDecay: 0.55,// 落袋时的速度衰减（视觉用）
  },

  // ------------------------------------------------------------------ 玩法
  gameplay: {
    aiEnabled: true,
    aiSkill: 0.82,         // 0..1，影响瞄准误差与走位水准
    aiAimErrorDeg: 1.05,   // 基础角度误差（度），会按距离与难度缩放
    shotTimeout: 45,       // 超时提示（秒）
    guideLength: 1.35,     // 瞄准辅助线最长长度 (m)
    showGuide: true,
  },

  // ------------------------------------------------------------------ 相机
  camera: {
    fov: 42,
    aimHeight: 0.60,
    aimDistance: 1.15,
    aimPitch: 24,
    topHeight: 3.0,
    lerp: 6.5,             // 相机平滑系数（每秒）
    orbitSpeed: 0.006,
    minPitch: 12,
    maxPitch: 78,
  },

  // ------------------------------------------------------------------ 音频
  audio: {
    enabled: true,
    volume: 0.8,
    ambience: false,
  },

  // ------------------------------------------------------------------ 渲染
  render: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    antialias: true,
  },
};
