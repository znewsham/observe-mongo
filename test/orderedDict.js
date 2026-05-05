import { describe, it } from "node:test";
import assert from "node:assert";
import { OrderedDict } from "../lib/orderedDict.js";

describe("OrderedDict", () => {
  describe("#tail tracking", () => {
    it("tail should equal the only item after a single add", () => {
      const d = new OrderedDict();
      d.add("a", {});
      assert.strictEqual(d.tail?.key, "a", "tail should be 'a' when 'a' is the only item");
      assert.strictEqual(d.head?.key, "a");
    });

    it("tail should be the last item after add(A); add(B, A) (insert-before-head from single-item state)", () => {
      const d = new OrderedDict();
      d.add("a", {});
      d.add("b", {}, "a");
      // order is now b -> a, so tail should be 'a'
      assert.deepEqual([...d.keys()], ["b", "a"]);
      assert.strictEqual(d.tail?.key, "a", "tail should be 'a' (the last item)");
      assert.strictEqual(d.head?.key, "b");
    });

    it("tail should remain correct after appending following an insert-before", () => {
      const d = new OrderedDict();
      d.add("a", {});
      d.add("b", {}, "a"); // b -> a
      d.add("c", {});      // append: should yield b -> a -> c
      assert.deepEqual([...d.keys()], ["b", "a", "c"], "iteration must include all three items in order");
      assert.strictEqual(d.tail?.key, "c");
      assert.strictEqual(d.size, 3);
    });
  });

  describe("chain integrity", () => {
    it("appending after an insert-before must not orphan the middle item", () => {
      const d = new OrderedDict();
      d.add("a", { v: 1 });
      d.add("b", { v: 2 }, "a"); // b -> a
      d.add("c", { v: 3 });      // append

      // 'a' must still be reachable via iteration (regression: it gets orphaned)
      const seen = [...d.values()].map(v => v.v);
      assert.deepEqual(seen, [2, 1, 3], "iteration must visit b, a, c in order");
      assert.strictEqual(d.get("a")?.v, 1, "get('a') must still work");
      assert.strictEqual(d.has("a"), true);
    });

    it("deleting after a corrupted append must not rewire surviving nodes through a stale pointer", () => {
      const d = new OrderedDict();
      d.add("a", {});
      d.add("b", {}, "a"); // b -> a
      d.add("c", {});      // append (currently corrupts: orphans 'a', makes b.next=c)

      // Deleting the orphaned 'a' currently sets b.next = undefined,
      // severing 'c' from the chain even though 'c' is still in the dict.
      d.delete("a");
      assert.deepEqual([...d.keys()], ["b", "c"], "after deleting 'a', iteration must still yield b, c");
      assert.strictEqual(d.tail?.key, "c");
      assert.strictEqual(d.size, 2);
    });
  });
});
