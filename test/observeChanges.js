
import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";
import { observeChanges } from "../lib/observe.js";

describe("unordered observeChanges", () => {
  it("additional adds are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const addedMock = mock.fn();
    const handle = await observeChanges(
      cursor,
      collection,
      {
        added: addedMock
      },
      {
        pollingInterval: 5
      }
    );
    cursor._data.push({ _id: "test3" });
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
    const handle = await observeChanges(
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

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(changedMock.mock.callCount(), 1);
  });
  it("removes are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const removedMock = mock.fn();
    const handle = await observeChanges(
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

    await setTimeout(60);
    handle.stop();


    assert.strictEqual(removedMock.mock.callCount(), 1);
  });
});

describe("ordered observeChanges", () => {
  it("additional addedBefores are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const addedMock = mock.fn();
    const handle = await observeChanges(
      cursor,
      collection,
      {
        addedBefore: addedMock
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
    const data = [{ _id: "test", thing: "value" }, { _id: "test2", thing: "value" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const changedMock = mock.fn();
    const handle = await observeChanges(
      cursor,
      collection,
      {
        changed: changedMock
      },
      {
        ordered: true,
        pollingInterval: 5
      }
    );

    cursor._data[0] = { ...cursor._data[0], value: "hello" };

    await setTimeout(10);
    handle.stop();

    assert.strictEqual(changedMock.mock.callCount(), 1);
    assert.deepEqual(changedMock.mock.calls[0].arguments, ["test", { value: "hello" }], "just the changed fields");
  });
  it("movedBefore are received", async () => {
    const data = [{ _id: "test" }, { _id: "test2" }];
    const collection = new FakeCollection(data);
    const cursor = collection.find({});
    const movedBeforeMock = mock.fn();
    const changedMock = mock.fn();
    const handle = await observeChanges(
      cursor,
      collection,
      {
        movedBefore: movedBeforeMock,
        changed: changedMock
      },
      {
        ordered: true,
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
    const handle = await observeChanges(
      cursor,
      collection,
      {
        movedBefore: movedBeforeMock,
        changed: changedMock
      },
      {
        ordered: true,
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
    const handle = await observeChanges(
      cursor,
      collection,
      {
        removed: removedMock
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

  describe("async callbacks are processed in order", () => {

    // This test is a bit tricky, the observe driver generally can't cause events out of order because the driver uses the queue
    // additionally, the driver can choose (and the polling driver does) to wait for the multiplexer to flush before it polls again
    // this means the test needs to get all the changes in a single poll
    // but the order in which the driver "observes" those events is up to it - e.g., should the change or the add come first? Who knows?
    // but we're specifically trying to test that the callbacks are processed in a known order when we cause one to be delayed.
    // maybe the multiplexer is a better place to test this? But part of the goal is to test that the ultimate observe call doesn't mess things up
    // this is less relevant to observeChanges
    // broadly this "works" because if the multiplexer isn't awaiting the callbacks correctly, it's queue will flush early

    const combos = [
      {
        ordered: false,
        data: [{ _id: "z" }],
        firstEvent: "added",
        firstAction: collection => collection.insertOne({ _id: "a" }),
        secondEvent: "changed",
        secondAction: collection => collection.updateOne({ _id: "z" }, { $set: { value: "hello" } })
      },
      {
        ordered: false,
        data: [{ _id: "z" }],
        firstEvent: "added",
        firstAction: collection => collection.insertOne({ _id: "a" }),
        secondEvent: "removed",
        secondAction: collection => collection.deleteOne({ _id: "z" })
      },
      {
        ordered: false,
        data: [{ _id: "test" }],
        firstEvent: "changed",
        firstAction: collection => collection.updateOne({ _id: "test" }, { $set: { value: "hello" } }),
        secondEvent: "added",
        secondAction: collection => collection.insertOne({ _id: "newTest" })
      },
      {
        ordered: false,
        data: [{ _id: "test" }],
        firstEvent: "changed",
        firstAction: collection => collection.updateOne({ _id: "test" }, { $set: { value: "hello" } }),
        secondEvent: "removed",
        secondAction: collection => collection.deleteOne({ _id: "test" })
      },
      {
        ordered: false,
        data: [{ _id: "test" }],
        firstEvent: "removed",
        firstAction: collection => collection.deleteOne({ _id: "test" }),
        secondEvent: "added",
        secondAction: collection => collection.insertOne({ _id: "newTest" })
      },
      {
        ordered: false,
        data: [{ _id: "test" }, { _id: "test2"}],
        firstEvent: "removed",
        firstAction: collection => collection.deleteOne({ _id: "test" }),
        secondEvent: "changed",
        secondAction: collection => collection.updateOne({ _id: "test2" }, { $set: { value: "hello" } })
      }
    ];

    combos.forEach(({
      ordered,
      data,
      firstEvent,
      firstAction,
      secondEvent,
      secondAction
    }) => {
      it(`async ${firstEvent} -> ${secondEvent} callbacks are processed in order`, async () => {
        const collection = new FakeCollection(data);
        const cursor = collection.find({});

        const events = [];
        let isInitial = true;
        const handle = await observeChanges(
          cursor,
          collection,
          {
            [firstEvent]: async () => {
              if (!isInitial) {
                await setTimeout(100);
                events.push(firstEvent);
              }
            },
            [secondEvent]: async () => {
              if (!isInitial) {
                events.push(secondEvent);
              }
            }
          },
          {
            ordered,
            pollingInterval: 10
          }
        );
        isInitial = false;
        await firstAction(collection);
        await setTimeout(20);
        await secondAction(collection);
        await setTimeout(200);

        await handle._multiplexer.flush();
        // handle.stop();

        assert.deepEqual(events, [firstEvent, secondEvent], "events should be in order");
      });
    });
  });
});
