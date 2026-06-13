# Demo assets

`demo.gif` is the terminal recording shown in the top-level README.

## Regenerating the GIF

The GIF is produced from `demo.tape` with [VHS](https://github.com/charmbracelet/vhs):

```bash
brew install vhs          # or: go install github.com/charmbracelet/vhs@latest
vhs assets/demo.tape      # writes assets/demo.gif
```

`demo.tape` runs the real skill (`bun scripts/main.ts ./report.html --pretty`), so
before recording you need:

1. **Deps installed** — `cd scripts && bun install`.
2. **A bound email** — an `EXTEND.md` next to `SKILL.md` pointing at a reachable
   backend (the hosted `https://sharehtml.net` or a local `wrangler dev`). See the
   top-level README's *Setup* section.
3. **A `report.html`** in the directory the tape `cd`s into. Any single-page HTML
   works; the recorded demo uses a short launch-notes page.

The tape uses `--pretty` purely for a human-readable frame; agents consume the
default single-line JSON output.
