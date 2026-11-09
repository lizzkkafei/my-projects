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

## 游戏

### zhizhen-cardgame · 小丑之桌 JESTER'S TABLE

浏览器里的三维扑克 Roguelike：用 20 种小丑牌改写「筹码 × 倍率」，撑过 6 层底注。

- Three.js 实时 3D 牌桌，发牌 / 出牌 / 结算动画与辉光后期全部由代码生成
- 12 种牌型判定，小丑从左到右逐个结算；纯逻辑与渲染分离
- 6 层底注 × 小/大/BOSS 盲注，6 种 BOSS 干扰效果；商店买卖与重掷、金钱利息
- 20 种小丑牌、5 个携带槽位；WebAudio 程序化音效
- 纯静态文件，无构建步骤、无外部网络依赖（Three.js 与字体已本地化）

目录：[`zhizhen-cardgame/`](zhizhen-cardgame/)

```bash
cd zhizhen-cardgame
python3 -m http.server 8899
# 浏览器打开 http://localhost:8899/index.html
```

macOS 也可直接双击 [`启动游戏.command`](zhizhen-cardgame/启动游戏.command)（自动找空闲端口并打开浏览器）。

## 许可

MIT，见 [`LICENSE`](LICENSE)。
