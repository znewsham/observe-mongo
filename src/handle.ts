import { ObserveMultiplexer } from "./multiplexer.js";
import { Clone, ObserveChangesCallbacks, ObserveChangesObserver, ObserveHandle, StringObjectWithoutID, Stringable, naiveClone } from "./types.js";

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

  nonMutatingCallbacks: boolean;

  constructor(
    multiplexer: ObserveMultiplexer<ID, T>,
    callbacks: ObserveChangesCallbacks<ID, T>,
    nonMutatingCallbacks?: boolean,
    clone: Clone | undefined = naiveClone
  ) {
    this.nonMutatingCallbacks = nonMutatingCallbacks || false;
    this._multiplexer = multiplexer;
    this.#callbacks = callbacks;
    this.#clone = clone;
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
    if (this.#callbacks.added) {
      this.#callbacks.added(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc));
    }
  }
  addedBefore(_id: ID, doc: T, before?: ID) {
    if (this.#callbacks.addedBefore) {
      this.#callbacks.addedBefore(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc), before);
    }
  }

  movedBefore(_id: ID, before: ID | undefined) {
    if (this.#callbacks.movedBefore) {
      this.#callbacks.movedBefore(_id, before);
    }
  }

  changed(_id: ID, fields: Partial<T>) {
    if (this.#callbacks.changed) {
      this.#callbacks.changed(_id, this.nonMutatingCallbacks ? fields : this.#clone(fields));
    }
  }

  removed(_id: ID) {
    if (this.#callbacks.removed) {
      this.#callbacks.removed(_id);
    }
  }
}
