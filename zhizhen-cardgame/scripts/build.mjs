#!/usr/bin/env node
/**
 * Build the single-file DSH client bundle `client.js`.
 *
 * The Harness Web client loads exactly one self-contained script per plugin via
 * `window.__ModuleLoader__.load({ id, factory })`. This script:
 *
 *   1. walks the game's ES-module graph (js/*.js + vendored three.js + the six
 *      addons it uses) and rewrites it into a tiny CommonJS-style registry,
 *   2. inlines the stylesheet (fonts as data: URLs, selectors scoped for a
 *      shadow root, so the plugin cannot leak styles into the DSH UI),
 *   3. inlines the body markup from index.html,
 *   4. concatenates the plugin sources from src/, which mount the game into a
 *      shadow root inside a full-frame overlay.
 *
 * Usage: node scripts/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const pkg = JSON.parse(read('package.json'));
const bundleId = pkg.name;

/* ------------------------------------------------------------------ *
 * 1. ES modules -> a CommonJS-style registry
 * ------------------------------------------------------------------ */

/** Resolve one import specifier to a repo-relative module id. */
function resolveSpecifier(spec, fromId) {
  if (spec === 'three') return 'vendor/three.module.js';
  if (spec.startsWith('three/addons/')) return `vendor/jsm/${spec.slice('three/addons/'.length)}`;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec));
  }
  throw new Error(`${fromId}: cannot resolve import "${spec}"`);
}

/** Split `a as b, c` style name lists into { local, exported } pairs. */
function parseNameList(list) {
  return list
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+as\s+/);
      return parts.length > 1
        ? { local: parts[0].trim(), exported: parts[1].trim() }
        : { local: entry, exported: entry };
    });
}

/**
 * Rewrite one ES module into a function body that receives
 * `(module, exports, require)`. Import statements become `require` calls,
 * `export` declarations become plain declarations plus one `Object.assign`.
 * The vendored three.js sources and all game modules stay plain ES2020 code,
 * so this stays a text transform rather than a full parser.
 */
function transformModule(id, source) {
  const deps = [];
  const exported = [];
  let code = source;
  const resolve = (spec) => resolveSpecifier(spec, id);

  // `export * from '...'`
  code = code.replace(/^export\s*\*\s*from\s*['"]([^'"]+)['"];?/gm, (_match, spec) => {
    deps.push(spec);
    return `Object.assign(exports, require(${JSON.stringify(resolve(spec))}));`;
  });

  // `export { a, b as c } from '...'`
  code = code.replace(
    /^export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm,
    (_match, names, spec) => {
      deps.push(spec);
      const pairs = parseNameList(names)
        .map(({ local, exported: out }) => `${JSON.stringify(out)}: __re[${JSON.stringify(local)}]`)
        .join(', ');
      return `(function () { const __re = require(${JSON.stringify(resolve(spec))}); Object.assign(exports, { ${pairs} }); })();`;
    },
  );

  // `import * as NAME from '...'`
  code = code.replace(
    /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?/gm,
    (_match, name, spec) => {
      deps.push(spec);
      return `const ${name} = require(${JSON.stringify(resolve(spec))});`;
    },
  );

  // `import { a, b as c } from '...'`
  code = code.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm,
    (_match, names, spec) => {
      deps.push(spec);
      const bound = parseNameList(names)
        .map(({ local, exported: out }) => (local === out ? local : `${local}: ${out}`))
        .join(', ');
      return `const { ${bound} } = require(${JSON.stringify(resolve(spec))});`;
    },
  );

  // `import '...'` (side effect only)
  code = code.replace(/^import\s+['"]([^'"]+)['"];?/gm, (_match, spec) => {
    deps.push(spec);
    return `require(${JSON.stringify(resolve(spec))});`;
  });

  // `import Default from '...'` — not used today, but fail loudly if it appears.
  if (/^import\s+[A-Za-z_$][\w$]*\s+from\s/m.test(code)) {
    throw new Error(`${id}: default imports are not supported by this build`);
  }

  // `export const/let/var/function/class NAME`
  code = code.replace(
    /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_match, keyword, name) => {
      exported.push({ local: name, exported: name });
      return `${keyword} ${name}`;
    },
  );

  // `export default ...`
  code = code.replace(/^export\s+default\s+/gm, 'exports.default = ');

  // Remaining local `export { a, b as c };`
  code = code.replace(/^export\s*\{([\s\S]*?)\};?/gm, (_match, names) => {
    for (const pair of parseNameList(names)) exported.push(pair);
    return '';
  });

  if (/^export\s/m.test(code)) {
    throw new Error(`${id}: an export statement could not be rewritten`);
  }

  if (exported.length > 0) {
    const pairs = exported.map(({ local, exported: out }) => `${JSON.stringify(out)}: ${local}`).join(', ');
    code += `\nObject.assign(exports, { ${pairs} });\n`;
  }

  return { code, deps };
}

/** Walk imports from the entry module and build the lazily-executed registry. */
function collectModules(entryId) {
  const modules = new Map(); // id -> { code, deps: resolved ids }
  const queue = [entryId];

  while (queue.length > 0) {
    const id = queue.pop();
    if (modules.has(id)) continue;
    if (!exists(id)) throw new Error(`missing module: ${id}`);

    const { code, deps } = transformModule(id, read(id));
    const resolved = [...new Set(deps.map((spec) => resolveSpecifier(spec, id)))];
    modules.set(id, { code, deps: resolved });
    queue.push(...resolved);
  }

  return modules;
}

const ENTRY_ID = 'js/main.js';
const gameModules = collectModules(ENTRY_ID);

const moduleRegistry = [...gameModules.entries()]
  .map(
    ([id, { code }]) => [
      `__def(${JSON.stringify(id)}, function (module, exports, require) {`,
      '"use strict";',
      code,
      '});',
      '',
    ].join('\n'),
  )
  .join('\n');

/* ------------------------------------------------------------------ *
 * 2. Stylesheet: inline fonts, scope document-level selectors
 * ------------------------------------------------------------------ */

const FONT_FILES = {
  '../fonts/fredoka.woff2': 'fonts/fredoka.woff2',
  '../fonts/bungee.woff2': 'fonts/bungee.woff2',
};

function inlineFonts(css) {
  let out = css;
  for (const [url, file] of Object.entries(FONT_FILES)) {
    const bytes = fs.readFileSync(path.join(root, file));
    const dataUrl = `data:font/woff2;base64,${bytes.toString('base64')}`;
    out = out.split(`url('${url}')`).join(`url("${dataUrl}")`);
    out = out.split(`url("${url}")`).join(`url("${dataUrl}")`);
  }
  if (/url\(['"]?\.\.\/fonts\//.test(out)) throw new Error('a font URL was not inlined');
  return out;
}

function scopeCss(css) {
  return css
    .replace(/:root\b/g, ':host')
    .replace(/(^|\})\s*html\s*,\s*body\s*\{/g, '$1\n:host { display: block; width: 100%; height: 100%; }')
    .replace(/(^|\})\s*html\s*\{/g, '$1\n:host { display: block; width: 100%; height: 100%; }')
    .replace(/(^|\})\s*body\s*\{/g, '$1\n:host { display: block; width: 100%; height: 100%; }');
}

const GAME_CSS = scopeCss(inlineFonts(read('css/style.css')));

/* ------------------------------------------------------------------ *
 * 3. Markup: the body of index.html without its classic/module scripts
 * ------------------------------------------------------------------ */

const html = read('index.html');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) throw new Error('index.html: no <body> found');
const GAME_HTML = bodyMatch[1].replace(/<script\b[\s\S]*?<\/script>/gi, '').trim();

/* ------------------------------------------------------------------ *
 * 4. Assemble client.js
 * ------------------------------------------------------------------ */

for (const file of ['src/entry.js']) {
  if (!exists(file)) throw new Error(`missing plugin source: ${file}`);
}

const entrySource = read('src/entry.js');

const parts = [
  `/* ${pkg.name} v${pkg.version} — generated by scripts/build.mjs. Do not edit by hand. */`,
  '/* Bundles three.js (MIT, Copyright 2010-2025 Three.js Authors) and the JESTER\'S TABLE game. */',
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(bundleId)},`,
  '  factory(require) {',
  '    "use strict";',
  '    const React = require("react");',
  '    const h = React.createElement;',
  '',
  `    const GAME_CSS = ${JSON.stringify(GAME_CSS)};`,
  `    const GAME_HTML = ${JSON.stringify(GAME_HTML)};`,
  '',
  '    const __defs = Object.create(null);',
  '    const __cache = Object.create(null);',
  '    function __def(id, factory) { __defs[id] = factory; }',
  '    function __require(id) {',
  '      if (__cache[id]) return __cache[id].exports;',
  '      const factory = __defs[id];',
  '      if (!factory) throw new Error("cardgame bundle: unknown module " + id);',
  '      const module = { exports: {} };',
  '      __cache[id] = module;',
  '      factory(module, module.exports, __require);',
  '      return module.exports;',
  '    }',
  '',
  '    /* ---- bundled game modules: three.js + js/*.js ---- */',
  moduleRegistry,
  '',
  '    /** Execute the game once the shadow root already holds its markup. */',
  '    function __bootCardgame() {',
  `      __require(${JSON.stringify(ENTRY_ID)});`,
  '    }',
  '',
  entrySource,
  '',
  '    return {',
  '      inject,',
  '      apply,',
  '      __debug: { mountCardgame, boot: __bootCardgame, html: GAME_HTML, css: GAME_CSS },',
  '    };',
  '  },',
  '});',
  '',
];

const output = parts.join('\n');
fs.writeFileSync(path.join(root, 'client.js'), output);
execFileSync(process.execPath, ['--check', path.join(root, 'client.js')], { stdio: 'pipe' });

const megabytes = (fs.statSync(path.join(root, 'client.js')).size / 1024 / 1024).toFixed(2);
console.log(
  `client.js written (${megabytes} MB, id ${bundleId}, ${gameModules.size} game modules, ${output.length} chars)`,
);
