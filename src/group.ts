import { type Commit, type Exec, type PullRequest, mergedShas, run } from './git.js';

export type Section = 'New' | 'Fixed' | 'Changed' | 'Docs' | 'Other';
export const SECTIONS: Section[] = ['New', 'Fixed', 'Changed', 'Docs', 'Other'];

export interface Item {
  sha: string;
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  subject: string;
  pr?: PullRequest;
}

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i;
const MERGE_PR = /^Merge pull request #(\d+) from \S+/;
const SQUASH_PR = /\(#(\d+)\)\s*$/;

export function sectionFor(type: string): Section {
  switch (type) {
    case 'feat': return 'New';
    case 'fix': return 'Fixed';
    case 'refactor':
    case 'perf': return 'Changed';
    case 'docs': return 'Docs';
    default: return 'Other';
  }
}

/** A Conventional Commits breaking-change footer: uppercase, at the start of a line. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

export function parseSubject(subject: string): Omit<Item, 'sha' | 'pr'> {
  const clean = subject.replace(SQUASH_PR, '').trim();
  const m = clean.match(CONVENTIONAL);
  if (!m) return { type: 'other', breaking: false, description: clean, subject };
  return { type: m[1].toLowerCase(), scope: m[2], breaking: Boolean(m[3]), description: m[4], subject };
}

function prUrl(repo: string | undefined, n: number): string {
  return repo ? `https://github.com/${repo}/pull/${n}` : `#${n}`;
}

/**
 * Turns commits into items linked to PRs. Merge commits are not items: they only
 * tell us which PR the commits they brought in belong to. `exec` runs git (tests pass a fake).
 */
export function buildItems(cwd: string, commits: Commit[], prs: Map<string, PullRequest>, repo?: string, exec: Exec = run): Item[] {
  const owner = new Map<string, PullRequest>();
  for (const c of commits) {
    if (c.parents.length < 2) continue;
    const m = c.subject.match(MERGE_PR);
    const pr = prs.get(c.sha) ?? (m ? { number: Number(m[1]), title: c.body.split('\n')[0] || c.subject, url: prUrl(repo, Number(m[1])) } : undefined);
    if (!pr) continue;
    for (const sha of mergedShas(cwd, c, exec)) if (!owner.has(sha)) owner.set(sha, pr);
  }
  const items: Item[] = [];
  for (const c of commits) {
    if (c.parents.length > 1) continue;
    const parsed = parseSubject(c.subject);
    const squash = c.subject.match(SQUASH_PR);
    const pr = prs.get(c.sha) ?? owner.get(c.sha) ?? (squash ? { number: Number(squash[1]), title: parsed.description, url: prUrl(repo, Number(squash[1])) } : undefined);
    items.push({ sha: c.sha, ...parsed, breaking: parsed.breaking || BREAKING_FOOTER.test(c.body), pr });
  }
  return items;
}

export function groupItems(items: Item[]): Map<Section, Item[]> {
  const groups = new Map<Section, Item[]>(SECTIONS.map((s) => [s, []]));
  for (const item of items) groups.get(sectionFor(item.type))!.push(item);
  return groups;
}
