import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { setTimeout } from "node:timers/promises";
import { diffQueryOrderedChanges, diffQueryUnorderedChanges } from "../lib/diff.js";
import { StringableIdMap } from "../lib/stringableIdMap.js";

describe("diffQueryUnorderedChanges", () => {
  it("should await async observer hooks (regression: TODO C)", async () => {
    // Same shape as TODO B, on the unordered diff. forEach over the
    // StringableIdMap discarded the promises returned by observer hooks
    // so any async caller (current callers happen to be sync via the
    // multiplexer queue, but external callers and a future async
    // multiplexer would silently race).
    let callbackCompleted = false;
    const oldResults = new StringableIdMap();
    oldResults.set("1", { value: "a" });
    const newResults = new StringableIdMap();
    newResults.set("1", { value: "a" });
    newResults.set("2", { value: "b" });

    await diffQueryUnorderedChanges(oldResults, newResults, {
      observes: (h) => h === "added",
      added: async () => {
        await setTimeout(10);
        callbackCompleted = true;
      },
      addedBefore: () => {},
      changed: () => {},
      movedBefore: () => {},
      removed: () => {}
    });

    assert.strictEqual(
      callbackCompleted,
      true,
      "diffQueryUnorderedChanges must await async observer hooks before resolving"
    );
  });
});

describe("diffQueryOrderedChanges", () => {
  it("should await async observer hooks (regression: TODO B)", async () => {
    // The function used to iterate observer hooks via Array.forEach and
    // discard any returned promises. Callers like RedisObserverDriver#requery
    // pass an observer whose addedBefore is async (it awaits collection.findOne
    // before mutating sortDocs and notifying the multiplexer). With the diff
    // sync, the caller's `await diff(...)` returned before the async hook
    // finished — so subsequent message processing raced against in-flight
    // findOne / sortDocs.add work.
    let callbackCompleted = false;
    const oldResults = [{ _id: "1" }];
    const newResults = [{ _id: "1" }, { _id: "2" }];

    await diffQueryOrderedChanges(oldResults, newResults, {
      observes: () => true,
      addedBefore: async () => {
        await setTimeout(10);
        callbackCompleted = true;
      },
      added: () => {},
      changed: () => {},
      movedBefore: () => {},
      removed: () => {}
    });

    assert.strictEqual(
      callbackCompleted,
      true,
      "diffQueryOrderedChanges must await async observer hooks before resolving"
    );
  });

  it("should fire changed for an unmoved anchor with falsy _id (regression: TODO 6)", () => {
    // The LCS algorithm marks every common doc as a "group anchor" and (when
    // its content changed) fires `changed` for it. The buggy `if (groupId)`
    // check was meant to skip the virtual end-of-list anchor (where
    // groupId === undefined) but also skipped legitimate falsy ids like
    // 0 / "" / false — so a doc with _id: 0 whose content changed never got
    // a `changed` event for its anchor branch.
    const oldResults = [
      { _id: 0, value: "old" },
      { _id: "1", value: "b" }
    ];
    const newResults = [
      { _id: 0, value: "new" },
      { _id: "1", value: "b" }
    ];
    const changed = mock.fn();
    diffQueryOrderedChanges(oldResults, newResults, {
      observes: (h) => h === "changed",
      addedBefore: () => {},
      movedBefore: () => {},
      added: () => {},
      removed: () => {},
      changed
    });

    assert.ok(
      changed.mock.calls.some(c => c.arguments[0] === 0),
      "changed should fire for the _id: 0 anchor when its content has changed"
    );
  });
});
