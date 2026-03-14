# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Repository purpose

This repository publishes curated dark terminal themes for pi, adapted from iTerm2-Color-Schemes.

Current package:
- `@victor/pi-curated-themes`

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

## Theme change policy

When editing themes:
- Keep theme names stable unless the user explicitly requests a rename.
- Treat visual tuning and readability fixes as patch-level changes.
- Treat new theme variants as minor-level changes.
- Treat renames, removals, or package structure changes as major-level changes.
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

## Validation

Before committing:

```bash
jq empty themes/*.json
python3 scripts/generate-pi-themes.py --validate
```
