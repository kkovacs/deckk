// Probe suite: per-slide overflow + screenshots, fragment advance,
// structural grouping, print-view geometry, real PDF page count.
// Run from the repo root: bun tests/probe.mjs (outputs to out/).
// Gotchas honored: reach deck via host.docker.internal; navigate once per
// view; Reveal.slide() + settle between screenshots; one op per WS message.
import { mkdirSync, writeFileSync } from 'node:fs';

const DEV = 'http://127.0.0.1:9222';
const BASE = 'http://host.docker.internal:8000';
const fails = [];
const fail = (msg) => { fails.push(msg); console.log('  FAIL ' + msg); };

// Minimal CDP over WebSocket - enough for navigate/eval/screenshot/print.
async function attach() {
  const res = await fetch(`${DEV}/json/new?about:blank`, { method: 'PUT' });
  const t = await res.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((ok) => {
    const i = ++id; pending.set(i, (m) => ok(m.result ?? m));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function evalJs(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result?.value;
}

// -- live view ------------------------------------------------------
mkdirSync('out/png', { recursive: true });
const c = await attach();
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await c.send('Page.navigate', { url: `${BASE}/` });
await sleep(2500);
if (!(await evalJs(c, '!!window.Reveal && Reveal.isReady()'))) { console.log('FAIL reveal not ready'); process.exit(1); }

const n = await evalJs(c, 'Reveal.getSlides().length');
console.log(`slides: ${n}`);
if (n !== 32) fail(`expected 32 slides, got ${n}`);

// structural: top-level sections must be exactly the 6 groups - front
// stack + 4 section stacks + closing thank-you stack (2 vertical slides).
// A stray </section> turns mid-deck slides into orphans (rendering fine,
// wrong navigation) and this is the only check that catches it.
const groups = await evalJs(c, `document.querySelectorAll('.slides > section').length`);
if (groups !== 6) fail(`expected 6 top-level groups, got ${groups}`);

// slide() takes (h,v) coords of top-level/nested sections, NOT flat indices
const coords = await evalJs(c, `[...document.querySelectorAll('.slides > section')].flatMap((sec, h) =>
  sec.classList.contains('stack') ? [...sec.children].map((_, v) => ({ h, v })) : [{ h, v: 0 }])`);
if (coords.length !== n) fail(`coord map ${coords.length} != slides ${n}`);

// -- fragments advance (FIRST - arriving pristine; revisiting a slide
// leaves its fragments revealed, a reveal quirk, not a bug) --------
const fi = await evalJs(c, `Reveal.getSlides().findIndex(s => (s.querySelector('h2')?.textContent || '').includes('Fragments appear'))`);
await evalJs(c, `Reveal.slide(${coords[fi].h}, ${coords[fi].v})`);
await sleep(1500);
const f0 = await evalJs(c, `Reveal.getCurrentSlide().querySelectorAll('.fragment.visible').length`);
await evalJs(c, 'Reveal.next()'); await sleep(700);
await evalJs(c, 'Reveal.next()'); await sleep(700);
const f2 = await evalJs(c, `Reveal.getCurrentSlide().querySelectorAll('.fragment.visible').length`);
if (!(f0 === 0 && f2 === 2)) fail(`fragments: before=${f0} after=${f2} (want 0=>2)`);
else console.log('fragments: 0 => 2 ✓');

for (let i = 0; i < n; i++) {
  await evalJs(c, `Reveal.slide(${coords[i].h}, ${coords[i].v})`);
  await sleep(1100);
  const m = await evalJs(c, `(() => {
    const s = Reveal.getCurrentSlide();
    const h = s.querySelector('h1,h2');
    return {
      head: h ? h.textContent.trim().slice(0, 50) : '(no heading)',
      ow: s.scrollWidth - s.clientWidth, oh: s.scrollHeight - s.clientHeight,
      frags: s.querySelectorAll('.fragment').length
    };
  })()`);
  if (m.ow > 1 || m.oh > 1) fail(`slide ${i} "${m.head}" overflow w:${m.ow} h:${m.oh}`);
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`out/png/slide-${String(i).padStart(2, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('overflow + screenshots: done');

// -- print view -----------------------------------------------------
await c.send('Page.navigate', { url: `${BASE}/?print-pdf#/` });
await sleep(2500);
const p = await evalJs(c, `(() => {
  const pages = [...document.querySelectorAll('.pdf-page > section')];
  const tall = pages.filter(s => s.scrollHeight > 721).length;
  const inlineTop = pages.filter(s => s.style.top && s.style.top !== '0px').length;
  return { pages: pages.length, tall, inlineTop };
})()`);
console.log('print view:', JSON.stringify(p));
if (p.pages !== n) fail(`print pages ${p.pages} != slides ${n}`);
if (p.tall) fail(`${p.tall} print pages overflow 720px`);
if (p.inlineTop) fail(`${p.inlineTop} print pages carry a stamped inline top`);

// -- real PDF -------------------------------------------------------
const pdf = await c.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
const buf = Buffer.from(pdf.data, 'base64');
writeFileSync('out/deck.pdf', buf);
const s = buf.toString('latin1');
const mediaBoxes = (s.match(/\/MediaBox/g) ?? []).length;
console.log(`pdf: ${(buf.length / 1024).toFixed(0)}KB, MediaBox count ${mediaBoxes}`);
if (mediaBoxes !== n) fail(`PDF pages ${mediaBoxes} != slides ${n}`);

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
