/**
 * Hidden auxiliary panels (AI, look/color, audio, captions) plus the export and
 * shortcuts dialogs for the Cutline workbench. Mounted inside the right drawer /
 * a modal layer by `workbench.js`; every data change goes through the `onUpdate`
 * wrapper supplied by the workbench so undo history stays consistent.
 */
const {
  React,
  h,
  engine,
  t,
  clamp,
  formatDuration,
  formatBytes,
  icons,
  Btn,
  IconBtn,
  Toggle,
  Slider,
  Section,
  Chip,
  Spinner,
} = require('./core');
const media = require('./media');

const { useState, useEffect, useMemo, useRef } = React;

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function PanelHero(props) {
  const Icon = props.icon;
  return h(
    'div',
    { className: 'cl-panel-hero' },
    h('span', { className: 'cl-panel-hero-icon' }, h(Icon, { size: 18 })),
    h(
      'div',
      null,
      h('h2', null, props.title),
      h('p', null, props.body),
    ),
  );
}

function RoleDot(props) {
  return h('span', {
    className: 'cl-role-dot',
    style: { background: engine.roleColor(props.role) },
    'aria-hidden': 'true',
  });
}

function roleLabel(role) {
  return t(`role.${role}`);
}

function LookArt(props) {
  const preset = props.preset;
  return h(
    'div',
    { className: 'cl-look-art' },
    h('div', {
      className: 'cl-look-art-inner',
      style: {
        filter: preset.css === 'none' ? 'none' : preset.css,
        background:
          'radial-gradient(120% 120% at 20% 15%, #ffd2a1 0%, #d1734a 34%, #5a3f77 68%, #16233b 100%)',
      },
    }),
    props.active ? h('span', { className: 'cl-look-check' }, h(icons.check, { size: 12 })) : null,
    h('span', { className: 'cl-look-name' }, preset.name),
  );
}

/* ------------------------------------------------------------------ */
/* AI panel                                                            */
/* ------------------------------------------------------------------ */

function AiPanel(props) {
  const { project, selectedId, onUpdate, onSeek, onToast, onOpenPanel } = props;
  const [threshold, setThreshold] = useState(0.055);
  const [minSilence, setMinSilence] = useState(0.35);
  const [script, setScript] = useState('');
  const [styleId, setStyleId] = useState(engine.CAPTION_STYLES[0] ? engine.CAPTION_STYLES[0].id : 'clean');
  const [busy, setBusy] = useState(null);

  const hasAudio = project.assets.some((asset) => asset.peaks && asset.peaks.length);
  const clipCount = project.clips.length;

  const runRoughCut = async () => {
    if (!clipCount) {
      onToast(t('ai.needClips'), 'warn');
      return;
    }
    setBusy('rough');
    try {
      let working = project;
      const missing = [];
      const seen = new Set();
      for (const entry of engine.timeline(project)) {
        const asset = entry.asset;
        if (!asset || seen.has(asset.id)) continue;
        seen.add(asset.id);
        if (!(asset.peaks && asset.peaks.length) && typeof media.analyzeAssetAudio === 'function') {
          missing.push(asset);
          if (missing.length >= 6) break;
        }
      }

      // Some MP4/MOV/AAC containers cannot be decoded with decodeAudioData.
      // Fall back to a fast media-element analysis pass so the AI tools still
      // work on real phone footage.
      let analyzed = 0;
      for (const asset of missing) {
        if (typeof media.analyzeAssetAudio !== 'function') break;
        const peaks = await media.analyzeAssetAudio(asset, {
          rate: asset.duration > 120 ? 16 : 8,
          maxSeconds: 45,
        });
        if (peaks) {
          analyzed += 1;
          working = {
            ...working,
            assets: working.assets.map((item) =>
              item.id === asset.id ? { ...item, peaks, hasAudio: true } : item,
            ),
          };
        }
      }

      if (!working.assets.some((asset) => asset.peaks && asset.peaks.length)) {
        setBusy(null);
        onToast(analyzed ? t('ai.analyzeFailed') : t('ai.needAudio'), 'warn');
        return;
      }

      const plan = engine.planSilenceCut(working, { threshold, minSilence });
      const result = engine.roughCut(working, plan);
      if (!result || !result.project || result.project === working) {
        if (analyzed) onUpdate(working);
        setBusy(null);
        onToast(t('ai.noSilence'), 'info');
        return;
      }
      onUpdate(result.project);
      setBusy(null);
      const suffix = analyzed ? t('ai.analyzedSuffix', { count: analyzed }) : '';
      onToast(t('ai.roughDone', { seconds: result.removedSeconds.toFixed(1) }) + suffix, 'success');
      onSeek(0);
    } catch (error) {
      setBusy(null);
      onToast(t('ai.roughFailed'), 'error');
      if (typeof console !== 'undefined') console.error('cutline rough cut failed', error);
    }
  };

  const runScriptCaptions = () => {
    const text = script.trim();
    if (!text) {
      onToast(t('ai.needScript'), 'warn');
      return;
    }
    if (!clipCount) {
      onToast(t('ai.needClips'), 'warn');
      return;
    }
    try {
      const next = engine.captionsFromScript(project, text, { styleId });
      const count = next.captions.length;
      if (!count) {
        onToast(t('ai.captionFailed'), 'warn');
        return;
      }
      onUpdate(next);
      onToast(t('ai.captionDone', { count }), 'success');
      onOpenPanel('captions');
    } catch (error) {
      onToast(t('ai.captionFailed'), 'error');
      if (typeof console !== 'undefined') console.error('cutline captions failed', error);
    }
  };

  return h(
    'div',
    { className: 'cl-panel cl-panel--ai' },
    h(PanelHero, {
      icon: icons.sparkle,
      title: t('ai.title'),
      body: t('ai.body'),
    }),

    h(
      Section,
      {
        title: t('ai.roughTitle'),
        subtitle: t('ai.roughBody'),
        right: busy === 'rough' ? h(Spinner, { size: 'sm' }) : null,
      },
      h(
        'div',
        { className: 'cl-card' },
        h(Slider, {
          label: t('ai.threshold'),
          value: threshold,
          min: 0.02,
          max: 0.18,
          step: 0.005,
          valueLabel: Math.round(threshold * 1000) + '',
          onChange: setThreshold,
        }),
        h(Slider, {
          label: t('ai.minSilence'),
          value: minSilence,
          min: 0.15,
          max: 1.2,
          step: 0.05,
          valueLabel: minSilence.toFixed(2) + 's',
          onChange: setMinSilence,
        }),
        h(
          'div',
          { className: 'cl-row cl-row--between' },
          h('span', { className: 'cl-muted' }, hasAudio ? t('ai.audioReady', { count: clipCount }) : t('ai.willAnalyze')),
          h(
            Btn,
            {
              variant: 'accent',
              icon: h(icons.wand, { size: 14 }),
              disabled: Boolean(busy) || !clipCount,
              onClick: runRoughCut,
            },
            busy === 'rough' ? t('ai.analyzing') : t('ai.roughAction'),
          ),
        ),
      ),
    ),

    h(
      Section,
      { title: t('ai.scriptTitle'), subtitle: t('ai.scriptBody') },
      h(
        'div',
        { className: 'cl-card' },
        h('textarea', {
          className: 'cl-textarea',
          rows: 5,
          value: script,
          placeholder: t('ai.scriptPlaceholder'),
          onChange: (event) => setScript(event.target.value),
        }),
        h(
          'div',
          { className: 'cl-row cl-row--wrap' },
          engine.CAPTION_STYLES.map((style) =>
            h(
              Chip,
              {
                key: style.id,
                active: styleId === style.id,
                onClick: () => setStyleId(style.id),
              },
              style.name,
            ),
          ),
        ),
        h(
          'div',
          { className: 'cl-row cl-row--between' },
          h('span', { className: 'cl-muted' }, t('ai.scriptHint')),
          h(Btn, { variant: 'primary', icon: h(icons.cc, { size: 14 }), onClick: runScriptCaptions }, t('ai.scriptAction')),
        ),
      ),
    ),

    h(
      Section,
      { title: t('ai.duckTitle'), subtitle: t('ai.duckBody') },
      h(
        'div',
        { className: 'cl-card' },
        h(Toggle, {
          checked: Boolean(project.ducking && project.ducking.enabled),
          onChange: (enabled) => onUpdate(engine.setDucking(project, enabled)),
          label: t('ai.duckToggle'),
        }),
        h(Slider, {
          label: t('ai.duckLevel'),
          value: project.ducking ? project.ducking.level : 0.22,
          min: 0,
          max: 1,
          step: 0.01,
          valueLabel: Math.round((project.ducking ? project.ducking.level : 0.22) * 100) + '%',
          disabled: !project.ducking || !project.ducking.enabled,
          onChange: (value) => onUpdate(engine.setDucking(project, true, value)),
        }),
        h('p', { className: 'cl-hint' }, t('ai.duckHint')),
      ),
    ),

    h(
      Section,
      { title: t('ai.rolesTitle'), subtitle: t('ai.rolesBody') },
      h(
        'div',
        { className: 'cl-role-row' },
        engine.ROLES.map((role) =>
          h(
            'button',
            {
              key: role.id,
              type: 'button',
              className: 'cl-role-tile',
              onClick: () => {
                if (selectedId) onUpdate(engine.setClipRole(project, selectedId, role.id));
                else onOpenPanel('audio');
                onToast(selectedId ? t('ai.roleApplied', { role: roleLabel(role.id) }) : t('role.pickClip'), 'info');
              },
              title: t('ai.roleApplyHint'),
            },
            h(RoleDot, { role: role.id }),
            h('b', null, roleLabel(role.id)),
            h('span', null, t(`role.${role.id}.short`)),
          ),
        ),
      ),
      h(
        'div',
        { className: 'cl-row cl-row--between' },
        h('span', { className: 'cl-hint' }, t('ai.separationNote')),
        h(Btn, { size: 'sm', onClick: () => onOpenPanel('audio') }, t('ai.openMixer')),
      ),
    ),

    h(
      Section,
      { title: t('ai.lookTitle'), subtitle: t('ai.lookBody') },
      h(
        'div',
        { className: 'cl-look-grid cl-look-grid--compact' },
        engine.FILTERS.map((preset) =>
          h(
            'button',
            {
              key: preset.id,
              type: 'button',
              className: `cl-look-card${project.filter === preset.id ? ' is-active' : ''}`,
              onClick: () => {
                onUpdate(engine.setFilter(project, preset.id));
                onToast(t('ai.lookApplied', { name: preset.name }), 'success');
              },
            },
            h(LookArt, { preset, active: project.filter === preset.id }),
          ),
        ),
      ),
    ),

    h('p', { className: 'cl-footnote' }, t('ai.footnote')),
  );
}

/* ------------------------------------------------------------------ */
/* Look / color panel                                                  */
/* ------------------------------------------------------------------ */

function LookPanel(props) {
  const { project, selectedId, onUpdate, onToast } = props;
  const [target, setTarget] = useState('project');
  const selected = selectedId ? project.clips.find((clip) => clip.id === selectedId) : null;
  const activeId = target === 'clip' && selected ? selected.filter || 'none' : project.filter || 'none';

  const apply = (presetId) => {
    if (target === 'clip') {
      if (!selectedId) {
        onToast(t('look.pickClipFirst'), 'warn');
        return;
      }
      onUpdate(engine.setClipFilter(project, selectedId, presetId));
      onToast(t('look.clipApplied', { name: presetName(presetId) }), 'success');
    } else {
      onUpdate(engine.setFilter(project, presetId));
      onToast(t('look.projectApplied', { name: presetName(presetId) }), 'success');
    }
  };

  return h(
    'div',
    { className: 'cl-panel' },
    h(PanelHero, { icon: icons.sliders, title: t('look.title'), body: t('look.body') }),
    h(
      Section,
      {
        title: t('look.targetTitle'),
        right: h(
          'div',
          { className: 'cl-segmented' },
          h(Chip, { active: target === 'project', onClick: () => setTarget('project') }, t('look.targetProject')),
          h(Chip, { active: target === 'clip', onClick: () => setTarget('clip') }, t('look.targetClip')),
        ),
      },
      target === 'clip'
        ? h('p', { className: 'cl-hint' }, selected ? t('look.selectedClip', { name: selected.label || selected.role }) : t('look.noClip'))
        : h('p', { className: 'cl-hint' }, t('look.projectHint')),
    ),
    h(
      'div',
      { className: 'cl-look-grid' },
      engine.FILTERS.map((preset) =>
        h(
          'button',
          {
            key: preset.id,
            type: 'button',
            className: `cl-look-card${activeId === preset.id ? ' is-active' : ''}`,
            onClick: () => apply(preset.id),
          },
          h(LookArt, { preset, active: activeId === preset.id }),
        ),
      ),
    ),
    h(
      Section,
      { title: t('look.proTitle'), subtitle: t('look.proBody') },
      h(
        'div',
        { className: 'cl-card cl-card--quiet' },
        h(
          'ul',
          { className: 'cl-bullet-list' },
          h('li', null, t('look.proPoint1')),
          h('li', null, t('look.proPoint2')),
          h('li', null, t('look.proPoint3')),
        ),
      ),
    ),
  );
}

function presetName(id) {
  const preset = engine.FILTERS.find((item) => item.id === id);
  return preset ? preset.name : id;
}

/* ------------------------------------------------------------------ */
/* Audio panel                                                         */
/* ------------------------------------------------------------------ */

function AudioPanel(props) {
  const { project, onUpdate, onToast, onOpenPanel, onImport, onImportFolder } = props;
  const musicAsset = project.music ? project.assets.find((asset) => asset.id === project.music.assetId) : null;
  const candidates = project.assets.filter((asset) => asset.kind === 'audio');

  const setMusic = (asset) => {
    onUpdate(engine.setMusic(project, asset.id));
    onToast(t('audio.musicSet', { name: asset.name }), 'success');
  };

  return h(
    'div',
    { className: 'cl-panel' },
    h(PanelHero, { icon: icons.wave, title: t('audio.title'), body: t('audio.body') }),

    h(
      Section,
      {
        title: t('audio.rolesTitle'),
        subtitle: t('audio.rolesBody'),
        right: h(Btn, { size: 'sm', onClick: () => onOpenPanel('ai') }, t('audio.aiLink')),
      },
      h(
        'div',
        { className: 'cl-mixer' },
        engine.ROLES.map((role) => {
          const state = project.roles[role.id] || { volume: 1, muted: false };
          return h(
            'div',
            { key: role.id, className: 'cl-mixer-row' },
            h(
              'div',
              { className: 'cl-mixer-label' },
              h(RoleDot, { role: role.id }),
              h('b', null, roleLabel(role.id)),
              h('span', null, t(`role.${role.id}.short`)),
            ),
            h('input', {
              className: 'cl-mixer-slider',
              type: 'range',
              min: 0,
              max: 1,
              step: 0.01,
              value: state.muted ? 0 : state.volume,
              disabled: state.muted,
              style: {
                '--cl-mixer-color': engine.roleColor(role.id),
                '--cl-mixer-fill': `${Math.round(state.volume * 100)}%`,
              },
              onChange: (event) => onUpdate(engine.setRoleVolume(project, role.id, Number(event.target.value))),
              'aria-label': roleLabel(role.id),
            }),
            h(
              'button',
              {
                type: 'button',
                className: `cl-mixer-mute${state.muted ? ' is-muted' : ''}`,
                onClick: () => onUpdate(engine.toggleRoleMute(project, role.id)),
                title: t('audio.mute'),
                'aria-pressed': state.muted ? 'true' : 'false',
              },
              'M',
            ),
            h('span', { className: 'cl-mixer-value' }, state.muted ? t('audio.muted') : Math.round(state.volume * 100) + '%'),
          );
        }),
      ),
    ),

    h(
      Section,
      {
        title: t('audio.musicTitle'),
        subtitle: t('audio.musicBody'),
        right: h(
          'div',
          { className: 'cl-row' },
          h(Btn, { size: 'sm', icon: h(icons.upload, { size: 13 }), onClick: onImport }, t('audio.importMusic')),
          h(Btn, { size: 'sm', icon: h(icons.film, { size: 13 }), onClick: onImportFolder }, t('audio.importFolder')),
        ),
      },
      musicAsset
        ? h(
            'div',
            { className: 'cl-card cl-music-card' },
            h('span', { className: 'cl-music-icon' }, h(icons.music, { size: 16 })),
            h(
              'div',
              { className: 'cl-music-meta' },
              h('b', null, musicAsset.name),
              h('span', null, t('audio.musicPlaying', { duration: formatDuration(musicAsset.duration) })),
            ),
            h(Slider, {
              label: t('audio.musicVolume'),
              value: project.music.volume,
              min: 0,
              max: 1,
              step: 0.01,
              valueLabel: Math.round(project.music.volume * 100) + '%',
              onChange: (value) => onUpdate(engine.setMusicVolume(project, value)),
            }),
            h(
              'div',
              { className: 'cl-row' },
              h(
                Btn,
                {
                  size: 'sm',
                  variant: 'danger',
                  icon: h(icons.trash, { size: 13 }),
                  onClick: () => onUpdate(engine.setMusic(project, null)),
                },
                t('audio.musicRemove'),
              ),
            ),
          )
        : h(
            'div',
            { className: 'cl-card cl-card--quiet' },
            h('p', { className: 'cl-hint' }, t('audio.noMusic')),
            h('p', { className: 'cl-hint' }, t('audio.audioOnly')),
            candidates.length
              ? h(
                  'div',
                  { className: 'cl-asset-mini-list' },
                  candidates.slice(0, 6).map((asset) =>
                    h(
                      'button',
                      { key: asset.id, type: 'button', className: 'cl-asset-mini', onClick: () => setMusic(asset) },
                      h(icons.music, { size: 13 }),
                      h('span', null, asset.name),
                      h('em', null, formatDuration(asset.duration)),
                    ),
                  ),
                )
              : h(
                  'div',
                  { className: 'cl-row cl-row--between' },
                  h('p', { className: 'cl-hint' }, t('audio.importFirst')),
                  h(
                    'div',
                    { className: 'cl-row' },
                    h(
                      Btn,
                      { size: 'sm', variant: 'primary', icon: h(icons.upload, { size: 13 }), onClick: onImport },
                      t('audio.importMusic'),
                    ),
                    h(
                      Btn,
                      { size: 'sm', icon: h(icons.film, { size: 13 }), onClick: onImportFolder },
                      t('audio.importFolder'),
                    ),
                  ),
                ),
          ),
    ),

    h(
      Section,
      { title: t('audio.duckTitle'), subtitle: t('audio.duckBody') },
      h(
        'div',
        { className: 'cl-card' },
        h(Toggle, {
          checked: Boolean(project.ducking && project.ducking.enabled),
          onChange: (enabled) => onUpdate(engine.setDucking(project, enabled)),
          label: t('audio.duckToggle'),
        }),
        h(Slider, {
          label: t('audio.duckLevel'),
          value: project.ducking ? project.ducking.level : 0.22,
          min: 0,
          max: 1,
          step: 0.01,
          valueLabel: Math.round((project.ducking ? project.ducking.level : 0.22) * 100) + '%',
          disabled: !project.ducking || !project.ducking.enabled,
          onChange: (value) => onUpdate(engine.setDucking(project, true, value)),
        }),
        h('p', { className: 'cl-hint' }, t('audio.duckHint')),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Captions panel                                                      */
/* ------------------------------------------------------------------ */

function CaptionsPanel(props) {
  const { project, onUpdate, onToast, onSeek, onOpenPanel } = props;

  const captions = useMemo(
    () => project.captions.slice().sort((a, b) => a.start - b.start),
    [project.captions],
  );

  const applyStyle = (styleId) => {
    onUpdate({
      ...project,
      captions: project.captions.map((caption) => ({ ...caption, styleId })),
    });
  };

  return h(
    'div',
    { className: 'cl-panel' },
    h(PanelHero, { icon: icons.cc, title: t('captions.title'), body: t('captions.body') }),
    h(
      Section,
      {
        title: t('captions.listTitle'),
        subtitle: t('captions.count', { count: captions.length }),
        right: h(Btn, { size: 'sm', variant: 'primary', icon: h(icons.sparkle, { size: 13 }), onClick: () => onOpenPanel('ai') }, t('captions.generate')),
      },
      captions.length === 0
        ? h(
            'div',
            { className: 'cl-empty cl-empty--sm' },
            h(icons.cc, { size: 22 }),
            h('p', null, t('captions.empty')),
            h(Btn, { size: 'sm', onClick: () => onOpenPanel('ai') }, t('captions.emptyAction')),
          )
        : h(
            'div',
            { className: 'cl-caption-list' },
            captions.map((caption, index) =>
              h(
                'div',
                { key: caption.id, className: 'cl-caption-row' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cl-caption-time',
                    title: t('captions.seek'),
                    onClick: () => onSeek(caption.start),
                  },
                  engine.formatClock(caption.start),
                ),
                h('textarea', {
                  className: 'cl-caption-text',
                  rows: 2,
                  value: caption.text,
                  'aria-label': t('captions.edit'),
                  onChange: (event) => {
                    const text = event.target.value;
                    onUpdate(
                      {
                        ...project,
                        captions: project.captions.map((item) =>
                          item.id === caption.id ? { ...item, text } : item,
                        ),
                      },
                      { coalesceKey: `caption:${caption.id}` },
                    );
                  },
                }),
                h(
                  IconBtn,
                  {
                    icon: h(icons.trash, { size: 13 }),
                    label: t('captions.delete'),
                    onClick: () => {
                      onUpdate({
                        ...project,
                        captions: project.captions.filter((item) => item.id !== caption.id),
                      });
                      onToast(t('captions.deleted'), 'info');
                    },
                  },
                ),
                h('span', { className: 'cl-caption-index' }, String(index + 1).padStart(2, '0')),
              ),
            ),
            h(
              'div',
              { className: 'cl-row cl-row--between' },
              h('span', { className: 'cl-muted' }, t('captions.footnote')),
              h(
                Btn,
                {
                  size: 'sm',
                  variant: 'danger',
                  onClick: () => {
                    onUpdate({ ...project, captions: [] });
                    onToast(t('captions.cleared'), 'info');
                  },
                },
                t('captions.clear'),
              ),
            ),
          ),
    ),
    h(
      Section,
      { title: t('captions.styleTitle'), subtitle: t('captions.styleBody') },
      h(Section, null,
        h(
          'div',
          { className: 'cl-style-grid' },
          engine.CAPTION_STYLES.map((style) =>
            h(
              'button',
              {
                key: style.id,
                type: 'button',
                className: `cl-style-card${project.captions[0] && project.captions[0].styleId === style.id ? ' is-active' : ''}`,
                onClick: () => {
                  applyStyle(style.id);
                  onToast(t('captions.styleApplied', { name: style.name }), 'success');
                },
              },
              h(
                'span',
                {
                  className: 'cl-style-sample',
                  style: {
                    color: style.color || '#fff',
                    background: style.bg || 'rgba(0,0,0,.55)',
                    fontWeight: style.weight || 600,
                  },
                },
                style.name,
              ),
              h('span', { className: 'cl-style-caption' }, t('captions.preview')),
            ),
          ),
        ),
      ),
    ),
    h('p', { className: 'cl-footnote' }, t('captions.footnote2')),
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

const DRAWER_META = {
  ai: { title: 'drawer.ai', icon: icons.sparkle },
  look: { title: 'drawer.look', icon: icons.sliders },
  audio: { title: 'drawer.audio', icon: icons.wave },
  captions: { title: 'drawer.captions', icon: icons.cc },
};

function DrawerPanel(props) {
  const { name, onClose, onOpenPanel } = props;
  const meta = DRAWER_META[name] || DRAWER_META.ai;
  const Icon = meta.icon;
  const Body =
    name === 'look' ? LookPanel : name === 'audio' ? AudioPanel : name === 'captions' ? CaptionsPanel : AiPanel;

  return h(
    'aside',
    { className: 'cl-drawer', role: 'complementary', 'aria-label': t(meta.title) },
    h(
      'header',
      { className: 'cl-drawer-head' },
      h('span', { className: 'cl-drawer-title' }, h(Icon, { size: 15 }), t(meta.title)),
      h('div', { className: 'cl-drawer-actions' }, h(IconBtn, { icon: h(icons.close, { size: 15 }), label: t('app.closeDrawer'), onClick: onClose })),
    ),
    h('div', { className: 'cl-drawer-body' }, h(Body, Object.assign({}, props, { onOpenPanel }))),
  );
}

/* ------------------------------------------------------------------ */
/* Export dialog                                                       */
/* ------------------------------------------------------------------ */

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function exportDimensions(preset, project) {
  const aspect = project.width && project.height ? project.width / project.height : 16 / 9;
  if (preset === 'source') {
    return { width: even(project.width || 1920), height: even(project.height || 1080) };
  }
  const shortSide = preset === '720p' ? 720 : preset === '4k' ? 2160 : 1080;
  if (aspect >= 1) return { width: even(shortSide * aspect), height: even(shortSide) };
  return { width: even(shortSide), height: even(shortSide / aspect) };
}

function ExportModal(props) {
  const { open, project, onClose, onToast } = props;
  const [preset, setPreset] = useState('1080p');
  const [fps, setFps] = useState(project.fps || 30);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [includeMusic, setIncludeMusic] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | running | done | error | cancelled
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [support, setSupport] = useState({ supported: true, mime: 'video/webm', extension: 'webm' });
  const cancelRef = useRef(false);
  const resultUrlRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setPhase('idle');
    setProgress(0);
    setResult(null);
    setError(null);
    cancelRef.current = false;
    try {
      if (typeof media.probeExportSupport === 'function') setSupport(media.probeExportSupport());
    } catch (err) {
      setSupport({ supported: false, mime: '', extension: 'webm' });
    }
    return () => {
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  const duration = engine.duration(project);
  const hasMarks = project.inPoint != null && project.outPoint != null && project.outPoint > project.inPoint;
  const range = hasMarks
    ? { start: project.inPoint, end: project.outPoint }
    : { start: 0, end: duration };
  const rangeDuration = Math.max(0.1, range.end - range.start);
  const dims = exportDimensions(preset, project);
  const canExport = duration > 0.05 && support.supported;

  const start = async () => {
    if (!canExport) return;
    const exportProject = Object.assign({}, project, {
      inPoint: hasMarks ? range.start : null,
      outPoint: hasMarks ? range.end : null,
    });
    setPhase('running');
    setProgress(0);
    setError(null);
    cancelRef.current = false;

    try {
      const output = await media.exportProject(
        exportProject,
        {
          width: dims.width,
          height: dims.height,
          fps,
          bitrate: preset === '4k' ? 20_000_000 : preset === '720p' ? 5_000_000 : 10_000_000,
          includeCaptions,
          includeMusic,
        },
        {
          onProgress: (value) => setProgress(clamp(value, 0, 1)),
          onPhase: (label) => {
            if (typeof console !== 'undefined') console.info(`[cutline export] ${label}`);
          },
          isCancelled: () => cancelRef.current,
        },
      );
      if (!output || !output.blob) throw new Error('export returned no blob');
      const url = URL.createObjectURL(output.blob);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = url;
      setResult({
        url,
        blob: output.blob,
        filename: output.filename || `cutline-${Date.now()}.${support.extension}`,
        width: output.width || dims.width,
        height: output.height || dims.height,
        duration: output.duration || rangeDuration,
        mime: output.mime || support.mime,
      });
      setPhase('done');
      setProgress(1);
      onToast(t('export.done'), 'success');
    } catch (err) {
      if (cancelRef.current) {
        setPhase('cancelled');
        onToast(t('export.cancelled'), 'info');
      } else {
        setPhase('error');
        setError(err && err.message ? err.message : String(err));
        if (typeof console !== 'undefined') console.error('cutline export failed', err);
      }
    }
  };

  const requestClose = () => {
    if (phase === 'running') {
      cancelRef.current = true;
      return;
    }
    onClose();
  };

  const downloadResult = () => {
    if (!result) return;
    media.download(result.blob, result.filename);
  };

  return h(
    'div',
    { className: 'cl-modal-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('export.title') },
    h(
      'div',
      { className: 'cl-modal cl-export-modal' },
      h(
        'header',
        { className: 'cl-modal-head' },
        h(
          'div',
          null,
          h('h2', null, t('export.title')),
          h('p', null, t('export.subtitle')),
        ),
        h(IconBtn, { icon: h(icons.close, { size: 15 }), label: t('export.close'), onClick: requestClose }),
      ),

      phase === 'done' && result
        ? h(
            'div',
            { className: 'cl-modal-body' },
            h(
              'div',
              { className: 'cl-export-result' },
              h('span', { className: 'cl-export-result-icon' }, h(icons.check, { size: 22 })),
              h(
                'div',
                null,
                h('h3', null, t('export.ready')),
                h('p', null, `${result.width}×${result.height} · ${formatDuration(result.duration)} · ${formatBytes(result.blob.size)}`),
                h('p', { className: 'cl-muted' }, result.filename),
              ),
            ),
            h(
              'div',
              { className: 'cl-modal-actions' },
              h(
                Btn,
                { variant: 'primary', icon: h(icons.download, { size: 14 }), onClick: downloadResult },
                t('export.download'),
              ),
              h(Btn, { onClick: onClose }, t('export.finish')),
            ),
          )
        : h(
            'div',
            { className: 'cl-modal-body' },
            !support.supported
              ? h(
                  'div',
                  { className: 'cl-alert cl-alert--error' },
                  h(icons.alert, { size: 15 }),
                  h('span', null, t('export.unsupported')),
                )
              : null,

            h(
              'div',
              { className: 'cl-export-grid' },
              h(
                Section,
                { title: t('export.resolution'), className: 'cl-export-section' },
                h(
                  'div',
                  { className: 'cl-segmented cl-segmented--wide' },
                  ['source', '1080p', '720p', '4k'].map((id) =>
                    h(
                      Chip,
                      { key: id, active: preset === id, onClick: () => setPreset(id), title: t(`export.preset.${id}`) },
                      t(`export.preset.${id}`),
                    ),
                  ),
                ),
                h(
                  'p',
                  { className: 'cl-muted' },
                  `${dims.width} × ${dims.height} · ${preset === '4k' ? t('export.heavy') : t('export.standard')}`,
                ),
              ),
              h(
                Section,
                { title: t('export.frameRate'), className: 'cl-export-section' },
                h(
                  'div',
                  { className: 'cl-segmented cl-segmented--wide' },
                  [24, 30, 60].map((value) =>
                    h(Chip, { key: value, active: fps === value, onClick: () => setFps(value) }, `${value} fps`),
                  ),
                ),
                h('p', { className: 'cl-muted' }, t('export.fpsHint')),
              ),
            ),

            h(
              Section,
              { title: t('export.format'), className: 'cl-export-section' },
              h(
                'div',
                { className: 'cl-export-format' },
                h(
                  'b',
                  { className: support.extension === 'mp4' ? 'cl-accent' : 'cl-warn' },
                  support.extension === 'mp4' ? t('export.formatMp4') : t('export.formatWebm'),
                ),
                h(
                  'p',
                  { className: 'cl-muted' },
                  support.extension === 'mp4' ? t('export.formatMp4Hint') : t('export.formatWebmHint'),
                ),
              ),
            ),

            h(
              Section,
              { title: t('export.range'), subtitle: hasMarks ? t('export.rangeMarks', { start: engine.formatClock(range.start), end: engine.formatClock(range.end) }) : t('export.rangeFull') },
              h(
                'div',
                { className: 'cl-range-bar' },
                h('span', {
                  style: {
                    left: `${(range.start / Math.max(duration, 0.001)) * 100}%`,
                    width: `${(rangeDuration / Math.max(duration, 0.001)) * 100}%`,
                  },
                }),
              ),
              h(
                'div',
                { className: 'cl-row cl-row--between' },
                h('span', { className: 'cl-muted' }, t('export.estimated', { duration: formatDuration(rangeDuration) })),
                h(
                  Btn,
                  {
                    size: 'sm',
                    variant: hasMarks ? 'ghost' : 'primary',
                    onClick: () => {
                      if (hasMarks) onToast(t('export.rangeIsMarks'), 'info');
                    },
                  },
                  hasMarks ? t('export.usingMarks') : t('export.wholeTimeline'),
                ),
              ),
            ),

            support.extension !== 'mp4'
              ? h(
                  'div',
                  { className: 'cl-alert' },
                  h(icons.alert, { size: 15 }),
                  h('span', null, t('export.webmWarning')),
                )
              : null,

            h(
              'div',
              { className: 'cl-toggle-row' },
              h(Toggle, {
                checked: includeCaptions,
                onChange: setIncludeCaptions,
                label: t('export.includeCaptions'),
              }),
              h(Toggle, {
                checked: includeMusic,
                onChange: setIncludeMusic,
                label: t('export.includeMusic'),
              }),
            ),

            phase === 'running'
              ? h(
                  'div',
                  { className: 'cl-export-progress' },
                  h('div', { className: 'cl-export-progress-head' }, h('b', null, t('export.rendering')), h('span', null, Math.round(progress * 100) + '%')),
                  h('div', { className: 'cl-progress' }, h('span', { style: { width: `${Math.round(progress * 100)}%` } })),
                  h('p', { className: 'cl-hint' }, t('export.keepForeground')),
                )
              : null,
            phase === 'error'
              ? h(
                  'div',
                  { className: 'cl-alert cl-alert--error' },
                  h(icons.alert, { size: 15 }),
                  h('span', null, t('export.failed', { detail: error || '' })),
                )
              : null,
            phase === 'cancelled'
              ? h('div', { className: 'cl-alert' }, h(icons.info, { size: 15 }), h('span', null, t('export.cancelled')))
              : null,

            h(
              'div',
              { className: 'cl-modal-actions' },
              h('span', { className: 'cl-muted' }, t('export.realtimeHint', { duration: formatDuration(rangeDuration) })),
              h(
                Btn,
                { onClick: requestClose },
                t('export.cancel'),
              ),
              h(
                Btn,
                {
                  variant: 'primary',
                  icon: h(icons.export, { size: 14 }),
                  disabled: !canExport || phase === 'running',
                  onClick: start,
                },
                phase === 'running' ? t('export.renderingShort') : t('export.start'),
              ),
            ),
          ),
      ),
  );
}

/* ------------------------------------------------------------------ */
/* Shortcuts dialog                                                    */
/* ------------------------------------------------------------------ */

const SHORTCUT_GROUPS = [
  {
    title: 'shortcuts.playback',
    rows: [
      ['Space', 'shortcuts.play'],
      ['J / K / L', 'shortcuts.jkl'],
      ['← / →', 'shortcuts.frame'],
      ['I / O', 'shortcuts.marks'],
      ['Z', 'shortcuts.skim'],
    ],
  },
  {
    title: 'shortcuts.edit',
    rows: [
      ['B / ⌘B', 'shortcuts.blade'],
      ['Delete', 'shortcuts.ripple'],
      ['⌘Z / ⇧⌘Z', 'shortcuts.undo'],
      ['N', 'shortcuts.snap'],
      ['P', 'shortcuts.pro'],
    ],
  },
  {
    title: 'shortcuts.view',
    rows: [
      ['+ / −', 'shortcuts.zoom'],
      ['⌥1', 'shortcuts.ai'],
      ['⌥2', 'shortcuts.look'],
      ['⌥3', 'shortcuts.audio'],
      ['⌥4', 'shortcuts.captions'],
    ],
  },
  {
    title: 'shortcuts.file',
    rows: [
      ['⌘I', 'shortcuts.import'],
      ['⌘E', 'shortcuts.export'],
      ['Esc', 'shortcuts.close'],
      ['⌥C', 'shortcuts.entry'],
      ['?', 'shortcuts.help'],
    ],
  },
];

function ShortcutsModal(props) {
  if (!props.open) return null;
  return h(
    'div',
    { className: 'cl-modal-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('shortcuts.title') },
    h(
      'div',
      { className: 'cl-modal cl-shortcuts-modal' },
      h(
        'header',
        { className: 'cl-modal-head' },
        h(
          'div',
          null,
          h('h2', null, t('shortcuts.title')),
          h('p', null, t('shortcuts.subtitle')),
        ),
        h(IconBtn, { icon: h(icons.close, { size: 15 }), label: t('shortcuts.closeDialog'), onClick: props.onClose }),
      ),
      h(
        'div',
        { className: 'cl-shortcuts-grid' },
        SHORTCUT_GROUPS.map((group) =>
          h(
            'section',
            { key: group.title, className: 'cl-shortcuts-group' },
            h('h3', null, t(group.title)),
            group.rows.map(([keys, label]) =>
              h(
                'div',
                { key: label, className: 'cl-shortcut-row' },
                h('span', null, t(label)),
                h('kbd', null, keys),
              ),
            ),
          ),
        ),
      ),
      h('p', { className: 'cl-footnote' }, t('shortcuts.footnote')),
    ),
  );
}

module.exports = {
  DrawerPanel,
  ExportModal,
  ShortcutsModal,
  DRAWER_META,
  LookArt,
  roleLabel,
  presetName,
};
