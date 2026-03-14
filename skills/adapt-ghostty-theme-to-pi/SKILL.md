---
name: adapt-ghostty-theme-to-pi
description: Adapt a Ghostty terminal theme into one or more pi themes. Use when deriving pi's 51 theme tokens from a Ghostty palette, tuning footer readability, inventing missing semantic UI colors, preserving Ghostty identity, or deciding whether a theme change is patch, minor, or major.
files:
  references:
    - mapping-rules.md
    - token-derivation-map.md
    - colors-template.json
---

# adapt-ghostty-theme-to-pi

## Reference Index

- `references/mapping-rules.md` — detailed token mapping rules, derivation heuristics, validation checklist, and release classification.
- `references/token-derivation-map.md` — every pi token classified as direct, palette pick, derived, or synthesized, with exact formulas.
- `references/colors-template.json` — the static `colors` block template. This never changes across themes.

## Architecture

A pi theme has three sections:

```
{ "$schema": "...", "name": "...", "vars": { ... }, "colors": { ... }, "export": { ... } }
```

The critical insight: **the `colors` block is 100% static**. It is the same fixed template for every semantic theme. All per-theme variation lives in `vars` and `export`.

This means theme generation reduces to:

1. Parse Ghostty source -> extract `background`, `foreground`, `cursor-color`, `palette[0-15]`.
2. Compute `vars` (19 values) using the derivation formulas.
3. Stamp `colors` from the template (no logic needed).
4. Set `export` from three vars (`bg`, `panel`, `panelInfo`).

## What is automated vs manual

### Fully automated (script handles these)

**Direct mappings** (Ghostty field -> pi var, no decisions):

| pi var | Ghostty source |
|---|---|
| `bg` | `background` |
| `fg` | `foreground` |
| `white` | `palette[15]` if bright enough, else `#f5f5f5` |

**Deterministic derivations** (formula from bg/fg, no palette judgment):

| pi var | formula |
|---|---|
| `darkGray` | `lighten(bg, 15)` |
| `panel` | `lighten(bg, 5)` |
| `panelAlt` | `lighten(bg, 8)` |
| `panelInfo` | `lighten(bg, 10)` |
| `accentDark` | `darken(accent, 50 or 25)` depending on accent luminance |
| `accentMid` | `mix(accent, fg, 0.5)` |
| `panelSuccess` | `tint_toward(lighten(bg, 6), success, 0.07)` |
| `panelError` | `tint_toward(lighten(bg, 6), error, 0.10)` |
| `diffAdded` | `success` or `mix(success, fg, 0.7)` if too bright |
| `diffRemoved` | `error` or `mix(error, fg, 0.7)` if too bright |

**Static template** (identical for every theme):
- The entire `colors` block — see `references/colors-template.json`
- The entire `export` block — always `{ pageBg: bg, cardBg: panel, infoBg: panelInfo }`

### Heuristic (script handles but may need manual override)

These use palette analysis with fallback chains:

| pi var | heuristic summary |
|---|---|
| `accent` | `cursor-color` if saturated + distinct from bg/fg, else best saturated ANSI color |
| `gray` | `palette[8]` if readable against bg, else `lighten(bg, 55)` |
| `secondary` | most saturated ANSI with hue > 40deg from accent and > 30deg from error |
| `success` | best green/teal (hue 80-200) ANSI with 60+ hue distance from error |
| `error` | best red/warm (hue < 30 or > 330) ANSI |
| `warning` | best yellow/amber (hue 30-80) ANSI, 25+ hue distance from both error and success |

Each has a synthesized fallback when the palette lacks the needed hue family (mix a canonical color like `#5faf5f` with `fg`).

### Manual only (never automated)

- Variant creation (literal, high-contrast, steel) — each variant deliberately reweights the token assignments in the `colors` block.
- Per-theme `colors` overrides — when a specific theme needs a non-standard token wiring (e.g. `toolTitle` using `rose` instead of `white`).
- Subjective palette tuning — when the heuristic picks a technically valid but aesthetically poor color.

## Automation

### Batch generation

The generation script lives at `scripts/generate-pi-themes.py`. Run it to regenerate all semantic themes from the Ghostty source:

```bash
python3 scripts/generate-pi-themes.py
```

It reads from the Ghostty bundled themes directory (see AGENTS.md for the path), computes vars, stamps the template, writes to `themes/`.

### Adding a single theme

```bash
python3 scripts/generate-pi-themes.py --name "Theme Name"
```

Or manually:

1. Read the Ghostty theme file.
2. Apply the var derivation formulas from `references/token-derivation-map.md`.
3. Copy `references/colors-template.json` as the `colors` block.
4. Set `export` to `{ pageBg: bg, cardBg: panel, infoBg: panelInfo }`.
5. Validate: `jq empty themes/new-theme-semantic.json`

### Validation

```bash
# JSON syntax
jq empty themes/*.json

# Hue distinctness (success/error/warning must be 25+ degrees apart)
python3 scripts/generate-pi-themes.py --validate
```

## Workflow summary

### For new themes (use the script)

1. Add theme name(s) to the `THEME_NAMES` list in `scripts/generate-pi-themes.py`.
2. Run the script.
3. Spot-check: accent, success, error, warning colors.
4. Commit with `feat:` prefix.

### For visual tuning (manual edits)

1. Edit the `vars` block only. Do not change `colors` unless creating a non-semantic variant.
2. Commit with `fix:` prefix.

### For new variants (manual)

1. Copy the semantic theme as a starting point.
2. Override specific `colors` wiring for the variant strategy.
3. Commit with `feat:` prefix.

## Ghostty -> pi: what maps where

```
Ghostty                          pi vars              pi colors (template)
─────────────────────────────    ──────────────────   ────────────────────
background ──────────────────>   bg ───────────────>  (export.pageBg)
foreground ──────────────────>   fg ───────────────>  toolOutput, mdCodeBlock,
                                                      syntaxVariable
cursor-color ────────────────>   accent (if sat) ──>  accent, borderAccent,
                                                      mdCode, syntaxKeyword,
                                                      bashMode, mdListBullet,
                                                      customMessageLabel,
                                                      thinkingHigh
palette[8] (bright black) ──>   gray ─────────────>  border, muted, dim,
                                                      thinkingText, mdLinkUrl,
                                                      mdQuote, mdQuoteBorder,
                                                      toolDiffContext,
                                                      syntaxComment,
                                                      syntaxPunctuation,
                                                      thinkingMinimal
palette[15] (bright white) ─>   white ────────────>  toolTitle, mdHeading,
                                                      syntaxType, thinkingXhigh
palette[1] (red) ───────────>   error (heuristic) ─> error, syntaxOperator,
                                                      toolDiffRemoved
palette[2] (green) ─────────>   success (heuristic)> success, syntaxString,
                                                      toolDiffAdded
palette[3] (yellow) ────────>   warning (heuristic)> warning, syntaxNumber
best distinct hue from ANSI ─>  secondary ────────>  mdLink, syntaxFunction
background + offsets ────────>   panel, panelAlt,     userMessageBg, customMessageBg,
                                 panelInfo,           toolPendingBg, selectedBg
                                 panelSuccess,        toolSuccessBg
                                 panelError           toolErrorBg
accent + offsets ────────────>   accentDark, ──────>  mdCodeBlockBorder,
                                 accentMid             thinkingLow, thinkingMedium
darkGray (bg + 15) ─────────>   darkGray ─────────>  borderMuted, mdHr,
                                                      thinkingOff
```
