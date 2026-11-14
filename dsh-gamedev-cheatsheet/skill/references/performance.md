# Performance · 性能

> 16.67ms 花在哪，以及怎么少花。

> 7 个概念 ｜ 返回 [总索引](./index.md)

## 本章目录

28. [Frame budget · 帧预算](#frame-budget) — 每一毫秒都花在哪
29. [Draw calls · 绘制调用](#draw-calls) — 一次 draw call 四百个箱子
30. [Spatial partitioning · 空间划分](#spatial-partitioning) — 只测附近的东西
31. [Overdraw · 过度绘制](#overdraw) — 同一个像素反复着色
32. [Time slicing · 时间切片](#time-slicing) — 把活儿摊到多帧里
33. [Texture atlas · 贴图图集](#texture-atlas) — 一张贴图一次 draw call
34. [Chunk streaming · 分块加载](#chunk-streaming) — 只加载玩家附近

---

<a id="frame-budget"></a>

## 28 · Frame budget · 帧预算

> *每一毫秒都花在哪* ｜ `16.67 ms, and where it goes`

60 fps 下游戏每帧有 16.67 毫秒，input、game logic、physics 和 rendering 都要共享这段时间。一帧超时就会错过屏幕刷新，玩家看到的是卡顿。测出每个系统花了多久，先修最大的那个——比如演示里把帧推过红线的 physics 尖峰。

**展开说**：60fps 意味着一帧只有 16.67ms，输入、逻辑、物理、渲染全在里面分。先用 performance.now() 测出每块占多少，再优化最大的那块——而不是凭感觉猜。

**什么时候用**：用各系统的耗时定位哪部分工作超出了目标帧时长。要测有代表性的重场景和慢帧，而不是只测空关卡里的平均 FPS。

**什么时候别用**：不要在「还没测」的时候优化；也不要只看平均值，卡顿来自尖刺。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-28)）

```text
Before optimising, time input, update, physics and render every frame with performance.now(), show each one in milliseconds against the 16.67 ms budget for 60 fps, and optimise the largest one first.
```

**伪代码**（引擎无关，按需换成 API）

```text
start = now()
updateSimulation()
simulationMs = now() - start
start = now()
submitRendering()
renderSubmissionMs = now() - start
```

**常见错误**：CPU submission time 不等于 GPU execution time。有 GPU timing 就用 GPU timing，关注高百分位帧时间，并在同一场景下比较优化前后。

**关键参数**：16.67ms @60fps；8.3ms @120fps；33ms @30fps；看 p99 不看均值。

**相关概念**：[Draw calls](#draw-calls) · [Overdraw](#overdraw) · [Time slicing](#time-slicing)

---

<a id="draw-calls"></a>

## 29 · Draw calls · 绘制调用

> *一次 draw call 四百个箱子* ｜ `one call, four hundred crates`

draw call 是 CPU 告诉 GPU 去画一个 mesh，而 CPU 要为每一次调用花时间准备。instancing 用一次调用画出同一 mesh、同一 material 的许多副本，只额外提供一份位置和旋转列表。演示里同样 400 个箱子用两种方式绘制，调用数从 400 降到 1。

**展开说**：每次 draw call 都是 CPU 在准备数据、告诉 GPU 画什么，几百个箱子就是几百次准备。共享网格+材质的重复物体用 instancing 一次画完，静态且同材质的合并成一个网格。

**什么时候用**：对共享 geometry 和 material 的大量物体使用 instancing。把兼容对象合批，同时保留足够的可见性粒度，避免整批巨大的屏外组被画出来。

**什么时候别用**：物体数量本来就少、或每个材质都不同时，合批收益接近零；别为了合批破坏材质表现。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-29)）

```text
Use GPU instancing for repeated objects that share one mesh and one material, so each group renders in a single draw call with a per-instance transform buffer, and merge static meshes that share a material into one mesh.
```

**伪代码**（引擎无关，按需换成 API）

```text
for instance in visibleInstances:
  transforms.append(instance.worldMatrix)
instanceBuffer.upload(transforms)
drawInstanced(mesh, material, transforms.length)
```

**常见错误**：减少 draw call 并不自动减少三角形、shader 开销或透明 overdraw。先测出真正的瓶颈，并记住 material 切换会拆批。

**关键参数**：InstancedMesh（three.js）/ GPU Instancing（Unity）；静态合批；同材质同 shader 才能合。

**相关概念**：[Texture atlas](#texture-atlas) · [Frustum culling](./3d-rendering.md#frustum-culling) · [Frame budget](#frame-budget)

---

<a id="spatial-partitioning"></a>

## 30 · Spatial partitioning · 空间划分

> *只测附近的东西* ｜ `only test what is nearby`

把所有物体两两做碰撞检测，代价是物体数量的平方。这里 48 个物体每帧需要 1,128 次检测，1000 个物体就需要大约 500,000 次。spatial grid 按位置把物体分进格子，每个物体只和所在格及相邻格里的物体测试，在演示里用约 100 次检测找到了同样的重叠。

**展开说**：两两检测是 O(n²)：48 个物体 1128 次，1000 个就是 50 万次。空间网格把物体按位置分格，每帧只和同格及相邻 8 格的物体测，同样的重叠结果只要约 100 次。

**什么时候用**：用 grid 或 tree 缩小邻域查询和碰撞查询的范围。cell 大小要匹配物体尺寸和查询半径；不存在适用于所有游戏的最优尺寸。

**什么时候别用**：物体数量少（< 几十）时，网格维护的成本可能高于 brute force。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-30)）

```text
Use a uniform spatial grid for broad-phase collision with cells about twice the size of the largest object, rebuild it every frame, and test each object only against objects in its own cell and the 8 neighbouring cells.
```

**伪代码**（引擎无关，按需换成 API）

```text
cell = floor(position / cellSize)
grid[cell].add(object)
for neighborCell in cellsOverlapping(queryBounds):
  for candidate in grid[neighborCell]:
    runExactTest(candidate)
```

**常见错误**：grid 只是 broad phase，不是碰撞测试本身。要处理跨多个 cell 的物体，并在 narrow phase 之前对候选对去重。

**关键参数**：单元格 ≈ 最大物体尺寸的 2 倍；每帧重建或增量更新；大世界用四叉树/八叉树。

**相关概念**：[Hitbox and hurtbox](./systems.md#hitbox-hurtbox) · [Steering behaviors](./systems.md#steering-behaviors) · [Frustum culling](./3d-rendering.md#frustum-culling)

---

<a id="overdraw"></a>

## 31 · Overdraw · 过度绘制

> *同一个像素反复着色* ｜ `the same pixel, shaded again`

overdraw 是 GPU 在一帧里对同一个像素着色的次数。透明 sprite 挡不住后面的东西，所以烟雾堆叠的每一层都会被着色，而靠近相机的大 sprite 代价最高。overdraw 视图会统计每个像素上的层数，从一层显示为蓝色，到八层及以上显示为白色。

**展开说**：overdraw 是同一像素在一帧里被着色了几次。透明物体不遮挡后面，所以每层烟雾都要着色；靠近镜头的大 sprite 最贵。移动端 GPU 基本是填充率瓶颈，overdraw 是第一杀手。

**什么时候用**：当场景里有很多透明 sprite、烟雾层或 UI 表面时，用 overdraw view 诊断。大面积重叠的 quad 即使贴图看起来大部分是空的，也可能很贵。

**什么时候别用**：不透明的 early-z 会挡住后面的着色，主要盯透明层和全屏后处理。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-31)）

```text
Reduce overdraw from transparent particles: cap how many can overlap, keep each sprite small on screen, trim sprite quads tightly around their visible pixels, and render heavy effects like smoke to a half-resolution buffer.
```

**伪代码**（引擎无关，按需换成 API）

```text
for effect in visibleEffects:
  effect.maxParticles = qualityBudget
  effect.spriteBounds = tightBounds
renderHeavySmokeToHalfResolutionTarget()
compositeSmoke()
```

**常见错误**：alpha 为 0 不代表 fragment 处理就免费。收紧几何、减少重叠层数、降低特效分辨率，往往比单纯减少 draw call 数更有效。

**关键参数**：限制同屏透明层数；sprite 裁剪到可见像素；烟雾降到半分辨率；避免全屏透明面片。

**相关概念**：[Particle system](./systems.md#particle-system) · [Fragment shader](./3d-rendering.md#fragment-shader) · [Draw calls](#draw-calls)

---

<a id="time-slicing"></a>

## 32 · Time slicing · 时间切片

> *把活儿摊到多帧里* ｜ `spread the work across frames`

time slicing 把昂贵的工作分摊到多帧，而不是每帧全部跑一遍。这里 192 个 agent 被分成 8 个 bucket，每帧只有一个 bucket（代价条下方亮起的格子）重新选择目标，而所有 agent 每一帧都继续移动。60 fps 下每个 agent 现在每秒重新决策 7.5 次，而不是 60 次，帧时间也回到了 16.67 ms 预算以内。

**展开说**：把贵计算（AI 决策、寻路、目标选择）按索引分成 4–8 个 bucket，每帧只跑一个 bucket；移动和动画仍然每帧更新。192 个 agent 从每帧 60 次决策变成 7.5 次/秒，帧时间立刻回到预算内。

**什么时候用**：对不需要每帧运行的决策使用 time slicing，比如远处 AI 的规划。即时反应和移动仍然要保持 gameplay 需要的更新频率。

**什么时候别用**：响应要求高的单位（玩家近身的敌人）要单独放进每帧更新的桶，否则会被延迟。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-32)）

```text
Time-slice expensive AI updates by splitting agents into 4 to 8 buckets by index and running decisions like pathfinding or target selection for one bucket per frame, while movement and animation still update every frame.
```

**伪代码**（引擎无关，按需换成 API）

```text
bucket = frameIndex % bucketCount
for agent in agents:
  if agent.id % bucketCount == bucket:
    agent.chooseTarget()
  agent.move(dt)
```

**常见错误**：要测量分帧调度带来的响应延迟。紧急任务单独给预算，也不要让所有高开销 agent 都落在同一个 bucket 里。

**关键参数**：4–8 个 bucket；高优先级单位每帧跑；决策频率与 bucket 数成反比。

**相关概念**：[Frame budget](#frame-budget) · [A* pathfinding](./systems.md#pathfinding) · [Steering behaviors](./systems.md#steering-behaviors)

---

<a id="texture-atlas"></a>

## 33 · Texture atlas · 贴图图集

> *一张贴图一次 draw call* ｜ `one texture, one draw call`

texture atlas 把许多小图打包进一张大贴图，每个 sprite 记住自己那块区域的 UV 矩形。绑定的 texture 一变，GPU 就必须开新 batch，所以当 6 种 sprite 各自有贴图时，这 24 个 sprite 要花 22 次 draw call。打进同一张 atlas 后，同样 24 个 sprite、同样的顺序，只画 1 次。

**展开说**：贴图切换会让批处理中断：6 种 sprite 各自一张图，24 个 sprite 可能 22 次 draw call。把图打进一张 2048 图集，每个 sprite 记 UV 矩形，同样的 24 个 sprite 只要 1 次。

**什么时候用**：用 atlas 让多个 sprite 共享一次 texture binding。每个 sprite 在 UV 空间里存一个矩形，但能否合批仍取决于 material 和绘制顺序。

**什么时候别用**：超大/动态生成的贴图（地形、RT）不适合塞图集；注意 padding 防渗色。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-33)）

```text
Pack the sprites into one texture atlas, for example 2048 by 2048 with 2 px of padding around each sprite, store each sprite's UV rectangle in a JSON file, and draw every sprite that shares the atlas and shader in a single batch.
```

**伪代码**（引擎无关，按需换成 API）

```text
uvMin = sprite.pixelMin / atlasSize
uvMax = sprite.pixelMax / atlasSize
uv = mix(uvMin, uvMax, quadUV)
color = sample(atlas, uv)
```

**常见错误**：texture filtering 和 mipmap 可能采样到相邻 sprite。要向外扩 border pixel，并为你使用的 mip level 留足 padding；2 像素并不是万能保证。

**关键参数**：2048×2048；每 sprite 2px padding；UV 矩形存 JSON；图集不超过设备纹理上限。

**相关概念**：[Draw calls](#draw-calls) · [Fragment shader](./3d-rendering.md#fragment-shader) · [Particle system](./systems.md#particle-system)

---

<a id="chunk-streaming"></a>

## 34 · Chunk streaming · 分块加载

> *只加载玩家附近* ｜ `load only what is near the player`

chunk streaming 把大世界切成固定大小的 chunk，只在内存里保留玩家附近的那些——这里 98 个里保留 8 到 14 个，和 10,000 个 chunk 的世界所需数量相同。chunk 在实心圆内加载，只有到了更大的虚线圆外才卸载，所以玩家在 chunk 边界来回走不会触发重载。如果只用一个半径，同样的走动会在 2 秒内卸载并重载 8 次。

**展开说**：把大世界切成固定尺寸的块，只保留玩家附近的块（比如半径 2 块），异步加载、远处卸载。加载和卸载半径必须不同（滞回），否则玩家站在边界上会反复加载卸载。

**什么时候用**：用 chunk 让大世界的活跃内存和模拟都保持在玩家附近。chunk 数据异步构建，然后在合适的线程上激活 rendering 和 physics。

**什么时候别用**：小地图、单屏关卡不需要流式加载，直接一次载入更简单。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-34)）

```text
Stream the world in fixed-size chunks of 32 by 32 tiles, keep every chunk within 2 chunks of the player loaded, load new chunks asynchronously off the main thread, unload a chunk only once it is more than 3 chunks away so a player standing on a border does not cause reloads, and reuse chunk objects from a pool.
```

**伪代码**（引擎无关，按需换成 API）

```text
for chunk in chunksWithin(player, loadRadius):
  requestLoad(chunk)
for chunk in loadedChunks:
  if distance(player, chunk) > unloadRadius:
    requestUnload(chunk)
// Keep unloadRadius greater than loadRadius.
```

**常见错误**：不要卸载还有待保存数据或被相邻 chunk 引用的 chunk。激活工作也要计入预算：即使加载在后台线程，一次性创建大量对象仍可能造成帧尖峰。

**关键参数**：32×32 tiles；加载半径 2 块；卸载 > 3 块；异步加载；块对象走池。

**相关概念**：[Seeded noise](./systems.md#seeded-noise) · [Object pooling](./systems.md#object-pooling) · [Time slicing](#time-slicing)

---

---

← [总索引](./index.md) ｜ 下一章 → [回到 SKILL.md](./../SKILL.md)
