/* ==========================================================================
   table.js — Three.js 舞台
   · 卡牌是真正的 3D 圆角盒体（有厚度、有倒角、有高光）
   · 全部运动走"弹簧"：可中断、帧率无关、天然带一点回弹
   · 命中/出牌/计分都有粒子与镜头冲击
   ========================================================================== */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { getFaceTexture, getBackTexture, setAnisotropy } from './cards.js';
import { jokerTexture } from './jokers.js';

/* 设计坐标系：视口高度固定 7.9 单位，宽度按比例，相机自适应 */
const VIEW = { halfH: 3.72, halfW: 6.2 };

const CARD = { w: 1.0, h: 1.4, d: 0.052 };
const JOKER = { w: 0.71, h: 1.03, d: 0.046 };

const HAND_Y = -1.66;
const PLAY_Y = 0.38;
const JOKER_Y = 2.26;
const DECK_POS = { x: 5.25, y: -1.95 };

/* ==========================================================================
   弹簧
   ========================================================================== */
class Spring {
  constructor(v = 0, k = 190, d = 17.5) {
    this.x = v; this.target = v; this.v = 0; this.k = k; this.d = d;
  }
  set(t) { this.target = t; }
  snap(t) { this.x = t; this.target = t; this.v = 0; }
  kick(impulse) { this.v += impulse; }
  update(dt) {
    if (Math.abs(this.x - this.target) < 0.0004 && Math.abs(this.v) < 0.004) {
      this.x = this.target; this.v = 0; return;
    }
    const steps = Math.min(6, Math.max(1, Math.ceil(dt * 200)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.x) * this.k - this.v * this.d;
      this.v += a * h;
      this.x += this.v * h;
    }
  }
}

/* ==========================================================================
   粒子池（预分配，运行期零 new）
   ========================================================================== */
class Sparks {
  constructor(scene, max = 1100) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);

    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    geo.setDrawRange(0, max);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 40);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(40.0, aSize * (15.0 / max(0.1, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          float a = 1.0 - smoothstep(0.35, 1.0, d);
          a *= a;
          // 单粒亮度压到 0.66：加法混合下即使几十粒叠在一起也不会烧成一个白团
          gl_FragColor = vec4(vColor, a * vAlpha * 0.66);
        }`
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);

    for (let i = 0; i < max; i++) this.alp[i] = 0;
  }

  emit(x, y, z, opt = {}) {
    const count = opt.count || 10;
    const spread = opt.spread ?? 0.16;
    const speed = opt.speed ?? 2.2;
    const life = opt.life ?? 0.7;
    const size = opt.size ?? 9;
    const grav = opt.gravity ?? -5;
    const drag = opt.drag ?? 1.6;
    const c = opt.color || new THREE.Color(0xffd166);
    const bias = opt.dir ? new THREE.Vector3(opt.dir.x, opt.dir.y, opt.dir.z) : null;

    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = k * 3;

      this.pos[i3] = x + (Math.random() - 0.5) * spread;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * spread;
      this.pos[i3 + 2] = z + (Math.random() - 0.5) * spread;

      let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      const len = Math.hypot(vx, vy, vz) || 1;
      vx /= len; vy /= len; vz /= len;
      if (bias) { vx = vx * 0.4 + bias.x; vy = vy * 0.4 + bias.y; vz = vz * 0.4 + bias.z; }

      const sp = speed * (0.4 + Math.random() * 0.9);
      this.vel[i3] = vx * sp;
      this.vel[i3 + 1] = vy * sp;
      this.vel[i3 + 2] = vz * sp;

      const tint = 0.72 + Math.random() * 0.5;
      this.col[i3] = c.r * tint;
      this.col[i3 + 1] = c.g * tint;
      this.col[i3 + 2] = c.b * tint;

      this.size0[k] = size * (0.55 + Math.random() * 0.9);
      this.siz[k] = this.size0[k];
      this.life[k] = life * (0.6 + Math.random() * 0.7);
      this.maxLife[k] = this.life[k];
      this.grav[k] = grav;
      this.drag[k] = drag;
      this.alp[k] = 1;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alp[i] = 0; this.siz[i] = 0; continue; }

      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;

      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      this.alp[i] = t * t;
      this.siz[i] = this.size0[i] * (0.35 + t * 0.9);
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}

/* ==========================================================================
   卡牌视图
   ========================================================================== */
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // 柔光贴图
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 3, 64, 64, 63);
  rg.addColorStop(0, 'rgba(255,232,175,0.66)');
  rg.addColorStop(0.26, 'rgba(255,202,110,0.34)');
  rg.addColorStop(0.58, 'rgba(255,176,80,0.16)');
  rg.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;

  // 柔边投影
  const scv = document.createElement('canvas');
  scv.width = 160; scv.height = 224;
  const sg = scv.getContext('2d');
  sg.filter = 'blur(11px)';
  sg.fillStyle = '#000';
  const r0 = 22;
  sg.beginPath();
  sg.moveTo(r0, 8); sg.arcTo(152, 8, 152, 216, r0); sg.arcTo(152, 216, 8, 216, r0);
  sg.arcTo(8, 216, 8, 8, r0); sg.arcTo(8, 8, 152, 8, r0); sg.closePath(); sg.fill();
  const shadowTex = new THREE.CanvasTexture(scv);
  shadowTex.colorSpace = THREE.SRGBColorSpace;

  SHARED = {
    glowTex, shadowTex,
    bodyMat: new THREE.MeshStandardMaterial({ color: 0xf7f2e5, roughness: 0.46, metalness: 0.03 }),
    edgeMat: new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.7, metalness: 0.0 }),
    // 小丑牌的牌身：深色卡套，避免深色卡面外圈出现一圈刺眼白边
    jokerBodyMat: new THREE.MeshStandardMaterial({ color: 0x171c30, roughness: 0.5, metalness: 0.22 })
  };
  return SHARED;
}

class CardView {
  constructor(stage, card, isJoker = false) {
    this.stage = stage;
    this.card = card;
    this.isJoker = isJoker;
    this.jitter = (Math.random() - 0.5) * 0.03;
    this.delay = 0;
    this.alive = true;

    const S = isJoker ? JOKER : CARD;
    const geo = new RoundedBoxGeometry(S.w, S.h, S.d, 3, isJoker ? 0.045 : 0.05);
    this.body = new THREE.Mesh(geo, isJoker ? shared().jokerBodyMat : shared().bodyMat);
    this.body.userData.view = this;


    const fw = S.w * 0.895, fh = S.h * 0.925;
    this.faceMat = new THREE.MeshStandardMaterial({
      map: null, roughness: 0.52, metalness: 0.02,
      emissive: new THREE.Color(0xffcf6a), emissiveIntensity: 0
    });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), this.faceMat);
    this.face.position.z = S.d / 2 + 0.0015;
    this.face.userData.view = this;

    this.backMat = new THREE.MeshStandardMaterial({ map: getBackTexture(), roughness: 0.55, metalness: 0.05 });
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), this.backMat);
    this.back.position.z = -S.d / 2 - 0.0015;
    this.back.rotation.y = Math.PI;

    this.glowMat = new THREE.MeshBasicMaterial({
      map: shared().glowTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(S.w * 1.62, S.h * 1.34), this.glowMat);
    this.glow.position.z = -S.d / 2 - 0.02;

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shared().shadowTex, transparent: true, opacity: 0.58,
      depthWrite: false, color: 0x000000
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(S.w * 1.12, S.h * 1.08), this.shadowMat);
    this.shadow.position.set(-0.045, -0.075, -0.052);
    this.shadow.renderOrder = -1;

    this.group = new THREE.Group();
    this.group.add(this.body, this.face, this.back, this.glow, this.shadow);
    stage.cardRoot.add(this.group);

    // 弹簧组
    this.sx = new Spring(0); this.sy = new Spring(0); this.sz = new Spring(0);
    this.rx = new Spring(0); this.ry = new Spring(0); this.rz = new Spring(0);
    this.sc = new Spring(1); this.glowV = new Spring(0);
    this.punch = 0;        // 一次性缩放冲击
    this.shakeT = 0;       // 抖动残余
    this.selected = false;
    this.baseScale = 1;

    if (card) this.setCard(card);
  }

  setCard(card) {
    this.card = card;
    this.faceMat.map = getFaceTexture(card);
    // 被 BOSS 削弱的牌：整体压暗，一眼能看出来
    this.faceMat.color.setHex(card.debuffed ? 0x6e6e78 : 0xffffff);
    this.faceMat.needsUpdate = true;
  }

  setJokerTex(tex) {
    this.faceMat.map = tex;
    this.faceMat.needsUpdate = true;
  }

  setTarget(p) {
    if (p.x !== undefined) this.sx.set(p.x);
    if (p.y !== undefined) this.sy.set(p.y);
    if (p.z !== undefined) this.sz.set(p.z);
    if (p.rx !== undefined) this.rx.set(p.rx);
    if (p.ry !== undefined) this.ry.set(p.ry);
    if (p.rz !== undefined) this.rz.set(p.rz);
    if (p.sc !== undefined) this.sc.set(p.sc * this.baseScale);
    if (p.glow !== undefined) this.glowV.set(p.glow);
  }

  snapTo(p) {
    if (p.x !== undefined) this.sx.snap(p.x);
    if (p.y !== undefined) this.sy.snap(p.y);
    if (p.z !== undefined) this.sz.snap(p.z);
    if (p.rx !== undefined) this.rx.snap(p.rx);
    if (p.ry !== undefined) this.ry.snap(p.ry);
    if (p.rz !== undefined) this.rz.snap(p.rz);
    if (p.sc !== undefined) this.sc.snap(p.sc * this.baseScale);
    if (p.glow !== undefined) this.glowV.snap(p.glow);
    this.apply(0);
  }

  kick(vy = 2.2) { this.sy.kick(vy); }

  apply(dt) {
    const g = this.group;
    g.position.set(this.sx.x, this.sy.x, this.sz.x);
    let extraShake = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      extraShake = Math.sin(this.shakeT * 90) * this.shakeT * 0.35;
    }
    g.rotation.set(this.rx.x + extraShake * 0.4, this.ry.x, this.rz.x + this.jitter);
    const s = this.sc.x * (1 + this.punch);
    g.scale.setScalar(s);
    this.glowMat.opacity = Math.min(0.62, this.glowV.x * 1.0);
    this.faceMat.emissiveIntensity = this.glowV.x * 0.06;
    const lift = Math.min(1.2, Math.max(0, this.sz.x));
    this.shadow.position.set(-0.045 - lift * 0.12, -0.075 - lift * 0.18, -0.052);
    this.shadowMat.opacity = 0.58 * (1 - lift * 0.45);
    if (this.punch > 0) this.punch = Math.max(0, this.punch - dt * 4.4);
  }

  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return; }
    this.sx.update(dt); this.sy.update(dt); this.sz.update(dt);
    this.rx.update(dt); this.ry.update(dt); this.rz.update(dt);
    this.sc.update(dt); this.glowV.update(dt);
    this.apply(dt);
  }

  worldPos(out = new THREE.Vector3()) {
    return this.group.getWorldPosition(out);
  }

  dispose() {
    this.alive = false;
    this.group.parent && this.group.parent.remove(this.group);
    this.body.geometry.dispose();
    this.face.geometry.dispose();
    this.back.geometry.dispose();
    this.glow.geometry.dispose();
    this.faceMat.dispose();
    this.backMat.dispose();
    this.glowMat.dispose();
    this.shadow.geometry.dispose();
    this.shadowMat.dispose();
  }
}

/* ==========================================================================
   后期：暗角 + 颗粒 + 色散
   —— 这一版跑在 OutputPass 之后（显示空间 sRGB），不再对线性 HDR 直接加减，
      所以暗部不会被 0.02 的加性噪点抬灰，全屏也不会糊成一片白。
   ========================================================================== */
const PostShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 1 },
    uAb: { value: 0 }, uPunch: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; uniform float uAb; uniform float uPunch;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec4 c;

      // 色散：只作用在画面外围（r2 加权），中心始终干净 —— 冲击时看到的是一圈色边，
      // 而不是整屏三通道错位导致的"花白"
      if (uAb > 0.0001) {
        vec2 dir = d * uAb * r2 * 6.0;
        c = vec4(
          texture2D(tDiffuse, uv + dir).r,
          texture2D(tDiffuse, uv).g,
          texture2D(tDiffuse, uv - dir).b,
          1.0
        );
      } else {
        c = texture2D(tDiffuse, uv);
      }

      // 轻 S 曲线：压暗部、稳中间调，避免整体"上浮"发灰
      vec3 s = c.rgb * c.rgb * (3.0 - 2.0 * c.rgb);
      c.rgb = mix(c.rgb, s, 0.16);

      // 白点收缩：任何通道都不允许顶到纯白。
      // 这是"不刺眼"的关键 —— 高光再多也只到 0.965，永远留一丝细节。
      c.rgb = clamp(c.rgb, vec3(0.0), vec3(0.965));

      // 冲击收缩：命中瞬间把外围压暗（uPunch），靠"周围变暗"制造对比，
      // 而不是靠"全屏变亮"。方向上是纯减法，永远不会让画面发白。
      float edge = smoothstep(0.26, 0.62, length(d * vec2(1.0, 1.14)));
      c.rgb *= 1.0 - edge * uPunch * 0.34;

      // 暗角：中心满亮，边角压到 42%
      float v = smoothstep(1.06, 0.26, length(d * vec2(1.0, 1.14)));
      c.rgb *= mix(0.42, 1.0, v * uVig + (1.0 - uVig) * 0.55);

      // 颗粒：按亮度平方衰减，暗部像胶片，亮部几乎无噪点
      float g = hash(uv * 1024.0 + fract(uTime * 0.73));
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float k = 1.0 - lum;
      c.rgb += (g - 0.5) * 0.050 * k * k;

      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }`
};

/* ==========================================================================
   舞台
   ========================================================================== */
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.cards = new Map();     // card.id -> CardView
    this.jokerViews = new Map(); // joker uid -> CardView
    this.trauma = 0;
    this.bloomKick = 0;
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerSmooth = new THREE.Vector2(0, 0);

    const r = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.96;
    r.shadowMap.enabled = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    this.camera.position.set(0, 0, 14);

    this.cardRoot = new THREE.Group();
    this.cardRoot.rotation.x = -0.17;
    this.scene.add(this.cardRoot);

    this._buildTable();
    this._buildLights();
    this._buildDust();

    this.sparks = new Sparks(this.scene, 1100);

    // 后期链：先 Bloom（线性 HDR）→ OutputPass（色调映射 + sRGB）→ 最后的"胶片"处理
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // strength / radius / threshold：小半径、高阈值 —— 只有真正的高光才泛光，
    // 奶油色卡面（线性亮度 ≈1.05）留在阈值之下，不会整屏起雾
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.26, 1.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.post = new ShaderPass(PostShader);
    this.composer.addPass(this.post);

    this.raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();

    this.resize();
  }

  /* ---------------- 场景搭建 ---------------- */
  _buildTable() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const g = cv.getContext('2d');

    g.fillStyle = '#070d1e';
    g.fillRect(0, 0, 1024, 1024);

    const rg = g.createRadialGradient(512, 480, 30, 512, 512, 700);
    rg.addColorStop(0, '#1a2748');
    rg.addColorStop(0.35, '#131d3a');
    rg.addColorStop(0.7, '#0b1226');
    rg.addColorStop(1, '#04060e');
    g.fillStyle = rg;
    g.fillRect(0, 0, 1024, 1024);

    // 细密织纹
    g.globalAlpha = 0.075;
    g.strokeStyle = '#9fb4ff';
    g.lineWidth = 1;
    for (let i = 0; i < 1024; i += 8) {
      g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    }
    g.globalAlpha = 1;

    // 同心圆装饰
    g.strokeStyle = 'rgba(243,201,97,0.13)';
    for (let i = 1; i <= 4; i++) {
      g.lineWidth = i === 1 ? 2.4 : 1.3;
      g.beginPath(); g.arc(512, 512, 150 + i * 105, 0, Math.PI * 2); g.stroke();
    }
    // 中心六角星
    g.strokeStyle = 'rgba(243,201,97,0.10)';
    g.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = k * Math.PI / 6 + i * Math.PI / 3;
        const x = 512 + Math.cos(a) * 300, y = 512 + Math.sin(a) * 300;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
    }

    // 颗粒
    for (let i = 0; i < 9000; i++) {
      g.globalAlpha = Math.random() * 0.05;
      g.fillStyle = Math.random() < 0.5 ? '#fff' : '#000';
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
    g.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 19),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    table.position.z = -0.07;
    this.cardRoot.add(table);
    this.table = table;


    // 中央暖光
    const glowTex = shared().glowTex;
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 7),
      new THREE.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: 0.045,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    halo.position.set(0, 0.25, -0.05);
    this.cardRoot.add(halo);

    // 出牌区提示框（很淡，但能让空桌有"落点"）
    const zc = document.createElement('canvas');
    zc.width = 512; zc.height = 208;
    const zg = zc.getContext('2d');
    const rr = (x, y, w, h, r) => {
      zg.beginPath();
      zg.moveTo(x + r, y);
      zg.arcTo(x + w, y, x + w, y + h, r);
      zg.arcTo(x + w, y + h, x, y + h, r);
      zg.arcTo(x, y + h, x, y, r);
      zg.arcTo(x, y, x + w, y, r);
      zg.closePath();
    };
    zg.fillStyle = 'rgba(120,160,255,0.014)';
    rr(6, 6, 500, 196, 26); zg.fill();
    zg.strokeStyle = 'rgba(243,201,97,0.040)';
    zg.lineWidth = 2.4;
    rr(6, 6, 500, 196, 26); zg.stroke();
    const zTex = new THREE.CanvasTexture(zc);
    zTex.colorSpace = THREE.SRGBColorSpace;
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(5.7, 2.25),
      new THREE.MeshBasicMaterial({ map: zTex, transparent: true, depthWrite: false })
    );
    zone.position.set(0, PLAY_Y + 0.02, -0.04);
    this.cardRoot.add(zone);
    this.playZone = zone;

    // 牌堆
    this.deckPile = new THREE.Group();
    this.deckPile.position.set(DECK_POS.x, DECK_POS.y, -0.02);
    this.cardRoot.add(this.deckPile);
    const back = getBackTexture();
    for (let i = 0; i < 4; i++) {
      const s = 0.62;
      const geo = new RoundedBoxGeometry(CARD.w * s, CARD.h * s, CARD.d, 2, 0.035);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xf3ecda, roughness: 0.6, metalness: 0.02
      }));
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD.w * s * 0.895, CARD.h * s * 0.925),
        new THREE.MeshStandardMaterial({ map: back, roughness: 0.55, metalness: 0.05 })
      );
      face.position.z = CARD.d / 2 + 0.002;
      const grp = new THREE.Group();
      grp.add(m, face);
      grp.position.set(i * 0.01, i * 0.012, i * 0.012);
      grp.rotation.z = i * 0.018 - 0.026;
      this.deckPile.add(grp);
    }
  }

  _buildLights() {
    // 光比拉大：主光够亮打出卡片的立体感，环境光压低让桌面真正"暗"下去。
    // 以前环境光 0.38 + 半球 0.75 + 主光 1.45，卡面线性亮度到 2.0，
    // 整个画面被推过 1.0 → 全在泛光阈值之上 → 一片白。
    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.22));

    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x120a1e, 0.40);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff3e0, 0.92);
    key.position.set(2.4, 6.5, 8);

    this.scene.add(key);

    const rimL = new THREE.PointLight(0x7b6bff, 30, 26, 2);
    rimL.position.set(-7, 2.5, 5);
    this.scene.add(rimL);

    const rimR = new THREE.PointLight(0xffa15c, 24, 26, 2);
    rimR.position.set(7.5, -1.5, 4.5);
    this.scene.add(rimR);

    const top = new THREE.PointLight(0x63d8ff, 16, 22, 2);
    top.position.set(0, 7, 3);
    this.scene.add(top);
  }

  _buildDust() {
    const N = 120;
    const pos = new Float32Array(N * 3);
    this.dustSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 11;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
      this.dustSeed[i * 3] = Math.random() * 100;
      this.dustSeed[i * 3 + 1] = 0.1 + Math.random() * 0.35;
      this.dustSeed[i * 3 + 2] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.030, color: 0xcfe3ff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.dustPos = pos;
  }

  /* ---------------- 尺寸 ---------------- */
  /** 每帧比对一次实际尺寸，杜绝画布/渲染目标不同步 */
  checkSize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== this._w || h !== this._h || dpr !== this._dpr) this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._w = w; this._h = h; this._dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    const aspect = w / h;
    this.camera.aspect = aspect;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const dH = VIEW.halfH / tan;
    const dW = VIEW.halfW / (tan * aspect);
    this.camera.position.set(0, 0, Math.max(dH, dW));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.bloom.setSize(w, h);
  }

  /* ---------------- 卡牌生命周期 ---------------- */
  cardView(card) {
    let v = this.cards.get(card.id);
    if (!v || !v.alive) {
      v = new CardView(this, card, false);
      this.cards.set(card.id, v);
    }
    v.setCard(card);
    v.group.visible = true;
    return v;
  }

  jokerView(j, key) {
    let v = this.jokerViews.get(key);
    if (!v) {
      v = new CardView(this, null, true);
      v.setJokerTex(jokerTexture(j));
      v.joker = j;
      this.jokerViews.set(key, v);
    }
    v.group.visible = true;
    return v;
  }

  releaseJoker(key) {
    const v = this.jokerViews.get(key);
    if (v) { v.group.visible = false; }
  }

  hideCard(view) {
    view.group.visible = false;
  }

  /* ---------------- 布局 ---------------- */
  poseHand(views, selected, hover, opts = {}) {
    const n = views.length;
    if (!n) return;
    const spacing = Math.min(1.16, 8.4 / n);
    const center = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const v = views[i];
      const off = i - center;
      const isSel = selected.includes(v);
      const isHov = v === hover;
      const lift = isSel ? 0.52 : 0;
      const hov = isHov && !isSel ? 0.30 : 0;
      v.setTarget({
        x: off * spacing,
        y: HAND_Y + lift + hov - Math.abs(off) * 0.012,
        z: 0.012 * i + (isSel ? 0.34 : 0) + (isHov ? 0.30 : 0),
        rx: 0,
        ry: -off * 0.022 + (isHov ? -0.05 : 0),
        rz: -off * 0.026 + (isSel ? 0 : 0),
        sc: isSel ? 1.05 : 1,
        glow: isSel ? 0.75 : (isHov ? 0.34 : 0)
      });
    }
  }

  posePlay(views, opts = {}) {
    const n = views.length;
    if (!n) return;
    const spacing = Math.min(1.08, 5.4 / n);
    const center = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const v = views[i];
      v.setTarget({
        x: (i - center) * spacing,
        y: PLAY_Y,
        z: 0.02 * i + 0.6,
        rx: 0, ry: 0, rz: v.jitter,
        sc: 1.1,
        glow: opts.glow ?? 0.35
      });
    }
  }

  poseJokers(views, hover) {
    const n = views.length;
    if (!n) return;
    const spacing = 1.0;
    const center = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const v = views[i];
      const isHov = v === hover;
      v.setTarget({
        x: (i - center) * spacing,
        y: JOKER_Y + (isHov ? 0.10 : 0),
        z: isHov ? 0.35 : 0.02 * i,
        rx: 0, ry: 0, rz: 0,
        sc: isHov ? 1.04 : 0.95,
        glow: isHov ? 0.5 : 0
      });
    }
  }

  /** 标题页的展示扇形 */
  poseTitle(views) {
    this.titleViews = views || [];
    this._poseTitleNow(0);
  }

  _poseTitleNow(t) {
    const views = this.titleViews || [];
    const n = views.length;
    const center = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const v = views[i];
      const off = i - center;
      v.setTarget({
        x: off * 1.16,
        y: -1.72 + Math.abs(off) * 0.10 + Math.sin(t * 0.85 + i * 0.55) * 0.045,
        z: 0.02 * i,
        rx: 0,
        ry: -off * 0.06,
        rz: -off * 0.085 + Math.sin(t * 0.7 + i * 0.4) * 0.012,
        sc: 1.06,
        glow: 0.18
      });
    }
  }

  deckPose() {
    return { x: DECK_POS.x, y: DECK_POS.y, z: 0.05, rx: 0, ry: 0, rz: 0.06, sc: 0.62 };
  }

  offscreenPose(side = 1) {
    return { x: side * 9.5, y: -1.2, z: 2.5, rx: 0.4, ry: side * 1.2, rz: side * 0.7, sc: 0.5, glow: 0 };
  }

  /* ---------------- 特效 ---------------- */
  sparkAt(view, opt) {
    const p = view.worldPos(this._tmpV);
    this.sparks.emit(p.x, p.y, p.z, opt);
  }

  sparkWorld(x, y, z, opt) {
    this.sparks.emit(x, y, z, opt);
  }

  shake(amount = 0.35) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flash(amount = 0.5) {
    this.bloomKick = Math.min(0.62, this.bloomKick + amount);
  }

  /* ---------------- 拾取 ---------------- */
  pick(ndcX, ndcY, views) {
    if (!views || !views.length) return null;
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const list = [];
    for (const v of views) if (v.group.visible) list.push(v.body);
    const hits = this.raycaster.intersectObjects(list, false);
    if (!hits.length) return null;
    return hits[0].object.userData.view;
  }

  /* ---------------- 帧更新 ---------------- */
  update(dt, time) {
    this.checkSize();
    if (this.titleViews && this.titleViews.length) this._poseTitleNow(time);

    // 相机视差（轻微，跟随鼠标）
    this.pointerSmooth.lerp(this.pointer, 1 - Math.exp(-3 * dt));
    const ox = this.pointerSmooth.x * 0.34;
    const oy = this.pointerSmooth.y * 0.20;

    // 震动：trauma² × 平滑噪声。
    // 频率刻意压低（33/61Hz 而不是 47/92Hz）—— 高频抖动看起来像"抖屏故障"，
    // 低频余震才像"重量"。手感的重量交给振幅和音效，不交给刺眼的高频闪烁。
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const t2 = this.trauma * this.trauma;
    const shX = (Math.sin(time * 33.7) * 0.55 + Math.sin(time * 61.3) * 0.45) * t2 * 0.36;
    const shY = (Math.sin(time * 37.9 + 1.7) * 0.55 + Math.sin(time * 57.1) * 0.45) * t2 * 0.27;
    const shR = Math.sin(time * 27.1) * t2 * 0.009;

    this.camera.position.x = ox + shX;
    this.camera.position.y = oy + shY;
    this.camera.rotation.z = shR;
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.z += shR;

    // 卡牌
    for (const v of this.cards.values()) if (v.group.visible) v.update(dt);
    for (const v of this.jokerViews.values()) if (v.group.visible) v.update(dt);

    // 粒子 / 尘埃
    this.sparks.update(dt);
    this._updateDust(time);

    // 辉光冲击回弹：只做"一口气"的短促呼吸，不做全屏漂白
    this.bloomKick *= Math.exp(-5.2 * dt);
    this.bloom.strength = 0.15 + Math.min(0.40, this.bloomKick * 0.24);
    this.post.uniforms.uTime.value = time;
    this.post.uniforms.uAb.value = this.trauma * this.trauma * 0.007;
    // 冲击时"外圈压暗"而不是"整体提亮"—— 这是画面不发白的关键
    this.post.uniforms.uPunch.value = Math.min(1, this.trauma * this.trauma * 2.6);

    // 牌堆轻晃
    if (this.deckPile) {
      this.deckPile.rotation.z = Math.sin(time * 0.9) * 0.006;
    }
  }

  _updateDust(time) {
    const p = this.dustPos, s = this.dustSeed;
    for (let i = 0; i < p.length / 3; i++) {
      const i3 = i * 3;
      p[i3 + 1] += s[i3 + 1] * 0.0022;
      if (p[i3 + 1] > 5.5) p[i3 + 1] = -5.5;
      p[i3] += Math.sin(time * 0.4 + s[i3]) * 0.0016;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  render() {
    this.composer.render();
  }
}
