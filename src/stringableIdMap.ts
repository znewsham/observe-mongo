import { Stringable, fromStringId, stringId } from "./types.js";

export class StringableIdMap<ID extends Stringable, T> extends Map<ID | string, T> {
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

  keys(): MapIterator<ID | string> {
    const iterator = super.keys();
    // @ts-ignore - vscode doesn't mind this, but tsc does
    return {
      next() {
        const next = iterator.next();
        if (next.done) {
          return next;
        }
        return { next: false, value: fromStringId(next.value as string) as ID}
      },
      [Symbol.iterator]() {
        return this;
      }
    }
  }

  forEach(callbackfn: (value: T, key: ID, map: StringableIdMap<ID, T>) => void, thisArg?: any): void {
    super.forEach((value: T, key: ID | string) => {
      callbackfn.call(thisArg, value, fromStringId(key as string) as ID, this);
    });
  }

  [Symbol.iterator](): MapIterator<[ID, T]> {
    return this.entries();
  }

  entries(): MapIterator<[ID, T]> {
    const superIterator = super.entries();
    // @ts-ignore - vscode doesn't mind this, but tsc does
    return {
      next() {
        const next = superIterator.next();
        if (next.done) {
          return next;
        }
        return {
          done: false,
          value: [fromStringId(next.value[0] as string) as ID, next.value[1]]
        };
      },
      [Symbol.iterator]() {
        return this;
      }
    };
  }
}
