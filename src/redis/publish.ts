import {
  RedisMessage,
  RedisUpdate,
  RedisInsert,
  RedisDelete,
} from "./types.js";

import {
  RedisOptions,
  Events,
  RedisPipe,
} from "./constants.js"

import { getChannels } from "./getChannels.js";

import type { BulkWriteError, HookedCollection } from "mongo-collection-hooks";
import { Stringable } from "../types.js";


export const uid = `${Math.random()}`.slice(2);

export type PublishOptions = {
  uid: Stringable,
  emit: (channel: string, event: RedisMessage, options: RedisOptions) => Promise<void>
}

export { getChannels };

export async function handleRemove(
  defaultChannel: string,
  _ids: Stringable[],
  options: RedisOptions,
  publishOptions: PublishOptions
) {
  if (options?.pushToRedis !== false) {
    await Promise.all(_ids.map(async (_id) => {
      const channels = getChannels(defaultChannel, options, [_id]);
      await Promise.all(channels.map(async (channel) => {
        const event: RedisDelete<{ _id: Stringable }> = {
          [RedisPipe.EVENT]: Events.REMOVE,
          [RedisPipe.DOC]: { _id },
          [RedisPipe.UID]: publishOptions.uid
        };
        await publishOptions.emit(channel, event, options);
      }));
    }));
  }
}

export async function handleUpdate(
  defaultChannel: string,
  _ids: Stringable[],
  fields: string[],
  options: RedisOptions,
  publishOptions: PublishOptions
) {
  if (options?.pushToRedis !== false) {
    await Promise.all(_ids.map(async (_id) => {
      const channels = getChannels(defaultChannel, options, [_id]);
      await Promise.all(channels.map(async (channel) => {
        const event: RedisUpdate<{ _id: Stringable }> = {
          [RedisPipe.EVENT]: Events.UPDATE,
          [RedisPipe.DOC]: { _id },
          // @ts-expect-error we're going to trust that fields is the top level keys
          [RedisPipe.FIELDS]: fields,
          [RedisPipe.UID]: publishOptions.uid
        };
        await publishOptions.emit(channel, event, options);
      }));
    }));
  }
}

export async function handleInserts(
  defaultChannel: string,
  insertedIds: Stringable[],
  options: RedisOptions,
  publishOptions: PublishOptions
) {
  if (options?.pushToRedis !== false) {
    const channels = getChannels(defaultChannel, options);
    await Promise.all(insertedIds.map(async (id) => {
      await Promise.all(channels.map(async (channel) => {
        const event: RedisInsert<{ _id: Stringable }> = {
          [RedisPipe.EVENT]: Events.INSERT,
          [RedisPipe.DOC]: { _id: id },
          [RedisPipe.UID]: publishOptions.uid
        };
        await publishOptions.emit(channel, event, options);
      }));
    }));
  }
}


export function applyRedis<TSchema extends Document & { _id: Stringable }>(
  collection: HookedCollection<TSchema>,
  publishOptions: PublishOptions
) {
  const defaultChannel = collection.collectionName;
  collection.on("after.insertOne", async ({
    args: [, options],
    resultOrig,
    error
  }) => {
    let insertedIds = resultOrig?.insertedId ? [resultOrig.insertedId] : [];
    if ((error as BulkWriteError)?.insertedIds) {
      insertedIds = Object.values(error.insertedIds);
    }
    else if (error) {
      return;
    }
    await handleInserts(defaultChannel, insertedIds as unknown as string[], options as RedisOptions, publishOptions);
  }, { tags: ["redis"] });

  collection.on("after.insertMany", async ({
    args: [, options],
    resultOrig,
    error
  }) => {
    let insertedIds = Object.values(resultOrig?.insertedIds || {});
    if ((error as BulkWriteError)?.insertedIds) {
      insertedIds = Object.values(error.insertedIds);
    }
    else if (error) {
      return;
    }
    await handleInserts(defaultChannel, insertedIds as unknown as Stringable[], options as RedisOptions, publishOptions);
  }, { tags: ["redis"] });

  collection.on("after.deleteOne", async ({
    args: [, options],
    _id
  }) => {
    if (_id) { // it's entirely possible for deleteOne to not find a document to delete
      await handleRemove(defaultChannel, [_id as unknown as Stringable], options as RedisOptions, publishOptions);
    }
  }, { tags: ["redis"], includeId: true });

  collection.on("after.deleteMany", async ({
    args: [, options],
    _ids
  }) => {
    // TODO: what about partial deletion?
    await handleRemove(defaultChannel, _ids as unknown as Stringable[], options as RedisOptions, publishOptions);
  }, { tags: ["redis"], includeIds: true });

  collection.on("after.updateOne", async ({
    args: [, mutator, options],
    _id,
  }) => {
    if (!_id) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }
    const fields = Array.from(new Set(Object.values(mutator).flatMap($mutator => Object.keys($mutator).map(key => key.split(".")[0]))));
    // TODO: what about partial deletion?
    await handleUpdate(defaultChannel, [_id as unknown as Stringable], fields, options as RedisOptions || {}, publishOptions);
  }, { tags: ["redis"], includeId: true });

  collection.on("after.updateMany", async ({
    args: [, mutator, options],
    _ids
  }) => {
    const fields = Array.from(new Set(Object.values(mutator).flatMap($mutator => Object.keys($mutator).map(key => key.split(".")[0]))));
    // TODO: what about partial deletion?
    await handleUpdate(defaultChannel, _ids as unknown as Stringable[], fields, options as RedisOptions || {}, publishOptions);
  }, { tags: ["redis"], includeIds: true });
}
