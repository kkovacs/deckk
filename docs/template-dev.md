# Working on the template (not on a presentation)

Only read this when changing `template.html`, `theme.css`, `vendor/` or the tests. Authoring a deck? Stop; see `AGENTS.md`.

- Keep the cheat-sheet comment atop `template.html` in sync with `theme.css`.
- When slides change, update the expected constants atop `tests/probe.test.ts` (`SLIDES_TOTAL`, `GROUPS`, `AUDIT_SLIDES`).
- Format: `bun x prettier --write --print-width 140 template.html theme.css` (140 is load-bearing; tables are exempt via `<!-- prettier-ignore -->`). Then `bun test`.
- **Landmines live in the code** as `LANDMINE:` comments next to the rules they protect: `grep -n LANDMINE theme.css template.html`. Read them before touching the surrounding rule. After a reveal bump, re-verify every one against the new source.
- Fixed 1280x720 canvas, no auto-fit: overfull slides silently clip. The tests catch out-of-canvas overflow, **not** intra-slide overlap - run `tools/shot.ts` on the densest slides.
- Design: geometry comes from markup shape (`.body` count), typography from the slot, sizing from the single `.reveal` font-size. Native reveal/CSS mechanisms only (no JS in the template). Unsupported on purpose: charts (inline SVG/tables), weighted splits.

## Updating vendored reveal.js

Download from `https://cdn.jsdelivr.net/npm/reveal.js@<VER>/dist/` under stable local names: `reveal.mjs` -> `vendor/reveal.esm.js`, `reveal.css` -> `vendor/reveal.css`, `plugin/notes.mjs` -> `vendor/notes.esm.js`. Then: `cmp <(curl -fsSL <url>) vendor/<file>` for each (byte-identical is the truth); `grep -n "^import\|from "` must show the JS stays import-free; re-verify the landmines; `bun test` and eyeball `out/png/`.

## Probe gotchas

- The suite can flake (e.g. undefined screenshot payload) - re-run before debugging the deck. CDP plumbing lives in `tests/lib.ts`, shared with `tools/shot.ts`.
- `Reveal.slide(h, v)` takes stack coords, NOT flat indices; build the map from `.slides > section`. Find slides by heading text (quote/statement slides have no h1/h2).
- Test fragments FIRST on a fresh load (revisits leave them revealed); use `Reveal.nextFragment()`, not `next()`.
- Eval strings are template literals: `\d` collapses to `d`. Use `pkill -f '[o]bscura'` (plain `obscura` self-matches your shell).
- Already documented where the code lives, so not repeated here: `goto`/`printParams`/`tab` in `tests/lib.ts`; `:focus-visible` and CSS-shorthand quirks in `tests/probe.test.ts`; slide refs and settle timing in `tools/shot.ts`.
- Slide backgrounds paint on `.slide-background`, not its content child.
- Bun: poll `exitCode === null` (no `hasExited()`); a failing `beforeAll`/`afterAll` fails the whole run.
