# deckk

Zero-dependency reveal.js presentation deck template, primarily for my personal use: I wanted to be able to say [Zulu Six](https://github.com/kkovacs/kkrc/blob/master/inject-ai-kk.md) to bootstrap presentations in my style that I can fine-tune later (= it has a good structure).

**See demo at <https://kkovacs.github.io/deckk/>.**

Fixed 1280×720 canvas, no build step, no package.json, zero custom JS, fully stock [reveal.js](https://revealjs.com/) + the official notes plugin only.

- **Serve**: Statis webserver (`python3 -m http.server 8000`) or `bun run serve.ts`
- **Present**: Usual reveal.js controls: arrows / hash URLs (`#/<section>/<slide>`); `class="fragment"` on any element makes it appear on click; **S** opens the speaker-notes view (`<aside class="notes">` in any slide)
- **Print/PDF**: open with `?print-pdf` and print to PDF (one 1280×720 page per slide, all fragments shown, clickable source URLs)
- **Verify**: `bun tests/probe.mjs` against a headless-Chrome CDP endpoint (setup + gotchas: `AGENTS.md`)
- **Authoring**: read the cheat-sheet comment at the top of `index.html` — panels compose into columns (bare panel or `.col` per side, 1–2 columns per slide); no inline styles
- Architecture, design rationale, and verified landmines: `AGENTS.md`
