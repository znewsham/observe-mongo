import { AsynchronousQueue as AsynchronousQueueInterface } from "./queue.js"


type TaskHandleOptions = {
  resolve?: (result: any) => void,
  reject?: (error: any) => void,
  name?: string,
  task?: Function,
  mustRun?: boolean
};

class TaskHandle {
  resolve: ((result: any) => void) | undefined;
  reject: ((error: any) => void) | undefined;
  name: string | undefined;;
  task: Function | undefined;
  #mustRun: boolean = false;
  constructor({
    resolve,
    reject,
    name,
    task,
    mustRun = false
  }: TaskHandleOptions) {
    this.name = name;
    this.task = task;
    this.resolve = resolve;
    this.reject = reject;
  }

  get mustRun() {
    return this.#mustRun;
  }
}

export class AsynchronousQueue implements AsynchronousQueueInterface {
  #queue: TaskHandle[] = [];
  #running: boolean = false;
  #errorHandler: (error: any) => void;

  constructor(_bindTasksToQueueAsyncResource = false, errorHandler: (error: any) => void = console.warn) {
    this.#errorHandler = errorHandler;
  }
  async runTask<F extends any>(task: () => F | Promise<F>, name?: string): Promise<F> {
    return new Promise((resolve, reject) => {
      const taskHandle = new TaskHandle({
        name: name || task.name,
        task,
        resolve,
        reject,
        mustRun: true
      });
      this.#queue.push(taskHandle);
      this._scheduleRun();
    });
  }

  queueTask(task: Function, name?: string) {
    this.#queue.push(new TaskHandle({
      name: name || task.name,
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
    await this.runTask(() => {}, "internalFlush");
  }


  drainAndDestroy(): boolean {
    const hasFlushTasks = this.#queue.some((task) => task.mustRun);
    if (hasFlushTasks) {
      const remainingTasks = this.#queue.filter((task) => task.mustRun);
      this.#queue = remainingTasks;
      this.queueTask(() => this.destroy(), "destroy");
      return false;
    }
    this.destroy();
    return true;
  }

  destroy(): void {
    this.#queue.forEach((task) => {
      // this ensures we can't deadlock if we get it wrong - but in general it'd be bad to throw if we don't have to
      task.reject?.(new Error("AsynchronousQueue destroyed before task could run"));
    });
    this.#queue = [];
  }
}
