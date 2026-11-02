# deckk

Zero-dependency reveal.js deck _template_, primarily for my personal use.

**See demo at:** <https://kkovacs.github.io/deckk/>

It is a kind of **construction kit**, that defines **components** that I can combine in **full-width** or **2-column** configurations. That's how I like to work.

Fixed 1280×720 canvas, no build step, no package.json, zero custom JS, fully stock [reveal.js](https://revealjs.com/) + the official notes plugin only.

I wanted to be able to tell [Zulu Six](https://github.com/kkovacs/kkrc/blob/master/inject-ai-kk.md) to bootstrap presentations in my style, that I can fine-tune manually (= it has a good structure).

- **Serve**: `bun run serve.ts` — one-slide starter (`index.html`) at `/`, deck (`template.html`) at `/template.html`; any static webserver gives the same URLs
- **Present**: Usual reveal.js controls: arrows / hash URLs (`#/<section>/<slide>`); `class="fragment"` on any element makes it appear on click; **S** opens the speaker-notes view (`<aside class="notes">` in any slide)
- **Print/PDF**: Add `?print-pdf` to the URL and print to PDF (A4 landscape, one proportional 16:9 slide per page, all fragments shown, clickable source URLs)
- **Human's** instructions: read the cheat-sheet at the top of `template.html`.
- **AI's** instructions, architecture, design rationale, and landmines: [AGENTS.md](AGENTS.md)
- **Verify**: `bun test` — fully self-contained: serves the deck itself and runs its own obscura headless browser on ephemeral ports (obscura must be installed). Setup + gotchas: `AGENTS.md`.
- **HTML element audit**: the last stack of `template.html` (the merged element-audit fixture) covers semantic text, headings, lists, tables, code tokens, images/SVG, forms, disclosure, media, and dark slides. `bun test` audits it with everything else (screenshots + report in `out/`).
