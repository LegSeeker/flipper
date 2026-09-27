// Renders public/favicon.svg into the PNG icons the PWA manifest needs.
// Usage: npm run icons   (uses the Playwright Chromium already installed for e2e tests)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;

const targets = [
  { name: 'pwa-192.png', size: 192, pad: 0, bg: 'transparent' },
  { name: 'pwa-512.png', size: 512, pad: 0, bg: 'transparent' },
  // Maskable icons need the artwork inside the central safe zone.
  { name: 'pwa-maskable-512.png', size: 512, pad: 0.12, bg: '#5b4cf0' },
  { name: 'apple-touch-icon.png', size: 180, pad: 0.06, bg: '#0b0d12' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;display:grid;place-items:center;width:${t.size}px;height:${t.size}px;background:${t.bg}">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: out(t.name), omitBackground: t.bg === 'transparent' });
  console.log('wrote', t.name);
}
await browser.close();
