import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { applyRedis } from "../lib/redis/publish.js";

function makeMockCollection() {
  const callbacks = new Map();
  const collection = {
    collectionName: "tests",
    callbacks,
    on(event, cb) {
      callbacks.set(event, cb);
      return collection;
    }
  };
  return collection;
}

describe("applyRedis", () => {
  it("should publish for deleteOne when _id is 0 (regression: TODO 6)", async () => {
    // The buggy `if (_id)` truthy check skipped publishing for any deleteOne
    // whose _id happens to be falsy (0, "", false). The fix uses an
    // explicit null/undefined comparison so falsy-but-real ids still emit.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.deleteOne.success");
    await cb({ args: [{}, {}], _id: 0 });

    assert.ok(emitMock.mock.callCount() > 0, "emit should fire when _id: 0 is deleted");
  });

  it("should publish for updateOne when _id is 0 (regression: TODO 6)", async () => {
    // Same falsy-id issue on the updateOne path: `if (!_id) return;` would
    // skip publishing. The fix tightens the guard to null/undefined.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.updateOne.success");
    await cb({
      args: [{}, { $set: { value: 1 } }, {}],
      _id: 0
    });

    assert.ok(emitMock.mock.callCount() > 0, "emit should fire when _id: 0 is updated");
  });

  it("should publish for insertOne when insertedId is 0 (regression: TODO 6)", async () => {
    // The insert path computed `resultOrig?.insertedId ? [...] : []` — an
    // _id of 0 was treated as "no insert" and never published.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.insertOne");
    await cb({
      args: [{ _id: 0 }, {}],
      resultOrig: { acknowledged: true, insertedId: 0 },
      error: undefined
    });

    assert.ok(emitMock.mock.callCount() > 0, "emit should fire when _id: 0 is inserted");
  });
});
