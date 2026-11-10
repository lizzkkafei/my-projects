#!/usr/bin/env node
/**
 * Dependency-free sanity check for the packaged plugin.
 *
 * Verifies the files the DSH plugin manager and the marketplace CI look at
 * (`dsh.bundle` manifest, cordis patch, client bundle shape, locale, icon),
 * plus that `client.js` was built from the current sources.
 *
 * Usage: node scripts/check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const pkg = JSON.parse(read('package.json'));

check(pkg.name === 'zhizhen-cardgame', `package name is ${pkg.name}`);
check(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.version), 'version must be semver');
check(pkg.type === 'module', 'package must be ESM (type: module)');

const bundlePatch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
check(bundlePatch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml');
check(exists('cordis.patch.yml'), 'missing cordis.patch.yml');
check(/id:\s*zhizhen-cardgame/.test(read('cordis.patch.yml')), 'cordis.patch.yml must insert id zhizhen-cardgame');

const client = pkg.dsh && pkg.dsh.client;
check(client && client.platform === 'web', 'dsh.client.platform must be web');
check(Array.isArray(client && client.inject) && client.inject.includes('@deepseek-ai/dsh-client-locale'), 'dsh.client.inject must include the locale service');
check(pkg.exports, 'package must declare exports');
check(pkg.exports && pkg.exports['./client'] === './client.js', 'exports["./client"] must be ./client.js');

for (const file of ['index.js', 'client.js', 'icon.svg', 'README.md', 'screenshots.json', 'locale/zh.json', 'locale/en.json']) {
  check(exists(file), `missing ${file}`);
}

const bundle = read('client.js');
check(bundle.includes('window.__ModuleLoader__.load({'), 'client.js must register through __ModuleLoader__');
check(bundle.includes('id: "zhizhen-cardgame"'), 'client.js must use the package name as bundle id');
check(bundle.includes("const inject = ['slots', 'locale'];"), 'client.js must require the slots and locale services');
check(bundle.includes('conversation.input.left'), 'client.js must register the composer entry');
check(bundle.includes("name: 'shell.overlay'"), 'client.js must register the full-frame overlay');
check(bundle.includes('attachShadow'), 'client.js must mount the game into a shadow root');
check(bundle.includes('requestAnimationFrame'), 'client.js must bundle the game renderer');

const builtAt = fs.statSync(path.join(root, 'client.js')).mtimeMs;
for (const source of ['src/entry.js', 'js/main.js', 'css/style.css', 'index.html']) {
  check(fs.statSync(path.join(root, source)).mtimeMs <= builtAt + 1000, `${source} is newer than client.js — run node scripts/build.mjs`);
}

if (failures.length > 0) {
  console.error('zhizhen-cardgame: check failed');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('zhizhen-cardgame: manifest, bundle shape and build freshness OK');
