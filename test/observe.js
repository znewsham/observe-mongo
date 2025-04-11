import { AsyncLocalStorage } from "node:async_hooks";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { observe } from "../lib/observe.js";

describe("document cloning", () => {
  it("should clone documents when cloneDocuments is enabled", async () => {
    // Create collection with an initial document
    const data = [{ _id: "testId", field: { nested: "value" } }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});

    // Get reference to the original document
    const originalDoc = data[0];

    // Setup observe with cloneDocuments enabled
    const addedMock = mock.fn();
    const handle = await observe(
      cursor,
      collection,
      { added: addedMock },
      { cloneDocuments: true, pollingInterval: 5 }
    );

    // Wait for initial callbacks
    await setTimeout(10);

    // Verify the 'added' callback was called with our document
    assert.strictEqual(addedMock.mock.callCount(), 1, "added callback should be called once");

    // Modify the original document
    originalDoc.field.nested = "modified";

    // Add another document to trigger polling
    await collection.insertOne({ _id: "testId2", field: "value" });

    // Wait for polling to happen
    await setTimeout(10);

    // Stop the observer
    handle.stop();

    // Get the document as it was passed to the callback
    const addedDoc = addedMock.mock.calls[0].arguments[0];

    // Check that the cloned document has the original value, not the modified one
    assert.strictEqual(addedDoc.field.nested, "value", "Document should be a clone with original values");
  });

  it("should have distinct objects in the changed callback when cloneDocuments is enabled", async () => {
    // Create collection with an initial document
    const data = [{ _id: "testId", value: "initial" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});

    // Capture the original document reference
    const originalDoc = data[0];

    // Mutable array to store references received in callbacks
    const capturedDocs = [];

    // Setup a changed callback that captures the oldDoc and newDoc references
    const changedMock = mock.fn((newDoc, oldDoc) => {
      capturedDocs.push({ newDoc, oldDoc });
    });

    // Start observing with cloneDocuments enabled
    const handle = await observe(
      cursor,
      collection,
      { changed: changedMock },
      { cloneDocuments: true, pollingInterval: 5 }
    );

    // Wait for initial setup
    await setTimeout(10);

    // Update the document
    originalDoc.value = "updated";

    // Wait for polling to detect the change
    await setTimeout(15);

    // Verify the callback was called
    assert.strictEqual(changedMock.mock.callCount(), 1, "changed callback should be called once");

    // Get the captured objects
    const { newDoc, oldDoc } = capturedDocs[0];

    // Verify the values were passed correctly
    assert.strictEqual(newDoc.value, "updated", "newDoc has updated value");

    // Test that the objects are distinct (cloned)
    assert.notStrictEqual(newDoc, oldDoc, "newDoc and oldDoc should be different objects");
    assert.notStrictEqual(newDoc, originalDoc, "newDoc should not be the original object");
    assert.notStrictEqual(oldDoc, originalDoc, "oldDoc should not be the original object");

    // Verify that modifying the original again doesn't affect our captured objects
    originalDoc.value = "modified again";
    assert.strictEqual(newDoc.value, "updated", "newDoc should not be affected by later modifications");

    // Cleanup
    handle.stop();
  });
});

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
