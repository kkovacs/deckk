# deckk

Zero-dependency reveal.js 5 presentation deck — fixed 1280×720 canvas, no build step, no package.json, **zero custom JS** (stock reveal + the official notes plugin only).

- **Serve**: `bun run serve.ts` → http://localhost:8000 (`PORT` env overrides)
- **Present**: arrows / hash URLs (`#/<section>/<slide>`); `class="fragment"` on any element makes it appear on click; **S** opens the speaker-notes view (`<aside class="notes">` in any slide)
- **Print/PDF**: open with `?print-pdf` and print to PDF (one 1280×720 page per slide, all fragments shown, clickable source URLs)
- **Verify**: `bun tests/probe.mjs` against a headless-Chrome CDP endpoint (setup + gotchas: `AGENTS.md`)
- **Authoring**: read the cheat-sheet comment at the top of `index.html` — panels compose into columns (bare panel or `.col` per side, 1–2 columns per slide); no inline styles
- Architecture, design rationale, and verified landmines: `AGENTS.md`
