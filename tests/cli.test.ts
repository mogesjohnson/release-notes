import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  test('defaults', () => {
    const o = parseArgs([]);
    assert.deepEqual({ ...o, cwd: undefined }, { to: 'HEAD', ai: false, model: 'llama3.1', dryRun: false, cwd: undefined });
    assert.equal(o.cwd, process.cwd());
  });

  test('reads every flag', () => {
    const o = parseArgs(['--from', 'v1.0.0', '--to', 'v1.1.0', '--repo', 'octo/app', '--ai', '--model', 'qwen2', '--dry-run']);
    assert.equal(o.from, 'v1.0.0');
    assert.equal(o.to, 'v1.1.0');
    assert.equal(o.repo, 'octo/app');
    assert.equal(o.ai, true);
    assert.equal(o.model, 'qwen2');
    assert.equal(o.dryRun, true);
  });

  test('rejects a flag with a missing value', () => {
    assert.throws(() => parseArgs(['--from']), /--from needs a value/);
    assert.throws(() => parseArgs(['--model', '--ai']), /--model needs a value/);
  });

  test('rejects unknown arguments', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown argument: --nope/);
  });
});
