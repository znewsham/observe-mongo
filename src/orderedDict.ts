import { StringObjectWithoutID, Stringable, stringId } from "./types.js";

class Item<ID, T> {
  value: T;
  key: ID;
  next: Item<ID, T> | undefined;
  prev: Item<ID, T> | undefined;

  constructor(key: ID, value: T) {
    this.value = value;
    this.key = key;
  }
}
export type Exactly<T, U> = T extends U ? U extends T ? T : never : never;

type NoID<T> = T extends { _id: any } ? never : T;

export class OrderedDict<
  ID extends Stringable,
  T extends Exactly<StringObjectWithoutID, StringObjectWithoutID>
> implements Iterable<[Stringable, T]> {
  #keysToItems = new Map<string, Item<ID, T>>();
  #head: Item<ID, T> | undefined;
  #tail: Item<ID, T> | undefined;

  get head(): Item<ID, T> | undefined {
    return this.#head;
  }

  get tail(): Item<ID, T> | undefined {
    return this.#tail;
  }

  get size() {
    return this.#keysToItems.size;
  }

  indexOf(id: Stringable): number {
    let index = 0;
    const item = this.#keysToItems.get(stringId(id));
    if (!item) {
      return -1;
    }
    for (const doc of this) {
      if (doc[1] === item.value) {
        return index;
      }
      index++;
    }
    return -1;
  }

  moveBefore(key: ID, before?: ID) {
    const valueId = stringId(key);
    const item = this.#keysToItems.get(valueId);
    if (!item) {
      throw new Error("Item doesn't exist");
    }
    this.delete(key);
    this.add(key, item.value, before);
  }

  add(key: ID, value: T, before?: ID) {
    const beforeId = before && stringId(before);
    const valueId = stringId(key);
    const beforeItem = beforeId && this.#keysToItems.get(beforeId);
    if (before && !beforeItem) {
      throw new Error("Before item doesn't exist");
    }
    if (this.#keysToItems.get(valueId)) {
      throw new Error("Item already exists");
    }
    const newItem = new Item(key, value);
    if (!beforeItem) {
      if (!this.#head) {
        this.#head = newItem;
      }
      else {
        const prev = this.#tail || this.#head;
        this.#tail = newItem;
        prev.next = this.#tail;
        this.#tail.prev = prev;
      }
    }
    else {
      const prev = beforeItem.prev;
      if (prev) {
        prev.next = newItem;
      }
      else {
        if (beforeItem === this.#head) {
          this.#head = newItem;
        }
        else {
          throw new Error("Somehow we have no prev and we're not the head")
        }
      }
      newItem.next = beforeItem;
      beforeItem.prev = newItem;
      newItem.prev = prev;
    }
    this.#keysToItems.set(valueId, newItem);
  }

  delete(id: Stringable) {
    const actualItem = this.#keysToItems.get(stringId(id));
    if (!actualItem) {
      return;
    }
    const next = actualItem.next;
    const prev = actualItem.prev;
    if (actualItem === this.#head) {
      this.#head = next;
    }
    if (actualItem === this.#tail) {
      this.#tail = prev;
    }
    if (prev) {
      prev.next = next;
    }
    if (next) {
      next.prev = prev;
    }
    this.#keysToItems.delete(stringId(id));
  }

  remove(key: ID) {
    return this.delete(key);
  }

  values(): IterableIterator<T> {
    const iterator = this[Symbol.iterator]();
    return {
      next() {
        const current = iterator.next();
        if (current.done) {
          return { value: undefined, done: true };
        }
        return {
          value: current.value[1], done: false
        };
      },
      [Symbol.iterator]() { return this; }
    }
  }

  keys(): IterableIterator<Stringable> {
    const iterator = this[Symbol.iterator]();
    return {
      next() {
        const current = iterator.next();
        if (current.done) {
          return { value: undefined, done: true };
        }
        return {
          value: current.value[0], done: false
        };
      },
      [Symbol.iterator]() { return this; }
    }
  }
  entries(): IterableIterator<[Stringable, T]> {
    return this[Symbol.iterator]();
  }

  // gnarly - but this ensures we expose the same iterator signature as StringableIdMap
  [Symbol.iterator](): IterableIterator<[Stringable, T]> {
    let head = this.#head;
    return {
      next() {
        const current = head;
        head = head?.next;
        if (current) {
          return { value: [current.key, current.value], done: false };
        }
        return { value: undefined, done: true };
      },
      [Symbol.iterator]() { return this; }
    }
  }

  forEach(iterator: (item: T, key: Stringable) => void): void {
    for(let item of this) {
      if (item) {
        iterator(item[1], item[0]);
      }
    }
  }

  set(id: ID, doc: T) {
    this.add(id, doc);
  }

  get(id: ID) {
    return this.#keysToItems.get(stringId(id))?.value;
  }

  has(id: ID) {
    return this.#keysToItems.has(stringId(id));
  }
}
