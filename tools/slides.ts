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

type Sec = { pos: number; attrs: string; kids: number; end: number };
const secs: Sec[] = [];
const stack: Sec[] = [];
for (const m of src.matchAll(/<(\/?)section\b([^>]*)>/g)) {
  if (m[1]) {
    const s = stack.pop();
    if (s) s.end = m.index!;
  } else {
    if (stack.length) stack.at(-1)!.kids++;
    const s = { pos: m.index!, attrs: m[2], kids: 0, end: src.length };
    secs.push(s);
    stack.push(s);
  }
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
