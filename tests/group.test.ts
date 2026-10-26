import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PullRequest } from '../src/git.js';
import { SECTIONS, buildItems, groupItems, parseSubject, sectionFor, type Item } from '../src/group.js';
import { commit, failingExec, fakeExec, sha } from './helpers.js';

describe('parseSubject', () => {
  test('reads type, scope and description', () => {
    assert.deepEqual(parseSubject('feat(cli): add --dry-run'), {
      type: 'feat', scope: 'cli', breaking: false, description: 'add --dry-run', subject: 'feat(cli): add --dry-run',
    });
  });

  test('scope is optional', () => {
    const p = parseSubject('fix: handle empty ranges');
    assert.equal(p.type, 'fix');
    assert.equal(p.scope, undefined);
    assert.equal(p.description, 'handle empty ranges');
  });

  test('"!" before the colon marks a breaking change, with or without a scope', () => {
    assert.equal(parseSubject('feat!: drop node 18').breaking, true);
    const scoped = parseSubject('refactor(api)!: rename the export');
    assert.equal(scoped.breaking, true);
    assert.equal(scoped.scope, 'api');
    assert.equal(scoped.description, 'rename the export');
  });

  test('the type is lowercased, the scope is kept as written', () => {
    const p = parseSubject('Feat(CLI): shout');
    assert.equal(p.type, 'feat');
    assert.equal(p.scope, 'CLI');
  });

  test('scopes may contain slashes, dots and dashes', () => {
    assert.equal(parseSubject('fix(api/auth-v2.1): retry').scope, 'api/auth-v2.1');
  });

  test('a squash-merge "(#N)" suffix is stripped from the description', () => {
    const p = parseSubject('feat(ai): polish notes (#12)');
    assert.equal(p.description, 'polish notes');
    assert.equal(p.subject, 'feat(ai): polish notes (#12)');
  });

  test('non-conventional subjects become type "other" and keep their text', () => {
    for (const s of ['Update README.md', 'WIP', 'feat:no space after the colon', 'feat(): empty scope', '[skip ci] bump']) {
      const p = parseSubject(s);
      assert.equal(p.type, 'other', s);
      assert.equal(p.breaking, false, s);
      assert.equal(p.scope, undefined, s);
      assert.equal(p.description, s, s);
    }
  });

  test('a non-conventional squash subject still drops the "(#N)" suffix', () => {
    assert.equal(parseSubject('Bump deps (#7)').description, 'Bump deps');
  });
});

describe('sectionFor', () => {
  test('maps Conventional Commit types to sections', () => {
    assert.equal(sectionFor('feat'), 'New');
    assert.equal(sectionFor('fix'), 'Fixed');
    assert.equal(sectionFor('refactor'), 'Changed');
    assert.equal(sectionFor('perf'), 'Changed');
    assert.equal(sectionFor('docs'), 'Docs');
    for (const t of ['chore', 'ci', 'build', 'test', 'style', 'revert', 'other', 'unknown']) assert.equal(sectionFor(t), 'Other', t);
  });
});

describe('groupItems', () => {
  const item = (s: string, subject: string): Item => ({ sha: sha(s), ...parseSubject(subject) });

  test('returns every section in display order, even empty ones', () => {
    const groups = groupItems([]);
    assert.deepEqual([...groups.keys()], SECTIONS);
    assert.deepEqual(SECTIONS, ['New', 'Fixed', 'Changed', 'Docs', 'Other']);
    for (const s of SECTIONS) assert.deepEqual(groups.get(s), []);
  });

  test('puts each item in its section and keeps input order inside a section', () => {
    const items = [
      item('1', 'fix: b'), item('2', 'feat: a'), item('3', 'docs: d'), item('4', 'feat: c'),
      item('5', 'perf: p'), item('6', 'chore: x'), item('7', 'random words'), item('8', 'refactor: r'),
    ];
    const groups = groupItems(items);
    const subjects = (s: (typeof SECTIONS)[number]) => groups.get(s)!.map((i) => i.subject);
    assert.deepEqual(subjects('New'), ['feat: a', 'feat: c']);
    assert.deepEqual(subjects('Fixed'), ['fix: b']);
    assert.deepEqual(subjects('Changed'), ['perf: p', 'refactor: r']);
    assert.deepEqual(subjects('Docs'), ['docs: d']);
    assert.deepEqual(subjects('Other'), ['chore: x', 'random words']);
  });
});

describe('buildItems: PR mapping', () => {
  const repo = 'octo/app';
  const pr = (number: number, title = `PR ${number}`): PullRequest => ({ number, title, url: `https://github.com/${repo}/pull/${number}` });

  test('a commit whose sha gh reported as a merge commit gets that PR', () => {
    const prs = new Map([[sha('a'), pr(5)]]);
    const items = buildItems('/repo', [commit(sha('a'), 'feat: squashed')], prs, repo, failingExec);
    assert.deepEqual(items[0].pr, pr(5));
  });

  test('commits brought in by a merge commit belong to its PR (from gh)', () => {
    const merge = commit(sha('m'), 'Merge pull request #9 from octo/topic', { parents: [sha('0'), sha('2')], body: 'feat: topic' });
    const exec = fakeExec(({ cmd, args }) => {
      assert.equal(cmd, 'git');
      assert.deepEqual(args, ['rev-list', `${sha('0')}..${sha('2')}`]);
      return `${sha('2')}\n${sha('1')}\n`;
    });
    const prs = new Map([[sha('m'), pr(9, 'From gh')]]);
    const items = buildItems('/repo', [merge, commit(sha('2'), 'feat: two'), commit(sha('1'), 'fix: one')], prs, repo, exec);
    assert.equal(exec.calls.length, 1);
    assert.equal(exec.calls[0].cwd, '/repo');
    assert.deepEqual(items.map((i) => i.sha), [sha('2'), sha('1')], 'the merge commit itself is not an item');
    assert.deepEqual(items.map((i) => i.pr?.title), ['From gh', 'From gh']);
  });

  test('without gh, a "Merge pull request #N" subject still links its commits', () => {
    const merge = commit(sha('m'), 'Merge pull request #3 from octo/docs', { parents: [sha('0'), sha('1')], body: 'docs(readme): usage\n\nmore' });
    const exec = fakeExec(() => `${sha('1')}\n`);
    const items = buildItems('/repo', [merge, commit(sha('1'), 'docs(readme): usage')], new Map(), repo, exec);
    assert.deepEqual(items[0].pr, { number: 3, title: 'docs(readme): usage', url: 'https://github.com/octo/app/pull/3' });
  });

  test('without a repo the PR link is a bare "#N"', () => {
    const items = buildItems('/repo', [commit(sha('a'), 'fix: x (#41)')], new Map(), undefined, failingExec);
    assert.deepEqual(items[0].pr, { number: 41, title: 'x', url: '#41' });
  });

  test('a squash "(#N)" subject links to PR N when gh does not know the commit', () => {
    const items = buildItems('/repo', [commit(sha('a'), 'feat(ai): polish (#12)')], new Map(), repo, failingExec);
    assert.deepEqual(items[0].pr, { number: 12, title: 'polish', url: 'https://github.com/octo/app/pull/12' });
  });

  test('gh data wins over the "(#N)" suffix', () => {
    const prs = new Map([[sha('a'), pr(13, 'Real title')]]);
    const items = buildItems('/repo', [commit(sha('a'), 'feat: x (#12)')], prs, repo, failingExec);
    assert.equal(items[0].pr?.number, 13);
  });

  test('merges that are not PRs link nothing and never call git', () => {
    const merge = commit(sha('m'), "Merge branch 'main' into topic", { parents: [sha('0'), sha('1')] });
    const exec = fakeExec(() => assert.fail('git should not run for a non-PR merge'));
    const items = buildItems('/repo', [merge, commit(sha('1'), 'chore: tidy')], new Map(), repo, exec);
    assert.equal(items.length, 1);
    assert.equal(items[0].pr, undefined);
  });

  test('a failing rev-list leaves the commits unlinked instead of throwing', () => {
    const merge = commit(sha('m'), 'Merge pull request #2 from octo/x', { parents: [sha('0'), sha('1')] });
    const items = buildItems('/repo', [merge, commit(sha('1'), 'feat: y')], new Map(), repo, failingExec);
    assert.equal(items[0].pr, undefined);
  });

  test('a commit in two merges keeps the newest merge (listed first)', () => {
    const newer = commit(sha('n'), 'Merge pull request #8 from octo/b', { parents: [sha('0'), sha('1')] });
    const older = commit(sha('o'), 'Merge pull request #7 from octo/a', { parents: [sha('2'), sha('1')] });
    const exec = fakeExec(() => `${sha('1')}\n`);
    const items = buildItems('/repo', [newer, older, commit(sha('1'), 'feat: shared')], new Map(), repo, exec);
    assert.equal(items[0].pr?.number, 8);
  });

  test('commits with no PR at all have pr undefined and keep parsed fields', () => {
    const items = buildItems('/repo', [commit(sha('a'), 'perf(git)!: batch calls')], new Map(), repo, failingExec);
    assert.deepEqual(items[0], {
      sha: sha('a'), type: 'perf', scope: 'git', breaking: true, description: 'batch calls', subject: 'perf(git)!: batch calls', pr: undefined,
    });
  });
});

describe('buildItems: BREAKING CHANGE footer', () => {
  const one = (subject: string, body: string) => buildItems('/repo', [commit(sha('a'), subject, { body })], new Map(), undefined, failingExec)[0];

  test('a "BREAKING CHANGE:" footer marks the item breaking', () => {
    const item = one('feat(cli): read config from a file', 'Adds --config.\n\nBREAKING CHANGE: --cwd is now --dir');
    assert.equal(item.breaking, true);
    assert.equal(item.description, 'read config from a file');
  });

  test('the "BREAKING-CHANGE:" spelling counts too', () => {
    assert.equal(one('fix: drop node 18', 'BREAKING-CHANGE: node 20 is required').breaking, true);
  });

  test('a squash body that carries the footer of one of its commits counts', () => {
    assert.equal(one('feat: new flags (#12)', '* feat: a\n\n* feat: b\n\nBREAKING CHANGE: b renames --x').breaking, true);
  });

  test('a lowercase footer or a mention mid-line does not count', () => {
    assert.equal(one('fix: a', 'breaking change: no').breaking, false);
    assert.equal(one('fix: b', 'This is not a BREAKING CHANGE: just a note.').breaking, false);
    assert.equal(one('fix: c', '').breaking, false);
  });
});
