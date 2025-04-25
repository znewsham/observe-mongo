export interface AsynchronousQueue {
  runTask<F extends any>(task: () => F | Promise<F>): Promise<F>;
  queueTask(task: Function): void;
  _run(): void;
  _scheduleRun(): void;
  flush(): Promise<void>;
  destroy(): void;
}
