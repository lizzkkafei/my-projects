# 切线 Cutline · 视频编辑工作台 — 模块契约

本目录是一个 DSH Web UI 插件包（bundle）。产品要求：在会话中一键进入一个单窗口视频编辑工作台，支持上传多个视频、磁吸时间线剪辑和导出。

**所有源码用 CommonJS 风格写**（`module.exports = {...}`，可用 `require('./engine')`），由 `scripts/build.mjs` 打包成单文件 `client.js`。浏览器里没有 Node API；可用 `window`/`document`/DOM/Canvas/MediaRecorder/WebAudio。

## 文件所有权（严格遵守，只改自己的文件）

| 文件 | 负责人 | 说明 |
|---|---|---|
| `src/engine.js`, `tests/engine.test.mjs` | engine-dev | 纯逻辑，零 DOM、零 React |
| `src/media.js` | media-dev | DOM/媒体管线，零 React |
| `src/timeline.js`, `src/timeline.css` | timeline-dev | 时间线 React 组件与样式 |
| `src/ui.js`, `src/entry.js`, `src/styles.css`, `scripts/*`, `package.json`, `index.js`, `cordis.patch.yml`, `locale/*`, `icon.svg` | lead | 外壳、入口、构建、安装 |
| `client.js` | 构建产物，勿手改 | `node scripts/build.mjs` 生成 |

不要运行 `plugin_manager`（只有 Lead 安装）。不要修改 `package.json` / `cordis.patch.yml`。

## 构建与自检

- 单文件语法检查：`node --check src/engine.js`（其余同理；`.js` 是普通脚本）。
- 纯逻辑测试：`cd zhizhen-cut && node --test tests/engine.test.mjs`
- 全量构建：`node scripts/build.mjs`（需所有源文件存在）。构建会：拼接模块、内联 CSS、`node --check client.js`、打印大小。
- 不要新增依赖，不要联网。

## 产品/视觉基调（所有模块统一）

- 单窗口、三块区域：左侧素材库 / 中央预览 / 底部时间线。辅助面板默认隐藏，快捷键呼出。
- 深色专业界面：近黑背景、高对比时间线、橙色强调色 `#ff4d2e`（切线品牌色）、角色色：对白 `#5b8def`、音乐 `#b06cf0`、环境 `#46b3a5`。
- 字体：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif`。
- 主界面 CSS 类前缀：`cl-`；时间线 CSS 类前缀：`clt-`。
- 所有中文文案都通过 `t(key)`（由 Lead 提供）或时间线传入的 `t` prop；不要写死中文以外还要考虑英文（英文由 locale 提供）。

## 数据模型（engine.js 输出，media/timeline/ui 共同依赖）

```js
Project = {
  version: 1,
  name: string,
  fps: 30,
  width: 1920, height: 1080,
  assets: Asset[],
  clips: Clip[],                  // 顺序即时间线顺序，磁吸、无空隙
  captions: Caption[],
  music: null | { assetId: string, volume: number }, // 背景音乐垫，循环播放
  roles: { dialogue: { volume: 1, muted: false }, music: { volume: 0.8, muted: false }, ambient: { volume: 0.7, muted: false } },
  ducking: { enabled: true, level: 0.22 },           // 对白出现时音乐增益
  filter: 'none',                // 全局风格滤镜 id（见 FILTERS）
  proMode: false,
  playhead: 0,
  inPoint: null, outPoint: null,
}

Asset = {
  id: string, name: string,
  kind: 'video' | 'audio',
  duration: number,              // 秒
  width: number, height: number,
  url: string,                   // blob URL
  thumbnail: string | null,      // data URL，320px 宽
  peaks: number[] | null,        // 800 个 0..1 峰值
  fileSize: number, mime: string,
  hasAudio: boolean,
}

Clip = {
  id: string, assetId: string,
  in: number, out: number,       // 源素材内的入/出点（秒）
  role: 'dialogue' | 'music' | 'ambient',
  volume: number,                // 0..1
  filter: string,                // 片段级滤镜 id；'none' 或无
  label: string,
}

Caption = { id: string, text: string, start: number, duration: number, styleId: string }
```

`engine.js` 导出的常量：`ROLES`（`[{id,name,color,short}]`，name 为中文）、`FILTERS`（`[{id,name,css,accent}]`，`css` 是可直接赋给 canvas `ctx.filter` 的字符串，`'none'` 表示无）、`CAPTION_STYLES`（`[{id,name,font,weight,size,color,bg,stroke}]`，size/color 供 canvas 字幕绘制）、`DEFAULT_PROJECT` 通过 `createProject()` 取。

## engine.js 精确 API（全部不可变：不修改入参，返回新 project 或 {project,...}）

```js
createProject(overrides?) -> Project
newId(prefix) -> string
addAsset(project, asset) -> Project
removeAsset(project, assetId) -> Project            // 同时移除引用该素材的片段/音乐，磁吸合拢
insertClip(project, assetId, index, options?) -> { project, clipId }
  // options: { role?, in?, out?, volume?, filter?, label? }；默认整段、role 按素材推断
appendClip(project, assetId, options?) -> { project, clipId }
moveClip(project, fromIndex, toIndex) -> Project    // toIndex 为移除后插入位置；越界自动夹取
trimClip(project, clipId, edge, sourceTime) -> Project
  // edge: 'in'|'out'；sourceTime 为素材内绝对秒；in 夹到 [0,out-0.08]，out 夹到 [in+0.08,asset.duration]
removeClip(project, clipId) -> Project              // 波纹删除
splitAt(project, time) -> { project, clipId }       // 在时间线 time 处剪开；不在片段内则原样返回
setClipRole(project, clipId, role) -> Project
setClipVolume(project, clipId, volume) -> Project
setClipFilter(project, clipId, filterId) -> Project
setClipLabel(project, clipId, label) -> Project
seek(project, time) -> Project
setInPoint(project) -> Project                      // 在 playhead 处设入点；若已有 outPoint 且 in>=out 则清空
setOutPoint(project) -> Project
clearMarks(project) -> Project
setMusic(project, assetId | null) -> Project
setMusicVolume(project, volume) -> Project
setDucking(project, enabled, level?) -> Project
setRoleVolume(project, role, volume) -> Project
toggleRoleMute(project, role) -> Project
setFilter(project, filterId) -> Project
setProMode(project, enabled) -> Project
timeline(project) -> [{ clip, asset, index, start, end, duration }]
duration(project) -> number                         // 片段总时长（秒）
clipAt(project, time) -> { entry, localTime, sourceTime } | null   // entry 同 timeline 项
snap(project, time, threshold) -> number            // 吸附到 0/结尾/片段边界
roleColor(role) -> string
musicGain(project, time) -> number                  // 0..1，已含音乐音量/静音/自动闪避
clipGain(project, clip) -> number                   // 0..1，已含角色音量/静音/片段音量
formatTimecode(seconds, fps?) -> '00:00:00:00'
formatClock(seconds) -> '0:00.0' / '1:02:03.4'
captionsAt(project, time) -> Caption[]              // 该时刻应显示的字幕
captionsFromScript(project, text, options?) -> Project
  // 按换行/中英文句末标点拆句；均匀铺满 options.start..options.end（默认整条时间线）；
  // 句间留 0.06s 间隙；styleId 取默认 CAPTION_STYLES[0].id
silenceRanges(peaks, duration, options?) -> [{ start, end }]
  // 峰值低于 threshold（默认 0.055）且持续 >= minSilence（默认 0.35）的段；首尾各留 pad=0.06
planSilenceCut(project, options?) -> { [clipId]: [{ start, end }] }   // 源素材内绝对秒
roughCut(project, rangesByClip) -> { project, removedSeconds }
  // 对每个片段按 ranges 切掉静音段，保留部分重新拼成片段；保留段 <0.25s 的丢弃
```

补充要求：
- 单测覆盖：append/insert/move/trim/remove/split 的磁吸与时长、snap、roughCut、captionsFromScript、musicGain 闪避、formatTimecode。
- 所有导出的函数都要有 JSDoc 一行说明；不要引用 `window`/`document`。
- `asset.peaks` 可能为 null，需要兜底。

## media.js 精确 API（零 React，可操作 DOM）

```js
async loadAsset(file, opts?) -> Asset
  // opts: { id?: string, onProgress?(p:0..1) }；video/audio 都支持。
  // 用 URL.createObjectURL(file)；视频读取 duration/width/height，缩略图（canvas 320 宽 JPEG 0.72），
  // 用 AudioContext.decodeAudioData 提取 800 点峰值（失败返回 null，不抛错）；
  // 无音轨的 video 也算成功（hasAudio 尽力判断：decode 成功即有）。

class PreviewEngine {
  constructor(hostElement, options?)   // hostElement 是预览舞台容器，隐藏 video/audio 元素会 append 到这里
  async ensureProject(project)         // 为 project.assets 建立媒体元素池；可重复调用
  render(project, time, opts?)         // opts: { playing?: boolean, direction?: 1|-1, rate?: number, skim?: boolean }
  pause()
  dispose()
}
// 渲染要求：按 project.clipAt(time) 选择当前视频；cover-fit 画到内部 canvas（尺寸随 host 自适应，
// devicePixelRatio 处理）；应用全局 filter + 片段 filter（canvas ctx.filter）；绘制当前字幕；
// 控制当前 video 的 currentTime 与播放状态，音量用 clipGain/role；music 垫用循环 audio 元素与 musicGain。
// 不要抛异常：媒体未就绪时画深色底 + “加载中”即可。

async exportProject(project, options, callbacks) -> { blob, mime, filename, width, height, duration }
// options: { width=1280, height=720, fps=30, bitrate=8_000_000, includeCaptions=true, includeMusic=true }
// callbacks: { onProgress?(0..1), onPhase?(text), isCancelled?(): boolean }
// 实现：实时播放整条时间线到离屏 canvas，canvas.captureStream(fps) + WebAudio 混音（MediaStreamDestination）
// 用 MediaRecorder 录制；优先 'video/webm;codecs=vp9,opus'，再 vp8，再 webm，最后 mp4。
// 导出期间用自己创建的隐藏 video/audio 元素与 AudioContext，避免影响预览；结束后全部清理、disconnect。
// 取消时抛 Error('export-cancelled') 或返回 null（在文档里注明选择）。
// 字幕用 canvas 绘制，样式取 CAPTION_STYLES。

function probeExportSupport() -> { mime, extension, supported }
function download(blob, filename)
function formatBytes(bytes) -> string
function formatDuration(seconds) -> string   // '1:23'
```

注意：`loadAsset` 可能同时被多个调用；每个 Asset 独立。媒体元素必须 `playsInline`、`preload='auto'`。

## timeline.js 精确 API（React，零外部依赖，仅 `require('react')` / `require('./engine')`）

```js
module.exports = { Timeline }
```

`Timeline` props：

```js
{
  project, time,                 // time = 当前播放头秒数
  zoom,                          // 像素/秒（UI 默认 44，范围 8..260）
  selectedId,
  proMode,                       // 直接读 project.proMode 也可，以 prop 为准
  skimming, snapping,
  t,                             // t(key) => 文案；键列表见下
  onSelect(id),
  onSeek(time),
  onSkim(time | null),           // 悬停掠视；离开轨道传 null
  onZoom(next),
  onTogglePro(),
  onToggleSkimming(),
  onToggleSnapping(),
  onSplit(),
  onDelete(),
  onUndo(),
  onRedo(),
  onDropAsset(assetId, index),   // 从素材库拖入
  onMoveClip(from, to),
  onTrimClip(clipId, edge, sourceTime),
}
```

要求：
- 根元素 `.clt-root`，内部横向滚动；有标尺（时间码）、播放头、掠视线、片段条。
- 磁吸时间线：默认单条主轨；片段宽度=时长*zoom，顺序排列无间隙；片段内展示缩略图平铺（`asset.thumbnail`）或波形（`asset.peaks` 用 canvas/SVG 绘制），角色色左边条，名称，入出点提示。
- 支持鼠标拖拽重排（带插入指示线）、拖左右边缘 trim（拖动时实时调用 onTrimClip）、点击选中、双击片段可选中并 seek 到片段头。
- 滚轮：普通滚轮横向滚动；Shift=横向；Ctrl/⌘=以鼠标位置为中心缩放（调用 onZoom）；触控板捏合会以 ctrl+wheel 到达。
- 掠视：鼠标在标尺/轨道上移动时调用 onSkim(time)，离开轨道 onSkim(null)。
- 专业模式：主轨（V）+ 对白/音乐/环境三条音频角色泳道 + 字幕泳道；显示选中片段的精确入点/出点/时长（timecode），并提供吸附/专业模式开关。
- 字幕块来自 project.captions；点击字幕块选中并 seek。
- 空状态：提示“把素材拖到这里”+ 导入按钮回调？用 onDropAsset 的提示，不新增导入回调，文案提示点击左上角导入。
- 所有文案用 `t`：`tl.split`, `tl.delete`, `tl.undo`, `tl.redo`, `tl.pro`, `tl.proOn`, `tl.proOff`, `tl.snap`, `tl.skimming`, `tl.zoom`, `tl.empty`, `tl.emptyHint`, `tl.caption`, `tl.dialogue`, `tl.music`, `tl.ambient`, `tl.video`, `tl.in`, `tl.out`, `tl.duration`, `tl.selected`, `tl.addToTimeline`。若 t 未提供，退回中文。
- 样式写进 `src/timeline.css`（类前缀 `clt-`）；深色高对比：轨道底 `#0a0b0d`，标尺 `#15171b`，播放头 `#ff4d2e`，掠视线 `rgba(255,255,255,.45)`。可用 `var(--cl-*, fallback)` 读取 UI 外壳变量，但必须自洽。
- 组件必须防止 React hooks 顺序问题；不要用 `React.memo` 之外未确认的 API（`useState/useEffect/useRef/useMemo/useCallback` 可用）。
- 禁止访问全局 store；只通过 props 调用。

## UI 外壳（lead 负责，供参考，便于对接）

`src/ui.js` 导出 `{ EntryButton, WorkbenchOverlay, setTranslator }`；`src/entry.js` 负责 apply/注册。主界面会提供：素材库、预览舞台、AI 面板、导出弹窗、撤销重做、播放时钟、快捷键。时间线只拿到上述 props。

## 协作约定

- 写文件前先 `read` 目标文件；用 `write` 创建。完成后用 `send_message` 向 lead 报告：文件路径、导出 API、测试命令与结果、未验证项。
- 不要改动别人文件；不要跑 `plugin_manager`；不要 `pnpm install`。
- 若接口需要澄清，先按契约实现并在报告中说明假设，不要阻塞。
