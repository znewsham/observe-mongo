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

import type { BulkWriteError, HookedCollection, ExternalBeforeAfterEvent, CommonDefinition } from "mongo-collection-hooks";
import type { Stringable } from "../types.js";
import type { Document, InferIdType, ModifyResult, UpdateResult, WithId } from "mongodb";


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
    await Promise.all(insertedIds.map(async (id) => {
      // it's pretty unusual, but not impossible for us to have an observer on a single ID which hasn't been inserted yet
      // optimistic UX (and potentially any reactivity) will break in that case, if we don't get the ID scoped channel
      const channels = getChannels(defaultChannel, options, [id]);
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

export function idFromMaybeResult<T extends Document>(result: null | undefined | WithId<T> | UpdateResult<T> | ModifyResult<T>): InferIdType<T> | undefined {
  if (!result) {
    return undefined;
  }
  if ("_id" in result) {
    return result._id as InferIdType<T>;
  }
  if ("ok" in result && ! ("_id" in result)) {
    return result.value?._id;
  }
}


export function applyRedis<
  TSchema extends Document & { _id?: Stringable },
  ExtraEvents extends Record<string, ExternalBeforeAfterEvent<CommonDefinition & { result: any }>> = {},
>(
  collection: Pick<HookedCollection<TSchema, ExtraEvents>, "on" | "collectionName">,
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

  collection.on("after.deleteOne.success", async ({
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

  collection.on("after.updateOne.success", async ({
    args: [, mutator, options],
    _id,
  }) => {
    if (!_id) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }
    const fields = Array.from(new Set(Object.values(mutator).flatMap($mutator => Object.keys($mutator).map(key => key.split(".")[0]))));
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

  collection.on("after.findOneAndDelete.success", async ({
    result,
    args: [, options],
  }) => {
    if (!result) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }
    const _id = idFromMaybeResult(result);
    if (!_id) {
      return;
    }

    await handleRemove(defaultChannel, [_id], options as RedisOptions, publishOptions);
  }, { tags: ["redis"] });

  collection.on("after.findOneAndUpdate.success", async ({
    result,
    args: [, mutator, options],
  }) => {
    if (!result) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }
    const fields = Array.from(new Set(Object.values(mutator).flatMap($mutator => Object.keys($mutator).map(key => key.split(".")[0]))));

    const _id = idFromMaybeResult(result);
    if (!_id) {
      return;
    }
    await handleUpdate(defaultChannel, [_id], fields, options as RedisOptions || {}, publishOptions);
  }, { tags: ["redis"] });

  collection.on("after.findOneAndReplace.success", async ({
    result,
    args: [, , options],
  }) => {
    if (!result) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }

    const _id = idFromMaybeResult(result);
    if (!_id) {
      return;
    }
    // debatable - we're going to consider a replacement to be a remove + insert, otherwise it's hard to know which fields changed
    await handleRemove(defaultChannel, [_id], options as RedisOptions, publishOptions);
    await handleInserts(defaultChannel, [_id], options as RedisOptions, publishOptions);
  }, { tags: ["redis"] });

  collection.on("after.replaceOne.success", async ({
    result,
    args: [, , options],
  }) => {
    if (!result) { // it's entirely possible for updateOne to not find a document to delete
      return;
    }

    const _id = idFromMaybeResult(result as WithId<TSchema> | UpdateResult<TSchema>);
    if (!_id) {
      return;
    }
    // debatable - we're going to consider a replacement to be a remove + insert, otherwise it's hard to know which fields changed
    await handleRemove(defaultChannel, [_id], options as RedisOptions, publishOptions);
    await handleInserts(defaultChannel, [_id], options as RedisOptions, publishOptions);
  }, { tags: ["redis"] });
}
