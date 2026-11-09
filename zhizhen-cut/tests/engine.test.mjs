import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// engine.js 是 CommonJS 源码，而本仓库 package.json 是 "type":"module"。
// 为了保持 engine.js 的 CommonJS 形态（构建脚本也按 CJS 包装），这里用
// vm.compileFunction 按构建脚本同样的 (module, exports, require) 签名加载它。
// ---------------------------------------------------------------------------
function loadEngine() {
  const filename = fileURLToPath(new URL('../src/engine.js', import.meta.url));
  const source = readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const factory = vm.compileFunction(source, ['module', 'exports', 'require'], { filename });
  factory(module, module.exports, (id) => {
    throw new Error('engine.js 必须保持零依赖，意外 require(' + id + ')');
  });
  return module.exports;
}

const engine = loadEngine();
const {
  ROLES,
  FILTERS,
  CAPTION_STYLES,
  createProject,
  newId,
  addAsset,
  removeAsset,
  insertClip,
  appendClip,
  moveClip,
  trimClip,
  removeClip,
  splitAt,
  setClipRole,
  setClipVolume,
  setClipFilter,
  setClipLabel,
  seek,
  setInPoint,
  setOutPoint,
  clearMarks,
  setMusic,
  setMusicVolume,
  setDucking,
  setRoleVolume,
  toggleRoleMute,
  setFilter,
  setProMode,
  timeline,
  duration,
  clipAt,
  snap,
  roleColor,
  musicGain,
  clipGain,
  formatTimecode,
  formatClock,
  captionsAt,
  captionsFromScript,
  silenceRanges,
  planSilenceCut,
  roughCut,
} = engine;

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

const approx = (actual, expected, tolerance = 1e-6, message = '') => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    (message ? message + ': ' : '') + 'expected ' + expected + ', got ' + actual,
  );
};

const snapshot = (value) => JSON.stringify(value);

const videoAsset = (id = 'v1', seconds = 10, extra = {}) => ({
  id,
  name: id + '.mp4',
  kind: 'video',
  duration: seconds,
  width: 1920,
  height: 1080,
  url: 'blob:' + id,
  thumbnail: null,
  peaks: null,
  fileSize: 1024,
  mime: 'video/mp4',
  hasAudio: true,
  ...extra,
});

const audioAsset = (id = 'a1', seconds = 20, extra = {}) => ({
  id,
  name: id + '.mp3',
  kind: 'audio',
  duration: seconds,
  width: 0,
  height: 0,
  url: 'blob:' + id,
  thumbnail: null,
  peaks: null,
  fileSize: 512,
  mime: 'audio/mpeg',
  hasAudio: true,
  ...extra,
});

/** 建一个带一个视频素材的空项目。 */
function projectWithVideo(seconds = 10) {
  return addAsset(createProject(), videoAsset('v1', seconds));
}

/** 建一个带视频 + 音频素材的项目。 */
function projectWithAv() {
  let project = addAsset(createProject(), videoAsset('v1', 10));
  project = addAsset(project, audioAsset('a1', 20));
  return project;
}

const clipIds = (project) => project.clips.map((clip) => clip.id);

// ---------------------------------------------------------------------------
// 常量 / 项目
// ---------------------------------------------------------------------------

test('ROLES: 三个中文角色与契约配色', () => {
  assert.deepEqual(
    ROLES.map((role) => role.id),
    ['dialogue', 'music', 'ambient'],
  );
  assert.deepEqual(
    ROLES.map((role) => role.name),
    ['对白', '音乐', '环境'],
  );
  assert.equal(ROLES[0].color, '#5b8def');
  assert.equal(ROLES[1].color, '#b06cf0');
  assert.equal(ROLES[2].color, '#46b3a5');
  ROLES.forEach((role) => {
    assert.equal(typeof role.short, 'string');
    assert.ok(role.short.length > 0);
  });
});

test('FILTERS: 含 none 且 css 均为可赋给 ctx.filter 的字符串', () => {
  assert.ok(FILTERS.length >= 2);
  const none = FILTERS.find((filter) => filter.id === 'none');
  assert.ok(none);
  assert.equal(none.css, 'none');
  FILTERS.forEach((filter) => {
    assert.equal(typeof filter.id, 'string');
    assert.equal(typeof filter.name, 'string');
    assert.ok(filter.name.length > 0);
    assert.equal(typeof filter.css, 'string');
    assert.ok(filter.css.length > 0);
    assert.equal(typeof filter.accent, 'string');
  });
});

test('CAPTION_STYLES: 每个样式都有 canvas 绘制所需字段，默认 clean', () => {
  assert.ok(CAPTION_STYLES.length >= 2);
  assert.equal(CAPTION_STYLES[0].id, 'clean');
  CAPTION_STYLES.forEach((style) => {
    assert.equal(typeof style.id, 'string');
    assert.equal(typeof style.name, 'string');
    assert.equal(typeof style.font, 'string');
    assert.equal(typeof style.weight, 'number');
    assert.equal(typeof style.size, 'number');
    assert.equal(typeof style.color, 'string');
    assert.equal(typeof style.bg, 'string');
    assert.equal(typeof style.stroke, 'string');
  });
});

test('createProject: 默认值完整且实例互相隔离', () => {
  const project = createProject();
  assert.equal(project.version, 1);
  assert.equal(typeof project.name, 'string');
  assert.equal(project.fps, 30);
  assert.equal(project.width, 1920);
  assert.equal(project.height, 1080);
  assert.deepEqual(project.assets, []);
  assert.deepEqual(project.clips, []);
  assert.deepEqual(project.captions, []);
  assert.equal(project.music, null);
  assert.deepEqual(project.roles, {
    dialogue: { volume: 1, muted: false },
    music: { volume: 0.8, muted: false },
    ambient: { volume: 0.7, muted: false },
  });
  assert.deepEqual(project.ducking, { enabled: true, level: 0.22 });
  assert.equal(project.filter, 'none');
  assert.equal(project.proMode, false);
  assert.equal(project.playhead, 0);
  assert.equal(project.inPoint, null);
  assert.equal(project.outPoint, null);

  const second = createProject();
  second.assets.push({ id: 'x' });
  second.roles.dialogue.volume = 0;
  assert.equal(createProject().assets.length, 0);
  assert.equal(createProject().roles.dialogue.volume, 1);
});

test('createProject: overrides 支持部分覆盖 roles / ducking 并拷贝数组', () => {
  const assets = [videoAsset('v1', 10)];
  const project = createProject({
    name: '自定义项目',
    fps: 25,
    assets,
    roles: { dialogue: { volume: 0.5 } },
    ducking: { level: 0.3 },
  });
  assert.equal(project.name, '自定义项目');
  assert.equal(project.fps, 25);
  assert.equal(project.assets.length, 1);
  assets.push(videoAsset('v2', 3));
  assert.equal(project.assets.length, 1);
  assert.deepEqual(project.roles.dialogue, { volume: 0.5, muted: false });
  assert.deepEqual(project.roles.music, { volume: 0.8, muted: false });
  assert.deepEqual(project.ducking, { enabled: true, level: 0.3 });
});

test('newId: 带前缀且会话内唯一', () => {
  const id = newId('clip');
  assert.match(id, /^clip_/);
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(newId('clip'));
  assert.equal(ids.size, 200);
  assert.match(newId(), /^id_/);
});

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

test('addAsset: 规范化字段并追加，不改入参', () => {
  const project = createProject();
  const raw = {
    id: 'a1',
    name: '素材.mp4',
    kind: 'video',
    duration: 12.5,
    width: 1280,
    height: 720,
    url: 'blob:x',
    thumbnail: 'data:image/jpeg;base64,x',
    peaks: [0, 0.5, 2, -1],
    fileSize: 99,
    mime: 'video/mp4',
    hasAudio: false,
  };
  const before = snapshot(raw);
  const next = addAsset(project, raw);
  assert.equal(snapshot(raw), before);
  assert.equal(next.assets.length, 1);
  const asset = next.assets[0];
  assert.equal(asset.id, 'a1');
  assert.equal(asset.duration, 12.5);
  assert.deepEqual(asset.peaks, [0, 0.5, 1, 0]);
  assert.equal(asset.hasAudio, false);
  assert.equal(project.assets.length, 0);
});

test('addAsset: 缺省字段兜底、同 id 原位替换、非法素材忽略', () => {
  let project = addAsset(createProject(), { name: '无 id', duration: 3 });
  assert.equal(project.assets.length, 1);
  const generated = project.assets[0];
  assert.equal(typeof generated.id, 'string');
  assert.equal(generated.kind, 'video');
  assert.equal(generated.peaks, null);
  assert.equal(generated.thumbnail, null);

  project = addAsset(project, videoAsset(generated.id, 30, { name: '替换后.mp4' }));
  assert.equal(project.assets.length, 1);
  assert.equal(project.assets[0].duration, 30);
  assert.equal(project.assets[0].name, '替换后.mp4');

  assert.equal(addAsset(project, null), project);
  assert.equal(addAsset(project, 'nope'), project);
});

test('removeAsset: 级联移除片段与音乐，磁吸合拢且不改入参', () => {
  let project = projectWithAv();
  project = appendClip(project, 'v1').project;
  project = appendClip(project, 'a1').project; // role=music
  project = setMusic(project, 'a1');
  assert.equal(project.clips.length, 2);
  const before = snapshot(project);

  const next = removeAsset(project, 'a1');
  assert.equal(snapshot(project), before);
  assert.equal(next.assets.length, 1);
  assert.equal(next.assets[0].id, 'v1');
  assert.equal(next.clips.length, 1);
  assert.equal(next.clips[0].assetId, 'v1');
  assert.equal(next.music, null);
  assert.equal(duration(next), 10);
  assert.equal(timeline(next)[0].start, 0);

  assert.equal(removeAsset(project, 'missing'), project);
});

// ---------------------------------------------------------------------------
// 插入 / 追加
// ---------------------------------------------------------------------------

test('appendClip: 默认整段、视频推断对白，追加到末尾', () => {
  const project = projectWithVideo(10);
  const result = appendClip(project, 'v1');
  assert.equal(result.project.clips.length, 1);
  const clip = result.project.clips[0];
  assert.equal(clip.id, result.clipId);
  assert.equal(clip.assetId, 'v1');
  assert.equal(clip.in, 0);
  assert.equal(clip.out, 10);
  assert.equal(clip.role, 'dialogue');
  assert.equal(clip.volume, 1);
  assert.equal(clip.filter, 'none');
  assert.equal(clip.label, 'v1.mp4');
  assert.equal(duration(result.project), 10);
  assert.equal(project.clips.length, 0);
});

test('appendClip: 音频素材推断音乐角色', () => {
  const project = projectWithAv();
  const result = appendClip(project, 'a1');
  assert.equal(result.project.clips[0].role, 'music');
});

test('insertClip: 索引、越界夹取与 options', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 0, out: 4 }).project;
  project = appendClip(project, 'v1', { in: 4, out: 10 }).project;

  const inserted = insertClip(project, 'v1', 1, {
    role: 'ambient',
    in: 2,
    out: 6,
    volume: 0.5,
    filter: 'warm',
    label: 'B-roll',
  });
  const clip = inserted.project.clips[1];
  assert.equal(inserted.clipId, clip.id);
  assert.equal(clip.role, 'ambient');
  assert.equal(clip.in, 2);
  assert.equal(clip.out, 6);
  assert.equal(clip.volume, 0.5);
  assert.equal(clip.filter, 'warm');
  assert.equal(clip.label, 'B-roll');
  assert.equal(inserted.project.clips.length, 3);
  assert.equal(duration(inserted.project), 14);

  const atEnd = insertClip(project, 'v1', 99);
  assert.equal(atEnd.project.clips[2].id, atEnd.clipId);
  const atStart = insertClip(project, 'v1', -5);
  assert.equal(atStart.project.clips[0].id, atStart.clipId);
  assert.equal(project.clips.length, 2);
});

test('insertClip: 未知素材返回空 clipId，素材过短拒绝', () => {
  const project = projectWithVideo(10);
  assert.deepEqual(insertClip(project, 'missing', 0), { project, clipId: null });
  const tiny = addAsset(createProject(), videoAsset('tiny', 0.05));
  assert.deepEqual(insertClip(tiny, 'tiny', 0), { project: tiny, clipId: null });
});

test('insertClip: 入点越界/过短时自动调整到最短片段', () => {
  const project = projectWithVideo(10);
  const result = insertClip(project, 'v1', 0, { in: 9.99 });
  const clip = result.project.clips[0];
  approx(clip.in, 9.92);
  approx(clip.out, 10);
  approx(clip.out - clip.in, 0.08);

  const tinyOut = insertClip(project, 'v1', 0, { out: 0.03 });
  const tinyClip = tinyOut.project.clips[0];
  approx(tinyClip.in, 0);
  approx(tinyClip.out, 0.08);
});

// ---------------------------------------------------------------------------
// 移动 / 修剪 / 删除 / 分割
// ---------------------------------------------------------------------------

test('moveClip: 重排、同索引 no-op、越界夹取、非法参数 no-op', () => {
  let project = projectWithVideo(10);
  const a = appendClip(project, 'v1', { in: 0, out: 1 }).project;
  project = appendClip(a, 'v1', { in: 1, out: 2 }).project;
  project = appendClip(project, 'v1', { in: 2, out: 3 }).project;
  const [idA, idB, idC] = clipIds(project);
  const before = snapshot(project);

  const moved = moveClip(project, 0, 2);
  assert.equal(snapshot(project), before);
  assert.deepEqual(clipIds(moved), [idB, idC, idA]);

  assert.deepEqual(clipIds(moveClip(moved, 1, 1)), [idB, idC, idA]);
  assert.deepEqual(clipIds(moveClip(moved, 2, 0)), [idA, idB, idC]);
  assert.deepEqual(clipIds(moveClip(moved, 0, 99)), [idC, idA, idB]);
  assert.equal(moveClip(project, 0, 1).clips.length, 3);
  assert.equal(moveClip(project, Number.NaN, 1), project);
  assert.equal(moveClip(project, 0.5, 2).clips.length, 3); // 取整为 0
});

test('trimClip: 入/出点夹取、最小时长、素材上限与不可变', () => {
  let project = projectWithVideo(20);
  project = appendClip(project, 'v1').project; // 0..20
  const clipId = project.clips[0].id;
  const before = snapshot(project);

  let next = trimClip(project, clipId, 'out', 8);
  assert.equal(snapshot(project), before);
  assert.equal(next.clips[0].out, 8);
  assert.equal(duration(next), 8);

  next = trimClip(next, clipId, 'in', 2);
  assert.equal(next.clips[0].in, 2);
  assert.equal(duration(next), 6); // 磁吸后总时长自动变化

  next = trimClip(next, clipId, 'in', 9); // 超过 out-0.08
  approx(next.clips[0].in, 7.92);
  approx(duration(next), 0.08);

  next = trimClip(next, clipId, 'out', 100); // 超过素材时长
  assert.equal(next.clips[0].out, 20);
  approx(duration(next), 12.08);

  assert.equal(trimClip(project, clipId, 'in', -5).clips[0].in, 0);
  assert.equal(trimClip(project, clipId, 'out', -5).clips[0].out, 0.08);
  assert.equal(trimClip(project, 'missing', 'in', 1), project);
  assert.equal(trimClip(project, clipId, 'bogus', 1), project);
  assert.equal(trimClip(project, clipId, 'in', Number.NaN), project);
});

test('removeClip: 波纹删除并磁吸合拢', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 0, out: 4 }).project;
  project = appendClip(project, 'v1', { in: 4, out: 7 }).project;
  project = appendClip(project, 'v1', { in: 7, out: 10 }).project;
  const [, idB] = clipIds(project);
  const before = snapshot(project);

  const next = removeClip(project, idB);
  assert.equal(snapshot(project), before);
  assert.equal(next.clips.length, 2);
  assert.equal(duration(next), 7);
  const layout = timeline(next);
  assert.equal(layout[0].start, 0);
  assert.equal(layout[1].start, 4);
  assert.equal(layout[1].end, 7);
  assert.equal(removeClip(project, 'missing'), project);
});

test('removeClip: 删除最后一个片段后时间线归零，播放头夹回', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 0, out: 3 }).project;
  project = appendClip(project, 'v1', { in: 3, out: 10 }).project;
  const lastId = project.clips[1].id;
  project = seek(project, 9);

  const lastRemoved = removeClip(project, lastId);
  assert.equal(lastRemoved.clips.length, 1);
  approx(duration(lastRemoved), 3);
  approx(lastRemoved.playhead, 3); // 播放头被夹回新总时长

  const emptied = removeClip(lastRemoved, lastRemoved.clips[0].id);
  assert.equal(emptied.clips.length, 0);
  assert.equal(duration(emptied), 0);
  assert.equal(emptied.playhead, 0);
  assert.equal(removeClip(emptied, 'missing'), emptied);
  assert.equal(splitAt(createProject(), 1).clipId, null);
});

test('splitAt: 中间剪开、边界 no-op、过短 no-op、不可变', () => {  let project = projectWithVideo(20);
  project = appendClip(project, 'v1').project;
  const originalId = project.clips[0].id;
  const before = snapshot(project);

  const split = splitAt(project, 8);
  assert.equal(snapshot(project), before);
  assert.equal(split.project.clips.length, 2);
  assert.equal(split.project.clips[0].id, originalId);
  assert.equal(split.project.clips[0].out, 8);
  assert.equal(split.project.clips[1].id, split.clipId);
  assert.notEqual(split.clipId, originalId);
  assert.equal(split.project.clips[1].in, 8);
  assert.equal(split.project.clips[1].out, 20);
  assert.equal(duration(split.project), 20);
  assert.equal(timeline(split.project)[1].start, 8);

  // 精确边界 / 片段外 / 会切出过短片段 -> 原样返回
  assert.equal(splitAt(project, 0).clipId, null);
  assert.equal(splitAt(project, 20).clipId, null);
  assert.equal(splitAt(project, 25).clipId, null);
  assert.equal(splitAt(project, -2).clipId, null);
  assert.equal(splitAt(project, 0.05).clipId, null);
  assert.equal(splitAt(project, 19.95).clipId, null);
  assert.equal(splitAt(project, Number.NaN).clipId, null);

  // 两个相邻片段的公共边界也不切
  let pair = projectWithVideo(10);
  pair = appendClip(pair, 'v1', { in: 0, out: 4 }).project;
  pair = appendClip(pair, 'v1', { in: 4, out: 8 }).project;
  assert.equal(splitAt(pair, 4).clipId, null);
});

// ---------------------------------------------------------------------------
// 片段属性 / 播放头 / 标记
// ---------------------------------------------------------------------------

test('片段属性 setter: 角色、音量、滤镜、标签及非法值', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  const clipId = project.clips[0].id;
  const before = snapshot(project);

  const withRole = setClipRole(project, clipId, 'ambient');
  assert.equal(snapshot(project), before);
  assert.equal(withRole.clips[0].role, 'ambient');
  assert.equal(setClipRole(project, clipId, 'nope'), project);

  assert.equal(setClipVolume(project, clipId, 2).clips[0].volume, 1);
  assert.equal(setClipVolume(project, clipId, -1).clips[0].volume, 0);
  assert.equal(setClipVolume(project, clipId, 0.4).clips[0].volume, 0.4);
  assert.equal(setClipVolume(project, clipId, Number.NaN), project);

  assert.equal(setClipFilter(project, clipId, 'mono').clips[0].filter, 'mono');
  assert.equal(setClipFilter(project, clipId, 'unknown'), project);

  assert.equal(setClipLabel(project, clipId, '开场').clips[0].label, '开场');
  assert.equal(setClipLabel(project, 'missing', 'x'), project);
});

test('seek: 夹取到 [0, 总时长]', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  assert.equal(seek(project, 100).playhead, 10);
  assert.equal(seek(project, -3).playhead, 0);
  assert.equal(seek(project, 2.5).playhead, 2.5);
  assert.equal(seek(project, Number.NaN).playhead, 0);
  assert.equal(seek(createProject(), 5).playhead, 0);
});

test('入点/出点标记: 在播放头设置、冲突清空、clearMarks', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;

  project = seek(project, 2);
  project = setInPoint(project);
  assert.equal(project.inPoint, 2);
  assert.equal(project.outPoint, null);

  project = seek(project, 6);
  project = setOutPoint(project);
  assert.equal(project.outPoint, 6);

  project = seek(project, 1);
  project = setInPoint(project);
  assert.equal(project.inPoint, 1);
  assert.equal(project.outPoint, 6);

  project = seek(project, 7);
  project = setInPoint(project);
  assert.equal(project.inPoint, 7);
  assert.equal(project.outPoint, null); // in >= out -> 清空 out

  project = seek(project, 5);
  project = setInPoint(project);
  project = seek(project, 3);
  project = setOutPoint(project);
  assert.equal(project.outPoint, 3);
  assert.equal(project.inPoint, null); // out <= in -> 清空 in

  project = clearMarks(project);
  assert.equal(project.inPoint, null);
  assert.equal(project.outPoint, null);
  assert.equal(clearMarks(project), project);
});

// ---------------------------------------------------------------------------
// 音乐 / 混音设置
// ---------------------------------------------------------------------------

test('setMusic/setMusicVolume: 设置、改音量、非法素材、清空', () => {
  let project = projectWithAv();
  const before = snapshot(project);

  project = setMusic(project, 'a1');
  assert.equal(snapshot(project).includes('"a1"'), before.includes('"a1"')); // 入参未变
  assert.deepEqual(project.music, { assetId: 'a1', volume: 0.8 });
  assert.equal(setMusic(project, 'missing'), project);

  project = setMusicVolume(project, 0.5);
  assert.equal(project.music.volume, 0.5);
  assert.equal(setMusicVolume(project, 2).music.volume, 1);
  assert.equal(setMusicVolume(project, -1).music.volume, 0);

  const cleared = setMusic(project, null);
  assert.equal(cleared.music, null);
  assert.equal(setMusicVolume(cleared, 0.5), cleared);
});

test('setDucking: 开关与电平夹取，level 可选保留', () => {
  const project = createProject();
  const off = setDucking(project, false);
  assert.deepEqual(off.ducking, { enabled: false, level: 0.22 });
  const on = setDucking(off, true, 0.3);
  assert.deepEqual(on.ducking, { enabled: true, level: 0.3 });
  assert.equal(setDucking(project, true, 2).ducking.level, 1);
  assert.equal(setDucking(project, true, -1).ducking.level, 0);
  assert.equal(setDucking(off, false, 0.3).ducking.level, 0.3);
});

test('setRoleVolume/toggleRoleMute: 角色音量与静音', () => {
  let project = createProject();
  project = setRoleVolume(project, 'music', 0.4);
  assert.deepEqual(project.roles.music, { volume: 0.4, muted: false });
  assert.equal(setRoleVolume(project, 'music', 5).roles.music.volume, 1);
  assert.equal(setRoleVolume(project, 'nope', 0.5), project);
  assert.equal(setRoleVolume(project, 'music', Number.NaN), project);

  const muted = toggleRoleMute(project, 'music');
  assert.equal(muted.roles.music.muted, true);
  assert.equal(toggleRoleMute(muted, 'music').roles.music.muted, false);
  assert.equal(toggleRoleMute(project, 'nope'), project);
});

test('setFilter/setProMode: 全局滤镜与专业模式', () => {
  let project = createProject();
  project = setFilter(project, 'cinema');
  assert.equal(project.filter, 'cinema');
  assert.equal(setFilter(project, 'unknown'), project);
  assert.equal(setFilter(project, 'cinema'), project);

  project = setProMode(project, true);
  assert.equal(project.proMode, true);
  assert.equal(setProMode(project, false).proMode, false);
  assert.equal(setProMode(project, 'yes').proMode, false);
});

// ---------------------------------------------------------------------------
// 布局 / 查询 / 吸附 / 颜色
// ---------------------------------------------------------------------------

test('timeline: 顺序磁吸 start/end/duration 与素材解析', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 2, out: 5 }).project; // 3s
  project = appendClip(project, 'v1', { in: 5, out: 9 }).project; // 4s
  const layout = timeline(project);
  assert.equal(layout.length, 2);
  assert.equal(layout[0].index, 0);
  assert.equal(layout[0].start, 0);
  assert.equal(layout[0].end, 3);
  assert.equal(layout[0].duration, 3);
  assert.equal(layout[0].asset.id, 'v1');
  assert.equal(layout[1].start, 3);
  assert.equal(layout[1].end, 7);
  assert.equal(layout[1].clip.out, 9);

  const missing = createProject({
    clips: [{ id: 'c1', assetId: 'gone', in: 0, out: 2, role: 'dialogue', volume: 1, filter: 'none', label: '' }],
  });
  assert.equal(timeline(missing)[0].asset, null);
  assert.equal(timeline(createProject()).length, 0);
});

test('duration: 空项目为 0，其余为片段时长之和', () => {
  assert.equal(duration(createProject()), 0);
  let project = projectWithVideo(10);
  assert.equal(duration(project), 0);
  project = appendClip(project, 'v1', { in: 1, out: 4 }).project;
  project = appendClip(project, 'v1', { in: 2, out: 8 }).project;
  assert.equal(duration(project), 9);
});

test('clipAt: 半开区间定位、localTime/sourceTime、片段外与空项目', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 2, out: 6 }).project; // 时间线 0..4
  project = appendClip(project, 'v1', { in: 6, out: 9 }).project; // 时间线 4..7

  assert.equal(clipAt(project, -1), null);
  const first = clipAt(project, 1.5);
  assert.equal(first.entry.index, 0);
  approx(first.localTime, 1.5);
  approx(first.sourceTime, 3.5);

  const boundary = clipAt(project, 4);
  assert.equal(boundary.entry.index, 1);
  approx(boundary.localTime, 0);
  approx(boundary.sourceTime, 6);

  assert.equal(clipAt(project, 7), null);
  assert.equal(clipAt(project, 6.99).entry.index, 1);
  assert.equal(clipAt(createProject(), 0), null);
  assert.equal(clipAt(project, Number.NaN), null);
});

test('snap: 吸附到 0/结尾/片段边界，阈外保持原值', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 0, out: 5 }).project;
  project = appendClip(project, 'v1', { in: 5, out: 8 }).project; // 边界 0,5,8

  assert.equal(snap(project, 4.9, 0.2), 5);
  assert.equal(snap(project, 8.05, 0.2), 8);
  assert.equal(snap(project, 0.1, 0.2), 0);
  assert.equal(snap(project, 7.9, 0.2), 8);
  assert.equal(snap(project, 2.0, 0.2), 2);
  assert.equal(snap(project, 4.95, 0.12), 5); // 默认阈值
  assert.equal(snap(project, 2.0, 0), 2);
  assert.equal(snap(project, 5, 0), 5);
  assert.equal(snap(createProject(), 0.05, 0.2), 0);
  assert.equal(snap(project, Number.NaN, 0.2), 0);
});

test('roleColor: 角色配色与未知回退', () => {
  assert.equal(roleColor('dialogue'), '#5b8def');
  assert.equal(roleColor('music'), '#b06cf0');
  assert.equal(roleColor('ambient'), '#46b3a5');
  assert.equal(roleColor('unknown'), '#9aa4b2');
});

// ---------------------------------------------------------------------------
// 增益 / 闪避
// ---------------------------------------------------------------------------

/** 构造：10s 对白片段 + 一段 30s 音乐垫（volume 0.5，music 角色 0.8）。 */
function mixProject() {
  let project = projectWithAv();
  project = appendClip(project, 'v1', { role: 'dialogue' }).project; // 0..10
  project = setMusic(project, 'a1');
  project = setMusicVolume(project, 0.5);
  project = setRoleVolume(project, 'music', 0.8);
  return project;
}

test('musicGain: 音乐音量/角色音量、无音乐、静音', () => {
  let project = mixProject();
  approx(musicGain(project, 20), 0.4); // 时间线外不闪避
  approx(musicGain(project, 15), 0.4);
  assert.equal(musicGain(createProject(), 0), 0);

  project = toggleRoleMute(project, 'music');
  assert.equal(musicGain(project, 20), 0);
});

test('musicGain: 对白出现时按 ducking.level 自动闪避', () => {
  let project = mixProject();
  approx(musicGain(project, 5), 0.4 * 0.22);
  approx(musicGain(project, 0), 0.4 * 0.22);
  assert.equal(musicGain(project, 10), 0.4); // 边界之后不再闪避

  project = setDucking(project, false);
  approx(musicGain(project, 5), 0.4);

  const half = setDucking(mixProject(), true, 0.5);
  approx(musicGain(half, 5), 0.2);
});

test('clipGain: 角色音量/静音 × 片段音量，缺失兜底', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { volume: 0.5 }).project;
  const clip = project.clips[0];
  approx(clipGain(project, clip), 0.5);

  project = setRoleVolume(project, 'dialogue', 0.5);
  approx(clipGain(project, clip), 0.25);

  const muted = toggleRoleMute(project, 'dialogue');
  assert.equal(clipGain(muted, clip), 0);

  const ambient = appendClip(project, 'v1', { role: 'ambient', volume: 0.5 }).project;
  approx(clipGain(ambient, ambient.clips[1]), 0.35); // 0.5 * 0.7

  assert.equal(clipGain(project, null), 0);
});

// ---------------------------------------------------------------------------
// 时间格式化
// ---------------------------------------------------------------------------

test('formatTimecode: 默认 30fps、自定义 fps、负数/非法值', () => {
  assert.equal(formatTimecode(0), '00:00:00:00');
  assert.equal(formatTimecode(1 / 30), '00:00:00:01');
  assert.equal(formatTimecode(1.5), '00:00:01:15');
  assert.equal(formatTimecode(61.5), '00:01:01:15');
  assert.equal(formatTimecode(3661), '01:01:01:00');
  assert.equal(formatTimecode(1.5, 25), '00:00:01:13');
  assert.equal(formatTimecode(-3), '00:00:00:00');
  assert.equal(formatTimecode(Number.NaN), '00:00:00:00');
});

test('formatClock: 秒/分/时紧凑格式与四舍五入', () => {
  assert.equal(formatClock(0), '0:00.0');
  assert.equal(formatClock(5.06), '0:05.1');
  assert.equal(formatClock(62.34), '1:02.3');
  assert.equal(formatClock(3723.4), '1:02:03.4');
  assert.equal(formatClock(3600), '1:00:00.0');
  assert.equal(formatClock(59.96), '1:00.0');
  assert.equal(formatClock(-5), '0:00.0');
  assert.equal(formatClock(Number.NaN), '0:00.0');
});

// ---------------------------------------------------------------------------
// 字幕
// ---------------------------------------------------------------------------

test('captionsAt: 半开区间 [start, start+duration)', () => {
  const project = createProject({
    captions: [
      { id: 'c1', text: '一', start: 1, duration: 2, styleId: 'clean' },
      { id: 'c2', text: '二', start: 4, duration: 1, styleId: 'clean' },
    ],
  });
  assert.deepEqual(captionsAt(project, 0), []);
  assert.deepEqual(captionsAt(project, 1).map((c) => c.id), ['c1']);
  assert.deepEqual(captionsAt(project, 2.999).map((c) => c.id), ['c1']);
  assert.deepEqual(captionsAt(project, 3), []);
  assert.deepEqual(captionsAt(project, 4).map((c) => c.id), ['c2']);
  assert.deepEqual(captionsAt(project, 5), []);
  assert.deepEqual(captionsAt(createProject(), 1), []);
  assert.deepEqual(captionsAt(project, Number.NaN), []);
});

test('captionsFromScript: 按标点/换行拆句并均匀铺满时间线', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  const before = snapshot(project);

  const next = captionsFromScript(project, '第一句。第二句！\n第三句？');
  assert.equal(snapshot(project), before);
  assert.deepEqual(
    next.captions.map((caption) => caption.text),
    ['第一句。', '第二句！', '第三句？'],
  );
  assert.equal(next.captions.length, 3);
  const slot = (10 - 0.06 * 2) / 3;
  next.captions.forEach((caption, index) => {
    assert.equal(caption.styleId, CAPTION_STYLES[0].id);
    assert.equal(typeof caption.id, 'string');
    approx(caption.duration, slot, 1e-3);
    approx(caption.start, index * (slot + 0.06), 1e-3);
    assert.ok(caption.start + caption.duration <= 10 + 1e-6);
  });
  approx(next.captions[1].start - (next.captions[0].start + next.captions[0].duration), 0.06, 1e-6);
});

test('captionsFromScript: 英文句子、start/end/styleId 选项与兜底', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;

  const english = captionsFromScript(project, 'Hello world. How are you?');
  assert.deepEqual(
    english.captions.map((caption) => caption.text),
    ['Hello world.', 'How are you?'],
  );

  const ranged = captionsFromScript(project, '第一句。第二句。', {
    start: 2,
    end: 6,
    styleId: 'box',
  });
  assert.equal(ranged.captions.length, 2);
  assert.equal(ranged.captions[0].styleId, 'box');
  approx(ranged.captions[0].start, 2);
  approx(ranged.captions[1].start, 2 + (4 - 0.06) / 2 + 0.06, 1e-3);
  approx(
    ranged.captions[1].start + ranged.captions[1].duration,
    6,
    1e-3,
  );

  const fallback = captionsFromScript(project, '一句。', { styleId: 'nope' });
  assert.equal(fallback.captions[0].styleId, CAPTION_STYLES[0].id);

  const empty = captionsFromScript(project, '   \n  ');
  assert.deepEqual(empty.captions, []);
});

// ---------------------------------------------------------------------------
// 静音检测 / 粗剪
// ---------------------------------------------------------------------------

/** 生成 40 个峰值（duration=4s，每格 0.1s），quiet 为静音网格索引区间集合。 */
function peaksWithQuiet(quietRanges = []) {
  return Array.from({ length: 40 }, (_, index) =>
    quietRanges.some(([from, to]) => index >= from && index < to) ? 0 : 0.5,
  );
}

test('silenceRanges: 识别静音段并向内留 pad', () => {
  const peaks = peaksWithQuiet([[10, 20]]); // 1.0..2.0
  const ranges = silenceRanges(peaks, 4);
  assert.equal(ranges.length, 1);
  approx(ranges[0].start, 1.06);
  approx(ranges[0].end, 1.94);

  const multiple = silenceRanges(peaksWithQuiet([[5, 10], [25, 32]]), 4);
  assert.equal(multiple.length, 2);
  approx(multiple[0].start, 0.56);
  approx(multiple[0].end, 0.94);
  approx(multiple[1].start, 2.56);
  approx(multiple[1].end, 3.14);
});

test('silenceRanges: null/空峰值、零时长兜底', () => {
  assert.deepEqual(silenceRanges(null, 4), []);
  assert.deepEqual(silenceRanges([], 4), []);
  assert.deepEqual(silenceRanges([0.4, 0.4], 0), []);
  assert.deepEqual(silenceRanges(undefined, 4), []);
});

test('silenceRanges: minSilence 过滤、pad=0、threshold 选项', () => {
  // 0.3s 静音 < 默认 minSilence 0.35 -> 不切
  assert.deepEqual(silenceRanges(peaksWithQuiet([[0, 3]]), 4), []);
  // minSilence 更小时命中
  assert.equal(silenceRanges(peaksWithQuiet([[0, 3]]), 4, { minSilence: 0.2 }).length, 1);

  const noPad = silenceRanges(peaksWithQuiet([[10, 20]]), 4, { pad: 0 });
  approx(noPad[0].start, 1);
  approx(noPad[0].end, 2);

  // 静音峰值为 0.04：默认阈值 0.055 命中；把阈值降到 0.01 后视为有声
  const quiet04 = Array.from({ length: 40 }, (_, index) =>
    index >= 10 && index < 20 ? 0.04 : 0.5,
  );
  assert.equal(silenceRanges(quiet04, 4).length, 1);
  assert.deepEqual(silenceRanges(quiet04, 4, { threshold: 0.01 }), []);

  // 全静音素材：整段（去首尾 pad）
  const whole = silenceRanges(new Array(40).fill(0), 4);
  assert.equal(whole.length, 1);
  approx(whole[0].start, 0.06);
  approx(whole[0].end, 3.94);
});

test('planSilenceCut: 按片段裁剪到 in/out 范围，peaks 缺失返回空数组', () => {
  const asset = videoAsset('v1', 4, { peaks: peaksWithQuiet([[10, 20]]) });
  let project = addAsset(createProject(), asset);
  project = appendClip(project, 'v1', { in: 1.2, out: 1.8 }).project;
  const clipId = project.clips[0].id;
  const plan = planSilenceCut(project);
  assert.deepEqual(Object.keys(plan), [clipId]);
  assert.equal(plan[clipId].length, 1);
  approx(plan[clipId][0].start, 1.2);
  approx(plan[clipId][0].end, 1.8);

  const noPeaks = projectWithVideo(10);
  const appended = appendClip(noPeaks, 'v1');
  assert.deepEqual(planSilenceCut(appended.project), { [appended.clipId]: [] });
  assert.deepEqual(planSilenceCut(createProject()), {});
});

test('roughCut: 切掉静音段重新拼接，重叠区间合并', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  const clipId = project.clips[0].id;
  const before = snapshot(project);

  const result = roughCut(project, {
    [clipId]: [
      { start: 2, end: 4 },
      { start: 3, end: 5 }, // 与上一段重叠 -> 合并为 2..5
    ],
  });
  assert.equal(snapshot(project), before);
  assert.equal(result.project.clips.length, 2);
  assert.equal(result.project.clips[0].id, clipId); // 第一段保留原 id
  assert.equal(result.project.clips[0].in, 0);
  assert.equal(result.project.clips[0].out, 2);
  assert.equal(result.project.clips[1].in, 5);
  assert.equal(result.project.clips[1].out, 10);
  assert.notEqual(result.project.clips[1].id, clipId);
  assert.equal(result.project.clips[1].assetId, 'v1');
  approx(duration(result.project), 7);
  approx(result.removedSeconds, 3);
});

test('roughCut: 排序乱序切点、多段保留', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  const clipId = project.clips[0].id;
  const result = roughCut(project, {
    [clipId]: [
      { start: 5, end: 6 },
      { start: 2, end: 3 },
    ],
  });
  assert.deepEqual(
    result.project.clips.map((clip) => [clip.in, clip.out]),
    [
      [0, 2],
      [3, 5],
      [6, 10],
    ],
  );
  approx(result.removedSeconds, 2);
});

test('roughCut: 保留段 < 0.25s 丢弃，切点外的 ranges 忽略', () => {
  let short = addAsset(createProject(), videoAsset('short', 0.5));
  short = appendClip(short, 'short').project; // 0..0.5
  const shortId = short.clips[0].id;
  const dropped = roughCut(short, { [shortId]: [{ start: 0.2, end: 0.5 }] });
  assert.equal(dropped.project.clips.length, 0);
  approx(dropped.removedSeconds, 0.5);
  assert.equal(duration(dropped.project), 0);

  let project = projectWithVideo(10);
  project = appendClip(project, 'v1', { in: 2, out: 5 }).project;
  const clipId = project.clips[0].id;
  const untouched = roughCut(project, { [clipId]: [{ start: 0, end: 1 }] });
  assert.equal(untouched.project.clips.length, 1);
  assert.equal(untouched.project.clips[0].in, 2);
  assert.equal(untouched.project.clips[0].out, 5);
  approx(untouched.removedSeconds, 0);
});

test('roughCut: 无 ranges / null 保持原样，播放头夹回新总时长', () => {
  let project = projectWithVideo(10);
  project = appendClip(project, 'v1').project;
  const clipId = project.clips[0].id;

  const noRanges = roughCut(project, {});
  assert.equal(noRanges.project.clips.length, 1);
  assert.equal(noRanges.project, project); // no-op 返回原引用，UI 可据此提示“没有静音”
  approx(noRanges.removedSeconds, 0);
  assert.equal(roughCut(project, null).project.clips.length, 1);

  project = seek(project, 9);
  const cut = roughCut(project, { [clipId]: [{ start: 2, end: 5 }] });
  approx(duration(cut.project), 7);
  approx(cut.project.playhead, 7);
});
