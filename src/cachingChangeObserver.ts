import { applyChanges } from "./diff.js";
import { OrderedDict } from "./orderedDict.js";
import { StringableIdMap } from "./stringableIdMap.js";
import { CachingChangeObserver, OrderedObserveChangesCallbacks, SharedObserveChangesCallbacks, Stringable } from "./types.js";

function assertIsOrderedDict<T extends { _id: Stringable }>(dict: OrderedDict<T> | StringableIdMap<T>): asserts dict is OrderedDict<T> {

}

export class CachingChangeObserverImpl<T extends { _id: Stringable }> implements CachingChangeObserver<T> {
  #docs: OrderedDict<T> | StringableIdMap<T>;
  #ordered: boolean;

  constructor({
    ordered
  }: { ordered: boolean}) {
    this.#ordered = ordered;
    this.#docs = ordered ? new OrderedDict<T>() : new StringableIdMap<T>();
  }

  forEach(iterator: (doc: T, index: number) => void): void {
    let index = 0;
    this.#docs.forEach(item => {
      iterator(item, index++);
    });
  }

  added(id: T["_id"], doc: T): void {
    this.#docs.set(id, doc);
  }

  addedBefore(id: T["_id"], doc: T, before?: Stringable): void {
    if (!this.#ordered) {
      // this is an odd situation - but in some cases (e.g., with a limit + sort)
      // the driver may choose to use these callbacks even though they don't care about the order
      // it's weird, but do we really care?
      this.#docs.set(id, doc);
      return;
    }
    assertIsOrderedDict(this.#docs);
    this.#docs.add(doc, before === undefined ? undefined : this.#docs.get(before));
  }

  changed(id: T["_id"], fields: Partial<T>): void {
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
    this.#docs.moveBefore(doc, beforeDoc);
  }

  removed(id: T["_id"]): void {
    this.#docs.delete(id);
  }

  observes(hookName: "added" | keyof OrderedObserveChangesCallbacks<T> | keyof SharedObserveChangesCallbacks<T>): boolean {
    if (hookName === "added") {
      return !this.#ordered;
    }
    if (hookName === "addedBefore" || hookName === "movedBefore") {
      return this.#ordered;
    }
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
    return this.#docs.get(id);
  }

  getDocs() : OrderedDict<T> | StringableIdMap<T> {
    return this.#docs;
  }
}
