# 0001: release-notes CLI

## Goal
A CLI that turns the commits and merged PRs since the last tag into CHANGELOG.md and RELEASE_NOTES.md.

## Acceptance criteria
- `release-notes [--from <tag>] [--to <ref>] [--repo <owner/name>] [--ai] [--model <m>] [--dry-run]`.
- Reads commits since the last tag (all commits when there is no tag) with `git log`.
- Maps commits to merged PRs (number, title, URL) with `gh` when it is available.
- Groups by Conventional Commit type: New (feat), Fixed (fix), Changed (refactor/perf), Docs (docs), Other.
- Prepends a dated section to CHANGELOG.md, never overwriting it; writes RELEASE_NOTES.md without type prefixes.
- `--ai` polishes RELEASE_NOTES.md with local Ollama and falls back with one warning on any error.
- No runtime dependencies; `npm run build` (tsc) passes.
- `examples/release.yml` shows a tag-push release workflow (not active CI).

## Out of scope
Tests beyond running the tool on two local clones; publishing to npm.
