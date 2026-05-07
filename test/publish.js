import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { applyRedis } from "../lib/redis/publish.js";
import { RedisPipe } from "../lib/redis/constants.js";

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

  it("should compute FIELDS from a pipeline-form mutator (regression: TODO 5)", async () => {
    // Pipeline-form update: an array of stages. Today's parser does
    // `Object.values(mutator).flatMap($m => Object.keys($m))` which on an
    // array yields the *operator names* (e.g., '$set'), not the affected
    // fields. The subscriber-side fetch filter then sees ['$set'] which
    // never matches a projection — the change is silently dropped.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.updateOne.success");
    await cb({
      args: [{}, [{ $set: { a: 1 } }, { $unset: ["b"] }], {}],
      _id: "x"
    });

    assert.ok(emitMock.mock.callCount() > 0, "should publish at least one message");
    const message = emitMock.mock.calls[0].arguments[1];
    assert.deepStrictEqual(
      [...(message[RedisPipe.FIELDS] || [])].sort(),
      ["a", "b"],
      "FIELDS should be the union of LHS keys across pipeline stages"
    );
  });

  it("should omit FIELDS for a pipeline with $replaceWith (regression: TODO 5)", async () => {
    // $replaceWith / $replaceRoot replaces the doc with an arbitrary
    // expression. The affected field set is not statically knowable, so
    // emit no FIELDS — the consumer (shouldFetchForFields) treats absent
    // fields as "always fetch", which is the safe behavior.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.updateOne.success");
    await cb({
      args: [{}, [{ $replaceWith: { a: "$x", b: 2 } }], {}],
      _id: "x"
    });

    assert.ok(emitMock.mock.callCount() > 0, "should still publish");
    const message = emitMock.mock.calls[0].arguments[1];
    assert.strictEqual(
      message[RedisPipe.FIELDS],
      undefined,
      "FIELDS should be absent so subscribers re-fetch"
    );
  });

  it("should not crash when a mutator operand is null (regression: TODO 5)", async () => {
    // Defensive: an operator whose value is null (e.g., {$set: null}) used
    // to throw `Object.keys(null)` and propagate up the hook chain.
    const collection = makeMockCollection();
    const emitMock = mock.fn(async () => {});
    applyRedis(collection, { uid: "u", emit: emitMock });

    const cb = collection.callbacks.get("after.updateOne.success");
    await assert.doesNotReject(
      cb({ args: [{}, { $set: null }, {}], _id: "x" }),
      "publisher should not throw on a null operator value"
    );
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
