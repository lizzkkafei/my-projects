// ============================================================================
//  scene.js — 3D 场景搭建
//  ---------------------------------------------------------------------------
//  球台尺寸严格按 9ft 比赛台（2.54 × 1.27 m），三层结构：
//    石板(slate) → 台布(cloth) → 木质外框(rail) + 胶边(rubber)
//  光照参考真实台球厅：上方三灯吊灯 + 台面重点照明 + 环境补光。
// ============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BALL_COLORS } from './textures.js';

export const R = CONFIG.ball.radius;
// 袋口（视觉）半径：真实 9ft 球台角袋口宽约 1.9 球径 → 半径 ≈ 0.075。
// 只影响视觉（台布开孔 / 黄铜圈 / 黑井），物理捕获半径在 CONFIG.table 里，不动。
export const POCKET_MOUTH_R = 0.074;
// 物理 (x, y) → three (x, z)，y 取负以保持手性一致（避免镜像）
export const toWorld = (x, y) => new THREE.Vector3(x, R, -y);

// ---------------------------------------------------------------------------
// 台体
// ---------------------------------------------------------------------------
export function buildTable(scene, TEX) {
  const T = CONFIG.table;
  const hx = T.length / 2;
  const hy = T.width / 2;
  const rw = T.railWidth;
  const ce = T.cornerEndInset;
  const ces = T.cornerEndInsetShort;
  const sg = T.sideHalfGap;
  const group = new THREE.Group();
  group.name = 'table';

  // 袋口中心（视觉）：与物理捕获点完全对齐，避免"开孔偏一点"的糊边
  //  角袋中心必须"往台内拉"一点，正好落在两个袋角（jaw tip）之间：
  //  袋角在 (hx-ce, hy) 与 (hx, hy-ces)，圆心到两点的距离相等 ⇒
  //  圆心 ≈ (hx-0.048, hy-0.048)、半径 ≈ 0.070。
  //  以前圆心就放在台布外角上，圆弧有 3/4 被胶边和木框切掉，
  //  所以铜口永远显示成一段 C 形弧 —— 这才是"袋口缺一块"的根因。
  //  a 由「圆与两个袋角同时相切」解出：(a-ce)^2 + a^2 = r^2  →  a ~ 0.056
  const CORNER_PULL = 0.056;
  const pocketCenters = [
    { x: hx - CORNER_PULL, y: hy - CORNER_PULL, kind: 'corner', mr: 0.062 },
    { x: hx - CORNER_PULL, y: -hy + CORNER_PULL, kind: 'corner', mr: 0.062 },
    { x: -hx + CORNER_PULL, y: hy - CORNER_PULL, kind: 'corner', mr: 0.062 },
    { x: -hx + CORNER_PULL, y: -hy + CORNER_PULL, kind: 'corner', mr: 0.062 },
    { x: 0, y: hy - 0.004, kind: 'side', mr: 0.058 },
    { x: 0, y: -hy + 0.004, kind: 'side', mr: 0.058 },
  ];

  const railH = 0.0435;                // 胶边鼻线高度
  const railTopY = 0.070;              // 木框台面高度（比胶边鼻线高）
  const outerX = hx + rw;
  const outerY = hy + rw;

  // ---------------- 台布
  //  envMapIntensity 压到很低：台布是粗织物，不该有环境反射的"塑料感"。
  //  关键在 specularIntensity：布料几乎不反镜面，但 roughness=1 的 GGX 仍有约 4%
  //  的宽镜面瓣，在 3 盏强聚光下会变成一层盖住颜色的"白雾"——
  //  这正是之前台布呈现 (165,217,180) 薄荷灰白的主因。压到 0.18 后绿色才透出来。
  const clothMat = new THREE.MeshPhysicalMaterial({
    map: TEX.clothColor,        // 带灯斑/库边衰减的底色贴图（球台空间，1:1）
    normalMap: TEX.clothNormal,
    normalScale: new THREE.Vector2(0.16, 0.16),
    roughness: 1.0,
    metalness: 0.0,
    specularIntensity: 0.18,
    color: 0xffffff,
    envMapIntensity: 0.10,
  });

  // 台布用 Shape + 挖洞，让袋口真的透出下面的黑洞
  //  关键：台布必须比"比赛区"多铺出一圈（CLOTH_PAD），否则角袋的圆形开孔
  //  正好被台布边界切掉 3/4，铜口在画面上只剩一段 C 形弧 —— 这是之前
  //  "袋口看起来缺一块"的真正原因。多出来的部分压在胶边/木框下面，看不到。
  //  必须 >= 袋口半径，否则袋口的圆开孔会跨出台布边界，
  //  三角化后在洞内露出一条绿色带（贴着外角尤其明显）。
  const CLOTH_PAD = 0.086;
  const chx = hx + CLOTH_PAD;
  const chy = hy + CLOTH_PAD;
  const clothShape = new THREE.Shape();
  clothShape.moveTo(-chx, -chy);
  clothShape.lineTo(chx, -chy);
  clothShape.lineTo(chx, chy);
  clothShape.lineTo(-chx, chy);
  clothShape.closePath();
  for (const p of pocketCenters) {
    const path = new THREE.Path();
    path.absarc(p.x, p.y, p.mr, 0, Math.PI * 2, true);
    clothShape.holes.push(path);
  }
  const clothGeo = new THREE.ShapeGeometry(clothShape, 18);
  // ShapeGeometry 的 UV 默认是世界坐标，重映射到 0..1 才能用球台空间的底色贴图
  {
    const pos = clothGeo.attributes.position;
    const uv = clothGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      // 底色贴图按"含 padding 的台布"铺满 0..1，保证灯斑位置不因 padding 偏移
      uv.setXY(i, pos.getX(i) / (2 * chx) + 0.5, pos.getY(i) / (2 * chy) + 0.5);
    }
    uv.needsUpdate = true;
  }
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.rotation.x = -Math.PI / 2;
  cloth.receiveShadow = true;
  group.add(cloth);

  // ---------------- 石板
  //  石板必须跟着台布一起挖洞：否则它的顶面（y ≈ -0.002）正好横在袋口下方，
  //  往下看时看到的是被照亮的石板灰面 —— 这就是袋口"发灰、像水泥"的原因。
  const slateShape = new THREE.Shape();
  slateShape.moveTo(-(hx + 0.015), -(hy + 0.015));
  slateShape.lineTo(hx + 0.015, -(hy + 0.015));
  slateShape.lineTo(hx + 0.015, hy + 0.015);
  slateShape.lineTo(-(hx + 0.015), hy + 0.015);
  slateShape.closePath();
  for (const p of pocketCenters) {
    const path = new THREE.Path();
    path.absarc(p.x, p.y, p.mr * 0.995, 0, Math.PI * 2, true);
    slateShape.holes.push(path);
  }
  const slateGeo = new THREE.ExtrudeGeometry(slateShape, {
    depth: T.slateThickness, bevelEnabled: false, curveSegments: 20,
  });
  const slate = new THREE.Mesh(
    slateGeo,
    new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 0.9 })
  );
  // ExtrudeGeometry 沿 +z 挤出；绕 X 轴 +90° 后 z→-y，厚度朝下（在台布之下）。
  //  注意符号：用 -π/2 的话厚度会朝上，石板会盖住台布（整张桌子变成一块灰板）。
  slate.rotation.x = Math.PI / 2;
  slate.position.y = -0.006;
  group.add(slate);

  // ---------------- 材质
  //  木框：暖色胡桃木。color 不再乘一层橘色（会过饱和成"塑料橘"），
  //  让 map 自己的木纹决定颜色，clearcoat 只负责漆面高光。
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: TEX.wood,
    roughness: 0.34,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.16,
    color: 0xffffff,
    envMapIntensity: 1.0,
  });
  // 台面木压条：略亮一档的暖木色，让顶面在灯下能读出"胡桃木"而不是黑块
  const woodTopMat = new THREE.MeshPhysicalMaterial({
    map: TEX.wood,
    color: 0xfff0de,
    roughness: 0.30,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.10,
    envMapIntensity: 1.25,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xffcf7a, roughness: 0.19, metalness: 1.0, envMapIntensity: 1.6,
  });
  const pearlMat = new THREE.MeshStandardMaterial({
    color: 0xf3e8c6, roughness: 0.22, metalness: 0.25,
    emissive: 0x1a1408, emissiveIntensity: 0.35,
  });
  // 胶边：比台布深一档的绿，才有"绒布立起来"的体积感
  const cushionMat = new THREE.MeshStandardMaterial({
    color: 0x1a5a41, roughness: 1.0, metalness: 0, envMapIntensity: 0.06,
  });

  // ---------------- 木框：按袋口切成若干段（与物理几何一致）
  //  注意 ceV / cesV 只是"视觉退让"：让木框在袋口处再退一点，给黄铜口和
  //  角袋铸件腾出位置。物理用的 ce / ces（CONFIG.table）完全不动。
  const VIS_RECESS = 0.000;
  const ceV = ce + VIS_RECESS;
  const cesV = ces + VIS_RECESS;
  const segs = [];
  for (const sy of [1, -1]) {
    const zc = sy * (hy + rw / 2);
    const len = (hx - ceV) - sg;
    segs.push({ cx: -sg - len / 2, cz: zc, w: len, d: rw });
    segs.push({ cx: sg + len / 2, cz: zc, w: len, d: rw });
  }
  for (const sx of [1, -1]) {
    const xc = sx * (hx + rw / 2);
    const len = (hy - cesV) * 2;
    segs.push({ cx: xc, cz: 0, w: rw, d: len });
  }
  for (const s of segs) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, railTopY + 0.05, s.d), woodMat);
    body.position.set(s.cx, (railTopY - 0.05) / 2, s.cz);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    // 台面上沿倒角（略窄一点，做出高光棱线）
    const top = new THREE.Mesh(new THREE.BoxGeometry(s.w - 0.012, 0.012, s.d - 0.012), woodTopMat);
    top.position.set(s.cx, railTopY - 0.002, s.cz);
    top.castShadow = true; top.receiveShadow = true;
    group.add(top);
  }

  // ---------------- 胶边（cushion rubber）
  const shadowStripMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1, transparent: true, opacity: 0.55,
  });
  // 真实台球胶边的截面（从台外往台内看）：
  //   鼻线（nose）是最靠台内的一条棱，但它只到球心高度附近；
  //   鼻线以下向"台外"退让，形成一个让球能贴住的空间。
  //  如果做成一个竖直的立方体，球贴库时下半部分会整片被挡住 ——
  //  看起来就像球嵌进了胶边（这正是用户截图里的现象）。
  const noseH = 0.0415;        // 鼻线高度 ≈ 0.73 球径（真台 63%）
  const cw = 0.055;            // 胶边厚度（全部在库边线外侧）
  const undercut = 0.010;      // 鼻线下方向台外退让的深度

  function cushionSegment(px, py, px2, py2, nx, ny) {
    const len = Math.hypot(px2 - px, py2 - py);
    const g = new THREE.Group();

    // 用 ExtrudeGeometry 做真正的斜面截面：
    //   局部 x：0 = 鼻线（最靠台内），-cw = 靠木框
    //   局部 y：0 = 台布平面，noseH = 鼻线顶
    //   截面关键点：底部从 x=-cw 起，向台内倾斜到鼻线下方 -undercut 处，
    //   再从那里竖直上到鼻线顶 —— 于是鼻线以下有一个"倒角"，球不会被挡住。
    const shape = new THREE.Shape();
    shape.moveTo(-cw, 0);
    shape.lineTo(-undercut, 0);          // 底部平段（贴台布）
    shape.lineTo(0, noseH * 0.72);       // 下斜面向鼻线过渡
    shape.lineTo(0, noseH);              // 鼻线竖直段
    shape.lineTo(-cw, noseH * 0.86);     // 顶面往台外微微下斜
    shape.lineTo(-cw, 0);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: len, bevelEnabled: false, curveSegments: 1,
    });
    geo.translate(0, 0, -len / 2);
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, cushionMat);
    g.add(body);

    // 鼻线上沿的一道细高光棱（打磨感）
    const bevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.0035, 0.0022, len), cushionMat
    );
    bevel.position.set(-0.0015, noseH - 0.001, 0);
    g.add(bevel);

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const t = new THREE.Vector3((px2 - px) / len, 0, -(py2 - py) / len);
    const n = new THREE.Vector3(nx, 0, -ny);
    const up = new THREE.Vector3(0, 1, 0);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(n, up, t));
    g.position.set(px + (px2 - px) / 2, 0.0005, -(py + (py2 - py) / 2));
    return g;
  }

  //  胶边端点必须停在"袋角"（jaw tip）上，而不是一路顶到台布外角：
  //  顶到外角会把角袋的圆弧切掉一大块（看起来像铜口缺一角）。
  //  ceJ/cesJ 是从 jaw 位置再往里让 1 个小半径，让出铜口的厚度。
  //  胶边端点直接由袋口铜圈的"外沿"反算，而不是用固定的 ce/ces：
  //  hx - (铜圈外沿) - 一点余量。这样只要调整袋口半径/内缩量，
  //  胶边永远自动让开铜圈，不会再出现"铜口被啃掉一块"。
  const CORNER_RING_OUT = 0.070 * 1.035 + 0.0052;
  const ceJ = hx - ((hx - 0.056) - CORNER_RING_OUT - 0.0015);
  const cesJ = hy - ((hy - 0.056) - CORNER_RING_OUT - 0.0015);
  for (const sy of [1, -1]) {
    const nY = -sy;
    group.add(cushionSegment(-(hx - ceJ), sy * hy, -sg, sy * hy, 0, nY));
    group.add(cushionSegment(sg, sy * hy, hx - ceJ, sy * hy, 0, nY));
  }
  const halfLen = hy - cesJ;
  group.add(cushionSegment(hx, -halfLen, hx, halfLen, -1, 0));
  group.add(cushionSegment(-hx, -halfLen, -hx, halfLen, 1, 0));

  // ---------------- 袋口
  //  目标：深黑洞 + 一圈清晰黄铜。
  //   1) 旧版斜切包角盒子正压在袋口上，把铜圈咬掉一块 → 包角挪到台面外角
  //   2) 内衬 0x0a0d10 在灯下反灰光，像灰色圆盘 → 近黑 + roughness 1
  //   3) 井只有 0.19 深，能看到井底边缘 → 加深到 0.34，底部收窄成锥
  const pocketGroup = new THREE.Group();
  //  内衬用 MeshBasicMaterial（无光照）：真实的袋井里光是进不去的，
  //  任何 PBR 材质都会在灯的直射下反出灰调，这里是"纯黑洞"的唯一正确做法。
  const linerMat = new THREE.MeshBasicMaterial({
    color: 0x000000, side: THREE.DoubleSide,
  });
  const pocketFloorMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffce78, roughness: 0.16, metalness: 1.0,
    emissive: 0x2a1a05, emissiveIntensity: 0.55, envMapIntensity: 1.9,
  });

  for (const p of pocketCenters) {
    const mr = p.mr;
    const THROAT = 0.34;

    // 深井：从洞沿往下收窄，越深越黑。
    //  起始半径略大于洞口（mr*1.02），保证从任何角度看进去都只看到黑色内壁，
    //  不会在洞口下沿露出一圈"被照亮的台布/石板边"。
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(mr * 1.02, mr * 0.45, THROAT, 44, 1, true),
      linerMat
    );
    liner.position.set(p.x, -THROAT / 2 - 0.003, -p.y);
    pocketGroup.add(liner);

    // 井底（纯黑），压在最深处，看不到边缘
    const floor = new THREE.Mesh(new THREE.CircleGeometry(mr * 0.50, 28), pocketFloorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(p.x, -THROAT - 0.0025, -p.y);
    pocketGroup.add(floor);

    // 洞沿内缘：极窄的暗环（贴台布高度），收住台布开孔的硬边
    const throatLip = new THREE.Mesh(
      new THREE.CylinderGeometry(mr * 1.006, mr * 1.006, 0.008, 48, 1, true),
      linerMat
    );
    throatLip.position.set(p.x, -0.003, -p.y);
    pocketGroup.add(throatLip);

    // 黄铜包边：坐在台布高度、紧贴洞沿的实心铜环（真实球台的铜口就在这个高度）。
    //  这样它天然贴合洞沿，不会像放在木框顶面那样"悬空"。
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(mr * 1.035, 0.0052, 14, 72), rimMat
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.0022, -p.y);
    ring.castShadow = true;
    pocketGroup.add(ring);
    // 铜环上沿一圈更细的高光棱，做出"打磨倒角"
    const ringHi = new THREE.Mesh(
      new THREE.TorusGeometry(mr * 1.035, 0.0014, 8, 72), brassMat
    );
    ringHi.rotation.x = Math.PI / 2;
    ringHi.position.set(p.x, 0.0062, -p.y);
    pocketGroup.add(ringHi);

    // 袋口铸件：一块木质圆盘，把台布在袋口一带的"外扩补边"遮住。
    //  台布为了让开孔是完整的圆，必须铺到袋口之外；这圈木盘正好盖住它，
    //  看起来就是真实球台那圈厚实的包角铸件。内径让开铜圈，铜口从上方完全可见。
    const castIn = mr * 1.035 + 0.0052 + 0.0022;
    // 铸件只比洞口大一圈，不要做成粗大的木环（会从台面凸出来像垫圈）
    const castOut = mr + 0.019;
    const castTopY = railTopY - 0.0022;
    const castDisc = new THREE.Mesh(
      new THREE.RingGeometry(castIn, castOut, 72, 1),
      woodTopMat
    );
    castDisc.rotation.x = -Math.PI / 2;
    castDisc.position.set(p.x, castTopY, -p.y);
    castDisc.receiveShadow = true;
    pocketGroup.add(castDisc);
    // 铸件外沿垂到台布高度，把补边包住（高度只到台布，不要高出木框顶面）
    const castSkirt = new THREE.Mesh(
      new THREE.CylinderGeometry(castOut, castOut, castTopY, 72, 1, true),
      woodMat
    );
    castSkirt.position.set(p.x, castTopY / 2, -p.y);
    castSkirt.castShadow = true; castSkirt.receiveShadow = true;
    pocketGroup.add(castSkirt);
    // 铸件内壁：从铜圈往下到台布，是一小段木色斜壁
    const castWall = new THREE.Mesh(
      new THREE.CylinderGeometry(castIn, mr * 1.02, castTopY, 72, 1, true),
      woodMat
    );
    castWall.position.set(p.x, castTopY / 2, -p.y);
    pocketGroup.add(castWall);

  }
  group.add(pocketGroup);

  // ---------------- 库边菱形标记（母球/瞄准参考点，真实球台都有）
  const diamondGeo = new THREE.CircleGeometry(0.0052, 12);
  const addDiamond = (x, y) => {
    const d = new THREE.Mesh(diamondGeo, pearlMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, railTopY + 0.0006, -y);
    group.add(d);
  };
  for (const sy of [1, -1]) {
    const zc = sy * (hy + rw * 0.5);
    for (const frac of [-0.66, -0.33, 0.33, 0.66]) {
      addDiamond(hx * frac * 1.28, zc);
    }
  }
  for (const sx of [1, -1]) {
    const xc = sx * (hx + rw * 0.5);
    for (const frac of [-0.5, 0, 0.5]) addDiamond(xc, hy * frac * 0.66);
  }

  // ---------------- 台脚
  const legW = 0.16;
  const legH = CONFIG.table.bedHeight - 0.10;
  const legGeo = new THREE.BoxGeometry(legW, legH, legW * 1.06);
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(sx * (hx - 0.26), -T.slateThickness - legH / 2 - 0.03, sy * (hy - 0.10));
      leg.castShadow = true;
      group.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.032, 20), brassMat);
      foot.position.set(leg.position.x, -T.slateThickness - legH - 0.03 + 0.016, leg.position.z);
      group.add(foot);
    }
  }

  // ---------------- 桌沿铜条
  const trimLen = (hx - ce) - sg;
  for (const sy of [1, -1]) {
    for (const s2 of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(trimLen, 0.005, 0.006), brassMat);
      tr.position.set(s2 * (sg + trimLen / 2), railTopY - 0.058, sy * (hy + rw));
      group.add(tr);
    }
  }

  scene.add(group);
  return { group, woodMat, woodTopMat, cloth, railTopY, pocketCenters };
}
// ---------------------------------------------------------------------------
// 球
// ---------------------------------------------------------------------------
export function createBallMesh(num, TEX) {
  const geo = new THREE.SphereGeometry(R, 64, 48);
  // 关键：SphereGeometry 的极点沿 +Y，贴图的"赤道"（号码圈所在纬度）
  // 正好落在水平面上，而相机是从上往下看——看到的是极区，那里只有纯色。
  // 8 号球于是变成一颗纯黑的球（用户反馈"找不到黑 8"）。
  // 把几何整体绕 X 轴转 90°，让赤道正对上方，号码圈一眼可见。
  geo.rotateX(Math.PI / 2);
  const map = TEX.balls[num];
  //  酚醛树脂球的两个特征，缺一个就"发平"：
  //   1) 极低的 roughness → 高光是紧致的小亮点，而不是糊满面的大白斑
  //   2) clearcoat 两层反射（漆面 + 本体）→ 边缘有一圈菲涅尔亮边
  //  同时把 envMapIntensity 往下压：环境贴图是明亮室内，过高会整体泛白（wash out）。
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    roughness: num === 0 ? 0.075 : 0.055,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.028,
    reflectivity: 0.52,
    envMapIntensity: 0.62,
    color: 0xffffff,
    specularIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'ball' + num;
  return mesh;
}

// ---------------------------------------------------------------------------
// 灯光：三灯吊灯 + 环境
// ---------------------------------------------------------------------------
export function buildLights(scene, TEX) {
  const T = CONFIG.table;
  const hx = T.length / 2;
  const group = new THREE.Group();

  // 极低的底光，只用来避免死黑，不参与造型
  scene.add(new THREE.AmbientLight(0x16202c, 0.16));
  const hemi = new THREE.HemisphereLight(0xb9cdea, 0x05070a, 0.07);
  scene.add(hemi);

  // 主光：三盏吊灯，逼真台球厅就是这种"局部强光 + 周围很暗"
  const lampY = 1.55;
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x0d1013, metalness: 0.9, roughness: 0.4,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e6, emissive: 0xfff0cc, emissiveIntensity: 3.2, roughness: 0.5,
  });

  for (let i = -1; i <= 1; i++) {
    const x = i * (hx * 0.60);

    // decay=1.9 略低于物理 2，让三盏灯的覆盖在长边上更连贯（减少中间的死带）；
    // 同时也让"台心亮、库边暗"的落差不至于变成"三块孤立的亮斑"。
    const spot = new THREE.SpotLight(0xfff1dd, 18, 4.9, Math.PI * 0.40, 0.72, 1.7);
    spot.position.set(x, lampY, 0);
    spot.target.position.set(x, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(CONFIG.render.shadowMapSize, CONFIG.render.shadowMapSize);
    spot.shadow.camera.near = 0.5;
    spot.shadow.camera.far = 4.5;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.0045;
    // 柔化阴影边缘：radius/blurSamples 只在 VSM/PCFSoft 下生效，
    // 加大到 6/16 后球的影子从"硬饼"变成有过渡的软影。
    spot.shadow.radius = 6;
    spot.shadow.blurSamples = 16;
    scene.add(spot);
    scene.add(spot.target);

    // 灯具（跑车灯罩样式）
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.115, 0.075, 4, 1, true),
      lampMat
    );
    shade.rotation.y = Math.PI / 4;
    shade.position.set(x, lampY + 0.045, 0);
    shade.material.side = THREE.DoubleSide;
    faceDown(shade);
    group.add(shade);

    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.10, 28), bulbMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(x, lampY + 0.010, 0);
    group.add(bulb);

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.62, 8), lampMat);
    rod.position.set(x, lampY + 0.36, 0);
    group.add(rod);
  }

  // 侧向补光：让球有立体感（球的边缘轮廓光）
  //  两盏方向光故意压低，避免把台面"匀光"成一片；它们的作用只是给球边缘
  //  一点点冷暖分离（左冷右暖），这是"昂贵感"的关键细节。
  const rim1 = new THREE.DirectionalLight(0xa9c6ff, 0.34);
  rim1.position.set(-1.6, 1.4, 1.2);
  scene.add(rim1);
  const rim2 = new THREE.DirectionalLight(0xffcf9a, 0.20);
  rim2.position.set(1.8, 1.0, -1.4);
  scene.add(rim2);

  scene.add(group);
  return { group, lampY, lamps: group };
}

/** 把开口朝下的灯罩翻正（几何体默认朝 +y） */
function faceDown(mesh) {
  mesh.scale.y = -1;
}

// ---------------------------------------------------------------------------
// 房间：地板 + 背景墙（营造台球厅氛围）
// ---------------------------------------------------------------------------
export function buildRoom(scene, TEX) {
  const group = new THREE.Group();

  const floorMat = new THREE.MeshStandardMaterial({
    map: TEX.floor,
    roughness: 0.35,
    metalness: 0.02,
    color: 0x8a8a8a,
    envMapIntensity: 0.5,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -CONFIG.table.bedHeight + 0.055;
  floor.receiveShadow = true;
  group.add(floor);

  // 背景：暗色渐变（用大球体做环境，成本低效果好）
  const bgGeo = new THREE.SphereGeometry(14, 24, 16);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x0a0c10, side: THREE.BackSide, fog: false,
  });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.position.y = 1.5;
  group.add(bg);

  // 墙面灯带（远处一条暖光，增加空间感）
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
  for (const s of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.02, 0.02), stripMat);
    strip.position.set(0, 0.9, s * 5.2);
    group.add(strip);
  }

  scene.add(group);
  return group;
}

// ---------------------------------------------------------------------------
// 球杆
// ---------------------------------------------------------------------------
export function buildCue(TEX) {
  const group = new THREE.Group();
  const L = 1.45;

  // 主杆：从杆头（tip）到杆尾
  const shaftMat = new THREE.MeshPhysicalMaterial({
    map: TEX.cueWood,
    color: 0xe8d3b0,
    roughness: 0.25,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.0,
  });
  const buttMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b1a10,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.0,
  });

  // 杆身：两段锥形
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0082, 0.0172, L * 0.72, 20), shaftMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(L * 0.36, 0, 0);
  group.add(shaft);

  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0172, 0.0192, L * 0.28, 20), buttMat);
  butt.rotation.z = Math.PI / 2;
  butt.position.set(L * 0.86, 0, 0);
  group.add(butt);

  // 皮头（蓝）
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0078, 0.0082, 0.010, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a3a6b, roughness: 0.95 })
  );
  tip.rotation.z = Math.PI / 2;
  tip.position.set(0.004, 0, 0);
  group.add(tip);

  // 先角（白色）
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0082, 0.0084, 0.026, 16),
    new THREE.MeshPhysicalMaterial({ color: 0xf2ede0, roughness: 0.2, clearcoat: 1 })
  );
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.set(0.019, 0, 0);
  group.add(ferrule);

  // 接牙（金属环）
  const joint = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0176, 0.0176, 0.014, 18),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.25, metalness: 1 })
  );
  joint.rotation.z = Math.PI / 2;
  joint.position.set(L * 0.72, 0, 0);
  group.add(joint);

  // 尾胶垫
  const bumper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0192, 0.0176, 0.020, 18),
    new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.8 })
  );
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(L * 0.995, 0, 0);
  group.add(bumper);

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}
