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

## 许可

MIT，见 [`LICENSE`](LICENSE)。
