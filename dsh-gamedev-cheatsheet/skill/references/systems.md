# Systems · 系统

> 角色、战斗、移动、物理的代码骨架。

> 9 个概念 ｜ 返回 [总索引](./index.md) ｜ 下一章 [Performance · 性能](./performance.md)

## 本章目录

19. [Object pooling · 对象池](#object-pooling) — 只分配一次反复复用
20. [Finite state machine · 有限状态机](#state-machine) — 同一时间只有一个状态
21. [Hitbox and hurtbox · 判定框](#hitbox-hurtbox) — 什么打人什么挨打
22. [A* pathfinding · A* 寻路](#pathfinding) — 朝着目标找路的搜索
23. [Particle system · 粒子系统](#particle-system) — 一个发射器许多短命粒子
24. [Fixed timestep · 固定步长](#fixed-timestep) — 物理跑在稳定的时钟上
25. [Steering behaviors · 转向行为](#steering-behaviors) — 把速度慢慢推向目标
26. [Tunneling · 穿透](#tunneling) — 太快了直接穿墙而过
27. [Seeded noise · 种子噪声](#seeded-noise) — 同一个种子同一个世界

---

<a id="object-pooling"></a>

## 19 · Object pooling · 对象池

> *只分配一次反复复用* ｜ `allocate once, reuse forever`

object pool 会一次性创建固定数量对象并反复复用，而不是每颗子弹都新建一个。在 C# 或 JavaScript 里，每个被丢弃的对象都会变成 garbage，garbage collector 会暂停游戏来清理。上面那条道就被这些停顿卡住，而用 pool 的那条道一直在复用同样的 14 个槽位。

**展开说**：对象池一次分配固定数量，用时取、用完还，而不是每次发射子弹都 new 一个。C#/JS 里每次丢弃都会产生垃圾，GC 一停顿就是肉眼可见的卡顿。池必须有上限，耗尽时告警而不是偷偷 new。

**什么时候用**：对频繁 spawn/despawn 的对象（子弹、特效等）使用 object pool。要定好容量策略：拒绝 spawn、回收旧特效，或在非关键路径上扩容。

**什么时候别用**：数量少、生命周期长的对象（UI 面板、Boss）不需要池化，反而增加复杂度。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-19)）

```text
Use an object pool for bullets and particles: preallocate the peak count up front, take an inactive instance and reset its fields on spawn, mark it inactive on death instead of destroying it, and log a warning if the pool ever runs out.
```

**伪代码**（引擎无关，按需换成 API）

```text
bullet = pool.acquire()
if bullet:
  bullet.reset(position, velocity, lifetime)
  bullet.active = true
// On expiry:
pool.release(bullet)
```

**常见错误**：每个带状态的字段都要重置，包括 timer、target、listener 和视觉 flag。pooling 减少的是分配抖动，并不会让更新或绘制活跃对象变成免费。

**关键参数**：预分配峰值数量；spawn 时重置全部字段；耗尽告警；归还置 inactive。

**相关概念**：[Particle system](#particle-system) · [Frame budget](./performance.md#frame-budget) · [Draw calls](./performance.md#draw-calls)

---

<a id="state-machine"></a>

## 20 · Finite state machine · 有限状态机

> *同一时间只有一个状态* ｜ `one state at a time`

finite state machine 让角色始终只处在一个状态，并列出哪些 event 会把哪个 state 切到哪个 state。没有对应 transition 的 event 直接被忽略，比如演示里在空中按攻击。它取代了一堆 isJumping、isAttacking 之类的 boolean——那些东西可能同时为 true。

**展开说**：有限状态机保证角色同一时刻只有一个状态，并用一张显式的「状态 × 事件 → 状态」转移表决定怎么切换。没命中的事件直接忽略，而不是一堆 `isJumping / isAttacking / isDead` 布尔量互相打架。

**什么时候用**：当行为有明显模式且转换清晰时使用 state machine。显式的 transition table 能让人一眼看出当前是否允许跳跃、攻击或受伤。

**什么时候别用**：行为是连续混合的（动画 blend tree、移动速度插值）时，状态机只是骨架，混合同样需要。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-20)）

```text
Model the character with a finite state machine: one active state at a time, an explicit transition table keyed by state and event, events with no entry ignored, and enter, update and exit hooks on each state.
```

**伪代码**（引擎无关，按需换成 API）

```text
next = transitions[currentState].get(event)
if next exists:
  states[currentState].exit()
  currentState = next
  states[currentState].enter()
```

**常见错误**：不要把重要转换藏在互不相关的 flag 里。当移动和武器状态彼此独立时，用两个 state machine 或层级结构，而不是枚举所有组合。

**关键参数**：enter / update / exit 三钩子；切状态先 exit 再 enter；非法转移记日志。

**相关概念**：[Input buffering](./game-feel.md#input-buffering) · [Invincibility frames](./game-feel.md#invincibility-frames) · [Steering behaviors](#steering-behaviors)

---

<a id="hitbox-hurtbox"></a>

## 21 · Hitbox and hurtbox · 判定框

> *什么打人什么挨打* ｜ `what hits, what gets hit`

hitbox 是攻击中造成伤害的区域，只在攻击的 active frames 内存在。hurtbox 是角色会受伤的区域。两者重叠才会命中，所以演示里防守方一下蹲，每隔一次挥击就会落空。

**展开说**：hitbox 是攻击的判定区，只在 active frames 开启；hurtbox 是角色可被击中的区域。两者重叠才结算伤害，且一次挥砍对同一目标只算一次。这样「躲开」是几何问题，不是数值问题。

**什么时候用**：当动画时机很重要时，把攻击判定和受击判定拆成不同的 volume。一次攻击实例应记录已经打中过哪些目标，并与防御方的无敌计时器分开。

**什么时候别用**：纯格斗游戏需要更细的帧数据（startup/active/recovery）；跑酷类用触发器就够。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-21)）

```text
Separate hitboxes from hurtboxes: enable each hitbox only during the attack's active frames, test it against the target's hurtboxes instead of sprite bounds, and register at most one hit per target per swing.
```

**伪代码**（引擎无关，按需换成 API）

```text
if attack.isActive:
  for target in overlaps(attack.hitbox):
    if target not in attack.hitTargets:
      applyHit(target)
      attack.hitTargets.add(target)
```

**常见错误**：每一次挥击开始时重置 hit-target 集合，而不是每帧重置。sprite bounds 往往包含空白区域，通常不适合作为战斗碰撞形状。

**关键参数**：按 active frame 开关；每 target 每 swing 只记一次；调试时可视化判定框。

**相关概念**：[Invincibility frames](./game-feel.md#invincibility-frames) · [Hit stop](./game-feel.md#hit-stop) · [Raycasting](./3d-rendering.md#raycasting)

---

<a id="pathfinding"></a>

## 22 · A* pathfinding · A* 寻路

> *朝着目标找路的搜索* ｜ `search that aims at the goal`

A* 在 grid 上搜索时，总是先展开「已花费代价 + 剩余距离估计」最小的格子。这个估计把搜索引向目标，所以在这个迷宫里它比盲目搜索少展开约 40% 的格子。只要估计从不高估，返回的路径就一定是最短的。

**展开说**：A* 每次扩展「已走代价 g + 剩余估计 h」最小的格子。h 只要能低估就保证最短路径；4 方向用曼哈顿距离，8 方向用 octile。开放集用二叉堆，路径靠父链回溯。

**什么时候用**：当单位需要在一张可通行位置图（graph）里找路线时使用 A*。graph 负责“哪里能走”，沿路线移动交给独立的 movement controller。

**什么时候别用**：目标每帧都在变（追逐）时，与其每帧重算，不如用转向行为或流场。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-22)）

```text
Use A* on the navigation grid with a binary heap for the open set, g as the cost so far, a Manhattan heuristic for 4-way movement or octile for 8-way, ties on f broken towards lower h, and the path rebuilt from parent links when the goal is popped.
```

**伪代码**（引擎无关，按需换成 API）

```text
open.push(start, priority = 0)
while open is not empty:
  current = open.popLowest()
  if current == goal: return reconstructPath(current)
  for next in neighbors(current):
    relaxEdge(current, next, cost + heuristic(next, goal))
```

**常见错误**：heuristic 不能高估剩余代价，否则常见的最短路径保证会失效。还要让 heuristic 与允许的移动方向匹配，并在单位无法通过时禁止斜向切角（corner cutting）。

**关键参数**：8 方向 octile 启发；f 相同按 h 小优先；导航网格比格子省；寻路结果缓存。

**相关概念**：[Steering behaviors](#steering-behaviors) · [Spatial partitioning](./performance.md#spatial-partitioning) · [Time slicing](./performance.md#time-slicing)

**延伸阅读**：[Red Blob Games: Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html)

---

<a id="particle-system"></a>

## 23 · Particle system · 粒子系统

> *一个发射器许多短命粒子* ｜ `one emitter, many short lives`

particle system 从一个 emitter 和几个数字里生成大量短命 sprite：emission rate、lifetime、方向散布、速度、gravity 和 drag。每个粒子还会在自己的生命周期里改变 size 和 opacity。演示里的火花、烟雾和彩纸都是同一份代码，只是数字不同。

**展开说**：粒子系统 = 一个发射器 + 一组可调数字（发射率、寿命范围、方向扩散、初速、重力、阻力）+ 生命周期内的尺寸/透明度曲线。火花、烟、彩带是同一份代码换参数。

**什么时候用**：用一套 emitter 配置产出大量短命效果。把 emission、simulation 和 rendering 分开，让它们各自拥有独立的预算和质量设置。

**什么时候别用**：需要精确碰撞/物理反馈的效果（碎片、可破坏物）不要用纯粒子，它们是纯视觉的。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-23)）

```text
Build this as a particle system: one emitter with tunable emission rate, lifetime range, direction spread, initial speed range, gravity and drag, size and opacity curves over each particle's life, and particles taken from a fixed preallocated pool.
```

**伪代码**（引擎无关，按需换成 API）

```text
spawnBudget += emissionRate * dt
while spawnBudget >= 1:
  spawnFromPool()
  spawnBudget -= 1
for particle in active:
  particle.velocity += gravity * dt
  particle.position += particle.velocity * dt
```

**常见错误**：每渲染帧固定 spawn 数量会让效果密度随帧率变化。还要限制活跃粒子数和透明重叠；pooling 解决不了 overdraw 瓶颈。

**关键参数**：粒子来自预分配池；按发射率 × 寿命估算上限；移动端限制同屏数量。

**相关概念**：[Object pooling](#object-pooling) · [Overdraw](./performance.md#overdraw) · [Billboarding](./3d-rendering.md#billboarding)

---

<a id="fixed-timestep"></a>

## 24 · Fixed timestep · 固定步长

> *物理跑在稳定的时钟上* ｜ `physics on a steady clock`

fixed timestep 以固定的时间片推进物理，这里是 1/60 秒，和帧率无关。每帧把自己的时长加进 accumulator，能跑几个时间片就跑几个，剩下的留到下一帧。上面那根弹簧改用了原始帧时长，所以来一小段 92 ms 的长帧，它就会积攒能量然后爆炸。

**展开说**：物理必须用固定步长：每帧把 dt 累加到 accumulator，能跑几步 1/60s 就跑几步，剩下的留到下一帧，渲染时在两次物理状态间插值。否则帧时间一抖，弹簧就会涨能量、直接炸掉。

**什么时候用**：用 fixed timestep 获得可重复的 physics 更新和稳定的积分。render interpolation 让 tick 之间的运动更平滑，同时不改变模拟的 tick rate。

**什么时候别用**：纯视觉动画、UI 过渡不需要固定步长，用真实 dt 更平滑。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-24)）

```text
Run physics on a fixed 60 Hz timestep: add each frame's delta time to an accumulator capped at 0.25 s, step the simulation by 1/60 s while the accumulator holds at least that much, and draw objects interpolated between the last two physics states using the leftover fraction.
```

**伪代码**（引擎无关，按需换成 API）

```text
accumulator += min(frameSeconds, 0.25)
while accumulator >= step:
  previous = current
  current = simulate(current, step)
  accumulator -= step
render(lerp(previous, current, accumulator / step))
```

**常见错误**：如果模拟耗时超过它推进的时间，积压会无界增长。要设 catch-up 预算和明确的过载策略。单靠 fixed timestep 并不能保证跨机器 determinism。

**关键参数**：60Hz（1/60s）；accumulator 上限 0.25s；最多追 5 步；渲染插值 alpha = 余量 / 步长。

**相关概念**：[Delta time](./game-feel.md#delta-time) · [Tunneling](#tunneling) · [Frame budget](./performance.md#frame-budget)

**延伸阅读**：[Gaffer On Games: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)

---

<a id="steering-behaviors"></a>

## 25 · Steering behaviors · 转向行为

> *把速度慢慢推向目标* ｜ `nudge velocity toward a goal`

steering behaviors 每帧给单位加一个力，把当前 velocity 转向 desired velocity，这个力有 max force 上限。arrive 会在 slowing radius（演示里的虚线圆）内降低期望速度，separation 则在单位靠太近时把它们推开。左边八个单位全速冲向目标，冲过头、每帧又折返，最后挤在同一个点上；右边八个会减速，围在目标附近稳定下来。

**展开说**：转向行为每帧算出「期望速度 - 当前速度」作为转向力，钳到最大力后加到速度上。arrive 在减速半径内降低期望速度，separation 在邻居太近时推开。没有 max force 的单位会瞬移，没有速度上限的会飞出去。

**什么时候用**：steering 适合平滑的局部移动：靠近目标或远离邻居。遇到障碍需要规划路线时，要配合 pathfinding；只靠 steering 会卡死。

**什么时候别用**：需要精确落点/攻击位置的移动（近战贴身、平台跳跃）应该用状态机 + 位移，而不是转向力。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-25)）

```text
Move units with steering behaviors: each frame compute steering as desired velocity minus current velocity, clamp it to a max force of about 4 times the max speed per second, and add it to the velocity; for arrive, scale the desired speed by distance divided by a slowing radius of about 4 unit widths, and add separation that pushes away from each neighbour closer than about 2 unit widths, harder the closer it is.
```

**伪代码**（引擎无关，按需换成 API）

```text
desired = normalize(target - position) * desiredSpeed
steering = clampLength(desired - velocity, maxAcceleration)
velocity = clampLength(velocity + steering * dt, maxSpeed)
position += velocity * dt
```

**常见错误**：acceleration 和 speed 都要限幅。做 arrive 时，应在接近目的地时降低 desired speed，而不是以全速反复 overshoot。

**关键参数**：maxForce ≈ 4× maxSpeed / s；arrive 减速半径 ≈ 4 个单位宽；separation 距离 ≈ 2 个单位宽。

**相关概念**：[A* pathfinding](#pathfinding) · [Acceleration and friction](./game-feel.md#acceleration-and-friction) · [Spatial partitioning](./performance.md#spatial-partitioning)

---

<a id="tunneling"></a>

## 26 · Tunneling · 穿透

> *太快了直接穿墙而过* ｜ `fast objects skip through walls`

tunneling 发生在物体一帧内移动太远时：步进前它在墙前，步进后已经在墙后，于是每帧一次的重叠测试永远看不到它们接触。演示里子弹每帧移动约 40 px，墙只有 6 px 厚，每个点代表一帧（已放慢）。上面那条道只在点处做重叠测试，子弹直接穿过去；下面那条道会测试两个点之间的整段路径，把子弹拦在墙上。

**展开说**：物体一帧移动的距离超过障碍厚度时，前后两帧都在墙两侧，端点重叠检测永远看不到它。解法是测整段扫过路径（raycast/shape cast）、把物理步切细，或开 CCD。

**什么时候用**：对在一帧内可能越过薄障碍的物体使用 swept collision detection。ray 代表点状投射物，sphere 或 capsule sweep 代表有体积的物体。

**什么时候别用**：慢速物体不需要 swept 检测，成本白花；先按「单帧位移 > 物体厚度的一半」这个条件筛选。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-26)）

```text
For fast objects like bullets, test the swept path from last frame's position to the new one with a raycast or shape cast, or sub-step the physics so each step moves less than half the object's size, and turn on continuous collision detection for fast rigidbodies.
```

**伪代码**（引擎无关，按需换成 API）

```text
next = position + velocity * dt
hit = sweepShape(shape, position, next)
if hit:
  position = hit.safePosition
  resolveImpact(hit)
else: position = next
```

**常见错误**：提高渲染 FPS 修不好采样率仍然很低的 physics。要根据物体的速度、尺寸和碰撞需求，选择 continuous collision detection 或 substeps。

**关键参数**：单帧位移 < 物体尺寸一半；sweep 从上一帧位置到新位置；旋转快时还要扫角速度。

**相关概念**：[Raycasting](./3d-rendering.md#raycasting) · [Fixed timestep](#fixed-timestep) · [Hitbox and hurtbox](#hitbox-hurtbox)

---

<a id="seeded-noise"></a>

## 27 · Seeded noise · 种子噪声

> *同一个种子同一个世界* ｜ `same seed, same world`

seeded noise 用带种子的随机数生成器构建世界，同一个 seed 总能重建出同一个世界，存档也只需要存这一个数。上面那条带子的 64 个柱高每个都用 Math.random 取，所以参差不齐，每次重新生成都不一样。下面那条把 seeded generator 生成的 4 个 octave 的 value noise 叠加起来，山丘平滑，同一个 seed 会精确地沿虚线重绘，换一个 seed 就是新的山丘。

**展开说**：用带种子的 PRNG（如 mulberry32）驱动 2D Perlin/simplex，多层叠加（每个倍频频率翻倍、振幅减半），同一个种子必然生成同一个世界。存档只要存种子 + 玩家改动。

**什么时候用**：当世界需要从一个小 seed 重建时，用 seeded generator。平滑噪声让邻近坐标的值相关，而独立随机采样会产生突兀变化。

**什么时候别用**：需要「一次性纹理噪点」的视觉噪声可以用 Math.random；只要不参与玩法复现。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-27)）

```text
Generate the world from a seeded PRNG such as mulberry32 feeding 2D Perlin or simplex noise with 3 to 5 octaves, each at double the frequency and half the amplitude of the one before, store the seed in the save file, and never call Math.random in world generation.
```

**伪代码**（引擎无关，按需换成 API）

```text
height = 0
frequency = baseFrequency
amplitude = 1
for octave in range(4):
  height += noise(seed, x * frequency) * amplitude
  frequency *= 2
  amplitude *= 0.5
```

**常见错误**：算法和采样顺序要在不同存档之间保持稳定。共享的连续随机流中多插入一次 random 调用，就可能整体偏移世界；按坐标采样可以避免这种依赖。

**关键参数**：3–5 个倍频；lacunarity 2、gain 0.5；世界生成禁用 Math.random；种子存进存档。

**相关概念**：[Chunk streaming](./performance.md#chunk-streaming) · [Screen shake](./game-feel.md#screen-shake) · [Particle system](#particle-system)

---

---

← [总索引](./index.md) ｜ 下一章 → [Performance · 性能](./performance.md)
