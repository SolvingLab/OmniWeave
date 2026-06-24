/**
 * Pure rendering for the live "Aurora" indexing dashboard.
 *
 * Pinned because the worker that drives it (shimmer-worker) is impure and hard
 * to assert on. These tests own the contract: bars fill at 1/8 resolution,
 * ASCII terminals degrade to `#`/`-`, NO_COLOR strips every escape, the panel
 * fits the terminal width, and the throughput/ETA math is sane.
 */

import { describe, it, expect } from 'vitest';
import { UNICODE_GLYPHS, ASCII_GLYPHS } from '../src/ui/glyphs';
import {
  AURORA, gradientAt, gradientBar, sparkline, gradientText, renderDashboard,
  Throughput, commas, clock,
  type DashboardStyle, type DashboardState,
} from '../src/ui/dashboard-render';

const COLOR: DashboardStyle = { color: true, glyphs: UNICODE_GLYPHS };
const PLAIN: DashboardStyle = { color: false, glyphs: UNICODE_GLYPHS };
const ASCII: DashboardStyle = { color: false, glyphs: ASCII_GLYPHS };

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const visible = (s: string) => stripAnsi(s).length;

describe('gradientAt', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(gradientAt(AURORA, 0)).toEqual(AURORA[0]);
    expect(gradientAt(AURORA, 1)).toEqual(AURORA[AURORA.length - 1]);
  });
  it('interpolates between stops', () => {
    const mid = gradientAt([[0, 0, 0], [10, 20, 30]], 0.5);
    expect(mid).toEqual([5, 10, 15]);
  });
});

describe('gradientBar', () => {
  it('is fully empty at 0 and fully filled at 1', () => {
    expect(stripAnsi(gradientBar(0, 20, AURORA, PLAIN))).toBe('░'.repeat(20));
    expect(stripAnsi(gradientBar(1, 20, AURORA, PLAIN))).toBe('█'.repeat(20));
  });
  it('fills proportionally at 1/8-cell resolution', () => {
    const half = stripAnsi(gradientBar(0.5, 20, AURORA, PLAIN));
    expect(half.startsWith('█'.repeat(10))).toBe(true);
    expect(visible(gradientBar(0.5, 20, AURORA, PLAIN))).toBe(20);
    // a sub-cell fraction uses a partial-block glyph
    const partial = stripAnsi(gradientBar(0.51, 20, AURORA, PLAIN));
    expect(/[▏▎▍▌▋▊▉]/.test(partial)).toBe(true);
  });
  it('degrades to #/- on ASCII terminals (no partial glyphs)', () => {
    const bar = stripAnsi(gradientBar(0.5, 10, AURORA, ASCII));
    expect(bar).toBe('#####-----');
    expect(/[▏▎▍▌▋▊▉█░]/.test(bar)).toBe(false);
  });
  it('emits 24-bit color only when color is enabled', () => {
    expect(gradientBar(0.5, 8, AURORA, COLOR)).toContain('\x1b[38;2;');
    expect(gradientBar(0.5, 8, AURORA, PLAIN)).not.toContain('\x1b[38;2;');
  });
  it('clamps out-of-range percentages', () => {
    expect(visible(gradientBar(2, 12, AURORA, PLAIN))).toBe(12);
    expect(visible(gradientBar(-1, 12, AURORA, PLAIN))).toBe(12);
  });
});

describe('sparkline', () => {
  it('maps low values to low glyphs and high to high', () => {
    const s = stripAnsi(sparkline([0, 1, 2, 3, 4, 5, 6, 7], 8, AURORA, PLAIN));
    expect(s[0]).toBe('▁');
    expect(s[s.length - 1]).toBe('█');
  });
  it('uses ASCII ramp without color', () => {
    const s = sparkline([0, 4, 8], 8, AURORA, ASCII);
    expect(s).not.toContain('\x1b[');
    expect(/[▁▂▃▄▅▆▇█]/.test(s)).toBe(false);
  });
});

describe('gradientText', () => {
  it('is identity (no escapes) when color is off', () => {
    expect(gradientText('OmniWeave', AURORA, PLAIN)).toBe('OmniWeave');
  });
  it('keeps the visible characters when colored', () => {
    expect(stripAnsi(gradientText('OmniWeave', AURORA, COLOR))).toBe('OmniWeave');
  });
});

describe('Throughput', () => {
  it('reports a positive rate from increasing samples and resets cleanly', () => {
    const tp = new Throughput();
    tp.record(0, 1000);
    tp.record(100, 2000);
    tp.record(200, 3000);
    expect(tp.rate()).toBeGreaterThan(0);
    tp.reset();
    expect(tp.rate()).toBe(0);
    expect(tp.history).toEqual([]);
  });
});

describe('formatters', () => {
  it('commas groups thousands', () => {
    expect(commas(3222)).toBe('3,222');
    expect(commas(48652)).toBe('48,652');
  });
  it('clock formats m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
  });
});

describe('renderDashboard', () => {
  const state: DashboardState = {
    subtitle: '~/code/repo',
    phases: [
      { key: 'scanning', label: 'scanning', status: 'done', current: 3222, total: 0 },
      { key: 'parsing', label: 'parsing', status: 'active', current: 1644, total: 3222 },
      { key: 'resolving', label: 'resolving', status: 'pending', current: 0, total: 0 },
    ],
    elapsedMs: 4000,
    rate: 182,
    history: [10, 40, 90, 140, 182],
    spinnerFrame: 3,
    shimmerFrame: 12,
  };

  it('renders title + one row per phase + a footer', () => {
    const lines = renderDashboard(state, COLOR, 100);
    expect(lines).toHaveLength(1 + state.phases.length + 1);
    expect(stripAnsi(lines[0]!)).toContain('OmniWeave');
    expect(stripAnsi(lines[0]!)).toContain('~/code/repo');
    expect(stripAnsi(lines[1]!)).toContain('scanning');
    expect(stripAnsi(lines[2]!)).toContain('parsing');
    expect(stripAnsi(lines[2]!)).toContain('%'); // active phase shows percent
    expect(stripAnsi(lines[3]!)).toContain('pending');
  });

  it('keeps every line within the terminal width', () => {
    for (const cols of [60, 80, 120]) {
      for (const line of renderDashboard(state, COLOR, cols)) {
        expect(visible(line)).toBeLessThanOrEqual(cols);
      }
    }
  });

  it('produces no escape codes under NO_COLOR', () => {
    for (const line of renderDashboard(state, PLAIN, 100)) {
      expect(line).not.toContain('\x1b[');
    }
  });
});
