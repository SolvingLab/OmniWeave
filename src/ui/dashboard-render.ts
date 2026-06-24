/**
 * Pure rendering for the live indexing dashboard (the "Aurora" panel).
 *
 * Everything here is side-effect free and returns plain strings, so the layout,
 * sub-character bars, gradient, sparkline, and throughput/ETA math are unit
 * testable. The worker (`shimmer-worker.ts`) owns the only impure parts: the
 * animation clock, cursor control, and `fs.writeSync(1, ...)`.
 *
 * Color is 24-bit truecolor, gated by `style.color`. Glyphs come from
 * `getGlyphs()` so Windows / non-UTF-8 terminals fall back to ASCII (#168);
 * a bar still reads as `#####-----` and a spinner as `|/-\` there.
 */

import type { Glyphs } from './glyphs';

export type RGB = readonly [number, number, number];

export interface DashboardStyle {
  color: boolean;
  glyphs: Glyphs;
}

const ESC = '\x1b';
export const RESET = `${ESC}[0m`;
export const BOLD = `${ESC}[1m`;
export const DIM = `${ESC}[2m`;

function fg(style: DashboardStyle, c: RGB): string {
  return style.color ? `${ESC}[38;2;${c[0]};${c[1]};${c[2]}m` : '';
}
function paint(style: DashboardStyle, c: RGB, s: string, bold = false): string {
  if (!style.color) return s;
  return `${fg(style, c)}${bold ? BOLD : ''}${s}${RESET}`;
}
function dim(style: DashboardStyle, s: string): string {
  return style.color ? `${DIM}${s}${RESET}` : s;
}

// --- color math -------------------------------------------------------------

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Sample a multi-stop gradient at t in [0,1]. */
export function gradientAt(stops: readonly RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0]!;
  if (t <= 0) return stops[0]!;
  if (t >= 1) return stops[stops.length - 1]!;
  const seg = t * (stops.length - 1);
  const i = Math.floor(seg);
  return lerp(stops[i]!, stops[i + 1]!, seg - i);
}

// Cohesive cool "aurora" family — teal → cyan → blue → indigo. One continuous
// palette sliced per phase so the whole panel reads as a single sweep, not a
// rainbow. Restrained on purpose; premium over loud.
export const AURORA: readonly RGB[] = [
  [0, 235, 150],
  [0, 212, 255],
  [40, 130, 255],
  [124, 100, 255],
];
const TRACK: RGB = [62, 70, 86];
const TEXT: RGB = [228, 232, 240];
const MUTED: RGB = [128, 136, 154];
const DONE_MARK: RGB = [0, 226, 140];

export const PHASE_PALETTES: Record<string, readonly RGB[]> = {
  scanning: [[0, 235, 150], [0, 212, 255]],
  parsing: [[0, 212, 255], [40, 130, 255]],
  storing: [[20, 170, 255], [40, 130, 255]],
  resolving: [[40, 130, 255], [124, 100, 255]],
};
export function phasePalette(key: string): readonly RGB[] {
  return PHASE_PALETTES[key] ?? AURORA;
}

// --- bars / spark / text ----------------------------------------------------

/**
 * Smooth horizontal bar at 1/8-cell resolution, gradient-filled, with an
 * optional moving highlight ("plasma" sweep) over the filled region.
 */
export function gradientBar(
  pct: number,
  width: number,
  stops: readonly RGB[],
  style: DashboardStyle,
  opts: { sweep?: number; sweepWidth?: number } = {},
): string {
  const g = style.glyphs;
  const clamped = Math.max(0, Math.min(1, pct));
  if (g.barPartials.length === 0) {
    // ASCII path: no partial cells, just full/empty.
    const filled = Math.round(clamped * width);
    const head = paint(style, gradientAt(stops, 1), g.barFilled.repeat(filled), true);
    const rest = dim(style, fg(style, TRACK) + g.barEmpty.repeat(Math.max(0, width - filled)) + (style.color ? RESET : ''));
    return head + rest;
  }
  const eighths = Math.round(clamped * width * 8);
  const full = Math.floor(eighths / 8);
  const rem = eighths % 8;
  const sweep = opts.sweep ?? -1;
  const sweepWidth = opts.sweepWidth ?? 4;
  let out = '';
  for (let i = 0; i < full; i++) {
    let c = gradientAt(stops, width > 1 ? i / (width - 1) : 1);
    if (sweep >= 0) {
      const k = Math.max(0, 1 - Math.abs(i - sweep) / sweepWidth);
      c = lerp(c, [255, 255, 255], k * 0.6);
    }
    out += `${fg(style, c)}${style.color ? BOLD : ''}${g.barFilled}`;
  }
  let drawn = full;
  if (rem > 0 && full < width) {
    const c = gradientAt(stops, width > 1 ? full / (width - 1) : 1);
    out += `${fg(style, c)}${style.color ? BOLD : ''}${g.barPartials[rem - 1]}`;
    drawn++;
  }
  if (style.color) out += RESET;
  if (drawn < width) {
    const empty = g.barEmpty.repeat(width - drawn);
    out += style.color ? `${DIM}${fg(style, TRACK)}${empty}${RESET}` : empty;
  }
  return out;
}

/** Indeterminate (count-up) animated fill for phases with unknown total. */
export function indeterminateBar(
  frame: number,
  width: number,
  stops: readonly RGB[],
  style: DashboardStyle,
): string {
  const t = (frame % 30) / 30;
  return gradientBar(t, width, stops, style, { sweep: t * width, sweepWidth: 6 });
}

export function sparkline(data: number[], width: number, stops: readonly RGB[], style: DashboardStyle): string {
  const sparks = style.glyphs.sparks;
  const s = data.slice(-width);
  if (s.length === 0) return '';
  const min = Math.min(...s);
  const range = Math.max(...s) - min || 1;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const idx = Math.min(sparks.length - 1, Math.floor(((s[i]! - min) / range) * sparks.length));
    const c = gradientAt(stops, s.length > 1 ? i / (s.length - 1) : 1);
    out += `${fg(style, c)}${sparks[idx]}`;
  }
  return out + (style.color ? RESET : '');
}

/** Per-character gradient text with an animated phase offset. */
export function gradientText(text: string, stops: readonly RGB[], style: DashboardStyle, shift = 0): string {
  if (!style.color) return text;
  const n = text.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    let t = (n > 1 ? i / (n - 1) : 0) + shift;
    t = ((t % 1) + 1) % 1;
    const c = gradientAt(stops, t);
    out += `${fg(style, c)}${text[i]}`;
  }
  return out + RESET;
}

// --- formatting helpers -----------------------------------------------------

export function commas(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Exponentially smoothed throughput + ETA over a sliding window. */
export class Throughput {
  private samples: { t: number; n: number }[] = [];
  private ema = 0;
  history: number[] = [];

  /** Drop accumulated samples — call on a phase change so rate tracks the
   * active phase (file/s and ref/s are different units, not one continuum). */
  reset(): void {
    this.samples = [];
    this.ema = 0;
    this.history = [];
  }

  record(done: number, now: number): void {
    this.samples.push({ t: now, n: done });
    const cutoff = now - 2500;
    while (this.samples.length > 2 && this.samples[0]!.t < cutoff) this.samples.shift();
    if (this.samples.length >= 2) {
      const a = this.samples[0]!;
      const b = this.samples[this.samples.length - 1]!;
      const dt = (b.t - a.t) / 1000;
      const dn = b.n - a.n;
      const raw = dt > 0 ? dn / dt : 0;
      this.ema = this.ema === 0 ? raw : 0.3 * raw + 0.7 * this.ema;
      this.history.push(this.ema);
      if (this.history.length > 32) this.history.shift();
    }
  }
  rate(): number {
    return this.ema;
  }
}

// --- the panel --------------------------------------------------------------

export type PhaseStatus = 'pending' | 'active' | 'done';
export interface PhaseRow {
  key: string;
  label: string;
  status: PhaseStatus;
  current: number;
  total: number; // 0 = indeterminate (count-up)
}
export interface DashboardState {
  subtitle: string; // e.g. "~/code/repo"
  phases: PhaseRow[];
  elapsedMs: number;
  rate: number;
  history: number[];
  spinnerFrame: number;
  shimmerFrame: number;
}

const LABEL_WIDTH = 9; // "resolving"

function barWidthFor(columns: number): number {
  // label + spinner + counts + padding leaves the rest for the bar.
  return Math.max(10, Math.min(28, columns - 40));
}

function phaseRowLine(p: PhaseRow, state: DashboardState, style: DashboardStyle, columns: number): string {
  const g = style.glyphs;
  const pal = phasePalette(p.key);
  const label = p.label.padEnd(LABEL_WIDTH).slice(0, LABEL_WIDTH);
  const barW = barWidthFor(columns);

  if (p.status === 'done') {
    const mark = paint(style, DONE_MARK, g.doneMark, true);
    const bar = gradientBar(1, barW, pal, style);
    const detail = p.total > 0 ? `${commas(p.total)} ${p.key === 'scanning' ? 'files' : 'done'}` : `${commas(p.current)} found`;
    return `  ${mark} ${paint(style, MUTED, label)} ${bar} ${dim(style, detail)}`;
  }
  if (p.status === 'active') {
    const spin = g.spinner[state.spinnerFrame % g.spinner.length] ?? g.spinner[0]!;
    const mark = paint(style, pal[0]!, spin, true);
    if (p.total > 0) {
      const pct = Math.min(1, p.current / p.total);
      const sweep = ((state.shimmerFrame % 26) / 26) * (pct * barW + 5) - 2;
      const bar = gradientBar(pct, barW, pal, style, { sweep, sweepWidth: 4 });
      const pctStr = paint(style, TEXT, `${String(Math.round(pct * 100)).padStart(3)}%`, true);
      const counts = dim(style, `${commas(p.current)}/${commas(p.total)}`);
      const rate = state.rate > 0 ? `  ${paint(style, pal[1] ?? pal[0]!, `${commas(state.rate)}/s`)}` : '';
      return `  ${mark} ${paint(style, TEXT, label)} ${bar} ${pctStr} ${counts}${rate}`;
    }
    const bar = indeterminateBar(state.shimmerFrame, barW, pal, style);
    const count = `${paint(style, TEXT, commas(p.current), true)} ${dim(style, 'found')}`;
    return `  ${mark} ${paint(style, TEXT, label)} ${bar} ${count}`;
  }
  // pending
  const dot = dim(style, g.pendingMark);
  const bar = dim(style, fg(style, TRACK) + g.barEmpty.repeat(barW) + (style.color ? RESET : ''));
  return `  ${dot} ${dim(style, label)} ${bar} ${dim(style, 'pending')}`;
}

/** Returns the dashboard as an array of content lines (no cursor control). */
export function renderDashboard(state: DashboardState, style: DashboardStyle, columns: number): string[] {
  const g = style.glyphs;
  const title = gradientText(`${g.phaseDone} OmniWeave`, AURORA, style, (state.shimmerFrame % 80) / 80);
  const subtitle = state.subtitle ? dim(style, `${g.dash} ${state.subtitle}`) : '';
  const elapsed = dim(style, clock(state.elapsedMs));
  const lines: string[] = [`${style.color ? BOLD : ''}${title}${style.color ? RESET : ''} ${subtitle}   ${elapsed}`];

  for (const p of state.phases) lines.push(phaseRowLine(p, state, style, columns));

  const spark = sparkline(state.history.length ? state.history : [0], 12, AURORA, style);
  const active = state.phases.find((p) => p.status === 'active');
  const rateStr = state.rate > 0 ? `${commas(state.rate)}/s` : 'warming up';
  const etaStr = active && active.total > 0 && state.rate > 0
    ? `   ${dim(style, `eta ${etaFor(state.rate, active.total, active.current)}`)}`
    : '';
  lines.push(`  ${spark}  ${paint(style, MUTED, rateStr)}${etaStr}`);
  return lines;
}

function etaFor(rate: number, total: number, done: number): string {
  if (rate <= 0 || done >= total) return '0:00';
  const s = Math.ceil((total - done) / rate);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
