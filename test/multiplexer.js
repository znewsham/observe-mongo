import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";

import { ObserveMultiplexer } from "../lib/multiplexer.js";
import { PollingDriver } from "../lib/pollingDriver.js";
import { observeChanges } from "../lib/observe.js";

class DelayedPollingDriver extends PollingDriver {
  /**
   *
   * @param {ObserveMultiplexer} multiplexer
   */
  async init(multiplexer) {
    const promises = [];
    await this._cursor.forEach(doc => promises.push((async () => {
      await setTimeout(10);
      multiplexer.added(doc._id, doc);
    })()));
    await Promise.all(promises);
    multiplexer.ready();
  }
}


describe("multiplexer", () => {
  it("should add the initial items to the first handle", async () => {
    const collection = new FakeCollection([{ _id: "test" }, { _id: "test2" }]);
    const cursor = collection.find({});
    const addedMock = mock.fn();
    const handle = await observeChanges(
      cursor,
      collection,
      {
        added: addedMock
      }
    );
    assert.strictEqual(addedMock.mock.callCount(), 2, "Should have been called once for each document");
    handle.stop();
  });
  it("should add the initial items items to both handles", async () => {
    const collection = new FakeCollection([{ _id: "test" }, { _id: "test2" }]);
    const cursor = collection.find({});
    const addedMock1 = mock.fn();
    const addedMock2 = mock.fn();
    const handle1 = await observeChanges(
      cursor,
      collection,
      {
        added: addedMock1
      },
      {
        multiplexerId: () => "test"
      }
    );
    const handle2 = await observeChanges(
      cursor,
      collection,
      {
        added: addedMock2
      },
      {
        multiplexerId: () => "test"
      }
    );
    assert.strictEqual(addedMock1.mock.callCount(), 2, "Should have been called once for each document");
    assert.strictEqual(addedMock2.mock.callCount(), 2, "Should have been called once for each document");

    assert.strictEqual(handle1._multiplexer, handle2._multiplexer, "Should have the same multiplexer");
    handle1.stop();
    handle2.stop();
  });
  it("should add the initial items items to both handles when added in parallel", async () => {
    const collection = new FakeCollection([{ _id: "test" }, { _id: "test2" }]);
    const cursor = collection.find({});
    const addedMock1 = mock.fn();
    const addedMock2 = mock.fn();
    const handle1Promise = observeChanges(
      cursor,
      collection,
      {
        added: addedMock1
      },
      {
        multiplexerId: () => "test1",
        driverClass: DelayedPollingDriver
      }
    );
    await setTimeout(15);
    const handle2Promise = observeChanges(
      cursor,
      collection,
      {
        added: addedMock2
      },
      {
        multiplexerId: () => "test1",
        driverClass: DelayedPollingDriver
      }
    );
    const [handle1, handle2] = await Promise.all([handle1Promise, handle2Promise]);
    assert.strictEqual(addedMock1.mock.callCount(), 2, "Should have been called once for each document (first)");
    assert.strictEqual(addedMock2.mock.callCount(), 2, "Should have been called once for each document (second)");

    assert.strictEqual(handle1._multiplexer, handle2._multiplexer, "Should have the same multiplexer");
  });
  it("multiplexer is retained after stopping one", async () => {
    const collection = new FakeCollection([{ _id: "test" }, { _id: "test2" }]);
    const cursor = collection.find({});
    const handle1 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test2"
      }
    );
    const handle2 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test2"
      }
    );

    handle1.stop();
    const handle3 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test2"
      }
    );
    assert.strictEqual(handle2._multiplexer, handle3._multiplexer, "Should have the same multiplexer");
  });
  it("multiplexer is lost after stopping both", async () => {
    const collection = new FakeCollection([{ _id: "test" }, { _id: "test2" }]);
    const cursor = collection.find({});
    const handle1 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test3"
      }
    );
    const handle2 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test3"
      }
    );

    handle1.stop();
    handle2.stop();
    const handle3 = await observeChanges(
      cursor,
      collection,
      {
        added: () => {}
      },
      {
        multiplexerId: () => "test3"
      }
    );
    assert.notEqual(handle2._multiplexer, handle3._multiplexer, "Should NOT have the same multiplexer");
  });
});
