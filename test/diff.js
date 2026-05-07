import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { diffQueryOrderedChanges } from "../lib/diff.js";

describe("diffQueryOrderedChanges", () => {
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
