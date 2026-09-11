// Viewport screenshots from the ?print-pdf view: bun tests/shot.mjs 9 10
// (arguments = flattened print-page indices, 0-based). scrollIntoView + settle,
// then a plain full-viewport capture — clip math is unreliable here.
import { writeFileSync } from 'node:fs';

const DEV = 'http://127.0.0.1:9222';
const BASE = 'http://host.docker.internal:8000';

const res = await fetch(`${DEV}/json/new?about:blank`, { method: 'PUT' });
const t = await res.json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(ok => {
  const i = ++id; pending.set(i, m => ok(m.result ?? m));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?print-pdf#/` });
await sleep(2500);

for (const idx of process.argv.slice(2)) {
  const kind = (await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const s = document.querySelectorAll('.pdf-page > section')[${idx}];
      s.scrollIntoView();
      return (s.querySelector('.quote') ? 'quote' : '') || (s.querySelector('.statement') ? 'statement' : '') || 'page' + ${idx};
    })()`,
  })).result.value;
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`out/print-${String(idx).padStart(2, '0')}-${kind}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`captured page ${idx} → out/print-${String(idx).padStart(2, '0')}-${kind}.png`);
}
ws.close();
