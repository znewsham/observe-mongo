import { Stringable, stringId } from "./types.js";

class Item<T> {
  value: T;
  next: Item<T> | undefined;
  prev: Item<T> | undefined;

  constructor(value: T) {
    this.value = value;
  }
}

export class OrderedDict<T extends { _id: Stringable }> implements Iterable<T> {
  #keysToItems = new Map<string, Item<T>>();
  #head: Item<T> | undefined;
  #tail: Item<T> | undefined;
  constructor(iterable?: Iterable<T>) {
    if (iterable) {
      for (let item of iterable) {
        this.add(item);
      }
    }
  }

  get head() {
    return this.#head;
  }

  get tail() {
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
      if (doc === item.value) {
        return index;
      }
      index++;
    }
    return -1;
  }

  moveBefore(value: T, before?: T) {
    const valueId = stringId(value._id);
    const beforeId = before && stringId(before?._id);
    const beforeItem = beforeId && this.#keysToItems.get(beforeId);
    const item = this.#keysToItems.get(valueId);
    if (!beforeItem) {
      throw new Error("Before item doesn't exist");
    }
    if (!item) {
      throw new Error("Item doesn't exist");
    }
    this.remove(value);
    this.add(value, before);
  }

  add(value: T, before?: T) {
    const beforeId = before && stringId(before?._id);
    const valueId = stringId(value._id);
    const beforeItem = beforeId && this.#keysToItems.get(beforeId);
    if (this.#keysToItems.get(valueId)) {
      throw new Error("Item already exists");
    }
    const newItem = new Item(value);
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

  remove(value: T) {
    return this.delete(value._id);
  }

  [Symbol.iterator](): Iterator<T> {
    let head = this.#head;
    return {
      next() {
        const current = head;
        head = head?.next;
        if (current) {
          return { value: current.value, done: false };
        }
        return { value: undefined, done: true };
      }
    }
  }

  forEach(iterator: (item: T, index: number) => void): void {
    let index = 0;
    for(let item of this) {
      if (item) {
        iterator(item, index++);
      }
    }
  }

  set(id: Stringable, doc: T) {
    const { _id, ...docWithoutId } = doc;
    this.add({ _id: id, ...docWithoutId } as T);
  }

  get(id: Stringable) {
    return this.#keysToItems.get(stringId(id))?.value;
  }

  has(id: Stringable) {
    return this.#keysToItems.has(stringId(id));
  }
}
