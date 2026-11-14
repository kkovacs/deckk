# AGENTS.md - deckk (KK's deck)

Zero-dependency reveal.js deck (6.0.2, vendored). The deck IS the documentation: `template.html` is a capability showcase (01 mechanisms, 02 every block full-width, 03+04 working pairs, closing dark thank-you, element-audit stack). `index.html` is the one-slide starter served at `/`. No package.json; nothing to install.

- `bun run serve.ts` - serves on `:8000` (`HOST`/`PORT` override): starter at `/`, deck at `/template.html`.
- `bun test` - self-contained suite (own server + own obscura headless browser, ephemeral ports). It verifies `template.html` ONLY, never a presentation. `out/` holds screenshots and PDFs.
- `bun tools/shot.ts [file.html] <slide>...` - render slides to `out/shot/` PNGs and report overflow, off-canvas elements and overlapping text. `--at 0,1500,6000` = several frames per slide (animations), `--frags N` = press fragment-next first, slide `all` = whole deck.
- `bun tools/slides.ts [file.html]` - print every slide's hash, source line, id and heading.
- `assets/` - real images; `tall.jpg`/`wide.jpg` are deliberate wrong-shape test assets. A `<figure>` with no child elements renders the CSS placeholder until something lands inside.
- Format (template work only): `bun x prettier --write --print-width 140 template.html theme.css` (140 is load-bearing; tables are exempt via `<!-- prettier-ignore -->`). **Never** run prettier on a presentation's `index.html`. Re-run tests after.

## Two work modes (you are in only one)

**Authoring a real presentation** (clone-and-go):
1. Read the cheat-sheet comment atop `template.html` - the authoritative authoring spec. Copy the nearest slide skeleton and replace its content.
2. Do **not** touch the tests.
3. Custom CSS goes in `index.html` or `custom.css`, custom JS in `index.html` or `custom.js` - never edit the template, so template updates can be `git pull`ed.
4. **Look at what you change**: after any edit that adds text or changes a slide's shape, render it with `tools/shot.ts` and open the PNG. An unrendered edit is not finished.
5. **Address slides by id**: give a slide `<section id="...">` and refer to it as `#/id`. Plain `#/N` is 0-based, shifts on insertion, and must never appear in comments; when the user says `#/N`, map it via `tools/slides.ts`. Edit with the Edit tool, never by line number.
6. Put the user's text in verbatim; don't invent or research content, and no print CSS, unless asked.

**Working on the template:** keep the cheat-sheet in sync with `theme.css`, and update the expected constants atop `tests/probe.test.ts` when slides change.

## Design principles

- **Geometry from markup shape**: a section counts its `.body` children (1 = full width, 2 = halves). `.body` is the only sanctioned wrapper; panels are never direct section children. Classes never carry layout.
- **Typography keyed to the slot** (`.body > :where(...)`, specificity 0); component inner roles are position-derived, so components are bare divs/spans with no inner classes.
- **Self-sizing by construction** (lists, stats, steps, tables, images). Authors never set sizes. The type scale is ONE knob: `.reveal` `font-size`, everything else is em-based. Dense slides overflow first: trim copy or tighten rhythm, never hand-set font-sizes.
- **Native mechanisms only**: fragments, gradients, notes, `?print-pdf`. No custom JS in the template.
- **Unsupported on purpose**: charts (use inline SVG/tables), weighted splits.
- Fixed 1280x720 canvas, no auto-fit: overfull slides silently clip. Tests catch out-of-canvas overflow, **not** intra-slide overlap - look at the render.

## Landmines

Format: trap -> rule.

- Element styles must set `font-family`/`color` directly; CSS variables alone leave black Times on dark slides.
- Reveal stamps inline `display:block` on slides -> flex scaffold needs `.reveal .slides section { display: flex !important }` on ALL slides.
- Config needs `center: false`, or reveal stamps an inline `top` that shifts PDF pages.
- Print refill must tie vendor specificity `html.reveal-print ...section` (win by source order; vendor link first). It forces `flex-start` and `flex-direction: column`, so quote/statement (re-center) and two-body sections (`display: grid` + row template) need their own restore inside the refill block.
- `html.print-pdf .reveal .pdf-page { height: 720px !important }` is required, or an image's intrinsic size grows the page and the PDF paginates into extras.
- Dark slides with a `.body` must remap `--ink`/`--ink-soft` (slot typography hard-codes `var(--ink)`).
- A stray `</section>` orphans slides into their own top-level sections. The probe asserts the top-level group count (7); keep it in sync.
- The `@container` wrap block must stay AFTER the feature-block base rules (equal specificity; `.steps > * { flex: 1 }` would kill wrapping).
- An element can't query itself: every `@container`-matched element needs a container ANCESTOR. `.body` is not a container; each `.body > *` panel is. `.steps` `flex-wrap: wrap` is unconditional for this reason. `.quote` and `.statement` must zero their own margin (auto margins + `container-type` collapse them to 0 width).
- Percentage grid rows (lone-figure full height) need definite heights down the whole chain, or the figure sags to its `min-height`.
- Stack sections must stay EMPTY and padding-free.
- Bullets: `list-style` is dead; markers are `li::before` flex boxes. Sized pseudo-elements need `display:block`; no smaller font-size on text markers; `content:''` + `width:auto` collapses to 0.
- Paired halves must start flush: per-block margin nudges (`steps`/`stats`/`timeline`) outrank the slot reset, so a scoped rule zeroes the first paired panel's top margin. Audit pairs when changing nudges. `.steps` `gap` is shared row AND column - tightening it re-flows the wrap.

## Updating vendored files

```
VER=<pinned-version>
curl -fsSL -o vendor/reveal.esm.js https://cdn.jsdelivr.net/npm/reveal.js@$VER/dist/reveal.mjs
curl -fsSL -o vendor/reveal.css    https://cdn.jsdelivr.net/npm/reveal.js@$VER/dist/reveal.css
curl -fsSL -o vendor/notes.esm.js  https://cdn.jsdelivr.net/npm/reveal.js@$VER/dist/plugin/notes.mjs
```

Then: `cmp <(curl -fsSL <url>) vendor/<file>` for each (byte-identical is the truth); `grep -n "^import\|from "` must show the JS stays import-free; re-verify every landmine above against the new source; `bun test` and eyeball `out/png/`.

## Probe gotchas

- The suite can flake (e.g. undefined screenshot payload) - re-run before debugging the deck. CDP plumbing lives in `tests/lib.ts`, shared with `tools/shot.ts`.
- `Reveal.slide(h, v)` takes stack coords, NOT flat indices; build the map from `.slides > section`. Find slides by heading text (quote/statement slides have no h1/h2).
- Test fragments FIRST on a fresh load (revisits leave them revealed); use `Reveal.nextFragment()`, not `next()`, and confirm via `getIndices()`.
- Navigate once per view (hash changes don't fire `load`); settle ~1.2s before screenshots; use `scrollIntoView()` + full-viewport capture, not element clips.
- Export PDFs with the fixed `printParams` const only (16:9, zero margins); never branch it on external state.
- Keyboard focus can't be simulated: assert focusability and the stylesheet's `:focus-visible` rule instead.
- Obscura serializes CSS as shorthands only (`outline`, `boxShadow` longhands read `""`); check the shorthand.
- Eval strings are template literals: `\d` collapses to `d`, so avoid escaped regex in evals. Use `pkill -f '[o]bscura'` (plain `obscura` self-matches your shell).
- Slide backgrounds paint on `.slide-background`, not its content child.
- Bun: poll `exitCode === null` (no `hasExited()`); a failing `beforeAll`/`afterAll` fails the whole run.

## References

- Reveal.js: https://revealjs.com/ - Bun test: https://bun.com/docs/test - Container queries: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment
