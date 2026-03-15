# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Repository purpose

This repository publishes curated dark terminal themes for pi, adapted from iTerm2-Color-Schemes.

Current package:
- `@victor-software-house/pi-curated-themes`

## Upstream source

Color palettes come from [mbadolato/iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) (MIT licensed).

### Local checkout

The generation script reads `.itermcolors` files from:

```
.upstream/iTerm2-Color-Schemes/schemes/
```

Fetch or update with:

```bash
bash scripts/fetch-upstream.sh
```

This directory is gitignored. The upstream repo is not a submodule — it is a shallow clone fetched on demand.

### Curation list

`curated.toml` contains the list of theme names to generate. Names must match the upstream `schemes/` directory exactly (without `.itermcolors` extension). To add or remove themes, edit this file and regenerate.

### Roadmap

`ROADMAP.md` tracks implemented work, remaining work, and recommended next-session continuation steps.

## Theme change policy

When editing themes:
- Default public theme names are unsuffixed. Do not reintroduce `-semantic` for the default variant.
- Treat visual tuning and readability fixes as patch-level changes.
- Treat new theme variants as minor-level changes.
- Treat renames, removals, or package structure changes as major-level changes unless the user explicitly directs otherwise.
- Preserve the source palette identity unless the task explicitly asks for a different direction.
- Validate all theme JSON files after changes.

## Release policy

This repository uses `release-please` for release automation.

Release flow:
1. Merge changes to `main`.
2. `release-please` opens or updates a release PR.
3. Merge the release PR to create the git tag and GitHub release.

## Commit message policy

Use Conventional Commits:

- `fix:` -> patch
- `feat:` -> minor
- `feat!:` or `BREAKING CHANGE:` -> major
- `docs:` and `chore:` -> no release

## Commit frequency

Commit repository work frequently.

Use these rules:

- Commit after each self-contained documentation, generator, validation, or preview change.
- Do not keep validated work uncommitted while starting the next task.
- If a task has multiple distinct steps, commit after each step that leaves the repository in a coherent passing state.
- Run repository validation before each commit.
- Push completed commits promptly unless the user explicitly asks to keep work local.

## Validation

Before committing:

```bash
jq empty themes/*.json
mise run themes:validate
```

## Task invocation policy

Use mise tasks for repository workflows when a task exists.

Required rules:
- Do not invoke repository workflows through `python`, `python3`, or direct script paths when a matching `mise run` task exists.
- For theme generation, always use `mise run themes:generate`.
- For theme validation, always use `mise run themes:validate`.
- For preview, always use `mise run preview`.

The standalone scripts exist as task implementation details, not the primary documented interface.
