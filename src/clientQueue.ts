import { AsynchronousQueue as AsynchronousQueueInterface } from "./queue.js"


type TaskHandleOptions = {
  resolve?: (result: any) => void,
  reject?: (error: any) => void,
  name?: string,
  task?: Function
};

class TaskHandle {
  resolve: ((result: any) => void) | undefined;
  reject: ((error: any) => void) | undefined;
  name: string | undefined;;
  task: Function | undefined;
  constructor({
    resolve,
    reject,
    name,
    task
  }: TaskHandleOptions) {
    this.name = name;
    this.task = task;
    this.resolve = resolve;
    this.reject = reject;
  }
}

export class AsynchronousQueue implements AsynchronousQueueInterface {
  #queue: TaskHandle[] = [];
  #running: boolean = false;
  #errorHandler: (error: any) => void;

  constructor(_bindTasksToQueueAsyncResource = false, errorHandler: (error: any) => void = console.warn) {
    this.#errorHandler = errorHandler;
  }
  async runTask<F extends any>(task: () => F | Promise<F>): Promise<F> {
    return new Promise((resolve, reject) => {
      const taskHandle = new TaskHandle({
        name: task.name,
        task,
        resolve,
        reject
      });
      this.#queue.push(taskHandle);
      this._scheduleRun();
    });
  }

  queueTask(task: Function) {
    this.#queue.push(new TaskHandle({
      name: task.name,
      task
    }));
    this._scheduleRun();
  }

  async #run() {
    if (!this.#running) {
      throw new Error("Should be running");
    }
    let next = this.#queue.shift();
    if (next === undefined) {
      this.#running = false;
      return;
    }
    do {
      try {
        // @ts-expect-error - ts thinks it can be undefined. It can't.
        const result = await next.task();
        next.resolve?.(result);
      }
      catch (error) {
        next.reject?.(error);
        if (!next.reject) {
          this.#errorHandler(error);
        }
      }
      next = this.#queue.shift();
    } while (next !== undefined);

    this.#running = false;
  }

  _run() {
    return this.#run();
  }

  _scheduleRun() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    setImmediate(() => {
      this._run();
    });
  }

  async flush(): Promise<void> {
    await this.runTask(() => {});
  }

  destroy(): void {
    this.#queue = [];
  }
}
