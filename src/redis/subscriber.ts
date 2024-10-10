
import {
  OrderedDict,
} from "../orderedDict.js";

import { AsynchronousQueue } from "../queue.js";
import {
  ObserveDriver,
  ObserveMultiplexerInterface,
  ObserveOptions,
  stringId,
  Stringable
} from "../types.js";

import type { Document, Collection } from "mongodb";
import { getChannels } from "./getChannels.js";
import { RedisFindOptions, RedisMessage, RedisSubscriber } from "./types.js";
import { Events, RedisPipe, Strategy } from "./constants.js";
import { SubscriptionManager } from "./manager.js";
import { extractIdsFromSelector, getStrategy } from "./utils.js";
import { FindCursorWithDescription } from "./types.js";
import { diffQueryOrderedChanges, makeChangedFields } from "../diff.js";
import { NestedProjectionOfTSchema, unionOfProjections } from "mongo-collection-helpers";

export type RedisObserverDriverOptions<
  T extends { _id: Stringable },
  SortT = {}
> = ObserveOptions<T>
& {
  ordered: boolean,

  /** When set to true (the default), we'll only notify the multiplexer of changes to the projected fields - the selector fields will be monitored to determine eligibility and can still trigger added/removed. If set to false we'll include all  */
  strictRelevance?: boolean,

  /** An implemenation of Meteor Minimongo's Matcher */
  Matcher: any,

  /** An implementation of Meteor Minimongo's Sorter */
  Sorter: any,

  /** Something that takes a projection and returns a transform function that will pick only the relevant fields of that projection */
  compileProjection: (projection: Document) => (doc: T | (T & SortT) ) => Exactly<T, T>

  // this is just for testing
  manager: SubscriptionManager
} & RedisFindOptions;

export type Exactly<T, U> = T extends U ? U extends T ? T : never : never;

export class RedisObserverDriver<
  T extends { _id: Stringable },
  SortT extends Document = Document,
  FilterT extends Document = Document,

  // because we get a message containing a doc with a mixed projection (sort fields, filter fields and projection)
  // it would be very easy to accidentally send a document to the multiplexer that contains far too many fields
  // the `Exactly<T, T>` ensures that we're calling the `this.#projectionFn` everywhere
  ET extends Omit<Exactly<Omit<T, "_id">, Omit<T, "_id">>, "_id"> = Omit<Exactly<Omit<T, "_id">, Omit<T, "_id">>, "_id">
> implements ObserveDriver <T>, RedisSubscriber<T, SortT, FilterT> {
  #cursor: FindCursorWithDescription<T>;
  #collection: Collection<T & SortT & FilterT>;
  #ordered: boolean;
  #options: RedisObserverDriverOptions<T, SortT>;
  #matcher: any;
  #queue = new AsynchronousQueue();
  #strategy: string;
  #manager: SubscriptionManager;
  #comparator: ((doc1: Document | undefined, doc2: Document | undefined) => number) | undefined;
  #projectionFn: ReturnType<RedisObserverDriverOptions<T, SortT>["compileProjection"]>

  // the *combined* projection is the combination of sort and regular projection fields. it does *NOT* include filter fields
  // only the SubscriptionManager needs the filter fields projection, this is provided by the `get completeProjection()` getter.
  #combinedProjection: NestedProjectionOfTSchema<T & SortT>
  #sortProjection: NestedProjectionOfTSchema<SortT> | undefined;
  #completeProjection: NestedProjectionOfTSchema<T & SortT & FilterT> | undefined;
  #sortProjectionFn: (projection: Document) => SortT;
  #transform: (doc: any) => ET;

  // down the road, we might merge sortDocs and docs - currently docs is totally unused and we rely on the multiplexer to track the current document
  #docs: OrderedDict<T["_id"], SortT & T> | undefined;
  // #sortDocs contains the document ID + the fields necessary to evaluate the sort.
  #sortDocs: OrderedDict<T["_id"], SortT> | undefined;
  #strictRelevance: boolean;
  #multiplexer: ObserveMultiplexerInterface<T["_id"], ET> | undefined;

  #channels: string[];
  #mapTransform: (projection: Document) => T = doc => doc as T;

  static MAX_SORT_LENGTH = 1000;

  get _queue() {
    return this.#queue;
  }

  constructor(
    cursor: FindCursorWithDescription<T>,
    collection: Collection<T & SortT & FilterT>,
    options: RedisObserverDriverOptions<T, SortT>
  ) {
    if (options.cloneCursor !== false) {
      this.#cursor = cursor.clone();
    }
    else {
      this.#cursor = cursor;
    }
    if (options.retainCursorMap !== false && cursor._mapTransform) {
      this.#cursor.map(cursor._mapTransform);
      this.#mapTransform = cursor._mapTransform as (doc: Document) => T;
    }
    this.#ordered = options.ordered;
    this.#collection = collection;

    this.#options = options;
    this.#channels = [];

    this.#manager = options.manager;

    const channelsFromOptions = getChannels(collection.collectionName, options);
    this.#strategy = getStrategy(this.#cursor.cursorDescription.filter, this.#cursor.cursorDescription.options);
    this.#channels = this.#getChannels(channelsFromOptions);
    this.#strictRelevance = options.strictRelevance || true;
    if (this.#cursor.cursorDescription.options.sort) {
      this.#comparator = new options.Sorter(this.#cursor.cursorDescription.options.sort).getComparator();
      this.#sortProjection = Object.fromEntries(Object.entries(this.#cursor.cursorDescription.options.sort).map(([key]) => [key, 1])) as NestedProjectionOfTSchema<SortT>
      // @ts-expect-error
      this.#sortProjectionFn = options.compileProjection(this.#sortProjection) as (doc: T & SortT & FilterT) => SortT;
      this.#combinedProjection = unionOfProjections<T & SortT>([
        this.#sortProjection as NestedProjectionOfTSchema<T & SortT>,
        (this.#cursor.cursorDescription.options.projection || {})  as NestedProjectionOfTSchema<T & SortT>
      ]);
    }
    else {
      this.#sortProjectionFn = (doc) => ({} as SortT);
      this.#combinedProjection = this.#cursor.cursorDescription.options.projection as NestedProjectionOfTSchema<T & SortT>;
    }
    // even if we don't care about order (e.g., a client side subscription) we'll still need an ordered dict when using limit + sort, wild!
    // Only #processLimitSortMessage will access this.#sortDocs
    this.#sortDocs = this.#strategy === Strategy.LIMIT_SORT ? new OrderedDict() : undefined;
    this.#projectionFn = this.#cursor.cursorDescription.options.projection
      ? options.compileProjection(this.#cursor.cursorDescription.options.projection)
      // If we have no projection defined, we want the entire document - if we want the entire document T and Exactly<T, T> are equivalent
      : (doc: T | (SortT & T)) => doc as unknown as Exactly<T, T>
    this.#matcher = this.#cursor.cursorDescription.filter ? new options.Matcher(this.#cursor.cursorDescription.filter) : undefined;
    this.#transform = options.transform || ((doc) => doc as ET);
  }

  get channels() {
    return this.#channels;
  }

  get collection() {
    return this.#collection;
  }

  get completeProjection() {
    if (!this.#completeProjection) {
      let projection = this.#cursor.cursorDescription.options.projection || {};
      projection = this.#matcher ? this.#matcher.combineIntoProjection(projection) : projection;
      if (this.#sortProjection) {
        this.#completeProjection = unionOfProjections([projection, this.#sortProjection]);
      }
      else {
        this.#completeProjection = projection;
      };
    }
    return this.#completeProjection;
  }

  process(channel: string, message: RedisMessage<T & SortT>, options?: { optimistic?: boolean }): void | Promise<void> {
    const runner = options?.optimistic ? this.#queue.runTask.bind(this.#queue) : this.#queue.queueTask.bind(this.#queue);
    return runner(async () => {
      if (this.#strategy === Strategy.DEDICATED_CHANNELS) {
        await this.#processDedicatedChannelMessage(message);
      }
      else if (this.#strategy === Strategy.LIMIT_SORT) {
        await this.#processLimitSortMessage(message);
      }
      else if (this.#strategy === Strategy.DEFAULT) {
        await this.#processDefaultMessage(message);
      }
      if (options?.optimistic) {
        await this.#multiplexer?.flush(true);
      }
    });
  }


  #getChannels(channels: string[]) {
    switch (this.#strategy) {
      case Strategy.DEFAULT:
      case Strategy.LIMIT_SORT:
        return channels;
      case Strategy.DEDICATED_CHANNELS:
        const ids = Array.from(extractIdsFromSelector(this.#cursor.cursorDescription.filter || {})) as string[];
        return ids.map(id => `${this.#collection.collectionName}::${typeof id === "string" ? id : stringId(id)}`);
      default:
        throw new Error(
            `Strategy could not be found: ${this.#strategy}`
        );
    }
  }

  #isDocEligible(doc: T) {
    if (!this.#matcher) {
      return true;
    }
    return this.#matcher.documentMatches(doc).result;
  }

  async #has(id: Stringable): Promise<boolean> {
    if (this.#docs) {
      return this.#docs.has(id);
    }
    if (this.#multiplexer) {
      return this.#multiplexer.has(id);
    }
    throw new Error("Neither docs, nor multiplexer");
  }

  async #get(id: Stringable): Promise<ET | undefined> {
    if (this.#docs) {
      const doc = this.#docs.get(id);
      if (!doc) {
        return;
      }
      const { _id, ...docMinusId } = this.#projectionFn(doc);
      return docMinusId as unknown as ET;
    }
    if (this.#multiplexer) {
      const multiDoc = await this.#multiplexer.get(id);
      if (!multiDoc) {

        return;
      }
      return multiDoc;
    }
    throw new Error("Neither docs, nor multiplexer");
  }

  #projectionFnWithoutId(doc: T | (T & SortT)): ET {
    const { _id, ...rest } = this.#projectionFn(doc);
    return this.#transform(rest) as unknown as ET;
  }

  #projectionFnWithMapWithoutId(doc: T) {
    const projected = this.#projectionFn(doc);
    const { _id, ...rest } = this.#mapTransform(projected);
    return this.#transform(rest);
  }
  async #size(): Promise<number> {
    if (this.#docs) {
      return this.#docs.size;
    }
    if (!this.#multiplexer) {
      throw new Error("Neither docs nor multiplexer");
    }
    return (await this.#multiplexer.getDocs()).size;
  }


  async #processDefaultMessage(message: RedisMessage<T & SortT>) {
    if (!this.#multiplexer) {
      throw new Error("We received a message on a subscriber with no multiplexer");
    }
    if (message[RedisPipe.EVENT] === Events.INSERT) {
      const doc = message[RedisPipe.DOC];
      if (!await this.#has(doc._id) && this.#isDocEligible(doc)) {
        this.#multiplexer.added(doc._id, this.#projectionFnWithMapWithoutId(doc));
      }
      return;
    }
    if (message[RedisPipe.EVENT] === Events.UPDATE) {
      const doc = message[RedisPipe.DOC];
      if (this.#isDocEligible(doc)) {
        const projectedDoc = this.#projectionFnWithMapWithoutId(doc);
        if (await this.#has(doc._id)) {
          const original = await this.#get(doc._id);
          if (!original) {
            throw new Error("somehow between #has and #get we lots the doc");
          }
          const { changes, hasChanges } = makeChangedFields(
            original,
            projectedDoc
          );
          if (hasChanges) {
            this.#multiplexer.changed(doc._id, changes);
          }
        }
        else {
          this.#multiplexer.added(doc._id, projectedDoc);
        }
      }
      else if (await this.#has(doc._id)){
        this.#multiplexer.removed(doc._id);
      }
      return;
    }
    else if (message[RedisPipe.EVENT] === Events.REMOVE) {
      const doc = message[RedisPipe.DOC];
      this.#multiplexer.removed(doc._id);
      return;
    }
    throw new Error("not implemented");
  }

  #requery = async (newCommer: { _id: T["_id"] } | (T & SortT)) => {
    // we're going to pull in the IDs of all the docs matching the query.
    // If the doc is new, we'll go fetch the actual document (with the full projection)
    //    if the doc is the newcommer - we already have the relevant fields
    // removes and moves don't require any new fields and we shouldn't see any other changes.
    if (!this.#sortDocs) {
      throw new Error("Can't requery without a local ordered dict");
    }
    const newDocs = new OrderedDict<T["_id"], {}>();
    await this.#cursor.project<{ _id: T["_id"] }>({ _id: 1 }).forEach((doc) => {
      newDocs.add(doc._id, {});
    });

    diffQueryOrderedChanges(
      [...this.#sortDocs.keys()].map(id => ({ _id: id })),
      [...newDocs.keys()].map(id => ({ _id: id })),
      {
        observes(hookName) {
          return hookName === "addedBefore" || hookName === "removed" || hookName === "movedBefore";
        },

        addedBefore: async (id, doc, before) => {
          const actualDoc = id === newCommer._id ? newCommer as T & SortT : await this.#collection.findOne(
            // @ts-expect-error
            { _id: id },
            {
              projection: unionOfProjections([
                this.#cursor.cursorDescription.options.projection as NestedProjectionOfTSchema<T>,
                Object.fromEntries(Object.entries(this.#cursor.cursorDescription.options.sort || {}).map(([key]) => [key, 1])) as NestedProjectionOfTSchema<T>,
                this.#matcher._path
              ])
            }
          ) as T & SortT;
          if (!actualDoc) {
            return;
          }
          const projectedDoc = this.#projectionFnWithMapWithoutId(actualDoc);
          const sortProjectedDoc = this.#sortProjectionFn(actualDoc);
          // TODO: go get the actual document - this should only happen once per requery.
          this.#sortDocs?.add(id, sortProjectedDoc, before);
          this.#multiplexer?.addedBefore(id, projectedDoc, before);
        },

        removed: (id) => {
          const item = this.#sortDocs?.get(id);
          if (!item) {
            return;
          }
          this.#sortDocs?.remove(item);
          this.#multiplexer?.removed(item._id);
        },

        movedBefore:(id, before) => {
          const value = this.#sortDocs?.get(id);
          if (!value) {
            return;
          }
          this.#sortDocs?.moveBefore(id, before);
          this.#multiplexer?.movedBefore(id, before);
        },

        added(id, doc) {
          throw new Error("Can't be called");
        },

        changed(id, fields) {
          throw new Error("Can't be called");
        },
      }
    );
  }

  #handleLimitSortMaybeAdd = async (message: RedisMessage<T & SortT>) => {
    const options = this.#cursor.cursorDescription.options;
    const doc = message[RedisPipe.DOC] as T & SortT;
    if (!this.#sortDocs) {
      throw new Error("Can't use limit-sort strategy without a copy of the docs");
    }
    if (!this.#multiplexer) {
      throw new Error("Called process without a multiplexer");
    }

    if (!this.#comparator) {
      throw new Error("No comparator");
    }
    if (!this.#sortDocs.head || this.#comparator(doc, this.#sortDocs.head.value) < 0) {
      // we're before the first - if there's no skip, we just add it.
      // if there is a skip we need to requery, since we have no idea what the -1'th index is, we could be the new first.
      // TODO: performance optimisation - technically we just need to pull in the skip-1th entry and run a comparison
      if (options.skip) {
        await this.#requery(doc);
      }
      else {
        const oldHead = this.#sortDocs.head?.value;
        this.#sortDocs.add(
          doc._id,
          this.#sortProjectionFn(doc),
          this.#sortDocs.head?.key
        );
        this.#multiplexer.addedBefore(doc._id, this.#projectionFnWithMapWithoutId(doc), oldHead?._id);

        if (options.limit && this.#sortDocs.size > options.limit && this.#sortDocs.tail) {
          const tail = this.#sortDocs.tail;
          this.#sortDocs.remove(this.#sortDocs.tail.value);
          this.#multiplexer.removed(tail.value._id);
        }
      }
      return;
    }
    if (this.#sortDocs.tail && this.#comparator(doc, this.#sortDocs.tail.value) > 0) {
      // we're after the last - if there's a limit and we're beyond it, do nothing
      // if there's no limit, or we're not beyond it, add it at the end.
      if (options.limit && this.#sortDocs.size >= options.limit) {
        // do nothing
      }
      else {
        this.#sortDocs.add(doc._id, this.#sortProjectionFn(doc));
        this.#multiplexer?.addedBefore(doc._id, this.#projectionFnWithMapWithoutId(doc), undefined);
      }
      return;
    }

    // we're in the middle of the set - we don't "need" to requery
    // we can find where we belong in the set, and insert ourselves there
    // if we're a now over the limit, kick the last item.
    if (this.#sortDocs.size > RedisObserverDriver.MAX_SORT_LENGTH) {
      // an in memory sort might be really inefficient for large collections of docs
      // better to assume we're using indexes in mongo so it'll be more efficient
      await this.#requery(doc);
      return;
    }
    else {
      // bit cheaky - we'll never use this, sice we get it's index to find the next do.
      const sortableDoc = doc as unknown as SortT;
      const allDocs = [sortableDoc, ...this.#sortDocs.values()].sort(this.#comparator);
      const index = allDocs.indexOf(sortableDoc);
      const before = allDocs[index + 1];
      this.#sortDocs.add(this.#sortProjectionFn(doc), before);
      this.#multiplexer.addedBefore(doc._id, this.#projectionFnWithMapWithoutId(doc), before?._id);
      if (options.limit && this.#sortDocs.size > options.limit) {
        if (this.#sortDocs.tail) {
          const tail = this.#sortDocs.tail;
          this.#sortDocs.remove(tail.value);
          this.#multiplexer.removed(tail.value._id);
        }
      }
    }
  }

  #processLimitSortMessage = async (message: RedisMessage<T & SortT>) => {
    const options = this.#cursor.cursorDescription.options;
    if (!this.#sortDocs) {
      throw new Error("Can't use limit-sort strategy without a copy of the docs");
    }
    if (!this.#multiplexer) {
      throw new Error("Called process without a multiplexer");
    }
    if (message[RedisPipe.EVENT] === Events.INSERT) {
      const doc = message[RedisPipe.DOC];
      if (!this.#isDocEligible(doc)) {
        // if the doc isn't eligible, do nothing
        return;
      }
      await this.#handleLimitSortMaybeAdd(message);
      return;
    }

    if (message[RedisPipe.EVENT] === Events.UPDATE) {
      const doc = message[RedisPipe.DOC];

      if (!this.#isDocEligible(doc)) {
        // we're being removed or we don't care
        if (this.#sortDocs.has(doc._id)) {
          if (options.limit && this.#sortDocs.size >= options.limit) {
            await this.#requery(doc);
          }
          else {
            this.#sortDocs.remove(doc._id);
            this.#multiplexer.removed(doc._id);
          }
          // if we're being removed from the collection, follow removal steps
        }
        else if (options.skip) {
          await this.#requery(doc);
        }
        return;
      }
      else if (this.#sortDocs.has(doc._id)) {
        // we're being moved or updated. need to see if a sort field changed.
        // check if we're moving within the bounds
        //    if NOT (either direction) - we need to requery
        if (!this.#comparator) {
          throw new Error("should have a comparator");
        }
        if (
          this.#comparator(doc, this.#sortDocs.head?.value) < 0
          || this.#comparator(doc, this.#sortDocs.tail?.value) > 0
          || this.#sortDocs.size >= RedisObserverDriver.MAX_SORT_LENGTH
        ) {
          // TODO: efficiency gain by adding skip/limit checks
          await this.#requery(doc);

        }
        else {
          const existing = this.#sortDocs.get(doc._id);
          // TODO: this check should probably be above
          if (this.#comparator(doc, existing) !== 0) {
            const allDocs = [...this.#sortDocs.values()];
            const beforeSortIndex = allDocs.findIndex(({ _id }) => _id === doc._id);
            allDocs.sort(this.#comparator);
            const afterSortIndex = allDocs.findIndex(({ _id }) => _id === doc._id);
            const afterSortBefore = allDocs[afterSortIndex + 1];
            if (beforeSortIndex !== afterSortIndex) {
              this.#multiplexer.movedBefore(doc._id, afterSortBefore);
            }
          }
        }
        const original = await this.#get(doc._id);
        if (!original) {
          // this can happen if the requery kicks the document
          return;
        }
        const projectedDoc = this.#projectionFnWithMapWithoutId(doc);
        const { changes, hasChanges } = makeChangedFields(
          original,
          projectedDoc
        );
        if (hasChanges) {
          this.#multiplexer.changed(doc._id, changes);
        }
      }
      else {
        // we're being added.
        // if we're becoming part of the collection - follow the insert steps.
        await this.#handleLimitSortMaybeAdd(message);
      }
      return;
    }

    if (message[RedisPipe.EVENT] === Events.REMOVE) {
      const doc = message[RedisPipe.DOC];
      // if the doc isn't in the collection, do nothing
      // if there's no limit, or we're not at the limit, do nothing.
      // regardless of whether there is a skip, we do nothing
      const has = await this.#has(doc._id);
      if (has) {
        if (options.limit && (await this.#size()) >= options.limit) {
          await this.#requery(doc);
        }
        else {
          this.#sortDocs.remove(doc._id);
          this.#multiplexer?.removed(doc._id);
        }
      }
      else if (options.skip) {
        await this.#requery(doc);
      }
      return
    }
    throw new Error("not implemented");
  }

  #processDedicatedChannelMessage = async (message: RedisMessage<T & SortT>) => {
    if (!this.#multiplexer) {
      throw new Error("We received a message on a subscriber with no multiplexer");
    }
    if (message[RedisPipe.EVENT] === Events.INSERT) {
      const doc = message[RedisPipe.DOC];
      if (!await this.#has(doc._id) && this.#isDocEligible(doc)) {
        this.#multiplexer.added(doc._id, this.#projectionFnWithMapWithoutId(doc));
      }
    }

    else if (message[RedisPipe.EVENT] === Events.REMOVE && await this.#has(message[RedisPipe.DOC]._id)) {
      this.#multiplexer.removed(message[RedisPipe.DOC]._id);
    }
    else if (message[RedisPipe.EVENT] === Events.UPDATE) {
      const has = await this.#has(message[RedisPipe.DOC]._id);

      const doc = message[RedisPipe.DOC];
      const projectedDoc = this.#projectionFnWithMapWithoutId(doc);
      if (this.#isDocEligible(doc)) {
        if (has) {
          const original = await this.#get(message[RedisPipe.DOC]._id);
          if (!original) {
            throw new Error("Somehow an item was removed between has and get");
          }
          const { changes, hasChanges } = makeChangedFields(
            original,
            projectedDoc
          );

          if (hasChanges) {
            this.#multiplexer.changed(doc._id, changes);
          }
        }
        else {
          this.#multiplexer.added(doc._id, projectedDoc);
        }
      }
      else if (has) {
        this.#multiplexer.removed(doc._id);
      }
    }
  }

  async init(multiplexer: ObserveMultiplexerInterface<T["_id"], Omit<T, "_id">>): Promise<void> {
    this.#manager.attach<T, SortT, FilterT>(this);
    const localMultiplexer = multiplexer as unknown as ObserveMultiplexerInterface<T["_id"], ET>;
    this.#multiplexer = localMultiplexer;
    const cursor = this.#sortDocs && this.#sortProjection ? this.#cursor.project<T & SortT>(this.#combinedProjection): this.#cursor;

    if (!this.#options.suppressInitial) {
      await cursor.forEach(doc => {
        this.#queue.queueTask(() => {
          // the doc was transformed by the cursor map
          if (this.#ordered) {
            localMultiplexer.addedBefore(doc._id, this.#projectionFnWithoutId(doc), undefined);
          }
          else {
            localMultiplexer.added(doc._id, this.#projectionFnWithoutId(doc));
          }
          if (this.#sortDocs) {
            this.#sortDocs.set(doc._id, this.#sortProjectionFn(doc));
          }
        });
      });
      await this.#queue.flush();
    }
    this.#multiplexer.ready();
  }

  stop(): void {
    this.#manager.detach<T, SortT, FilterT>(this);
  }
}
