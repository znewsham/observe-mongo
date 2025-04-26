import type { FindCursor } from "mongodb";
import { FindCursorWithOptionalMap, ObserveDriver, ObserveOptions, Stringable } from "./types.js";
import { OrderedDict } from "./orderedDict.js";
import { diffQueryOrderedChanges, diffQueryUnorderedChanges } from "./diff.js";
import { ObserveMultiplexerInterface } from "./types.js";
import { StringableIdMap } from "./stringableIdMap.js";

const DEFAULT_POLLING_INTERVAL = 10_000;

export class PollingDriver<T extends { _id: Stringable }> implements ObserveDriver<T> {
  #cursor: Pick<FindCursorWithOptionalMap<T>, "forEach" | "map" | "rewind">;
  #pollingInterval: NodeJS.Timeout | undefined;
  #pollingIntervalTime = DEFAULT_POLLING_INTERVAL;
  #ordered: boolean;
  #multiplexer: ObserveMultiplexerInterface<T["_id"], Omit<T, "_id">> | undefined;
  #options: ObserveOptions<T>;
  #running: boolean = false;
  constructor(
    cursor: FindCursorWithOptionalMap<T>,
    _collection: any,
    options: ObserveOptions<T> & { ordered: boolean, pollingInterval?: number }
  ) {
    if (options.cloneCursor !== false) {
      this.#cursor = cursor.clone();
    }
    else {
      this.#cursor = cursor;
    }
    if (options.cloneCursor !== false && options.retainCursorMap !== false && cursor._mapTransform) {
      this.#cursor.map(cursor._mapTransform);
    }
    if (options.pollingInterval) {
      this.#pollingIntervalTime = options.pollingInterval;
    }
    this.#ordered = options.ordered;
    this.#options = options;
  }

  async init(multiplexer: ObserveMultiplexerInterface<T["_id"], Omit<T, "_id">>): Promise<void> {
    this.#multiplexer = multiplexer;
    await this.#cursor.forEach(doc => {
      const { _id, ...restOfDoc } = doc;
      if (_id === undefined) {
        throw new Error("Can't observe documents without an _id")
      }
      if (this.#ordered) {
        multiplexer.addedBefore(_id, restOfDoc, undefined);
      }
      else {
        multiplexer.added(_id, restOfDoc);
      }
    });
    this.#multiplexer.ready();
    this.#startPolling();
  }

  #startPolling() {
    if (this.#pollingIntervalTime < 0) {
      return;
    }
    this.#pollingInterval = setInterval(async () => {
      if (this.#running) {
        return;
      }
      this.#running = true;
      try {
        await this._poll();
      }
      finally {
        this.#running = false;
      }
    }, this.#pollingIntervalTime);
    this.#pollingInterval.unref();
  }

  get _cursor() {
    return this.#cursor;
  }

  // It's annoying that the driver and the multiplexer need to maintain separate docs maps
  // but they probably do, either that or this poll function would need to use the same queue as the multiplexer
  // this is a viable option, but it would couple them more tightly than I want, the benefit would be a reduction in memory
  // not a huge reduction since we don't clone between the driver and the multiplexer

  // this member is public so that certain types (e.g., local) can inherit from it and use it
  async _poll() {
    if (!this.#multiplexer) {
      throw new Error("Can't be missing a multiplexer");
    }
    const newDocs = this.#ordered ? new OrderedDict<T["_id"], Omit<T, "_id">>() : new StringableIdMap<T["_id"], Omit<T, "_id">>();
    this.#cursor.rewind();
    await this.#cursor.forEach((doc) => {
      const { _id, ...rest } = doc;
      newDocs.set(_id, rest);
    });
    await this.#multiplexer.flush();
    if (this.#ordered) {
      diffQueryOrderedChanges<T>(
        Array.from((await this.#multiplexer.getDocs()).entries()).map(([_id, doc]) => ({ _id, ...doc }) as T),
        Array.from(newDocs.entries()).map(([_id, doc]) => ({ _id, ...doc }) as T),
        this.#multiplexer,
        {
          equals: this.#options.equals,
          clone: this.#options.clone,
        }
      );
    }
    else {
      diffQueryUnorderedChanges<T["_id"], T>(
        await this.#multiplexer.getDocs() as StringableIdMap<T["_id"], T>,
        newDocs as StringableIdMap<T["_id"], T>,
        this.#multiplexer,
        {
          equals: this.#options.equals,
          clone: this.#options.clone,
        }
      );
    }
    await this.#multiplexer.flush();
  }

  stop(): void {
    if (this.#pollingInterval) {
      clearInterval(this.#pollingInterval);
    }
  }
}
