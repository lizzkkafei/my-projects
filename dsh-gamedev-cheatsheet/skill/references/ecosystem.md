# GitHub 生态地图

> 这个 skill 不是孤岛。下面是「同类 / 互补 / 深挖」三类资源，以及它们的**可复用经验**。
> 检索时间：2026-11；star 数为该时间点快照，会变。

---

## 1. 同类与互补仓库

| 仓库 | ★ | 许可 | 定位 | 与我们这个 skill 的关系 |
|---|---|---|---|---|
| [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | 6.7k | Apache-2.0 | 77 个游戏开发 SKILL.md + 一个 router，覆盖 12 个引擎（Godot/Unity/Unreal/Phaser/PixiJS/three.js/Bevy/LÖVE/pygame/Defold/Roblox/Ebitengine） | **最值得对照**：它给「引擎 API 级」深度，我们给「概念与手感」深度，两者互补。装一个它 + 一个我们，覆盖面和纵深都够 |
| [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | 34.3k | MIT | 把单个会话变成「49 agents + 74 skills（README 自述）」的游戏工作室，含制片/设计/程序/QA 的协作体系 | 组织方式参考（多角色分工 + 工作流），不是知识来源 |
| [Xyloforge/claude-game-skills](https://github.com/Xyloforge/claude-game-skills) | 2 | MIT | 2 个大 skill + 类型指南：`game-detail-bar`（品质红线：相机、反馈、音效、动画、UI、无障碍、移动端性能）+ `game-asset-pipeline`（美术/音效资产流水线） | **数值与检查项来源**：它的规则全部写成「数字而不是形容词」，本 skill 的默认参数表与部分清单参照了它的取值 |
| [munificent/game-programming-patterns](https://github.com/munificent/game-programming-patterns) | — | 见仓库 | 《Game Programming Patterns》全书源码/正文（状态、组件、更新方法、游戏循环、命令、享元、观察者、事件队列、服务定位器、原型、单例、双缓冲、空间划分） | 工程模式的权威补充；本 skill 只讲「概念 → 做法」，模式细节去这里 |
| [Unity-Technologies/game-programming-patterns-demo](https://github.com/Unity-Technologies/game-programming-patterns-demo) | — | 见仓库 | 上述模式在 Unity 里的可运行示例 | 想把某条系统概念落成 C# 时看它 |
| [IvanMurzak/Unity-MCP](https://github.com/IvanMurzak/Unity-MCP) | 4.6k | 见仓库 | Unity 的 MCP + AI 工具链，让 agent 直接操作编辑器 | 工具层，不是知识层；真做 Unity 项目时再引入 |
| [jame581/GodotPrompter](https://github.com/jame581/GodotPrompter) | 923 | 见仓库 | Godot 4.x 的 agentic skills 框架 | Godot 栈的同类物，可与本 skill 并存 |

**一句话分工**：本 skill 负责「**该不该做、参数大概多少、常见坑是什么**」；awesome-gamedev-agent-skills 负责「**这个引擎里 API 怎么写**」。遇到既没有概念方向、又没有引擎细节的问题，先读本 skill 定方向，再读引擎 skill 落地。

---

## 2. 从这些仓库学到的 SKILL.md 工程经验

以下来自 [Agent Skills 规范](https://agentskills.io/specification) 与 `awesome-gamedev-agent-skills/docs/SKILL-FORMAT.md`：

**目录契约**：一个 skill 一个目录，目录名 = frontmatter 的 `name`。
```
skill-name/
├── SKILL.md        # 必需，激活时整篇加载
├── references/     # 可选，按需加载的深度内容
├── scripts/        # 可选，确定性脚本
└── assets/         # 可选，模板/素材
```

**frontmatter**：只写 `name` + `description` 最稳（各客户端兼容性最好）。
- `name`：1–64 字符，小写字母/数字/连字符，不能首尾连字符，**必须等于目录名**。
- `description`：非空、≤1024 字符，必须同时说清 **「做什么」+「何时用」**，并包含具体触发词（文件名、API、任务短语、症状）。不写营销话术，不用 XML 尖括号。

**正文结构**（按推荐顺序）：
1. 一段话说明产出与目标版本
2. 何时用 / 何时不用（含「相邻但不属于我」的任务）
3. 有顺序的工作流：动代码前先检查什么
4. 少量正确示例
5. 坑写成「症状 → 可能原因 → 修法」
6. 指向 references 的链接，说明**什么时候**读

**长度**：`SKILL.md` < 500 行 / ≈5000 tokens，因为激活时整篇进上下文；其余全部下沉到 references。references 之间可以横向互链，但**不应要求按顺序串联阅读**。

**描述要带触发词**：router 仓库的 description 把 12 个引擎名、常见任务、游戏类型全列了进去——这不是啰嗦，是让路由能命中。

**路由设计**（`router/SKILL.md`）：
- 用**项目指纹**判引擎（`project.godot`、`*.uproject`、`Assets/` + `ProjectVersion.txt`、`package.json` 里的 `phaser`/`three`/`pixi.js`……），判不出就问。
- 引擎是**互斥单选**，学科/类型/工作流是**叠加**。
- 加载顺序固定：引擎基础 → 学科概念 → 类型胶水 → 工作流。
- 只在话题**转向**时重新路由，不要每轮都跑。

**规则要可执行**：「数字而不是形容词」。反面例子是「让相机更平滑」，正面是「平滑 k=10–20，用 `1-exp(-k*dt)`，不要固定系数 lerp」。

---

## 3. 可借用的具体数值（带出处）

以下取值来自 `Xyloforge/claude-game-skills` 的 `game-detail-bar`，与本 skill 的默认值互相印证：

| 项 | 取值 | 出处 |
|---|---|---|
| 输入缓冲 | 约 0.15 s，且**恰好生效一次**；提前按不能吞，最后一次按不能跳过 | `game-detail-bar/SKILL.md` |
| 输入延迟容忍 | 超过约 50 ms 玩家能感知到「不跟手」 | 同上 |
| UI 动效时长 | 150–300 ms；进入用 ease-out，退出用 ease-in | 同上 |
| 血条受击 | 掉血块闪烁 → 停约 0.3 s → 再下降（ghost 段） | 同上 |
| 帧时间目标（手机） | 中位帧≈16.7 ms；移动/首次遭遇时不允许出现 >50 ms 的帧；300 个对象时逻辑 <2 ms | 同上 |
| 首次使用卡顿 | 解码美术、编译 shader、加载字体、填充池等一次性工作，若在游玩中触发常造成 ≥100 ms 卡顿 → 放到加载屏/菜单预热 | 同上 |
| 帧率无关验证 | 强制 30/60/144 fps 跑同一组输入，比较跳高、位移、计时 | 同上 |
| 闪烁频率（i-frames 视觉） | 约 8–12 次/秒足够 | 同上 |

> 这些是**起点值**。不同游戏类型（格斗 vs 平台跳跃 vs 射击）差别很大，写死前先问用户要什么手感。

---

## 4. 延伸阅读（按主题）

**通用**
- [Agent Skills 规范](https://agentskills.io/specification) — skill 文件的标准
- [Gaffer On Games: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) — 固定步长与插值的经典文章
- [Game Programming Patterns（在线阅读）](https://gameprogrammingpatterns.com/) — 模式原文

**寻路 / 程序化生成**
- [Red Blob Games: A* 交互教程](https://www.redblobgames.com/pathfinding/a-star/introduction.html) — 目前最好的 A* 可视化讲解
- [Red Blob Games: 地图生成](https://www.redblobgames.com/maps/terrain-from-noise/) — 噪声地形

**手感**
- [The Art of Screenshake（Jan Willem Nijman, GDC）](https://www.youtube.com/watch?v=AJdEqssNZ-U) — 屏幕震动与打击感
- [Game Feel（Steve Swink）](https://www.goodreads.com/book/show/3385054-game-feel) — 手感理论
- [Juice it or lose it（Martin Jonasson & Petri Purho）](https://www.youtube.com/watch?v=Fy0aCDmgnxg) — 30 分钟讲清「加汁」

**渲染 / 引擎**
- [three.js 手册](https://threejs.org/manual/) / [three.js 示例](https://threejs.org/examples/)
- [Godot 4 文档](https://docs.godotengine.org/) / [Unity 手册](https://docs.unity3d.com/Manual/index.html)
- [LearnOpenGL](https://learnopengl.com/) — 深度/法线/光照原理的最好入门

**性能**
- [Unity: Optimizing draw calls](https://docs.unity3d.com/Manual/optimizing-draw-calls.html)
- [Godot: Optimization using MultiMesh](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html)

---

## 5. 如果要继续扩展这个 skill

优先级从高到低：
1. **加引擎专属 references**（Unity/Godot/three.js/Phaser 各一份），把 `engine-mapping.md` 拆细。
2. **加类型指南**（platformer / roguelike / 塔防 / 射击），像 `claude-game-skills` 的 `genres/` 那样，放「这个类型的默认参数组合」。
3. **加脚本**：一个只读的项目体检脚本（扫描项目里的 `new` 热点、缺 dt 的移动、无池化粒子），输出 `ERROR/WARNING`。规范见 `awesome-gamedev-agent-skills/docs/SKILL-FORMAT.md` 的 scripts 一节。
4. **接入评测**：用「强制 30/60/144 fps 跑同一组输入」做回归，验证改动没有破坏帧率无关性。
