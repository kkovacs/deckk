#!/usr/bin/env bun
// Slide outline of a deck, read straight from the HTML (no browser):
//
//   bun tools/slides.ts [file.html]        default index.html
//
// One row per slide: the URL hash that reaches it, the source line, the section id
// (give slides ids and use `#/id` - numbers shift whenever a slide is inserted), and
// the heading. Hashes are exactly what reveal uses: `#/N` is 0-BASED (reveal's default),
// stacks are `#/h/v`, ids are `#/id`. Feed the hash to `bun tools/shot.ts`.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "index.html";
const html = readFileSync(file, "utf8");
// blank out comments (the cheat-sheet mentions "<section>" in prose) but keep line numbers
const src = html.slice(0, html.search(/<script\b/) >>> 0 || undefined).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
const lineOf = (pos: number) => src.slice(0, pos).split("\n").length;
const strip = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&mdash;/g, "-").replace(/&middot;/g, ".").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

type Sec = { pos: number; open: number; attrs: string; kids: number; end: number; parent?: Sec };
const warn = (msg: string) => console.error("WARN " + msg);
const secs: Sec[] = [];
const stack: Sec[] = [];
for (const m of src.matchAll(/<(\/?)section\b([^>]*)>/g)) {
  if (m[1]) {
    const s = stack.pop();
    if (s) s.end = m.index!;
    else warn(`unmatched </section> at line ${lineOf(m.index!)} - an earlier stray close tag orphans slides from their stack`);
  } else {
    if (stack.length) stack.at(-1)!.kids++;
    const s: Sec = { pos: m.index!, open: m.index! + m[0].length, attrs: m[2], kids: 0, end: src.length, parent: stack.at(-1) };
    secs.push(s);
    stack.push(s);
  }
}

for (const s of stack) warn(`<section> at line ${lineOf(s.pos)} is never closed`);
// reveal discards a stack's OWN content: between its nested <section>s there must be nothing
for (const st of secs.filter((s) => s.kids)) {
  let at = st.open;
  let own = "";
  for (const k of secs.filter((c) => c.parent === st)) {
    own += src.slice(at, k.pos);
    at = k.end; // a child's own close tag is stripped below
  }
  own = (own + src.slice(at, st.end)).replace(/<\/section\s*>/g, "").trim();
  if (own) warn(`stack at line ${lineOf(st.pos)} has its own content (reveal discards it): ${strip(own).slice(0, 40) || own.slice(0, 40)}`);
}

const tops = secs.filter((s) => !secs.some((t) => t !== s && t.pos < s.pos && t.end >= s.end));
let n = 0;
console.log("hash".padEnd(8), "line".padEnd(5), "id".padEnd(16), "heading");
tops.forEach((top, h) => {
  const slides = top.kids ? secs.filter((s) => s !== top && s.pos > top.pos && s.end <= top.end && !s.kids) : [top];
  slides.forEach((s, v) => {
    const id = /\b(?:id|data-id)="([^"]*)"/.exec(s.attrs)?.[1] ?? "";
    const body = src.slice(s.pos, s.end);
    const head = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(body)?.[1];
    const kicker = /<p class="kicker">([\s\S]*?)<\/p>/.exec(body)?.[1];
    const type = /class="(statement|quote)"/.exec(body)?.[1];
    const label = head ? strip(head) : type ? `(${type}) ${strip(/class="(?:statement|quote)"[^>]*>([\s\S]*?)<\/div>/.exec(body)?.[1] ?? "")}` : kicker ? strip(kicker) : "(no heading)";
    const hash = id ? `#/${id}` : top.kids && v ? `#/${h}/${v}` : `#/${h}`;
    console.log(hash.padEnd(8), String(lineOf(s.pos)).padEnd(5), id.padEnd(16), label.slice(0, 70));
    n++;
  });
});
console.log(`${n} slides`);
