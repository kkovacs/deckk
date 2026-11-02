// Probe suite: per-slide overflow + screenshots, fragment advance,
// structural grouping, print-view geometry, real PDF page count.
// Run from the repo root - `bun test` writes to out/. Requires
// `obscura serve --allow-private-network` + `bun serve.ts`.
// Gotchas honored: navigate once per view; Reveal.slide() takes stack coords,
// not flat indices; fragments tested first, on a fresh load.
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "bun:test";
import { attach, goto, sleep, printParams, SLIDES_TOTAL, GROUPS, BASE } from "./lib";

const timeout = 240_000; // default 5s is not enough for probe + settle + PDF

test("deck probe: structure, overflow, fragments, print, PDF", async () => {
  const fails = [];
  const fail = (msg) => {
    fails.push(msg);
    console.log("  FAIL " + msg);
  };

  mkdirSync("out/png", { recursive: true });
  const c = await attach();
  await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await goto(c, `${BASE}/`);

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

  // -- print view -----------------------------------------------------
  // Until is a truthy page count so goto() polls the refill, not the clock.
  await goto(c, `${BASE}/?print-pdf#/`, `document.querySelectorAll('.pdf-page > section').length`);
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

  // -- real PDF (native 16:9 paper - printParams in lib.ts) ---
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
