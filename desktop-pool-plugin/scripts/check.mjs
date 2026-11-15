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

check(pkg.name === 'zhizhen-pool', `package name is ${pkg.name}`);
check(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.version), 'version must be semver');
check(pkg.type === 'module', 'package must be ESM (type: module)');
check(typeof pkg.description === 'string' && pkg.description.length > 20, 'description is missing or too short');

const bundlePatch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
check(bundlePatch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml');
check(exists('cordis.patch.yml'), 'missing cordis.patch.yml');
check(/id:\s*zhizhen-pool/.test(read('cordis.patch.yml')), 'cordis.patch.yml must insert id zhizhen-pool');

const client = pkg.dsh && pkg.dsh.client;
check(client && client.platform === 'web', 'dsh.client.platform must be web');
check(
  Array.isArray(client && client.inject) && client.inject.includes('@deepseek-ai/dsh-client-locale'),
  'dsh.client.inject must include the locale service',
);
check(pkg.exports, 'package must declare exports');
check(pkg.exports && pkg.exports['./client'] === './client.js', 'exports["./client"] must be ./client.js');
check(pkg.exports && pkg.exports['.'] === './index.js', 'exports["."] must be ./index.js');

check(exists('index.js'), 'missing index.js');
check(exists('client.js'), 'missing client.js (run scripts/build.mjs)');

if (exists('client.js')) {
  const clientSource = read('client.js');
  check(clientSource.includes('__ModuleLoader__.load'), 'client.js must call window.__ModuleLoader__.load');
  check(clientSource.includes(`"${pkg.name}"`), 'client.js bundle id must match the package name');
  check(clientSource.includes('function __bootPool'), 'client.js must wrap the game in __bootPool');
  // The client bundle must not contain the standalone page's module script tag.
  check(!/type="module"/.test(clientSource), 'client.js must not ship a module <script> tag');
  // Guard against an accidental double-wrap from a previous build.
  check((clientSource.match(/function __bootPool\(/g) || []).length === 1, 'client.js defines __bootPool more than once');
}

for (const lang of ['en', 'zh']) {
  const file = `locale/${lang}.json`;
  check(exists(file), `missing ${file}`);
  if (exists(file)) {
    try {
      const dict = JSON.parse(read(file));
      check(dict.meta && dict.meta.title, `${file} must carry meta.title`);
      check(dict.meta && dict.meta.description, `${file} must carry meta.description`);
    } catch (error) {
      failures.push(`${file} is not valid JSON: ${error.message}`);
    }
  }
}

check(exists('icon.svg'), 'missing icon.svg');
if (exists('icon.svg')) {
  const icon = read('icon.svg');
  check(icon.includes('<svg'), 'icon.svg must be an SVG');
  check(/viewBox="0 0 24 24"/.test(icon), 'icon.svg should use a 24x24 viewBox');
}

check(exists('screenshots.json'), 'missing screenshots.json');
if (exists('screenshots.json')) {
  try {
    const shots = JSON.parse(read('screenshots.json'));
    check(Array.isArray(shots) && shots.length > 0, 'screenshots.json must list at least one image');
    for (const shot of shots) check(exists(shot), `screenshots.json points at a missing file: ${shot}`);
  } catch (error) {
    failures.push(`screenshots.json is not valid JSON: ${error.message}`);
  }
}

check(exists('README.md'), 'missing README.md');
check(exists('docs/DETAIL.md'), 'missing docs/DETAIL.md');

if (failures.length > 0) {
  console.error(`✘ ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('✔ plugin package looks good');
