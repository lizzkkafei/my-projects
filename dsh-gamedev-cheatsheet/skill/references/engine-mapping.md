# 引擎落地映射

> 概念是引擎无关的，API 不是。这里把每个概念组落到四个主流运行时的**具体类/函数/坑**上。
> 版本基准：Unity 2022 LTS+ / Unity 6、Godot 4.x、three.js r160+、Phaser 3.60+。注意 Unity 6 把 `velocity`→`linearVelocity`、`drag`→`linearDamping`，2022 LTS 用旧名。

---

## 0. 先定三件事，再碰引擎

动手前必须先定，写死在配置里：

1. **时间单位**：全部用秒（`dt` 秒、速度 units/s、时长秒）。别混用毫秒。
2. **物理步长**：60 Hz（1/60 s）是默认答案。物理更新只发生在固定步长里。
3. **世界单位**：1 unit = 1 米（3D）/ 1 tile（2D）。速度、重力、判定框全部基于它。

违反这三条，后面所有参数都会「换个引擎就手感不对」。

---

## 1. 时间与步长

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 帧时间 | `Time.deltaTime` | `_process(delta)` | `clock.getDelta()` | `update(time, delta)`，delta 是**毫秒** |
| 固定步长 | `Time.fixedDeltaTime`（默认 0.02） | `physics_ticks_per_second`（默认 60） | 自己写 accumulator | Arcade 物理内部固定 |
| 物理回调 | `FixedUpdate()` | `_physics_process(delta)` | 自己调 `world.step(1/60)` | `scene.physics.world` |
| 时间缩放 | `Time.timeScale = 0.05f`（hit stop） | `Engine.time_scale` | 自己乘 | `scene.time.timeScale` |
| 单帧 dt 钳制 | `Time.maximumDeltaTime`（默认 0.333） | 默认不钳，自己 `min(delta, 0.05)` | 自己 `Math.min(dt, 0.05)` | delta 自己钳 |

**坑**
- Unity：`Time.deltaTime` 在 `FixedUpdate` 里返回的是固定步长，不是真实帧时间。
- Godot：`_process` 的 delta 在低帧率时会变大，**不要在 `_physics_process` 里再用 delta 做插值**。
- three.js：`clock.getDelta()` 第一次调用返回 **0**（`autoStart` 时先 `start()`），这是正常的；真正要防的是切回标签页/长卡顿后的**大 delta 甚至负 delta**，统一 clamp 到 `[0, 0.05]`。
- Phaser：`delta` 单位是毫秒，速度单位是 px/s，直接乘会快 1000 倍——用 `delta / 1000`。

**固定步长累加器（three.js / 无引擎）**
```js
const STEP = 1 / 60;
let acc = 0;
function frame(now) {
  let dt = Math.min((now - last) / 1000, 0.05); // ① 单帧 dt 钳制：防瞬移
  last = now;
  acc = Math.min(acc + dt, 0.25);              // ② 累加器上限：防 spiral of death
  let steps = 0;
  while (acc >= STEP && steps++ < 5) { physicsStep(STEP); acc -= STEP; }
  render(acc / STEP); // 插值 alpha
}
```

---

## 2. 角色移动手感（coyote / 输入缓冲 / 加速摩擦）

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 移动载体 | `CharacterController.Move()` 或 `Rigidbody.linearVelocity`（Unity 6+；2022 LTS 为 `velocity`） | `CharacterBody3D.velocity` + `move_and_slide()` | 自己积分 | `body.setVelocityX()` |
| 接地判定 | `OnCollisionStay` / `Physics.CheckSphere` | `is_on_floor()` / `get_floor_normal()` | 手写 raycast 向下 | `body.blocked.down` |
| 输入 | `Input.GetButtonDown("Jump")` | `Input.is_action_just_pressed("jump")` | 事件监听 | `Phaser.Input.Keyboard.JustDown(key)` |
| 加速度 | `Vector3.MoveTowards(v, target, accel * dt)` | `velocity.move_toward(target, accel * delta)` | 手写 `approach()` | `body.setAccelerationX()` + `setDragX()` |

**Coyote time + 输入缓冲（引擎无关，直接抄）**
```text
// 状态
timeSinceGrounded += dt
if grounded: timeSinceGrounded = 0
if jumpPressed: jumpBuffer = 0.10
jumpBuffer -= dt

const COYOTE = 0.12        // 0.10–0.15，和判据用同一个常量

if jumpBuffer > 0 and timeSinceGrounded < COYOTE:
    jump()
    jumpBuffer = 0
    timeSinceGrounded = COYOTE   // 用掉 coyote，防二段跳（别写死 0.12）
```

**坑**
- Unity：用 `CharacterController` 时 `velocity` 要自己维护并每帧 `Move()`，不会自动受重力。
- Godot：`move_and_slide()` 已经乘了 `delta`，**不要再乘一次**。
- Phaser：`body.setDrag` 的 drag 是「每秒减少量」，不是摩擦系数；`setMaxVelocity` 必须设，否则无限加速。

---

## 3. 打击感（hit stop / 震动 / 挤压拉伸 / 无敌帧）

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| Hit stop | `Time.timeScale = 0.05f` 持续 N 帧再恢复 | `Engine.time_scale = 0.05` | 自己暂停 update | `scene.time.timeScale` |
| 震屏 | 相机局部偏移 + `Mathf.PerlinNoise` | `Camera3D` 偏移 + `FastNoiseLite` | 相机 position + noise | `camera.shake(duration, intensity)` |
| 挤压拉伸 | `transform.localScale` | `scale` property | `mesh.scale` | sprite `setScale` |
| 无敌帧闪烁 | `sprite.enabled` 方波 或 shader | `modulate.a` 方波 | material opacity | `setAlpha` / `setTint` |

**坑**
- Unity：`Time.timeScale = 0` 会让所有 `Update` 停掉，包括输入采样——hit stop 要用 **0.05 而不是 0**（0.02 更接近全停），或者只暂停角色逻辑。
- Godot：`Engine.time_scale` 同样影响动画播放速度；要冻结角色但保留 UI，用 `process_mode` 区分。
- Phaser：`camera.shake()` 是加在相机渲染上的，不会改相机 `scrollX`，适合「纯视觉震动」；要物理偏移就自己加。

---

## 4. 相机

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 跟随 | 手写 `Vector3.SmoothDamp` | `Camera3D` 手写 / `PhantomCamera` 插件 | 手写 damping | `camera.startFollow(target, true, 0.1, 0.1)` |
| 死区 | 手写中心矩形 | 手写 | 手写 | `camera.setDeadzone(w, h)` ✅ 内置 |
| 平滑 | `SmoothDamp(current, target, ref vel, 0.2f)` | `lerp(a, b, 1 - exp(-k*delta))` | `MathUtils.damp()` | startFollow 的 lerpX/lerpY |
| 屏幕震动 | 局部 offset | 局部 offset | 局部 offset | `camera.shake()` |

**死区 + 平滑（引擎无关）**
```text
// 死区：玩家在中心矩形内时相机不动；越界才推
if player.x > cam.x + halfW: cam.x = player.x - halfW
if player.x < cam.x - halfW: cam.x = player.x + halfW
// 再叠加阻尼
cam.x = lerp(cam.x, targetX, 1 - exp(-k * dt))
```

**坑**
- 平滑用固定系数 `lerp(a, b, 0.1)`：144Hz 下比 60Hz 快 2.4 倍。必须 `1 - exp(-k*dt)`。
- Unity `SmoothDamp` 的 `ref velocity` 必须跨帧保存，别每帧传新变量。
- 震动 offset 不要写进相机逻辑位置，否则跟随会漂移——用独立的 render offset。

---

## 5. 对象池

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 内置 | `UnityEngine.Pool.ObjectPool<T>` | 无内置；用 `Node` 池 + `hide()/show()`，或纯 `Array` 栈复用 | 无 | `this.add.group({ classType, maxSize, runChildUpdate })` |
| 取/还 | `pool.Get()` / `pool.Release(obj)` | `arr.pop()` / `arr.push()` | 数组 + `visible` | `group.get()` / `group.killAndHide()` |
| 重置 | 手动 `OnEnable` 重置 | `_ready` / 自定义 reset | `visible=true; position.set(...)` | `setActive(true); setVisible(true)` |

**坑**
- Unity：`ObjectPool<T>` 的 `CollectionCheck` 打开后，重复 Release 会抛异常——这是好事，别关。
- Godot：`queue_free()` 是延迟释放，池化时用 `hide()` + 复用，别 `queue_free`。
- Phaser：`group.get()` 返回的是复用对象，记得 `setActive(true).setVisible(true)` 并重置 `body.reset(x, y)`。
- three.js：`InstancedMesh` 不是池，是批量渲染；池化对象要显式设 `visible=false` 并跳过 update。

---

## 6. 状态机

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 推荐 | `enum State` + `switch` / Animator 子状态机 | 每个状态一个 `Node`，`_enter/_update/_exit` | 类 + 转移表 | 类 + 转移表 |
| 动画联动 | `Animator.Play(hash)` | `AnimationPlayer.play()` | `AnimationMixer` | `sprite.play()` |

**转移表结构（四引擎通用）**
```text
State: Idle / Run / Jump / Fall / Attack
transitions = {
  Idle:  {move: Run, jump: Jump, attack: Attack},
  Run:   {stop: Idle, jump: Jump, fall: Fall, attack: Attack},
  Jump:  {apex: Fall},          // 空中按攻击 → 无匹配 → 忽略
  Fall:  {ground: Idle},
  Attack:{done: Idle},
}
```

**坑**
- 不要在状态 `update` 里直接改另一个状态的字段，只发事件、由状态机统一转移。
- 切状态必须 `exit()` 旧状态（停动画、清计时器），否则「上一局的攻击后摇」会带进下一局。
- Unity 的 `Animator` 本身是状态机，但**游戏逻辑状态机和动画状态机不要混用**，两边不同步时最难查。

---

## 7. 判定与碰撞

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 射线 | `Physics.Raycast(o, d, out hit, dist, mask)` | `intersect_ray(PhysicsRayQueryParameters3D)` | `Raycaster.intersectObjects()` | 无 3D；2D 用 `overlap`/手写 |
| 形状扫描 | `Physics.SphereCast` / `BoxCast` | `intersect_shape` / `cast_motion` | 手写 sweep | 无 |
| 高速防穿墙 | `Rigidbody.collisionDetectionMode = ContinuousDynamic` | `RigidBody3D.continuous_cd = true` | 手写 swept / CCD | 无 swept；小步长只能降低概率，高速子弹必须自己 raycast/分段检测 |
| 判定框 | `Collider` + Layer + `OnTriggerEnter` | `Area3D` + collision layer/mask | 手写 AABB/球 | `body.setSize` + overlap |

**坑**
- Unity：`Physics.Raycast` 默认不检测 `Trigger`，要传 `QueryTriggerInteraction.Collide`。
- Unity LayerMask 写成 `1 << LayerMask.NameToLayer("Player")`，取反 `~(1 << layer)`。
- Godot 4：collision layer 和 mask 是两套位；`Area3D` 只触发 `body_entered`，不会阻挡。
- three.js：`Raycaster` 的 `far` 默认 `Infinity`，不设上限会命中整个场景；`setFromCamera` 用 NDC 坐标。
- Phaser：Arcade 物理用 AABB，旋转矩形会退化成更大的 AABB——需要精确判定改用 Matter 物理。

---

## 8. 寻路与群移动

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 导航 | `NavMeshAgent` + `NavMeshSurface`（Bake） | `NavigationAgent3D` + `NavigationRegion3D` | 自写 A* / 用 `three-pathfinding` | 自写 A* / `easystar.js` |
| 网格寻路 | 需装 NavMesh 或自写 | `AStarGrid2D` ✅ 内置 | 自写 | 自写 |
| 群体 | 手写 steering / `NavMeshAgent` 群体避障 | 手写 steering | 手写 steering | 手写 steering |

**坑**
- 用引擎 NavMesh 时它**不是 A***，是「烘焙好的导航网格 + 走廊寻路」；需要动态障碍时用 `NavMeshObstacle`（Unity）或 `NavigationObstacle3D`（Godot）。
- A* 的开放集一定要用堆，`Array.sort` 每次插入是 O(n log n)，几百个节点就卡。
- 每帧重算路径是性能杀手：路径缓存 + 目标移动超过阈值才重算。

---

## 9. 渲染：剔除 / LOD / 合批 / 图集

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 视锥剔除 | 自动（Renderer.bounds） | 自动 | 自动（`frustumCulled`, `boundingSphere`） | 自动（相机 culling） |
| 手动视锥 | `GeometryUtility.CalculateFrustumPlanes` | `Camera3D.is_position_in_frustum` | `Frustum.setFromProjectionMatrix(...).intersectsSphere()` | 无 |
| LOD | `LODGroup` 组件 | Project Settings → Mesh LOD（自动）+ `VisibilityRange` | `THREE.LOD.addLevel(mesh, dist)` | 手动切换网格/贴图（无内置 LOD） |
| 合批 | Static Batching / SRP Batcher / GPU Instancing | 自动 2D 批处理 + `MultiMeshInstance3D` | 手动合并 geometry / `InstancedMesh` | 自动批处理（同 texture） |
| 图集 | `SpriteAtlas` | `AtlasTexture` / 自动导入图集 | 无内置，需手写 UV 偏移或借助第三方图集工具（TexturePacker 等） | `this.load.atlas()` ✅ |

**坑**
- Unity：**`MaterialPropertyBlock` 会打断 SRP Batcher**，用 GPU Instancing 时要注意；URP 下优先 SRP Batcher 而不是 Dynamic Batching。
- Godot：`MultiMeshInstance3D` 不支持每个实例独立材质，只能靠 instance custom data。
- three.js：`InstancedMesh` 的 `instanceMatrix.needsUpdate = true` 忘了写 → 矩阵不更新；每帧改 `material.color` 会打断批处理。
- Phaser：批处理按「同一 texture + 同一 blend mode」分组，中间插一个不同图就会断批。

---

## 10. 大世界 / 生成

| | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 种子随机 | `System.Random(seed)` / `Unity.Mathematics.Random` | `RandomNumberGenerator.seed` | `mulberry32(seed)` | `Phaser.Math.RandomDataGenerator` |
| 噪声 | 自写 simplex / 第三方噪声库 | `FastNoiseLite` ✅ | 自写 simplex / `simplex-noise` | 自写 |
| 分块 | Scene 流式加载 / Addressables | `TileMapLayer` 手动加载 | 手动加载 mesh chunk | `tilemap` + 手动 |
| 异步 | `Addressables.LoadAssetAsync` / Job System | `WorkerThreadPool` / `ResourceLoader.load_threaded_request` | Web Worker / `fetch` | Web Worker |

**坑**
- Godot 4：`FastNoiseLite` 直接设 `seed` 即可复现，但 `noise_type` 变更会重置种子。
- 分块必须「加载半径 < 卸载半径」（滞回），否则玩家站在边界会无限加载卸载。
- 主线程创建几百个对象本身就卡：先异步读数据，再分批 `instantiate`（每帧 N 个）。

---

## 11. 调试与度量

| 目标 | Unity | Godot 4 | three.js | Phaser 3 |
|---|---|---|---|---|
| 帧时间 | Profiler / Frame Debugger | Profiler / Monitor | `performance.now()` 手写 | `game.loop.actualFps` |
| Draw call | Frame Debugger / Rendering Statistics | Monitor → Raster → Draw Calls | `renderer.info.render.calls` | 无官方计数器；用 Spector.js 抓帧 |
| Overdraw | Scene 视图 Overdraw 模式 | `Viewport.debug_draw = Viewport.DEBUG_DRAW_OVERDRAW` | Spector.js / RenderDoc | Spector.js |
| 内存 | Profiler → Memory | Monitor → Object Count | Chrome Memory | Chrome Memory |
| 可视化判定框 | Gizmos（`OnDrawGizmos`） | `DebugDraw`（社区插件）/ 调试碰撞形状可见 | `Box3Helper` / `BoxHelper` | `physics.world.createDebugGraphic()` |

---

## 12. 引擎选型速判

| 场景 | 推荐 | 理由 |
|---|---|---|
| 网页小游戏、要能发链接 | Phaser 3 / three.js | 零安装，DOM/Canvas 友好 |
| 2D 像素/平台跳跃，要快出原型 | Phaser 3 / Godot 4 | 内置 tilemap、物理、动画 |
| 3D 网页展示、可交互场景 | three.js | 生态大、示例多 |
| 完整 3D 游戏、要上主机 | Unity / Unreal | 工具链完整 |
| 独立 2D/3D、要轻量开源 | Godot 4 | 无授权费、GDScript 迭代快 |
| 已有 Web 前端团队 | three.js / PixiJS | 与现有技术栈一致 |

**跨引擎迁移时，先迁「时间与步长」，再迁「输入」，最后迁「渲染」**——反过来的话，你会在错误的手感基础上调参数。
