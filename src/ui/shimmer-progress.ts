import { Worker } from 'worker_threads';
import { writeSync } from 'fs';
import * as path from 'path';
import type { ShimmerWorkerData } from './types';

export interface IndexProgress {
  phase: string;
  current: number;
  total: number;
}

export interface ShimmerProgress {
  onProgress: (progress: IndexProgress) => void;
  stop: () => Promise<void>;
}

export interface ShimmerOptions {
  /** Shown after the wordmark, e.g. the project path. */
  subtitle?: string;
}

// Best-effort cursor restore if the process dies while the worker has the
// cursor hidden (Ctrl-C mid-index). Registered once, fires on real exit only.
let cursorGuardInstalled = false;
function installCursorGuard(isTTY: boolean): void {
  if (cursorGuardInstalled || !isTTY) return;
  cursorGuardInstalled = true;
  const restore = () => {
    try { writeSync(1, '\x1b[?25h'); } catch { /* stdout gone — nothing to do */ }
  };
  process.once('exit', restore);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => { restore(); process.exit(130); });
  }
}

export function createShimmerProgress(options: ShimmerOptions = {}): ShimmerProgress {
  let lastPhase = '';

  const isTTY = process.stdout.isTTY === true;
  const columns = process.stdout.columns || 80;
  const color = isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
  installCursorGuard(isTTY);

  const workerPath = path.join(__dirname, 'shimmer-worker.js');
  const data: ShimmerWorkerData = {
    startTime: Date.now(),
    isTTY,
    columns,
    color,
    subtitle: options.subtitle ?? '',
  };
  const worker = new Worker(workerPath, { workerData: data });

  const onResize = () => {
    worker.postMessage({ type: 'resize', columns: process.stdout.columns || columns });
  };
  if (isTTY) process.stdout.on('resize', onResize);

  return {
    onProgress(progress: IndexProgress) {
      if (progress.phase !== lastPhase && lastPhase) {
        worker.postMessage({ type: 'finish-phase' });
      }
      lastPhase = progress.phase;
      worker.postMessage({
        type: 'update',
        phase: progress.phase,
        current: progress.current,
        total: progress.total,
      });
    },

    stop() {
      return new Promise<void>((resolve) => {
        if (isTTY) process.stdout.off('resize', onResize);
        const timeout = setTimeout(() => {
          worker.terminate().then(() => resolve());
        }, 2000);

        worker.on('message', (msg: { type: string }) => {
          if (msg.type === 'stopped') {
            clearTimeout(timeout);
            worker.terminate().then(() => resolve());
          }
        });

        worker.postMessage({ type: 'stop' });
      });
    },
  };
}
