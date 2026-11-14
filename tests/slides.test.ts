// tools/slides.ts is a CLI that runs on import: spawn it on tiny fixture decks (no browser, fast).
// Never points at index.html - that is a presentation, and the suite only verifies the template.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "deckk-slides-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tool = new URL("../tools/slides.ts", import.meta.url).pathname;
let n = 0;
async function run(html: string) {
  const file = join(dir, `deck${n++}.html`);
  writeFileSync(file, html);
  const p = Bun.spawn(["bun", tool, file], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const rows = out
    .split("\n")
    .filter((l) => l.startsWith("#/"))
    .map((l) => {
      const [hash, line, ...rest] = l.trim().split(/\s+/);
      return { hash, line: Number(line), rest: rest.join(" ") };
    });
  return { rows, out, warns: err.split("\n").filter((l) => l.startsWith("WARN")), count: /(\d+) slides/.exec(out)?.[1] };
}

test("flat deck: 0-based hashes, count, heading labels", async () => {
  const r = await run(`<section><h1>One</h1></section>\n<section><h2>Two</h2></section>\n`);
  expect(r.rows.map((x) => x.hash)).toEqual(["#/0", "#/1"]);
  expect(r.rows.map((x) => x.line)).toEqual([1, 2]);
  expect(r.rows.map((x) => x.rest)).toEqual(["One", "Two"]);
  expect(r.count).toBe("2");
  expect(r.warns).toEqual([]);
});

test("stack: nested slides get #/h/v, v resets per stack", async () => {
  const r = await run(
    `<section><section><h2>a</h2></section><section><h2>b</h2></section></section>\n` +
      `<section><section><h2>c</h2></section><section><h2>d</h2></section></section>\n`,
  );
  expect(r.rows.map((x) => x.hash)).toEqual(["#/0", "#/0/1", "#/1", "#/1/1"]);
  expect(r.rows.map((x) => x.rest)).toEqual(["a", "b", "c", "d"]);
  expect(r.warns).toEqual([]);
});

test("id and data-id override the hash", async () => {
  const r = await run(`<section id="intro"><h2>A</h2></section>\n<section data-id="end"><h2>B</h2></section>\n`);
  expect(r.rows.map((x) => x.hash)).toEqual(["#/intro", "#/end"]);
});

test("labels fall back to kicker, then (statement)/(quote)", async () => {
  const r = await run(
    `<section><p class="kicker">Eyebrow</p></section>\n` +
      `<section><div class="statement">Big line</div></section>\n` +
      `<section><div class="quote">Wise words</div></section>\n` +
      `<section><p>nothing</p></section>\n`,
  );
  expect(r.rows.map((x) => x.rest)).toEqual(["Eyebrow", "(statement) Big line", "(quote) Wise words", "(no heading)"]);
});

test("a <section> inside an HTML comment is ignored; line numbers survive", async () => {
  const r = await run(`<!-- cheat-sheet: write <section> ... </section>\n  more prose -->\n<section><h2>Real</h2></section>\n`);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].line).toBe(3);
  expect(r.warns).toEqual([]);
});

test("warns on an unmatched </section>", async () => {
  const r = await run(`<section><section><h2>a</h2></section></section></section>\n`);
  expect(r.warns.some((w) => w.includes("unmatched </section>") && w.includes("line 1"))).toBe(true);
});

test("warns on an unclosed <section>", async () => {
  const r = await run(`<section><h2>a</h2>\n`);
  expect(r.warns.some((w) => w.includes("never closed") && w.includes("line 1"))).toBe(true);
});

test("warns when a stack has its own content", async () => {
  const r = await run(`<section><p>oops</p><section><h2>a</h2></section></section>\n`);
  expect(r.warns.some((w) => w.includes("own content") && w.includes("oops"))).toBe(true);
});

test("a clean stack (whitespace and comments between children) warns nothing", async () => {
  const r = await run(`<section>\n  <!-- front matter -->\n  <section><h2>a</h2></section>\n  <section><h2>b</h2></section>\n</section>\n`);
  expect(r.warns).toEqual([]);
  expect(r.count).toBe("2");
});

test("template.html is clean (no warnings, has slides)", async () => {
  const p = Bun.spawn(["bun", tool, new URL("../template.html", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  expect(err).not.toContain("WARN");
  expect(Number(/(\d+) slides/.exec(out)?.[1])).toBeGreaterThan(0);
});
