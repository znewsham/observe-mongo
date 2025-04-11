import { applyChanges } from "./diff.js";
import { OrderedDict } from "./orderedDict.js";
import { StringableIdMap } from "./stringableIdMap.js";
import { CachingChangeObserver, Clone, OrderedObserveChangesCallbacks, SharedObserveChangesCallbacks, StringObjectWithoutID, Stringable, naiveClone } from "./types.js";

function assertIsOrderedDict<ID extends Stringable, T extends StringObjectWithoutID>(dict: OrderedDict<ID, T> | StringableIdMap<ID, T>): asserts dict is OrderedDict<ID, T> {

}

export class CachingChangeObserverImpl<
  ID extends Stringable,
  T extends StringObjectWithoutID
> implements CachingChangeObserver<ID, T> {
  #docs: OrderedDict<ID, T> | StringableIdMap<ID, T>;
  #ordered: boolean;
  #cloneDocuments: boolean;
  #clone: Clone;

  constructor({
    ordered,
    cloneDocuments = false,
    clone
  }: { 
    ordered: boolean, 
    cloneDocuments?: boolean,
    clone?: Clone
  }) {
    this.#ordered = ordered;
    this.#docs = ordered ? new OrderedDict<ID, T>() : new StringableIdMap<ID, T>();
    this.#cloneDocuments = cloneDocuments;
    this.#clone = clone || naiveClone;
  }

  forEach(iterator: (doc: T, id: ID) => void): void {
    this.#docs.forEach((item, key) => {
      iterator(item, key);
    });
  }

  added(id: ID, doc: T): void {
    if (this.#docs.has(id)) {
      throw new Error("This document already exists");
    }
    const docToStore = this.#cloneDocuments && doc ? this.#clone(doc) : doc;
    this.#docs.set(id, docToStore);
  }

  addedBefore(id: ID, doc: T, before?: ID): void {
    if (this.#docs.has(id)) {
      throw new Error("This document already exists");
    }
    if (before && !this.#docs.has(before)) {
      throw new Error("Adding a document before one that doesn't exist");
    }
    const docToStore = this.#cloneDocuments && doc ? this.#clone(doc) : doc;
    if (!this.#ordered) {
      // this is an odd situation - but in some cases (e.g., with a limit + sort)
      // the driver may choose to use these callbacks even though they don't care about the order
      // it's weird, but do we really care?
      this.#docs.set(id, docToStore);
      return;
    }
    assertIsOrderedDict(this.#docs);
    this.#docs.add(id, docToStore, before);
  }

  changed(id: ID, fields: Partial<T>): void {
    const existing = this.#docs.get(id);
    if (!existing) {
      throw new Error("Changed a document that doesn't exist");
    }
    applyChanges(existing, fields);
  }

  movedBefore(id: ID, before?: ID): void {
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

  removed(id: ID): void {
    this.#docs.delete(id);
  }

  observes(hookName: "added" | keyof OrderedObserveChangesCallbacks<ID, T> | keyof SharedObserveChangesCallbacks<ID, T>): boolean {
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

  indexOf(id: ID) {
    if (!this.#ordered) {
      throw new Error("Can't get indexOf a document in an unordered map");
    }
    assertIsOrderedDict(this.#docs);
    return this.#docs.indexOf(id);
  }

  size() {
    return this.#docs.size;
  }

  get(id: ID) {
    const doc = this.#docs.get(id);
    return doc;
  }

  getDocs() : OrderedDict<ID, T> | StringableIdMap<ID, T> {
    return this.#docs;
  }
}
