# deckk

Zero-dependency reveal.js deck _template_, primarily for my personal use.

**See demo at:** <https://kkovacs.github.io/deckk/>

It is a kind of **construction kit**, that defines **components** that I can combine in **full-width** or **2-column** configurations. That's how I like to work.

Fixed 1280×720 canvas, no build step, no package.json, zero custom JS, fully stock [reveal.js](https://revealjs.com/) + the official notes plugin only.

I wanted to be able to tell [Zulu Six](https://github.com/kkovacs/kkrc/blob/master/inject-ai-kk.md) to bootstrap presentations in my style, that I can fine-tune manually (= it has a good structure).

- **Serve**: Static webserver (`python3 -m http.server 8000`) or `bun run serve.ts` (serves `template.html` at `/`)
- **Present**: Usual reveal.js controls: arrows / hash URLs (`#/<section>/<slide>`); `class="fragment"` on any element makes it appear on click; **S** opens the speaker-notes view (`<aside class="notes">` in any slide)
- **Print/PDF**: Add `?print-pdf` to the URL and print to PDF (A4 landscape, one proportional 16:9 slide per page, all fragments shown, clickable source URLs)
- **Human's** instructions: read the cheat-sheet at the top of `template.html`.
- **AI's** instructions, architecture, design rationale, and landmines: [AGENTS.md](AGENTS.md)
- **Verify**: `bun test` (setup + gotchas: `AGENTS.md`). Start `obscura serve --allow-private-network` (CDP browser, `ws://127.0.0.1:9222/devtools/browser`) plus the webserver, then run `bun test`.
- **HTML element audit**: the last 11 slides of `template.html` (the merged element-audit stack) cover semantic text, headings, lists, tables, code tokens, images/SVG, forms, disclosure, media, and dark slides. `tests/elements.test.ts` runs them with the rest of `bun test`, writing screenshots, contrast/focus/overflow results, and a PDF to `out/elements/`.
