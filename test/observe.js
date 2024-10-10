import { AsyncLocalStorage } from "node:async_hooks";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { observe } from "../lib/observe.js";

describe("unordered observe", () => {
  it("should correctly associate with the invoking async context", async () => {
    const asyncStorage = new AsyncLocalStorage();
    const data = [];
    const collection = new FakeCollection(data);
    let addedMock;
    const addedPromise = new Promise((resolve) => {
      addedMock = mock.fn(() => {
        assert.strictEqual(asyncStorage.getStore(), "test");
        resolve();
      });
    });
    /**
     * @type {FindCursor<{ _id: string, thing: string }>} cursor
     */
    const cursor = collection.find({});

    // we set up a handle first so the driver exists outside - otherwise all events will exist within the context anyway
    const preHandle = await observe(
      cursor,
      collection,
      {
      },
      {
        pollingInterval: 5,
        multiplexerId: () => "test-shared"
      }
    );
    const handle = await asyncStorage.run("test", () => {
      return observe(
        cursor,
        collection,
        {
          added: addedMock
        },
        {
          pollingInterval: 5,
          multiplexerId: () => "test-shared"
        }
      );
    });
    preHandle.stop();
    await collection.insertOne({ _id: "test3" });
    await setTimeout(7);
    await addedPromise;
    assert.strictEqual(addedMock.mock.callCount(), 1, "should have seen the add");
    handle.stop();
  });
  it("should NOT associate with the invoking async context", async () => {
    const asyncStorage = new AsyncLocalStorage();
    asyncStorage.enterWith("world");
    const data = [];
    const collection = new FakeCollection(data);
    let addedMock;
    const addedPromise = new Promise((resolve, reject) => {
      assert.strictEqual(asyncStorage.getStore(), "world");
      addedMock = mock.fn(() => {
        try {
          assert.strictEqual(asyncStorage.getStore(), "world");
          resolve();
        }
        catch (e) {
          reject(e);
        }
      });
    });
    /**
     * @type {FindCursor<{ _id: string, thing: string }>} cursor
     */
    const cursor = collection.find({});

    // we set up a handle first so the driver exists outside - otherwise all events will exist within the context anyway
    const preHandle = await observe(
      cursor,
      collection,
      {
      },
      {
        pollingInterval: 5,
        multiplexerId: () => "test-shared"
      }
    );
    const handle = await asyncStorage.run("test", () => {
      return observe(
        cursor,
        collection,
        {
          added: addedMock
        },
        {
          pollingInterval: 5,
          bindObserveEventsToAsyncResource: false,
          multiplexerId: () => "test-shared"
        }
      );
    });
    preHandle.stop();
    await collection.insertOne({ _id: "test3" });
    await setTimeout(7);
    await addedPromise;
    assert.strictEqual(addedMock.mock.callCount(), 1, "should have seen the add");
    handle.stop();
  });
  it("additional adds are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    /**
     * @type {FindCursor<{ _id: string, thing: string }>} cursor
     */
    const cursor = collection.find({});
    const addedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        added: addedMock
      },
      {
        pollingInterval: 5
      }
    );
    await collection.insertOne({ _id: "test3" });
    await setTimeout(7);
    assert.strictEqual(addedMock.mock.callCount(), 3, "should have seen the add");
    await setTimeout(7);
    handle.stop();

    assert.strictEqual(addedMock.mock.callCount(), 3, "shouldn't see spurious adds");
  });
  it("changes are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const changedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        changed: changedMock
      },
      {
        pollingInterval: 5
      }
    );

    cursor._data[0] = { ...cursor._data[0], value: "hello" };

    await setTimeout(30);
    handle.stop();
    assert.strictEqual(changedMock.mock.callCount(), 1);
  });
  it("removes are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const removedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        removed: removedMock
      },
      {
        pollingInterval: 5
      }
    );

    cursor._data.splice(0, 1);

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(removedMock.mock.callCount(), 1);
  });
});

describe("ordered observe", () => {
  it("additional addedBefores are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const addedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        addedAt: addedMock,
        _no_indices: true
      },
      {
        ordered: true,
        pollingInterval: 5
      }
    );
    assert.strictEqual(addedMock.mock.callCount(), 2, "should have seen the add");
    cursor._data.push({ _id: "test3" });
    await setTimeout(7);
    assert.strictEqual(addedMock.mock.callCount(), 3, "should have seen the add");
    await setTimeout(7);
    handle.stop();

    assert.strictEqual(addedMock.mock.callCount(), 3, "shouldn't see spurious adds");
  });
  it("changes are received", async () => {
    const data = [{ _id: "test", thing: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const changedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        changedAt: changedMock,
      },
      {
        ordered: true,
        noIndices: true,
        pollingInterval: 5,
      }
    );

    cursor._data[0] = { ...cursor._data[0], value: "hello" };

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(changedMock.mock.callCount(), 1);
    assert.deepEqual(
      changedMock.mock.calls[0].arguments,
      [
        { _id: "test", value: "hello", thing: "test" },
        { _id: "test", thing: "test" },
        -1
      ],
      "got the entire changed doc, the old doc and the index"
    );
  });
  it("movedBefore are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const movedBeforeMock = mock.fn();
    const changedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        movedTo: movedBeforeMock,
        changedAt: changedMock
      },
      {
        ordered: true,
        noIndices: true,
        pollingInterval: 5
      }
    );

    const swap = cursor._data[0];
    cursor._data[0] = cursor._data[1];
    cursor._data[1] = swap;

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(movedBeforeMock.mock.callCount(), 1);
    assert.strictEqual(changedMock.mock.callCount(), 0);
  });
  it("movedBefore and changed are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const movedBeforeMock = mock.fn();
    const changedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        movedTo: movedBeforeMock,
        changedAt: changedMock
      },
      {
        ordered: true,
        noIndices: true,
        pollingInterval: 5
      }
    );

    const swap = cursor._data[0];
    cursor._data[0] = cursor._data[1];
    cursor._data[1] = { ...swap, value: "test" };

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(movedBeforeMock.mock.callCount(), 1);
    assert.strictEqual(changedMock.mock.callCount(), 1);
  });
  it("removes are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const removedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      {
        removedAt: removedMock,
        _no_indices: true
      },
      {
        ordered: true,
        pollingInterval: 5
      }
    );

    cursor._data.splice(0, 1);

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(removedMock.mock.callCount(), 1);
  });
});
