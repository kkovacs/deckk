# AGENTS.md - deckk (KK's deck)

Zero-dependency reveal.js deck (vendored). `template.html` is the capability showcase and the authoring spec; `index.html` is the one-slide starter served at `/`. No package.json; nothing to install.

You are in one of two modes, never both. **Working on the template** (`template.html`, `theme.css`, `vendor/`, `tests/`): read `docs/template-dev.md` first. **Authoring a presentation**: below.

## Commands

- `bun run serve.ts` - serves on `:8000` (`HOST`/`PORT` override): starter at `/`, deck at `/template.html`.
- `bun tools/shot.ts [file.html] <slide>...` - render slides to `out/shot/` PNGs and report overflow, off-canvas elements and overlapping text. `--at 0,1500,6000` = several frames per slide (animations), `--frags N` = press fragment-next first, slide `all` = whole deck.
- `bun tools/slides.ts [file.html]` - print every slide's hash, source line, id and heading.
- `bun test` - verifies `template.html` ONLY, never a presentation.

## Authoring a presentation (clone-and-go)

1. Read the cheat-sheet comment atop `template.html` - the complete authoring spec. Copy the nearest slide skeleton and replace its content. Content lives inside `.body` divs, never as direct section children.
2. Do **not** touch the tests or the template.
3. Custom CSS goes in `index.html` or `custom.css`, custom JS in `index.html` or `custom.js`, so template updates can be `git pull`ed. **Never** run prettier on `index.html`.
4. **Look at what you change**: after any edit that adds text or changes a slide's shape, render it with `tools/shot.ts` and open the PNG. An unrendered edit is not finished. Overfull slides silently clip - split them, don't hand-set font sizes.
5. **Address slides by id**: give a slide `<section id="...">` and refer to it as `#/id`. Plain `#/N` is 0-based and shifts on insertion; never write it in comments. When the user says `#/N`, map it via `tools/slides.ts`. Edit with the Edit tool, never by line number.
6. Put the user's text in verbatim; don't invent or research content, and no print CSS, unless asked.
7. `obscura` may be on bun's `PATH` only: check with `Bun.which("obscura")`, not `command -v`. `$TMPDIR` may be unset: write scratch files to an explicit path.
