# Roadmap

## Purpose

This roadmap captures the current state of `pi-curated-themes`, the decisions already made, and the remaining work. It is intended to let work continue cleanly in a new session without reconstructing prior context from git history or terminal logs.

## Repository direction

This repository publishes curated pi themes derived directly from upstream iTerm2 `.itermcolors` files.

Current product direction:

- Ship the semantic variant as the default theme naming model.
- Use unsuffixed theme names, for example `catppuccin-mocha` instead of `catppuccin-mocha-semantic`.
- Keep upstream palette identity intact unless a task explicitly calls for a stronger semantic adjustment.
- Validate themes using actual rendered pi surface pairs, not only base-background neutral contrast.
- Provide a fullscreen preview TUI that is as close as practical to `ghostty +list-themes` while still previewing pi themes.

## Current state

### Naming and packaging

Implemented:

- Default theme names are now unsuffixed.
- Theme JSON filenames match the default theme names.
- README examples use unsuffixed names.
- Preview discovery and source-name mapping use unsuffixed names.

Examples:

- `adventure`
- `catppuccin-mocha`
- `later-this-evening`

### Theme generation

Implemented in `scripts/generate-pi-themes.py`:

- Direct `.itermcolors` parsing via `plistlib`
- Display P3 to sRGB conversion
- Semantic derivation for pi token model
- Dedicated `diffContext` derivation for tool diff context on tool surfaces

### Validation

Implemented:

- Validation is intentionally lightweight
- Generation no longer depends on an external validation policy file
- Validation currently guards only against structurally bad outputs such as obvious semantic collisions

### Preview TUI

Implemented in `scripts/list-themes-tui.ts`:

- fullscreen alternate-screen preview
- temporary terminal theme override using original upstream terminal colors
- interactive list with filtering and search
- Ghostty-inspired layout direction
- actual pi components for previewed content blocks
- TypeScript example snippet for supported syntax highlighting
- preview task via `mise run preview`

## Files that matter most

### Source of truth and config

- `curated.toml` — curated upstream theme list
- `AGENTS.md` — repository-level working rules
- `README.md` — user-facing install, naming, preview, workflow, and validation documentation
- `ROADMAP.md` — this continuation document and the sole planning document in the repository

### Scripts

- `scripts/fetch-upstream.sh` — fetch upstream iTerm2 color schemes
- `scripts/generate-pi-themes.py` — generate and validate themes
- `scripts/list-themes-tui.ts` — fullscreen preview tool

### Tasks

- `mise.toml`
- `mise.lock`
- `mise-tasks/preview`

## What was already decided

### Upstream source policy

Do not use Ghostty as the palette source of truth. Use upstream `.itermcolors` files from `mbadolato/iTerm2-Color-Schemes`.

### Naming policy

Keep the semantic variant as the default public name. If alternate variants are added later, only non-default variants should gain suffixes.

Examples of the intended long-term model:

- `catppuccin-mocha`
- `catppuccin-mocha-literal`
- `catppuccin-mocha-high-contrast`

### Validation policy

Keep validation lightweight unless a future task explicitly requires stronger policy enforcement again.

### Preview policy

The preview should be as close as possible to `ghostty +list-themes`, but it should preview pi themes, not raw terminal themes. The temporary terminal override should use the original upstream terminal theme so the surrounding terminal matches the source palette during preview.

## Remaining work

### 1. Finish preview fidelity work

The preview is usable, but it is still not fully aligned with Ghostty.

Remaining improvements:

- Replace the current `SelectList`-based left pane with a custom renderer closer to Ghostty’s list style.
- Add mouse wheel support.
- Add click selection support.
- Improve the help overlay styling to better match Ghostty’s modal layout.
- Consider a custom search overlay closer to Ghostty rather than only footer-driven search state.
- Reduce remaining spacing mismatches in the preview pane where pi component layout differs from Ghostty’s preview structure.

### 2. Continue tuning visually sensitive themes

If individual themes still look off during review, inspect these values first:

- `gray`
- `diffContext`
- `panelAlt`
- `panelSuccess`
- `panelError`

Then retune generation heuristics only where the preview still looks unnatural.

### 3. Continue visual tuning where needed

The main remaining theme work is visual tuning rather than policy work.

Current focus areas:

- keep tool success panels quieter than tool error panels
- keep read and edit panels closer to the source palette identity
- keep diff colors readable without making them feel detached from the base theme

## Recommended next-session workflow

When resuming in a new session, follow this order:

1. Read:
   - `AGENTS.md`
   - `README.md`
   - `ROADMAP.md`
2. Confirm current validation state:
   - `jq empty themes/*.json`
   - `mise x -- python3 scripts/generate-pi-themes.py --validate`
3. If working on preview fidelity:
   - `mise run preview`
4. If working on generator behavior:
   - regenerate with `mise x -- python3 scripts/generate-pi-themes.py`
   - revalidate immediately
5. Commit and push often

## Current known commands

### Preview

```bash
mise run preview
mise run preview -- light
mise run preview -- all
```

### Validate

```bash
jq empty themes/*.json
mise x -- python3 scripts/generate-pi-themes.py --validate
```

### Regenerate themes

```bash
mise x -- python3 scripts/generate-pi-themes.py
```

### Fetch upstream

```bash
bash scripts/fetch-upstream.sh
```

## Cautions

### Theme renames are now already done

Do not reintroduce `-semantic` to default theme names.

### Preview terminal overrides are intentional

The preview temporarily changes terminal foreground/background/cursor and ANSI palette using the original upstream terminal theme. That behavior is expected and should be preserved unless a better source-grounded method replaces it.

### Keep committed files human-facing

Avoid documenting implementation details in a way that implies uncertainty or trial state. Put unstable exploration notes in roadmap or plan files, not user-facing install docs.
