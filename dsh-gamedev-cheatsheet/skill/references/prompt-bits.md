# 34 条 Prompt Bits · 可直接粘贴

> 每条都是「动作 + 关键参数 + 边界条件」的完整指令结构。英文版可直接粘贴给 AI；
> 中文版用于理解与改写。改参数前先问自己：这个数是起点，还是我要的效果？

> 用法：找到你的场景 → 粘英文版 → 按 `engine-mapping.md` 换成引擎 API。

---

<a id="bit-01"></a>

## 01 · Raycasting · 射线检测

`3D & rendering` ｜ [详解](./3d-rendering.md#raycasting)

**EN**

```text
Use a raycast for hit detection: cast from the muzzle along the aim direction with a max distance of 100 units and a layer mask that skips the shooter, take the closest hit, and use its point and surface normal to place the impact effect.
```

**中文**

```text
用 raycast 做命中检测：从枪口沿瞄准方向发射，max distance 设为 100 单位，并用 layer mask 跳过射手自身，取最近的 hit，再用它的 point 和 surface normal 来放置命中特效。
```

---

<a id="bit-02"></a>

## 02 · Normals · 法线

`3D & rendering` ｜ [详解](./3d-rendering.md#normals)

**EN**

```text
Use the surface normal from each collision or raycast hit: reflect the velocity around it for bounces, and count a surface as walkable floor only when the normal's up component is above 0.7, which is about 45 degrees.
```

**中文**

```text
利用每次 collision 或 raycast hit 得到的 surface normal：对弹跳用它将 velocity 沿法线反射；只有 normal 的 up 分量高于 0.7（约 45 度）时，才把该表面算作可行走的地面。
```

---

<a id="bit-03"></a>

## 03 · Level of detail · 细节层级

`3D & rendering` ｜ [详解](./3d-rendering.md#level-of-detail)

**EN**

```text
Add LOD to the props: build three versions at about 100%, 30% and 10% of the triangles, switch between them at set camera distances, and add a 10% hysteresis band so a mesh standing near a threshold does not flicker between levels.
```

**中文**

```text
给场景里的 props 加上 LOD：制作约 100%、30%、10% 三角形数的三个版本，按设定的相机距离切换，并加入 10% 的 hysteresis band，避免停在阈值附近的 mesh 在两个级别之间闪烁。
```

---

<a id="bit-04"></a>

## 04 · Frustum culling · 视锥剔除

`3D & rendering` ｜ [详解](./3d-rendering.md#frustum-culling)

**EN**

```text
Add frustum culling: each frame, build a frustum from the camera's projection and view matrices, test each object's bounding sphere against it, and skip both the draw and the animation update for objects fully outside.
```

**中文**

```text
加上 frustum culling：每帧用相机的 projection matrix 和 view matrix 构建视锥，用每个物体的 bounding sphere 做相交测试，对完全在视锥外的物体同时跳过绘制和动画更新。
```

---

<a id="bit-05"></a>

## 05 · Fragment shader · 片元着色器

`3D & rendering` ｜ [详解](./3d-rendering.md#fragment-shader)

**EN**

```text
Write this effect as a GLSL fragment shader: compute each pixel's colour from its UV and a uTime uniform, and expose speed, scale and colours as uniforms so they can be tuned without touching the shader code.
```

**中文**

```text
用 GLSL fragment shader 实现这个效果：根据像素的 UV 和 uTime uniform 计算颜色，并把 speed、scale 和颜色暴露为 uniform，这样不修改 shader 代码也能调整参数。
```

---

<a id="bit-06"></a>

## 06 · Billboarding · 面向相机

`3D & rendering` ｜ [详解](./3d-rendering.md#billboarding)

**EN**

```text
Make the health bars and name tags billboards: each frame, set each quad's world rotation to the camera's rotation so it faces the screen, and for trees and other upright sprites rotate only around the Y axis so they stay vertical.
```

**中文**

```text
把血条和名字标签做成 billboard：每帧将每个 quad 的世界旋转设为相机的旋转，使其始终面向屏幕；树木等直立 sprite 只绕 Y 轴旋转，以保持竖直。
```

---

<a id="bit-07"></a>

## 07 · Quaternions · 四元数

`3D & rendering` ｜ [详解](./3d-rendering.md#quaternions)

**EN**

```text
Store rotations as quaternions, combine them by multiplication, interpolate with slerp and negate one of the two when their dot product is below 0 so it takes the short way, and convert to Euler angles only for display or editor input.
```

**中文**

```text
用 quaternion 存储旋转，通过相乘来组合旋转，用 slerp 做插值；当两个 quaternion 的 dot product 小于 0 时把其一取反，以走最短路径；只在显示或编辑器输入时转换为 Euler 角。
```

---

<a id="bit-08"></a>

## 08 · Z-fighting · Z 冲突

`3D & rendering` ｜ [详解](./3d-rendering.md#z-fighting)

**EN**

```text
Set the camera near plane as far out as the game allows, about 0.1, and the far plane as close as the view distance allows, never put two visible surfaces in the same plane, and lift decals about 1 cm along the surface normal or draw them with polygon offset, factor -1 and units -4.
```

**中文**

```text
把相机的 near plane 设到游戏允许的尽量远（约 0.1），far plane 设到视距允许的尽量近；绝不要让两个可见表面处在同一平面；decal 沿 surface normal 抬高约 1 cm，或用 polygon offset（factor -1、units -4）绘制。
```

---

<a id="bit-09"></a>

## 09 · Delta time · 帧时间

`Game feel` ｜ [详解](./game-feel.md#delta-time)

**EN**

```text
Make all movement frame-rate independent with delta time: multiply every speed by dt in seconds, add dt to every timer, smooth with 1 - exp(-k * dt) instead of a fixed lerp factor, and clamp dt to about 0.05 s so one long frame cannot teleport anything.
```

**中文**

```text
用 delta time 让所有移动与帧率无关：每个 speed 都乘上以秒为单位的 dt，每个 timer 都加上 dt，平滑用 1 - exp(-k * dt) 而不是固定的 lerp 系数，并把 dt 限制在约 0.05 s 以内，避免某一帧过长导致物体瞬移。
```

---

<a id="bit-10"></a>

## 10 · Coyote time · 土狼时间

`Game feel` ｜ [详解](./game-feel.md#coyote-time)

**EN**

```text
Add coyote time to the jump: track the time since the player last stood on the ground, allow a jump while it is under 0.12 s, and use up that window when the jump fires so the window cannot give a second jump.
```

**中文**

```text
给跳跃加上 coyote time：记录玩家最后一次站在地面上的时间，该时间小于 0.12 s 时仍允许起跳，并在起跳时消耗掉这个窗口，避免同一个窗口给出第二次跳跃。
```

---

<a id="bit-11"></a>

## 11 · Easing · 缓动

`Game feel` ｜ [详解](./game-feel.md#easing)

**EN**

```text
Replace linear tweens with easing: compute t = elapsed / duration clamped between 0 and 1, set position = lerp(start, end, easeOutCubic(t)), use about 0.3 s for UI moves, and switch to easeOutBack when the motion should overshoot slightly before settling.
```

**中文**

```text
用 easing 替代线性 tween：计算 t = elapsed / duration 并 clamp 在 0 到 1 之间，设 position = lerp(start, end, easeOutCubic(t))，UI 移动用约 0.3 s；需要先略微过冲再回稳时改用 easeOutBack。
```

---

<a id="bit-12"></a>

## 12 · Screen shake · 屏幕震动

`Game feel` ｜ [详解](./game-feel.md#screen-shake)

**EN**

```text
Drive screen shake from a trauma value between 0 and 1: each hit adds 0.3 to 0.6, trauma decays by about 1 per second, and each frame the camera x, y and roll offsets equal a max offset times trauma squared times smooth Perlin noise, not fresh random numbers.
```

**中文**

```text
用 0 到 1 之间的 trauma 值驱动 screen shake：每次受击增加 0.3 到 0.6，trauma 每秒衰减约 1；每帧相机 x、y 和 roll 的偏移量等于 max offset 乘以 trauma 的平方、再乘以平滑的 Perlin noise，而不是每帧新取随机数。
```

---

<a id="bit-13"></a>

## 13 · Squash and stretch · 挤压拉伸

`Game feel` ｜ [详解](./game-feel.md#squash-and-stretch)

**EN**

```text
Add squash and stretch to the sprite: scale it up to about 1.3 along its velocity when it moves fast, squash it to about 0.7 on landing and ease back to 1 within 0.15 s, give the other axis the inverse scale so its area stays constant, and pivot at the feet so it stays on the ground.
```

**中文**

```text
给 sprite 加上 squash and stretch：快速移动时沿速度方向拉伸到约 1.3 倍，落地时压扁到约 0.7 倍并在 0.15 s 内 ease 回 1；另一轴取相反的缩放以保持面积不变，并把 pivot 放在脚底，让 sprite 贴地。
```

---

<a id="bit-14"></a>

## 14 · Camera deadzone · 相机死区

`Game feel` ｜ [详解](./game-feel.md#camera-deadzone)

**EN**

```text
Give the follow camera a deadzone: keep the camera still while the player is inside a centered box about a quarter of the screen wide, and when they cross an edge, move the camera by exactly how far they went past it.
```

**中文**

```text
给跟随相机加 deadzone：玩家处在屏幕中央约四分之一屏宽的区域时保持相机不动；一旦越过边界，相机就按玩家超出的距离精确移动。
```

---

<a id="bit-15"></a>

## 15 · Input buffering · 输入缓冲

`Game feel` ｜ [详解](./game-feel.md#input-buffering)

**EN**

```text
Add a jump input buffer: when the player presses jump, set a buffer timer to 0.1 s that counts down every frame, fire the jump on the first frame the player is grounded while that timer is above 0, and reset the timer to 0 when the jump fires so one press gives one jump.
```

**中文**

```text
给跳跃加入 input buffer：玩家按下跳跃时把 buffer timer 设为 0.1 s 并每帧递减，在玩家落地且 timer 大于 0 的第一帧触发跳跃，触发后把 timer 归零，保证一次按键只对应一次跳跃。
```

---

<a id="bit-16"></a>

## 16 · Acceleration and friction · 加速与摩擦

`Game feel` ｜ [详解](./game-feel.md#acceleration-and-friction)

**EN**

```text
Give horizontal movement acceleration and friction: each frame move the velocity toward input times max speed with an acceleration that reaches max speed in 0.1 to 0.2 s, decelerate to a stop in about 0.1 s when no direction is held, use twice that deceleration when the input points against the current velocity, and halve both rates while airborne.
```

**中文**

```text
给水平移动加上 acceleration 和 friction：每帧让 velocity 以一定加速度逼近“输入方向 × 最大速度”，在 0.1 到 0.2 s 内达到最大速度；没有输入时约 0.1 s 内减速到停止；输入与当前 velocity 相反时减速力翻倍；在空中时两者都减半。
```

---

<a id="bit-17"></a>

## 17 · Hit stop · 命中停顿

`Game feel` ｜ [详解](./game-feel.md#hit-stop)

**EN**

```text
Add hit stop: when a hit lands, pause the animation and movement of the attacker and the target for 50 to 100 ms scaled by the damage, keep reading and buffering input during the pause, and keep UI and particles running at normal speed.
```

**中文**

```text
加上 hit stop：命中发生时，让攻击者和受击者的动画与移动暂停 50 到 100 ms（按伤害缩放），暂停期间仍然读取并缓冲输入，UI 和粒子保持正常速度运行。
```

---

<a id="bit-18"></a>

## 18 · Invincibility frames · 无敌帧

`Game feel` ｜ [详解](./game-feel.md#invincibility-frames)

**EN**

```text
Add invincibility frames: after the player takes damage, ignore all further damage for 0.5 to 1 s, blink the sprite on and off at about 10 Hz during that window, and apply a knockback impulse that pushes the player away from the damage source.
```

**中文**

```text
加上 invincibility frames：玩家受伤后 0.5 到 1 s 内免疫所有后续伤害，这段时间以约 10 Hz 让 sprite 闪烁显示，并对玩家施加一个背离伤害来源的 knockback 冲量。
```

---

<a id="bit-19"></a>

## 19 · Object pooling · 对象池

`Systems` ｜ [详解](./systems.md#object-pooling)

**EN**

```text
Use an object pool for bullets and particles: preallocate the peak count up front, take an inactive instance and reset its fields on spawn, mark it inactive on death instead of destroying it, and log a warning if the pool ever runs out.
```

**中文**

```text
给子弹和粒子使用 object pool：预先按峰值数量分配好，spawn 时取出一个 inactive 实例并重置其字段，死亡时标记为 inactive 而不是销毁；如果 pool 耗尽则记录一条警告。
```

---

<a id="bit-20"></a>

## 20 · Finite state machine · 有限状态机

`Systems` ｜ [详解](./systems.md#state-machine)

**EN**

```text
Model the character with a finite state machine: one active state at a time, an explicit transition table keyed by state and event, events with no entry ignored, and enter, update and exit hooks on each state.
```

**中文**

```text
用 finite state machine 为角色建模：同一时间只有一个 active state，用一张以 state 和 event 为键的显式 transition table，没有对应条目的 event 直接忽略，每个 state 都具备 enter、update 和 exit 钩子。
```

---

<a id="bit-21"></a>

## 21 · Hitbox and hurtbox · 判定框

`Systems` ｜ [详解](./systems.md#hitbox-hurtbox)

**EN**

```text
Separate hitboxes from hurtboxes: enable each hitbox only during the attack's active frames, test it against the target's hurtboxes instead of sprite bounds, and register at most one hit per target per swing.
```

**中文**

```text
把 hitbox 和 hurtbox 分开：只在攻击的 active frames 内启用 hitbox，用它与目标的 hurtbox 做检测而不是用 sprite 边界，并且一次挥击对每个目标最多只登记一次命中。
```

---

<a id="bit-22"></a>

## 22 · A* pathfinding · A* 寻路

`Systems` ｜ [详解](./systems.md#pathfinding)

**EN**

```text
Use A* on the navigation grid with a binary heap for the open set, g as the cost so far, a Manhattan heuristic for 4-way movement or octile for 8-way, ties on f broken towards lower h, and the path rebuilt from parent links when the goal is popped.
```

**中文**

```text
在 navigation grid 上使用 A*：open set 用 binary heap，g 为已花费代价，4 向移动用 Manhattan heuristic、8 向用 octile heuristic，f 相同时优先选择 h 更小的节点；当目标节点被 pop 时沿 parent 指针重建路径。
```

---

<a id="bit-23"></a>

## 23 · Particle system · 粒子系统

`Systems` ｜ [详解](./systems.md#particle-system)

**EN**

```text
Build this as a particle system: one emitter with tunable emission rate, lifetime range, direction spread, initial speed range, gravity and drag, size and opacity curves over each particle's life, and particles taken from a fixed preallocated pool.
```

**中文**

```text
用 particle system 实现这个效果：一个 emitter，可调 emission rate、lifetime 范围、方向散布、初速度范围、gravity 和 drag，以及粒子整个生命周期内的 size 和 opacity 曲线；粒子从固定的预分配 pool 中取用。
```

---

<a id="bit-24"></a>

## 24 · Fixed timestep · 固定步长

`Systems` ｜ [详解](./systems.md#fixed-timestep)

**EN**

```text
Run physics on a fixed 60 Hz timestep: add each frame's delta time to an accumulator capped at 0.25 s, step the simulation by 1/60 s while the accumulator holds at least that much, and draw objects interpolated between the last two physics states using the leftover fraction.
```

**中文**

```text
物理以固定 60 Hz timestep 运行：每帧把 delta time 累加到上限为 0.25 s 的 accumulator，当 accumulator 足够时以 1/60 s 为步长推进模拟；渲染时用剩余的比例在最近两次物理状态之间插值。
```

---

<a id="bit-25"></a>

## 25 · Steering behaviors · 转向行为

`Systems` ｜ [详解](./systems.md#steering-behaviors)

**EN**

```text
Move units with steering behaviors: each frame compute steering as desired velocity minus current velocity, clamp it to a max force of about 4 times the max speed per second, and add it to the velocity; for arrive, scale the desired speed by distance divided by a slowing radius of about 4 unit widths, and add separation that pushes away from each neighbour closer than about 2 unit widths, harder the closer it is.
```

**中文**

```text
用 steering behaviors 移动单位：每帧用 desired velocity 减去当前 velocity 得到 steering，将其 clamp 到约“每秒 4 倍最大速度”的 max force，再加到 velocity 上；arrive 时按“距离 / 约 4 个单位宽度的 slowing radius”缩放 desired speed；separation 对每个距离小于约 2 个单位宽度的邻居产生推力，越近推力越大。
```

---

<a id="bit-26"></a>

## 26 · Tunneling · 穿透

`Systems` ｜ [详解](./systems.md#tunneling)

**EN**

```text
For fast objects like bullets, test the swept path from last frame's position to the new one with a raycast or shape cast, or sub-step the physics so each step moves less than half the object's size, and turn on continuous collision detection for fast rigidbodies.
```

**中文**

```text
对于子弹这类高速物体，用 raycast 或 shape cast 检测从上一帧位置到新位置的 swept path；或者对物理做 sub-step，使每步移动距离小于物体尺寸的一半；并为高速 rigidbody 开启 continuous collision detection。
```

---

<a id="bit-27"></a>

## 27 · Seeded noise · 种子噪声

`Systems` ｜ [详解](./systems.md#seeded-noise)

**EN**

```text
Generate the world from a seeded PRNG such as mulberry32 feeding 2D Perlin or simplex noise with 3 to 5 octaves, each at double the frequency and half the amplitude of the one before, store the seed in the save file, and never call Math.random in world generation.
```

**中文**

```text
用带种子的 PRNG 生成世界，例如 mulberry32，把它的输出喂给 3 到 5 个 octave 的 2D Perlin 或 simplex noise，每一层频率翻倍、振幅减半；把 seed 存进存档，世界生成过程中绝不调用 Math.random。
```

---

<a id="bit-28"></a>

## 28 · Frame budget · 帧预算

`Performance` ｜ [详解](./performance.md#frame-budget)

**EN**

```text
Before optimising, time input, update, physics and render every frame with performance.now(), show each one in milliseconds against the 16.67 ms budget for 60 fps, and optimise the largest one first.
```

**中文**

```text
优化之前，先用 performance.now() 每帧测量 input、update、physics 和 render 的耗时，以毫秒为单位对照 60 fps 的 16.67 ms 预算展示出来，并优先优化耗时最大的那一项。
```

---

<a id="bit-29"></a>

## 29 · Draw calls · 绘制调用

`Performance` ｜ [详解](./performance.md#draw-calls)

**EN**

```text
Use GPU instancing for repeated objects that share one mesh and one material, so each group renders in a single draw call with a per-instance transform buffer, and merge static meshes that share a material into one mesh.
```

**中文**

```text
对共享同一 mesh 和材质的大量重复物体使用 GPU instancing，让每组只发起一次 draw call，并用 per-instance transform buffer 提供各自变换；同时把共享材质的 static mesh 合并成一个。
```

---

<a id="bit-30"></a>

## 30 · Spatial partitioning · 空间划分

`Performance` ｜ [详解](./performance.md#spatial-partitioning)

**EN**

```text
Use a uniform spatial grid for broad-phase collision with cells about twice the size of the largest object, rebuild it every frame, and test each object only against objects in its own cell and the 8 neighbouring cells.
```

**中文**

```text
用 uniform spatial grid 做 broad-phase collision：cell 边长约为最大物体的两倍，每帧重建网格，每个物体只与自身所在 cell 及周围 8 个相邻 cell 中的物体做检测。
```

---

<a id="bit-31"></a>

## 31 · Overdraw · 过度绘制

`Performance` ｜ [详解](./performance.md#overdraw)

**EN**

```text
Reduce overdraw from transparent particles: cap how many can overlap, keep each sprite small on screen, trim sprite quads tightly around their visible pixels, and render heavy effects like smoke to a half-resolution buffer.
```

**中文**

```text
减少透明粒子的 overdraw：限制重叠的粒子数量，让每个 sprite 在屏幕上尽量小，把 sprite quad 裁剪到贴近可见像素，并把烟雾这类重效果渲染到半分辨率 buffer。
```

---

<a id="bit-32"></a>

## 32 · Time slicing · 时间切片

`Performance` ｜ [详解](./performance.md#time-slicing)

**EN**

```text
Time-slice expensive AI updates by splitting agents into 4 to 8 buckets by index and running decisions like pathfinding or target selection for one bucket per frame, while movement and animation still update every frame.
```

**中文**

```text
对开销大的 AI 更新做 time-slicing：按 index 把 agent 分成 4 到 8 个 bucket，每帧只为一个 bucket 运行 pathfinding、target selection 等决策，而 movement 和 animation 仍然每帧更新。
```

---

<a id="bit-33"></a>

## 33 · Texture atlas · 贴图图集

`Performance` ｜ [详解](./performance.md#texture-atlas)

**EN**

```text
Pack the sprites into one texture atlas, for example 2048 by 2048 with 2 px of padding around each sprite, store each sprite's UV rectangle in a JSON file, and draw every sprite that shares the atlas and shader in a single batch.
```

**中文**

```text
把 sprite 打包进一张 texture atlas，例如 2048 × 2048、每个 sprite 周围留 2 px padding；把每个 sprite 的 UV rectangle 存到 JSON 文件里，共享该 atlas 和 shader 的 sprite 一次性 batch 绘制。
```

---

<a id="bit-34"></a>

## 34 · Chunk streaming · 分块加载

`Performance` ｜ [详解](./performance.md#chunk-streaming)

**EN**

```text
Stream the world in fixed-size chunks of 32 by 32 tiles, keep every chunk within 2 chunks of the player loaded, load new chunks asynchronously off the main thread, unload a chunk only once it is more than 3 chunks away so a player standing on a border does not cause reloads, and reuse chunk objects from a pool.
```

**中文**

```text
以 32 × 32 tile 的固定大小 chunk 流式加载世界：玩家周围 2 个 chunk 内的全部保持加载，新 chunk 在主线程之外异步加载；只有当 chunk 距离超过 3 个 chunk 时才 unload，避免玩家站在边界时反复重载；chunk 对象从 pool 中复用。
```

---

## 组合用法：一句话让 AI 建一个「手感正确」的原型

```text
Build a 2D platformer prototype with frame-rate-independent movement:
multiply all speeds by delta time (clamped to 0.05 s), run physics on a fixed
1/60 s timestep with an accumulator capped at 0.25 s, add coyote time of 0.12 s
and a 0.1 s jump input buffer that fires once, accelerate toward max speed in
0.15 s and decelerate in 0.1 s (2x when reversing), give the camera a deadzone
of 1/4 screen width with easing, pool all particles and damage numbers, and add
hit stop of 60 ms on impact with a trauma-based screen shake (offset = max *
trauma^2 * noise, trauma decays 1/s).
```
