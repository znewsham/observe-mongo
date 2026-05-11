import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { Minimongo } from "@blastjs/minimongo";
import { LocalCollection } from "@blastjs/minimongo/dist/local_collection.js";
import { FakeCollection } from "mongo-collection-helpers/testHelpers";
import { ObserveMultiplexer } from "../lib/multiplexer.js";
import { SubscriptionManager } from "../lib/redis/manager.js";
import { RedisObserverDriver } from "../lib/redis/subscriber.js";
import { Events, RedisPipe } from "../lib/redis/constants.js";
import { canUseRedisOplog } from "../lib/redis/index.js";
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
    it("subscriber A (projection {name:1}) should not receive subscriber B's 'secret' in changed fields (regression: TODO G - cross-pollution)", async () => {
      // Two subscribers on the same channel with disjoint projections.
      //   A: projection { name: 1 }
      //   B: projection { secret: 1 }
      // Manager unions their completeProjections, so when an UPDATE comes in
      // it fetches both `name` and `secret` from the DB and forwards a doc
      // containing both fields to BOTH subscribers. If A's pipeline doesn't
      // re-project, A's downstream observer would see `secret` in the
      // changed-fields payload — which is a real correctness leak (and an
      // information-disclosure leak if the field is sensitive).
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(
        collectionName,
        [{ _id: "1", name: "a", secret: "shh" }],
        pubSubManager
      );
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      const changedA = mock.fn();
      const handleA = {
        observes: () => true,
        added: () => {},
        addedBefore: () => {},
        changed: changedA,
        movedBefore: () => {},
        removed: () => {}
      };

      const cursorA = collection.find({}, { projection: { name: 1 } });
      const multiplexerA = new ObserveMultiplexer({ ordered: false });
      multiplexerA.addHandleAndSendInitialAdds(handleA);
      const subscriberA = new RedisObserverDriver(cursorA, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberA.init(multiplexerA);

      const cursorB = collection.find({}, { projection: { secret: 1 } });
      const multiplexerB = new ObserveMultiplexer({ ordered: false });
      multiplexerB.addHandleAndSendInitialAdds({ observes: () => false });
      const subscriberB = new RedisObserverDriver(cursorB, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberB.init(multiplexerB);

      // Update both name and secret in a single mutator.
      await collection.updateOne({ _id: "1" }, { $set: { name: "b", secret: "shh2" } });
      await subscriberA._queue.flush();
      await multiplexerA.flush();

      assert.ok(changedA.mock.callCount() > 0, "A should receive a changed callback");
      for (const call of changedA.mock.calls) {
        const fields = call.arguments[1];
        assert.ok(
          !("secret" in fields),
          `A's changed payload should not include 'secret', got ${JSON.stringify(fields)}`
        );
      }
    });

    it("subscriber A (projection {name:1}) should not fire 'changed' when only B's 'secret' is updated (regression: TODO G - cross-pollution)", async () => {
      // Same setup as the previous test, but the update touches ONLY a
      // field outside A's projection. Even though the manager fetches
      // `secret` (because of the union projection), A's projectionFn
      // strips it, makeChangedFields finds no changes against A's cache,
      // and A's `changed` callback should never fire.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(
        collectionName,
        [{ _id: "1", name: "a", secret: "shh" }],
        pubSubManager
      );
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      const changedA = mock.fn();
      const handleA = {
        observes: () => true,
        added: () => {},
        addedBefore: () => {},
        changed: changedA,
        movedBefore: () => {},
        removed: () => {}
      };

      const cursorA = collection.find({}, { projection: { name: 1 } });
      const multiplexerA = new ObserveMultiplexer({ ordered: false });
      multiplexerA.addHandleAndSendInitialAdds(handleA);
      const subscriberA = new RedisObserverDriver(cursorA, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberA.init(multiplexerA);

      const cursorB = collection.find({}, { projection: { secret: 1 } });
      const multiplexerB = new ObserveMultiplexer({ ordered: false });
      multiplexerB.addHandleAndSendInitialAdds({ observes: () => false });
      const subscriberB = new RedisObserverDriver(cursorB, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberB.init(multiplexerB);

      await collection.updateOne({ _id: "1" }, { $set: { secret: "shh2" } });
      await subscriberA._queue.flush();
      await multiplexerA.flush();

      assert.strictEqual(
        changedA.mock.callCount(),
        0,
        "A should not fire 'changed' when only B's 'secret' field was updated"
      );
    });

    it("manager should shrink projection union when a subscriber detaches (regression: TODO G)", async () => {
      // Two subscribers share a channel (default strategy → collection-name
      // channel) but with disjoint projections + filters.
      //   A: filter on `priority`, projection on `name`
      //   B: filter on `category`, projection on `secret`
      // SubscriptionManager.attach unions their completeProjections so
      // findOne fetches every monitored field. SubscriptionManager.detach
      // removes B from the subscribers set but does not shrink
      // entry.projection — so even after B is gone, the manager still
      // fetches B's fields on every UPDATE for the channel.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(
        collectionName,
        [{ _id: "1", name: "a", category: "X", priority: 3, secret: "shh" }],
        pubSubManager
      );
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      const cursorA = collection.find({ priority: { $lt: 5 } }, { projection: { name: 1 } });
      const multiplexerA = new ObserveMultiplexer({ ordered: false });
      const subscriberA = new RedisObserverDriver(cursorA, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      multiplexerA.addHandleAndSendInitialAdds({ observes() { return false; } });
      await subscriberA.init(multiplexerA);

      const cursorB = collection.find({ category: "X" }, { projection: { secret: 1 } });
      const multiplexerB = new ObserveMultiplexer({ ordered: false });
      const subscriberB = new RedisObserverDriver(cursorB, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      multiplexerB.addHandleAndSendInitialAdds({ observes() { return false; } });
      await subscriberB.init(multiplexerB);

      // B is no longer interested.
      subscriberB.stop();

      const findOneSpy = mock.method(collection, "findOne");

      await collection.updateOne({ _id: "1" }, { $set: { name: "b" } });
      await subscriberA._queue.flush();

      // Locate the manager's findOne call (it carries entry.projection,
      // which is more than just `{ _id: 1 }` used by other call sites).
      const managerCall = findOneSpy.mock.calls.find(
        c => c.arguments[1]?.projection && Object.keys(c.arguments[1].projection).length > 1
      );
      assert.ok(managerCall, "expected the manager to call findOne with the channel's union projection");

      const projection = managerCall.arguments[1].projection;
      assert.ok(
        !("secret" in projection),
        `after subscriberB.stop() the channel projection should not include B's projected 'secret' field; got ${JSON.stringify(projection)}`
      );
      assert.ok(
        !("category" in projection),
        `after subscriberB.stop() the channel projection should not include B's filter 'category' field; got ${JSON.stringify(projection)}`
      );
    });

    it("manager should not fetch on updates touching only a removed subscriber's fields (regression: TODO G)", async () => {
      // Setup: A (projection {name:1}) and B (projection {secret:1}) on the
      // same channel. After B.stop(), an UPDATE touching only `secret`
      // should not result in a findOne against the DB — the channel no
      // longer cares about that field. This requires two things to be true:
      //   1. entry.projection shrinks on detach (no `secret` after B leaves).
      //   2. The manager checks message[RedisPipe.FIELDS] against
      //      entry.projection and skips findOne when there's no overlap.
      // (#1 alone isn't enough: entry.projection would be {name} but the
      //  manager still unconditionally fetches.)
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(
        collectionName,
        [{ _id: "1", name: "a", secret: "shh" }],
        pubSubManager
      );
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      const cursorA = collection.find({}, { projection: { name: 1 } });
      const multiplexerA = new ObserveMultiplexer({ ordered: false });
      multiplexerA.addHandleAndSendInitialAdds({ observes: () => false });
      const subscriberA = new RedisObserverDriver(cursorA, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberA.init(multiplexerA);

      const cursorB = collection.find({}, { projection: { secret: 1 } });
      const multiplexerB = new ObserveMultiplexer({ ordered: false });
      multiplexerB.addHandleAndSendInitialAdds({ observes: () => false });
      const subscriberB = new RedisObserverDriver(cursorB, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriberB.init(multiplexerB);

      subscriberB.stop();

      const findOneSpy = mock.method(collection, "findOne");

      // Touches only `secret`, which is no longer in any remaining
      // subscriber's projection.
      await collection.updateOne({ _id: "1" }, { $set: { secret: "shh2" } });
      await subscriberA._queue.flush();

      // CollectionThatEmits.updateOne issues its own findOne with
      // `{ projection: { _id: 1 } }`; filter that out and look for any
      // channel-level fetch (one that asks for `name` or `secret`).
      const channelFindOnes = findOneSpy.mock.calls.filter(c => {
        const proj = c.arguments[1]?.projection;
        return proj && ("name" in proj || "secret" in proj);
      });

      assert.strictEqual(
        channelFindOnes.length,
        0,
        `manager should skip findOne when message FIELDS don't intersect the (post-detach) entry.projection; got ${JSON.stringify(channelFindOnes.map(c => c.arguments[1].projection))}`
      );
    });

    it("should not fire removed for unknown ids (regression: TODO 11)", async () => {
      // The default-strategy REMOVE branch in #processDefaultMessage fires
      // multiplexer.removed unconditionally, unlike the UPDATE branch and
      // the dedicated-channels path, which both guard with `await this.#has`.
      // Downstream observers should never see a `removed` for an id that
      // was never `added`.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [{ _id: "known" }], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({}, {});
      const multiplexer = new ObserveMultiplexer({ ordered: false });
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

      const removedMock = mock.method(multiplexer, "removed");

      await pubSubManager.emit(collectionName, {
        [RedisPipe.EVENT]: Events.REMOVE,
        [RedisPipe.DOC]: { _id: "unknown" },
        [RedisPipe.UID]: "someone-else"
      });
      await subscriber._queue.flush();

      assert.strictEqual(removedMock.mock.callCount(), 0, "should not forward removed for an id the subscriber never added");
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
    it("should skip null/undefined ids in $in without throwing", async () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({ _id: { $in: [undefined, null, "test"] } }, {});

      const subscriber = new RedisObserverDriver(
        cursor,
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      assert.deepStrictEqual(
        subscriber.channels,
        [`${collectionName}::test`],
        "should only subscribe to channels for non-null, non-undefined ids"
      );
    });

    it("should not throw when filter is _id: {} (regression: TODO 4)", () => {
      // getStrategy picks DEDICATED_CHANNELS because selector._id is truthy.
      // extractIdsFromSelector then calls getType({}); Object.keys({})[0] is
      // undefined and undefined.startsWith("$") throws TypeError.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      assert.doesNotThrow(() => {
        new RedisObserverDriver(
          collection.find({ _id: {} }, {}),
          collection,
          {
            ordered: false,
            manager: subscriptionManager,
            Matcher: Minimongo.Matcher
          }
        );
      });
    });

    // SKIPPED: regression test for TODO 1 (`strictRelevance` cannot be set to false).
    // `#strictRelevance` is a private field that nothing reads — the assignment
    // bug is real (`||` should be `??`) but has no externally observable effect
    // until either (a) the documented behavior described on `RedisObserverDriverOptions.strictRelevance`
    // is actually wired through to the projection/filter logic, or (b) the field
    // is exposed via a public getter for testing. Add a real test once one of
    // those happens.
    it.skip("should respect strictRelevance: false (regression: TODO 1)", () => {});

    it("should subscribe to a dedicated channel for a Date _id (regression: TODO 11)", () => {
      // getType(new Date()) returns EMPTY because Object.keys(date) is [],
      // so the Date is silently dropped from extractIdsFromSelector and
      // the subscriber registers no per-id channel.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const date = new Date(0);
      const subscriber = new RedisObserverDriver(
        collection.find({ _id: date }, {}),
        collection,
        { ordered: false, manager: subscriptionManager, Matcher: Minimongo.Matcher }
      );
      assert.deepStrictEqual(
        subscriber.channels,
        [`${collectionName}::${stringId(date)}`],
        "should produce a per-id channel keyed on the stringified Date"
      );
    });

    it("should subscribe to a dedicated channel for a Date _id under $eq (regression: TODO 11)", () => {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const date = new Date(0);
      const subscriber = new RedisObserverDriver(
        collection.find({ _id: { $eq: date } }, {}),
        collection,
        { ordered: false, manager: subscriptionManager, Matcher: Minimongo.Matcher }
      );
      assert.deepStrictEqual(
        subscriber.channels,
        [`${collectionName}::${stringId(date)}`],
        "should produce a per-id channel for { $eq: Date }"
      );
    });

    it("should subscribe to a dedicated channel for literal _id: 0 (regression: TODO 6)", () => {
      // Two truthy checks erase 0 as a legitimate _id:
      //   - getStrategy: `if (selector && selector._id)` falls through to DEFAULT for _id: 0.
      //   - extractIdsFromSelector: `if (selector._id)` skips the value entirely.
      // Net effect: a doc with _id: 0 never gets a dedicated channel and no
      // live updates are received for it.
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(collectionName, [], pubSubManager);
      const subscriptionManager = new SubscriptionManager(pubSubManager);

      const subscriber = new RedisObserverDriver(
        collection.find({ _id: 0 }, {}),
        collection,
        {
          ordered: false,
          manager: subscriptionManager,
          Matcher: Minimongo.Matcher
        }
      );

      assert.deepStrictEqual(subscriber.channels, [`${collectionName}::0`]);
    });
  });
  describe("limit sort processor", () => {
    it("should not throw when requery runs with no filter (regression: TODO 4)", async () => {
      // No filter → no matcher → #requery accessing this.#matcher._path
      // would throw TypeError on the first cross-window insert with skip.
      // The throw is swallowed by the queue's default error handler
      // (console.warn), so the failure surfaces as a missing addedBefore.
      const { collection, multiplexer, subscriber } = await setup(
        undefined,
        { sort: { number: 1 }, skip: 1 },
        [{ _id: "1", number: 1 }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "2", number: 0 });
      await subscriber._queue.flush();
      assert.strictEqual(
        addedBeforeMock.mock.callCount(),
        1,
        "should have called addedBefore for the doc that became visible after skip"
      );
    });
    it("should accept array-form sort and produce a sort projection by field name (regression: TODO 3)", async () => {
      const { subscriber } = await setup(
        {},
        { sort: [["number", 1]], projection: { thing: 1 } },
        [{ _id: "1", number: 1, thing: "a" }]
      );
      assert.deepStrictEqual(
        subscriber.completeProjection,
        { thing: 1, number: 1 },
        "completeProjection should be keyed by field name, not array index"
      );
    });
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

    it("should include all document fields in addedBefore when there is a sort but no projection", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        {},
        { sort: { number: 1 }, skip: 1 },
        [{ _id: "1", number: 1, name: "one" }, { _id: "2", number: 2, name: "two" }]
      );
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "3", number: 0, name: "zero" });
      await subscriber._queue.flush();
      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "1", "should have called addedBefore with the correct ID");
      // The document fetched during requery should include all fields, not just sort fields
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[1].name, "one", "should include non-sort fields in the document");
    });

    it("should key #sortDocs by _id when inserting in the middle (regression: line 479)", async () => {
      const { collection, multiplexer, subscriber } = await setup(
        { value: { $lt: 10 } },
        { sort: { number: 1 } },
        [{ _id: "1", number: 1, value: 5 }, { _id: "3", number: 3, value: 5 }]
      );

      // Middle insert. The buggy add() call passed the sort projection as
      // the key (instead of doc._id) and the before-doc as the value, so
      // #sortDocs ended up with the entry under a stringified-sortFields
      // key. multiplexer.addedBefore still fires (so callers see the new
      // doc), but #sortDocs.has(doc._id) is now false.
      await collection.insertOne({ _id: "2", number: 2, value: 5 });
      await subscriber._queue.flush();

      const removedMock = mock.method(multiplexer, "removed");

      // Make _id "2" ineligible. The UPDATE handler checks #sortDocs.has —
      // if true it fires removed, if false it returns silently. With the
      // bug "2" isn't keyed by its _id so the removed event never fires.
      await collection.updateOne({ _id: "2" }, { $set: { value: 100 } });
      await subscriber._queue.flush();

      assert.strictEqual(removedMock.mock.callCount(), 1, "should have fired removed when the ineligible doc was in the set");
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2");
    });

    it("should evict the actual tail on overflow when inserting before the head (regression: line 445)", async () => {
      const { collection, multiplexer, subscriber } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "2", number: 2 }]
      );

      const removedMock = mock.method(multiplexer, "removed");

      // First overflow: insert "0" before head, evicts "2".
      await collection.insertOne({ _id: "0", number: 0 });
      await subscriber._queue.flush();

      // Second overflow: insert "-1" before head. With a clean #sortDocs the
      // new tail is "1" so we'd evict "1". The buggy code passed tail.value
      // (a SortT, not the key) to OrderedDict.remove() so the eviction was a
      // silent no-op and #sortDocs.tail kept pointing at the stale "2" — so
      // the second overflow tries to evict "2" again.
      await collection.insertOne({ _id: "-1", number: -1 });
      await subscriber._queue.flush();

      assert.strictEqual(removedMock.mock.callCount(), 2);
      assert.strictEqual(removedMock.mock.calls[0].arguments[0], "2");
      assert.strictEqual(
        removedMock.mock.calls[1].arguments[0],
        "1",
        "second overflow should evict '1' (the new tail), not the stale '2'"
      );
    });

    it("should evict the actual tail on overflow when inserting in the middle (regression: line 484)", async () => {
      const { collection, multiplexer, subscriber } = await setup(
        {},
        { sort: { number: 1 }, limit: 2 },
        [{ _id: "1", number: 1 }, { _id: "3", number: 3 }]
      );

      const addedBeforeMock = mock.method(multiplexer, "addedBefore");

      // Middle insert with overflow: "2" lands between "1" and "3" and "3"
      // should be evicted from #sortDocs. Buggy code passed tail.value to
      // remove() so #sortDocs still contains "3" with #sortDocs.tail
      // pointing at it.
      await collection.insertOne({ _id: "2", number: 2 });
      await subscriber._queue.flush();

      // Insert "2.5". With a clean #sortDocs the tail is "2" (n=2) so the
      // doc lands AFTER the tail — limit is full, no event. With the buggy
      // state #sortDocs.tail is still "3" (n=3) so the driver routes the
      // doc through the middle path and (incorrectly) emits another
      // addedBefore.
      await collection.insertOne({ _id: "2.5", number: 2.5 });
      await subscriber._queue.flush();

      assert.strictEqual(
        addedBeforeMock.mock.callCount(),
        1,
        "second insert should produce no new addedBefore — it sorts after the new tail and the limit is full"
      );
    });

    it("requery should await async addedBefore callbacks under real I/O latency (regression: TODO B)", async () => {
      const { collection, multiplexer, subscriber } = await setup(
        { value: { $lt: 10 } },
        { sort: { number: 1 }, limit: 2 },
        [
          { _id: "1", number: 1, value: 5 },
          { _id: "2", number: 2, value: 5 },
          { _id: "3", number: 3, value: 5 }
        ]
      );

      // Wrap findOne with a real timeout so the async addedBefore handler
      // in #requery cannot complete in the same scheduler turn as the
      // subscriber queue. Without diffQueryOrderedChanges awaiting the
      // returned promise, subscriber._queue.flush() resolves before the
      // multiplexer is notified about the new doc.
      const originalFindOne = collection.findOne.bind(collection);
      collection.findOne = async (...args) => {
        await setTimeout(10);
        return originalFindOne(...args);
      };

      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      const removedMock = mock.method(multiplexer, "removed");

      // Make _id "1" ineligible. With limit=2 and #sortDocs.size=2, the
      // UPDATE handler routes through requery, which produces a synchronous
      // removed("1") and an async addedBefore("3") (awaiting findOne).
      await collection.updateOne({ _id: "1" }, { $set: { value: 100 } });
      await subscriber._queue.flush();

      assert.strictEqual(removedMock.mock.callCount(), 1, "removed should fire for _id '1'");
      assert.strictEqual(
        addedBeforeMock.mock.callCount(),
        1,
        "addedBefore should fire for _id '3' before flush returns"
      );
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "3");
    });

    it("should clean up sortDocs in requery's removed callback", async () => {
      const {
        collection,
        multiplexer,
        subscriber
      } = await setup(
        { value: { $lt: 10 } },
        { sort: { number: 1 }, limit: 2 },
        [
          { _id: "1", number: 1, value: 5 },
          { _id: "2", number: 2, value: 5 },
          { _id: "3", number: 3, value: 5 }
        ]
      );

      // Make _id "1" ineligible. With limit=2 and #sortDocs.size=2, this hits
      // the requery branch in #processLimitSortMessage. The requery's `removed`
      // callback fires for "1"; the buggy code passed the stored value to
      // OrderedDict.remove() instead of the id, so the entry under "1" was
      // never removed and "1" leaked as the head of #sortDocs.
      await collection.updateOne({ _id: "1" }, { $set: { value: 100 } });
      await subscriber._queue.flush();

      // Insert a doc that sorts before the new head. With a clean #sortDocs
      // the head is "2", so addedBefore is called with before="2". With the
      // leak the head is the stale "1", so addedBefore is called with
      // before="1" — which the multiplexer no longer knows about.
      const addedBeforeMock = mock.method(multiplexer, "addedBefore");
      await collection.insertOne({ _id: "0", number: 0, value: 5 });
      await subscriber._queue.flush();

      assert.strictEqual(addedBeforeMock.mock.callCount(), 1, "should have called addedBefore once for the new doc");
      assert.strictEqual(addedBeforeMock.mock.calls[0].arguments[0], "0");
      assert.strictEqual(
        addedBeforeMock.mock.calls[0].arguments[2],
        "2",
        "addedBefore should reference the new head '2', not the stale '1'"
      );
    });

  });

  describe("manager FIELDS / projection intersection (regression: TODO G fetch filtering)", () => {
    // These tests gate on a future change to SubscriptionManager.process:
    // when an UPDATE message's RedisPipe.FIELDS doesn't overlap the
    // channel's entry.projection (top-level), the manager should skip
    // the findOne entirely.
    //
    // Cases marked "should fetch" are contract guards that already pass.
    // Cases marked "should NOT fetch" are regression gates that fail on
    // current code and will pass once the FIELDS-intersection check lands.
    //
    // Top-level normalization (`key.split(".")[0]`) on both projection
    // keys and FIELDS makes the supported projection forms behave
    // identically:
    //   { a: 1 }          → top-level "a"
    //   { "a.b": 1 }      → top-level "a"
    //
    // Note: MongoDB also accepts the nested-object form { a: { b: 1 } }
    // as equivalent to { "a.b": 1 }, but Minimongo's _compileProjection
    // rejects it with `Projection values should be one of 1, 0, true, or
    // false`. Since this codebase passes user projections through
    // _compileProjection during subscriber construction, the nested form
    // never reaches the manager — there's no need to test it for
    // FIELDS-intersection. See the dedicated test below that documents
    // this restriction.

    async function setupSingle(projection) {
      const pubSubManager = new TestPubSubManager();
      const collection = new CollectionThatEmits(
        collectionName,
        [{ _id: "1", a: { b: 1, c: 2 }, c: 3, name: "x" }],
        pubSubManager
      );
      const subscriptionManager = new SubscriptionManager(pubSubManager);
      const cursor = collection.find({}, { projection });
      const multiplexer = new ObserveMultiplexer({ ordered: false });
      multiplexer.addHandleAndSendInitialAdds({ observes: () => false });
      const subscriber = new RedisObserverDriver(cursor, collection, {
        ordered: false,
        manager: subscriptionManager,
        Matcher: Minimongo.Matcher,
        compileProjection: LocalCollection._compileProjection
      });
      await subscriber.init(multiplexer);
      return { pubSubManager, collection, subscriber };
    }

    async function emitUpdate(pubSubManager, fields) {
      await pubSubManager.emit(collectionName, {
        [RedisPipe.EVENT]: Events.UPDATE,
        [RedisPipe.DOC]: { _id: "1" },
        [RedisPipe.FIELDS]: fields,
        [RedisPipe.UID]: "someone-else"
      });
    }

    // The spy is attached after init, so all calls it sees come from
    // SubscriptionManager.process (the only path that calls findOne with
    // a projection in this setup).

    it("projection { a: 1 } + FIELDS=['a'] should fetch", async () => {
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "FIELDS overlap projection at top-level — must fetch");
    });

    it("projection { a: 1 } + FIELDS=['c'] should NOT fetch", async () => {
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 0, "no overlap — fetch must be skipped");
    });

    it("nested-object projection { a: { b: 1 } } is rejected by Minimongo (so the FIELDS-intersection check never sees this form)", async () => {
      await assert.rejects(
        () => setupSingle({ a: { b: 1 } }),
        /Projection values should be one of 1, 0, true, or false/
      );
    });

    it("projection { 'a.b': 1 } + FIELDS=['a'] should fetch", async () => {
      const { pubSubManager, collection, subscriber } = await setupSingle({ "a.b": 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "dotted projection: top-level 'a' overlaps — must fetch");
    });

    it("projection { 'a.b': 1 } + FIELDS=['c'] should NOT fetch", async () => {
      const { pubSubManager, collection, subscriber } = await setupSingle({ "a.b": 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 0, "dotted projection: 'c' doesn't overlap 'a' — skip");
    });

    it("projection { 'a.b': 1 } + FIELDS=['a.b'] should fetch (defensive normalize)", async () => {
      // FIELDS as produced by publish.ts is always top-level (split on ".").
      // But if some other producer sends a dotted FIELDS entry, the
      // intersection check should defensively normalize that too.
      const { pubSubManager, collection, subscriber } = await setupSingle({ "a.b": 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a.b"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "defensive: 'a.b' top-level normalizes to 'a' — must fetch");
    });

    it("projection { a: 0 } (exclusion) + FIELDS=['a'] should NOT fetch", async () => {
      // Exclusion projection: subscriber explicitly does NOT want field `a`.
      // An update touching only `a` is irrelevant — must skip.
      // The semantics invert relative to inclusion: fetch iff FIELDS
      // contains any key NOT in the excluded set.
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 0, "exclusion: 'a' was excluded — irrelevant change, skip");
    });

    it("projection { a: 0 } (exclusion) + FIELDS=['c'] should fetch", async () => {
      // 'c' isn't in the excluded set, so the subscriber wants to see
      // its updates. Must fetch.
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "exclusion: 'c' isn't excluded — relevant change, fetch");
    });

    it("projection { _id: 1 } (only _id) + FIELDS=['c'] should NOT fetch", async () => {
      // {_id: 1} is an inclusion projection that includes ONLY `_id`.
      // No update to any other field is relevant to this subscriber.
      // (Unlike `{}` which means "all fields", `{_id: 1}` means "only _id".)
      const { pubSubManager, collection, subscriber } = await setupSingle({ _id: 1 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 0, "{_id: 1} includes only _id — no other-field update is relevant");
    });

    it("projection { _id: 0 } (exclude only _id) + FIELDS=['c'] should fetch", async () => {
      // {_id: 0} is an exclusion projection that excludes ONLY _id.
      // The subscriber wants every other field — must fetch on any
      // non-_id update.
      const { pubSubManager, collection, subscriber } = await setupSingle({ _id: 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "{_id: 0} excludes only _id — 'c' is wanted, must fetch");
    });

    it("projection { 'a.b.c': 0 } (deep exclusion) + FIELDS=['a'] should fetch", async () => {
      // Deep-path exclusion only blocks `a.b.c` — the subscriber still
      // wants the rest of `a` (e.g., a.b.d, a.x). An update touching the
      // top-level `a` may have changed any of those, so we must fetch.
      // Top-level normalization (k.split('.')[0]) is correct for inclusion
      // but loses information for exclusion: only exact-top-level keys
      // (no dot) actually exclude the whole top-level field.
      const { pubSubManager, collection, subscriber } = await setupSingle({ "a.b.c": 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a"]);
      await subscriber._queue.flush();
      assert.strictEqual(
        spy.mock.callCount(),
        1,
        "deep exclusion: top-level 'a' may still be needed — must fetch"
      );
    });

    it("projection { a: 0, 'b.c': 0 } + FIELDS=['a'] should NOT fetch", async () => {
      // Companion to the FIELDS=['b'] case: 'a' has an exact-top-level
      // exclusion, so the subscriber doesn't want anything under 'a'.
      // An update touching only 'a' is irrelevant — skip the fetch.
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 0, "b.c": 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["a"]);
      await subscriber._queue.flush();
      assert.strictEqual(
        spy.mock.callCount(),
        0,
        "exact-top-level exclusion of 'a' covers the whole field — skip"
      );
    });

    it("projection { a: 0, 'b.c': 0 } + FIELDS=['b'] should fetch", async () => {
      // Mixed exact + dotted exclusion. 'a' is fully excluded; 'b' is only
      // partially (only b.c blocked) so an update touching 'b' may have
      // changed b.d, b.x, etc. — must fetch.
      const { pubSubManager, collection, subscriber } = await setupSingle({ a: 0, "b.c": 0 });
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["b"]);
      await subscriber._queue.flush();
      assert.strictEqual(
        spy.mock.callCount(),
        1,
        "partial top-level exclusion: 'b' isn't fully excluded — must fetch"
      );
    });

    it("projection {} (empty = all fields) + FIELDS=['c'] should fetch", async () => {
      // Empty projection means "all fields" in Mongo semantics, so any
      // update could be relevant — must always fetch.
      const { pubSubManager, collection, subscriber } = await setupSingle({});
      const spy = mock.method(collection, "findOne");
      await emitUpdate(pubSubManager, ["c"]);
      await subscriber._queue.flush();
      assert.strictEqual(spy.mock.callCount(), 1, "empty projection means all fields — must always fetch");
    });
  });
});

describe("canUseRedisOplog", () => {
  const baseOptions = {
    Matcher: Minimongo.Matcher,
    compileProjection: LocalCollection._compileProjection,
  };

  it("returns true for a cursor with no projection and no filter", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, {});
    assert.strictEqual(canUseRedisOplog(cursor, baseOptions), true);
  });

  it("returns false when disableOplog is set, without checking the projection", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, { projection: { foo: { $slice: 1 } } });
    let called = false;
    const compileProjection = () => { called = true; return () => ({}); };
    const result = canUseRedisOplog(cursor, {
      Matcher: Minimongo.Matcher,
      compileProjection,
      disableOplog: true,
    });
    assert.strictEqual(result, false);
    assert.strictEqual(called, false, "compileProjection should not be called when disableOplog short-circuits");
  });

  it("does not call compileProjection when no projection is provided", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, {});
    let called = false;
    const compileProjection = () => { called = true; return () => ({}); };
    const result = canUseRedisOplog(cursor, { Matcher: Minimongo.Matcher, compileProjection });
    assert.strictEqual(result, true);
    assert.strictEqual(called, false);
  });

  it("calls compileProjection with the cursor's projection when one is provided", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, { projection: { foo: 1, bar: 1 } });
    let received;
    const compileProjection = (projection) => { received = projection; return () => ({}); };
    canUseRedisOplog(cursor, { Matcher: Minimongo.Matcher, compileProjection });
    assert.deepStrictEqual(received, { foo: 1, bar: 1 });
  });

  it("returns true for a supported projection", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, { projection: { foo: 1 } });
    assert.strictEqual(canUseRedisOplog(cursor, baseOptions), true);
  });

  it("returns false when compileProjection throws (unsupported operator in projection)", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, { projection: { tags: { $slice: 2 } } });
    assert.strictEqual(canUseRedisOplog(cursor, baseOptions), false);
  });

  it("returns false when compileProjection throws a generic error", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({}, { projection: { foo: 1 } });
    const compileProjection = () => { throw new Error("nope"); };
    const result = canUseRedisOplog(cursor, { Matcher: Minimongo.Matcher, compileProjection });
    assert.strictEqual(result, false);
  });

  it("returns false when the filter contains $where", () => {
    const collection = new FakeCollection([]);
    const cursor = collection.find({ $where: "this.value === 1" }, {});
    assert.strictEqual(canUseRedisOplog(cursor, baseOptions), false);
  });
});
