---
name: gamedev-cheatsheet
description: 游戏开发概念速查与施工检查表——34 个「AI 写游戏时最容易漏掉」的概念，每个都带可粘贴的 prompt bit、引擎无关伪代码和常见错误。做游戏、写游戏原型、调手感、优化性能、写角色控制器、搭战斗/物理/寻路/AI/粒子系统时使用；覆盖 Unity、Godot、Unreal、three.js、Phaser、PixiJS、Web Canvas 等。触发词：做游戏、游戏原型、平台跳跃、roguelike、塔防、手感、跳跃、打击感、卡顿、掉帧、GC、优化、对象池、状态机、寻路、粒子、hitbox、相机、摇杆、vibe coding 游戏、game dev、game feel、platformer、shader、physics、delta time、LOD、draw call。
---

# Game Dev Cheatsheet · 34 个概念速查

这不是一本游戏开发百科全书，而是**「概念 → 可执行做法」的速查卡 + 施工检查表**。

判断标准只有一条：**读完这一页，你能不能立刻写出更对的代码？** 不能就跳过。

核心使用方式：先用下面的路由表定位 2–5 个相关概念，再读对应的 reference 文件拿伪代码和引擎映射，最后对照「自查清单」验收。

---

## 何时用这个 skill

**该用**：
- 用户要**做游戏**或**改游戏**（网页小游戏、Unity/Godot/Unreal 项目、three.js/Phaser/PixiJS 场景）
- 用户抱怨**手感**：跳不起来、落地粘滞、打击软、相机晃、转视角晕
- 用户抱怨**性能**：掉帧、卡顿、越玩越卡、手机上发烫
- 要写**角色控制器 / 战斗系统 / 敌人 AI / 寻路 / 粒子 / 关卡流式加载**
- 用户说「用 AI 做个游戏」但没给技术词——你需要替他把术语补上，才能写出对的东西
- 代码评审游戏项目，想快速判断哪里「不像游戏代码」

**不该用**：
- 纯美术/音效资产制作（这里只有少量渲染相关）
- 引擎安装、构建流水线、商店上架
- 与运行时行为无关的 Web/后端开发

**一句话**：只要代码**每帧都在跑**，这个 skill 就用得上。

---

## 工作流（四步，不要跳）

### Step 1 · 定性：问题在哪一层

| 用户的原话 | 大概率是这一层 |
|---|---|
| 「跳不高」「落地滑」「被打没感觉」 | 手感层（game feel） |
| 「卡」「掉帧」「发热」「越玩越卡」 | 性能层（performance） |
| 「穿墙」「打不中」「敌人卡住」 | 系统层（systems） |
| 「看不见」「闪烁」「边缘锯齿」「转视角晕」 | 渲染层（3D & rendering） |

四层不是孤立的：**手感靠固定步长兜底，性能靠对象池和批处理兜底**。先定位主问题，再补一条兜底。

### Step 2 · 路由：查表找概念

按下面的表找到 2–5 个概念，去 `references/` 读对应小节。**不要一次读完整本**，按需加载。

### Step 3 · 落地：用 prompt bit 的结构写代码

每条概念都有一条 `prompt bit`——一句结构完整的英文提示词，写清了**用什么、参数多少、边界条件**。写代码前先把它翻译成实现清单：

```
动作（raycast / pool / step）+ 关键参数（0.12s / 60Hz / 2048px）+ 边界处理（clamp / skip / reset）
```

然后按目标引擎改 API（见 `references/engine-mapping.md`）。**参数是起点，不是真理**——写死之前先问用户的手感偏好。

### Step 4 · 自查：跑清单

写完不要直接交付。跑 `references/checklists.md`：
- 帧率无关性（所有速度 × dt）
- 生命周期（对象池 / 事件解绑 / 状态退出）
- 边界（dt 钳制、穿透、除零）
- 验收（60fps 预算、手感参数可调）

---

## 路由表：用户说什么 → 先读什么

| 用户说的场景 / 症状 | 先读 | 关键概念 |
|---|---|---|
| 平台跳跃、跑酷、角色移动 | `references/game-feel.md` | delta time · coyote time · 输入缓冲 · 加速与摩擦 |
| 「打击感不够」「打上去没反馈」 | `references/game-feel.md` | hit stop · 屏幕震动 · 挤压拉伸 · 无敌帧 |
| 相机跟随、晕 3D、画面抖 | `references/game-feel.md` | 相机死区 · 缓动 · 屏幕震动 |
| 菜单/UI 动画生硬 | `references/game-feel.md` | 缓动（easing） |
| 掉帧、卡顿、手机发热 | `references/performance.md` | 帧预算 · draw call · overdraw · 空间划分 |
| 子弹/粒子/敌人「越玩越卡」 | `references/systems.md` | 对象池 · 粒子系统 · 时间切片 |
| 角色状态乱、动画打断、`isJumping && isAttacking` | `references/systems.md` | 有限状态机 |
| 敌人寻路、绕障、群体移动 | `references/systems.md` | A* · 转向行为 |
| 打不中、穿墙、高速子弹漏检测 | `references/systems.md` | 穿透（tunneling）· 射线检测 · hitbox/hurtbox |
| 物理爆炸、弹簧发散、回放不同步 | `references/systems.md` | 固定步长 · delta time |
| 地图/世界生成、存档复现 | `references/systems.md` | 种子噪声 · 分块流式加载 |
| 物体闪烁、边缘闪烁、地面贴花 | `references/3d-rendering.md` | Z-fighting · 法线 |
| 远处物体太吃性能 / 突然消失 | `references/3d-rendering.md` | LOD · 视锥剔除 |
| 血条/名字/伤害数字看不清 | `references/3d-rendering.md` | billboarding |
| 旋转插值乱转、转身抽搐 | `references/3d-rendering.md` | 四元数 |
| 水面/描边/扫描线/全屏特效 | `references/3d-rendering.md` | 片元着色器 |
| 点击选中、视线检测、地面探测 | `references/3d-rendering.md` + `systems.md` | 射线检测 · 法线 |
| 加载慢、内存大、大世界 | `references/performance.md` + `systems.md` | 贴图图集 · 分块流式加载 |

---

## 34 概念总索引

完整索引（含一句话定义、锚点、关键词）在 `references/index.md`。四章速览：

**3D & rendering（8）** — 3D 场景怎么变成像素，怎么少画
`raycasting` 射线检测 · `normals` 法线 · `level-of-detail` LOD · `frustum-culling` 视锥剔除 · `fragment-shader` 片元着色器 · `billboarding` 面向相机 · `quaternions` 四元数 · `z-fighting` Z 冲突

**Game feel（10）** — 让跳跃、打击、相机符合直觉
`delta-time` 帧时间 · `coyote-time` 土狼时间 · `easing` 缓动 · `screen-shake` 屏幕震动 · `squash-and-stretch` 挤压拉伸 · `camera-deadzone` 相机死区 · `input-buffering` 输入缓冲 · `acceleration-and-friction` 加速与摩擦 · `hit-stop` 命中停顿 · `invincibility-frames` 无敌帧

**Systems（9）** — 角色、战斗、移动、物理的代码骨架
`object-pooling` 对象池 · `state-machine` 状态机 · `hitbox-hurtbox` 判定框 · `pathfinding` A* 寻路 · `particle-system` 粒子系统 · `fixed-timestep` 固定步长 · `steering-behaviors` 转向行为 · `tunneling` 穿透 · `seeded-noise` 种子噪声

**Performance（7）** — 16.67ms 花在哪，怎么少花
`frame-budget` 帧预算 · `draw-calls` 绘制调用 · `spatial-partitioning` 空间划分 · `overdraw` 过度绘制 · `time-slicing` 时间切片 · `texture-atlas` 贴图图集 · `chunk-streaming` 分块加载

---

## 默认数值速查（先抄，再调）

这些数字是社区验证过的**起点**，写进代码时做成可调常量。

| 参数 | 默认值 | 概念 |
|---|---|---|
| 物理步长 | 固定 1/60 s | fixed-timestep |
| 单帧 dt 钳制 | 0.05 s（防瞬移；后台切回 ≤0.1 s） | delta-time |
| 物理累加器上限 | 0.25 s（防 spiral of death） | fixed-timestep |
| Coyote time | 0.10–0.15 s，用一次即失效 | coyote-time |
| 输入缓冲 | ~0.10 s | input-buffering |
| 加速到满速 | 0.1–0.2 s；松手减速 ~0.1 s | acceleration-and-friction |
| 反向刹车 | 2× 减速；空中减半 | acceleration-and-friction |
| Hit stop | 50–100 ms（按伤害缩放） | hit-stop |
| 无敌帧 | 0.5–1.0 s，闪烁 ~10 Hz | invincibility-frames |
| 屏幕震动 | trauma 0→1，-hit 加 0.3–0.6，1/s 衰减，offset ∝ trauma² | screen-shake |
| 相机死区 | 屏幕中心约 1/4 宽 | camera-deadzone |
| 挤压拉伸 | 速度方向 1.3×，落地 0.7×，0.15 s 回弹，反向轴取倒数（2D 保面积；3D 用 1/√s） | squash-and-stretch |
| UI 缓动 | ~0.3 s easeOutCubic | easing |
| 相机近裁剪面 | ≥ 0.1（别用 0.01） | z-fighting |
| 贴花偏移 | 沿法线抬高 ~1 cm，或 polygon offset(-1, -4) | z-fighting |
| 地面判定 | 法线 up 分量 > 0.7（≈45°） | normals |
| 贴图图集 | 2048×2048，每个 sprite 留 2px padding | texture-atlas |
| 分块 | 32×32 tiles，加载半径 2 块，卸载 > 3 块（滞回） | chunk-streaming |
| 空间网格 | 单元格 ≈ 最大物体尺寸的 2 倍 | spatial-partitioning |
| 时间切片 | 4–8 个 bucket，每帧处理 1 个 | time-slicing |
| 数组遍历时 | 所有速度 × dt；平滑用 `1 - exp(-k*dt)` 而非固定 lerp 系数 | delta-time |

---

## AI 写游戏的 12 个高频翻车点

做代码评审时，先扫这 12 条，命中率高得惊人：

1. **按帧移动**：`x += speed` 而不是 `x += speed * dt` → 高刷屏上游戏变快
2. **`Math.random()` 生成世界** → 存档无法复现、调试不可复现
3. **每帧 `new` 对象**（子弹、粒子、向量）→ GC 抖动、越玩越卡
4. **只用布尔量描述角色状态** → `isJumping && isAttacking && isDead` 同时为真
5. **高速物体只测端点重叠** → 子弹穿墙
6. **用欧拉角插值旋转** → 大角度绕远路、万向节锁
7. **屏幕震动每帧取随机数** → 抖动像癫痫，而不是冲击
8. **相机硬跟玩家** → 微操时画面一直晃
9. **粒子/特效不池化、不限量** → 战斗中帧率断崖
10. **透明大 sprite 叠很多层** → overdraw 打爆手机 GPU
11. **跳跃只判断「当前在地面」** → 手感发硬，玩家骂「跳不起来」
12. **把 `dt` 直接喂给物理** → 高帧率下物理软、低帧率下穿模

每条都对应一个概念，去 `references/` 找修法。

---

## 不在本 skill 覆盖范围（以及去哪找）

这 34 个概念只管「每帧在跑的东西」。以下高频需求不在里面，**别硬套参数**：

- **联机 / 网络同步 / 延迟补偿** —— 完全没有，先确认引擎网络能力，再查 netcode 专题
- **存档系统 / 存档槽 / 版本迁移** —— 只有 `seeded-noise` 讲了「世界只存种子」，存档结构要单独设计
- **音效 / 音乐 / 混音** —— 不在范围
- **UI 布局 / 响应式 / 安全区 / 刘海屏** —— 这里只有 UI **动画**（`easing`）
- **触屏 / 虚拟摇杆 / 手柄重绑定 / 无障碍** —— 只有输入**缓冲**
- **骨骼动画 / 动画混合 / 光照阴影 / 后处理** —— 只有 `quaternions`、`fragment-shader` 沾边
- **关卡设计 / 节奏 / 叙事** —— 不是代码问题

遇到这些，明确告诉用户「这部分不在本 skill 范围」，给方向而不是现编数值。

## 文件导航

| 文件 | 什么时候读 |
|---|---|
| `references/index.md` | 想按关键词/中英文名反查概念，看一句话定义 |
| `references/3d-rendering.md` | 渲染、剔除、LOD、着色器、四元数、Z-fighting |
| `references/game-feel.md` | 跳跃、输入、相机、打击感、缓动、震动 |
| `references/systems.md` | 对象池、状态机、寻路、物理步长、粒子、生成 |
| `references/performance.md` | 帧预算、draw call、空间划分、overdraw、流式加载 |
| `references/prompt-bits.md` | 34 条可直接粘贴的提示词（中英对照） |
| `references/engine-mapping.md` | Unity / Godot / three.js / Phaser 具体 API 与坑 |
| `references/checklists.md` | 交付前自查：手感、性能、生命周期、边界 |
| `references/ecosystem.md` | GitHub 同类资源地图，想深挖时读 |

---

## 交付前最后三问

1. **换一台 30fps 的机器，手感还一样吗？**（帧率无关）
2. **连玩 10 分钟，帧率会掉吗？**（内存与对象生命周期）
3. **参数写死在哪？用户想调手感时改得动吗？**（可调性）

三个都答「是」，可以交付。
