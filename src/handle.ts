import { AsyncResource } from "#async_hooks";
import { ObserveMultiplexer } from "./multiplexer.js";
import { Clone, ObserveChangesCallbacks, ObserveChangesObserver, ObserveHandle, StringObjectWithoutID, Stringable, naiveClone } from "./types.js";


export interface ObserveHandleConstructorOptions<ID extends Stringable, T extends StringObjectWithoutID> {
  multiplexer: ObserveMultiplexer<ID, T>,
  callbacks: ObserveChangesCallbacks<ID, T>,
  nonMutatingCallbacks?: boolean,
  clone: Clone | undefined,
  bindObserveEventsToAsyncResource?: Boolean,
}

interface MaybeAsyncResource {
  runInAsyncScope: typeof AsyncResource.prototype.runInAsyncScope
}

export class ObserveHandleImpl<
  ID extends Stringable,
  T extends StringObjectWithoutID
> implements ObserveChangesObserver<ID, T>, ObserveHandle {
  static nextObserveHandleId: number = 1;
  _multiplexer: ObserveMultiplexer<ID, T>;
  _id: number = ObserveHandleImpl.nextObserveHandleId++;
  _stopped: boolean = false;
  #callbacks: ObserveChangesCallbacks<ID, T>;
  #clone: Clone = naiveClone;
  #maybeAsyncResource: MaybeAsyncResource;

  nonMutatingCallbacks: boolean;

  constructor({
    multiplexer,
    callbacks,
    nonMutatingCallbacks,
    clone = naiveClone,
    bindObserveEventsToAsyncResource = true
  }: ObserveHandleConstructorOptions<ID, T>) {
    this.nonMutatingCallbacks = nonMutatingCallbacks || false;
    this._multiplexer = multiplexer;
    this.#callbacks = callbacks;
    this.#clone = clone;
    if (bindObserveEventsToAsyncResource) {
      this.#maybeAsyncResource = new AsyncResource("ObserveHandle");
    }
    else {
      this.#maybeAsyncResource = {
        runInAsyncScope(fn, thisArg, ...args) {
          return thisArg
            ? fn.call(thisArg, ...args)
            // @ts-expect-error
            : fn();
        },
      }
    }
  }

  stop() {
    if (this._stopped) {
      return;
    }
    this._multiplexer.removeHandle(this);
    this._stopped = true;
  }

  observes(hookName: keyof ObserveChangesCallbacks<ID, T>): boolean {
    return !!this.#callbacks[hookName];
  }

  async added(_id: ID, doc: T) {
    await this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.added) {
        return this.#callbacks.added(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc));
      }
    });
  }
  async addedBefore(_id: ID, doc: T, before?: ID) {
    await this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.addedBefore) {
        return this.#callbacks.addedBefore(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc), before);
      }
    });
  }

  async movedBefore(_id: ID, before: ID | undefined) {
    await this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.movedBefore) {
        return this.#callbacks.movedBefore(_id, before);
      }
    });
  }

  async changed(_id: ID, fields: Partial<T>) {
    await this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.changed) {
        return this.#callbacks.changed(_id, this.nonMutatingCallbacks ? fields : this.#clone(fields));
      }
    });
  }

  async removed(_id: ID) {
    await this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.removed) {
        return this.#callbacks.removed(_id);
      }
    });
  }
}
