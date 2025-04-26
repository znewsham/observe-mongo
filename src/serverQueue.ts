import { AsyncResource } from "async_hooks";
import { AsynchronousQueue as AsynchronousQueueInterface } from "./queue.js"


type TaskHandleOptions = {
  resolve?: (result: any) => void,
  reject?: (error: any) => void,
  name?: string,
  task?: Function
};

class TaskHandle extends AsyncResource {
  resolve: ((result: any) => void) | undefined;
  reject: ((error: any) => void) | undefined;
  name: string | undefined;;
  task: Function | undefined;
  #destroyed: boolean = false;
  constructor({
    resolve,
    reject,
    name,
    task
  }: TaskHandleOptions) {
    super("TaskHandle");
    this.name = name;
    this.task = task;
    this.resolve = (arg) => {
      this.destroy();
      resolve?.(arg);
    }
    this.reject = (err) => {
      this.destroy();
      reject?.(err);
    }
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
  #bindTasksToQueueAsyncResource: boolean = false;
  #errorHandler: (error: any) => void;

  constructor(bindTasksToQueueAsyncResource = false, errorHandler: (error: any) => void = console.warn) {
    super("AsynchronousQueue");
    this.#errorHandler = errorHandler;
    this.#bindTasksToQueueAsyncResource = bindTasksToQueueAsyncResource;
  }
  async runTask<F extends any>(task: () => F | Promise<F>, name?: string): Promise<F> {
    return new Promise((resolve, reject) => {
      const taskHandle = new TaskHandle({
        name: name || task.name,
        task,
        resolve,
        reject
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

  destroy(): void {
    this.#queue.forEach((task) => {
      task.destroy();
    });
    this.#queue = [];
    this.emitDestroy();
  }
}
