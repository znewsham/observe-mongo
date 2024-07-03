import type { Collection, ObjectId, Document, FindCursor, Filter } from "mongodb";

import {
  Events,
} from "./constants.js";
import { Stringable } from "../types.js";
import { NestedProjectionOfTSchema, WithCursorDescription } from "mongo-collection-helpers";

export type FindCursorWithDescription<T> = Omit<FindCursor<T>, "clone"> & WithCursorDescription<T> & {

  clone(): FindCursorWithDescription<T>
}

export type RedisInsert<T extends { _id: Stringable }> = {
  e: typeof Events.INSERT,
  d: T,
  u: string,
};

export type RedisUpdate<T extends { _id: Stringable }> = {
  e: typeof Events.UPDATE,
  d: T,
  f: (keyof T & string)[],
  u: string
}

export type RedisDelete<T extends { _id: Stringable }> = {
  e: typeof Events.REMOVE,
  d: { _id: T["_id"] },
  u: string
}

export type RedisMessage<T extends { _id: Stringable } = { _id: Stringable }> = RedisUpdate<T> | RedisInsert<T> | RedisDelete<T>;

export type RedisSubscriber<T extends { _id: Stringable } = { _id: Stringable }> = {
  channels: string[],
  collection: Pick<Collection<T>, "findOne">,
  completeProjection: Document,
  process(channel: string, message: RedisMessage<T>, options: { optimistic: boolean }): void;
};

export type PubSubManager = {
  subscribe(channel: string, handler: (message: RedisMessage) => void): void;
  unsubscribe(channel: string, handler: (message: RedisMessage) => void): void;
}


export type RedisFindOptions = {
  channel?: string,
  channels?: string[],
  namespace?: string,
  namespaces?: string[],
}
