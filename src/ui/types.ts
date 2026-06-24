/** Messages from main thread to worker */
export type ShimmerWorkerMessage =
  | { type: 'update'; phase: string; current: number; total: number }
  | { type: 'finish-phase' }
  | { type: 'resize'; columns: number }
  | { type: 'stop' };

/** Messages from worker to main thread */
export type ShimmerMainMessage =
  | { type: 'stopped' };

/** Construction-time data passed to the worker. */
export interface ShimmerWorkerData {
  startTime: number;
  isTTY: boolean;
  columns: number;
  color: boolean;
  subtitle: string;
}
