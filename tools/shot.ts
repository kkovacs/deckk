#!/usr/bin/env bun
// Look at slides: screenshot + layout report, headless, zero setup.
//
//   bun tools/shot.ts [file.html] <slide>... [--at 0,1500,6000] [--frags N] [--out dir]
//
//   file.html  default index.html (a presentation); template.html works too
//   <slide>    exactly what follows `#/` in the deck URL: 3 (flat, 0-BASED - reveal's
//              default), 2/1 (stack h/v), my-id (section id / data-id), or `all`
//              (every slide in one run). `bun tools/slides.ts` lists them.
//   --at       ms after the slide is ready, one screenshot each (default 1200);
//              use several to catch an animation mid-flight (wall-clock frames
//              are the ground truth - obscura's getAnimations/getComputedStyle lie)
//   --frags N  press fragment-next N times first
//   --out      default out/shot/
//
// Self-contained like the test suite: serves the repo on an ephemeral port and runs
// its own obscura. Prints the PNG paths plus per slide: overflow, elements outside
// the 1280x720 canvas, and overlapping text boxes (what the probes cannot see) -
// a report that says "ok" is the cheap answer to "does it fit"; open the PNG for the rest.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { startServer } from "../serve";
import { goto, sleep, startObscura, tab } from "../tests/lib";

const argv = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = argv.indexOf(name);
  return i < 0 ? dflt : (argv.splice(i, 2)[1] ?? dflt);
};
const ats = flag("--at", "1200").split(",").map(Number);
const frags = Number(flag("--frags", "0"));
const out = flag("--out", new URL("../out/shot/", import.meta.url).pathname).replace(/\/?$/, "/");
const file = argv.find((a) => a.endsWith(".html")) ?? "index.html";
const refs = argv.filter((a) => a !== file);
if (!refs.length || ats.some(isNaN)) {
  console.error("usage: bun tools/shot.ts [file.html] <slide>... [--at ms,ms] [--frags N] [--out dir]   (slide = 3 | 2/1 | id | all)");
  process.exit(2);
}

// Runs in the page. Report of the CURRENT slide.
function report() {
  const s = (window as any).Reveal.getCurrentSlide();
  const name = (e: Element) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "");
  const txt = (e: Element) => (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
  const shown = (e: Element) => {
    const cs = getComputedStyle(e);
    return e.getClientRects().length > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const outside = [...s.querySelectorAll(".body > *, h1, h2, footer")]
    .filter(shown)
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.left < -1 || r.right > 1281 || r.top < -1 || r.bottom > 721)
    .map(({ e }) => `${name(e)} "${txt(e)}"`);
  // leaf-ish text boxes: elements owning a text node; skip ancestor/descendant pairs.
  // getClientRects (one rect per line box), not the bounding box: a wrapped inline
  // element's bounding box spans lines and would "overlap" its own siblings.
  const boxes = [...s.querySelectorAll("*")]
    .filter((e) => shown(e) && [...e.childNodes].some((n: any) => n.nodeType === 3 && n.textContent.trim()))
    .map((e) => ({ e, rs: [...e.getClientRects()] }));
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      for (const ra of a.rs)
        for (const rb of b.rs) {
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 2 && h > 2) overlaps.push(`${name(a.e)} "${txt(a.e)}" x ${name(b.e)} "${txt(b.e)}" (${Math.round(w)}x${Math.round(h)}px)`);
        }
    }
  const h = s.querySelector("h1,h2");
  return {
    head: h ? h.textContent.trim().slice(0, 40) : name(s),
    overflow: [s.scrollWidth - s.clientWidth, s.scrollHeight - s.clientHeight],
    outside,
    overlaps: overlaps.slice(0, 8),
  };
}

let issues = 0;
async function shoot(c: Awaited<ReturnType<typeof tab>>, label: string) {
  const t0 = Date.now();
  for (const at of ats) {
    await sleep(Math.max(0, at - (Date.now() - t0)));
    const r = await c.evalJs(`(${report.toString()})()`);
    const png = `${out}${basename(file, ".html")}-${label}${ats.length > 1 ? "-" + at + "ms" : ""}.png`;
    writeFileSync(png, Buffer.from((await c.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    const bad = [
      ...(r.overflow.some((n: number) => n > 1) ? [`overflow w:${r.overflow[0]} h:${r.overflow[1]}`] : []),
      ...r.outside.map((x: string) => `outside canvas: ${x}`),
      ...r.overlaps.map((x: string) => `overlap: ${x}`),
    ];
    issues += bad.length;
    console.log(`#/${label} "${r.head}" -> ${png}${bad.length ? "" : "  ok"}`);
    for (const b of bad) console.log("    " + b);
  }
}

mkdirSync(out, { recursive: true });
const server = startServer({ port: 0 });
const obscura = await startObscura();
try {
  const base = `http://127.0.0.1:${server.port}/${file}`;
  const c = await tab(obscura.cdpUrl);
  // ?t= cache-buster goes BEFORE the hash: a hash-only change would not reload the page
  const load = (hash: string) => goto(c, `${base}?t=${Date.now()}#/${hash}`);
  for (const ref of refs) {
    if (ref === "all") {
      await load("");
      const coords = await c.evalJs(
        `[...document.querySelectorAll('.slides > section')].flatMap((sec, h) =>
          sec.querySelector(':scope > section') ? [...sec.children].map((_, v) => ({ h, v })) : [{ h, v: 0 }])`,
      );
      for (const { h, v } of coords) {
        await c.evalJs(`Reveal.slide(${h}, ${v})`);
        await shoot(c, v ? `${h}-${v}` : `${h}`);
      }
      continue;
    }
    await load(ref);
    await sleep(300); // let reveal finish stamping the landing slide
    for (let i = 0; i < frags; i++) await c.evalJs("Reveal.nextFragment()");
    await shoot(c, ref.replaceAll("/", "-"));
  }
  c.close();
} finally {
  server.stop(true);
  await obscura.stop();
}
console.log(issues ? `${issues} issue(s)` : "all ok");
