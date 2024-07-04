import { applyChanges } from "./diff.js";
import { OrderedDict } from "./orderedDict.js";
import { StringableIdMap } from "./stringableIdMap.js";
import { CachingChangeObserver, OrderedObserveChangesCallbacks, SharedObserveChangesCallbacks, Stringable } from "./types.js";

function assertIsOrderedDict<T extends { _id: Stringable }>(dict: OrderedDict<T["_id"], T> | StringableIdMap<T>): asserts dict is OrderedDict<T["_id"], T> {

}

export class CachingChangeObserverImpl<T extends { _id: Stringable }> implements CachingChangeObserver<T> {
  #docs: OrderedDict<T["_id"], T> | StringableIdMap<T>;
  #ordered: boolean;

  constructor({
    ordered
  }: { ordered: boolean}) {
    this.#ordered = ordered;
    this.#docs = ordered ? new OrderedDict<T["_id"], T>() : new StringableIdMap<T>();
  }

  forEach(iterator: (doc: T, index: number) => void): void {
    let index = 0;
    this.#docs.forEach((item, key) => {
      iterator(item, index++);
    });
  }

  added(id: T["_id"], doc: Omit<T, "_id">): void {
    if (this.#docs.has(id)) {
      throw new Error("This document already exists");
    }
    this.#docs.set(id, { _id: id, ...doc } as T);
  }

  addedBefore(id: T["_id"], doc: Omit<T, "_id">, before?: Stringable): void {
    if (this.#docs.has(id)) {
      throw new Error("This document already exists");
    }
    if (before && !this.#docs.has(before)) {
      throw new Error("Adding a document before one that doesn't exist");
    }
    if (!this.#ordered) {
      // this is an odd situation - but in some cases (e.g., with a limit + sort)
      // the driver may choose to use these callbacks even though they don't care about the order
      // it's weird, but do we really care?
      this.#docs.set(id, { _id: id, ...doc } as T);
      return;
    }
    assertIsOrderedDict(this.#docs);
    this.#docs.add(id, { _id: id, ...doc } as T, before);
  }

  changed(id: T["_id"], fields: Partial<Omit<T, "_id">>): void {
    const existing = this.#docs.get(id);
    if (!existing) {
      throw new Error("Changed a document that doesn't exist");
    }
    applyChanges(existing, fields);
  }

  movedBefore(id: T["_id"], before?: Stringable): void {
    if (!this.#ordered) {
      // this is an odd situation - but in some cases (e.g., with a limit + sort)
      // the driver may choose to use these callbacks even though they don't care about the order
      // it's weird, but do we really care?
      return;
    }
    assertIsOrderedDict(this.#docs);
    const beforeDoc = before !== undefined ? this.#docs.get(before) : undefined;
    if (before !== undefined && !beforeDoc) {
      throw new Error("Moving the doc to before one that doesn't exist");
    }
    const doc = this.#docs.get(id);
    if (!doc) {
      throw new Error("Doc doesn't exist");
    }
    this.#docs.moveBefore(id, before);
  }

  removed(id: T["_id"]): void {
    this.#docs.delete(id);
  }

  observes(hookName: "added" | keyof OrderedObserveChangesCallbacks<T> | keyof SharedObserveChangesCallbacks<T>): boolean {
    // even though technically we only care about the relevant ordered vs unordered hooks
    // it seems unreasonable to push that logic out, when unordered can be considered a strict subset of ordered
    // i.e., ignore moves and convert addedBefore to added
    // if (hookName === "added") {
    //   return !this.#ordered;
    // }
    // if (hookName === "addedBefore" || hookName === "movedBefore") {
    //   return this.#ordered;
    // }
    return true;
  }

  indexOf(id: Stringable) {
    if (!this.#ordered) {
      throw new Error("Can't get indexOf a document in an unordered map");
    }
    assertIsOrderedDict(this.#docs);
    return this.#docs.indexOf(id);
  }

  size() {
    return this.#docs.size;
  }

  get(id: Stringable) {
    const doc = this.#docs.get(id);
    return { _id: id, ...doc } as T;
  }

  getDocs() : OrderedDict<T["_id"], T> | StringableIdMap<T> {
    return this.#docs;
  }
}
