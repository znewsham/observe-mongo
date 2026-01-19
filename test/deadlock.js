import { after, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { setTimeout as setTimeoutCallback } from "node:timers";
import assert from "node:assert";
import { AsynchronousQueue } from "../lib/serverQueue.js";

function tests(bindTasksToSelf = false) {
  describe(`deadlock ${bindTasksToSelf ? "queue bound tasks (meteor)" : "task bound tasks"}`, () => {
    const queueA = new AsynchronousQueue(bindTasksToSelf);
    const queueB = new AsynchronousQueue(bindTasksToSelf);

    after(() => {
      queueA.destroy();
      queueB.destroy();
    });

    it("deadlock prevention fires when runQueue is called from inside the queue via queueTask", async () => {
      queueA.queueTask(async () => {
        await queueA.runTask(() => {});
      });
      await assert.doesNotReject(() => Promise.race([queueA.flush(), setTimeout(2000)]), "Deadlock error not thrown, but operation doesn't timeout either");
    });

    it("deadlock prevention throws when runQueue is called from inside the queue via runTask", async () => {
      await assert.rejects(() => queueA.runTask(async () => {
        await queueA.runTask(() => {});
      }), /Can't runTask from another task in the same queue/);
    });

    it("deadlock prevention does NOT fire when two queues call each other (queue => run)", async () => {
      queueA.queueTask(async () => {
        await queueB.runTask(() => {});
      });
      await assert.doesNotReject(() => Promise.race([queueA.flush(), setTimeout(2000)]), "Deadlock error not thrown, but operation doesn't timeout either");
    });

    it("deadlock prevention does NOT fire when two queues call each other (run => run)", async () => {
      await assert.doesNotReject(() => queueA.runTask(async () => {
        await queueB.runTask(() => {});
      }), "Deadlock error not thrown");
    });

    it("deadlock prevention throws when two queues call each other (A run => B run => A run)", async () => {
      debugger;
      await assert.rejects(() => queueA.runTask(async () => {
        await queueB.runTask(() => queueA.runTask(() => {}));
      }), /Can't runTask from another task in the same queue/);
    });

    it("deadlock prevention does NOT fire when a queue calls itself inside a timeout (new context)", async () => {
      let ran = false;
      await assert.doesNotReject(() => queueA.runTask(async () => {
        setTimeoutCallback(() => {
          queueA.runTask(() => {
            ran = true;
          });
        }, 10);
      }));
      await setTimeout(50);
      await queueA.flush();
      assert.equal(ran, true, "Inner task did run");
    });

    it("deadlock prevention does NOT fire when a runQueue is called on a running queue from outside", async () => {
      let ran = false;
      let firstRunPromise;
      const firstRunStartedPromise = new Promise((resolve) => {
        firstRunPromise = queueA.runTask(async () => {
          resolve();
          await setTimeout(100); // ensure the inner task is queued after this outer one starts
        });
      });

      await firstRunStartedPromise;
      queueA.runTask(() => {
        ran = true;
      });
      await firstRunPromise;
      await queueA.flush();
      assert.equal(ran, true, "Inner task did run");
    });

    it("deadlock prevention does NOT fire when a queue calls itself inside a timeout if the original task throws", async () => {
      let ran = false;
      await assert.rejects(() => queueA.runTask(async () => {
        setTimeoutCallback(() => {
          queueA.runTask(() => {
            ran = true;
          });
        }, 10);
        throw new Error("Test Throw")
      }), /Test Throw/);
      await setTimeout(50);
      await queueA.flush();
      assert.equal(ran, true, "Inner task did run");
    });

    it("deadlock prevention does NOT fire when a queue calls itself inside a timeout (new context) even if the calling task hasn't completed if the new task calls _markSafeToRunTask", async () => {
      let ran = false;
      await assert.doesNotReject(() => queueA.runTask(async () => {
        setTimeoutCallback(async () => {
          assert.equal(queueA.safeToRunTask(), false, "Queue is not safe to run task yet");
          queueA._markSafeToRunTask();
          await queueA.runTask(() => {
            ran = true;
          });
          assert.equal(ran, true, "We waited for the task to run");
          ran = "awaited";
        }, 10);
        await setTimeout(50);
      }));
      assert.equal(ran, false, "Inner task has not yet run"); // this proves we didn't deadlock, since the outer task completed without waiting for the inner task to run
      await queueA.flush();
      assert.equal(ran, "awaited", "Inner task did run and was awaited");
    });
  });
}

// tests(false);

// this is meteor semantics - tasks run in the context of the queue not the context of the call itself
// in theory this shouldn've have functional impacts on the queue
// just change the AsyncLocalStorage value (e.g., _meteor_dynamics, CurrentMethodInvocation, etc)
// however deadlock detection is also tied to AsyncLocalStorage, so it's entirely possible
tests(true);
