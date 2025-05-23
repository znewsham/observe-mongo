import { CachingChangeObserverImpl } from "./cachingChangeObserver.js";
import { OrderedDict } from "./orderedDict.js";
import { AsynchronousQueue } from "#asyncQueue";
import { StringableIdMap } from "./stringableIdMap.js";
import { CachingChangeObserver, ObserveChangesCallbackKeys, ObserveChangesCallbackNames, ObserveChangesObserver, ObserveMultiplexerInterface, StringObjectWithoutID, Stringable } from "./types.js";

type ObserveMultiplexerOptions = {
  ordered: boolean,
  onStop?: Function,
  cloneDocuments?: boolean,
  clone?: (doc: any) => any
}

export class ObserveMultiplexer<
  ID extends Stringable,
  T extends StringObjectWithoutID = StringObjectWithoutID
> implements ObserveChangesObserver<ID, T>, ObserveMultiplexerInterface<ID, T>{
  _ordered: boolean;
  #handles = new Set<ObserveChangesObserver<ID, T>>();

  #pendingAdds: number = 0;
  #queue: AsynchronousQueue = new AsynchronousQueue();
  #cache: CachingChangeObserver<ID, T>;
  #isReady: boolean = false;
  #ready: Promise<void>;
  #onStop: Function | undefined;
  #stopped: boolean = false;
  #hookNames = new Map<string, Set<ObserveChangesObserver<ID, T>>>();

  // this is exposed purely for testing to avoid dealing with unexpected race conditions
  private _driver: any;

  // @ts-expect-error
  #resolve: Function;
  constructor({
    ordered,
    onStop,
    // in general, cloneDocuments must always be true
    // this is not because of add (where cloneDocuments is used) but because of changed, which mutates the fields of the document itself
    // I don't think there's any situation where we'd want this to be false...
    cloneDocuments = true,
    clone
  }: ObserveMultiplexerOptions) {
    this._ordered = ordered;
    this.#cache = new CachingChangeObserverImpl<ID, T>({
      ordered,
      cloneDocuments,
      clone
    });
    this.#ready = new Promise((resolve, reject) => {
      this.#resolve = resolve;
    });
    this.#onStop = onStop;
  }

  async addHandleAndSendInitialAdds(handle: ObserveChangesObserver<ID, T>): Promise<void> {
    if (this.#stopped) {
      throw new Error("This multiplexer is stopped");
    }
    this.#pendingAdds++;

    // the first handle, #sendAdds will do nothing, but after ready they'll all be sent
    // the second time the inverse
    await Promise.all([this.#queue.runTask(() => {
      this.#handles.add(handle);
      ObserveChangesCallbackNames.forEach((key) => {
        if (handle.observes(key)) {
          if (!this.#hookNames.has(key)) {
            this.#hookNames.set(key, new Set([handle]));
          }
          else {
            const set = this.#hookNames.get(key);
            set?.add(handle);
          }
        }
      });

      return this.#sendAdds(handle);
    }, "initialAdds"), this.#ready]);
    this.#pendingAdds--;
  }

  removeHandle(handle: ObserveChangesObserver<ID, T>) {
    handle
    this.#handles.delete(handle)
    this.#hookNames.forEach((handleSet, hookName) => {
      handleSet.delete(handle);
      if (handleSet.size === 0) {
        this.#hookNames.delete(hookName);
      }
    });
    if (this.#handles.size === 0 && this.#pendingAdds === 0) {
      this._stop();
    }
  }

  callbackNames(): string[] {
    return this._ordered ? ["addedBefore", "changed", "movedBefore", "removed"] : ["added", "changed", "removed"]
  }

  #sendAdds = (handle: ObserveChangesObserver<ID, T>) => {
    this.#cache.forEach((doc, _id) => {
      if (!this.#handles.has(handle)) {
        throw Error("handle got removed before sending initial adds!");
      }

      if (this._ordered) {
        handle.addedBefore(_id, doc, undefined);
      }
      else {
        handle.added(_id, doc);
      }
    });
  }

  _stop() {
    if (!this.#isReady) {
      throw new Error("How'd we stop when we aren't ready?");
    }
    this.#stopped = true;
    this.#queue.destroy();
    this.#onStop?.();
  }

  _isReady() {
    return this.#isReady;
  }

  ready() {
    this.#queue.queueTask(() => {
      this.#isReady = true;
      this.#resolve();
    }, "ready");
  }

  onFlush(cb: () => {}) {
    this.#queue.queueTask(() => {
      if (!this.#isReady) {
        throw new Error("only call onFlush on a multiplexer that will be ready");
      }
      cb();
    }, "flush")
  }

  observes(hookName: ObserveChangesCallbackKeys): boolean {
    if (hookName === "addedBefore" || hookName === "movedBefore") {
      return this._ordered;
    }
    if (hookName === "added") {
      return !this._ordered;
    }
    // we need the cache to be up to date - so regardless of whether the handles observe the events, we need everything
    return true;
  }

  has(id: ID): Promise<boolean> {
    return this.#queue.runTask(() => this.#cache.getDocs().has(id), "has");
  }

  getDocs(): Promise<OrderedDict<ID, T> | StringableIdMap<ID, T>> {
    return this.#queue.runTask(() => this.#cache.getDocs(), "getDocs");
  }

  get(id: ID): Promise<T | undefined> {
    return this.#queue.runTask(() => this.#cache.get(id), "get");
  }

  async flush(downstream?: boolean): Promise<void> {
    await this.#queue.flush();
  }

  // #region observer hooks

  movedBefore(id: ID, before: ID | undefined) {
    this.#queue.queueTask(async () => {
      if (this.#handles.size === 0) {
        return;
      }
      this.#cache.movedBefore(id, before);
      await Promise.all(Array.from(this.#handles.values()).map(handle => handle.observes("movedBefore") && handle.movedBefore(id, before)));
    }, "movedBefore");
  }

  addedBefore(id: ID, doc: T, before?: ID) {
    this.#queue.queueTask(async () => {
      if (this.#handles.size === 0) {
        return;
      }
      this.#cache.addedBefore(id, doc, before);
      await Promise.all(Array.from(this.#handles.values()).map(async (handle) => {
        handle.observes("addedBefore") && await handle.addedBefore(id, doc, before);

        // this is an oddly specific meteor constrait - I have no idea why
        handle.observes("added") && await handle.added(id, doc);
      }));
    }, "addedBefore");
  }

  added(id: ID, doc: T) {
    this.#queue.queueTask(async () => {
      if (this.#handles.size === 0) {
        return;
      }
      this.#cache.added(id, doc);
      await Promise.all(Array.from(this.#handles.values()).map(async handle => {
        if (handle.observes("added")) {
          await handle.added(id, doc);
        }
        else if (handle.observes("addedBefore")) {
          await handle.addedBefore(id, doc, undefined);
        }
      }));
    }, "added");
  }

  changed(id: ID, fields: Partial<T>) {
    this.#queue.queueTask(async () => {
      if (this.#handles.size === 0) {
        return;
      }
      this.#cache.changed(id, fields);
      await Promise.all(Array.from(this.#handles.values()).map(async handle => handle.observes("changed") && await handle.changed(id, fields)));
    }, "changed");
  }

  removed(id: ID) {
    this.#queue.queueTask(async () => {
      if (this.#handles.size === 0) {
        return;
      }
      this.#cache.removed(id);
      await Promise.all(Array.from(this.#handles.values()).map(async handle => handle.observes("removed") && await handle.removed(id)));
    }, "removed");
  }

  // #endregion
}
