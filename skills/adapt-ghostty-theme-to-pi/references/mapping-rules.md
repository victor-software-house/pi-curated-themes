# Mapping rules for Ghostty -> pi

## Core principle

Do not try to force a 1:1 translation.

Ghostty is a terminal theme model. pi is an application UI theme model. The goal is to preserve visual identity while creating missing semantic layers.

## Suggested token strategy

### Direct mappings

Use source colors directly when possible.

| pi token group | Preferred source |
|---|---|
| `text` | terminal default or source foreground |
| `accent` | strongest source accent |
| `mdHeading` | strongest source accent or bright foreground |
| `mdCode` | accent or bright secondary accent |
| `muted` | source gray / secondary neutral |
| `thinkingText` | source gray / secondary neutral |

### Neutral surfaces

Derive these from the background by small shifts only.

| pi token | Guideline |
|---|---|
| `selectedBg` | slightly lighter than background |
| `userMessageBg` | slightly raised neutral surface |
| `customMessageBg` | sibling of `userMessageBg` |
| `toolPendingBg` | neutral panel, not strongly tinted |
| `toolSuccessBg` | prefer warm/neutral success surface if green is foreign |
| `toolErrorBg` | darkest low-saturation error-tinted surface |

### Semantic colors — distinct operation states

Command success, command failure, and file operations (read, edit, write) must each have visually distinct colors. Users scan tool output quickly; collapsed hues waste attention.

| pi token | Guideline |
|---|---|
| `success` | calm readable accent, lean green/teal from palette |
| `error` | strongest urgent accent, lean red/orange from palette |
| `warning` | softer warm accent, lean yellow/amber from palette |
| `toolSuccessBg` | background tinted toward success hue |
| `toolErrorBg` | background tinted toward error hue |
| `toolPendingBg` | neutral panel, no strong tint |
| `toolDiffAdded` | readable positive accent (green/teal family), distinct from success |
| `toolDiffRemoved` | urgent accent (red/orange family), distinct from error text |
| `toolDiffContext` | muted gray |

Hard rule: `success`, `error`, and `warning` must never share the same hue family within a theme. If the source palette lacks three distinct hue families, derive the missing one by shifting the closest palette color toward green, red, or yellow respectively.

## Footer rule

The footer uses `dim` heavily. If `dim` is too dark, the footer becomes unusable.

Practical rule:
- start with the source secondary gray for `dim`
- only darken it if it stays clearly readable on the background

## Thinking border rule

Thinking levels should form a visible progression.

Recommended progression:
- `thinkingOff` -> darkest neutral
- `thinkingMinimal` -> muted accent or neutral
- `thinkingLow` -> low-intensity accent
- `thinkingMedium` -> normal accent
- `thinkingHigh` -> brighter accent
- `thinkingXhigh` -> strongest accent or brightest highlight

## Variant guidelines

### Literal
- maximize source fidelity
- accept rougher semantics if needed

### Semantic
- best default for daily use
- role clarity matters more than strict palette literalism

### High contrast
- prioritize readability of footer, tool output, headings, and code blocks

### Neutral / steel-like
- reduce accent pressure
- rely more on foreground and neutral grays

## Validation checklist

- [ ] theme JSON parses
- [ ] footer is readable
- [ ] selected line is visible
- [ ] successful tool panels do not look imported from another palette
- [ ] error panels feel urgent without oversaturation
- [ ] markdown headings and links are distinguishable
- [ ] syntax colors do not collapse into one tone
- [ ] thinking borders are visibly ordered
- [ ] theme name stability preserved

## Release classification

| Change type | SemVer | Conventional Commit |
|---|---|---|
| readability fix | patch | `fix:` |
| panel color tuning | patch | `fix:` |
| add new variant | minor | `feat:` |
| rename published theme | major | `feat!:` |
| remove theme | major | `feat!:` |
| move package structure | major | `feat!:` |
