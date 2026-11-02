// Visual + semantic regression suite for the element-audit stack: the last
// top-level group of template.html (the former tests/elements.html, merged
// in the refactor). Audits the stack's 11 slides only - the rest of the deck
// is probe.test.ts's turf.
// Requires obscura (`obscura serve --allow-private-network`) + the webserver.
// Writes screenshots + report.json to out/elements/.
import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "bun:test";
import { attach, goto, sleep, printParams, SLIDES_TOTAL, AUDIT_SLIDES, BASE } from "./lib";

const timeout = 240_000; // default 5s is not enough for audit + settle + PDF

test("element-audit stack: contrast, bounds, focus, print, PDF", async () => {
  const failures = [];
  const report = [];
  mkdirSync("out/elements", { recursive: true });
  const c = await attach();
  await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await goto(c, `${BASE}/`);

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
    // This browser serializes rule styles as the shorthand only (outlineStyle
    // / outlineWidth longhands read "") - so check the declared outline.
    // (No escapes here: template literals collapse \d to d, silently.)
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
  await goto(
    c,
    `${BASE}/?print-pdf#/`,
    `document.querySelectorAll('.pdf-page > section').length === ${SLIDES_TOTAL}`,
  );
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
