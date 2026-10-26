export interface PolishOptions {
  model: string;
  url?: string;
  timeoutMs?: number;
}

const DEFAULT_URL = 'http://localhost:11434/api/generate';

function prompt(notes: string): string {
  return [
    'Rewrite these release notes so they read well for end users.',
    'Keep the Markdown structure, every heading, every bullet and every link exactly as they are.',
    'Only improve the wording of each bullet. Do not add, drop or merge items. Reply with the Markdown only.',
    '',
    notes,
  ].join('\n');
}

/** A reply is usable only if it kept every PR or commit link from the plain notes. */
export function keepsLinks(plain: string, polished: string): boolean {
  const links = plain.match(/\]\([^)]+\)|\([0-9a-f]{7}\)/g) ?? [];
  return polished.trim().length > 0 && links.every((l) => polished.includes(l));
}

/**
 * Asks a local Ollama server to polish the notes. Never throws: on any error,
 * timeout or unusable reply it prints one warning and returns the plain notes.
 */
export async function polishNotes(notes: string, o: PolishOptions): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 60_000);
  try {
    const res = await fetch(o.url ?? DEFAULT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: o.model, prompt: prompt(notes), stream: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { response?: string };
    const text = (data.response ?? '').replace(/^```(?:markdown|md)?\n|\n```\s*$/g, '').trim();
    if (!keepsLinks(notes, text)) throw new Error('reply dropped links or was empty');
    return `${text}\n`;
  } catch (err) {
    const why = (err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message;
    console.error(`release-notes: warning: --ai skipped (${why}); using plain notes`);
    return notes;
  } finally {
    clearTimeout(timer);
  }
}
