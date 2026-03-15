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
- Standalone `uv` script execution without a project-level Python runtime requirement in `mise`

### Validation

Implemented:

- Validation is intentionally lightweight
- Generation no longer depends on an external validation policy file
- Validation currently guards only against structurally bad outputs such as obvious semantic collisions

### Release automation

Implemented:

- `semantic-release` is the release automation model
- GitHub Actions publish uses npm trusted publishing with OIDC instead of `NPM_TOKEN`
- Conventional Commits are enforced locally with Lefthook + commitlint and again in CI
- The package is published on npm as `@victor-software-house/pi-curated-themes`
- npm trusted publishing is configured for `victor-software-house/pi-curated-themes` and `.github/workflows/publish.yml`
- Historical tag `v0.1.0` exists on the remote so `semantic-release` has a valid starting point

### Preview TUI

Implemented in `scripts/list-themes-tui.ts`:

- fullscreen alternate-screen preview
- temporary terminal theme override using original upstream terminal colors
- interactive list with filtering and search
- Ghostty-inspired layout direction
- actual pi components for previewed content blocks
- TypeScript example snippet for supported syntax highlighting
- preview task via `mise run preview`

### Package gallery metadata and extension UX research

Current findings:

- The package gallery badges are driven by actual package resources, not by keywords alone.
- This package currently shows as `skill` + `theme`, not `extension`, because it ships `skills/` and `themes/` but no `extensions/` entry.
- pi package gallery preview media is static package metadata. In practice among nearby Victor packages, `pi-multicodex` uses `pi.image` in `package.json` to show a gallery card preview image.
- No nearby Victor package currently ships a live theme preview panel inside pi itself. The closest reusable pattern is extension-owned settings UI built with `ctx.ui.custom()` plus `SettingsList`, as used in `pi-multicodex`, and richer modal infrastructure like the custom Zellij-style modal in `pi-context-optimizer`.

Implications:

- If this package wants a gallery preview, the lowest-friction option is to add a static `pi.image` screenshot showing several themes.
- If this package wants an in-app preview panel, it needs to ship an actual extension and use extension UI primitives such as `ctx.ui.custom()`, `ctx.ui.setWidget()`, or a custom footer/editor component.
- A package-level preview image and an in-app preview extension solve different problems and can coexist.

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

### Release files

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`
- `.releaserc.json`
- `commitlint.config.cjs`
- `lefthook.yml`

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

### Theme selection integration policy

Current API constraints from pi docs:

- Themes are selected through built-in `/settings` or by writing `theme` in `settings.json`.
- Extensions can register new commands and custom UI, but built-in interactive commands like `/settings` are handled separately.
- The docs describe overriding built-in tools, but do not describe overriding built-in interactive commands or replacing the built-in theme selector directly.

Working assumption until proven otherwise:

- A custom extension can improve theme selection by providing its own command or panel and then writing the chosen theme into settings.
- A custom extension should not assume it can replace the built-in `/settings` theme selector directly without upstream pi changes.

## Remaining work

### 1. Finish preview fidelity work

The preview is usable, but it is still not fully aligned with Ghostty.

Remaining improvements:

- Reduce remaining spacing mismatches in the preview pane where pi component layout differs from Ghostty’s preview structure.
- Refine row styling and scroll affordances in the left pane.
- Polish help and search overlays further if a later pass needs closer Ghostty parity.

### 2. Design an in-app theme picker extension

The current `mise run preview` TUI works well for batch review, but it is separate from normal pi interaction and separate from the built-in theme selector.

Recommended exploration path:

- Prototype a lightweight extension that opens a theme picker panel with `ctx.ui.custom()`.
- Reuse proven patterns from Victor-owned packages:
  - `pi-multicodex` style `SettingsList`/live-preview panel for quick iteration and searchable lists
  - `pi-context-optimizer` style custom modal if the stock list components prove too limiting
- Treat the first extension prototype as a focused UX experiment rather than a final architecture decision.

Open design questions:

- Should the panel be fullscreen, overlay, or a compact right-side panel?
- Should it render a single representative preview block, or a reduced multi-surface snapshot?
- Should it keep the current preview’s temporary terminal-palette override, or use only pi theme tokens?

### 3. Improve theme filtering and selection UX

The built-in theme selector is currently a bottleneck for a large curated set.

Recommended focus:

- Support faster filtering by slug and display name.
- Add package-local metadata for grouping and filtering, for example source family, contrast level, accent hue, or "quiet vs vivid" tags.
- Prefer interaction patterns that reduce long flat scrolling.
- Keep the extension picker search-first and keyboard-first.

Important constraint:

- Current pi docs do not show a supported way to override the built-in `/settings` theme selector directly.
- The practical route is to add a separate extension command or panel that writes the selected theme to settings.
- If direct replacement is desired, that likely requires upstream pi support rather than package-only work.

### 4. Continue tuning visually sensitive themes

If individual themes still look off during review, inspect these values first:

- `gray`
- `diffContext`
- `panelAlt`
- `panelSuccess`
- `panelError`

Then retune generation heuristics only where the preview still looks unnatural.

### 5. Continue visual tuning where needed

The main remaining theme work is visual tuning rather than policy work.

Current focus areas:

- keep tool success panels quieter than tool error panels
- keep read and edit panels closer to the source palette identity
- keep diff colors readable without making them feel detached from the base theme

### 6. Decide whether to add gallery preview media

If the package should look better in the package gallery:

- add a static `pi.image` preview to `package.json`
- use it only as package-card marketing context, not as a replacement for the in-app picker UX
- keep this decision separate from the extension work so the package can ship one without blocking on the other

## Recommended next-session workflow

When resuming in a new session, follow this order:

1. Read:
   - `AGENTS.md`
   - `README.md`
   - `ROADMAP.md`
2. Confirm current validation state:
   - `jq empty themes/*.json`
   - `mise run themes:validate`
3. If working on preview fidelity:
   - `mise run preview`
4. If exploring in-app picker UX:
   - review `pi-multicodex/status.ts` for the `ctx.ui.custom()` + `SettingsList` live-preview pattern
   - review `pi-context-optimizer/src/zellij-modal.ts` if a richer modal layout is needed
   - verify pi extension docs before assuming built-in `/settings` can be replaced
5. If working on generator behavior:
   - regenerate with `mise run themes:generate`
   - revalidate immediately
6. Commit and push often

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
mise run themes:validate
```

### Regenerate themes

```bash
mise run themes:generate
```

### Fetch upstream

```bash
bash scripts/fetch-upstream.sh
```

## Cautions

### Theme renames are now already done

Do not reintroduce `-semantic` to default theme names.

### Preview is self-contained

The preview no longer mutates the host terminal palette during theme switching. Keep preview rendering self-contained inside the TUI unless a future task explicitly requires a different approach.

### Keep committed files human-facing

Avoid documenting implementation details in a way that implies uncertainty or trial state. Put unstable exploration notes in roadmap or plan files, not user-facing install docs.
