/**
 * Silence two process warnings that are pure noise for OmniWeave and clutter the
 * `index` / `sync` UI — without ever hiding any other warning.
 *
 * 1. `NODE_TLS_REJECT_UNAUTHORIZED`: a TLS-intercepting proxy or dev environment
 *    commonly exports this as `'0'` in the shell. Node then prints a one-time
 *    security notice the first time the process opens an HTTPS connection — for
 *    OmniWeave that is the best-effort telemetry flush or upgrade check. The
 *    setting is the user's global environment, not anything OmniWeave does or
 *    can act on from inside a command, so the line is unactionable noise. TLS
 *    behavior is completely unchanged; only the notice is dropped.
 * 2. The `ExperimentalWarning` for the built-in `node:sqlite` module. OmniWeave's
 *    entire graph store is built on `node:sqlite` — it is a hard dependency, not
 *    an experiment the user opted into — so the "experimental feature" banner is
 *    noise on every single command.
 *
 * Matching is by message content, so the filter is robust to how Node passes the
 * warning (string vs. Error, type argument vs. options object). Every other
 * warning — real deprecations, other experimental modules — still prints through
 * the original `emitWarning` path untouched.
 */

const SILENCED_WARNING_PATTERNS: readonly RegExp[] = [
  /NODE_TLS_REJECT_UNAUTHORIZED/,
  /SQLite is an experimental feature/i,
];

export function isSilencedWarning(message: string): boolean {
  return SILENCED_WARNING_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Install the warning filter. Idempotent enough for repeated calls (the bin
 * re-execs itself with WASM runtime flags, so this runs again in the child).
 */
export function silenceEnvNoiseWarnings(proc: NodeJS.Process = process): void {
  const original = proc.emitWarning.bind(proc) as (...args: unknown[]) => void;
  const patched = (warning: string | Error, ...rest: unknown[]): void => {
    const message = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (isSilencedWarning(message)) return;
    original(warning, ...rest);
  };
  proc.emitWarning = patched as typeof proc.emitWarning;
}
