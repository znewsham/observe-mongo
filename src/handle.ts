import { AsyncResource } from "async_hooks";
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

  added(_id: ID, doc: T) {
    this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.added) {
        this.#callbacks.added(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc));
      }
    });
  }
  addedBefore(_id: ID, doc: T, before?: ID) {
    this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.addedBefore) {
        this.#callbacks.addedBefore(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc), before);
      }
    });
  }

  movedBefore(_id: ID, before: ID | undefined) {
    this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.movedBefore) {
        this.#callbacks.movedBefore(_id, before);
      }
    });
  }

  changed(_id: ID, fields: Partial<T>) {
    this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.changed) {
        this.#callbacks.changed(_id, this.nonMutatingCallbacks ? fields : this.#clone(fields));
      }
    });
  }

  removed(_id: ID) {
    this.#maybeAsyncResource.runInAsyncScope(() => {
      if (this.#callbacks.removed) {
        this.#callbacks.removed(_id);
      }
    });
  }
}
