// Visual + semantic regression suite for tests/elements.html.
// Requires `bun serve.ts` and headless Chrome (or OBSCURA=1 with `obscura serve --allow-private-network`).
import { mkdirSync, writeFileSync } from "node:fs";

const DEV = process.env.CDP ?? "http://127.0.0.1:9222";
const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const OUT = process.env.OUT ?? "out/elements";
mkdirSync(OUT, { recursive: true });

async function attach() {
  // Obscura implements CDP through explicit browser target sessions (and its
  // /json/new endpoint is intentionally unsupported).
  const ws = new WebSocket(
    process.env.OBSCURA
      ? `${DEV.replace(/^http/, "ws")}/devtools/browser`
      : (await (await fetch(`${DEV}/json/new?about:blank`, { method: "PUT" })).json()).webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  let sessionId;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      ws.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  if (process.env.OBSCURA) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
  }
  return { send, close: () => ws.close() };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const c = await attach();
await c.send("Page.enable");
await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
async function evaluate(expression) {
  const response = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
}
await c.send("Page.navigate", { url: `${BASE}/tests/elements.html` });
for (let attempt = 0; attempt < 40 && !(await evaluate("window.Reveal?.isReady()")); attempt++) await sleep(250);
if (!(await evaluate("window.Reveal?.isReady()")))
  throw new Error(
    "Reveal did not initialize: " +
      JSON.stringify(await evaluate("({url:location.href,title:document.title,text:document.body?.innerText.slice(0,100)})")),
  );

const failures = [];
const report = [];
const slides = await evaluate("Reveal.getSlides().length");
console.log(`HTML audit: ${slides} slides`);
for (let i = 0; i < slides; i++) {
  await evaluate(`Reveal.slide(${i}, 0)`);
  await sleep(1000);
  const result = await evaluate(`(() => {
    const slide = Reveal.getCurrentSlide();
    const rect = slide.getBoundingClientRect();
    const parse = (value) => {
      const nums = value.match(/[\\d.]+/g)?.map(Number) ?? [];
      return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
    };
    const luminance = (rgb) => {
      const linear = rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x,y) => y-x); return (hi+.05)/(lo+.05); };
    const composite = (fg, bg) => fg.slice(0,3).map((v,j) => v*fg[3] + bg[j]*(1-fg[3]));
    const dark = slide.classList.contains('dark');
    const surfaces = dark ? [[36,66,123],[22,41,79]] : [[255,255,255]];
    const text = [...slide.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,caption,address,summary,label,legend,td,th,strong,em,b,i,u,s,small,mark,del,ins,sub,sup,abbr,cite,q,time,data,code,kbd,samp,var,a,span,pre,output,button,input,select,textarea')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .map(el => {
        const style = getComputedStyle(el);
        let bg = style.backgroundColor;
        let node = el;
        while (parse(bg)[3] === 0 && node.parentElement && node.parentElement !== slide) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
        const code = !!el.closest('pre.code');
        const own = parse(bg)[3] ? composite(parse(bg), dark ? [22,41,79] : [255,255,255]) : null;
        const candidates = own ? [own] : code ? (dark ? [[16,26,51]] : [[22,41,79]]) : surfaces;
        const fg = composite(parse(style.color), candidates[0]);
        const minRatio = Math.min(...candidates.map(surface => ratio(fg, surface)));
        return { tag: el.tagName.toLowerCase(), cls: el.className, text: el.textContent.trim().slice(0,55), ratio: +minRatio.toFixed(2), color: style.color, background: bg, backgroundOwner: node.tagName, size: +parseFloat(style.fontSize).toFixed(1) };
      });
    const lowContrast = text.filter(el => el.ratio < 4.5);
    const bounds = [...slide.querySelectorAll('.body > *, section > h2, section > footer')].filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className, left: +(r.left-rect.left).toFixed(1), right: +(r.right-rect.left).toFixed(1), top: +(r.top-rect.top).toFixed(1), bottom: +(r.bottom-rect.top).toFixed(1) };
    }).filter(r => r.left < -1 || r.right > 1281 || r.top < -1 || r.bottom > 721);
    return { heading: slide.querySelector('h1,h2')?.textContent.trim() ?? slide.className, overflow: [slide.scrollWidth-slide.clientWidth, slide.scrollHeight-slide.clientHeight], lowContrast, bounds, text };
  })()`);
  report.push({ slide: i, ...result });
  for (const item of result.lowContrast) failures.push(`slide ${i}: ${item.tag}.${item.cls} “${item.text}” contrast ${item.ratio}:1`);
  for (const item of result.bounds) failures.push(`slide ${i}: ${item.tag}.${item.cls} outside canvas ${JSON.stringify(item)}`);
  if (result.overflow.some(Boolean)) failures.push(`slide ${i}: overflow ${result.overflow}`);
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/slide-${String(i).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
  console.log(
    `  ${String(i).padStart(2, "0")} ${result.heading}: ${result.lowContrast.length} contrast, ${result.bounds.length} bounds, overflow ${result.overflow}`,
  );
}

// Keyboard focus must be visible, not clipped or removed.
await evaluate("Reveal.slide(8, 0)");
await sleep(1000);
await evaluate("document.querySelector('#audit-name').focus()");
const focus = await evaluate(
  `(() => { const s=getComputedStyle(document.activeElement); return { outline:s.outline, boxShadow:s.boxShadow }; })()`,
);
report.push({ focus });
if (focus.outline.includes("none") && focus.boxShadow === "none") failures.push("form input has no visible focus indicator");
const focusShot = await c.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/focus.png`, Buffer.from(focusShot.data, "base64"));

// The semantic additions must survive reveal's print DOM refill as well.
await c.send("Page.navigate", { url: `${BASE}/tests/elements.html?print-pdf` });
for (let attempt = 0; attempt < 40 && !(await evaluate("document.querySelectorAll('.pdf-page > section').length")); attempt++)
  await sleep(250);
const print = await evaluate(`(() => {
  const pages = [...document.querySelectorAll('.pdf-page > section')];
  return { pages: pages.length, tall: pages.filter(s => s.scrollHeight > 721).length, inlineTop: pages.filter(s => s.style.top && s.style.top !== '0px').length };
})()`);
if (print.pages !== slides) failures.push(`print pages ${print.pages} != ${slides}`);
if (print.tall) failures.push(`${print.tall} print pages overflow`);
if (print.inlineTop) failures.push(`${print.inlineTop} print pages have inline tops`);
// Chrome exports A4 landscape. Obscura verifies the native 16:9 canvas;
// its CDP implementation does not reliably honor scale/page-break controls.
const pdf = await c.send(
  "Page.printToPDF",
  process.env.OBSCURA
    ? {
        preferCSSPageSize: false,
        printBackground: true,
        paperWidth: 1280 / 96 + 0.01,
        paperHeight: 720 / 96 + 0.01,
        marginTop: 0,
        marginRight: 0,
        marginBottom: 0,
        marginLeft: 0,
      }
    : {
        preferCSSPageSize: false,
        printBackground: true,
        paperWidth: 297 / 25.4,
        paperHeight: 210 / 25.4,
        marginTop: 10 / 25.4,
        marginRight: 0,
        marginBottom: 10 / 25.4,
        marginLeft: 0,
        scale: 0.875,
      },
);
const pdfBuffer = Buffer.from(pdf.data, "base64");
writeFileSync(`${OUT}/deck.pdf`, pdfBuffer);
const pdfPages = (pdfBuffer.toString("latin1").match(/\/MediaBox/g) ?? []).length;
if (pdfPages !== slides) failures.push(`PDF pages ${pdfPages} != ${slides}`);
report.push({ print, pdfPages });
console.log("focus:", focus.outline || focus.boxShadow);
console.log("print:", JSON.stringify(print), "PDF pages:", pdfPages);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
c.close();
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S)\n` + failures.map((x) => `FAIL ${x}`).join("\n"));
  process.exit(1);
}
console.log("\nHTML ELEMENT AUDIT PASS");
