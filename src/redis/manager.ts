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

type SimpleStringable = string | number | ObjectId | Date;

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

    // TODO: we should check if the fields intersect with the completeProjection
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
