# AGENTS.md - deckk (KK's deck)

Zero-dependency reveal.js presentation deck (pinned release, see **Updating vendored files**). The deck IS the documentation: a capability showcase (~32 slides) in four sections - 01 mechanisms (system behaviors), 02 every block full-width, 03+04 the working pairs (reading / pictures & code) - plus a closing dark 2-col thank-you. `bun run serve.ts` serves it (default `:8000`, `PORT` env overrides). No package.json; nothing to install.

`tests/` holds the verification suite; `out/` holds its outputs (screenshots, exported PDF). `assets/` holds real images (tall.jpg / wide.jpg are deliberate wrong-shape test assets).

## Authoring a new deck from these templates (the clone-and-go flow)

1. Read the cheat-sheet comment at the top of `index.html` - the complete authoring spec. The deck's own slides double as templates: copy the nearest skeleton (full-width, pair, feature block, code slab...) and replace its content.
2. Keep the skeleton around the content: cover + agenda up front, one stack `<section>` per topic with its `.dark divider`, the closing thank-you stack (classic closer with the 2-col variant nested under it). **Exactly 6 top-level groups** (asserted by the probe).
3. If the section count changed, update BOTH expected constants in `tests/probe.mjs` (slide count, top-level group count).
4. Run `bun tests/probe.mjs` (setup: probe protocol below); eyeball the densest slides in `out/png/`.

## Architecture

- `index.html` - all slides inline; the cheat-sheet comment at the top is the **authoritative authoring spec** (keep it in sync with `theme.css`). **Zero custom JS**: the only script imports vendored reveal + the official notes plugin and calls `Reveal.initialize` once; `window.Reveal` is exposed for probing. The config is load-bearing - see the `center:false` landmine.
- `theme.css` - the design + the composition system (rationale below). Applies `font-family`/`color` directly to elements - declaring CSS variables alone leaves text at browser-default black Times on dark slides (bitten twice; the pixel probe catches it).
- `vendor/` - reveal, pinned release, vendored from jsDelivr: `reveal.esm.js`, `reveal.css`, `notes.esm.js` - all self-contained (flat, no plugin subdir; the notes plugin import in `index.html` points at `./vendor/notes.esm.js`). To bump, see **Updating vendored files** below. **Re-verify every landmine below against the new source + live probes** (this doc's landmines were re-verified that way once already; don't cargo-cult them either way).
- `assets/` - real images; an EMPTY `<figure>` still renders the pure-CSS placeholder until an `<img>` lands inside it.
- Autoformatting: `bun x prettier --write --print-width 140 index.html theme.css` - the `--print-width 140` flag is load-bearing: at the default 80, Prettier re-folds long lines and mid-tag wraps them (`></span` dangles). Tables are compact one-line rows and exempt via `<!-- prettier-ignore -->`. Run the probe suite after reformatting.

## Design rationale (the WHY; the cheat-sheet in index.html is the WHAT)

- **Geometry comes from markup shape, not markup instructions** - the SECTION counts its `.body` children (1 => full width, 2 => halves); `.body` is the only sanctioned wrapper - ONE COLUMN of gap-spaced panels; classes never carry layout. This is what makes content slides interchangeable skeletons - and the deck clone-friendly.
- **Typography is keyed to the slot** (`.body > :where(...)`, specificity 0) so tag swaps are visual no-ops and stray content classes cannot override the system. Component inner roles are position-derived (e.g. `.stats > div`'s first child is the number) - components are authored as bare divs/spans with zero inner classes.
- **Three voices**: sans (body), serif (display/quote), `--mono` (code). `theme.css` applies font-family/color directly to elements - variables alone leave text at browser defaults (see landmines).
- **Self-sizing is enforced by construction**: lists shrink by item count, stats at 4+, stats/steps wrap two-per-row in a HALF (container queries against the slot's own size container), tables compact by width, images fill-or-letterbox their layout-decided box. The author never sets a size.
- **The type scale is ONE knob** - `.reveal`'s `font-size`; every size and rhythm in the deck is em-based off it, so rescaling is a one-line edit (the deck ships enlarged ~+20% from the original design size for legibility). The fixed canvas is the constraint: the enlarged type was paid for by tightening the vertical rhythm (list item margins, steps gap/padding), and dense feature blocks overflow first - pay with rhythm or trimmed copy, never with hand-set font-sizes.
- **Bullets are unbreakable by construction**: `list-style` is dead deck-wide; markers are positioned `li::before` flex boxes, depth picks the glyph - nothing markup-side can move them.
- **Native mechanisms only**: fragments, gradients, speaker notes, `?print-pdf` are all reveal/CSS - never custom JS.
- **Deliberately unsupported** (user decision): charts (build one-offs as inline SVG / styled tables when needed), weighted splits, `.lead`, segbar/compare/imggrid - killed in the 2025 radical-simplification rewrite; git history has them. `.agenda` demos itself on the front-matter slide only (never paired).

## Landmines (verified against the pinned reveal source + live probes)

- **The display landmine**: reveal keeps slides rendered by stamping *inline* `display:block`, which persists past the class flip - that IS the fade mechanism (the outgoing slide stays rendered). Inline style beats any class rule, so the flex scaffold needs `.reveal .slides section { display: flex !important }` - scoped to ALL slides, because visited nested slides can sit with **no state class at all**. Without it, the outgoing slide re-flows to block layout mid-transition (the visible "jump before the transition").
- **`center: false` in the config** - reveal's default vertical centering stamps an inline `top` on every slide that persists into the PDF and pushes pages half a page down. `center:false` makes reveal write `top:""` instead, so the print refill needs no `top:0!important`.
- **Print refill**: vendor CSS (`html.reveal-print ...section{padding:0!important; display:block!important}`) strips the scaffold at (0,3,2); `theme.css` ties that specificity and wins by source order (vendor link comes first). html gets BOTH `print-pdf` and `reveal-print` classes in print view. The refill also forces `justify-content: flex-start !important` AND `flex-direction: column !important` - slide types that center themselves LIVE via `section:has(> .quote/.statement)` lose that fight and print top-anchored (bitten once), and two-body sections would have their halves STACKED into separate pages by the flex-column refill; both need their own scoped restore inside the refill block (re-centering for quote/statement, `display: grid !important` + row template for `:has(> .body ~ .body)`). Cover/divider already have one.
- **`.pdf-page` needs a definite height in print**: vendor gives it only `position:relative; overflow:hidden`. Without `html.print-pdf .reveal .pdf-page { height: 720px !important }`, the flex chain (section=>body=>figure=>img, `flex-basis:auto`) resolves to an image's INTRINSIC size - a tall asset grows the page past 720px and printToPDF paginates it into extra pages (bitten once with a 700x2000 jpg; live view is unaffected - definite heights all the way down).
- **Dark slides CAN carry a `.body`** (the closing thank-you does), but slot typography hard-codes `var(--ink)` - `.dark` must remap `--ink`/`--ink-soft` or body panels render near-black on navy (the same class of failure as the "black Times" trap above).
- **A stray `</section>` mid-deck orphan slides silently**: the HTML parser ignores unmatched close tags, so slides escape their stack wrapper, render and COUNT fine, but navigate as their own top-level sections (bitten once: stats..code escaped the 02 stack). The probe asserts the top-level group count - keep it in sync when sections change.
- **The `@container` wrap block must stay AFTER the feature-block base rules**: equal specificity, later source order wins. Placed earlier, `.steps > * { flex: 1 }` reverts the container rule's flex-basis to `0` - and zero-basis flex items never wrap (six steps in one colliding row; bitten once).
- **An element can never query ITSELF**: a `@container` rule's matched element resolves the condition against its nearest container ANCESTOR. The col=>body migration bit this twice: (1) the steps' `flex-wrap: wrap` sat inside the query with `.steps` as the matched element - the old `.col` was its ancestor container, the `.body` is not, so the rule silently died and six steps crammed into one row; fix: `flex-wrap: wrap` is unconditional on `.steps` (basis-0 children at full width never overflow, so wrap can't trigger there). Stats survived only because its rule targets `.stats > div`, whose ancestor container is `.stats` itself. (2) `.quote`'s own `margin: 0 auto` outranks the slot's `.body > * { margin: 0 }` (equal specificity, later source order), and auto margins opt a grid item out of stretching - combined with the slot's `container-type: inline-size` the shrink-to-fit width resolves to 0 and the quote collapsed to its padding (bitten once); the slot-quote rule zeroes the margin explicitly. Audit rule: every `@container` block's matched elements must have a container ancestor by construction.
- **Percentage grid rows need definite heights down the chain**: the lone-figure full-height rule works because the body stretches its row first (or, in a two-body row, the flex line stretches each body to the same definite height), then the body can resolve `grid-template-rows: 100%`. A body with an auto-height row resolves `100%` to auto and the figure sags to its `min-height` floor (bitten once).
- **Stack sections must stay EMPTY** (a parent with nested children discards its own content) and **padding-free** (`.reveal .stack { padding: 0 }` - vendor zeroes only their vertical padding; `box-sizing:border-box` handles the rest, the rule is insurance).
- **Bare non-`.body` wrapper `<div>`s still escape slot typography** - the slot rule selects `.body > *`; a stray wrapper div between the section and its panels (or inside a `.body`) escapes it. `.body` is the only sanctioned wrapper. Panels are NEVER direct section children - a slide's content lives inside `.body` divs, always.
- **Bullets are unbreakable by construction**: `list-style` is dead deck-wide; every marker is an `li::before` flex box exactly the height of the first line box. Depth decides the marker (ul: dot - small disc - small dot; ol: 1. => a. => i., counters reset per list). Traps: `::before` with `content:''` + `width:auto` collapses to 0 wide; text-marker rules must NOT set a smaller font-size (their 1.5em box must match the line box); sized pseudo-elements need `display:block` (inline pseudos ignore width/height - timeline dots vanished once).
- **Paired halves must start flush**: per-block margin nudges (`steps`/`stats`/`timeline` set margin-top in their own rules) outrank the slot's `.body > * { margin: 0 }` by later source order - in a two-body slide they sink the left block's top edge below the right half's first paragraph (a full em off; bitten once). The scoped rule `section:has(> .body ~ .body) > .body > :first-child { margin-top: 0 }` restores flushness for the FIRST paired panel only; full-width slides keep their nudges. Audit pairs whenever you add or change a block's margin nudge. Related trap: `.steps`' `gap` is shared row AND column - tightening it re-flows the wrap pattern in halves (2-per-row became 3-per-row), it is not a vertical-only knob.
- **Overflow is a silent failure**: fixed 1280x720 canvas, no auto-fit; an overfull slide just clips - split it. Probes catch out-of-canvas overflow, **not intra-slide overlap**. After typography changes, eyeball the densest slides (`out/png/`).

## Updating vendored files (reveal.js ESM + CSS)

All three files come from jsDelivr - flat, self-contained ESM, no nested imports:

```
# set VER to the pinned reveal.js version, then - note the plugin lives at the
# package ROOT, not under dist/ (a /dist/plugin/... URL 404s on jsDelivr):
VER=<pinned-version>
curl -fsSL -o vendor/reveal.esm.js https://cdn.jsdelivr.net/npm/reveal.js@$VER/dist/reveal.esm.js
curl -fsSL -o vendor/reveal.css    https://cdn.jsdelivr.net/npm/reveal.js@$VER/dist/reveal.css
curl -fsSL -o vendor/notes.esm.js  https://cdn.jsdelivr.net/npm/reveal.js@$VER/plugin/notes/notes.esm.js
```

After downloading:

1. Sanity-check against the CDN: `cmp <(curl -fsSL <url>) vendor/<file>` for each - they must be byte-identical to the pinned release. Don't panic if the `/*! reveal.js ... */` banner inside `reveal.esm.js` reads one version behind: upstream's version string can lag; the `cmp` above is the source of truth.
2. `grep -n "^import\|from "` the JS files - they must stay import-free (or only self-referencing); the deck ships zero deps beyond these files.
2. Re-verify every **Landmine** against the new source - especially `center:false` inline-top stamping, the print-refill specificity race, and `.pdf-page` height (bitten before; re-probed during the one bump so far).
3. Live-verify with the probe suite (protocol below): `HOST=0.0.0.0 PORT=8000 bun serve.ts` + `bun tests/probe.mjs`, then eyeball `out/png/`.

## Probe protocol (headless Chrome via docker)

```
docker container run -d --name hless --add-host host.docker.internal:host-gateway -p 9222:9222 chromedp/headless-shell:latest
```

Verify CDP with `curl -fsS http://127.0.0.1:9222/json/version`. Raw CDP over WebSocket from bun scripts (no deps). **`tests/probe.mjs` is the verification suite, run from the repo root** (`bun tests/probe.mjs`, under `timeout`): slide count, structural group check (exactly 6 top-level `.slides > section` - front stack + 4 section stacks + the closing thank-you stack), per-slide overflow + screenshots to `out/png/`, fragment advance, print-view DOM geometry (page count, tall pages, stamped inline tops), real PDF via `Page.printToPDF` + MediaBox count. **Update the expected slide count when slides change.** `tests/shot.mjs <flat-idx>...` captures individual print-view pages. Gotchas, each learned the hard way:

- Reach the deck at `http://host.docker.internal:<PORT>/`, never `localhost`.
- Navigate once per view (hash changes never fire `load`); move between slides with `Reveal.slide(h, v)` + ~1.2s settle before screenshots. **`slide()` takes stack coords, NOT flat indices** - build an `(h, v)` map from `.slides > section` children (flat indices silently navigate the wrong slides; bitten once).
- **Test fragments FIRST, on a fresh load** - revisiting a slide leaves its fragments revealed (reveal quirk, not a bug).
- `Reveal.next()` walks PAST the current slide once its fragments are exhausted - to advance fragments on a specific slide use `Reveal.nextFragment()` and confirm with `Reveal.getIndices()` (bitten once: measured the wrong slide and got plausible-looking numbers).
- CDP element-**clip** screenshots beyond the viewport are unreliable in headless-shell - `scrollIntoView()` + settle + a plain full-viewport capture instead.
- Fresh tab per probe (no cache headers); find slides by heading text, not hardcoded indices. Quote/statement slides carry no h1/h2, so flat indices drift from heading counts - don't map headings to `out/png/slide-N.png` naively.
- Slide backgrounds paint on the `.slide-background` element itself, not its `.slide-background-content` child - probe the parent.
- PNGs are served by serve.ts from the repo root, so in-page canvas sampling works for pixel checks.
- The suite itself can flake (CDP screenshot payload came back `undefined` once) - re-run before debugging the deck.

## References

- Reveal.js docs: https://revealjs.com/ (PDF export, fragments, speaker notes, backgrounds)
- CSS container queries (the half-wrap mechanism): https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment
