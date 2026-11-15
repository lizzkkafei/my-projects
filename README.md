# my-projects

DSH（DeepSeek Harness）插件与项目集合。

## 插件

### zhizhen-cut · 切线 Cutline

从 DSH 会话进入的单窗口视频剪辑工作台。

- 多视频导入、磁吸时间线修剪/分割/重排、掠视预览
- 对白 / 音乐 / 环境声角色混音与自动闪避
- 本地音频静音检测粗剪、脚本字幕自动排轨、9 种智能调色
- 竖屏素材自动建立 9:16 序列；专业模式角色泳道
- 默认导出 MP4（H.264 + AAC），支持 1080p/720p/4K

目录：[`zhizhen-cut/`](zhizhen-cut/)

```bash
cd zhizhen-cut
node scripts/build.mjs
node --test tests/engine.test.mjs
```

安装后刷新 DSH 页面以载入最新 client bundle。

### zhizhen-liyin · 理音 Liyin Studio

从 DSH 会话进入的 AI 音乐创作工作台，Logic 风格界面、中文优先。

- 多轨 MIDI / 音频 / 鼓机编排，段落标记、片段拖动、撤销历史、自动保存
- 钢琴卷帘（加/移/删音符、1/16 量化、试听）、16 步鼓机、大谱表五线谱（和弦 + 段落 + PNG 导出）
- 立体声录音与多 take 合成（权重混合、自动对齐、软限幅）
- 混音台 + 音量/声像/混响/延迟四条自动化曲线，播放与离线渲染均生效
- 智能辅助：本地歌词/编曲生成器（五种风格、三个可调滑杆），并可调用本机 ACE-Step 1.5 生成整首歌
- 导出母带 / 分轨 ZIP / 主唱干声 / 伴奏，带 −14 / −16 / −9 LUFS 响度规范化
- 自带《镜湖》示例工程：72 BPM / A 小调 / 68 小节 + 4 条 AI 生成音频

目录：[`zhizhen-liyin/`](zhizhen-liyin/)

```sh
dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/zhizhen-liyin
```

安装后重启 DSH，会话输入框左侧出现「理音」按钮（或按 ⌥M）。

### dsh-gamedev-cheatsheet · 游戏开发速查

可安装的 DSH 插件：给 agent 装一套 34 个概念的游戏开发技能包。

- 四层结构：3D 与渲染（8）/ 手感（10）/ 系统（9）/ 性能（7）
- 每个概念带：定义 → 何时用 → 何时**别**用 → 可粘贴提示词 → 引擎无关伪代码 → 常见错误 → 调参数值
- 附带「症状 → 概念」路由表、默认数值表、AI 写游戏最高频的 12 个坑、交付前自查清单
- 引擎映射覆盖 Unity、Godot 4、three.js、Phaser 3
- 中英双语，激活时把技能投递到 `<DSH_AGENTS_HOME 或 ~/.agents>/skills/gamedev-cheatsheet`

目录：[`dsh-gamedev-cheatsheet/`](dsh-gamedev-cheatsheet/)

```sh
dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/dsh-gamedev-cheatsheet
```

安装后重启宿主并新开会话，技能目录里会出现 `gamedev-cheatsheet`。

## 游戏

### zhizhen-cardgame · 小丑之桌 JESTER'S TABLE

可安装的 DSH 插件：从会话输入框左侧点「游戏」（或按 ⌥G）进入全屏三维扑克 Roguelike 牌桌，用 20 种小丑牌改写「筹码 × 倍率」，撑过 6 层底注。

- Three.js 实时 3D 牌桌，发牌 / 出牌 / 结算动画与辉光后期全部由代码生成
- 12 种牌型判定，小丑从左到右逐个结算；纯逻辑与渲染分离
- 6 层底注 × 小/大/BOSS 盲注，6 种 BOSS 干扰效果；商店买卖与重掷、金钱利息
- 20 种小丑牌、5 个携带槽位；WebAudio 程序化音效
- 牌桌挂在 Shadow DOM 中，样式与元素 id 不和 DSH 界面互相污染；关闭时清理渲染循环、窗口事件与 AudioContext
- 全部资源打包进单文件 client bundle，无外部网络依赖（Three.js 与字体已本地化）

目录：[`zhizhen-cardgame/`](zhizhen-cardgame/)

安装（插件市场收录后也可在 设置 → 插件 → 插件市场 搜索 `zhizhen-cardgame`）：

```sh
dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/zhizhen-cardgame
```

单独玩（不经过 DSH）：macOS 双击 [`启动游戏.command`](zhizhen-cardgame/启动游戏.command)，或本地起静态服务：

```bash
cd zhizhen-cardgame
python3 -m http.server 8899
# 浏览器打开 http://localhost:8899/index.html
```

### zhizhen-pool · 桌面台球 黑八

可安装的 DSH 插件：从会话输入框左侧点「台球」（或按 ⌥P）展开全屏三维 8 球球台，按 WPA 规则与 AI 对手对局。

- 9ft 比赛台（2.54 × 1.27 m）、Ø57.15 mm 用球，六袋口按真实尺寸建模
- 三段式摩擦物理（滑动 → 滚动 → 自旋衰减）：低杆回拉、高杆跟进、左右塞吃库变线都是算出来的，不是预设动画
- 球-球切向冲量带来真实的 throw 偏移；库边接触点高于球心，撞库会「咬」一下
- WPA 8 球规则：开球、花色分组、犯规判定、手中球、8 号球胜负
- AI 对手会枚举「目标球 × 袋口」的可行击球并评分，带难度误差与走位
- 全程序化素材与音效：台布编织纹、木纹、球面号码圈、撞球/吃库/落袋音全部代码生成，无外部资源
- 球台挂在 Shadow DOM 中；关闭时回收渲染循环、窗口事件与 AudioContext

目录：[`desktop-pool-plugin/`](desktop-pool-plugin/)

安装（插件市场收录后也可在 设置 → 插件 → 插件市场 搜索 `zhizhen-pool`）：

```sh
dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/desktop-pool-plugin
```

单独玩（不经过 DSH）：直接双击 [`game/index.html`](desktop-pool-plugin/game/index.html)，或本地起静态服务：

```bash
cd desktop-pool-plugin/game
python3 -m http.server 8898
# 浏览器打开 http://localhost:8898/index.html
```

## 许可

MIT，见 [`LICENSE`](LICENSE)。
