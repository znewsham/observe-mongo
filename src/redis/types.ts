import type { Collection, ObjectId, Document, FindCursor, Filter } from "mongodb";

import {
  Events,
  RedisPipe,
} from "./constants.js";
import { FindCursorWithOptionalMap, Stringable } from "../types.js";
import { NestedProjectionOfTSchema, WithCursorDescription } from "mongo-collection-helpers";

export type FindCursorWithDescription<T> = Omit<FindCursorWithOptionalMap<T>, "clone"> & WithCursorDescription<T> & {
  clone(): FindCursorWithDescription<T>
}

export type RedisInsert<T extends { _id: Stringable }> = {
  [RedisPipe.EVENT]: typeof Events.INSERT,
  [RedisPipe.DOC]: T,
  [RedisPipe.UID]: Stringable,
};

export type RedisUpdate<T extends { _id: Stringable }> = {
  [RedisPipe.EVENT]: typeof Events.UPDATE,
  [RedisPipe.DOC]: T,
  [RedisPipe.FIELDS]: (keyof T & string)[],
  [RedisPipe.UID]: Stringable
}

export type RedisDelete<T extends { _id: Stringable }> = {
  [RedisPipe.EVENT]: typeof Events.REMOVE,
  [RedisPipe.DOC]: { _id: T["_id"] },
  [RedisPipe.UID]: Stringable
}

export type RedisMessage<T extends { _id: Stringable } = { _id: Stringable }> = RedisUpdate<T> | RedisInsert<T> | RedisDelete<T>;

export type RedisSubscriber<
  T extends { _id: Stringable } = { _id: Stringable },
  SortT extends Document = Document,
  FilterT extends Document = Document
> = {
  channels: string[],
  collection: Pick<Collection<T & SortT & FilterT>, "findOne">,
  completeProjection: Document,
  process(channel: string, message: RedisMessage<T & SortT & FilterT>, options: { optimistic: boolean }): void;
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
  disableOplog?: boolean
}
