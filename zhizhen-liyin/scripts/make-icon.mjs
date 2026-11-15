#!/usr/bin/env node
/**
 * Render icon.svg into a 180x180 PNG (360px @2x) for the plugin marketplace card.
 * Inlines the SVG as a data URL so gradient ids resolve inside the same document.
 * Usage: node scripts/make-icon.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const svg = fs.readFileSync('icon.svg', 'utf8').trim();
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 2 });
await page.setContent(
  `<html><body style="margin:0;background:transparent">
   <img src="${dataUrl}" width="180" height="180" alt="">
   </body></html>`
);
await page.waitForFunction(() => {
  const img = document.querySelector('img');
  return img && img.complete && img.naturalWidth > 0;
}, null, { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: 'docs/icon-180.png', omitBackground: true });
await browser.close();
console.log('docs/icon-180.png', fs.statSync('docs/icon-180.png').size, 'bytes');
