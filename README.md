# release-notes

A small Node + TypeScript CLI that turns the commits and merged PRs since your last tag into two files:

- `CHANGELOG.md`: a new dated section is prepended, grouped by Conventional Commit type. Existing content is never overwritten.
- `RELEASE_NOTES.md`: friendlier wording for users, with no `feat:`/`fix:` prefixes or scopes, and maintenance commits left out.

Groups: **New** (feat), **Fixed** (fix), **Changed** (refactor, perf), **Docs** (docs) and **Other**. Each item links to its PR when one is known.
No AI is needed. An optional `--ai` flag polishes the release notes with a local [Ollama](https://ollama.com) server.

## Install

Needs Node 20+ and git. `gh` (logged in) is optional and adds PR numbers, titles and links.
There are no runtime dependencies.

```sh
git clone https://github.com/mogesjohnson/release-notes
cd release-notes
npm ci
npm run build
npm link        # optional: puts release-notes on your PATH
```

## Usage

Run it from the root of the repo you are releasing:

```sh
release-notes                       # since the last tag (or all commits if there is none) to HEAD
release-notes --from v1.2.0 --to v1.3.0
release-notes --dry-run             # print both files, write nothing
release-notes --ai --model llama3.1
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--from <tag>` | last tag before `--to` | Start after this ref. With no tags, all commits are read. |
| `--to <ref>` | `HEAD` | End ref. A version-like ref (`v1.3.0`) becomes the section title; otherwise "Unreleased". |
| `--repo <owner/name>` | from the `origin` remote | GitHub repo for PR lookups. |
| `--ai` | off | Polish `RELEASE_NOTES.md` with Ollama. |
| `--model <name>` | `llama3.1` | Ollama model for `--ai`. |
| `--dry-run` | off | Print instead of writing files. |

### How PRs are found

`git log` gives the commits in the range. When `gh` is available, `gh pr list --state merged` maps merge commits to PRs,
and every commit a merge brought in is linked to that PR. Squash-merged subjects ending in `(#N)` and
`Merge pull request #N` subjects are linked even without `gh`. Commits with no PR link to their short sha.

### The --ai fallback

`--ai` sends only the plain release notes to `http://localhost:11434/api/generate` (override with `OLLAMA_URL`).
The reply is used only if it keeps every PR and commit link. If Ollama is not running, errors, times out (60 s) or
returns something unusable, the tool prints one warning and writes the plain notes. It never fails the run:

```text
release-notes: warning: --ai skipped (fetch failed); using plain notes
```

## GitHub Actions example

[`examples/release.yml`](examples/release.yml) runs on a `v*` tag push: it checks out full history, builds this CLI,
writes the notes since the previous tag and calls `gh release create --notes-file RELEASE_NOTES.md`.
It is an example, not active CI here. Copy it to `.github/workflows/` in your own repo to use it.

## Example

Real output from running the tool against a clone of
[mogesjohnson/BEST-OF-AI-DEV](https://github.com/mogesjohnson/BEST-OF-AI-DEV) on 2026-10-25, for the PRs after #41:

```sh
cd BEST-OF-AI-DEV
release-notes --from 5bb5db1 --dry-run
```

````markdown
<!-- CHANGELOG.md (new section) -->

## Unreleased - 2026-10-25

### New

- **site:** add open graph and twitter share image ([#45](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/45))
- **site:** add a hero banner to the docs home page ([#45](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/45))

### Docs

- **rules:** make the template's R6 link a placeholder ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- **practices:** describe what the template ci.yml runs ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- **readme:** list #24 and #8 to #11 under known gaps ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- **agents:** trim AGENTS.md to the 70-line limit ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))

### Other

- **site:** deploy the docs site to github pages ([#44](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/44))
- **site:** turn off Next.js telemetry in the site build ([#43](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/43))
- **agents:** keep AGENTS.md at or under 70 lines ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))

<!-- RELEASE_NOTES.md -->

# Release notes: Unreleased

## What's new

- Add open graph and twitter share image. ([#45](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/45))
- Add a hero banner to the docs home page. ([#45](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/45))

## Documentation

- Make the template's R6 link a placeholder. ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- Describe what the template ci.yml runs. ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- List #24 and #8 to #11 under known gaps. ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
- Trim AGENTS.md to the 70-line limit. ([#42](https://github.com/mogesjohnson/BEST-OF-AI-DEV/pull/42))
````

## Development

See [AGENTS.md](AGENTS.md) and [RULES.md](RULES.md). Build with `npm run build` (tsc).
PRs are merged with a merge commit, never squashed.

## License

MIT, (c) 2026 Moges Johnson. See [LICENSE](LICENSE).
