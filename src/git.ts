import { execFileSync } from 'node:child_process';

export interface Commit {
  sha: string;
  subject: string;
  body: string;
  parents: string[];
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function tryRun(cmd: string, args: string[], cwd: string): string | undefined {
  try {
    return run(cmd, args, cwd);
  } catch {
    return undefined;
  }
}

/** The newest tag reachable from `ref`, or undefined when the repo has no tags. */
export function lastTag(cwd: string, ref: string): string | undefined {
  return tryRun('git', ['describe', '--tags', '--abbrev=0', ref], cwd)?.trim() || undefined;
}

/** Commits in from..to (or all of `to` when `from` is undefined), newest first. */
export function readCommits(cwd: string, from: string | undefined, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to;
  const out = run('git', ['log', '--format=%H%x00%P%x00%s%x00%b%x1e', range], cwd);
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.includes('\0'))
    .map((r) => {
      const [sha, parents, subject, body] = r.split('\0');
      return { sha, parents: parents.split(' ').filter(Boolean), subject, body: body.trim() };
    });
}

/** "owner/name" from the origin remote, if it points at GitHub. */
export function detectRepo(cwd: string): string | undefined {
  const url = tryRun('git', ['remote', 'get-url', 'origin'], cwd)?.trim();
  const m = url?.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
  return m?.[1];
}

export function ghAvailable(cwd: string): boolean {
  return tryRun('gh', ['auth', 'status'], cwd) !== undefined;
}

/** Merged PRs keyed by merge commit sha. Empty when gh is missing or the call fails. */
export function mergedPrs(cwd: string, repo: string, limit = 500): Map<string, PullRequest> {
  const map = new Map<string, PullRequest>();
  const out = tryRun('gh', ['pr', 'list', '--repo', repo, '--state', 'merged', '--limit', String(limit), '--json', 'number,title,url,mergeCommit'], cwd);
  if (!out) return map;
  for (const pr of JSON.parse(out) as Array<PullRequest & { mergeCommit?: { oid: string } }>) {
    if (pr.mergeCommit?.oid) map.set(pr.mergeCommit.oid, { number: pr.number, title: pr.title, url: pr.url });
  }
  return map;
}

/** Shas that a merge commit brought in: everything in first-parent..second-parent. */
export function mergedShas(cwd: string, merge: Commit): string[] {
  if (merge.parents.length < 2) return [];
  return tryRun('git', ['rev-list', `${merge.parents[0]}..${merge.parents[1]}`], cwd)?.split('\n').filter(Boolean) ?? [];
}
