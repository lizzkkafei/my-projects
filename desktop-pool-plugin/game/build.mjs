// 打包：把 src/main.js 及其依赖（含 three.js）打成一个 IIFE 单文件
// 这样 index.html 双击（file://）就能跑，不需要起服务器。
import { build } from 'esbuild';
import { statSync } from 'node:fs';

const t0 = Date.now();
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'safari15'],
  outfile: 'bundle.js',
  minify: process.argv.includes('--dev') ? false : true,
  sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
});

const kb = (statSync('bundle.js').size / 1024).toFixed(0);
console.log(`\n✔ bundle.js  ${kb} KB  in ${Date.now() - t0}ms`);
