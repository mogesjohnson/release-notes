import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { groupItems, parseSubject, type Item } from '../src/group.js';
import { prependChangelog, renderChangelogSection, renderReleaseNotes } from '../src/render.js';
import { sha } from './helpers.js';

const url = (n: number) => `https://github.com/octo/app/pull/${n}`;
const item = (c: string, subject: string, pr?: number): Item => ({
  sha: sha(c), ...parseSubject(subject), pr: pr ? { number: pr, title: subject, url: url(pr) } : undefined,
});

const groups = groupItems([
  item('a', 'feat(cli): add --dry-run', 4),
  item('b', 'fix: handle empty ranges.'),
  item('c', 'refactor(api)!: rename the export', 5),
  item('d', 'docs(readme): document flags', 6),
  item('e', 'chore(deps): bump typescript'),
  item('f', 'ci: add workflow'),
  item('1', 'Tweak the banner'),
]);

describe('renderChangelogSection', () => {
  test('renders sections in order with scopes, breaking marks and links', () => {
    assert.equal(renderChangelogSection('v1.2.0', '2026-10-25', groups), [
      '## v1.2.0 - 2026-10-25',
      '',
      '### New',
      '',
      `- **cli:** add --dry-run ([#4](${url(4)}))`,
      '',
      '### Fixed',
      '',
      '- handle empty ranges. (bbbbbbb)',
      '',
      '### Changed',
      '',
      `- **BREAKING** **api:** rename the export ([#5](${url(5)}))`,
      '',
      '### Docs',
      '',
      `- **readme:** document flags ([#6](${url(6)}))`,
      '',
      '### Other',
      '',
      '- **deps:** bump typescript (eeeeeee)',
      '- add workflow (fffffff)',
      '- Tweak the banner (1111111)',
      '',
    ].join('\n'));
  });

  test('empty sections are skipped and an empty range says so', () => {
    assert.equal(renderChangelogSection('Unreleased', '2026-01-02', groupItems([])), '## Unreleased - 2026-01-02\n\nNo changes.\n');
    const onlyDocs = renderChangelogSection('v1', 'd', groupItems([item('d', 'docs: x')]));
    assert.doesNotMatch(onlyDocs, /### (New|Fixed|Changed|Other)/);
    assert.match(onlyDocs, /### Docs/);
  });
});

describe('renderReleaseNotes', () => {
  test('uses friendly headings, sentence case and drops maintenance types', () => {
    assert.equal(renderReleaseNotes('v1.2.0', groups), [
      '# Release notes: v1.2.0',
      '',
      "## What's new",
      '',
      `- Add --dry-run. ([#4](${url(4)}))`,
      '',
      '## Bug fixes',
      '',
      '- Handle empty ranges. (bbbbbbb)',
      '',
      '## Improvements',
      '',
      `- Rename the export (breaking change). ([#5](${url(5)}))`,
      '',
      '## Documentation',
      '',
      `- Document flags. ([#6](${url(6)}))`,
      '',
      '## Other changes',
      '',
      '- Tweak the banner. (1111111)',
      '',
    ].join('\n'));
  });

  test('maintenance-only ranges get a one-line note', () => {
    const chores = groupItems(['chore: a', 'ci: b', 'build: c', 'test: d', 'style: e'].map((s, i) => item(String(i), s)));
    assert.equal(renderReleaseNotes('v2', chores), '# Release notes: v2\n\nMaintenance only: no user-facing changes.\n');
    assert.equal(renderReleaseNotes('v2', groupItems([])), '# Release notes: v2\n\nMaintenance only: no user-facing changes.\n');
  });

  test('revert and unknown types stay in Other changes', () => {
    const out = renderReleaseNotes('v3', groupItems([item('1', 'revert: undo x'), item('2', 'wip: y')]));
    assert.match(out, /## Other changes\n\n- Undo x\. \(1111111\)\n- Y\. \(2222222\)\n/);
  });
});

describe('prependChangelog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const section = '## v2 - 2026-10-25\n\n### New\n\n- b\n';

  test('creates the file with a header when it is missing', () => {
    const path = join(dir, 'new.md');
    const out = prependChangelog(path, section);
    assert.equal(out, `# Changelog\n\nAll notable changes to this project are listed here, newest first.\n\n${section}`);
    assert.equal(readFileSync(path, 'utf8'), out);
  });

  test('treats a blank file like a missing one', () => {
    const path = join(dir, 'blank.md');
    writeFileSync(path, '\n  \n');
    assert.match(prependChangelog(path, section), /^# Changelog\n/);
  });

  test('inserts above the newest entry and keeps the rest byte for byte', () => {
    const path = join(dir, 'existing.md');
    const head = '# Changelog\n\nIntro text.\n\n';
    const old = '## v1 - 2026-01-01\n\n### Fixed\n\n- a\n';
    writeFileSync(path, head + old);
    assert.equal(prependChangelog(path, section), `${head}${section}\n${old}`);
    assert.equal(readFileSync(path, 'utf8'), `${head}${section}\n${old}`);
  });

  test('appends after a file that has no "## " entry yet', () => {
    const path = join(dir, 'header-only.md');
    writeFileSync(path, '# My changelog\n\n');
    assert.equal(prependChangelog(path, section), `# My changelog\n\n${section}`);
  });
});
