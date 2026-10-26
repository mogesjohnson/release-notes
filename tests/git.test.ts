import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { detectRepo, ghAvailable, lastTag, mergedPrs, mergedShas, readCommits, run } from '../src/git.js';
import { commit, failingExec, fakeExec, sha } from './helpers.js';

describe('readCommits', () => {
  // Exactly what `git log --format=%H%x00%P%x00%s%x00%b%x1e` prints: one record per
  // commit, a newline between records, and a body that may span lines or be empty.
  const log = [
    `${sha('c')}\0${sha('a')} ${sha('b')}\0Merge pull request #2 from octo/x\0feat: x\n\x1e`,
    `\n${sha('b')}\0${sha('a')}\0feat(cli)!: new flag\0Longer body.\n\nBREAKING CHANGE: --old is gone\n\x1e`,
    `\n${sha('a')}\0\0chore: init\0\x1e\n`,
  ].join('');

  test('splits records into sha, parents, subject and trimmed body', () => {
    const exec = fakeExec(() => log);
    assert.deepEqual(readCommits('/r', 'v1.0.0', 'HEAD', exec), [
      { sha: sha('c'), parents: [sha('a'), sha('b')], subject: 'Merge pull request #2 from octo/x', body: 'feat: x' },
      { sha: sha('b'), parents: [sha('a')], subject: 'feat(cli)!: new flag', body: 'Longer body.\n\nBREAKING CHANGE: --old is gone' },
      { sha: sha('a'), parents: [], subject: 'chore: init', body: '' },
    ]);
  });

  test('uses from..to, or just `to` when there is no tag', () => {
    const exec = fakeExec(() => '');
    readCommits('/r', 'v1.0.0', 'v1.1.0', exec);
    readCommits('/r', undefined, 'HEAD', exec);
    assert.deepEqual(exec.calls.map((c) => [c.cmd, c.args.at(-1), c.cwd]), [['git', 'v1.0.0..v1.1.0', '/r'], ['git', 'HEAD', '/r']]);
  });

  test('an empty range gives no commits', () => {
    assert.deepEqual(readCommits('/r', 'v1', 'v1', fakeExec(() => '')), []);
  });

  test('a git failure (bad ref) is not swallowed', () => {
    assert.throws(() => readCommits('/r', 'nope', 'HEAD', failingExec), /command failed/);
  });
});

describe('lastTag', () => {
  // A fake git with tags v1.0.0 on commit 1 and v1.1.0 on commit 2; HEAD is commit 3.
  const commits: Record<string, string> = { 'v1.0.0': sha('1'), 'v1.1.0': sha('2'), 'v1.1.0^': sha('1'), HEAD: sha('3'), 'HEAD^': sha('2') };
  const nearest: Record<string, string> = { [sha('3')]: 'v1.1.0', [sha('2')]: 'v1.1.0', [sha('1')]: 'v1.0.0' };
  const repo = (tagged = true) => fakeExec(({ args }) => {
    const ref = args.at(-1)!.replace(/\^\{commit\}$/, '');
    const c = commits[ref];
    if (!c) throw new Error(`unknown ref ${ref}`);
    if (args[0] === 'rev-parse') return `${c}\n`;
    if (!tagged || !nearest[c]) throw new Error('no names found');
    return `${nearest[c]}\n`;
  });

  test('returns the newest tag when `ref` itself is not tagged', () => {
    const exec = repo();
    assert.equal(lastTag('/r', 'HEAD', exec), 'v1.1.0');
    assert.deepEqual(exec.calls[0].args, ['describe', '--tags', '--abbrev=0', 'HEAD']);
  });

  test('skips a tag on `ref` itself and returns the one before it', () => {
    assert.equal(lastTag('/r', 'v1.1.0', repo()), 'v1.0.0');
  });

  test('is undefined when the only tag is on `ref`', () => {
    assert.equal(lastTag('/r', 'v1.0.0', repo()), undefined);
  });

  test('is undefined when the repo has no tags', () => {
    assert.equal(lastTag('/r', 'HEAD', repo(false)), undefined);
    assert.equal(lastTag('/r', 'HEAD', failingExec), undefined);
    assert.equal(lastTag('/r', 'HEAD', fakeExec(() => '\n')), undefined);
  });
});

describe('lastTag with real git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-git-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'tag.gpgSign=false', '-c', 'commit.gpgSign=false', ...args], dir);
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'feat: first');
  git('tag', 'v1.0.0');
  git('commit', '-q', '--allow-empty', '-m', 'fix: second');
  git('tag', 'v1.1.0');

  test('--to a tag reads the commits since the previous tag', () => {
    assert.equal(lastTag(dir, 'v1.1.0'), 'v1.0.0');
    assert.deepEqual(readCommits(dir, lastTag(dir, 'v1.1.0'), 'v1.1.0').map((c) => c.subject), ['fix: second']);
  });

  test('a tagged HEAD also starts after the previous tag', () => {
    assert.equal(lastTag(dir, 'HEAD'), 'v1.0.0');
  });

  test('the first tag has no tag before it, so every commit is read', () => {
    assert.equal(lastTag(dir, 'v1.0.0'), undefined);
  });
});

describe('detectRepo', () => {
  const cases: Array<[string, string | undefined]> = [
    ['https://github.com/octo/app.git', 'octo/app'],
    ['https://github.com/octo/app', 'octo/app'],
    ['git@github.com:octo/app.git', 'octo/app'],
    ['ssh://git@github.com/octo/my.app.git', 'octo/my.app'],
    ['https://gitlab.com/octo/app.git', undefined],
  ];
  for (const [url, want] of cases) {
    test(`${url} -> ${want}`, () => assert.equal(detectRepo('/r', fakeExec(() => `${url}\n`)), want));
  }

  test('is undefined with no origin remote', () => {
    assert.equal(detectRepo('/r', failingExec), undefined);
  });
});

describe('ghAvailable', () => {
  test('true when `gh auth status` succeeds, false when it fails', () => {
    const ok = fakeExec(() => 'Logged in');
    assert.equal(ghAvailable('/r', ok), true);
    assert.deepEqual([ok.calls[0].cmd, ...ok.calls[0].args], ['gh', 'auth', 'status']);
    assert.equal(ghAvailable('/r', failingExec), false);
  });
});

describe('mergedPrs', () => {
  test('keys merged PRs by merge commit sha and skips PRs without one', () => {
    const json = JSON.stringify([
      { number: 3, title: 'Docs', url: 'https://github.com/octo/app/pull/3', mergeCommit: { oid: sha('3') } },
      { number: 2, title: 'No merge commit', url: 'https://github.com/octo/app/pull/2', mergeCommit: null },
      { number: 1, title: 'Core', url: 'https://github.com/octo/app/pull/1', mergeCommit: { oid: sha('1') } },
    ]);
    const exec = fakeExec(() => json);
    const prs = mergedPrs('/r', 'octo/app', 50, exec);
    assert.deepEqual([...prs.entries()], [
      [sha('3'), { number: 3, title: 'Docs', url: 'https://github.com/octo/app/pull/3' }],
      [sha('1'), { number: 1, title: 'Core', url: 'https://github.com/octo/app/pull/1' }],
    ]);
    assert.deepEqual([exec.calls[0].cmd, ...exec.calls[0].args], [
      'gh', 'pr', 'list', '--repo', 'octo/app', '--state', 'merged', '--limit', '50', '--json', 'number,title,url,mergeCommit',
    ]);
  });

  test('defaults to a 500 PR limit', () => {
    const exec = fakeExec(() => '[]');
    mergedPrs('/r', 'octo/app', undefined, exec);
    assert.equal(exec.calls[0].args[exec.calls[0].args.indexOf('--limit') + 1], '500');
  });

  test('is empty when gh fails or prints nothing', () => {
    assert.equal(mergedPrs('/r', 'octo/app', 500, failingExec).size, 0);
    assert.equal(mergedPrs('/r', 'octo/app', 500, fakeExec(() => '')).size, 0);
  });
});

describe('mergedShas', () => {
  test('lists first-parent..second-parent for a merge commit', () => {
    const exec = fakeExec(() => `${sha('2')}\n${sha('1')}\n`);
    assert.deepEqual(mergedShas('/r', commit(sha('m'), 'Merge', { parents: [sha('0'), sha('2')] }), exec), [sha('2'), sha('1')]);
    assert.deepEqual(exec.calls[0].args, ['rev-list', `${sha('0')}..${sha('2')}`]);
  });

  test('is empty for a normal commit and never runs git', () => {
    const exec = fakeExec(() => assert.fail('should not run'));
    assert.deepEqual(mergedShas('/r', commit(sha('a'), 'feat: x'), exec), []);
  });

  test('is empty when rev-list fails', () => {
    assert.deepEqual(mergedShas('/r', commit(sha('m'), 'Merge', { parents: [sha('0'), sha('1')] }), failingExec), []);
  });
});
