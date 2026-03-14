# Token derivation map

Every pi theme token classified by how it relates to the Ghostty source.

## Classification key

- **Direct**: 1:1 from a Ghostty field. No heuristics needed.
- **Palette pick**: chosen from the ANSI palette (0-15) using a heuristic (saturation, hue, luminance).
- **Derived**: computed from a direct or palette-pick value using a deterministic formula (lighten, darken, mix, tint).
- **Synthesized**: invented when the palette lacks a suitable candidate. Uses a fallback color mixed with the foreground.

## Vars (reusable color variables)

| var | classification | source / formula |
|---|---|---|
| `bg` | direct | `background` |
| `fg` | direct | `foreground` |
| `gray` | palette pick / derived | `palette[8]` (bright black) if luminance > bg + 25, else `lighten(bg, 55)`. Then `ensure_contrast(gray, bg, 40)`. |
| `darkGray` | derived | `lighten(bg, 15)` |
| `accent` | palette pick | `cursor-color` if saturated (>0.3) and not identical to fg/bg, else most saturated bright ANSI color weighted by `saturation * (luminance + 20) / 275`. |
| `accentDark` | derived | `darken(accent, 50)` if accent luminance > 70, else `darken(accent, 25)` |
| `accentMid` | derived | `mix(accent, fg, 0.5)` |
| `secondary` | palette pick | most saturated ANSI color with hue distance > 40 from accent and > 30 from error, contrast > 35 from bg. Fallback: `bright_cyan` or `bright_magenta`. |
| `white` | palette pick | `palette[15]` (bright white) if luminance > 200, else `#f5f5f5` |
| `panel` | derived | `lighten(bg, 5)` |
| `panelAlt` | derived | `lighten(bg, 8)` |
| `panelSuccess` | derived | `tint_toward(lighten(bg, 6), success, 0.07)` |
| `panelError` | derived | `tint_toward(lighten(bg, 6), error, 0.10)` |
| `panelInfo` | derived | `lighten(bg, 10)` |
| `success` | palette pick / synthesized | best green/teal (hue 80-200) from ANSI palette, 60+ hue distance from error. Fallback: `mix("#5faf5f", fg, 0.6)`. |
| `error` | palette pick / synthesized | best red/warm (hue < 30 or > 330) from ANSI palette. Fallback: `mix("#d75f5f", fg, 0.55)`. |
| `warning` | palette pick / synthesized | best yellow/amber (hue 30-80) from ANSI palette, 25+ hue distance from both error and success. Fallback: iterative mix toward `#cccc00` / `#999900` / `#888800`, final fallback synthesized via `colorsys` at midpoint hue. |
| `diffAdded` | derived | `mix(success, fg, 0.7)` if success luminance > 150, else `success`. Then contrast-ensured. |
| `diffRemoved` | derived | `mix(error, fg, 0.7)` if error luminance > 150, else `error`. Then contrast-ensured. |

## Colors (the 51 theme tokens)

### Static / template tokens (never change across themes)

These tokens always use the same var reference. The `colors` block is a fixed template.

| token | always maps to | notes |
|---|---|---|
| `text` | `""` (empty = terminal default) | never overridden |
| `userMessageText` | `""` | terminal default |
| `customMessageText` | `""` | terminal default |

### Direct var references (1:1 from vars, no per-theme logic)

These are fixed wiring from vars to color tokens. The template never changes.

| token | var | Ghostty origin |
|---|---|---|
| `accent` | `accent` | cursor-color or strongest ANSI |
| `border` | `gray` | palette[8] |
| `borderAccent` | `accent` | cursor-color or strongest ANSI |
| `borderMuted` | `darkGray` | lighten(bg, 15) |
| `success` | `success` | palette green/teal pick |
| `error` | `error` | palette red pick |
| `warning` | `warning` | palette yellow pick |
| `muted` | `gray` | palette[8] |
| `dim` | `gray` | palette[8] |
| `thinkingText` | `gray` | palette[8] |
| `selectedBg` | `panelInfo` | lighten(bg, 10) |
| `userMessageBg` | `panel` | lighten(bg, 5) |
| `customMessageBg` | `panelAlt` | lighten(bg, 8) |
| `customMessageLabel` | `accent` | cursor-color or strongest ANSI |
| `toolPendingBg` | `panelAlt` | lighten(bg, 8) |
| `toolSuccessBg` | `panelSuccess` | tint(bg, success) |
| `toolErrorBg` | `panelError` | tint(bg, error) |
| `toolTitle` | `white` | palette[15] |
| `toolOutput` | `fg` | foreground |
| `mdHeading` | `white` | palette[15] |
| `mdLink` | `secondary` | palette pick (distinct hue from accent) |
| `mdLinkUrl` | `gray` | palette[8] |
| `mdCode` | `accent` | cursor-color or strongest ANSI |
| `mdCodeBlock` | `fg` | foreground |
| `mdCodeBlockBorder` | `accentDark` | darken(accent) |
| `mdQuote` | `gray` | palette[8] |
| `mdQuoteBorder` | `gray` | palette[8] |
| `mdHr` | `darkGray` | lighten(bg, 15) |
| `mdListBullet` | `accent` | cursor-color or strongest ANSI |
| `toolDiffAdded` | `diffAdded` | success variant |
| `toolDiffRemoved` | `diffRemoved` | error variant |
| `toolDiffContext` | `gray` | palette[8] |
| `syntaxComment` | `gray` | palette[8] |
| `syntaxKeyword` | `accent` | cursor-color or strongest ANSI |
| `syntaxFunction` | `secondary` | palette pick |
| `syntaxVariable` | `fg` | foreground |
| `syntaxString` | `success` | palette green/teal pick |
| `syntaxNumber` | `warning` | palette yellow pick |
| `syntaxType` | `white` | palette[15] |
| `syntaxOperator` | `error` | palette red pick |
| `syntaxPunctuation` | `gray` | palette[8] |
| `thinkingOff` | `darkGray` | lighten(bg, 15) |
| `thinkingMinimal` | `gray` | palette[8] |
| `thinkingLow` | `accentDark` | darken(accent) |
| `thinkingMedium` | `accentMid` | mix(accent, fg) |
| `thinkingHigh` | `accent` | cursor-color or strongest ANSI |
| `thinkingXhigh` | `white` | palette[15] |
| `bashMode` | `accent` | cursor-color or strongest ANSI |

### Export

| token | var | Ghostty origin |
|---|---|---|
| `pageBg` | `bg` | background |
| `cardBg` | `panel` | lighten(bg, 5) |
| `infoBg` | `panelInfo` | lighten(bg, 10) |

## Key insight

The `colors` block is **100% static**. It is a fixed template that maps var names to token names. All per-theme variation lives in the `vars` block. This means:

1. The `colors` template can be a literal JSON file checked into the repo.
2. Theme generation only needs to compute `vars` + `export` values.
3. The generation script reduces to: parse Ghostty source -> derive vars -> stamp template.
