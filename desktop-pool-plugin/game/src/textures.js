// ============================================================================
//  textures.js — 全部纹理程序化生成（Canvas2D 绘制，不依赖任何图片文件）
//  这样整个游戏可以 file:// 双击打开，也不用下载素材。
// ============================================================================

import * as THREE from 'three';

const TEX_SIZE = 1024;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 简体噪声：多次叠加的有理数正弦（无外部依赖） */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct = 5) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    freq *= 2.03; amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// 台布：细密编织纹 + 大尺度色差 + 磨白
// ---------------------------------------------------------------------------
export function clothNormalMap(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 织纹：横竖交错的细线（周期放大，避免远距离摩尔纹）
      const weave = (Math.sin(x * Math.PI * 0.34) * 0.5 + 0.5) * (Math.sin(y * Math.PI * 0.34) * 0.5 + 0.5);
      const grain = fbm(x * 0.22, y * 0.22, 3);
      const n = weave * 0.55 + grain * 0.45;
      const nx = Math.cos(n * Math.PI * 2) * 0.5 + 0.5;
      const ny = Math.sin(n * Math.PI * 2) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      d[i] = nx * 255; d[i + 1] = ny * 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 4);
  return t;
}

export function clothRoughnessMap(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.02, y * 0.02, 5) * 0.35 + 0.55;
      const i = (y * size + x) * 4;
      const v = Math.floor(n * 255);
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 3);
  return t;
}

/**
 * 台布底色（球台空间贴图，1:1 铺满整块台布）
 *  不只是一块平绿：把"三盏吊灯照在台面上"的光斑烘焙进来，
 *  再往库边压暗 —— 这是真实球台最明显的视觉特征（亮台心、暗库边）。
 *
 *  UV 约定：u = x/length + 0.5，v = z/width + 0.5（见 main.js 的 repeat/offset）
 *  @param {number} w 纹理宽（对应长边）
 *  @param {number} h 纹理高（对应短边）
 */
export function clothColorMap(w = 1024, h = 512, base = [24, 96, 64]) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const d = img.data;

  // 三盏灯在长边上的位置（与 scene.js buildLights 的 hx*0.60 对齐）
  const lampU = [0.5 - 0.30, 0.5, 0.5 + 0.30];
  // 灯斑在 u 方向的宽度（越小越"聚光"）
  const sigma = 0.155;

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);

      // ---- 灯斑：三个高斯的叠加，取软上限，避免过曝成白斑
      let pool = 0;
      for (const lu of lampU) {
        const t = (u - lu) / sigma;
        pool += Math.exp(-0.5 * t * t);
      }
      pool = Math.min(1, pool * 0.66);

      // ---- 库边压暗：到最近库边的归一化距离
      const edgeU = Math.min(u, 1 - u) * 2;        // 0=库边 1=台心
      const edgeV = Math.min(v, 1 - v) * 2;
      const edge = Math.min(edgeU, edgeV);
      //  注意：真实的落光衰减由 3 盏聚光（含 decay）负责，这里只做"补贴"，
      //  否则会和灯光衰减叠乘，把库边压成死黑。
      //  0.70 → 贴库最暗，1 → 台心全亮
      const railFall = 0.70 + 0.30 * Math.pow(Math.min(1, edge / 0.34), 0.8);

      // ---- 整体亮度
      let b = (0.66 + 0.44 * pool) * railFall;

      // ---- 四角再压一点（球台四角的暗角）
      const cu = Math.min(u, 1 - u) * 2, cv = Math.min(v, 1 - v) * 2;
      const corner = Math.min(1, Math.hypot(cu, cv) / 0.55);
      b *= 0.90 + 0.10 * corner;

      // ---- 纤维：低频，只为打破死板。
      //  这里刻意不再加 sin(y*1.7) 之类的高频条纹：它在纹理空间是 3~4px 周期，
      //  投到屏幕上会变成明显的摩尔纹格纹（远处尤其脏）。织纹交给 normalMap。
      const fine = (fbm(x * 0.16, y * 0.16, 3) - 0.5) * 0.035;

      const k = b * (1 + fine);
      const i = (y * w + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] * k));
      d[i + 1] = Math.max(0, Math.min(255, base[1] * k));
      d[i + 2] = Math.max(0, Math.min(255, base[2] * k));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// 木纹：环状年轮 + 长条纹理（球台外框、球杆、地板）
// ---------------------------------------------------------------------------
export function woodTexture(size = 1024, baseHex = '#4a2415', ringScale = 1) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const base = new THREE.Color(baseHex);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 沿 x 方向的年轮：用 fbm 扰动环半径
      const warp = fbm(x * 0.004, y * 0.02, 4) * 34;
      const rings = Math.sin((y + warp) * 0.12 * ringScale) * 0.5 + 0.5;
      const fine = fbm(x * 0.35, y * 0.35, 3);
      const grain = Math.pow(rings, 2.4) * 0.55 + fine * 0.45;
      const shade = 0.72 + grain * 0.55;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, base.r * 255 * shade * 1.05);
      d[i + 1] = Math.min(255, base.g * 255 * shade * 0.95);
      d[i + 2] = Math.min(255, base.b * 255 * shade * 0.9);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// 台球：球面贴图（号码圈 + 花色条 + 高光污渍）
//  采用等距圆柱投影：u 绕球一周，v 从下到上
// ---------------------------------------------------------------------------
const BALL_COLORS = {
  1: '#f2c012', 2: '#1d4ed8', 3: '#dc2626', 4: '#7c3aed', 5: '#ea580c',
  6: '#0d9488', 7: '#7f1d1d', 8: '#111111',
  9: '#f2c012', 10: '#1d4ed8', 11: '#dc2626', 12: '#7c3aed', 13: '#ea580c',
  14: '#0d9488', 15: '#7f1d1d',
};
export { BALL_COLORS };

export function ballTexture(num) {
  const S = 1024;
  const c = makeCanvas(S, S / 2);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const h = S / 2;
  const stripe = num >= 9;
  const color = BALL_COLORS[num] || '#f8f8f8';
  const IVORY = '#f4f1e6';

  // 底色：象牙白
  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, S, h);

  // 花色条
  // 注意：createBallMesh 里 sphere 几何已绕 X 轴转了 90°，
  // 因此贴图里"沿 u 方向的竖带"到了球面上正好是"赤道环带"（正确的条纹球外观）。
  // 早期版本画的是 v 方向的横带，旋转后就变成经线带 —— 球会显示成
  // "彩色球 + 两侧白斑"，看起来像做坏了。
  if (stripe && num !== 8) {
    // 实测映射（test/uvmapping）：v = 纬度（v=1 在 +Z 极，v=0 在 -Z 极），u = 经度。
    // 所以"赤道环带"= u 方向铺满整幅（所有经度）、v 方向取中间一段。
    // 条带宽度约 0.42 的纬度范围，上下留出象牙白极冠。
    const bandH = h * 0.52;
    const gy = (h - bandH) / 2;
    const band = ctx.createLinearGradient(0, gy, 0, gy + bandH);
    band.addColorStop(0.00, IVORY);
    band.addColorStop(0.07, color);
    band.addColorStop(0.93, color);
    band.addColorStop(1.00, IVORY);
    ctx.fillStyle = band;
    ctx.fillRect(0, gy, S, bandH);
  } else if (num !== 0 && num !== 8) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, h);
  } else if (num === 8) {
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, S, h);
  }

  // 号码圈：两个（球的两面各一个）
  //  真实酚醛球的白圈比早期版本小一圈，且几乎没有肉眼可辨的渐变 —— 必须锐利。
  if (num > 0) {
    // 几何已经绕 X 转了 90°（见 createBallMesh），所以贴图的"赤道"(v=0.5)
    // 现在是球的正上方，正好对着相机。只在这里放一圈干净的号码圈即可，
    // 不再需要多纬度冗余（那会产生变形）。
    const r = h * 0.150;
    for (const cx of [S * 0.25, S * 0.75]) {
      ctx.beginPath();
      ctx.arc(cx, h / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fcfaf3';
      ctx.fill();
      ctx.fillStyle = '#0b0b0b';
      const fs = Math.round(r * 1.05);
      ctx.font = `700 ${fs}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), cx, h / 2 + r * 0.03);
    }
  }

  // 极区：只有花色球在两极有一圈很窄的白冠（纯色球不该出现浅色顶）
  //  以前 capH = h*0.052 且纯色球也加，导致纯色球顶部整体发白、颜色被冲淡。
  if (stripe && num !== 8) {
    const capH = h * 0.030;
    const grad1 = ctx.createLinearGradient(0, 0, 0, capH);
    grad1.addColorStop(0, 'rgba(244,241,230,0.95)');
    grad1.addColorStop(1, 'rgba(244,241,230,0)');
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, S, capH);
    const grad2 = ctx.createLinearGradient(0, h, 0, h - capH);
    grad2.addColorStop(0, 'rgba(244,241,230,0.95)');
    grad2.addColorStop(1, 'rgba(244,241,230,0)');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, h - capH, S, capH);
  }

  // 微小污渍/磨损，避免塑料感（幅度很小，只打破死板的纯色）
  const img = ctx.getImageData(0, 0, S, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const n = (fbm(x * 0.09, y * 0.09, 3) - 0.5) * 5;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// 地板：深色木地板 + 高光
// ---------------------------------------------------------------------------
export function floorTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const planks = 6;
  const pw = size / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.82 + hash(i, 3) * 0.3;
    const base = new THREE.Color('#2a1a12').multiplyScalar(shade);
    ctx.fillStyle = `rgb(${base.r * 255 | 0},${base.g * 255 | 0},${base.b * 255 | 0})`;
    ctx.fillRect(i * pw, 0, pw, size);
    // 木纹
    const img = ctx.getImageData(i * pw, 0, pw, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < pw; x++) {
        const g = fbm((x + i * 300) * 0.02, y * 0.008, 4);
        const i2 = (y * pw + x) * 4;
        const k = 0.75 + g * 0.5;
        d[i2] *= k; d[i2 + 1] *= k; d[i2 + 2] *= k;
      }
    }
    ctx.putImageData(img, i * pw, 0);
    // 板缝
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(i * pw, 0, 2, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 7);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// 灯罩内的柔光贴图（径向渐变，用于灯板的发光面）
// ---------------------------------------------------------------------------
export function glowTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.35, 'rgba(255,244,214,0.85)');
  g.addColorStop(0.7, 'rgba(255,236,190,0.25)');
  g.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 圆形柔和阴影（假接触阴影，画在台布上给球用） */
export function blobShadowTexture(size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}


/** 纯灰阶细节贴图：用于给纯色材质叠加织纹（颜色由 material.color 控制） */
export function detailMap(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = (Math.sin(x * 1.55) * 0.5 + 0.5) * (Math.sin(y * 1.55) * 0.5 + 0.5);
      const fine = fbm(x * 0.55, y * 0.55, 2);
      const v = 232 + weave * 14 + (fine - 0.5) * 12;
      const i = (y * size + x) * 4;
      const q = Math.max(0, Math.min(255, v));
      d[i] = q; d[i + 1] = q; d[i + 2] = q; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 13);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
