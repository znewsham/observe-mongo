import { Stringable, fromStringId, stringId } from "./types.js";

export class StringableIdMap<ID extends Stringable, T> extends Map<string, T> {
  constructor(entries?: [ID, T][]) {
    super(entries?.map(([key, value]) => [stringId(key), value]));
  }

  delete(key: ID | string): boolean {
    return super.delete(stringId(key));
  }

  get(key: ID | string): T | undefined {
    return super.get(stringId(key));
  }

  has(key: ID | string): boolean {
    return super.has(stringId(key));
  }

  set(key: ID | string, value: T): this {
    super.set(stringId(key), value);
    return this;
  }

  [Symbol.species]() {
    return StringableIdMap;
  }

  // @ts-expect-error
  keys(): IterableIterator<ID> {
    const iterator = super.keys();
    return {
      next() {
        const next = iterator.next();
        if (next.done) {
          return next;
        }
        return { next: false, value: fromStringId(next.value) as ID}
      },
      [Symbol.iterator]() {
        return this;
      }
    }
  }

  // @ts-expect-error
  forEach(callbackfn: (value: T, key: ID, map: StringableIdMap<T>) => void, thisArg?: any): void {
    super.forEach((value: T, key: string) => {
      callbackfn.call(thisArg, value, fromStringId(key) as ID, this);
    });
  }

  // @ts-expect-error
  [Symbol.iterator](): Iterator<[ID, T]> {
    return this.entries();
  }

  // @ts-expect-error
  entries(): IterableIterator<[ID, T]> {
    const superIterator = super.entries();
    return {
      next() {
        const next = superIterator.next();
        if (next.done) {
          return next;
        }
        return {
          done: false,
          value: [fromStringId(next.value[0]) as ID, next.value[1]]
        };
      },
      [Symbol.iterator]() {
        return this;
      }
    };
  }
}
