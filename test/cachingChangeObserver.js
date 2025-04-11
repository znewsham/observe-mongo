import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { CachingChangeObserverImpl } from "../lib/cachingChangeObserver.js";

function getCachingChangeObserver(ordered, items = [{ _id: "test1" }, { _id: "test2" }]) {
  const cachingChangeObserver = new CachingChangeObserverImpl({
    ordered,
    cloneDocuments: false
  });

  items.forEach((item) => {
    const { _id, ...rest } = item;
    cachingChangeObserver.added(_id, rest);
  });
  return cachingChangeObserver;
}

describe("cachingChangeObserver", () => {
  [true, false].forEach((ordered) => {
    const orderedMessage = ordered ? "an OrderedDict" : "a StringableIdMap";
    it(`forEach should work when using ${orderedMessage}`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      const forEachMock = mock.fn();
      cachingChangeObserver.forEach(forEachMock);
      assert.deepEqual(
        forEachMock.mock.calls.map(c => c.arguments),
        [[{}, "test1"], [{}, "test2"]]
      );
    });

    it(`added should work when using ${orderedMessage}`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      cachingChangeObserver.added("test3", {});
      assert.strictEqual(cachingChangeObserver.size(), 3);
      assert.throws(
        () => cachingChangeObserver.added("test3", {}),
        /This document already exists/,
        "Throws"
      );
    });

    it(`addedBefore should work when using ${orderedMessage} and not specifying a before`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      cachingChangeObserver.addedBefore("test3", { _id: "test3" });
      assert.strictEqual(cachingChangeObserver.size(), 3);
      assert.throws(
        () => cachingChangeObserver.addedBefore("test3", {}),
        /This document already exists/,
        "Throws"
      );
    });

    it(`addedBefore should work when using ${orderedMessage} and specifying a before that exists`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);

      cachingChangeObserver.addedBefore("test3", { _id: "test3" }, "test1");
      assert.strictEqual(cachingChangeObserver.size(), 3);
      // non ordered observers ignore the "before"
      assert.deepEqual([...cachingChangeObserver.getDocs()][0][0], ordered ? "test3" : "test1");
      assert.throws(
        () => cachingChangeObserver.addedBefore("test3", { _id: "test3" }, "test1"),
        /This document already exists/,
        "Throws"
      );
    });

    it(`addedBefore should throw when using ${orderedMessage} and specifying a before that doesn't exist`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      assert.throws(
        () => cachingChangeObserver.addedBefore("test3", { _id: "test3" }, "test4"),
        /Adding a document before one that doesn't exist/,
        "Throws"
      );
    });

    it(`changed should work when using ${orderedMessage}`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      cachingChangeObserver.changed("test1", { a: true });
      assert.deepEqual([...cachingChangeObserver.getDocs().values()][0], { a: true });
      assert.throws(
        () => cachingChangeObserver.changed("test3", { a: true }),
        /Changed a document that doesn't exist/,
        "Throws"
      );
    });

    it(`movedBefore should work when using ${orderedMessage} and not specifying a before`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);
      cachingChangeObserver.movedBefore("test1");
      assert.deepEqual([...cachingChangeObserver.getDocs().keys()][1], ordered ? "test1" : "test2");
    });

    it(`movedBefore should work when using ${orderedMessage} and specifying a before that exists`, () => {
      const cachingChangeObserver = getCachingChangeObserver(ordered);

      cachingChangeObserver.movedBefore("test2", "test1");
      assert.deepEqual([...cachingChangeObserver.getDocs().keys()][0], ordered ? "test2" : "test1");
    });

    if (ordered) {
      it(`movedBefore should throw when using ${orderedMessage} and specifying a before that doesn't exist`, () => {
        const cachingChangeObserver = getCachingChangeObserver(ordered);
        assert.throws(
          () => cachingChangeObserver.movedBefore("test2", "test4"),
          /Moving the doc to before one that doesn't exist/,
          "Throws"
        );
      });
      it(`movedBefore should throw when using ${orderedMessage} and specifying a doc that doesn't exist`, () => {
        const cachingChangeObserver = getCachingChangeObserver(ordered);
        assert.throws(
          () => cachingChangeObserver.movedBefore("test4", "test2"),
          /Doc doesn't exist/,
          "Throws"
        );
      });

      it(`indexOf should work when using ${orderedMessage}`, () => {
        const cachingChangeObserver = getCachingChangeObserver(ordered);

        assert.strictEqual(cachingChangeObserver.indexOf("test2"), 1);
        assert.strictEqual(cachingChangeObserver.indexOf("test3"), -1);
      });
    }
  });

  it("cloneDocuments should clone documents before storing", () => {
    const original = { field: { nested: "value" } };
    const id = "test1";
    
    // Create a custom cloning function that we can verify was called
    let cloneCalled = false;
    const deepCloneFunction = (doc) => {
      cloneCalled = true;
      return JSON.parse(JSON.stringify(doc));
    };
    
    // Create cache with cloning enabled and custom clone function
    const cachingObserver = new CachingChangeObserverImpl({
      ordered: false,
      cloneDocuments: true,
      clone: deepCloneFunction
    });
    
    // Add document
    cachingObserver.added(id, original);
    
    // Verify clone was called
    assert.strictEqual(cloneCalled, true);
    
    // Modify the original object
    original.field.nested = "modified";
    
    // The stored document should not be affected by the modification
    const stored = cachingObserver.get(id);
    assert.strictEqual(stored.field.nested, "value");
  });
  
  it("should use custom clone function when provided", () => {
    const original = { field: { nested: "value" } };
    const id = "test1";
    
    // Create a custom marker to verify our clone function was used
    const marker = { custom: true };
    const customClone = () => marker;
    
    // Create cache with cloneDocuments enabled and custom clone function
    const cachingObserver = new CachingChangeObserverImpl({
      ordered: false,
      cloneDocuments: true,
      clone: customClone
    });
    
    // Add document
    cachingObserver.added(id, original);
    
    // The stored document should be what our clone function returned
    const stored = cachingObserver.get(id);
    assert.strictEqual(stored, marker);
  });
});
