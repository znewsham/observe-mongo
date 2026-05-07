import { describe, it } from "node:test";
import assert from "node:assert";
import { stringId, fromStringId, naiveClone } from "../lib/types.js";

describe("stringId", () => {
  it("should produce distinct ids for true and false (regression: TODO 7)", () => {
    // jsonable() falls through for booleans to Object.entries() which returns
    // [], so JSON.stringify yields "{}" for any boolean — true and false
    // collide on the same channel/cache key.
    assert.notStrictEqual(stringId(true), stringId(false));
  });
});

describe("fromStringId", () => {
  it("should not throw on a JSON-encoded array containing null (regression: TODO 13)", () => {
    // JSON.parse("[null]") → [null]. jsonToObject hits the array branch and
    // recurses into jsonToObject(null); accessing null.$type throws TypeError.
    assert.doesNotThrow(() => fromStringId("[null]"));
  });
});

describe("naiveClone", () => {
  it("should not throw on undefined input (regression: TODO 12)", () => {
    // observe.ts (lines 132/196) calls cloneIfMutating(cache.get(before))
    // where cache.get can return undefined under upstream race conditions.
    // naiveClone(undefined) is JSON.parse(JSON.stringify(undefined)) =
    // JSON.parse(undefined) which throws SyntaxError. The fix can live
    // either at the call site (guard before cloning) or here (handle
    // undefined); either way naiveClone(undefined) should not crash.
    assert.doesNotThrow(() => naiveClone(undefined));
  });
});
