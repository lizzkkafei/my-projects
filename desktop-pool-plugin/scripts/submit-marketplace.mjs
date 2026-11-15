#!/usr/bin/env node
/**
 * 向 awesome-dsh-plugin 提交上架 PR。
 *
 * 用法（token 只从环境变量或文件读，不要写进命令历史）：
 *   GITHUB_TOKEN=ghp_xxx node scripts/submit-marketplace.mjs
 *   # 或
 *   echo 'ghp_xxx' > /tmp/gh_token && node scripts/submit-marketplace.mjs
 *
 * token 需要能：fork 公共仓库、在 fork 上写文件、向上游仓库开 PR。
 * 细粒度 token 勾 Contents:Read/Write + Pull requests:Read/Write（对 awesome-dsh-plugin）。
 */
import fs from 'node:fs';

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin';
const ENTRY_LABEL = 'lizzkkafei/my-projects#desktop-pool-plugin';
const ANCHOR = 'lizzkkafei/my-projects#zhizhen-cardgame'; // 插在它前面（同仓库，按名排序）
const ENTRY = `- [${ENTRY_LABEL}](https://github.com/lizzkkafei/my-projects/tree/main/desktop-pool-plugin) - A 3D eight-ball pool table opened from a DSH session: a 9ft tournament bed with three-stage friction physics (slide, roll, spin) so draw, follow and side spin are computed rather than scripted, WPA rules against an AI opponent, and fully procedural art and Web Audio sound with no external assets.`;

function readToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv.trim();
  for (const file of ['/tmp/gh_token', `${process.env.HOME}/.gh_token`]) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  }
  throw new Error('no token: set GITHUB_TOKEN or write it to /tmp/gh_token');
}

const TOKEN = readToken();

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zhizhen-pool-submit',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${body?.message || text.slice(0, 200)}`);
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const me = await api('/user');
const login = me.login;
console.log(`authenticated as ${login}`);

// 1. upstream default branch
const upstream = await api(`/repos/${UPSTREAM}`);
const base = upstream.default_branch;
console.log(`upstream ${UPSTREAM} default branch: ${base}`);

// 2. read the list, build the new content
const file = await api(`/repos/${UPSTREAM}/contents/README.md?ref=${base}`);
const oldText = Buffer.from(file.content, 'base64').toString('utf8');

if (oldText.includes(ENTRY_LABEL)) {
  console.log('entry already present — nothing to do');
  process.exit(0);
}
const anchorLine = oldText.split('\n').find((line) => line.includes(ANCHOR));
if (!anchorLine) throw new Error(`anchor entry not found: ${ANCHOR}`);

const newText = oldText.replace(anchorLine, `${ENTRY}\n${anchorLine}`);

// 3. fork (idempotent: 422 means it already exists)
try {
  await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: JSON.stringify({ default_branch_only: true }) });
  console.log('fork requested');
} catch (error) {
  if (!/already exists|422/.test(String(error.message))) throw error;
  console.log('fork already exists');
}

// wait for the fork to become readable
let fork = null;
for (let i = 0; i < 30; i++) {
  try {
    fork = await api(`/repos/${login}/${UPSTREAM.split('/')[1]}`);
    if (fork && !fork.parent) { /* still syncing */ }
    if (fork) break;
  } catch { /* not ready */ }
  await sleep(2000);
}
if (!fork) throw new Error('fork did not become available');
console.log(`fork ready: ${fork.full_name}`);

// 4. commit the edit on a branch of the fork
const branch = `add-zhizhen-pool-${Date.now().toString(36)}`;
const forkBase = fork.default_branch || base;
const refInfo = await api(`/repos/${fork.full_name}/git/ref/heads/${forkBase}`);
await api(`/repos/${fork.full_name}/git/refs`, {
  method: 'POST',
  body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: refInfo.object.sha }),
});

// 用 fork 上 README 自己的 sha 提交（fork 可能略晚于上游同步）
const forkReadme = await api(`/repos/${fork.full_name}/contents/README.md?ref=${forkBase}`);
await api(`/repos/${fork.full_name}/contents/README.md`, {
  method: 'PUT',
  body: JSON.stringify({
    message: 'Add zhizhen-pool (3D eight-ball pool table)',
    content: Buffer.from(newText, 'utf8').toString('base64'),
    sha: forkReadme.sha,
    branch,
  }),
});
console.log(`pushed ${branch} to fork`);

// 5. open the PR
const pr = await api(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: 'Add zhizhen-pool — 3D eight-ball pool table opened from a DSH session',
    head: `${login}:${branch}`,
    base,
    body: [
      'Adds **zhizhen-pool** to *Just for Fun*.',
      '',
      'A 3D eight-ball pool table that opens full-screen from a session composer entry (`⌥P`):',
      '',
      '- 9ft tournament bed (2.54 × 1.27 m) with Ø57.15 mm balls and six realistically sized pockets',
      '- Three-stage friction physics (slide → roll → spin): draw, follow and side spin emerge from the model rather than being scripted',
      '- WPA eight-ball rules (break, group assignment, fouls, ball-in-hand, 8-ball win/loss) against an AI that scores target-ball × pocket candidates',
      '- All art and audio generated in code — cloth weave, wood grain, ball number rings, and Web Audio impact sounds; no external assets',
      '- Runs in a shadow root and tears down animation frames, listeners and audio contexts on close',
      '',
      '```sh\n' +
      'dsh plugin --profile <profile> add github:lizzkkafei/my-projects#path:/desktop-pool-plugin\n' +
      '```',
      '',
      'Same repository as the already-listed `zhizhen-cardgame` and `zhizhen-cut`.',
    ].join('\n'),
  }),
});
console.log(`PR opened: ${pr.html_url}`);
