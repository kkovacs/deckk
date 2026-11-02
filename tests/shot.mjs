// Viewport screenshots from the ?print-pdf view: bun tests/shot.mjs 9 10
// (arguments = flattened print-page indices, 0-based). Requires the webserver
// + obscura (`obscura serve --allow-private-network`). scrollIntoView +
// settle, then a plain full-viewport capture - clip math is unreliable here.
import { writeFileSync } from 'node:fs';
import { attach, goto, sleep, BASE } from './lib';

if (!process.argv.slice(2).length) throw new Error('usage: bun tests/shot.mjs <flat-print-page-index>...');
const c = await attach();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// Wait for the refill (PDF pages) AND for reveal to finish stamping
await goto(c, `${BASE}/template.html?print-pdf#/`, `window.Reveal?.isReady() && document.querySelectorAll('.pdf-page > section').length`);
await sleep(2500);

for (const idx of process.argv.slice(2)) {
  const kind = await c.evalJs(
    `(() => {
      const s = document.querySelectorAll('.pdf-page > section')[${idx}];
      if (!s) return '';
      s.scrollIntoView();
      return (s.querySelector('.quote') ? 'quote' : '') || (s.querySelector('.statement') ? 'statement' : '') || 'page' + ${idx};
    })()`,
  );
  if (!kind) throw new Error(`print page ${idx} not found`);
  await sleep(500);
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`out/print-${String(idx).padStart(2, '0')}-${kind}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`captured page ${idx} => out/print-${String(idx).padStart(2, '0')}-${kind}.png`);
}
c.close();
