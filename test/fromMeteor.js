import { FakeCollection, FakeFindCursor } from "mongo-collection-helpers/testHelpers";
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { observeChanges } from "../lib/observe.js";

/**
 * @typedef {import("../lib/index.js").Observer}
 */

class FlushedCollection extends FakeCollection {
  async insertOne(doc, ...args) {
    if (!doc._id) {
      doc._id = `${Math.random()}`;
    }
    try {
      const res = await super.insertOne(doc, ...args);
      return res.insertedId;
    }
    finally {
      await setTimeout(10);
    }
  }
  async updateOne(filter, mutator, options) {
    if (typeof filter === "string") {
      filter = { _id: filter };
    }
    try {
      if (!Object.keys(mutator)[0].startsWith("$")) {
        return await super.replaceOne(filter, mutator, options);
      }
      return await super.updateOne(filter, mutator, options);
    }
    finally {
      await setTimeout(10);
    }
  }
  async deleteOne(filter, ...args) {
    if (typeof filter === "string") {
      filter = { _id: filter };
    }
    try {
      return await super.deleteOne(filter, ...args);
    }
    finally {
      await setTimeout(10);
    }
  }

  async findOne(filter, ...args) {
    if (typeof filter === "string") {
      filter = { _id: filter };
    }
    return super.findOne(filter, ...args);
  }

  find(filter, options) {
    if (typeof filter === "string") {
      filter = { _id: filter };
    }
    if (!filter) {
      // TODO this should be fixed on the FakeFindCursor
      filter = {};
    }
    const cursor = super.find(filter, options);
    return new ObservableFindCursor(cursor._data, filter, { ...options, collection: this })
  }
}

/**
 * @implements
 */
class ObservableFindCursor extends FakeFindCursor {
  async observeChanges(callbacks, options) {
    return observeChanges(
      this,
      undefined,
      callbacks,
      {
        ...options,
        pollingInterval: 1,
      }
    );
  }
}
function makeCollection() {
  return new FlushedCollection();
}

const Meteor = {};

function withCallbackLogger(callbacksArray, _isServer, fn) {
  const mocks = callbacksArray.map(() => mock.fn());
  const callbacks = Object.fromEntries(callbacksArray.map((callback, index) => [callback, mocks[index]]));
  callbacks.expectResult = function expectResult(callbackName, result) {
    const mock = callbacks[callbackName].mock;

    assert.strictEqual(mock.callCount(), 1, "Should have been called");
    assert.deepEqual(
      mock.calls[0].arguments,
      result,
      "arguments should match"
    );
  };

  callbacks.expectResultUnordered = function expectResultUnordered(calls) {
    calls.every(({ callback, args }) => {
      const mock = callbacks[callback].mock;
      assert.ok(mock.callCount() > 0, "Should have been called");
      const foundCall = mock.calls.find((call) => {
        try {
          assert.deepEqual(call.arguments, args);
          return true;
        }
        catch {
          return false;
        }
      });
      assert.ok(foundCall, "Found a matching call");
    });
  };

  callbacks.expectResultOnly = function expectResultOnly(call, args) {
    callbacks.expectResult(call, args);
    const count = mocks.map(mock => mock.mock.callCount()).reduce((a, b) => a + b);
    assert.strictEqual(count, 1, "No other calls");
    callbacks[call].mock.resetCalls();
  }

  callbacks.expectNoResult = async function expectNoResult(fn) {
    const beforeCount = mocks.map(mock => mock.mock.callCount()).reduce((a, b) => a + b);
    if (typeof fn !== "function") {
      await setTimeout(10);
    }
    else {
      await fn();
    }
    await setTimeout(10);
    const afterCount = mocks.map(mock => mock.mock.callCount()).reduce((a, b) => a + b);
    assert.strictEqual(afterCount - beforeCount, 0, `no new calls: ${beforeCount} vs ${afterCount}`);
    if (typeof fn !== "function" && fn) {
      assert.strictEqual(beforeCount, fn, `All calls consumed: ${beforeCount}`);
    }
  };
  return fn(callbacks);
}

describe("observeChanges From Meteor", () => {
  [
    { added: "added", forceOrdered: true },
    { added: "added", forceOrdered: false },
    { added: "addedBefore", forceOrdered: false }
  ].forEach((options) => {
    const added = options.added;
    const forceOrdered = options.forceOrdered;

    it(`observeChanges - single id - basics ${added}${forceOrdered ? " force ordered" : ""}`, async () => {
      const c = makeCollection();
      const counter = 0;
      const callbacks = [added, "changed", "removed"];
      if (forceOrdered) {
        callbacks.push("movedBefore");
      }
      await withCallbackLogger(
        callbacks,
        Meteor.isServer,
        async (logger) => {
          const barid = await c.insertOne({ thing: "stuff" });
          const fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });
          const handle = await c.find(fooid).observeChanges(logger);
          if (added === "added") {
            logger.expectResult(added, [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]);
          }
          else {
            logger.expectResult(
              added,
              [fooid, { noodles: "good", bacon: "bad", apples: "ok" }, null]
            );
          }
          await c.updateOne(fooid, { noodles: "alright", potatoes: "tasty", apples: "ok" });
          logger.expectResult(
            "changed",
            [fooid, { noodles: "alright", potatoes: "tasty", bacon: undefined }]
          );

          await c.deleteOne(fooid);
          logger.expectResult("removed", [fooid]);

          await logger.expectNoResult(async () => {
            await c.deleteOne(barid);
            await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });
          });

          handle.stop();

          const badCursor = c.find({}, { projection:  { noodles: 1, _id: 0 } });
          await assert.rejects(() => {
            return badCursor.observeChanges(logger);
          });
        }
      );
    });
  });

  it("observeChanges - callback isolation", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handles = [];
      const cursor = c.find();
      handles.push(await cursor.observeChanges(logger));
      // fields-tampering observer
      handles.push(await cursor.observeChanges({
        added(id, fields) {
          fields.apples = "green";
        },
        changed(id, fields) {
          fields.apples = "green";
        }
      }));

      const fooid = await c.insertOne({ apples: "ok" });
      await logger.expectResult("added", [fooid, { apples: "ok" }]);

      await c.updateOne(fooid, { apples: "not ok" });
      await logger.expectResult("changed", [fooid, { apples: "not ok" }]);

      assert.strictEqual((await c.findOne(fooid)).apples, "not ok");

      handles.forEach((handle) => {
        handle.stop();
      });
    });
  });

  it("observeChanges - single id - initial adds", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });
      const handle = await c.find(fooid).observeChanges(logger);
      await logger.expectResult("added", [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]);
      await logger.expectNoResult(1);
      handle.stop();
    });
  });


  it("observeChanges - unordered - initial adds", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });
      const barid = await c.insertOne({ noodles: "good", bacon: "weird", apples: "ok" });
      const handle = await c.find().observeChanges(logger);
      logger.expectResultUnordered([
        {
          callback: "added",
          args: [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]
        },
        {
          callback: "added",
          args: [barid, { noodles: "good", bacon: "weird", apples: "ok" }]
        }
      ]);
      await logger.expectNoResult(2);
      handle.stop();
    });
  });

  it("observeChanges - unordered - basics", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handle = await c.find().observeChanges(logger);
      const barid = await c.insertOne({ thing: "stuff" });
      logger.expectResultOnly("added", [barid, { thing: "stuff" }]);

      let fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });

      logger.expectResultOnly("added", [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]);

      await c.updateOne(fooid, { noodles: "alright", potatoes: "tasty", apples: "ok" });
      await c.updateOne(fooid, { noodles: "alright", potatoes: "tasty", apples: "ok" });
      logger.expectResultOnly(
        "changed",
        [fooid, { noodles: "alright", potatoes: "tasty", bacon: undefined }]
      );
      await c.deleteOne(fooid);
      logger.expectResultOnly("removed", [fooid]);
      await c.deleteOne(barid);
      logger.expectResultOnly("removed", [barid]);

      fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });

      logger.expectResult("added", [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]);
      await logger.expectNoResult(1);
      handle.stop();
    });
  });

  it("observeChanges - unordered - specific fields", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handle = await c.find({}, { projection:  { noodles: 1, bacon: 1 } }).observeChanges(logger);
      const barid = await c.insertOne({ thing: "stuff" });
      logger.expectResultOnly("added", [barid, {}]);

      let fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });

      logger.expectResultOnly("added", [fooid, { noodles: "good", bacon: "bad" }]);

      await c.updateOne(fooid, { noodles: "alright", potatoes: "tasty", apples: "ok" });
      logger.expectResultOnly(
        "changed",
        [fooid, { noodles: "alright", bacon: undefined }]
      );
      await c.updateOne(fooid, { noodles: "alright", potatoes: "meh", apples: "ok" });
      await c.deleteOne(fooid);
      logger.expectResultOnly("removed", [fooid]);
      await c.deleteOne(barid);
      logger.expectResultOnly("removed", [barid]);

      fooid = await c.insertOne({ noodles: "good", bacon: "bad" });

      logger.expectResult("added", [fooid, { noodles: "good", bacon: "bad" }]);
      await logger.expectNoResult(1);
      handle.stop();

    });
  });

  it("observeChanges - unordered - specific fields + selector on excluded fields", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handle = await c.find(
        { mac: 1, cheese: 2 },
        { projection:  { noodles: 1, bacon: 1, eggs: 1 } }
      ).observeChanges(logger);
      const barid = await c.insertOne({ thing: "stuff", mac: 1, cheese: 2 });
      logger.expectResultOnly("added", [barid, {}]);

      let fooid = await c.insertOne({
        noodles: "good", bacon: "bad", apples: "ok", mac: 1, cheese: 2
      });

      logger.expectResultOnly("added", [fooid, { noodles: "good", bacon: "bad" }]);

      await c.updateOne(fooid, {
        noodles: "alright", potatoes: "tasty", apples: "ok", mac: 1, cheese: 2
      });
      logger.expectResultOnly(
        "changed",
        [fooid, { noodles: "alright", bacon: undefined }]
      );

      // Doesn't get update event, since modifies only hidden fields
      await logger.expectNoResult(async () => {
        await c.updateOne(fooid, {
          noodles: "alright",
          potatoes: "meh",
          apples: "ok",
          mac: 1,
          cheese: 2
        });
      });

      await c.deleteOne(fooid);
      logger.expectResultOnly("removed", [fooid]);
      await c.deleteOne(barid);
      logger.expectResultOnly("removed", [barid]);

      fooid = await c.insertOne({
        noodles: "good", bacon: "bad", mac: 1, cheese: 2
      });

      logger.expectResult("added", [fooid, { noodles: "good", bacon: "bad" }]);
      await logger.expectNoResult(1);
      handle.stop();
    });
  });

  it("observeChanges - unordered - specific fields + modify on excluded fields", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handle = await c.find(
        { mac: 1, cheese: 2 },
        { projection:  { noodles: 1, bacon: 1, eggs: 1 } }
      ).observeChanges(logger);
      const fooid = await c.insertOne({
        noodles: "good", bacon: "bad", apples: "ok", mac: 1, cheese: 2
      });

      logger.expectResultOnly("added", [fooid, { noodles: "good", bacon: "bad" }]);


      // Noodles go into shadow, mac appears as eggs
      await c.updateOne(fooid, { $rename: { noodles: "shadow", apples: "eggs" } });
      logger.expectResultOnly(
        "changed",
        [fooid, { eggs: "ok", noodles: undefined }]
      );

      await c.deleteOne(fooid);
      logger.expectResultOnly("removed", [fooid]);
      await logger.expectNoResult();
      handle.stop();
    });
  });

  it(
    "observeChanges - unordered - unset parent of observed field",
    async () => {
      const c = makeCollection();
      await withCallbackLogger(
        ["added", "changed", "removed"], Meteor.isServer,
        async (logger) => {
          const handle = await c.find({}, { projection:  { "type.name": 1 } }).observeChanges(logger);
          const id = await c.insertOne({ type: { name: "foobar" } });
          logger.expectResultOnly("added", [id, { type: { name: "foobar" } }]);

          await c.updateOne(id, { $unset: { type: 1 } });
          assert.deepEqual(await c.find().toArray(), [{ _id: id }]);
          logger.expectResultOnly("changed", [id, { type: undefined }]);

          handle.stop();
        }
      );
    }
  );


  it("observeChanges - unordered - enters and exits result set through change", async () => {
    const c = makeCollection();
    await withCallbackLogger(["added", "changed", "removed"], Meteor.isServer, async (logger) => {
      const handle = await c.find({ noodles: "good" }).observeChanges(logger);
      const barid = await c.insertOne({ thing: "stuff" });

      let fooid = await c.insertOne({ noodles: "good", bacon: "bad", apples: "ok" });
      logger.expectResultOnly("added", [fooid, { noodles: "good", bacon: "bad", apples: "ok" }]);

      await c.updateOne(fooid, { noodles: "alright", potatoes: "tasty", apples: "ok" });
      logger.expectResultOnly(
        "removed",
        [fooid]
      );
      await c.deleteOne(fooid);
      await c.deleteOne(barid);

      fooid = await c.insertOne({ noodles: "ok", bacon: "bad", apples: "ok" });
      await c.updateOne(fooid, { noodles: "good", potatoes: "tasty", apples: "ok" });
      logger.expectResult("added", [fooid, { noodles: "good", potatoes: "tasty", apples: "ok" }]);
      await logger.expectNoResult();
      handle.stop();
    });
  });
});
