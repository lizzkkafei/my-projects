# 交付前自查清单

> 用法：写完游戏代码，逐条过。**命中任何一条 ❌ 都别交付**，去对应 reference 修。
> 每条后面的 `→` 指向概念文件。

---

## A. 帧率无关性（最高优先级）

- [ ] 所有位移都用 `速度 × dt`，没有任何「每帧固定像素/固定米」的移动 → `delta-time`
- [ ] 所有计时器都在累加 `dt`，不是数帧数 → `delta-time`
- [ ] 平滑跟随用 `1 - exp(-k * dt)`，不是固定系数 lerp（`lerp(a, b, 0.1)` 在 30fps / 144fps 上手感不同）→ `delta-time`
- [ ] `dt` 被钳制（≤ ~0.05 s 或后台切回时钳到 0.1 s），防止切标签页回来瞬间穿越 → `delta-time`
- [ ] 物理用固定步长（1/60）+ 累加器，渲染插值，不是把原始 dt 喂给物理 → `fixed-timestep`
- [ ] 800×600 窗口和 4K 全屏下，跳跃高度一致

**自测**：把浏览器降到 30fps（DevTools → Rendering → Frame rate），再跑一次。手感变了 = 不合格。

---

## B. 手感三件套（平台/动作游戏必查）

- [ ] **Coyote time**：走出平台后 0.1–0.15 s 内仍可起跳，且只能生效一次 → `coyote-time`
- [ ] **输入缓冲**：落地前 0.1 s 内按的跳跃键，落地瞬间执行；一次按键只触发一次 → `input-buffering`
- [ ] **加速/减速**：速度不是瞬间赋值，有加速段（0.1–0.2 s）和减速段（~0.1 s）；反向输入刹车更快（2×）→ `acceleration-and-friction`
- [ ] 空中控制比地面弱（通常减半），但没有完全锁死
- [ ] 跳跃有「可变高度」：松开跳跃键提前结束上升（短按小跳、长按大跳）

**自测**：闭眼听按键声，不应该出现「明明按了却没跳」。

---

## C. 打击感

- [ ] **Hit stop**：命中瞬间双方（或至少攻击方）动画/位移冻结 50–100 ms，UI 和粒子继续跑 → `hit-stop`
- [ ] **屏幕震动**：由一个 `trauma` 值驱动（命中 +0.3~0.6，每秒衰减 1），offset ∝ trauma²，用平滑噪声不是每帧随机 → `screen-shake`
- [ ] 震动幅度可关（无障碍/设置项）
- [ ] **无敌帧**：受伤后 0.5–1 s 免伤 + 闪烁，且闪烁不是每帧随机开关（用 10 Hz 方波）→ `invincibility-frames`
- [ ] 受击有击退，方向 = 伤害源 → 玩家
- [ ] 命中有 hitbox/hurtbox 判定，且「一次挥砍对同一目标只结算一次」→ `hitbox-hurtbox`

---

## D. 相机

- [ ] 相机跟随有**死区**（玩家在屏幕中心 1/4 宽内移动，相机不动）→ `camera-deadzone`
- [ ] 相机移动有平滑（easing/阻尼），不是硬贴
- [ ] 震动/晃动应用在**相机局部偏移**，不污染相机逻辑位置（否则跟随会漂）
- [ ] 转视角不晕：无非预期的 roll，转头时有阻尼
- [ ] 相机近裁剪面 ≥ 0.1（0.01 会让远处深度精度崩掉）→ `z-fighting`

---

## E. 性能

- [ ] 有帧预算测量：input / update / physics / render 各占多少 ms，能否在帧内看到 → `frame-budget`
- [ ] 单帧 < 16.67 ms（60fps）或 < 8.3 ms（120fps）；移动端目标 30fps 时 < 33 ms
- [ ] 热点循环里**没有** `new` / 字符串拼接 / 数组扩容 / `getComponent` 反复查找 → `object-pooling`
- [ ] 子弹、粒子、伤害数字、特效**全部走对象池**，池耗尽时有告警而不是静默 `new` → `object-pooling`
- [ ] 重复静态物体用 instancing 或合批；draw call 数量不随物体数线性增长 → `draw-calls`
- [ ] 碰撞检测用宽相位（空间网格/四叉树），不是 O(n²) 全量两两测试 → `spatial-partitioning`
- [ ] 透明粒子：限制同屏数量、收紧 quad 边界、必要时降半分辨率渲染 → `overdraw`
- [ ] 贵操作（AI 决策、寻路）按 bucket 分摊到多帧 → `time-slicing`
- [ ] 贴图合并进 atlas，同材质批处理 → `texture-atlas`
- [ ] 大世界只加载玩家附近的分块，且有卸载滞回（防边界反复加载）→ `chunk-streaming`
- [ ] 物体池/场景切换后，内存不持续增长（连跑 10 分钟测）

**自测**：DevTools Performance 录 60 秒，看有没有 GC 尖刺（锯齿状内存曲线 = 不合格）。

---

## F. 物理与碰撞

- [ ] 高速物体（子弹、冲刺）用 swept 检测 / raycast / CCD，不是端点重叠 → `tunneling`
- [ ] 物理步长固定，累加器上限钳制（防止 tab 切回来跑 1000 步卡死）→ `fixed-timestep`
- [ ] 地面判定用法线（`normal.up > 0.7`）而不是只看 y 坐标 → `normals`
- [ ] 不要在两块共面几何体上放贴花（z-fighting），贴花抬高或 polygon offset → `z-fighting`
- [ ] 凹陷/斜坡/台阶有专门的碰撞处理，不靠运气

---

## G. 结构与生命周期

- [ ] 角色/敌人有明确状态机：一个状态在跑，转移表显式，非法事件被忽略 → `state-machine`
- [ ] 状态有 `enter/update/exit`，切换时资源正确释放（停止动画、清除计时器）
- [ ] 事件监听在对象销毁时解绑（否则内存泄漏 + 幽灵回调）
- [ ] 对象池回收时重置全部字段（位置、速度、生命值、颜色、计时器），不会「带着上一局的血量复活」
- [ ] 随机数来自种子化 PRNG，世界生成不调用 `Math.random()` → `seeded-noise`
- [ ] 存档只存种子 + 玩家改动，不存整个世界 → `seeded-noise`

---

## H. 渲染正确性（3D）

- [ ] 物体进视野才画（视锥剔除），远处用 LOD，切换距离有 10% 滞回防闪烁 → `frustum-culling` / `level-of-detail`
- [ ] 朝向 / 世界空间旋转用四元数，插值用 slerp，且做 `dot < 0` 取反（短弧）→ `quaternions`
- [ ] 面向相机的 UI（血条、名字）用 billboard，竖直 sprite 只绕 Y 轴转 → `billboarding`
- [ ] 表面光照用法线，没有「背面全黑」或「法线朝内」
- [ ] 片元着色器暴露参数（uTime、speed、颜色）为 uniform，不写死 → `fragment-shader`

---

## I. 可调性（决定这个游戏能不能「调」

- [ ] 所有手感/性能参数集中在配置文件或 `export` 常量里
- [ ] 关键参数有调试面板（dat.GUI / lil-gui / Unity Inspector / Godot Remote）
- [ ] 数值有注释说明「这个值控制什么」
- [ ] 画面/震动/闪烁有可关闭选项（无障碍）

---

## 调参顺序（别乱调）

1. **帧时间**：先保证 dt 正确、物理固定步长 → 否则后面调什么都在飘
2. **速度与加速**：最大速度、加速度、减速 → 决定「角色多重」
3. **跳跃**：跳跃初速、重力、可变高度 → 决定「关卡尺度」
4. **宽容度**：coyote time、输入缓冲 → 决定「菜鸟友好度」
5. **反馈**：hit stop、震动、挤压拉伸 → 决定「爽度」
6. **性能**：最后再做，且必须用真实场景量测

---

## 跨引擎验收差异

| 项 | Unity | Godot 4 | three.js / Web |
|---|---|---|---|
| dt 来源 | `Time.deltaTime` | `delta`（`_process`） | `clock.getDelta()` |
| 物理步长 | `fixedDeltaTime` (0.02) | `physics_ticks_per_second` (60) | 手动累加器 |
| 物理更新位置 | `FixedUpdate` | `_physics_process` | 手动 step |
| 池 | 自建或 `UnityEngine.Pool` | 自建 `Node` 复用 | 自建数组 |
| 批处理 | Static/Dynamic Batching、SRP Batcher | MultiMesh / 2D batching 自动 | InstancedMesh / merge geometries |
| 空间划分 | 物理引擎内置 broadphase | 物理引擎内置 | 自建网格/四叉树 |

细节见 `engine-mapping.md`。
