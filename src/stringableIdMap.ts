import { Stringable, fromStringId, stringId } from "./types.js";

export class StringableIdMap<T> extends Map<string, T> {
  constructor(entries?: [Stringable, T][]) {
    super(entries?.map(([key, value]) => [stringId(key), value]));
  }

  delete(key: Stringable): boolean {
    return super.delete(stringId(key));
  }
  get(key: Stringable): T | undefined {
    return super.get(stringId(key));
  }
  has(key: Stringable): boolean {
    return super.has(stringId(key));
  }
  set(key: Stringable, value: T): this {
    super.set(stringId(key), value);
    return this;
  }

  [Symbol.species]() {
    return StringableIdMap;
  }

  // @ts-expect-error
  forEach(callbackfn: (value: T, key: Stringable, map: StringableIdMap<T>) => void, thisArg?: any): void {
    super.forEach((value: T, key: string) => {
      callbackfn.call(thisArg, value, fromStringId(key), this);
    });
  }

  // @ts-expect-error
  [Symbol.iterator](): Iterator<[Stringable, T]> {
    return this.entries();
  }

  // @ts-expect-error
  entries(): IterableIterator<[Stringable, T]> {
    const superIterator = super.entries();
    return {
      next() {
        const next = superIterator.next();
        if (next.done) {
          return next;
        }
        console.log("from", next.value[0], fromStringId(next.value[0]));
        return {
          done: false,
          value: [fromStringId(next.value[0]), next.value[1]]
        };
      },
      [Symbol.iterator]() {
        return this;
      }
    };
  }
}
