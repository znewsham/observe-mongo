import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { Minimongo } from "@blastjs/minimongo";
import { LocalCollection } from "@blastjs/minimongo/dist/local_collection.js";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";
import { ObserveMultiplexer } from "../lib/multiplexer.js";
import { SubscriptionManager } from "../lib/redis/manager.js";
import { RedisObserverDriver } from "../lib/redis/subscriber.js";
import { Events, RedisPipe } from "../lib/redis/constants.js";
import { stringId } from "../lib/types.js";

const collectionName = "redisServerTests";
function spy(object, method) {
  const orig = object[method];
  const mocked = mock.fn((...args) => {
    return orig.call(object, ...args);
  });
  object[method] = mocked;
  return mocked;
}

class CollectionThatEmits extends FakeCollection {
  pubSubManager;
  collectionName;
  constructor(name, data, pubSubManager, transform) {
    super(data, transform);
    this.pubSubManager = pubSubManager;
    this.collectionName = name;
  }

  async insertOne(...args) {
    const result = await super.insertOne(...args);
    await Promise.all([this.collectionName, `${this.collectionName}::${stringId(result.insertedId)}`].map(async (channel) => {
      await this.pubSubManager.emit(channel, {
        [RedisPipe.EVENT]: Events.INSERT,
        [RedisPipe.DOC]: { _id: result.insertedId },
        [RedisPipe.UID]: "me"
      });
    }));

    return result;
  }

  async deleteOne(...args) {
    const found = await super.findOne(args[0], { projection: { _id: 1 } });
    const result = await super.deleteOne(...args);
    if (!found) {
      return result;
    }
    await Promise.all([this.collectionName, `${this.collectionName}::${stringId(found._id)}`].map(async (channel) => {
      await this.pubSubManager.emit(channel, {
        [RedisPipe.EVENT]: Events.REMOVE,
        [RedisPipe.DOC]: { _id: found._id },
        [RedisPipe.UID]: "me"
      });
    }));
    return result;
  }

  async updateOne(...args) {
    const found = await super.findOne(args[0], { projection: { _id: 1 } });
    const result = await super.updateOne(...args);
    if (!found) {
      return result;
    }
    await Promise.all([this.collectionName, `${this.collectionName}::${stringId(found._id)}`].map(async (channel) => {
      await this.pubSubManager.emit(channel, {
        [RedisPipe.EVENT]: Events.UPDATE,
        [RedisPipe.DOC]: { _id: found._id },
        [RedisPipe.FIELDS]: Object.keys(args[1].$set),
        [RedisPipe.UID]: "me"
      });
    }));
    return result;
  }
}


class TestPubSubManager {
  channelHanders = new Map();
  subscribe(channel, handler) {
    const set = this.channelHanders.get(channel) || new Set();
    set.add(handler);
    this.channelHanders.set(channel, set);
  }
  unsubscribe(channel, handler) {
    const set = this.channelHanders.get(channel) || new Set();
    set.delete(handler);
    this.channelHanders.set(channel, set);
  }

  async emit(channel, object) {
    const handles = Array.from(this.channelHanders.get(channel) || []);
    await Promise.all(handles.map(handle => handle(object)));
  }
}

async function setup(query, options, data = []) {
  const ordered = !!options.sort;
  const pubSubManager = new TestPubSubManager();
  const collection = new CollectionThatEmits(collectionName, data, pubSubManager);
  const subscriptionManager = new SubscriptionManager(pubSubManager);
  const cursor = collection.find(query, options);
  const multiplexer = new ObserveMultiplexer({ ordered });
  const subscriber = new RedisObserverDriver(
    cursor,
    collection,
    {
      ordered,
      manager: subscriptionManager,
      Matcher: Minimongo.Matcher,
      Sorter: Minimongo.Sorter,
      compileProjection: LocalCollection._compileProjection
    }
  );

  const handlePromise = multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });
  subscriber.init(multiplexer);
  await handlePromise;
  return {
    collection,
    multiplexer,
    manager: subscriptionManager,
    subscriber
  };
}
describe("Redis Observer", () => {
  describe("default processor", () => {
    it("Initial added works", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({}, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = mock.method(multiplexer, "added");
      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");
    });
    it("Inserts should respect the selector", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3 }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ value: 3 }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = mock.method(multiplexer, "added");
      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");
      await collection.insertOne({ _id: "test1", field: "hello" });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      await collection.insertOne({ _id: "test2", value: 4 });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      await collection.insertOne({ _id: "test3", value: 3 });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 2, "Should have called added again");
    });
    it("Updates should respect the selector", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3 }, { _id: "test2" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ value: 3 }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const changedMock = spy(multiplexer, "changed");
      const removedMock = spy(multiplexer, "removed");

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");


      await collection.updateOne({ _id: "test" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "Should NOT have called changed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 2, "Should have called added again");

      await collection.updateOne({ _id: "test2" }, { $set: { test: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(changedMock.mock.callCount(), 1, "Should have called changed");
    });
    it("Updates should respect the projection", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3, test: "hello" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ value: { $gte: 3 } }, { projection: { test: 1 } });
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const changedMock = spy(multiplexer, "changed");
      const removedMock = spy(multiplexer, "removed");

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher,
          compileProjection: LocalCollection._compileProjection
        }
      );

      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");

      await collection.updateOne({ _id: "test" }, { $set: { value: 4 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(removedMock.mock.callCount(), 0, "Should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "Should NOT have called changed");

      await collection.updateOne({ _id: "test" }, { $set: { test: "world" } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(changedMock.mock.callCount(), 1, "Should have called changed");
      assert.strictEqual(removedMock.mock.callCount(), 0, "Should NOT have called removed");
    });
    it("Added works", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({}, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      await subscriber.init(multiplexer);
      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });


      await collection.insertOne({ _id: "test", field: "hello" });


      await subscriber._queue.flush();

      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called the added");


      await pubSubManager.emit(collectionName, {
        [RedisPipe.EVENT]: Events.INSERT,
        [RedisPipe.DOC]: { _id: "test" },
        [RedisPipe.UID]: "me"
      });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should not have called added again");
    });
  });
  describe("dedicated channels processor", () => {
    it("Initial added works", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: "test" }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = mock.method(multiplexer, "added");
      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");
    });
    it("Inserts should respect the selector", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3 }, { _id: "test2" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: { $in: ["test", "test2", "test3"] }, value: 3 }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const changedMock = spy(multiplexer, "changed");
      const removedMock = spy(multiplexer, "removed");

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");



      await collection.updateOne({ _id: "test" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "Should NOT have called changed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 2, "Should have called added again");

      await collection.updateOne({ _id: "test2" }, { $set: { test: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(changedMock.mock.callCount(), 1, "Should have called changed");
    });
    it("Updates should respect the selector", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3 }, { _id: "test2" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: { $in: ["test", "test2"] }, value: 3 }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const changedMock = spy(multiplexer, "changed");
      const removedMock = spy(multiplexer, "removed");

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");


      await collection.updateOne({ _id: "test" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 2 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(removedMock.mock.callCount(), 1, "Should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "Should NOT have called changed");

      await collection.updateOne({ _id: "test2" }, { $set: { value: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 2, "Should have called added again");

      await collection.updateOne({ _id: "test2" }, { $set: { test: 3 } });

      await subscriber._queue.flush();
      assert.strictEqual(changedMock.mock.callCount(), 1, "Should have called changed");
    });
    it("Updates should respect the projection", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "test", value: 3, test: "hello" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: { $in: ["test"] }, value: { $gte: 3 } }, { projection: { test: 1 } });
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const changedMock = spy(multiplexer, "changed");
      const removedMock = spy(multiplexer, "removed");

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher,
          compileProjection: LocalCollection._compileProjection
        }
      );

      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });

      await subscriber.init(multiplexer);
      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called added");

      await collection.updateOne({ _id: "test" }, { $set: { value: 4 } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(removedMock.mock.callCount(), 0, "Should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "Should NOT have called changed");

      await collection.updateOne({ _id: "test" }, { $set: { test: "world" } });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should NOT have called added again");
      assert.strictEqual(changedMock.mock.callCount(), 1, "Should have called changed");
      assert.strictEqual(removedMock.mock.callCount(), 0, "Should NOT have called removed");
    });
    it("Added works", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: { $in: ["test"] } }, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      const addedMock = spy(multiplexer, "added");
      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      await subscriber.init(multiplexer);
      multiplexer.addHandleAndSendInitialAdds({ observes() { return false; } });


      await collection.insertOne({ _id: "test", field: "hello" });


      await subscriber._queue.flush();

      assert.strictEqual(addedMock.mock.callCount(), 1, "Should have called the added");


      await pubSubManager.emit(collectionName, {
        [RedisPipe.EVENT]: Events.INSERT,
        [RedisPipe.DOC]: { _id: "test" },
        [RedisPipe.UID]: "me"
      });

      await subscriber._queue.flush();
      assert.strictEqual(addedMock.mock.callCount(), 1, "Should not have called added again");
    });
  });
  describe("limit sort processor", () => {
    // insert test cases
    it("should call addedBefore when inserting a document AFTER the set, without a limit", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );

      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 3 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
    });
    it("should NOT call addedBefore when inserting a document AFTER the set, with a limit we now exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );

      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 3 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should have called addedBefore");
    });
    it("should call addedBefore when inserting a document AFTER the set, with a limit we dont exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 3 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );

      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 3 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
    });
    it("should call addedBefore when inserting a document BEFORE the set, with a skip and no limit", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, skip: 1 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "1", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore when inserting a document BEFORE the set, without a skip and no limit", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore when inserting a document BEFORE the set, without a skip and a limit we dont exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 3 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore and removed when inserting a document BEFORE the set, with a skip and a limit we exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, skip: 1, limit: 1 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "1", "should have called addedBefore with the correct ID");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore when inserting a document BEFORE the set, without a skip and a limit we dont exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 3 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
    })
    it("should call addedBefore and removed when inserting a document BEFORE the set, without a skip and a limit we exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2", "should have called addedBefore with the correct ID");
    });


    it("should call addedBefore when inserting a document INSIDE the set, without a limit", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 2 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore when inserting a document INSIDE the set, with a limit we dont exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 3 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 2 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
    });
    it("should call addedBefore and removed when inserting a document INSIDE the set, with a limit we exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.insertOne({ _id: "3", number: 2 });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3", "should have called addedBefore with the correct ID");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2", "should have called addedBefore with the correct ID");
    });

    // update test cases
    it("should do nothing when the doc wasn't in the set and still isn't", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "3" }, { $set: { number: 4 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });
    it("should call added when the doc wasn't in the set and now is", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "3" }, { $set: { number: 0 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });
    it("should call movedBefore when the doc was in the set and still is, in a different place", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2, projection: { _id: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "2" }, { $set: { number: 0 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 1, "should have called moved");
    });
    it("should call movedBefore and changed when the doc was in the set and still is in a different place and updated a projection field", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2, projection: { _id: 1, thing: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "2" }, { $set: { number: 0, thing: 1 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 1, "should have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 1, "should have called moved");
    });
    it("should call changed when the doc was in the set and still is at the same place and updated a projection field", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2, projection: { _id: 1, thing: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "2" }, { $set: { thing: 1 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 1, "should have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });
    it("should do nothing when the doc was in the set and still is at the same place and didnt update a projection field", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2, projection: { _id: 1, thing: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "2" }, { $set: { other: 1 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should NOT have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });
    it("should call removed when the doc was in the set and now isnt", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        { number: { $lt: 3 } },
        { sort: { number: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "2" }, { $set: { number: 4 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });
    it("should do nothing if the doc wasn't in the set, now is eligible, but after the set (with an exceeded limit)", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        { number: { $lt: 4 } },
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 4 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      const changedMock = mock.method(multiplexer, "changed");
      const movedMock = mock.method(multiplexer, "movedBefore");

      await collection.updateOne({ _id: "3" }, { $set: { number: 3 } });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 0, "should have called removed");
      assert.strictEqual(changedMock.mock.callCount(), 0, "should NOT have called changed");
      assert.strictEqual(movedMock.mock.callCount(), 0, "should NOT have called moved");
    });

    // remove test cases
    it("should do nothing when the doc wasn't in the set and there was no skip", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 3 }, { _id: "3", number: 3 }]
      );
      const removedMock = mock.method(multiplexer, "removed");

      await collection.deleteOne({ _id: "3" });
      await subscriber._queue.flush();
      assert.strictEqual(removedMock.mock.callCount(), 0, "should have called removedMock");
    });
    it("should just call removed when the doc was BEFORE the set and there was a skip and limit and few documents", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, skip: 1, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }]
      );
      const removedMock = mock.method(multiplexer, "removed");

      await collection.deleteOne({ _id: "1" });
      await subscriber._queue.flush();
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2", "should have called addedBefore with the correct ID");
    });
    it("should call removed and addedBefore when the doc was BEFORE the set and there was a skip a limit and enough documents", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, skip: 1, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }, { _id: "4", number: 4 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      await collection.deleteOne({ _id: "1" });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "4", "should have called addedBefore with the correct ID");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2", "should have called addedBefore with the correct ID");
    });
    it("should just call removed when the doc was in the set and no limit", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 } },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }, { _id: "4", number: 4 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      await collection.deleteOne({ _id: "1" });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "1", "should have called addedBefore with the correct ID");
    });
    it("should just call removed when the doc was in the set and a limit we didn't exceed", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 10 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }, { _id: "4", number: 4 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      await collection.deleteOne({ _id: "1" });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 0, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "1", "should have called addedBefore with the correct ID");
    });
    it("should call removed and addedBefore when the doc was in the set and a limit we exceeded", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, limit: 3 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }, { _id: "3", number: 3 }, { _id: "4", number: 4 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");
      await collection.deleteOne({ _id: "1" });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should NOT have called addedBefore");
      assert.strictEqual(removedMock.mock.callCount(), 1, "should have called removedMock");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "1", "should have called removed with the correct ID");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "4", "should have called addedBefore with the correct ID");
    });

  });
});
