# Plan: Surface-aware theme validation and gray policy cleanup

## Status

Proposed. Not implemented.

## Problem statement

The current theme-generation and validation flow partially addresses muted gray readability, but it does so with an incomplete model:

- generation softens some gray values
- validation warns or fails based only on `gray` versus base `bg`
- three themes were manually or regeneratively shifted into the warning band
- `cap_contrast()` was added but is not used

This does not match the actual rendering model of pi.

pi renders text on multiple surfaces, not only on the base background. A theme can pass `gray` vs `bg` while still producing weak contrast on message cards or tool panels.

## Goal

Replace the current single-pair gray validation with a surface-aware validation model that evaluates the actual foreground/background pairs used by pi.

## Non-goals

- Do not redesign the semantic theme derivation model from scratch.
- Do not rename themes.
- Do not change package structure.
- Do not introduce workaround type-safety hacks or suppression comments.

## Desired outcomes

1. Validation checks real rendered pairings, not only `gray` against `bg`.
2. Warnings identify the exact token/surface pair that is weak.
3. Hard failures remain reserved for truly unreadable results and semantic collisions.
4. Dead code such as unused helpers is removed unless it is explicitly integrated.
5. The three currently warning themes are reviewed against the real surface matrix rather than accepted only because base-background gray contrast is tolerated.

## Design principles

### 1. Validate actual usage

The validator must reflect how pi actually renders UI. Token validation should be driven by known foreground/background usages.

### 2. Separate derivation from validation

Generation logic decides what colors to derive. Validation decides whether those results are acceptable. These policies should not be mixed implicitly.

### 3. Report actionable diagnostics

Warnings and failures should name:

- theme
- foreground token
- background token or rendered surface
- measured contrast
- threshold crossed

### 4. Keep tolerance bands explicit

All thresholds should be named constants with clear intent.

## Proposed implementation

### Phase 1: Formalize the validation matrix

Add an explicit foreground/background validation matrix in `scripts/generate-pi-themes.py`.

Initial proposed matrix:

| Pair ID | Foreground | Background |
|---|---|---|
| `base-muted` | `gray` | `bg` |
| `base-dim` | `gray` or `dim` semantic output | `bg` |
| `thinking-text` | `gray`-family token used for thinking | `bg` |
| `user-message-text` | inherited/default text | `userMessageBg` |
| `custom-message-text` | inherited/default text | `customMessageBg` |
| `tool-output-pending` | `fg` / `toolOutput` | `toolPendingBg` |
| `tool-output-success` | `fg` / `toolOutput` | `toolSuccessBg` |
| `tool-output-error` | `fg` / `toolOutput` | `toolErrorBg` |
| `tool-diff-context-pending` | `gray` / `toolDiffContext` | `toolPendingBg` |
| `tool-diff-context-success` | `gray` / `toolDiffContext` | `toolSuccessBg` |
| `tool-diff-context-error` | `gray` / `toolDiffContext` | `toolErrorBg` |
| `md-link-on-base` | `secondary` / `mdLink` | `bg` |
| `md-url-on-base` | `gray` / `mdLinkUrl` | `bg` |
| `md-quote-on-base` | `gray` / `mdQuote` | `bg` |
| `syntax-comment-on-panel` | `gray` / `syntaxComment` | representative code surface |

Notes:

- For tokens that inherit terminal foreground in pi, validation must use the actual exported foreground or the intended terminal foreground baseline.
- If a pair is not currently rendered anywhere in the preview or pi source, it should not be included just because the token exists.

### Phase 2: Introduce structured thresholds

Replace implicit thresholds with named constants, for example:

```py
SEMANTIC_HUE_MIN = 25
GRAY_CONTRAST_HARD = 35
GRAY_CONTRAST_WARN = 42
SURFACE_CONTRAST_HARD = 40
SURFACE_CONTRAST_WARN = 45
```

Exact values can be tuned after matrix review, but they must be attached to the specific class of check.

### Phase 3: Emit structured diagnostics

Change validation output from theme-level generic warnings like:

- `WARN lovelace-semantic: dim/gray contrast 40 (<42)`

to pair-specific diagnostics like:

- `WARN lovelace-semantic: toolDiffContext on toolPendingBg contrast 39 (<45)`
- `WARN mellow-semantic: thinkingText on bg contrast 40 (<42)`

This makes remediation possible without guessing.

### Phase 4: Review generation policy

After surface-aware validation exists, review whether the current gray derivation policy still makes sense.

Specifically:

- keep or revise `ensure_contrast(gray, bg, 40)`
- decide whether warning-band themes should stay where they are
- determine whether a softening helper such as `cap_contrast()` is actually needed

If `cap_contrast()` is not used after this review, remove it.

### Phase 5: Revalidate the three warning themes

Reassess:

- `later-this-evening-semantic`
- `lovelace-semantic`
- `mellow-semantic`

Questions to answer:

1. Are they only weak on base background, or also weak on real rendered surfaces?
2. If weak on real surfaces, should the gray token be adjusted again?
3. If only weak on base background but acceptable on actual surfaces, should the warning logic be narrowed?

## Proposed file changes

Expected primary file:

- `scripts/generate-pi-themes.py`

Possible documentation updates after implementation:

- `README.md` if validation behavior changes in a user-visible way
- `CHANGELOG.md`

## Acceptance criteria

Implementation is complete when all of the following are true:

- validation uses a named surface matrix instead of only `gray` vs `bg`
- diagnostics identify exact token/surface pairs
- semantic hue collisions remain hard failures
- warning and failure thresholds are explicit constants
- unused `cap_contrast()` is either removed or used in a documented derivation step
- the current three warning themes are evaluated against the new matrix
- validator output remains understandable in CLI use

## Risks

### Risk: overfitting to the current preview

The preview tool is helpful, but validation should be grounded in actual pi token usage, not just the current preview composition.

Mitigation:
- derive the matrix from confirmed token/surface usage in pi source
- keep preview and validation aligned, but do not let preview define the whole policy

### Risk: too many warnings

A broad matrix may produce noisy results.

Mitigation:
- start with a minimal set of real, high-value pairs
- add pairs only when they correspond to actual rendering paths

### Risk: hidden inherited-text assumptions

Some tokens inherit terminal foreground rather than specifying a fixed color.

Mitigation:
- make inherited-text handling explicit in the matrix
- document the assumed foreground baseline for those checks

## Recommended implementation order

1. Add the validation matrix abstraction.
2. Convert existing gray validation to pair-specific checks.
3. Update CLI reporting format.
4. Remove or integrate `cap_contrast()`.
5. Re-evaluate the three warning themes.
6. Document the final policy.

## Decision note

The current uncommitted changes are directionally correct in intent, but only partially implemented. The proper next step is to complete the model with surface-aware validation before committing additional gray tuning changes.
