import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SECTIONS, type Item, type Section } from './group.js';

const FRIENDLY: Record<Section, string> = {
  New: "What's new",
  Fixed: 'Bug fixes',
  Changed: 'Improvements',
  Docs: 'Documentation',
  Other: 'Other changes',
};

function link(item: Item): string {
  return item.pr ? ` ([#${item.pr.number}](${item.pr.url}))` : ` (${item.sha.slice(0, 7)})`;
}

function sentence(text: string): string {
  const t = text.trim().replace(/\.$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function renderChangelogSection(version: string, date: string, groups: Map<Section, Item[]>): string {
  const lines = [`## ${version} - ${date}`, ''];
  for (const s of SECTIONS) {
    const items = groups.get(s) ?? [];
    if (!items.length) continue;
    lines.push(`### ${s}`, '');
    for (const i of items) {
      const scope = i.scope ? `**${i.scope}:** ` : '';
      const bang = i.breaking ? '**BREAKING** ' : '';
      lines.push(`- ${bang}${scope}${i.description}${link(i)}`);
    }
    lines.push('');
  }
  if (lines.length === 2) lines.push('No changes.', '');
  return lines.join('\n');
}

/** Friendlier wording: no type prefixes or scopes, and maintenance commits are left out. */
export function renderReleaseNotes(version: string, groups: Map<Section, Item[]>): string {
  const lines = [`# Release notes: ${version}`, ''];
  for (const s of SECTIONS) {
    const entries: string[] = [];
    for (const i of groups.get(s) ?? []) {
      if (s === 'Other' && /^(chore|ci|build|test|style)$/.test(i.type)) continue;
      const note = i.breaking ? ' (breaking change)' : '';
      entries.push(`- ${sentence(i.description)}${note}.${link(i)}`);
    }
    if (!entries.length) continue;
    lines.push(`## ${FRIENDLY[s]}`, '', ...entries, '');
  }
  if (lines.length === 2) lines.push('Maintenance only: no user-facing changes.', '');
  return lines.join('\n');
}

const HEADER = '# Changelog\n\nAll notable changes to this project are listed here, newest first.\n';

/** Prepends `section` above the newest entry. Existing content is kept byte for byte. */
export function prependChangelog(path: string, section: string): string {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  let next: string;
  if (!existing.trim()) {
    next = `${HEADER}\n${section}`;
  } else {
    const at = existing.search(/^## /m);
    next = at === -1 ? `${existing.trimEnd()}\n\n${section}` : `${existing.slice(0, at)}${section}\n${existing.slice(at)}`;
  }
  writeFileSync(path, next);
  return next;
}
