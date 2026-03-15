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

- Validation policy is externalized to `validation-policy.toml`
- Validation is surface-aware rather than only checking `gray` versus `bg`
- Pair-specific diagnostics identify the actual foreground/background usage

Current warning themes after the latest generator run:

- `arthur`
- `gruvbox-material`
- `ic-orange-ppl`
- `later-this-evening`
- `lovelace`
- `mellow`

Current warning classes:

- `toolDiffContext` on tinted tool panels for several themes
- base neutral readability (`muted`, `thinkingText`, `mdLinkUrl`, `mdQuote`) for the last three themes

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
- `validation-policy.toml` — generation thresholds and validation policies
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

Do not validate only `gray` on `bg`. Validate actual rendered pi surface pairs.

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

### 2. Decide whether to tune remaining warning themes

Current warnings are explicit and narrow. The next product decision is whether these should remain warnings or whether generation should be tuned further.

Recommended review order:

1. `later-this-evening`
2. `lovelace`
3. `mellow`
4. `arthur`
5. `gruvbox-material`
6. `ic-orange-ppl`

For each theme, inspect:

- `gray`
- `diffContext`
- `panelAlt`
- `panelSuccess`
- `panelError`

Then decide whether to:

- accept current warning behavior
- retune generation heuristics
- or adjust policy thresholds in `validation-policy.toml`

### 3. Decide whether to broaden or keep the current validation matrix

The current matrix covers the highest-value rendered pairs and produces actionable warnings.

What is still open is whether to keep the matrix as-is or extend it further.

Candidate additions to review only if they map to confirmed pi rendering paths:

- `mdLink` on `bg`
- `syntaxComment` on a representative code surface
- any additional inherited-foreground pair actually used in pi but not yet validated

Do not add pairs only because tokens exist. Keep the validator grounded in real rendering usage.

## Recommended next-session workflow

When resuming in a new session, follow this order:

1. Read:
   - `AGENTS.md`
   - `README.md`
   - `ROADMAP.md`
   - `validation-policy.toml`
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

### Policy values now belong in `validation-policy.toml`

Do not bury new policy thresholds directly inside generator logic unless there is a compelling implementation-only reason.

### Keep committed files human-facing

Avoid documenting implementation details in a way that implies uncertainty or trial state. Put unstable exploration notes in roadmap or plan files, not user-facing install docs.
