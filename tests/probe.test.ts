// Probe suite for deckk - SELF-CONTAINED: starts its own webserver (ephemeral
// port, via serve.ts) and its own obscura headless browser (ephemeral port,
// free-port bind + retry on conflicts), so plain `bun test` needs nothing
// else. Obscura must be on $PATH. Outputs screenshots + PDF to out/.
// Structure:
//   - "deck probe": slide count, top-level groups, overflow, fragment
//     advance, print-view geometry, real PDF (writes out/png/, out/deck.pdf)
//   - "element-audit stack": contrast/canvas-bounds/focusability of the
//     template.html element-audit stack (writes out/elements/)
// Raw CDP over WebSocket, zero deps. Gotchas honored: navigate once per view;
// Reveal.slide() takes stack coords, not flat indices; fragments tested first.
import { mkdirSync, rmSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../serve";

// -- expected deck shape - the only place these live (update when sections change)
const SLIDES_TOTAL = 43; // ~32 showcase + 11 element-audit
const GROUPS = 7; // front + 4 sections + thank-you + element-audit
const AUDIT_SLIDES = 11; // slides in the element-audit stack (= GROUPS last)
const timeout = 240_000; // default 5s is not enough for probe + settle + PDF

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// -- raw CDP over WebSocket -----------------------------------------
// Obscura only: its /devtools/browser endpoint + Target.createTarget +
// Target.attachToTarget (flatten) - /json/* is unsupported there.
type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  evalJs: (expression: string) => Promise<any>;
  close: () => void;
};

function session(ws: WebSocket): Cdp {
  let id = 0;
  let sessionId: string | undefined;
  const pending = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise((ok, bad) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const evalJs = async (expression: string) => {
    const r = (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as any;
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  };
  const close = () => ws.close();
  return (async () => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as any);
    return { send, evalJs, close };
  })() as unknown as Cdp;
}

async function attach(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => {
    ws.onopen = ok;
    ws.onerror = () => bad(new Error(`ws: ${wsUrl}`));
  });
  return session(ws);
}

// Fresh tab per probe: every test() picks its own target.
async function tab(cdpUrl: string): Promise<Cdp> {
  const c = await attach(cdpUrl);
  await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  return c;
}

// Navigate once per view (hash changes never fire load) and wait for `until`.
// 10s budget - fail fast instead of letting the probes flail.
async function goto(c: Cdp, url: string, until = "!!window.Reveal && Reveal.isReady()"): Promise<void> {
  await c.send("Page.navigate", { url });
  for (let i = 0; i < 40 && !(await c.evalJs(until)); i++) await sleep(250);
  if (!(await c.evalJs(until))) throw new Error(`page not ready: ${url}`);
}

// PDF paper: obscura does not reliably honor scale/page-break print controls -
// export at the native 16:9 canvas (paper = 1280/96 x 720/96 inches, margins 0).
const printParams = {
  preferCSSPageSize: false,
  printBackground: true,
  paperWidth: (1280 / 96) + 0.01,
  paperHeight: (720 / 96) + 0.01,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
};

// -- suite-owned webserver + obscura browser ------------------------
let server: ReturnType<typeof startServer>;
let base: string; // ephemeral webserver origin
let cdpUrl: string; // ephemeral obscura /devtools/browser
let obscura: { proc: Bun.Subprocess; dir: string; port: number } | undefined;

const teardown = async () => {
  if (server) {
    server.stop(true);
    server = undefined!;
  }
  if (obscura) {
    obscura.proc.kill();
    for (let i = 0; i < 10 && obscura.proc.exitCode === null; i++) await sleep(200);
    if (obscura.proc.exitCode === null) obscura.proc.kill("SIGKILL");
    rmSync(obscura.dir, { recursive: true, force: true });
    obscura = undefined;
  }
};

// First free TCP port (bind :0, read, close). Tiny race - startObscura retries.
function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const p = s.port;
  s.stop(true);
  return p;
}

// Spawn obscura on an ephemeral port; `--ready-file` avoids ws polling.
// Retries on a fresh free port when the :0-bind vs obscura-bind race loses.
async function startObscura(): Promise<{ port: number }> {
  if (!Bun.which("obscura"))
    throw new Error("obscura not found on $PATH - the suite runs its own obscura headless browser (see AGENTS.md)");
  for (let attempt = 1; ; attempt++) {
    const port = freePort();
    const dir = mkdtempSync(join(tmpdir(), "deckk-obscura-"));
    const proc = Bun.spawn(
      ["obscura", "serve", "-p", String(port), "--allow-private-network", "--ready-file", join(dir, "ready"), "--quiet"],
      { stdout: "ignore", stderr: "inherit" },
    );
    for (let i = 0; i < 50 && !existsSync(join(dir, "ready")); i++) {
      if (proc.exitCode !== null) break; // crashed (port conflict, bad flag...)
      await sleep(100);
    }
    if (existsSync(join(dir, "ready"))) {
      obscura = { proc, dir, port };
      return { port };
    }
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
    if (attempt >= 3) throw new Error(`obscura would not start - last tried ephemeral port ${port}`);
  }
}

beforeAll(
  async () => {
    try {
      server = startServer({ port: 0 });
      base = `http://127.0.0.1:${server.port}`;
      const { port } = await startObscura();
      cdpUrl = `ws://127.0.0.1:${port}/devtools/browser`;
    } catch (e) {
      await teardown();
      throw e;
    }
  },
  60_000, // obscura cold start + V8 init
);

afterAll(teardown);

// -- 1. deck probe ---------------------------------------------------
test("deck probe: structure, overflow, fragments, print, PDF", async () => {
  const c = await tab(cdpUrl);
  const fails = [];
  const fail = (msg) => {
    fails.push(msg);
    console.log("  FAIL " + msg);
  };

  mkdirSync("out/png", { recursive: true });
  await goto(c, `${base}/template.html`);

  const n = await c.evalJs("Reveal.getSlides().length");
  console.log(`slides: ${n}`);
  if (n !== SLIDES_TOTAL) fail(`expected ${SLIDES_TOTAL} slides, got ${n}`);

  // structural: top-level sections must be exactly the 7 groups - front
  // stack + 4 section stacks + closing thank-you stack (2 vertical slides)
  // + the element-audit stack. A stray </section> turns mid-deck slides into
  // orphans (rendering fine, wrong navigation) - the only check that catches it.
  const groups = await c.evalJs(`document.querySelectorAll('.slides > section').length`);
  if (groups !== GROUPS) fail(`expected ${GROUPS} top-level groups, got ${groups}`);

  // Build the (h,v) flat-coordinate map; slides() takes stack coords.
  const coords = await c.evalJs(
    `[...document.querySelectorAll('.slides > section')].flatMap((sec, h) =>
    sec.classList.contains('stack') ? [...sec.children].map((_, v) => ({ h, v })) : [{ h, v: 0 }])`,
  );
  if (coords.length !== n) fail(`coord map ${coords.length} != slides ${n}`);

  // -- fragments advance (FIRST - arriving pristine; revisiting a slide
  // leaves its fragments revealed, a reveal quirk, not a bug) --------
  const fi = await c.evalJs(
    `Reveal.getSlides().findIndex(s => (s.querySelector('h2')?.textContent || '').includes('Fragments appear'))`,
  );
  if (fi < 0) throw new Error('"Fragments appear" slide not found');
  await c.evalJs(`Reveal.slide(${coords[fi].h}, ${coords[fi].v})`);
  await sleep(1500);
  const f0 = await c.evalJs(`Reveal.getCurrentSlide().querySelectorAll('.fragment.visible').length`);
  await c.evalJs("Reveal.next()");
  await sleep(700);
  await c.evalJs("Reveal.next()");
  await sleep(700);
  const f2 = await c.evalJs(`Reveal.getCurrentSlide().querySelectorAll('.fragment.visible').length`);
  if (!(f0 === 0 && f2 === 2)) fail(`fragments: before=${f0} after=${f2} (want 0=>2)`);
  else console.log("fragments: 0 => 2 ✓");

  for (let i = 0; i < n; i++) {
    await c.evalJs(`Reveal.slide(${coords[i].h}, ${coords[i].v})`);
    await sleep(1100);
    const m = await c.evalJs(
      `(() => {
      const s = Reveal.getCurrentSlide();
      const h = s.querySelector('h1,h2');
      return {
        head: h ? h.textContent.trim().slice(0, 50) : '(no heading)',
        ow: s.scrollWidth - s.clientWidth, oh: s.scrollHeight - s.clientHeight,
        frags: s.querySelectorAll('.fragment').length
      };
    })()`,
    );
    if (m.ow > 1 || m.oh > 1) fail(`slide ${i} "${m.head}" overflow w:${m.ow} h:${m.oh}`);
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`out/png/slide-${String(i).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
  }
  console.log("overflow + screenshots: done");

  // -- print view (until is a truthy page count so goto() polls the refill)
  await goto(c, `${base}/template.html?print-pdf#/`, `document.querySelectorAll('.pdf-page > section').length`);
  await sleep(500);
  const p = await c.evalJs(
    `(() => {
    const pages = [...document.querySelectorAll('.pdf-page > section')];
    const tall = pages.filter(s => s.scrollHeight > 721).length;
    const inlineTop = pages.filter(s => s.style.top && s.style.top !== '0px').length;
    return { pages: pages.length, tall, inlineTop };
  })()`,
  );
  console.log("print view:", JSON.stringify(p));
  if (p.pages !== SLIDES_TOTAL) fail(`print pages ${p.pages} != slides ${SLIDES_TOTAL}`);
  if (p.tall) fail(`${p.tall} print pages overflow 720px`);
  if (p.inlineTop) fail(`${p.inlineTop} print pages carry a stamped inline top`);

  // -- real PDF (native 16:9 paper - printParams above) ---
  const pdf = await c.send("Page.printToPDF", printParams);
  const buf = Buffer.from(pdf.data, "base64");
  writeFileSync("out/deck.pdf", buf);
  const mediaBoxes = buf.toString("latin1").match(/\/MediaBox/g)?.length ?? 0;
  console.log(`pdf: ${(buf.length / 1024).toFixed(0)}KB, MediaBox count ${mediaBoxes}`);
  if (mediaBoxes !== SLIDES_TOTAL) fail(`PDF pages ${mediaBoxes} != slides ${SLIDES_TOTAL}`);

  c.close();
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL PASS");
  expect(fails).toEqual([]);
}, timeout);

// -- 2. element-audit stack -----------------------------------------
test("element-audit stack: contrast, bounds, focus, PDF", async () => {
  const c = await tab(cdpUrl);
  const failures = [];
  const report = [];
  mkdirSync("out/elements", { recursive: true });
  await goto(c, `${base}/template.html`);

  // The audit stack is the LAST top-level group; slide() takes stack coords.
  const auditH = await c.evalJs(`document.querySelectorAll('.slides > section').length - 1`);
  const count = await c.evalJs(`document.querySelectorAll('.slides > section')[${auditH}].children.length`);
  console.log(`HTML audit: ${count} slides in stack #${auditH}`);
  if (count !== AUDIT_SLIDES) failures.push(`audit stack has ${count} slides, expected ${AUDIT_SLIDES}`);

  for (let i = 0; i < count; i++) {
    await c.evalJs(`Reveal.slide(${auditH}, ${i})`);
    await sleep(1000);
    const result = await c.evalJs(`(() => {
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
    for (const item of result.lowContrast) failures.push(`slide ${i}: ${item.tag}.${item.cls} "${item.text}" contrast ${item.ratio}:1`);
    for (const item of result.bounds) failures.push(`slide ${i}: ${item.tag}.${item.cls} outside canvas ${JSON.stringify(item)}`);
    if (result.overflow.some(Boolean)) failures.push(`slide ${i}: overflow ${result.overflow}`);
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`out/elements/slide-${String(i).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
    console.log(
      `  ${String(i).padStart(2, "0")} ${result.heading}: ${result.lowContrast.length} contrast, ${result.bounds.length} bounds, overflow ${result.overflow}`,
    );
  }

  // Focus: the element must be focusable, and the stylesheet must carry the
  // visible :focus-visible ring - simulating keyboard focus is not possible
  // under obscura (Input.dispatchKeyEvent is swallowed, script focus never
  // matches :focus-visible, and getComputedStyle shorthands return "").
  // Find the input by id, don't hardcode its position within the stack.
  const focusV = await c.evalJs(
    `[...document.querySelectorAll('.slides > section')[${auditH}].children].findIndex(s => s.querySelector('#audit-name'))`,
  );
  await c.evalJs(`Reveal.slide(${auditH}, ${focusV})`);
  await sleep(1000);
  const focus = await c.evalJs(`(() => {
  const el = document.querySelector('#audit-name');
  el.focus();
  const focusable = document.activeElement === el;
  const ring = [...document.styleSheets]
    .flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    // This build serializes rule styles as shorthand only (outlineStyle /
    // outlineWidth longhands read "") - no escapes here: template literals
    // collapse \\d to d, silently.
    .some(r => r.selectorText?.includes(':focus-visible') && /px solid/.test(r.style.outline));
  return { focusable, ring };
})()`);
  report.push({ focus });
  if (!focus.focusable) failures.push("form input is not focusable (reveal refill broke it?)");
  if (!focus.ring) failures.push("stylesheet has no visible :focus-visible ring on form controls");
  const focusShot = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("out/elements/focus.png", Buffer.from(focusShot.data, "base64"));

  // The audit slides must survive reveal's print DOM refill as well: total
  // page count is the deck's (this deck IS the page set now); geometry is
  // asserted for the audit's share of the pages.
  await goto(c, `${base}/template.html?print-pdf#/`, `document.querySelectorAll('.pdf-page > section').length === ${SLIDES_TOTAL}`);
  await sleep(500);
  const print = await c.evalJs(`(() => {
  const pages = [...document.querySelectorAll('.pdf-page > section')];
  const audit = pages.slice(-${AUDIT_SLIDES});
  return {
    pages: pages.length,
    tall: audit.filter(s => s.scrollHeight > 721).length,
    inlineTop: audit.filter(s => s.style.top && s.style.top !== '0px').length
  };
})()`);
  if (print.pages !== SLIDES_TOTAL) failures.push(`print pages ${print.pages} != ${SLIDES_TOTAL}`);
  if (print.tall) failures.push(`${print.tall} audit print pages overflow`);
  if (print.inlineTop) failures.push(`${print.inlineTop} audit print pages have inline tops`);
  const pdf = await c.send("Page.printToPDF", printParams);
  const pdfBuffer = Buffer.from(pdf.data, "base64");
  writeFileSync("out/elements/deck.pdf", pdfBuffer);
  const pdfPages = pdfBuffer.toString("latin1").match(/\/MediaBox/g)?.length ?? 0;
  if (pdfPages !== SLIDES_TOTAL) failures.push(`PDF pages ${pdfPages} != ${SLIDES_TOTAL}`);
  report.push({ print, pdfPages });
  console.log("focus:", JSON.stringify(focus));
  console.log("print:", JSON.stringify(print), "PDF pages:", pdfPages);
  writeFileSync("out/elements/report.json", JSON.stringify(report, null, 2));
  c.close();
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S)\n` + failures.map((x) => `FAIL ${x}`).join("\n"));
  }
  expect(failures).toEqual([]);
}, timeout);
