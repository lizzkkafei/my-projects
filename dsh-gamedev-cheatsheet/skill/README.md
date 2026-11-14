# Game Dev Cheatsheet · 游戏开发概念速查

一个可移植的 Agent Skill（SKILL.md + references）。把 **34 个游戏开发核心概念**变成 AI agent 能直接使用的「实现清单」：每个概念都有可粘贴的 prompt bit、引擎无关伪代码、关键参数和常见错误。

## 它解决什么问题

用 AI 写游戏，最贵的不是写代码，而是**不知道该要什么**。
「手感不对」「有点卡」「穿墙了」——这些描述无法直接变成代码。这个 skill 把每种模糊的抱怨映射到 2–5 个具体概念和一组可调参数。

## 结构

```
gamedev-cheatsheet/
├── SKILL.md                    # 入口：触发条件、四步工作流、任务→概念路由表、默认数值、12 个翻车点
└── references/
    ├── index.md                # 34 概念总索引 + 按症状反查
    ├── 3d-rendering.md         # 01–08 渲染
    ├── game-feel.md            # 09–18 手感
    ├── systems.md              # 19–27 系统
    ├── performance.md          # 28–34 性能
    ├── prompt-bits.md          # 34 条中英对照提示词
    ├── engine-mapping.md       # Unity / Godot / three.js / Phaser 落地 API
    ├── checklists.md           # 交付前自查清单 + 调参顺序
    └── ecosystem.md            # GitHub 同类资源地图
```

**渐进式加载**：agent 只读 SKILL.md（约 190 行）就能定位问题；需要细节时才打开对应 reference。不浪费上下文。

## 怎么用

装好后直接说人话即可，skill 会自动触发：

- 「帮我做个平台跳跃小游戏」→ 自动带上 coyote time / 输入缓冲 / 固定步长
- 「这个跳跃手感好硬」→ 定位到 game-feel，给出参数
- 「越玩越卡」→ 定位到对象池 / GC / overdraw
- 「敌人怎么老是穿墙」→ 穿透 + swept 检测

也可以显式调用：`/gamedev-cheatsheet` 或「用 gamedev-cheatsheet 检查这个游戏代码」。

## 安装

```bash
# 方式一：直接复制
cp -R gamedev-cheatsheet ~/.agents/skills/

# 方式二：软链接（保留单一副本，改了立即生效）
ln -s "$PWD/gamedev-cheatsheet" ~/.agents/skills/gamedev-cheatsheet
```

装完重启会话即可被发现。

## 内容来源

- 概念骨架、prompt bits、伪代码、常见错误：[gamedev-cheatsheet.com](https://gamedev-cheatsheet.com)（作者 Nicolas Zullo）—— 34 个概念的交互式可视化速查站，定位就是「给用 AI 做游戏的人」。
- 引擎落地、数值、工程结构参考：[awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills)、[game-programming-patterns](https://github.com/munificent/game-programming-patterns)、[claude-game-skills](https://github.com/Xyloforge/claude-game-skills) 等，详见 `references/ecosystem.md`。
- 中文详解、参数表、自查清单、路由表为本次整理新增。

## 边界

- 参数是**社区验证过的起点**，不是普适真理；写死前先问用户想要什么手感。
- 这里讲的是**运行时行为**，不覆盖美术资产、音效制作、构建发布。
- 示例是教学用的最小实现，不是生产级引擎代码。
