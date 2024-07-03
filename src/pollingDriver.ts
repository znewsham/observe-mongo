import type { FindCursor } from "mongodb";
import { ObserveDriver, ObserveOptions, Stringable } from "./types.js";
import { OrderedDict } from "./orderedDict.js";
import { diffQueryOrderedChanges, diffQueryUnorderedChanges } from "./diff.js";
import { ObserveMultiplexerInterface } from "./types.js";
import { StringableIdMap } from "./stringableIdMap.js";


export class PollingDriver<T extends { _id: Stringable }> implements ObserveDriver<T> {
  #cursor: Pick<FindCursor<T>, "forEach">;
  #pollingInterval: NodeJS.Timeout | undefined;
  #pollingIntervalTime = 5000;
  #ordered: boolean;
  #multiplexer: ObserveMultiplexerInterface<T> | undefined;
  #options: ObserveOptions<T>;
  #running: boolean = false;
  // #docs: OrderedDict<T> | StringableIdMap<T>
  constructor(
    cursor: FindCursor<T>,
    _collection: any,
    options: ObserveOptions<T> & { ordered: boolean, pollingInterval?: number }
  ) {
    this.#cursor = cursor.clone();
    if (options.pollingInterval) {
      this.#pollingIntervalTime = options.pollingInterval;
    }
    this.#ordered = options.ordered;
    // this.#docs = options.ordered ? new OrderedDict() : new StringableIdMap();
    this.#options = options;
  }

  async init(multiplexer: ObserveMultiplexerInterface<T>): Promise<void> {
    this.#multiplexer = multiplexer;
    await this.#cursor.forEach(doc => {
      if (this.#ordered) {
        multiplexer.addedBefore(doc._id, doc, undefined);
      }
      else {
        multiplexer.added(doc._id, doc);
      }
      // this.#docs.set(doc._id, doc);
    });
    this.#multiplexer.ready();
    this.#startPolling();
  }

  #startPolling() {
    this.#pollingInterval = setInterval(async () => {
      if (this.#running) {
        return;
      }
      this.#running = true;
      try {
        await this.#poll();
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
  async #poll() {
    // TODO: pause polling
    if (!this.#multiplexer) {
      throw new Error("Can't be missing a multiplexer");
    }
    const newDocs = this.#ordered ? new OrderedDict<T>() : new StringableIdMap<T>();
    await this.#cursor.forEach((doc) => {
      newDocs.set(doc._id, doc);
    });
    await this.#multiplexer.flush();
    if (this.#ordered) {
      diffQueryOrderedChanges<T>(
        Array.from(await this.#multiplexer.getDocs() as OrderedDict<T>),
        Array.from(newDocs as OrderedDict<T>),
        this.#multiplexer,
        {
          equals: this.#options.equals,
          clone: this.#options.clone,
        }
      );
    }
    else {
      diffQueryUnorderedChanges<T>(
        await this.#multiplexer.getDocs() as StringableIdMap<T>,
        newDocs as StringableIdMap<T>,
        this.#multiplexer,
        {
          equals: this.#options.equals,
          clone: this.#options.clone,
        }
      );
    }
  }

  stop(): void {
    clearInterval(this.#pollingInterval);
  }
}
