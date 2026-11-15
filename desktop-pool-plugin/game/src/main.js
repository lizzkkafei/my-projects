// ============================================================================
//  main.js — 主循环与状态机
//  ---------------------------------------------------------------------------
//  状态：
//    ready    → 可以瞄准（玩家）
//    aiming   → 鼠标在瞄准，空格蓄力
//    shooting → 球在滚，等全部停下
//    placing  → 手中球，点击摆放
//    ai       → 对手思考
//    over     → 结束
// ============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';
import { World } from './physics.js';
import { EightBallRules, PHASE, GROUP } from './rules.js';
import { AimSystem } from './aim.js';
import { AI } from './ai.js';
import { createAudio } from './audio.js';
import * as TX from './textures.js';
import { Confetti } from './confetti.js';
import {
  buildTable, buildLights, buildRoom, createBallMesh, buildCue, toWorld, R,
} from './scene.js';

// 告诉 index.html：脚本已经跑起来了（!= 初始化完成，纹理生成可能还要几秒）
if (typeof window !== 'undefined' && window.__BUNDLE_RAN) {
  window.__BUNDLE_RAN();
} else if (typeof window !== 'undefined') {
  window.__RAN = true;
}

// ---------------------------------------------------------------------------
// 全局
// ---------------------------------------------------------------------------
const app = {
  state: 'ready',
  spinUI: { x: 0, y: 0 },
  charging: false,
  chargeT: 0,
  chargeDir: 1,
  message: null,
  messageT: 0,
  camMode: 'aim',       // aim | top
  camYaw: 0,
  camPitch: 22,
  showGuides: true,
  shotCount: 0,
  results: null,
  settleT: 0,
  shotElapsed: 0,
};

let renderer, scene, camera, world, rules, aim, ai, audio;
let canvasEl = null;   // 由 init() 赋值，resize() 需要它来读容器尺寸
let ballMeshes = [];
let cueMesh;
let blobShadows = [];
let envRT;
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
async function init() {
  const canvas = document.getElementById('c');
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: CONFIG.render.antialias,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, CONFIG.render.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.38;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);
  scene.fog = new THREE.Fog(0x07090c, 6, 16);

  camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.02, 60);

  // 环境贴图：用 RoomEnvironment 生成一次，让 PBR 材质有反射
  const pmrem = new THREE.PMREMGenerator(renderer);
  envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.22;

  // ---- 纹理
  const TEX = {
    clothColor: TX.clothColorMap(1024, 512, [24, 96, 64]),
    clothNormal: TX.clothNormalMap(),
    clothRough: TX.clothRoughnessMap(),
    wood: TX.woodTexture(1024, '#7d4526', 1.0),
    cueWood: TX.woodTexture(512, '#8a5a2b', 2.4),
    floor: TX.floorTexture(),
    glow: TX.glowTexture(),
    blob: TX.blobShadowTexture(),
    balls: {},
  };
  TEX.wood.repeat.set(2, 1);
  TEX.cueWood.repeat.set(1, 1);
  for (let i = 0; i <= 15; i++) TEX.balls[i] = TX.ballTexture(i);

  // ---- 世界
  world = new World();
  world.setupRack();
  rules = new EightBallRules(world);
  aim = new AimSystem(scene, world);
  ai = new AI(world, rules);

  // ---- 场景
  buildRoom(scene, TEX);
  app.table = buildTable(scene, TEX);
  app.lampGroup = buildLights(scene, TEX).group;
  // ---- 球
  for (let i = 0; i <= 15; i++) {
    const mesh = createBallMesh(i, TEX);
    ballMeshes[i] = mesh;
    scene.add(mesh);
    // 软阴影贴片
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 3.6, R * 3.6),
      new THREE.MeshBasicMaterial({
        map: TEX.blob, transparent: true, opacity: 0.55,
        depthWrite: false,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.0012;
    blob.renderOrder = 2;
    blobShadows[i] = blob;
    scene.add(blob);
  }

  // ---- 球杆
  cueMesh = buildCue(TEX);
  scene.add(cueMesh);

  // ---- 音频
  audio = createAudio();
  if (CONFIG.audio.enabled) audio.setVolume(CONFIG.audio.volume);

  // ---- UI 绑定
  setupUI();
  resize();
  addEventListener('resize', resize);

  // 相机初始
  updateCamera(0, true);

  app.state = 'ready';
  rules.phase = PHASE.BALL_IN_HAND;
  rules.isBreak = true;
  toast('开球：拖动鼠标瞄准，按住空格蓄力，松开击球', 4200);

  // 让玩家先摆母球
  enterPlacing(true);

  requestAnimationFrame(loop);

  // 启动成功：通知页面守卫并移除加载动画。
  // 注意：这里必须 try/catch —— 如果 setUpUI 之类抛错，至少要把原因显示出来，
  // 而不是留给用户一个转圈的加载画面。
  try {
    if (window.__BOOT_OK) window.__BOOT_OK();
    if (window.__HIDE_LOADING) window.__HIDE_LOADING();
    else console.warn('[boot] __HIDE_LOADING 不存在');
  } catch (e) {
    console.error('[boot] 启动通知失败', e);
  }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
let frameMs = 0, fpsAcc = 0, fpsCount = 0, fps = 0;

function loop() {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  let dt = clock.getDelta();
  if (dt > 0.25) dt = 0.25;

  // ---- 物理
  const evs = world.update(dt);
  if (evs.length) consumeEvents(evs);

  // ---- 状态推进
  if (app.state === 'shooting') {
    // 球全部停下后再等 0.4s（让最后几声碰撞音效放完）才结算
    if (!world.anyMoving()) {
      app.settleT += dt;
      if (app.settleT > 0.40) {
        app.settleT = 0;
        endShot();
      }
    } else {
      app.settleT = 0;
    }
    // 保险：万一某个球卡在阈值边缘，8 秒后强制结算
    app.shotElapsed += dt;
    if (app.shotElapsed > 12 && app.state === 'shooting') {
      app.shotElapsed = 0;
      for (const b of world.balls) b.stop();
      endShot();
    }
  }

  // ---- 蓄力
  if (app.charging) {
    app.chargeT += dt * 1.45 * app.chargeDir;
    if (app.chargeT >= 1) { app.chargeT = 1; app.chargeDir = -1; }
    if (app.chargeT <= 0.06) { app.chargeT = 0.06; app.chargeDir = 1; }
    aim.power = app.chargeT;
    updatePowerUI();
  }

  // ---- 相机
  updateCamera(dt);

  // ---- 渲染同步
  syncMeshes(dt);
  updateCueMesh();
  if (app.showGuides && (app.state === 'ready' || app.state === 'aiming') && rules.phase !== PHASE.GAME_OVER) {
    aim.setVisible(true);
    aim.refresh();
  } else {
    aim.setVisible(false);
  }

  renderer.render(scene, camera);

  frameMs = performance.now() - t0;
  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) { fps = Math.round(fpsCount / fpsAcc); fpsAcc = 0; fpsCount = 0; }

  updateHUD();
}

// ---------------------------------------------------------------------------
// 事件 → 音效 + 规则
// ---------------------------------------------------------------------------
function consumeEvents(evs) {
  for (const ev of evs) {
    const c = world.cue;
    let pan = 0;
    if (ev.x !== undefined) pan = Math.max(-1, Math.min(1, ev.x / (world.table.hx * 1.1)));

    switch (ev.type) {
      case 'ballBall':
        audio.ballBall({ speed: ev.speed, pan });
        break;
      case 'cushion':
        audio.ballCushion({ speed: ev.speed, pan });
        rules.noteCushion();
        break;
      case 'jawHit':
        audio.railHit({ pan });
        rules.noteCushion();
        break;
      case 'pot':
        if (ev.speed > 0.35) audio.pocket({ speed: ev.speed, pan });
        else audio.pocketSoft({ pan });
        rules.notePot(ev.num);
        break;
      case 'cueStrike':
        audio.cueStrike({ power: ev.power, pan });
        break;
      default:
        break;
    }
    // 记录首次碰球
    if (ev.type === 'ballBall') rules.noteCollision(ev);
  }
}

// ---------------------------------------------------------------------------
// 出杆
// ---------------------------------------------------------------------------
function fire() {
  // 'ai' 也是合法出杆状态（AI 回合）
  if (app.state !== 'ready' && app.state !== 'aiming' && app.state !== 'ai') return;
  if (rules.phase === PHASE.BALL_IN_HAND) return;
  const c = world.cue;
  if (c.potted) return;

  const dir = { x: Math.cos(aim.angle), y: Math.sin(aim.angle) };
  rules.beginShot();
  const ok = world.strike(dir, Math.max(0.08, aim.power), aim.spin);
  if (!ok) return;

  app.state = 'shooting';
  app.settleT = 0;
  app.shotElapsed = 0;
  app.shotCount++;
  app.charging = false;
  app.chargeT = 0;
  aim.setVisible(false);
  audio?.unlock();
  // 出杆镜头轻微抖动
  kickCamera(0.18 + aim.power * 0.22);
  updatePowerUI();
}

function endShot() {
  // 把落袋的球移出场景
  const res = rules.resolveShot();
  app.results = res;

  if (res.gameOver) {
    app.state = 'over';
    if (res.winner === 0) {
      audio?.win();
      showEnd(true, res.message);
    } else {
      audio?.lose();
      showEnd(false, res.message);
    }
    return;
  }

  if (res.foul) {
    audio?.foul();
    toast(`犯规：${res.reason}`, 2600, 'foul');
  } else if (res.potted.length > 0) {
    audio?.pot();
    toast(res.message, 1800, 'good');
  } else {
    toast(res.message, 1400);
  }

  refreshScoreboard();

  // 母球落袋 → 手中球
  if (res.ballInHand || world.cue.potted) {
    world.cue.potted = false;
    world.cue.stop();
    if (rules.turn === 0) {
      enterPlacing(false);
      return;
    }
    // AI 手中球：自动摆位后直接开打
    const spot = ai.bestPlacement();
    if (rules.canPlaceCue(spot.x, spot.y)) {
      rules.confirmBallInHand(spot.x, spot.y);
    } else {
      const s0 = rules.cueStartSpot();
      rules.confirmBallInHand(s0.x, s0.y);
    }
    app.state = 'ai';
    scheduleAI(900);
    return;
  }

  if (rules.turn === 0) {
    app.state = 'ready';
    aim.refresh();
  } else {
    app.state = 'ai';
    scheduleAI(750);
  }
}

function scheduleAI(delay) {
  clearTimeout(app.aiTimer);
  app.aiTimer = setTimeout(runAI, delay);
}

function runAI() {
  if (rules.turn !== 1 || app.state === 'over') return;
  if (rules.phase === PHASE.BALL_IN_HAND) {
    const spot = ai.bestPlacement();
    rules.confirmBallInHand(spot.x, spot.y);
  }
  const plan = ai.decide();
  if (!plan) { endShot(); return; }
  aim.angle = plan.angle;
  aim.power = plan.power;
  aim.spin = plan.spin;
  aim.refresh();
  aim.setVisible(true);
  // 假装思考一下再出杆
  setTimeout(() => {
    if (rules.turn !== 1) return;
    fire();
  }, 420 + Math.random() * 380);
}

// ---------------------------------------------------------------------------
// 手中球摆放
// ---------------------------------------------------------------------------
function enterPlacing(isBreak) {
  app.state = 'placing';
  rules.phase = PHASE.BALL_IN_HAND;
  // 犯规给的是"全场手中球"，只有开球才限制在头线后
  rules.isBreak = !!isBreak;
  world.cue.potted = false;
  app.placingBreak = isBreak;
  const s = rules.cueStartSpot();
  // 找一个合法初始位
  let px = s.x, py = s.y;
  if (!rules.canPlaceCue(px, py)) {
    for (let i = 0; i < 200; i++) {
      const x = -world.table.hx / 2 + Math.random() * (world.table.hx / 2 - R * 2);
      const y = (Math.random() - 0.5) * (world.table.width - R * 3);
      if (rules.canPlaceCue(x, y)) { px = x; py = y; break; }
    }
  }
  world.cue.setPos(px, py);
  document.getElementById('placeHint').classList.add('show');
  aim.setVisible(false);
  app.state = 'placing';
}

function tryPlaceAt(physX, physY) {
  if (rules.canPlaceCue(physX, physY)) {
    world.cue.setPos(physX, physY);
    rules.confirmBallInHand(physX, physY);
    document.getElementById('placeHint').classList.remove('show');
    app.state = rules.turn === 0 ? 'ready' : 'ai';
    audio?.uiClick();
    if (rules.turn === 1) scheduleAI(600);
    refreshScoreboard();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 相机
// ---------------------------------------------------------------------------
const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const camKick = { t: 0, amp: 0 };

function kickCamera(amp) { camKick.amp = Math.max(camKick.amp, amp); camKick.t = 0; }

function updateCamera(dt, instant = false) {
  const c = world ? world.cue : { x: 0, y: 0 };
  const cam = CONFIG.camera;

  if (app.camMode === 'manual') { return; }  // 测试用：锁住相机

  if (app.camMode === 'top') {
    camTarget.pos.set(0, 3.30, 0.0);
    camTarget.look.set(0, 0, -0.0001);
    camera.up.set(0, 0, -1);
  } else {
    camera.up.set(0, 1, 0);
    // 瞄准视角：站在母球后面，沿瞄准方向看
    if (app.state === 'placing') {
      // 摆放阶段：从开球线后方高处俯看整个头线区（要能一眼看到"可以摆哪"）
      // 开球时母球只能摆在开球线之后（台面后半段），
      // 相机要正对那一块俯视，否则玩家看得到的地方都不能点 —— 这是黑屏之外最坑的点。
      // 开球时母球只能摆在开球线（x = -hx/2）之后。
      // 机位放在台尾外上方，视线斜向下扫过整个可摆放区。
      // 可摆放区 = x∈[-hx, -hx/2]、y∈[-hy, hy]（0.635 × 1.27 m）。
      // 相机要正对这块，并让它尽量占满画面，否则玩家"看得到的地方都不能点"。
      camTarget.pos.set(-world.table.hx * 0.78, 1.62, 0.0);
      camTarget.look.set(-world.table.hx * 0.78, 0.0, 0);
    } else if (app.state === 'shooting' || app.state === 'ai') {
      // 击球观察：切到宽景（像电视转播），跟着球群中心
      const focus = shotFocus();
      // 固定侧后方俯视机位：不旋转，只平移，避免绕晕
      camTarget.pos.set(focus.x * 0.6, 2.28, 0.86);
      camTarget.look.set(focus.x * 0.75, 0, -(focus.y * 0.55));
    } else {
      // 瞄准视角：站在母球后方，沿瞄准方向看，并夹在台面上方
      const ang = aim.angle;
      const pitch = THREE.MathUtils.degToRad(app.camPitch);
      // 宽高比自适应：窗口越窄，相机越要后退，否则两侧看不到
      const aspectAdj = Math.max(0.85, Math.min(1.65, 1.62 / (innerWidth / innerHeight || 1.7)));
      const back = Math.cos(pitch) * CONFIG.camera.aimDistance * aspectAdj;
      let px = c.x - Math.cos(ang) * back;
      let pz = -(c.y - Math.sin(ang) * back);
      const limX = world.table.hx + 0.30;
      const limZ = world.table.hy + 0.36;
      px = Math.max(-limX, Math.min(limX, px));
      pz = Math.max(-limZ, Math.min(limZ, pz));
      const h = 0.50 + Math.sin(pitch) * 0.40;
      camTarget.pos.set(px, h, pz);
      camTarget.look.set(
        c.x + Math.cos(ang) * 0.52,
        -0.06,
        -(c.y + Math.sin(ang) * 0.52)
      );
    }
  }

  /** 观察阶段的取景中心：母球与球群中心的中点 */
  function shotFocus() {
    const c = world.cue;
    let tx = 0, ty = 0, n = 0;
    for (const b of world.balls) {
      if (b.num === 0 || b.potted) continue;
      tx += b.x; ty += b.y; n++;
    }
    if (n === 0) return { x: 0, y: 0 };
    tx /= n; ty /= n;
    const mx = tx * 0.42 + c.x * 0.58;
    const my = ty * 0.42 + c.y * 0.58;
    return {
      x: Math.max(-world.table.hx * 0.72, Math.min(world.table.hx * 0.72, mx)),
      y: Math.max(-world.table.hy * 0.62, Math.min(world.table.hy * 0.62, my)),
    };
  }

  // 击球震动
  if (camKick.amp > 0.001) {
    camKick.t += dt;
    const decay = Math.exp(-camKick.t * 9);
    const s = camKick.amp * decay;
    camTarget.pos.x += Math.sin(camKick.t * 90) * s * 0.02;
    camTarget.pos.y += Math.sin(camKick.t * 70 + 1) * s * 0.015;
    if (decay < 0.02) camKick.amp = 0;
  }

  // 俯视时把吊灯藏起来（否则会挡住镜头）
  if (app.lampGroup) app.lampGroup.visible = app.camMode !== 'top';

  const k = instant ? 1 : 1 - Math.exp(-cam.lerp * dt);
  camera.position.lerp(camTarget.pos, k);
  app._look = app._look || new THREE.Vector3().copy(camTarget.look);
  app._look.lerp(camTarget.look, k);
  camera.lookAt(app._look);
}

// ---------------------------------------------------------------------------
// 渲染同步：把物理状态搬到 mesh
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

function syncMeshes(dt) {
  const Rv = R;
  for (let i = 0; i <= 15; i++) {
    const b = world.balls[i];
    const mesh = ballMeshes[i];
    const blob = blobShadows[i];

    if (b.potted) {
      mesh.visible = false;
      blob.visible = false;
      continue;
    }
    mesh.visible = true;
    blob.visible = true;
    mesh.position.set(b.x, Rv, -b.y);
    blob.position.set(b.x, 0.0012, -b.y);

    // 滚动旋转：ω 与位移的关系
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 1e-4) {
      // 转轴 = 上方向 × 速度方向
      const ax = -b.vy / sp, ay = 0, az = -b.vx / sp;
      _axis.set(ax, ay, az).normalize();
      const ang = (sp / Rv) * dt;
      _q.setFromAxisAngle(_axis, ang);
      mesh.quaternion.premultiply(_q);
      // 竖直自旋（塞）
      if (Math.abs(b.wz) > 1e-3) {
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.wz * dt * 0.35);
        mesh.quaternion.premultiply(_q);
      }
    } else if (Math.abs(b.wz) > 1e-3) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.wz * dt);
      mesh.quaternion.premultiply(_q);
    }
    blob.material.opacity = 0.5;
  }
}

// ---------------------------------------------------------------------------
// 球杆
// ---------------------------------------------------------------------------
function updateCueMesh() {
  const show = (app.state === 'ready' || app.state === 'aiming') && !world.cue.potted;
  cueMesh.visible = show;
  if (!show) return;
  const c = world.cue;
  const ang = aim.angle;
  // 母球后方
  const back = 0.032 + (app.charging ? app.chargeT * 0.20 : 0.0);
  const x = c.x - Math.cos(ang) * back;
  const y = c.y - Math.sin(ang) * back;

  // 抬高：力度越大杆尾越高（拟真）
  const lift = 0.006 + (app.charging ? app.chargeT * 0.012 : 0);

  cueMesh.position.set(x, R + lift, -y);
  // 球杆几何沿本地 +x 从杆头延伸到杆尾。
  // 绕 Y 轴转 θ 后，本地 +x 变为世界 (cosθ, 0, -sinθ)。
  // 瞄准方向 d = (cos a, 0, -sin a)，杆尾应指向 -d，因此：
  //     cosθ = -cos a ,  -sinθ = sin a   →   θ = a + π
  // 之前写成 "-a + π"：在 a=0 或 π 时恰好等价，其它角度会镜像，
  // 于是杆子会横在球侧边（就是截图里"杆明显不对"的原因）。
  cueMesh.rotation.set(0, ang + Math.PI, 0);
  // 杆法体现：左右塞时杆身微微倾斜；上下旋改俯角
  cueMesh.rotateX(-(aim.spin.x || 0) * 0.34);
  cueMesh.rotateZ(-(aim.spin.y || 0) * 0.22);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function $(id) { return document.getElementById(id); }

function setupUI() {
  const canvas = $('c');

  // ---- 瞄准输入 -----------------------------------------------------------
  // 交互模型：在台面上按住拖动 → 横向拖动连续旋转瞄准线。
  //
  // 这里**不用 Pointer Lock**。原因：指针锁定只在 http(s) origin 下真正生效，
  // 而插件恰好跑在 http 下、独立页面跑在 file:// 下 —— 两条路径行为不一致，
  // 一旦锁定状态异常就再也收不到位移，表现就是"鼠标调方向卡住"。
  // 现在统一走 pointer capture + 增量：光标被捕获在 canvas 上，
  // 拖过整屏 = 转满一圈（360°），行为可预测，也不再需要处理锁定/解锁。
  let lastMX = null, lastMY = null;
  let aiming = false;          // 是否处于拖拽瞄准中
  let aimPointerId = null;
  // 本次按下累计移动了多少像素。用来区分"拖拽瞄准"和"点击击球"：
  // 浏览器在松开指针后一定会补发一个 click，如果不区分，
  // 拖完松手会立刻出杆 —— 玩家感觉就是"鼠标一调方向就卡住"（其实已经击球了）。
  let dragDist = 0;

  function beginAimDrag(e) {
    if (app.state !== 'ready' && app.state !== 'aiming') return;
    aiming = true;
    aimPointerId = e.pointerId;
    dragDist = 0;
    lastMX = e.clientX; lastMY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = 'grabbing';
  }

  function endAimDrag() {
    if (!aiming) return;
    aiming = false;
    aimPointerId = null;
    lastMX = null; lastMY = null;
    canvas.style.cursor = 'crosshair';
    // 万一之前残留了锁定状态，顺手清掉，避免光标一直藏着。
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) beginAimDrag(e);
  });
  // 三层兜底：正常松手 / 手势被系统打断 / 窗口失焦，都必须结束拖动状态。
  addEventListener('pointerup', endAimDrag);
  addEventListener('pointercancel', endAimDrag);
  addEventListener('blur', endAimDrag);

  /**
   * 像素增量 → 瞄准角。
   * 灵敏度：横向拖过整屏 = 转满一圈（360°）。
   *   Shift 精调：灵敏度除以 8，1px ≈ 0.031°（1440px 屏）
   */
  function applyAimDelta(dx, dy) {
    if (dx === 0 && dy === 0) return;
    const eff = dx + dy * 0.35;                       // 斜拖也参与，不割裂
    const degPerPx = 360 / Math.max(640, innerWidth); // 拖满一屏 = 一圈
    aim.rotateByPixels(eff, aim.fineMode ? degPerPx / 8 : degPerPx);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!aiming) return;
    // 只认发起拖拽的那根指针，避免多指/触控板误触串扰。
    if (aimPointerId !== null && e.pointerId !== aimPointerId) return;
    if (lastMX === null) { lastMX = e.clientX; lastMY = e.clientY; return; }
    const dx = e.clientX - lastMX;
    const dy = e.clientY - lastMY;
    dragDist += Math.abs(dx) + Math.abs(dy);
    lastMX = e.clientX; lastMY = e.clientY;
    applyAimDelta(dx, dy);
  });

  // ---- 杆法盘（球面击球点）----------------------------------------------
  const spinEl = $('spinPad');
  const dot = $('spinDot');
  let dragging = false;
  const setSpin = (e) => {
    const r = spinEl.getBoundingClientRect();
    let nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    let ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    aim.spin.x = nx * 0.45;
    aim.spin.y = -ny * 0.45;
    if (dot) dot.style.transform = `translate(${nx * 46}%, ${ny * 46}%)`;
  };
  if (spinEl) {
    spinEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { spinEl.setPointerCapture(e.pointerId); } catch (_) {}
      setSpin(e);
    });
    spinEl.addEventListener('pointermove', (e) => { if (dragging) setSpin(e); });
    spinEl.addEventListener('pointerup', () => { dragging = false; });
  }

  // ---- 摆放母球 / 点击击球 / 滚轮力度 -------------------------------------
  canvas.addEventListener('mousemove', (e) => {
    if (app.state !== 'placing') return;
    const ndc = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 };
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(aimPlane, pt)) return;
    const px = pt.x, py = -pt.z;
    const ok = rules.canPlaceCue(px, py);
    app.placePreview = { x: px, y: py, ok };
    world.cue.setPos(px, py);
    canvas.style.cursor = ok ? 'crosshair' : 'not-allowed';
  });

  canvas.addEventListener('click', (e) => {
    audio?.unlock();
    if (app.state === 'placing') {
      const ndc = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 };
      raycaster.setFromCamera(ndc, camera);
      const pt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(aimPlane, pt)) {
        const ok = tryPlaceAt(pt.x, -pt.z);
        if (!ok) {
          audio?.uiClick();
          toast(rules.isBreak
            ? '开球时母球必须放在开球线之后'
            : '这个位置有球或太靠边，换个位置', 1900, 'foul');
        }
      }
      return;
    }
    // 瞄准中：单击 = 以当前力度出杆。
    // 但如果这一下其实是"拖拽瞄准后松手"，浏览器照样会发 click —— 必须忽略，
    // 否则刚调好方向就自动出杆，玩家会以为鼠标坏了。
    if ((app.state === 'ready' || app.state === 'aiming') &&
        !app.charging && rules.phase !== PHASE.BALL_IN_HAND) {
      if (dragDist > 4) { dragDist = 0; return; }
      dragDist = 0;
      fire();
    }
  });

  // 右键：切换俯视
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (app.state === 'ready' || app.state === 'aiming') {
      app.camMode = app.camMode === 'top' ? 'aim' : 'top';
      audio?.uiClick();
    }
  });

  // 滚轮：调力度
  canvas.addEventListener('wheel', (e) => {
    if (app.state === 'ready' || app.state === 'aiming') {
      e.preventDefault();
      aim.power = Math.max(0.08, Math.min(1, aim.power - Math.sign(e.deltaY) * 0.04));
      updatePowerUI();
    }
  }, { passive: false });

  $('btnCam').onclick = () => { app.camMode = app.camMode === 'top' ? 'aim' : 'top'; audio.uiClick(); };
  $('btnGuide').onclick = () => { app.showGuides = !app.showGuides; audio.uiClick(); };
  $('btnRestart').onclick = () => { restart(); audio.uiClick(); };
  $('btnSound').onclick = () => {
    const on = !audio.enabled;
    audio?.setEnabled(on);
    $('btnSound').classList.toggle('off', !on);
    audio?.uiClick();
  };
  $('btnHelp').onclick = () => { $('panel').classList.toggle('show'); audio.uiClick(); };

  $('btnPlayAgain').onclick = () => { $('endScreen').classList.remove('show'); restart(); };

  // ---- 键盘 ---------------------------------------------------------------
  addEventListener('keydown', (e) => {
    audio?.unlock();
    if (e.shiftKey) aim.setFineMode(true);

    // 空格蓄力
    if (e.code === 'Space') {
      e.preventDefault();
      if ((app.state === 'ready' || app.state === 'aiming') &&
          rules.phase !== PHASE.BALL_IN_HAND && !app.charging) {
        app.charging = true;
        app.chargeT = 0.06;
        app.chargeDir = 1;
      }
    }

    // 瞄准微调三档：0.10° / 0.01° / 0.001°
    const FINE = 0.1;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault(); aim.nudge(-0.00175 * (e.shiftKey ? FINE : 1));
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault(); aim.nudge(0.00175 * (e.shiftKey ? FINE : 1));
    }
    if (e.code === 'Comma') { e.preventDefault(); aim.nudge(-0.0000175); }
    if (e.code === 'Period') { e.preventDefault(); aim.nudge(0.0000175); }

    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyG') app.showGuides = !app.showGuides;
    if (e.code === 'KeyT') app.camMode = app.camMode === 'top' ? 'aim' : 'top';
    if (e.code === 'Escape' || e.code === 'KeyF') $('panel').classList.toggle('show');
  });

  addEventListener('keyup', (e) => {
    if (!e.shiftKey) aim.setFineMode(false);
    if (e.code === 'Space' && app.charging) {
      app.charging = false;
      fire();
    }
  });

  // 力度条
  updatePowerUI();
  refreshScoreboard();
}

function updatePowerUI() {
  const pct = Math.round(aim.power * 100);
  const el = $('powerFill');
  if (el) {
    el.style.width = pct + '%';
    el.style.background = pct > 82
      ? 'linear-gradient(90deg,#f5c451,#f08a3c,#e0442f)'
      : pct > 55
        ? 'linear-gradient(90deg,#7bdca4,#f5c451,#f08a3c)'
        : 'linear-gradient(90deg,#5fd0ff,#7bdca4)';
  }
  const lab = $('powerVal');
  if (lab) lab.textContent = app.charging ? pct + '%' : (Math.round(aim.power * 100) + '%');
}

function toast(text, ms = 1800, kind = '') {
  const el = $('toast');
  el.textContent = text;
  el.className = 'show ' + kind;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { el.className = ''; }, ms);
}

function refreshScoreboard() {
  if (!rules) return;
  for (let i = 0; i < 2; i++) {
    const p = rules.players[i];
    const el = $('p' + i);
    if (!el) continue;
    el.classList.toggle('active', rules.turn === i && app.state !== 'over');
    const g = $('g' + i);
    if (g) {
      g.textContent = p.group === GROUP.SOLID ? '全色' : p.group === GROUP.STRIPE ? '花色' : '待定';
      g.className = 'grp ' + (p.group === GROUP.SOLID ? 'solid' : p.group === GROUP.STRIPE ? 'stripe' : '');
    }
    const sc = $('s' + i);
    if (sc) sc.textContent = p.score;
  }
  // 剩余球数
  if (rules.current.group !== GROUP.NONE) {
    const rem = rules.remainingOf(rules.current.group);
    const el = $('remInfo');
    if (el) el.textContent = rem > 0 ? `还需打进 ${rem} 颗` : '目标：8 号球';
  } else {
    const el = $('remInfo');
    if (el) el.textContent = '开放台面 · 任意花色';
  }
}

function updateHUD() {
  const el = $('fps');
  if (el) el.textContent = `${fps} FPS · ${frameMs.toFixed(1)}ms`;

  // 精调时显示实时角度，让 0.01° 的调整"看得见"
  const badge = $('fineReadout');
  if (badge) {
    if (aim.fineMode && (app.state === 'ready' || app.state === 'aiming')) {
      let deg = aim.angle * 180 / Math.PI;
      // 显示成 0~360 便于理解
      if (deg < 0) deg += 360;
      badge.textContent = `${deg.toFixed(3)}°`;
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }
}

let confetti = null;

/**
 * 结束画面。
 * @param {boolean} win 是否玩家获胜
 * @param {string} msg  副标题
 * @param {string} detail 更细的说明（可选）
 */
function showEnd(win, msg) {
  const es = $('endScreen');
  const title = $('endTitle');

  title.textContent = win ? '胜利' : '失败';
  title.className = win ? 'win' : 'lose';
  $('endMsg').textContent = msg || '';

  // 胜利时给个奖杯徽标
  const badge = $('endBadge');
  if (badge) {
    badge.textContent = win ? '🏆' : '';
    badge.className = win ? 'win' : 'lose';
  }

  es.classList.add('show');

  // 礼花：只在胜利时放
  const canvas = $('confetti');
  if (canvas) {
    if (!confetti) confetti = new Confetti(canvas);
    if (win) confetti.start();
    else confetti.stop();
  }
}

function stopConfetti() {
  if (confetti) confetti.stop();
}

function restart() {
  stopConfetti();
  clearTimeout(app.aiTimer);
  world.setupRack();
  rules.reset();
  app.state = 'ready';
  app.shotCount = 0;
  app.charging = false;
  app.chargeT = 0;
  app.camMode = 'aim';
  for (const m of ballMeshes) if (m) { m.visible = true; m.quaternion.identity(); }
  for (const b of blobShadows) if (b) b.visible = true;
  $('endScreen').classList.remove('show');
  refreshScoreboard();
  enterPlacing(true);
  toast('新的一局 · 请摆放母球', 2200);
}

function resize() {
  // 尺寸来源：
  //  · 独立页面（双击 index.html）→ 用窗口尺寸
  //  · 作为 DSH 插件挂在覆盖层里 → 用"容器"尺寸。
  //    插件宿主可能被 DSH 的布局容器约束（甚至祖先带 transform），
  //    此时窗口尺寸和可见区域不一致，按窗口算就会溢出被裁切。
  const canvas = canvasEl || document.getElementById('c');
  const host = canvas && canvas.parentElement;
  const embedded = !!window.__POOL_EMBEDDED;
  const cw = embedded && host ? host.clientWidth : 0;
  const ch = embedded && host ? host.clientHeight : 0;
  const w = cw > 0 ? cw : innerWidth;
  const h = ch > 0 ? ch : innerHeight;

  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

// ---- 调试钩子（供自动化截图/自检使用，不影响游戏）
window.__DBG = () => ({
  state: app.state, fps, frameMs,
  cam: camera ? { x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3) } : null,
  balls: world ? world.balls.map(b => ({ n: b.num, x: +b.x.toFixed(3), y: +b.y.toFixed(3), potted: b.potted, vis: ballMeshes[b.num]?.visible })) : [],
  cue: world ? { x: +world.cue.x.toFixed(3), y: +world.cue.y.toFixed(3) } : null,
  rulePhase: rules?.phase, turn: rules?.turn,
});
window.__SETCAM = (mode) => { app.camMode = mode; };

// ---- 视觉回归测试钩子 ----
// 只在 URL 带 ?test=1 时启用，避免正常游玩时被误用。
// 用法：index.html?test=1  →  __WORLD()/__PARK()/__LOOK() 可用
if (new URLSearchParams(location.search).has('test')) {
  window.__WORLD = () => world;
  window.__SCENE = () => scene;
  window.__CAM = () => camera;
  // 把某颗球放到指定位置并让它静止（用于视觉回归测试）
  window.__PARK = (num, x, y) => {
    const b = world.balls[num];
    b.potted = false; b.setPos(x, y); b.stop(); b.sleepTimer = 9;
  };
  // 手动设置相机（测试用）
  window.__LOOK = (px, py, pz, lx, ly, lz, up) => {
    camera.position.set(px, py, pz);
    camera.up.set(...(up || [0, 1, 0]));
    camera.lookAt(lx, ly, lz);
    app.camMode = 'manual';
  };
}
window.__AIM = (angle, power, spin) => { aim.angle = angle; aim.power = power; if (spin) aim.spin = spin; aim.refresh(); };
window.__AIMANGLE = () => aim.angle;
window.__DEG = () => aim.angle * 180 / Math.PI;
window.__FINEMODE = (on) => aim.setFineMode(on);
window.__FIRE = () => fire();
window.__PLACE = (x, y) => tryPlaceAt(x, y);
if (new URLSearchParams(location.search).has('test')) {
  // 强制以玩家身份获胜（视觉回归用）
  window.__FORCE_WIN = () => { app.state = 'over'; showEnd(true, '打进 8 号球，胜利！'); };
  window.__FORCE_LOSE = () => { app.state = 'over'; showEnd(false, '8 号球非法入袋，对手获胜'); };
  // 触发真实结算路径：清空全色球 + 打进 8 号
  window.__REAL_WIN = () => {
    const w = world;
    rules.isBreak = false;
    rules.players[0].group = GROUP.SOLID;
    rules.players[1].group = GROUP.STRIPE;
    rules.turn = 0;
    for (const b of w.balls) {
      if ((b.num >= 1 && b.num <= 7) || (b.num >= 9 && b.num <= 15)) b.potted = true;
    }
    w.balls[8].potted = true;
    rules.beginShot();
    rules.noteCollision({ a: 0, b: 8 });
    rules.notePot(8);
    endShot();
  };
}
window.__DEBUG_SCENE = () => { return { children: scene.children.map(c => c.type + ':' + (c.name||'')) }; };
window.__AIMDBG = () => ({
  visible: aim.group.visible,
  ang: aim.angle,
  trace: aim.trace(),
  children: aim.group.children.map(c => ({ t: c.type, vis: c.visible, pos: c.geometry?.attributes?.position?.array ? Array.from(c.geometry.attributes.position.array).map(v=>+v.toFixed(2)) : null })),
});

init().catch((e) => {
  console.error(e);
  if (window.__FATAL) window.__FATAL('初始化失败', (e && e.message) || String(e));
});
