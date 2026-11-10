# zhizhen-cardgame · 小丑之桌 JESTER'S TABLE

一个以 **DSH Web UI 插件** 形式发行的三维扑克 Roguelike：从任意会话输入框左侧点「游戏」进入全屏牌桌，按 `Esc` 或右上角「返回会话」回到对话。

![牌桌（本地 harness 截图）](preview.jpg)

## 玩法

- 每关从 8 张手牌里选 1–5 张打出，按牌型结算 **筹码 × 倍率**
- 12 种牌型：高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺、五条、同花葫芦、同花五条
- 每关 4 次出牌、4 次弃牌，目标分数随底注升高（200 → 500 → 1200 → 2800 → 6000 → 12000）
- 小 / 大 / BOSS 三种盲注；BOSS 盲注附带 6 种干扰之一（钩子、高墙、针、死水、头颅、嘴）
- 20 种小丑牌，结算时从左到右逐个生效；商店可买、卖、换一批，关后进入下一层
- 金钱每 $5 生 $1 利息（上限 $5），攒钱也是一种策略

## 操作

| 操作 | 说明 |
| --- | --- |
| 点击牌面 | 选牌 / 取消选牌（1–5 张） |
| `Space` / 出牌 | 打出已选牌 |
| `D` / 弃牌 | 弃掉已选牌 |
| `Esc` | 取消当前选择 / 关闭弹窗 |
| `M` | 静音 |
| `⌥G` | 在会话里随时打开 / 收起牌桌 |
| 右上角「返回会话」 | 退出牌桌 |

## 安装

市场收录后可在 **设置 → 插件 → 插件市场** 搜索 `zhizhen-cardgame` 一键安装；也可以从源码装：

```sh
dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/zhizhen-cardgame
```

装完刷新 DSH 页面（⌘R）即可在会话输入框左侧看到「游戏」按钮。

## 实现

- 单文件 Client bundle（`client.js`，由 `scripts/build.mjs` 生成），通过 `conversation.input.left` 注册入口、`shell.overlay` 注册全屏牌桌。
- 牌桌挂载在 **Shadow DOM** 里：游戏自带的样式、字体与 `#stage` 等元素 id 都被隔离，不会污染 DSH 界面；关闭时把窗口事件、`requestAnimationFrame` 渲染循环和 `AudioContext` 一并清理，重新打开是干净的新牌桌。
- 构建脚本把游戏源码（`js/*.js`）、Three.js 与 6 个 addon 重写成小型 CommonJS 式模块表，字体以 `data:` URL 内联；运行期不联网、不读外部文件。
- 牌型判定与计分是纯逻辑（`js/rules.js`），与 Three.js 渲染分离；20 种小丑牌定义在 `js/jokers.js`。

## 开发

```sh
node scripts/build.mjs     # 从 js/、css/、index.html 生成 client.js
```

> 直接双击本目录的 `index.html` 不能运行（用了 ES module + importmap）；想脱离 DSH 单独玩，双击 `启动游戏.command`，它会起本地静态服务并打开浏览器。

本目录同时保留可直接在浏览器里跑的独立版本（`index.html` + `css/` + `js/` + `vendor/`），插件构建只是把它们打包进 `client.js`。

## 验证状态

- `node scripts/build.mjs`：构建通过，`node --check client.js` 无语法错误（2.16 MB，19 个游戏模块）。
- harness 测试（真实 Chrome + 生成的 client.js）：bundle 正确注册 `conversation.input.left` 与 `shell.overlay` 两个 slot、`zhizhenCardgame` 词典；挂载后发牌（牌堆 44）、选牌显示预期牌型、出牌结算得分 15 / 出牌数 4→3 / 牌堆 44→42；`dispose()` 后 Shadow DOM 清空，再次挂载可正常开局；0 console error。
- 牌型逻辑 10 项单测（对子 / 两对 / 三条 / 顺子 / 同花 / 葫芦 / 四条 / 同花顺 / 五条 / 高牌）全部通过。

## 许可

MIT，见仓库根目录 [`LICENSE`](../LICENSE)。
