import { ObserveMultiplexer } from "./multiplexer.js";
import { Clone, ObserveChangesCallbacks, ObserveChangesObserver, ObserveHandle, Stringable, naiveClone } from "./types.js";

export class ObserveHandleImpl<
  T extends { _id: Stringable }
> implements ObserveChangesObserver<T>, ObserveHandle {
  static nextObserveHandleId: number = 1;
  _multiplexer: ObserveMultiplexer<T["_id"], T>;
  _id: number = ObserveHandleImpl.nextObserveHandleId++;
  _stopped: boolean = false;
  #callbacks: ObserveChangesCallbacks<T>;
  #clone: Clone = naiveClone;

  nonMutatingCallbacks: boolean;

  constructor(
    multiplexer: ObserveMultiplexer<T["_id"], T>,
    callbacks: ObserveChangesCallbacks<T>,
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

  observes(hookName: keyof ObserveChangesCallbacks<T>): boolean {
    return !!this.#callbacks[hookName];
  }

  added(_id: T["_id"], doc: Omit<T, "_id">) {
    if (this.#callbacks.added) {
      this.#callbacks.added(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc));
    }
  }
  addedBefore(_id: T["_id"], doc: Omit<T, "_id">, before?: T["_id"]) {
    if (this.#callbacks.addedBefore) {
      this.#callbacks.addedBefore(_id, this.nonMutatingCallbacks ? doc : this.#clone(doc), before);
    }
  }

  movedBefore(_id: T["_id"], before: T["_id"] | undefined) {
    if (this.#callbacks.movedBefore) {
      this.#callbacks.movedBefore(_id, before);
    }
  }

  changed(_id: T["_id"], fields: Partial<Omit<T, "_id">>) {
    if (this.#callbacks.changed) {
      this.#callbacks.changed(_id, this.nonMutatingCallbacks ? fields : this.#clone(fields));
    }
  }

  removed(_id: T["_id"]) {
    if (this.#callbacks.removed) {
      this.#callbacks.removed(_id);
    }
  }
}
