import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { AsynchronousQueue as AsynchronousQueueInterface } from "./queue.js"
import { QueueStoppedError } from "./queueStoppedError.js";
import { setTimeout } from "timers/promises";


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
  // see the comment in asyncLocalStoragePool.ts for why we do this
  static #asyncLocalStorage = new AsyncLocalStorage<Array<TaskHandle | undefined>>();
  static #indexCounter = 0;
  #asyncLocalStorageIndex = AsynchronousQueue.#indexCounter++;

  // we need to be able to track the currently running task to prevent deadlocks in addition to tracking the async context of the run
  // runTask(() => runTask()) would deadlock and should throw
  // runTask(() => setTimeout(() => runTask()) is fine and must not throw
  #runningTask: TaskHandle | null = null;

  constructor(bindTasksToQueueAsyncResource = false, errorHandler: (error: any) => void = console.warn) {
    super("AsynchronousQueue");
    this.#errorHandler = errorHandler;
    this.#bindTasksToQueueAsyncResource = bindTasksToQueueAsyncResource;
  }

  /**
   * Dangerous - this flags a queue as safe to run tasks from within tasks.
   * This can lead to deadlocks if you're not extremely careful.
   * The usecase here is when you know it's impossible for a deadlock to occur - see the test suite for an example
   * It's expected this is ran from within a clean async context - it directly modifies state.
   */
  _markSafeToRunTask() {
    const store = AsynchronousQueue.#asyncLocalStorage.getStore();
    if (!store) {
      return;
    }
    store[this.#asyncLocalStorageIndex] = undefined;
  }

  safeToRunTask() {
    // we can't run a task from a task, we'll deadlock
    return AsynchronousQueue.#asyncLocalStorage.getStore()?.[this.#asyncLocalStorageIndex] !== this.#runningTask;
  }

  async runTask<F extends any>(task: () => F | Promise<F>, name?: string): Promise<F> {
    if (this.#destroyed) {
      throw new QueueStoppedError();
    }
    if (!this.safeToRunTask()) {
      throw new Error("Can't runTask from another task in the same queue");
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
        // the deadlock prevention logic requires that the task itself have the queue's running task provided in it's async context
        // otherwise how will a call to runTask know it's being called from within a task?
        // particularly relevant for A -> B -> A cycles where A and B are different queues
        await next.runInAsyncScope(async () => {
          // @ts-expect-error - ts thinks it can be undefined. It can't.
          const actualNext: TaskHandle = next;
          const newStore = (AsynchronousQueue.#asyncLocalStorage.getStore() || []).slice();
          this.#runningTask = actualNext;
          newStore[this.#asyncLocalStorageIndex] = this.#runningTask;
          await asyncResource.runInAsyncScope(async () => {
            await AsynchronousQueue.#asyncLocalStorage.run(
              newStore,
              async () => {
                try {
                  const result = await AsynchronousQueue.#asyncLocalStorage.run(
                    newStore,
                      // @ts-expect-error - ts thinks it can be undefined. It can't.
                    () => actualNext.task()
                  );
                  actualNext.resolve?.(result);
                }
                finally {
                  this.#runningTask = null;
                }
              });
            }
          );
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
      if (this.#queue.length) {
        // this ensures the eventloop has a chance to run after a task completes.
        // this is equivalent to meteor's _scheduleRun call but is easier to reason about with async/await
        // interleavings of _scheduleRun + run are hard to comprehend otherwise.
        // it is also this line (surprisingly) that ensures async stacks are correct with nested run/queueTask calls.
        await setTimeout(1);
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
