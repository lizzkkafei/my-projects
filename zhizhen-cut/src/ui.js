/**
 * Client entry surface for the Cutline workbench: the in-session entry button
 * and the full-frame overlay host. Registered by `entry.js` into the Harness
 * `conversation.input.left` and `shell.overlay` slots.
 */
const { React, h, store, useStore, t, icons } = require('./core');
const { Workbench } = require('./workbench');
const core = require('./core');

/** Compact composer-toolbar entry: clapper icon + 剪辑 + project clip count. */
function EntryButton() {
  const s = useStore();
  const count = s.project.clips.length;
  return h(
    'button',
    {
      type: 'button',
      className: `cl-entry${count ? ' has-project' : ''}`,
      onClick: () => store.openWorkbench(),
      title: t('entry.title'),
      'aria-label': t('entry.label'),
    },
    h('span', { className: 'cl-entry-icon' }, h(icons.clapper, { size: 15 })),
    h('span', { className: 'cl-entry-label' }, t('entry.label')),
    count
      ? h('span', { className: 'cl-entry-badge', title: t('entry.count', { count }) }, String(count))
      : null,
  );
}

/** Full-frame workbench, mounted at the app root but only rendered while open. */
function WorkbenchOverlay() {
  const s = useStore();
  if (!s.open) return null;
  return h(Workbench);
}

module.exports = {
  EntryButton,
  WorkbenchOverlay,
  setTranslator: core.setTranslator,
};
