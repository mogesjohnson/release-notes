#!/usr/bin/env node
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectRepo, ghAvailable, lastTag, mergedPrs, readCommits } from './git.js';
import { buildItems, groupItems } from './group.js';
import { prependChangelog, renderChangelogSection, renderReleaseNotes } from './render.js';

export interface Options {
  from?: string;
  to: string;
  repo?: string;
  ai: boolean;
  model: string;
  dryRun: boolean;
  cwd: string;
}

const USAGE = `usage: release-notes [--from <tag>] [--to <ref>] [--repo <owner/name>] [--ai] [--model <name>] [--dry-run]

  --from <tag>          start after this ref (default: last tag before --to, or all commits)
  --to <ref>            end ref (default: HEAD)
  --repo <owner/name>   GitHub repo for PR lookups (default: from the origin remote)
  --ai                  polish RELEASE_NOTES.md with a local Ollama server (off by default)
  --model <name>        Ollama model for --ai (default: llama3.1)
  --dry-run             print both files instead of writing them
  -h, --help            show this help`;

export function parseArgs(argv: string[]): Options {
  const o: Options = { to: 'HEAD', ai: false, model: 'llama3.1', dryRun: false, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--from') o.from = value();
    else if (a === '--to') o.to = value();
    else if (a === '--repo') o.repo = value();
    else if (a === '--model') o.model = value();
    else if (a === '--ai') o.ai = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export async function main(argv: string[]): Promise<number> {
  let o: Options;
  try {
    o = parseArgs(argv);
  } catch (err) {
    console.error(`release-notes: ${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const from = o.from ?? lastTag(o.cwd, o.to);
  const repo = o.repo ?? detectRepo(o.cwd);
  const commits = readCommits(o.cwd, from, o.to);
  const prs = repo && ghAvailable(o.cwd) ? mergedPrs(o.cwd, repo) : new Map();
  const groups = groupItems(buildItems(o.cwd, commits, prs, repo));
  const version = /^v?\d/.test(o.to) ? o.to : 'Unreleased';
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const section = renderChangelogSection(version, date, groups);
  const notes = renderReleaseNotes(version, groups);
  console.error(`release-notes: ${commits.length} commits${from ? ` since ${from}` : ''}, ${prs.size} merged PRs known${repo ? ` (${repo})` : ''}`);
  if (o.dryRun) {
    console.log(`<!-- CHANGELOG.md (new section) -->\n\n${section}\n<!-- RELEASE_NOTES.md -->\n\n${notes}`);
    return 0;
  }
  prependChangelog(join(o.cwd, 'CHANGELOG.md'), section);
  writeFileSync(join(o.cwd, 'RELEASE_NOTES.md'), notes);
  console.error('release-notes: wrote CHANGELOG.md and RELEASE_NOTES.md');
  return 0;
}

// Run when executed directly or through the npm bin symlink.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(`release-notes: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
