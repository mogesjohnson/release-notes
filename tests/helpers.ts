import type { Commit, Exec } from '../src/git.js';

export interface Call {
  cmd: string;
  args: string[];
  cwd: string;
}

/**
 * A fake Exec. `reply` gets each call and returns stdout, or throws like a failed
 * command. Every call is recorded so tests can check the exact git and gh arguments.
 */
export function fakeExec(reply: (c: Call) => string): Exec & { calls: Call[] } {
  const calls: Call[] = [];
  const exec = (cmd: string, args: string[], cwd: string): string => {
    const call = { cmd, args, cwd };
    calls.push(call);
    return reply(call);
  };
  return Object.assign(exec, { calls });
}

/** An Exec that fails every call, like a missing binary or a non-zero exit. */
export const failingExec = fakeExec(() => {
  throw new Error('command failed');
});

export function commit(sha: string, subject: string, opts: { body?: string; parents?: string[] } = {}): Commit {
  return { sha, subject, body: opts.body ?? '', parents: opts.parents ?? ['p'.repeat(40)] };
}

/** A 40-character sha made of one repeated hex digit, e.g. sha('a'). */
export const sha = (c: string): string => c.repeat(40);
