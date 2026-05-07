import type { Collection, Filter, ObjectId, WithId, Document, EnhancedOmit } from "mongodb";

import { unionOfProjections } from "mongo-collection-helpers";

import {
  RedisOptions,
  Events,
  RedisPipe
} from "./constants.js";
import { PubSubManager, RedisMessage, RedisSubscriber } from "./types.js";
import { Stringable } from "../types.js";

type SubscriptionEntry = {
  subscribers: Set<RedisSubscriber>,
  collection: Pick<Collection, "findOne">,
  name: string,
  projection: Document,
  handle: (message: RedisMessage) => void
};

// Decides whether an UPDATE message's changed FIELDS overlap a channel's
// projection enough to warrant a findOne against the DB. Both sides are
// normalized to top-level segments via key.split(".")[0] so { a: 1 } and
// { "a.b": 1 } behave identically. For exclusion projections the logic is
// inverted: we fetch iff at least one changed field is NOT in the excluded
// set.
//
// Special cases:
//   {} — all fields, always fetch.
//   {_id: 1} — only _id, never fetch on a non-_id UPDATE.
//   {_id: 0} — exclude only _id, always fetch on any non-_id UPDATE.
function shouldFetchForFields(
  projection: Document,
  fields: string[] | undefined
): boolean {
  if (!fields) {
    return true;
  }
  const allKeys = Object.keys(projection);
  if (allKeys.length === 0) {
    return true;
  }
  const nonIdKeys = allKeys.filter(k => k !== "_id");
  let isExclusion: boolean;
  let projTopLevel: Set<string>;
  if (nonIdKeys.length === 0) {
    // Only _id is mentioned. Inclusion form ({_id: 1}) means *only* _id
    // is wanted; exclusion form ({_id: 0}) means everything except _id.
    const idValue = projection._id;
    isExclusion = idValue === 0 || idValue === false;
    projTopLevel = isExclusion ? new Set(["_id"]) : new Set();
  }
  else {
    const sampleValue = projection[nonIdKeys[0]];
    isExclusion = sampleValue === 0 || sampleValue === false;
    projTopLevel = new Set(nonIdKeys.map(k => k.split(".")[0]));
  }
  const fieldsTopLevel = fields.map(f => f.split(".")[0]);
  if (isExclusion) {
    return fieldsTopLevel.some(f => !projTopLevel.has(f));
  }
  return fieldsTopLevel.some(f => projTopLevel.has(f));
}

export class SubscriptionManager {
  #subscribers = new Map<string, SubscriptionEntry>();
  #pubSubManager: PubSubManager;
  #uid: string;

  constructor(pubSubManager: PubSubManager, uid?: string) {
    this.#pubSubManager = pubSubManager;
    this.#uid = uid || `${Math.random()}`.slice(2);
  }

  attach<
    T extends { _id: Stringable },
    SortT extends Document = Document,
    FilterT extends Document = Document
  >(subscriber: RedisSubscriber<T, SortT, FilterT>) {
    subscriber.channels.forEach((channel) => {
      if (!this.#subscribers.has(channel)) {
        const handle = (message: RedisMessage<{ _id: T["_id"] }>) => this.process(channel, message);
        this.#subscribers.set(channel, {
          handle,
          collection: subscriber.collection as unknown as Collection,
          name: channel,
          projection: subscriber.completeProjection,
          subscribers: new Set([subscriber as unknown as RedisSubscriber])
        });
        this.#pubSubManager.subscribe(channel, handle);
      }
      else {
        const entry = this.#subscribers.get(channel);
        if (!entry) {
          return; // impossible
        }
        entry.subscribers.add(subscriber as unknown as RedisSubscriber);
        entry.projection = unionOfProjections([entry?.projection, subscriber.completeProjection]);
      }
    });
  }

  detach<
    T extends { _id: Stringable },
    SortT extends Document = Document,
    FilterT extends Document = Document
  >(subscriber: RedisSubscriber<T, SortT, FilterT>) {
    subscriber.channels.forEach((channel) => {
      const entry = this.#subscribers.get(channel);
      if (!entry) {
        return;
      }
      entry.subscribers.delete(subscriber as unknown as RedisSubscriber);
      if (entry.subscribers.size === 0) {
        this.#subscribers.delete(channel);
        this.#pubSubManager.unsubscribe(channel, entry.handle);
      }
      else {
        entry.projection = unionOfProjections(
          [...entry.subscribers].map(s => s.completeProjection)
        );
      }
    });
  }

  async process<T extends { _id: Stringable }>(
    channel: string,
    message: RedisMessage<{ _id: T["_id"] }>,
    {
      optimistic = false
    }: { optimistic?: boolean } = {}
  ) {
    const entry = this.#subscribers.get(channel);
    if (!entry) {
      return ;// unsub race condition
    }
    if (!message[RedisPipe.EVENT]) {
      // this message isn't for us
      return;
    }
    if (message[RedisPipe.UID] === this.#uid && !optimistic) {
      // we should have already processed this
      return;
    }

    // @ts-expect-error
    const selector: Filter<T> = {
      _id: message[RedisPipe.DOC]._id
    };
    const collection: Collection<T> = entry.collection as Collection<T>;

    if (message[RedisPipe.EVENT] === Events.UPDATE) {
      const fields = message[RedisPipe.FIELDS] as string[] | undefined;
      if (!shouldFetchForFields(entry.projection, fields)) {
        return;
      }
    }

    const doc = message[RedisPipe.EVENT] === Events.REMOVE
      ? message[RedisPipe.DOC]
      : await collection.findOne<T>(selector, { projection: entry.projection });

    if (doc === null) {
      return; // the document was removed - we'll see a remove event shortly.
    }

    await Promise.all([...entry.subscribers].map((subscriber) => {
      return subscriber.process(channel, {
        ...message,
        // if doc is not a full T, it's a delete, which doesn't need it.
        [RedisPipe.DOC]: doc as T
      }, { optimistic });
    }));
  }
}
