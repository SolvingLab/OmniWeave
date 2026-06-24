import { parentPort, workerData } from 'worker_threads';
import { writeSync } from 'fs';
import { getGlyphs } from './glyphs';
import {
  renderDashboard, Throughput,
  type DashboardState, type DashboardStyle, type PhaseRow, type PhaseStatus,
} from './dashboard-render';
import type { ShimmerWorkerMessage, ShimmerWorkerData } from './types';

// Write directly to fd 1 (stdout) instead of process.stdout. In worker threads
// process.stdout is proxied through the main thread's event loop, so when the
// main thread is blocked (e.g. SQLite) the animation freezes. fs.writeSync(1)
// is a direct syscall that bypasses this. The trade-off (no TTY-aware encoding
// on Windows) is handled by ASCII glyph fallback in getGlyphs() (#168).
function out(s: string): void {
  writeSync(1, s);
}

const data = workerData as ShimmerWorkerData;
const startTime = data.startTime;
const isTTY = data.isTTY;
let columns = data.columns || 80;
const style: DashboardStyle = { color: data.color, glyphs: getGlyphs() };

const ESC = '\x1b';
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;
const CLR = `${ESC}[2K`;
const HOME = `${ESC}[1G`;

// Phase state, discovered dynamically in arrival order (real phases are
// scanning -> parsing -> resolving; the panel grows as each first appears).
interface Phase { key: string; status: PhaseStatus; current: number; total: number }
const order: string[] = [];
const phases = new Map<string, Phase>();
let activeKey = '';
const tp = new Throughput();

function ensurePhase(key: string): Phase {
  let p = phases.get(key);
  if (!p) {
    p = { key, status: 'active', current: 0, total: 0 };
    phases.set(key, p);
    order.push(key);
  }
  return p;
}

function markActiveDone(): void {
  if (activeKey) {
    const prev = phases.get(activeKey);
    if (prev) prev.status = 'done';
  }
}

function applyUpdate(key: string, current: number, total: number): void {
  if (key !== activeKey) {
    markActiveDone();
    activeKey = key;
    tp.reset(); // so the footer rate tracks this phase, not a cross-unit jump
  }
  const p = ensurePhase(key);
  p.status = 'active';
  p.current = current;
  p.total = total;
  tp.record(current, Date.now());
}

function buildState(): DashboardState {
  const elapsedMs = Date.now() - startTime;
  const frame = Math.floor(elapsedMs / 50);
  const rows: PhaseRow[] = order.map((key) => {
    const p = phases.get(key)!;
    return { key, label: key, status: p.status, current: p.current, total: p.total };
  });
  return {
    subtitle: data.subtitle,
    phases: rows,
    elapsedMs,
    rate: tp.rate(),
    history: tp.history,
    spinnerFrame: Math.floor(frame / 2),
    shimmerFrame: frame,
  };
}

// --- TTY live rendering -----------------------------------------------------

let renderedLines = 0;
let cursorHidden = false;

function render(): void {
  if (!isTTY || order.length === 0) return;
  const lines = renderDashboard(buildState(), style, columns);
  let buf = '';
  if (!cursorHidden) { buf += HIDE; cursorHidden = true; }
  if (renderedLines > 0) buf += `${ESC}[${renderedLines}A`;
  for (const l of lines) buf += `${CLR}${HOME}${l}\n`;
  const extra = renderedLines - lines.length;
  for (let i = 0; i < extra; i++) buf += `${CLR}${HOME}\n`;
  if (extra > 0) buf += `${ESC}[${extra}A`;
  renderedLines = lines.length;
  out(buf);
}

function restoreCursor(): void {
  if (cursorHidden) { out(SHOW); cursorHidden = false; }
}

// --- non-TTY: one plain line per completed phase ----------------------------

function logPlainPhaseDone(key: string): void {
  const p = phases.get(key);
  if (!p) return;
  const g = style.glyphs;
  const detail = p.total > 0
    ? `${p.total.toLocaleString('en-US')} ${key === 'scanning' ? 'files' : 'done'}`
    : `${p.current.toLocaleString('en-US')} found`;
  out(`  ${g.doneMark} ${key} ${g.dash} ${detail}\n`);
}

const tickInterval = isTTY ? setInterval(render, 50) : null;

parentPort!.on('message', (msg: ShimmerWorkerMessage) => {
  if (msg.type === 'update') {
    applyUpdate(msg.phase, msg.current, msg.total);
  } else if (msg.type === 'finish-phase') {
    if (!isTTY && activeKey) logPlainPhaseDone(activeKey);
    markActiveDone();
  } else if (msg.type === 'resize') {
    columns = msg.columns || columns;
  } else if (msg.type === 'stop') {
    if (tickInterval) clearInterval(tickInterval);
    if (!isTTY && activeKey) logPlainPhaseDone(activeKey);
    markActiveDone();
    activeKey = '';
    render();          // settle the panel with all phases done
    restoreCursor();
    parentPort!.postMessage({ type: 'stopped' });
  }
});
