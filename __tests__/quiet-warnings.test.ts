/**
 * Startup-noise warning filter.
 *
 * The hole this guards: a TLS-intercepting proxy commonly exports
 * NODE_TLS_REJECT_UNAUTHORIZED=0 in the shell, so Node prints a one-time
 * security notice on OmniWeave's first HTTPS call (telemetry/upgrade) — and
 * `node:sqlite` prints an ExperimentalWarning on every command. Both clutter the
 * index/sync UI and neither is actionable from inside OmniWeave. The filter must
 * drop exactly those two and let every other warning through untouched.
 */

import { describe, it, expect } from 'vitest';
import { isSilencedWarning, silenceEnvNoiseWarnings } from '../src/bin/quiet-warnings';

const TLS_WARNING =
  "Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification.";
const SQLITE_WARNING = 'SQLite is an experimental feature and might change at any time';

describe('isSilencedWarning', () => {
  it('silences the proxy TLS env warning', () => {
    expect(isSilencedWarning(TLS_WARNING)).toBe(true);
  });

  it('silences the node:sqlite experimental warning', () => {
    expect(isSilencedWarning(SQLITE_WARNING)).toBe(true);
  });

  it('lets unrelated warnings through', () => {
    expect(isSilencedWarning('SomeApi() is deprecated. Use otherApi() instead.')).toBe(false);
    expect(isSilencedWarning('The Fetch API is an experimental feature')).toBe(false);
    expect(isSilencedWarning('')).toBe(false);
  });
});

describe('silenceEnvNoiseWarnings', () => {
  function makeProc() {
    const calls: unknown[][] = [];
    const proc = {
      emitWarning: (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as NodeJS.Process;
    return { proc, calls };
  }

  it('swallows the TLS and SQLite warnings (string form)', () => {
    const { proc, calls } = makeProc();
    silenceEnvNoiseWarnings(proc);
    proc.emitWarning(TLS_WARNING);
    proc.emitWarning(SQLITE_WARNING, 'ExperimentalWarning');
    expect(calls).toHaveLength(0);
  });

  it('swallows the warnings when passed as an Error object', () => {
    const { proc, calls } = makeProc();
    silenceEnvNoiseWarnings(proc);
    const err = new Error(TLS_WARNING);
    err.name = 'Warning';
    proc.emitWarning(err);
    expect(calls).toHaveLength(0);
  });

  it('passes every other warning through with its original arguments', () => {
    const { proc, calls } = makeProc();
    silenceEnvNoiseWarnings(proc);
    proc.emitWarning('old API', 'DeprecationWarning');
    expect(calls).toEqual([['old API', 'DeprecationWarning']]);
  });
});
