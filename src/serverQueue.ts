import { AsyncResource } from "async_hooks";
import { AsynchronousQueue as AsynchronousQueueInterface } from "./queue.js"
import { QueueStoppedError } from "./queueStoppedError.js";


type TaskHandleOptions = {
  resolve?: (result: any) => void,
  reject?: (error: any) => void,
  name?: string,
  task?: Function,
  mustRun?: boolean
};

class TaskHandle extends AsyncResource {
  resolve: ((result: any) => void) | undefined;
  reject: ((error: any) => void) | undefined;
  name: string | undefined;;
  task: Function | undefined;
  #mustRun: boolean;
  #destroyed: boolean = false;
  constructor({
    resolve,
    reject,
    name,
    task,
    mustRun = false
  }: TaskHandleOptions) {
    super("TaskHandle");
    this.name = name;
    this.task = task;
    this.#mustRun = mustRun;
    this.resolve = (arg) => {
      this.destroy();
      resolve?.(arg);
    }
    this.reject = (err) => {
      this.destroy();
      reject?.(err);
    }
  }

  get mustRun() {
    return this.#mustRun;
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.emitDestroy();
  }
}

export class AsynchronousQueue extends AsyncResource implements AsynchronousQueueInterface {
  #queue: TaskHandle[] = [];
  #running: boolean = false;
  #destroyed: boolean = false;
  #bindTasksToQueueAsyncResource: boolean = false;
  #errorHandler: (error: any) => void;

  constructor(bindTasksToQueueAsyncResource = false, errorHandler: (error: any) => void = console.warn) {
    super("AsynchronousQueue");
    this.#errorHandler = errorHandler;
    this.#bindTasksToQueueAsyncResource = bindTasksToQueueAsyncResource;
  }
  async runTask<F extends any>(task: () => F | Promise<F>, name?: string): Promise<F> {
    if (this.#destroyed) {
      throw new QueueStoppedError();
    }
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
    if (this.#destroyed) {
      throw new QueueStoppedError();
    }
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
    const asyncResource = this.#bindTasksToQueueAsyncResource ? this : next;
    do {
      try {
        await asyncResource.runInAsyncScope(async () => {
          // @ts-expect-error - ts thinks it can be undefined. It can't.
          const result = await next.task();
          // @ts-expect-error - ts thinks it can be undefined. It can't.
          next.resolve?.(result);
        });
      }
      catch (error) {
        asyncResource.runInAsyncScope(() => {
          // @ts-expect-error - ts thinks it can be undefined. It can't.
          next.reject?.(error);
          // @ts-expect-error
          if (!next.reject) {
            this.#errorHandler(error);
          }
        });
      }
      next = this.#queue.shift();
    } while (next !== undefined);

    this.#running = false;
  }

  _run() {
    return this.runInAsyncScope(() => this.#run());
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
      this.#destroyed = true;
      return false;
    }
    this.destroy();
    return true;
  }

  destroy(): void {
    this.#destroyed = true;
    this.#queue.forEach((task) => {
      // this ensures we can't deadlock if we get it wrong - but in general it'd be bad to throw if we don't have to
      task.reject?.(new Error("AsynchronousQueue destroyed before task could run"));
      task.destroy();
    });
    this.#queue = [];
    this.emitDestroy();
  }
}
