import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { keepsLinks, polishNotes } from '../src/ai.js';

const plain = [
  '# Release notes: v1',
  '',
  "## What's new",
  '',
  '- Add a flag. ([#4](https://github.com/octo/app/pull/4))',
  '- Speed up reads. (abc1234)',
  '',
].join('\n');
const polished = plain.replace('Add a flag.', 'You can now pass a new flag.');

function reply(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json' } });
}

describe('keepsLinks', () => {
  test('true when every PR link and short sha survives', () => {
    assert.equal(keepsLinks(plain, polished), true);
  });

  test('false when a PR link or sha is dropped or changed', () => {
    assert.equal(keepsLinks(plain, polished.replace('(abc1234)', '')), false);
    assert.equal(keepsLinks(plain, polished.replace('/pull/4', '/pull/5')), false);
  });

  test('false for an empty or blank reply', () => {
    assert.equal(keepsLinks(plain, '  \n'), false);
    assert.equal(keepsLinks('no links here', ''), false);
  });

  test('true for any non-empty reply when the notes have no links', () => {
    assert.equal(keepsLinks('Maintenance only.', 'Only maintenance.'), true);
  });
});

describe('polishNotes', () => {
  let warn: ReturnType<typeof mock.method>;
  beforeEach(() => {
    warn = mock.method(console, 'error', () => {});
  });
  afterEach(() => mock.restoreAll());
  const warnings = () => warn.mock.calls.map((c) => String(c.arguments[0]));

  test('posts the notes to Ollama and returns a usable reply', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () => reply({ response: polished }));
    const out = await polishNotes(plain, { model: 'llama3.1' });
    assert.equal(out, `${polished.trim()}\n`);
    assert.equal(fetch.mock.callCount(), 1);
    const [url, init] = fetch.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'http://localhost:11434/api/generate');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'llama3.1');
    assert.equal(body.stream, false);
    assert.ok(body.prompt.endsWith(plain), 'the plain notes are sent as the end of the prompt');
    assert.deepEqual(warnings(), []);
  });

  test('uses a custom url', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () => reply({ response: polished }));
    await polishNotes(plain, { model: 'm', url: 'http://ollama.test:1/api/generate' });
    assert.equal(fetch.mock.calls[0].arguments[0], 'http://ollama.test:1/api/generate');
  });

  test('strips a ```markdown fence around the reply', async () => {
    mock.method(globalThis, 'fetch', async () => reply({ response: `\`\`\`markdown\n${polished}\n\`\`\`` }));
    assert.equal(await polishNotes(plain, { model: 'm' }), `${polished.trim()}\n`);
  });

  test('falls back with one warning when Ollama is not running', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    assert.equal(await polishNotes(plain, { model: 'm' }), plain);
    assert.deepEqual(warnings(), ['release-notes: warning: --ai skipped (fetch failed); using plain notes']);
  });

  test('falls back on an HTTP error (for example an unknown model)', async () => {
    mock.method(globalThis, 'fetch', async () => reply({ error: 'model not found' }, { status: 404 }));
    assert.equal(await polishNotes(plain, { model: 'nope' }), plain);
    assert.deepEqual(warnings(), ['release-notes: warning: --ai skipped (HTTP 404); using plain notes']);
  });

  test('falls back when the reply drops links or is empty', async () => {
    for (const response of [polished.replace(' ([#4](https://github.com/octo/app/pull/4))', ''), '', undefined]) {
      mock.method(globalThis, 'fetch', async () => reply({ response }));
      assert.equal(await polishNotes(plain, { model: 'm' }), plain);
    }
    assert.equal(warnings().length, 3);
    for (const w of warnings()) assert.equal(w, 'release-notes: warning: --ai skipped (reply dropped links or was empty); using plain notes');
  });

  test('falls back when the body is not JSON', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('<html>proxy error</html>', { status: 200 }));
    assert.equal(await polishNotes(plain, { model: 'm' }), plain);
    assert.equal(warnings().length, 1);
  });

  test('times out, aborts the request and falls back', async () => {
    let signal: AbortSignal | undefined;
    mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    }));
    assert.equal(await polishNotes(plain, { model: 'm', timeoutMs: 20 }), plain);
    assert.equal(signal?.aborted, true);
    assert.deepEqual(warnings(), ['release-notes: warning: --ai skipped (timed out); using plain notes']);
  });
});
