#!/usr/bin/env node
/**
 * Timeline render smoke: load the CommonJS `timeline.js` with a stub React
 * runtime and the real `engine.js`, then evaluate the component tree for an
 * empty project, a clip/caption project and pro mode. Catches render-time errors
 * before the bundle is installed. Pixels are not verified.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCommonJs(file, requireImpl) {
  const module = { exports: {} };
  const factory = vm.compileFunction(source(file), ['module', 'exports', 'require'], { filename: file });
  factory(module, module.exports, requireImpl);
  return module.exports;
}

const noop = () => {};
const ReactStub = {
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props, {
      children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
    }),
  }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useCallback: (callback) => callback,
  memo: (component) => component,
  Fragment: 'Fragment',
};

const engine = loadCommonJs('src/engine.js', (id) => {
  throw new Error(`engine should not require ${id}`);
});
const timeline = loadCommonJs('src/timeline.js', (id) => {
  if (id === 'react') return ReactStub;
  if (id === './engine') return engine;
  throw new Error(`unexpected require(${id})`);
});

const windowStub = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
globalThis.window = windowStub;

function makeAsset(id, name, duration, withPeaks) {
  return {
    id,
    name,
    kind: 'video',
    duration,
    width: 1920,
    height: 1080,
    url: `blob:${id}`,
    thumbnail: null,
    peaks: withPeaks
      ? Array.from({ length: 800 }, (_, index) => Math.abs(Math.sin((index / 800) * Math.PI * 12)) * 0.8 + 0.05)
      : null,
    fileSize: 12_345_678,
    mime: 'video/mp4',
    hasAudio: withPeaks,
  };
}

function buildProject() {
  let project = engine.createProject();
  project = engine.addAsset(project, makeAsset('a1', '海边日落.mp4', 8.4, true));
  project = engine.addAsset(project, makeAsset('a2', '城市延时.mp4', 12.6, true));
  project = engine.appendClip(project, 'a1').project;
  project = engine.appendClip(project, 'a2').project;
  project = engine.splitAt(engine.seek(project, 6), 6).project;
  project = engine.captionsFromScript(project, '第一句字幕。第二句字幕！第三句字幕？');
  project = engine.appendClip(project, 'a1').project;
  project = engine.setClipRole(project, project.clips[1].id, 'music');
  return project;
}

let nodeCount = 0;
let functionCount = 0;
function walk(node, depth) {
  if (node == null || depth > 80) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  nodeCount += 1;
  if (nodeCount > 20000) throw new Error('render tree exceeded node budget');
  const { type, props } = node;
  if (typeof type === 'function') {
    functionCount += 1;
    walk(type(props || {}), depth + 1);
    return;
  }
  if (typeof type === 'string') walk(props && props.children, depth + 1);
}

const baseProps = {
  zoom: 48,
  selectedId: null,
  skimming: true,
  snapping: true,
  onSelect() {},
  onSeek() {},
  onSkim() {},
  onZoom() {},
  onTogglePro() {},
  onToggleSkimming() {},
  onToggleSnapping() {},
  onSplit() {},
  onDelete() {},
  onUndo() {},
  onRedo() {},
  onDropAsset() {},
  onMoveClip() {},
  onTrimClip() {},
};

const scenarios = [
  ['empty project', () => engine.createProject(), { time: 0 }],
  ['clips + captions', () => buildProject(), { time: 3.25 }],
  ['pro mode', () => engine.setProMode(buildProject(), true), { time: 7.5 }],
  ['selected + captions', () => {
    const project = buildProject();
    return project;
  }, { time: 0.5, selectedId: 'clip-1' }],
];

for (const [label, make, extra] of scenarios) {
  const project = make();
  nodeCount = 0;
  functionCount = 0;
  try {
    walk(timeline.Timeline(Object.assign({}, baseProps, extra, { project, proMode: project.proMode })), 0);
  } catch (error) {
    console.error(`FAIL ${label}:`, error && error.stack ? error.stack : error);
    process.exitCode = 1;
    continue;
  }
  console.log(`ok   ${label}: ${nodeCount} nodes, ${functionCount} components`);
}

if (!process.exitCode) console.log('timeline render smoke ok');
