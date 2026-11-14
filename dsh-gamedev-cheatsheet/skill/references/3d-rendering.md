# 3D & rendering · 3D 与渲染

> 3D 场景怎么变成像素，以及怎么少画。

> 8 个概念 ｜ 返回 [总索引](./index.md) ｜ 下一章 [Game feel · 手感](./game-feel.md)

## 本章目录

01. [Raycasting · 射线检测](#raycasting) — 问一条线撞到了什么
02. [Normals · 法线](#normals) — 表面到底朝向哪边
03. [Level of detail · 细节层级](#level-of-detail) — 离得远就换低模
04. [Frustum culling · 视锥剔除](#frustum-culling) — 相机看不见就跳过
05. [Fragment shader · 片元着色器](#fragment-shader) — 每个像素跑一个小程序
06. [Billboarding · 面向相机](#billboarding) — 永远转身面向相机
07. [Quaternions · 四元数](#quaternions) — 旋转永远走最短路径
08. [Z-fighting · Z 冲突](#z-fighting) — 两个表面抢同一批像素

---

<a id="raycasting"></a>

## 01 · Raycasting · 射线检测

> *问一条线撞到了什么* ｜ `ask a line what it hits`

raycast 从某个点沿某个方向发出一条不可见的线，返回它碰到的第一个物体。结果里有命中点、距离和表面法线，也就是演示里的粉点和黄色箭头。游戏里常用它做 hitscan 枪械、视线判断、鼠标拾取和地面检测。

**展开说**：射线从起点沿方向发射，只返回最近的一个命中结果：命中点、距离、表面法线。它是一瞬间的查询，不会推着刚体走，也不自动结算伤害——这些要你自己接。

**什么时候用**：用 raycast 实现 hitscan 武器、地面探测，或选中光标下的单位。ray 没有厚度：当投射物或角色需要留出通过间隙时，改用 shape cast。

**什么时候别用**：需要「有体积、有宽度」的检测（角色钻缝、粗子弹擦边）时，用 shape cast / sphere cast 而不是一条线。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-01)）

```text
Use a raycast for hit detection: cast from the muzzle along the aim direction with a max distance of 100 units and a layer mask that skips the shooter, take the closest hit, and use its point and surface normal to place the impact effect.
```

**伪代码**（引擎无关，按需换成 API）

```text
direction = normalize(target - origin)
hit = world.raycast(origin, direction, maxDistance, collisionMask)
if hit:
  placeImpact(hit.point, hit.normal)
```

**常见错误**：保持方向向量归一化，设置有限距离，并排除射手自身。raycast 只是一次查询；它不会推动刚体，也不会自动结算伤害。

**关键参数**：maxDistance 100 units；layer mask 排除射手自己；地面探测长度略大于角色半高。

**相关概念**：[Normals](#normals) · [Tunneling](./systems.md#tunneling) · [Hitbox and hurtbox](./systems.md#hitbox-hurtbox)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="normals"></a>

## 02 · Normals · 法线

> *表面到底朝向哪边* ｜ `which way a surface faces`

normal 是垂直于表面向外的单位向量。光照会拿它和指向光源的方向比较，所以演示里 normal 朝向灯泡的面更亮。游戏逻辑也用同一个向量让物体从墙上弹开，以及区分地面和陡坡。

**展开说**：法线是垂直于表面的单位向量，光照用它算明暗，物理用它算反弹。同一份数据两用，所以归一化和朝向正确非常关键。地面判定通常不写 `position.y == 0`，而是看法线 up 分量是否大于 0.7（约 45°）。

**什么时候用**：用 surface normal 计算光照、给 decal 定向、让投射物反弹，或判断斜坡算不算地面。normal 和用来跟它比较的向量必须处在同一个坐标空间。

**什么时候别用**：法线只描述朝向，不含形变信息；软体、布料、程序化形变要重新计算或用法线贴图。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-02)）

```text
Use the surface normal from each collision or raycast hit: reflect the velocity around it for bounces, and count a surface as walkable floor only when the normal's up component is above 0.7, which is about 45 degrees.
```

**伪代码**（引擎无关，按需换成 API）

```text
normal = normalize(hit.worldNormal)
walkable = dot(normal, worldUp) >= cos(maxSlopeAngle)
bounce = velocity - 2 * dot(velocity, normal) * normal
```

**常见错误**：位置向量不是 normal。在非等比缩放下，要用 normal matrix 的逆转置来变换 normal，然后再归一化一次。

**关键参数**：可站立坡面：normal.up > 0.7（≈45°）；反射速度：v - 2·dot(v,n)·n。

**相关概念**：[Raycasting](#raycasting) · [Fragment shader](#fragment-shader) · [Z-fighting](#z-fighting)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="level-of-detail"></a>

## 03 · Level of detail · 细节层级

> *离得远就换低模* ｜ `cheap mesh when it is far`

Level of detail（LOD）会在模型离相机越远时换成更简单的版本。远处的物体只占几个像素，完整 mesh 多出来的三角形根本看不出来，只会白耗 GPU。演示里的石头每越过一条距离线，就从 1280 个三角形降到 80 个，再降到 20 个。

**展开说**：LOD 按屏幕占比或距离把模型换成低面数版本。远处物体只占几个像素，多出来的三角面纯粹是浪费。有效果的关键不是切换本身，而是切换不被人看见——距离阈值之间要有滞回。

**什么时候用**：当细节丰富的 mesh 在屏幕上变得很小时使用 LOD。最佳阈值取决于投影后的尺寸、camera field of view，以及需要保留的轮廓。

**什么时候别用**：物体本身很小、或面数本来就很低时，LOD 的切换抖动比省下的开销更亏。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-03)）

```text
Add LOD to the props: build three versions at about 100%, 30% and 10% of the triangles, switch between them at set camera distances, and add a 10% hysteresis band so a mesh standing near a threshold does not flicker between levels.
```

**伪代码**（引擎无关，按需换成 API）

```text
if distance > farThreshold + margin: level = LOW
else if distance < farThreshold - margin: level = MEDIUM
setVisibleMesh(level)
```

**常见错误**：隐藏的高细节 mesh 不应该继续跑昂贵的动画或 CPU 更新。也要检查阴影和切换：轮廓差异很大的低模切过去会明显 pop。

**关键参数**：三档 ≈100% / 30% / 10% 面数；切换加 10% 滞回带；阴影用独立（更激进）的 LOD 距离。

**相关概念**：[Frustum culling](#frustum-culling) · [Draw calls](./performance.md#draw-calls) · [Frame budget](./performance.md#frame-budget)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="frustum-culling"></a>

## 04 · Frustum culling · 视锥剔除

> *相机看不见就跳过* ｜ `skip what the camera cannot see`

frustum 是相机能看到的那部分世界，形状像被削掉尖端的金字塔。frustum culling 用每个物体的 bounding volume 和它做测试，跳过外面的物体，让 GPU 完全不去处理。演示里相机转动时，只有青色楔形内的箱子会被实心绘制。

**展开说**：视锥就是相机能看见的那块「金字塔削尖」的空间。每帧用相机投影×视图矩阵构建视锥，再拿物体的包围球/包围盒去测：完全在外面的，连 draw 和动画更新都可以跳过。

**什么时候用**：用 frustum culling 跳过相机视野之外的渲染工作。它不同于 occlusion culling——后者还会尝试跳过被其他物体挡住的物体。

**什么时候别用**：几千个物体时逐个测视锥本身也会变成 CPU 开销，要配合空间划分或 GPU culling。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-04)）

```text
Add frustum culling: each frame, build a frustum from the camera's projection and view matrices, test each object's bounding sphere against it, and skip both the draw and the animation update for objects fully outside.
```

**伪代码**（引擎无关，按需换成 API）

```text
frustum = extractPlanes(projection * view)
for object in scene:
  if frustum.intersects(object.worldBounds):
    draw(object)
```

**常见错误**：物体 origin 可能在屏幕外，但 mesh 仍有一部分可见。要用保守的 bounds 做测试，并在动画或程序化几何变化时更新这些 bounds。

**关键参数**：用包围球（比 AABB 便宜、旋转无关）；动画物体用蒙皮包围盒或保守半径。

**相关概念**：[Level of detail](#level-of-detail) · [Spatial partitioning](./performance.md#spatial-partitioning) · [Draw calls](./performance.md#draw-calls)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="fragment-shader"></a>

## 05 · Fragment shader · 片元着色器

> *每个像素跑一个小程序* ｜ `a tiny program per pixel`

fragment shader 是 GPU 为表面上每个像素各跑一次的小程序，用来决定这个像素的颜色。每次运行都有自己的输入，比如 UV 坐标和时间，成千上万次运行并行发生。演示里的放大镜把像素显示成方块，每个方块都是一次独立运行的结果。

**展开说**：片元着色器的执行单元是「像素」而不是「物体」：每个被覆盖的像素跑一次同样的程序，拿到自己的 UV、法线、时间，输出颜色。成千上万次并行，所以里面不能写重循环。

**什么时候用**：fragment shader 适合表面花纹、溶解、着色，以及可以按每个 fragment 独立计算的效果。fragment 是一个候选像素贡献；最终画面由 depth test 和 blending 决定。

**什么时候别用**：只是换颜色/贴图用材质参数就够；全屏后处理才用片元。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-05)）

```text
Write this effect as a GLSL fragment shader: compute each pixel's colour from its UV and a uTime uniform, and expose speed, scale and colours as uniforms so they can be tuned without touching the shader code.
```

**伪代码**（引擎无关，按需换成 API）

```text
vec2 uv = vUv;
float wave = 0.5 + 0.5 * sin(uv.x * uScale + uTime);
vec3 color = mix(uColorA, uColorB, wave);
fragColor = vec4(color, 1.0);
```

**常见错误**：看起来便宜的效果，铺满全屏或被反复绘制时也会很贵。在增加更多数学运算之前，先检查 texture sample、透明度和 overdraw。

**关键参数**：把 speed / scale / 颜色暴露成 uniform；避免在循环里采样贴图；移动端注意精度。

**相关概念**：[Normals](#normals) · [Overdraw](./performance.md#overdraw) · [Texture atlas](./performance.md#texture-atlas)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="billboarding"></a>

## 06 · Billboarding · 面向相机

> *永远转身面向相机* ｜ `always turn to face the camera`

billboard 是一块每帧都旋转到面向相机的平面 quad。血条、伤害数字、名字标签和远处的树都是 billboard，所以从任何角度看都一样清楚。演示里左边的血条固定在角色身上，会侧过去甚至镜像，右边的始终可读。

**展开说**：公告板是一块每帧转正对相机的 quad。血条、名字、伤害数字靠它保证任何角度都读得清；树、草丛这类立在地上的，只绕 Y 轴转，否则会「躺倒」。

**什么时候用**：billboard 适合浮动标签、伤害数字，以及始终朝向相机的 sprite。可以选择完全朝向相机的旋转，也可以选择只绕竖直轴的 upright billboard，用于树木或角色。

**什么时候别用**：需要正确遮挡和体积感的主体（角色、载具）不能用公告板，它没有厚度。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-06)）

```text
Make the health bars and name tags billboards: each frame, set each quad's world rotation to the camera's rotation so it faces the screen, and for trees and other upright sprites rotate only around the Y axis so they stay vertical.
```

**伪代码**（引擎无关，按需换成 API）

```text
label.worldRotation = camera.worldRotation
// Upright alternative:
direction = camera.position - tree.position
direction.y = 0
tree.lookAlong(normalize(direction))
```

**常见错误**：把世界空间的相机旋转直接复制到局部空间的子物体上，可能得到错误朝向。要计入 parent transform，并确认 quad 的 forward 轴。

**关键参数**：完整朝向：worldQuat = cameraQuat；竖直：只取 yaw；关掉继承父级缩放。

**相关概念**：[Quaternions](#quaternions) · [Particle system](./systems.md#particle-system) · [Overdraw](./performance.md#overdraw)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="quaternions"></a>

## 07 · Quaternions · 四元数

> *旋转永远走最短路径* ｜ `rotations that take the short way`

Euler 角把旋转存成绕 X、Y、Z 三个轴的三次转动，逐个数混合会把物体带上绕路。quaternion 用四个数表示同一个旋转，slerp 让两个朝向沿最短弧、以稳定速度混合。演示里两艘船在同样的两个朝向之间转向，船头的轨迹显示左边翻了 371°，右边则是一条干净的 143° 弧线。

**展开说**：四元数用 4 个数表示旋转，组合是乘法，插值是 slerp。它天然走最短弧——当两个四元数点积为负时先取反一个，否则会绕 371° 的远路。欧拉角只用来显示和编辑器输入。

**什么时候用**：quaternion 用于相机转向、骨骼动画和 3D 朝向的混合。它表示朝向，而 angular velocity 描述的是朝向变化有多快。

**什么时候别用**：2D 里只有单轴旋转，直接用角度就够；不必为了「正确」硬上四元数。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-07)）

```text
Store rotations as quaternions, combine them by multiplication, interpolate with slerp and negate one of the two when their dot product is below 0 so it takes the short way, and convert to Euler angles only for display or editor input.
```

**伪代码**（引擎无关，按需换成 API）

```text
a = normalize(startRotation)
b = normalize(targetRotation)
if dot(a, b) < 0: b = -b
rotation = slerp(a, b, clamp(elapsed / duration, 0, 1))
```

**常见错误**：quaternion 乘法有顺序依赖。累积数值漂移后要重新归一化，也不要把四个分量当成四个独立角度。

**关键参数**：dot(q1,q2) < 0 时 q2 = -q2；旋转速度用 quaternion slerp 而非 lerp；每步后归一化。

**相关概念**：[Billboarding](#billboarding) · [Easing](./game-feel.md#easing) · [Normals](#normals)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

<a id="z-fighting"></a>

## 08 · Z-fighting · Z 冲突

> *两个表面抢同一批像素* ｜ `two surfaces fighting for pixels`

Z-fighting 是两个表面处在同一深度时出现的闪烁：depth buffer 的舍入会逐像素决定谁可见。depth buffer 的精度大部分花在 near plane 附近，所以 near plane 用 0.01 而不是 0.1，远处表面可用的精度就少了十倍。左边黄色 decal 正好贴在地面上，碎成闪烁的条纹；右边用 polygon offset 把它往相机方向拉了一点，就稳定了。

**展开说**：两个面深度几乎相同，深度缓冲的舍入误差让「谁在前面」逐像素跳动，于是闪烁条纹。深度精度在近平面附近最高，所以近平面从 0.1 改成 0.01，远处精度会掉约 10 倍。

**什么时候用**：对于画在已有表面上的 decal，用 polygon offset 或很小的几何偏移。尽可能收紧相机的 near plane 和 far plane，以提高 depth precision。

**什么时候别用**：不是所有闪烁都是 z-fighting——先确认是不是透明排序或 LOD 切换造成的。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-08)）

```text
Set the camera near plane as far out as the game allows, about 0.1, and the far plane as close as the view distance allows, never put two visible surfaces in the same plane, and lift decals about 1 cm along the surface normal or draw them with polygon offset, factor -1 and units -4.
```

**伪代码**（引擎无关，按需换成 API）

```text
camera.near = 0.1
camera.far = requiredViewDistance
decal.position = hit.point + hit.normal * smallOffset
// Alternatively configure the material’s depth/polygon offset.
```

**常见错误**：把 near plane 推到极接近 0 会浪费 depth precision。偏移过大会让 decal 浮空；要针对具体 renderer 调参，并从掠射角检查。

**关键参数**：近平面 ≥ 0.1（能用多大用多大）；贴花沿法线抬 ~1 cm 或 polygonOffset(-1, -4)；同面几何合并。

**相关概念**：[Normals](#normals) · [Fragment shader](#fragment-shader) · [Frame budget](./performance.md#frame-budget)

**延伸阅读**：[Three.js manual](https://threejs.org/manual/)

---

---

← [总索引](./index.md) ｜ 下一章 → [Game feel · 手感](./game-feel.md)
