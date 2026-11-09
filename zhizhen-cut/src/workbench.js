/**
 * The Cutline single-window workbench: top bar, media/resource library, program
 * monitor with transport, hidden auxiliary drawers, magnetic timeline, import
 * and export flows, and the keyboard map.
 *
 * It is rendered into `shell.overlay` while open and reads the shared store from
 * `core.js`. The session entry button lives in `ui.js`.
 */
const {
  React,
  h,
  engine,
  store,
  useStore,
  t,
  clamp,
  formatDuration,
  formatBytes,
  icons,
  Btn,
  IconBtn,
  Toggle,
  Section,
  Spinner,
  Divider,
} = require('./core');
const media = require('./media');
const { Timeline } = require('./timeline');
const panels = require('./panels');

const { useState, useEffect, useRef, useCallback, useMemo } = React;

const PANEL_ORDER = ['ai', 'look', 'audio', 'captions'];

/** Derive the sequence-format <select> value from the project dimensions. */
function sequenceFormatValue(project) {
  const width = project.width || 1920;
  const height = project.height || 1080;
  const firstVideo = project.assets.find((asset) => asset.kind === 'video' && asset.width && asset.height);
  if (firstVideo && width === Math.round(firstVideo.width) && height === Math.round(firstVideo.height)) return 'source';
  if (width === 1920 && height === 1080) return 'landscape';
  if (width === 1080 && height === 1920) return 'portrait';
  if (width === 1080 && height === 1080) return 'square';
  return 'custom';
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function TopBar(props) {
  const {
    project,
    drawer,
    onOpenDrawer,
    onImport,
    onExport,
    onClose,
    onShortcuts,
    onRename,
    onReset,
  } = props;
  const clipCount = project.clips.length;
  const duration = engine.duration(project);
  const stats = clipCount
    ? `${t('app.clips', { count: clipCount })} · ${formatDuration(duration)} · ${project.width || 1920}×${project.height || 1080}`
    : t('app.emptyProject');

  return h(
    'header',
    { className: 'cl-topbar' },
    h(
      'div',
      { className: 'cl-brand' },
      h('span', { className: 'cl-brand-mark' }, h(icons.clapper, { size: 18 })),
      h(
        'div',
        { className: 'cl-brand-text' },
        h('div', { className: 'cl-brand-line' },
          h('b', null, t('app.title')),
          h('span', { className: 'cl-badge' }, t('app.badge')),
        ),
        h('div', { className: 'cl-brand-sub' }, t('app.sessionHint')),
      ),
      h('input', {
        className: 'cl-project-name',
        value: project.name || '',
        spellCheck: false,
        'aria-label': t('app.projectName'),
        onChange: (event) => onRename(event.target.value),
      }),
      h('span', { className: 'cl-top-stats' }, stats),
    ),

    h(
      'div',
      { className: 'cl-top-actions' },
      h(
        'div',
        { className: 'cl-tool-group' },
        h(
          'button',
          {
            type: 'button',
            className: `cl-tool${drawer === 'ai' ? ' is-active' : ''}`,
            onClick: () => onOpenDrawer('ai'),
            title: t('app.aiTitle'),
          },
          h(icons.sparkle, { size: 15 }),
          h('span', { className: 'cl-tool-label' }, t('app.ai')),
          h('kbd', { className: 'cl-tool-key' }, '⌥1'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: `cl-tool${drawer === 'look' ? ' is-active' : ''}`,
            onClick: () => onOpenDrawer('look'),
            title: t('app.lookTitle'),
          },
          h(icons.sliders, { size: 15 }),
          h('span', { className: 'cl-tool-label' }, t('app.look')),
          h('kbd', { className: 'cl-tool-key' }, '⌥2'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: `cl-tool${drawer === 'audio' ? ' is-active' : ''}`,
            onClick: () => onOpenDrawer('audio'),
            title: t('app.audioTitle'),
          },
          h(icons.wave, { size: 15 }),
          h('span', { className: 'cl-tool-label' }, t('app.audio')),
          h('kbd', { className: 'cl-tool-key' }, '⌥3'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: `cl-tool${drawer === 'captions' ? ' is-active' : ''}`,
            onClick: () => onOpenDrawer('captions'),
            title: t('app.captionsTitle'),
          },
          h(icons.cc, { size: 15 }),
          h('span', { className: 'cl-tool-label' }, t('app.captions')),
          h('kbd', { className: 'cl-tool-key' }, '⌥4'),
        ),
      ),
      h(Divider),
      h(
        Btn,
        { variant: 'ghost', icon: h(icons.upload, { size: 15 }), onClick: onImport, title: t('import.title') },
        h('span', { className: 'cl-btn-label' }, t('app.import')),
      ),
      h(
        Btn,
        {
          variant: 'primary',
          icon: h(icons.export, { size: 15 }),
          onClick: onExport,
          title: t('export.title') + '（⌘E）',
        },
        h('span', { className: 'cl-btn-label' }, t('app.export')),
      ),
      h(IconBtn, { icon: h(icons.keyboard, { size: 15 }), label: t('app.shortcuts'), onClick: onShortcuts }),
      h(IconBtn, { icon: h(icons.trash, { size: 14 }), label: t('app.reset'), onClick: onReset }),
      h(IconBtn, { icon: h(icons.close, { size: 16 }), label: t('app.close'), onClick: onClose }),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Media library                                                       */
/* ------------------------------------------------------------------ */

function AssetCard(props) {
  const { asset, onAppend, onSetMusic, onRemove, isMusic } = props;
  const [hover, setHover] = useState(false);
  return h(
    'div',
    {
      className: `cl-asset${isMusic ? ' is-music' : ''}`,
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData('application/x-cutline-asset', asset.id);
        event.dataTransfer.effectAllowed = 'copy';
      },
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      title: t('library.dragHint'),
    },
    h(
      'div',
      { className: 'cl-asset-thumb' },
      asset.thumbnail
        ? h('img', { src: asset.thumbnail, alt: '', draggable: false })
        : h('span', { className: 'cl-asset-thumb-fallback' }, asset.kind === 'audio' ? h(icons.music, { size: 18 }) : h(icons.film, { size: 18 })),
      asset.kind === 'audio' ? h('span', { className: 'cl-asset-kind' }, h(icons.music, { size: 10 })) : null,
      h('span', { className: 'cl-asset-duration' }, formatDuration(asset.duration)),
    ),
    h(
      'div',
      { className: 'cl-asset-meta' },
      h('b', { className: 'cl-asset-name' }, asset.name),
      h(
        'span',
        { className: 'cl-asset-info' },
        `${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}${formatBytes(asset.fileSize || 0)}`,
      ),
    ),
    hover
      ? h(
          'div',
          { className: 'cl-asset-actions' },
          h(IconBtn, {
            icon: h(icons.plus, { size: 14 }),
            label: t('library.append'),
            onClick: (event) => {
              event.stopPropagation();
              onAppend(asset.id);
            },
          }),
          asset.kind === 'audio'
            ? h(IconBtn, {
                icon: h(icons.music, { size: 13 }),
                label: t('library.setMusic'),
                onClick: (event) => {
                  event.stopPropagation();
                  onSetMusic(asset.id);
                },
              })
            : null,
          h(IconBtn, {
            icon: h(icons.trash, { size: 13 }),
            label: t('library.remove'),
            onClick: (event) => {
              event.stopPropagation();
              onRemove(asset.id);
            },
          }),
        )
      : null,
  );
}

function MediaLibrary(props) {
  const { project, onImport, onAppend, onRemoveAsset, onSetMusic, onToast, onSequenceChange, onToggleFit } = props;
  const [query, setQuery] = useState('');
  const assets = project.assets.filter((asset) =>
    query ? asset.name.toLowerCase().includes(query.toLowerCase()) : true,
  );
  const musicAsset = project.music ? project.assets.find((asset) => asset.id === project.music.assetId) : null;
  const totalSize = project.assets.reduce((sum, asset) => sum + (asset.fileSize || 0), 0);
  const duration = engine.duration(project);

  return h(
    'aside',
    { className: 'cl-library', 'aria-label': t('library.title') },
    h(
      'header',
      { className: 'cl-library-head' },
      h(
        'div',
        { className: 'cl-library-title' },
        h('h2', null, t('library.title')),
        h('span', null, t('library.count', { count: project.assets.length })),
      ),
      h(IconBtn, { icon: h(icons.plus, { size: 15 }), label: t('import.title'), onClick: onImport }),
    ),
    h(
      'div',
      { className: 'cl-library-search' },
      h('span', { className: 'cl-search-icon' }, '⌕'),
      h('input', {
        value: query,
        placeholder: t('library.search'),
        spellCheck: false,
        'aria-label': t('library.search'),
        onChange: (event) => setQuery(event.target.value),
      }),
    ),
    h(
      'div',
      { className: 'cl-library-body' },
      project.assets.length === 0
        ? h(
            'div',
            { className: 'cl-dropzone' },
            h('span', { className: 'cl-dropzone-icon' }, h(icons.upload, { size: 22 })),
            h('b', null, t('library.emptyTitle')),
            h('p', null, t('library.emptyBody')),
            h(Btn, { variant: 'primary', onClick: onImport, icon: h(icons.plus, { size: 14 }) }, t('library.emptyAction')),
            h('p', { className: 'cl-hint' }, t('library.dragHint')),
          )
        : h(
            'div',
            { className: 'cl-asset-list' },
            assets.length === 0
              ? h('p', { className: 'cl-hint cl-library-noresult' }, t('library.noResult'))
              : assets.map((asset) =>
                  h(AssetCard, {
                    key: asset.id,
                    asset,
                    isMusic: Boolean(musicAsset && musicAsset.id === asset.id),
                    onAppend,
                    onSetMusic,
                    onRemove: onRemoveAsset,
                  }),
                ),
            h(
              'button',
              { type: 'button', className: 'cl-import-tile', onClick: onImport },
              h(icons.plus, { size: 14 }),
              h('span', null, t('library.importMore')),
            ),
          ),
    ),
    h(
      'footer',
      { className: 'cl-library-foot' },
      h(
        'div',
        { className: 'cl-seq-row cl-seq-row--format' },
        h('span', null, t('library.sequence')),
        h(
          'div',
          { className: 'cl-seq-controls' },
          h(
            'select',
            {
              className: 'cl-seq-select',
              value: sequenceFormatValue(project),
              title: t('library.sequenceFormat'),
              'aria-label': t('library.sequenceFormat'),
              onChange: (event) => onSequenceChange && onSequenceChange(event.target.value),
            },
            sequenceFormatValue(project) === 'custom'
              ? h('option', { value: 'custom' }, `${t('library.seqCustom')} · ${project.width || 1920}×${project.height || 1080}`)
              : null,
            h('option', { value: 'source' }, t('library.seqSource')),
            h('option', { value: 'landscape' }, t('library.seqLandscape')),
            h('option', { value: 'portrait' }, t('library.seqPortrait')),
            h('option', { value: 'square' }, t('library.seqSquare')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'cl-fit-btn',
              title: t('library.fitHint'),
              onClick: onToggleFit,
            },
            (project.fit || 'contain') === 'cover' ? t('library.fitCover') : t('library.fitContain'),
          ),
        ),
      ),
      h(
        'div',
        { className: 'cl-seq-row' },
        h('span', null, t('library.duration')),
        h('b', null, formatDuration(duration)),
      ),
      h(
        'div',
        { className: 'cl-seq-row' },
        h('span', null, t('library.size')),
        h('b', null, formatBytes(totalSize)),
      ),
      h(
        'div',
        { className: 'cl-seq-row' },
        h('span', null, t('library.music')),
        h('b', { className: musicAsset ? 'cl-accent' : undefined }, musicAsset ? musicAsset.name : t('library.musicNone')),
      ),
      h('p', { className: 'cl-library-hint' }, t('library.footHint')),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Program monitor                                                     */
/* ------------------------------------------------------------------ */

function Stage(props) {
  const {
    project,
    time,
    playing,
    skimTime,
    stageRef,
    onTogglePlay,
    onStageClick,
    skimming,
    onToggleSkimming,
    onSeek,
    onMarkIn,
    onMarkOut,
    onClearMarks,
  } = props;

  const width = project.width || 1920;
  const height = project.height || 1080;
  const duration = engine.duration(project);
  const hasMarks = project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint;
  const empty = project.clips.length === 0;
  const orientation = width > height ? t('stage.landscape') : width < height ? t('stage.portrait') : t('stage.square');
  const areaRef = useRef(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const aspect = Math.max(0.2, Math.min(5, width / Math.max(1, height)));
    const measure = () => {
      const rect = area.getBoundingClientRect();
      const availW = Math.max(80, rect.width - 28);
      const availH = Math.max(80, rect.height - 24);
      let frameW = availW;
      let frameH = frameW / aspect;
      if (frameH > availH) {
        frameH = availH;
        frameW = frameH * aspect;
      }
      setFrameSize({ width: Math.max(40, Math.round(frameW)), height: Math.max(40, Math.round(frameH)) });
    };
    measure();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(area);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [width, height]);

  return h(
    'section',
    { className: 'cl-stage-col', 'aria-label': t('app.stage') },
    h(
      'div',
      { className: 'cl-stage-head' },
      h(
        'div',
        { className: 'cl-stage-title' },
        h('span', { className: 'cl-live-dot', 'aria-hidden': 'true' }),
        h('b', null, t('app.stage')),
        h('span', { className: 'cl-stage-res' }, `${orientation} · ${width}×${height} · ${project.fps || 30} fps`),
      ),
      h(
        'div',
        { className: 'cl-stage-badges' },
        h('span', { className: 'cl-pill' }, h(icons.film, { size: 11 }), t('app.previewProxy')),
        hasMarks
          ? h('span', { className: 'cl-pill cl-pill--accent' }, t('app.range'))
          : null,
      ),
    ),
    h(
      'div',
      { className: 'cl-stage-area', ref: areaRef },
      h(
        'div',
        {
          className: 'cl-stage-frame',
          style: frameSize.width ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` } : undefined,
          onClick: onStageClick,
          role: 'button',
          tabIndex: -1,
          title: t('app.stageClick'),
        },
        h('div', { className: 'cl-stage-host', ref: stageRef }),
        empty
          ? h(
              'div',
              { className: 'cl-stage-empty' },
              h('span', { className: 'cl-stage-empty-icon' }, h(icons.clapper, { size: 28 })),
              h('b', null, t('stage.emptyTitle')),
              h('p', null, t('stage.emptyBody')),
            )
          : null,
        h(
          'div',
          { className: 'cl-stage-overlay cl-stage-overlay--tl' },
          h('span', { className: 'cl-timecode' }, engine.formatClock(skimTime != null ? skimTime : time), skimTime != null
            ? h('em', { className: 'cl-skim-tag' }, t('stage.skimming'))
            : null),
          h('span', { className: 'cl-timecode-sub' }, '/ ' + engine.formatClock(duration)),
        ),
        hasMarks
          ? h(
              'div',
              { className: 'cl-stage-overlay cl-stage-overlay--tr' },
              h('span', { className: 'cl-mark' }, t('app.in') + ' ' + engine.formatClock(project.inPoint)),
              h('span', { className: 'cl-mark' }, t('app.out') + ' ' + engine.formatClock(project.outPoint)),
            )
          : null,
        !empty && !playing
          ? h(
              'button',
              {
                type: 'button',
                className: 'cl-big-play',
                onClick: (event) => {
                  event.stopPropagation();
                  onTogglePlay();
                },
                'aria-label': t('app.play'),
              },
              h(icons.play, { size: 22 }),
            )
          : null,
      ),
    ),
    h(
      'div',
      { className: 'cl-transport' },
      h(
        'div',
        { className: 'cl-transport-left' },
        h('span', { className: 'cl-transport-time' }, engine.formatClock(time)),
        h(
          'div',
          { className: 'cl-transport-buttons' },
          h(IconBtn, {
            icon: h(icons.stepBack, { size: 15 }),
            label: t('app.back1s'),
            onClick: () => onSeek(time - 1),
          }),
          h(IconBtn, {
            icon: h(icons.stepBack, { size: 13 }),
            label: t('app.stepBack'),
            onClick: () => onSeek(time - 1 / (project.fps || 30)),
          }),
          h(
            'button',
            {
              type: 'button',
              className: `cl-play-btn${playing ? ' is-playing' : ''}`,
              onClick: onTogglePlay,
              'aria-label': playing ? t('app.pause') : t('app.play'),
              title: playing ? t('app.pause') : t('app.play'),
            },
            playing ? h(icons.pause, { size: 18 }) : h(icons.play, { size: 18 }),
          ),
          h(IconBtn, {
            icon: h(icons.stepForward, { size: 13 }),
            label: t('app.stepForward'),
            onClick: () => onSeek(time + 1 / (project.fps || 30)),
          }),
          h(IconBtn, {
            icon: h(icons.stepForward, { size: 15 }),
            label: t('app.forward1s'),
            onClick: () => onSeek(time + 1),
          }),
        ),
        h('span', { className: 'cl-transport-duration' }, '/ ' + engine.formatClock(duration)),
      ),
      h(
        'div',
        { className: 'cl-transport-right' },
        h(
          'button',
          {
            type: 'button',
            className: `cl-mark-btn${skimming ? ' is-active' : ''}`,
            onClick: onToggleSkimming,
            title: t('stage.skimToggle'),
            'aria-pressed': skimming ? 'true' : 'false',
          },
          t('stage.skimToggle'),
          h('kbd', null, 'Z'),
        ),
        h(
          'div',
          { className: 'cl-mark-group' },
          h('button', { type: 'button', className: 'cl-mark-btn', onClick: onMarkIn, title: t('app.markIn') }, 'I'),
          h('button', { type: 'button', className: 'cl-mark-btn', onClick: onMarkOut, title: t('app.markOut') }, 'O'),
          hasMarks
            ? h('button', { type: 'button', className: 'cl-mark-btn', onClick: onClearMarks, title: t('app.clearMarks') }, '×')
            : null,
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Small overlays                                                      */
/* ------------------------------------------------------------------ */

function Toast(props) {
  if (!props.toast) return null;
  const { message, tone } = props.toast;
  return h(
    'div',
    { className: `cl-toast cl-toast--${tone || 'info'}`, role: 'status' },
    h('span', { className: 'cl-toast-dot', 'aria-hidden': 'true' }),
    h('span', null, message),
  );
}

function ImportStatus(props) {
  const state = props.state;
  if (!state) return null;
  const percent = state.total ? Math.round((state.done / state.total) * 100) : 0;
  return h(
    'div',
    { className: 'cl-import-status', role: 'status' },
    h(Spinner, { size: 'sm' }),
    h(
      'div',
      { className: 'cl-import-status-text' },
      h('b', null, t('import.importing', { done: state.done, total: state.total })),
      h('span', null, state.current || ''),
      h('div', { className: 'cl-progress cl-progress--sm' }, h('span', { style: { width: `${percent}%` } })),
    ),
  );
}

function DropOverlay() {
  return h(
    'div',
    { className: 'cl-drop-overlay' },
    h(icons.upload, { size: 34 }),
    h('b', null, t('import.drop')),
    h('p', null, t('import.dropHint')),
  );
}

/* ------------------------------------------------------------------ */
/* Workbench                                                           */
/* ------------------------------------------------------------------ */

function Workbench() {
  const s = useStore();
  const project = s.project;

  const [time, setTime] = useState(project.playhead || 0);
  const [playing, setPlaying] = useState(false);
  const [direction, setDirection] = useState(1);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState(48);
  const [selectedId, setSelectedId] = useState(null);
  const [skimming, setSkimming] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [skimTime, setSkimTime] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toastState, setToastState] = useState(null);
  const [importState, setImportState] = useState(null);
  const [dropActive, setDropActive] = useState(false);

  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const timeRef = useRef(project.playhead || 0);
  const skimRef = useRef(null);
  const importInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const overlayRef = useRef(null);
  const toastTimer = useRef(null);
  const dragDepth = useRef(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  const duration = engine.duration(project);
  const hasMarks = project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint;

  const toast = useCallback((message, tone) => {
    setToastState({ message, tone: tone || 'info', key: Date.now() });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastState(null), 3800);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ---- preview engine lifecycle ---- */
  useEffect(() => {
    const host = stageRef.current;
    if (!host) return undefined;
    let player = null;
    try {
      player = new media.PreviewEngine(host);
      playerRef.current = player;
    } catch (error) {
      console.error('cutline: preview engine failed', error);
      return undefined;
    }
    Promise.resolve(player.ensureProject(store.project))
      .then(() => {
        try {
          player.render(store.project, timeRef.current, { playing: false });
        } catch (error) {
          /* a not-yet-ready frame is not fatal */
        }
      })
      .catch((error) => console.error('cutline: ensureProject failed', error));
    return () => {
      try {
        player.dispose();
      } catch (error) {
        /* ignore */
      }
      if (playerRef.current === player) playerRef.current = null;
    };
  }, []);

  const assetKey = project.assets.map((asset) => asset.id).join('|');
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    Promise.resolve(player.ensureProject(store.project))
      .then(() => {
        try {
          player.render(store.project, timeRef.current, { playing: false });
        } catch (error) {
          /* ignore */
        }
      })
      .catch((error) => console.error('cutline: ensureProject failed', error));
  }, [assetKey]);

  /* ---- render current frame when idle / scrubbed / skimmed ---- */
  useEffect(() => {
    if (playing) return;
    const player = playerRef.current;
    if (!player) return;
    const at = skimTime != null ? skimTime : time;
    try {
      player.render(store.project, at, { playing: false, skim: skimTime != null });
    } catch (error) {
      /* ignore a frame that arrives before metadata */
    }
  }, [s.version, time, skimTime, playing]);

  /* ---- playback clock ---- */
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let stopped = false;
    let last = performance.now();
    let carry = 0;
    const tick = (now) => {
      if (stopped) return;
      const dt = Math.min(0.12, (now - last) / 1000);
      last = now;
      const total = engine.duration(store.project);
      let next = timeRef.current + dt * rate * direction;

      if (next >= total - 1e-4) {
        timeRef.current = total;
        store.setPlayheadSilent(total);
        setTime(total);
        setPlaying(false);
        setRate(1);
        setDirection(1);
        try {
          playerRef.current && playerRef.current.render(store.project, total, { playing: false });
        } catch (error) {
          /* ignore */
        }
        return;
      }
      if (next <= 0) {
        timeRef.current = 0;
        store.setPlayheadSilent(0);
        setTime(0);
        setPlaying(false);
        setRate(1);
        setDirection(1);
        try {
          playerRef.current && playerRef.current.render(store.project, 0, { playing: false });
        } catch (error) {
          /* ignore */
        }
        return;
      }

      timeRef.current = next;
      store.setPlayheadSilent(next);
      carry += dt;
      if (carry >= 0.045) {
        carry = 0;
        setTime(next);
      }
      try {
        playerRef.current &&
          playerRef.current.render(store.project, next, { playing: true, direction, rate });
      } catch (error) {
        /* keep the clock alive even if one frame fails */
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
    };
  }, [playing, rate, direction]);

  /* ---- keep playhead legal when the project shrinks ---- */
  useEffect(() => {
    const total = engine.duration(project);
    if (timeRef.current > total) {
      timeRef.current = total;
      setTime(total);
      store.setPlayheadSilent(total);
    }
  }, [s.version, project]);

  useEffect(() => {
    if (selectedId && !project.clips.some((clip) => clip.id === selectedId)) setSelectedId(null);
  }, [project.clips, selectedId]);

  useEffect(() => {
    if (overlayRef.current) {
      try {
        overlayRef.current.focus({ preventScroll: true });
      } catch (error) {
        /* ignore */
      }
    }
  }, []);

  /* ---- actions ---- */
  const seek = useCallback((value) => {
    const total = engine.duration(store.project);
    const next = clamp(Number(value) || 0, 0, total);
    timeRef.current = next;
    setTime(next);
    store.setPlayheadSilent(next);
    try {
      playerRef.current && playerRef.current.render(store.project, next, { playing: false });
    } catch (error) {
      /* ignore */
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (engine.duration(store.project) <= 0.01) {
      toast(t('app.needClips'), 'warn');
      return;
    }
    setPlaying((value) => {
      if (value) return false;
      const total = engine.duration(store.project);
      if (timeRef.current >= total - 0.01) {
        timeRef.current = 0;
        setTime(0);
      }
      setDirection(1);
      setRate(1);
      return true;
    });
  }, [toast]);

  const pause = useCallback(() => {
    setPlaying(false);
    setRate(1);
    setDirection(1);
  }, []);

  const nudgeSpeed = useCallback(
    (dir) => {
      if (engine.duration(store.project) <= 0.01) return;
      if (playing && direction === dir) {
        setRate((value) => (value >= 4 ? 1 : value * 2));
      } else {
        setDirection(dir);
        setRate(dir < 0 ? 2 : 1);
        setPlaying(true);
      }
    },
    [playing, direction],
  );

  const handleSkim = useCallback((value) => {
    setSkimTime(value);
    skimRef.current = value;
    const player = playerRef.current;
    if (!player) return;
    try {
      player.render(store.project, value == null ? timeRef.current : value, {
        playing: false,
        skim: value != null,
      });
    } catch (error) {
      /* ignore */
    }
  }, []);

  const update = useCallback((updater, options) => store.update(updater, options), []);

  const splitAtPlayhead = useCallback(() => {
    const at = timeRef.current;
    let newId = null;
    store.update((p) => {
      const result = engine.splitAt(engine.seek(p, at), at);
      newId = result.clipId || null;
      return result.project;
    });
    if (newId) {
      setSelectedId(newId);
      toast(t('edit.splitDone'), 'success');
    } else {
      toast(t('edit.splitEmpty'), 'warn');
    }
  }, [toast]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) {
      toast(t('edit.selectFirst'), 'warn');
      return;
    }
    store.update((p) => engine.removeClip(p, selectedId));
    setSelectedId(null);
    toast(t('edit.deleted'), 'info');
  }, [selectedId, toast]);

  const undo = useCallback(() => {
    if (store.undo()) {
      const total = engine.duration(store.project);
      const next = clamp(timeRef.current, 0, total);
      timeRef.current = next;
      setTime(next);
      toast(t('edit.undoDone'), 'info');
    } else {
      toast(t('edit.undoEmpty'), 'info');
    }
  }, [toast]);

  const redo = useCallback(() => {
    if (store.redo()) {
      const total = engine.duration(store.project);
      const next = clamp(timeRef.current, 0, total);
      timeRef.current = next;
      setTime(next);
      toast(t('edit.redoDone'), 'info');
    } else {
      toast(t('edit.redoEmpty'), 'info');
    }
  }, [toast]);

  const openPanel = useCallback((name) => {
    if (!name) return;
    setDrawer((current) => (current === name ? null : name));
  }, []);

  const setSequenceFormat = useCallback(
    (kind) => {
      const firstVideo = store.project.assets.find((asset) => asset.kind === 'video' && asset.width && asset.height);
      let nextWidth = null;
      let nextHeight = null;
      if (kind === 'source') {
        if (!firstVideo) {
          toast(t('library.seqNoSource'), 'warn');
          return;
        }
        nextWidth = Math.round(firstVideo.width);
        nextHeight = Math.round(firstVideo.height);
      } else if (kind === 'landscape') {
        nextWidth = 1920;
        nextHeight = 1080;
      } else if (kind === 'portrait') {
        nextWidth = 1080;
        nextHeight = 1920;
      } else if (kind === 'square') {
        nextWidth = 1080;
        nextHeight = 1080;
      } else {
        return;
      }
      store.update((p) => ({ ...p, width: nextWidth, height: nextHeight, sequencePreset: kind }));
      toast(t('library.seqChanged', { size: `${nextWidth}×${nextHeight}` }), 'success');
    },
    [toast],
  );

  const toggleFit = useCallback(() => {
    store.update((p) => ({ ...p, fit: (p.fit || 'contain') === 'cover' ? 'contain' : 'cover' }));
    toast(t('library.fitChanged'), 'info');
  }, [toast]);

  const importFromInput = useCallback(() => {
    if (importInputRef.current) importInputRef.current.click();
  }, []);

  const importFromFolder = useCallback(() => {
    if (folderInputRef.current) folderInputRef.current.click();
  }, []);

  const appendAsset = useCallback(
    (assetId) => {
      let newId = null;
      store.update((p) => {
        const result = engine.appendClip(p, assetId);
        newId = result.clipId || null;
        return result.project;
      });
      if (newId) {
        setSelectedId(newId);
        const clip = store.project.clips.find((item) => item.id === newId);
        toast(t('edit.appended', { name: clip ? clip.label : '' }), 'success');
      }
    },
    [toast],
  );

  const insertAssetAt = useCallback((assetId, index) => {
    let newId = null;
    store.update((p) => {
      const result = engine.insertClip(p, assetId, index);
      newId = result.clipId || null;
      return result.project;
    });
    if (newId) setSelectedId(newId);
  }, []);

  const setMusic = useCallback(
    (assetId) => {
      store.update((p) => engine.setMusic(p, assetId));
      const asset = store.project.assets.find((item) => item.id === assetId);
      toast(t('audio.musicSet', { name: asset ? asset.name : '' }), 'success');
    },
    [toast],
  );

  const removeAsset = useCallback(
    (assetId) => {
      store.update((p) => engine.removeAsset(p, assetId));
      toast(t('library.removed'), 'info');
    },
    [toast],
  );

  const importFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((file) => {
        if (/^video\//.test(file.type) || /^audio\//.test(file.type)) return true;
        return /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
      });
      if (!files.length) {
        toast(t('import.noFiles'), 'warn');
        return;
      }
      setImportState({ total: files.length, done: 0, current: files[0].name, percent: 0 });
      let addedVideos = 0;
      let addedAudio = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setImportState({ total: files.length, done: index, current: file.name, percent: 0 });
        try {
          const asset = await media.loadAsset(file, {
            id: engine.newId('asset'),
            onProgress: (value) => {
              setImportState((current) =>
                current ? { ...current, percent: clamp(value, 0, 1) } : current,
              );
            },
          });
          store.update((p) => {
            let next = engine.addAsset(p, asset);
            if (!p.clips.length && asset.kind === 'video' && asset.width && asset.height) {
              next = { ...next, width: Math.round(asset.width), height: Math.round(asset.height), sequencePreset: 'source' };
            }
            // Videos are laid onto the timeline for a fast first assembly; audio
            // imports stay in the library so they can be used as a music bed or
            // explicitly appended, without duplicating as both clip and bed.
            if (asset.kind === 'video') {
              const result = engine.appendClip(next, asset.id, { role: 'dialogue' });
              return result.project;
            }
            return next;
          }, { coalesceKey: 'import' });
          if (asset.kind === 'video') addedVideos += 1;
          else addedAudio += 1;
          setSelectedId(store.project.clips[store.project.clips.length - 1]?.id || null);
        } catch (error) {
          console.error('cutline: import failed', file.name, error);
          toast(t('import.failed', { name: file.name }), 'error');
        }
      }
      setImportState(null);
      if (addedVideos && addedAudio) {
        toast(t('import.doneMixed', { videos: addedVideos, audio: addedAudio }), 'success');
      } else if (addedVideos) {
        toast(t('import.done', { count: addedVideos }), 'success');
      } else if (addedAudio) {
        toast(t('import.audioDone', { count: addedAudio }), 'success');
      }
    },
    [toast],
  );

  const clearProject = useCallback(() => {
    if (!project.clips.length && !project.assets.length) {
      toast(t('app.alreadyEmpty'), 'info');
      return;
    }
    if (!window.confirm(t('app.resetConfirm'))) return;
    store.resetProject();
    setSelectedId(null);
    setTime(0);
    timeRef.current = 0;
    toast(t('app.resetDone'), 'info');
  }, [project.clips.length, project.assets.length, toast]);

  /* ---- OS drag and drop ---- */
  const onDragEnter = (event) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) {
      event.preventDefault();
      dragDepth.current += 1;
      setDropActive(true);
    }
  };
  const onDragOver = (event) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDragLeave = (event) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropActive(false);
    }
  };
  const onDrop = (event) => {
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      event.preventDefault();
      dragDepth.current = 0;
      setDropActive(false);
      importFiles(event.dataTransfer.files);
    }
  };

  /* ---- keyboard map ---- */
  const onKeyDown = (event) => {
    const target = event.target;
    const tag = target && target.tagName;
    const editing =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
    const mod = event.metaKey || event.ctrlKey;
    const alt = event.altKey;
    const key = event.key;
    const lower = key.toLowerCase();
    const code = event.code || '';

    if (editing) {
      if (key === 'Escape') target.blur();
      event.stopPropagation();
      return;
    }

    if (exportOpen) {
      if (key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
      } else {
        event.stopPropagation();
      }
      return;
    }
    if (shortcutsOpen) {
      if (key === 'Escape' || key === '?') {
        event.preventDefault();
        setShortcutsOpen(false);
      }
      event.stopPropagation();
      return;
    }

    let handled = true;
    if (mod && lower === 'z') {
      event.shiftKey ? redo() : undo();
    } else if (mod && lower === 'b') {
      splitAtPlayhead();
    } else if (mod && lower === 'i') {
      importFromInput();
    } else if (mod && lower === 'e') {
      pause();
      setExportOpen(true);
    } else if (alt && /^Digit[1-4]$/.test(code)) {
      openPanel(NUM_TO_PANEL[Number(code.slice(-1))]);
    } else if (alt && (lower === 'c' || code === 'KeyC')) {
      store.closeWorkbench();
    } else if (key === ' ') {
      togglePlay();
    } else if (lower === 'k') {
      pause();
    } else if (lower === 'l') {
      nudgeSpeed(1);
    } else if (lower === 'j') {
      nudgeSpeed(-1);
    } else if (key === 'ArrowLeft') {
      pause();
      seek(timeRef.current - (event.shiftKey ? 10 : 1) / (project.fps || 30));
    } else if (key === 'ArrowRight') {
      pause();
      seek(timeRef.current + (event.shiftKey ? 10 : 1) / (project.fps || 30));
    } else if (lower === 'i') {
      store.update((p) => engine.setInPoint(engine.seek(p, timeRef.current)));
      toast(t('edit.markIn'), 'info');
    } else if (lower === 'o') {
      store.update((p) => engine.setOutPoint(engine.seek(p, timeRef.current)));
      toast(t('edit.markOut'), 'info');
    } else if (lower === 'b') {
      splitAtPlayhead();
    } else if (key === 'Delete' || key === 'Backspace') {
      deleteSelected();
    } else if (lower === 'z') {
      setSkimming((value) => !value);
    } else if (lower === 'n') {
      setSnapping((value) => !value);
    } else if (lower === 'p') {
      store.update((p) => engine.setProMode(p, !p.proMode));
    } else if (key === '+' || key === '=') {
      setZoom((value) => clamp(value * 1.25, 8, 260));
    } else if (key === '-' || key === '_') {
      setZoom((value) => clamp(value / 1.25, 8, 260));
    } else if (key === '?' || (key === '/' && event.shiftKey)) {
      setShortcutsOpen(true);
    } else if (key === 'Escape') {
      if (drawer) setDrawer(null);
      else store.closeWorkbench();
    } else {
      handled = false;
    }

    if (handled) event.preventDefault();
    // Keep host-wide shortcuts from firing behind the modal workbench.
    event.stopPropagation();
  };

  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = onKeyDown;
  useEffect(() => {
    const listener = (event) => {
      const handler = keyHandlerRef.current;
      if (handler) handler(event);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const hasProject = project.clips.length > 0 || project.assets.length > 0;

  return h(
    'div',
    {
      className: 'cl-app',
      ref: overlayRef,
      tabIndex: -1,
      role: 'application',
      'aria-label': t('app.title'),
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    h(TopBar, {
      project,
      drawer,
      onOpenDrawer: openPanel,
      onImport: importFromInput,
      onExport: () => {
        pause();
        setExportOpen(true);
      },
      onClose: () => store.closeWorkbench(),
      onShortcuts: () => setShortcutsOpen(true),
      onRename: (value) => update((p) => ({ ...p, name: value }), { coalesceKey: 'rename' }),
      onReset: clearProject,
    }),

    h(
      'main',
      { className: 'cl-main' },
      h(MediaLibrary, {
        project,
        onImport: importFromInput,
        onAppend: appendAsset,
        onRemoveAsset: removeAsset,
        onSetMusic: setMusic,
        onToast: toast,
        onSequenceChange: setSequenceFormat,
        onToggleFit: toggleFit,
      }),
      h(Stage, {
        project,
        time,
        playing,
        skimTime,
        stageRef,
        onTogglePlay: togglePlay,
        onStageClick: () => {
          if (project.clips.length) togglePlay();
        },
        skimming,
        onToggleSkimming: () => setSkimming((value) => !value),
        onSeek: seek,
        onMarkIn: () => {
          store.update((p) => engine.setInPoint(engine.seek(p, timeRef.current)));
          toast(t('edit.markIn'), 'info');
        },
        onMarkOut: () => {
          store.update((p) => engine.setOutPoint(engine.seek(p, timeRef.current)));
          toast(t('edit.markOut'), 'info');
        },
        onClearMarks: () => {
          store.update((p) => engine.clearMarks(p));
          toast(t('edit.marksCleared'), 'info');
        },
      }),
      drawer
        ? h(panels.DrawerPanel, {
            name: drawer,
            project,
            selectedId,
            onUpdate: update,
            onSeek: seek,
            onSelect: setSelectedId,
            onClose: () => setDrawer(null),
            onOpenPanel: openPanel,
            onImport: importFromInput,
            onImportFolder: importFromFolder,
            onToast: toast,
          })
        : null,
    ),

    h(
      'section',
      { className: 'cl-timeline-region', 'aria-label': t('timeline.region') },
      h(Timeline, {
        project,
        time,
        zoom,
        selectedId,
        proMode: Boolean(project.proMode),
        skimming,
        snapping,
        t,
        onSelect: setSelectedId,
        onSeek: seek,
        onSkim: handleSkim,
        onZoom: (value) => setZoom(clamp(value, 8, 260)),
        onTogglePro: () => store.update((p) => engine.setProMode(p, !p.proMode)),
        onToggleSkimming: () => setSkimming((value) => !value),
        onToggleSnapping: () => setSnapping((value) => !value),
        onSplit: splitAtPlayhead,
        onDelete: deleteSelected,
        onUndo: undo,
        onRedo: redo,
        onDropAsset: insertAssetAt,
        onMoveClip: (from, to) => store.update((p) => engine.moveClip(p, from, to)),
        onTrimClip: (clipId, edge, sourceTime) =>
          store.update((p) => engine.trimClip(p, clipId, edge, sourceTime), {
            coalesceKey: `trim:${clipId}:${edge}`,
          }),
      }),
    ),

    h('input', {
      ref: importInputRef,
      type: 'file',
      accept: 'video/*,audio/*',
      multiple: true,
      className: 'cl-file-input',
      tabIndex: -1,
      onChange: (event) => {
        const files = event.target.files;
        importFiles(files);
        event.target.value = '';
      },
    }),

    h('input', {
      ref: folderInputRef,
      type: 'file',
      accept: 'audio/*,video/*',
      multiple: true,
      webkitdirectory: 'true',
      directory: 'true',
      className: 'cl-file-input',
      tabIndex: -1,
      onChange: (event) => {
        const files = event.target.files;
        importFiles(files);
        event.target.value = '';
      },
    }),

    dropActive ? h(DropOverlay) : null,
    h(ImportStatus, { state: importState }),
    h(Toast, { toast: toastState }),

    h(panels.ExportModal, {
      open: exportOpen,
      project,
      onClose: () => setExportOpen(false),
      onToast: toast,
    }),
    h(panels.ShortcutsModal, { open: shortcutsOpen, onClose: () => setShortcutsOpen(false) }),

    hasProject
      ? null
      : h(
          'div',
          { className: 'cl-firstrun', role: 'note' },
          h('span', null, t('firstrun.hint')),
          h('kbd', null, '⌘I'),
        ),
  );
}

const NUM_TO_PANEL = {
  1: 'ai',
  2: 'look',
  3: 'audio',
  4: 'captions',
};

module.exports = { Workbench };
