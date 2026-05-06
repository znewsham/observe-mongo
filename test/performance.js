// this file is for manual performance testing of the AsynchronousQueue class
// it is not part of the automated test suite
import { AsynchronousQueue } from "../lib/serverQueue.js";

const QUEUE_COUNT = 100000;
const TASK_COUNT = 100000;
const ROUNDS = 100;

export async function runPerformanceTestRound() {
  const queues = new Array(QUEUE_COUNT).fill(0).map(() => new AsynchronousQueue());

  for (let i = 0; i < TASK_COUNT; i++) {
    const queueIndex = i % QUEUE_COUNT;
    queues[queueIndex].queueTask(async () => {
      await 1;
    });
  }
  await Promise.all(queues.map(queue => queue.flush()));

  // not part of the performance test - but I want them present to ensure correctness while iterating, arguably redundant but useful
  await queues[0].runTask(async () => {
    try {
      await queues[0].runTask(() => {});
      throw new Error("Expected 'Can't runTask from another task in the same queue'");
    }
    catch (e) {
      // Expected error
    }
  });
  await queues[0].runTask(async () => {
    try {
      await queues[1].runTask(() => {});
    }
    catch (e) {
      throw new Error("UnExpected 'Can't runTask from another task in the same queue'");
    }
  });
  await queues[0].runTask(async () => {
    try {
      await queues[1].runTask(() => queues[0].runTask(() => {
        // a -> b -> a is still not allowed. It won't deadlock if you don't await it - but how can we possibly check that?
      }));
      throw new Error("Expected 'Can't runTask from another task in the same queue'");
    }
    catch (e) {
      // Expected error
    }
  });
  queues.forEach(queue => queue.destroy());
}


export async function runPerformanceTests() {
  console.log(`Running performance tests: ${ROUNDS} rounds of ${TASK_COUNT} tasks across ${QUEUE_COUNT} queues.`);

  const start = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    console.log(`Starting round ${round + 1}...`);
    const roundStart = Date.now();
    await runPerformanceTestRound();
    const roundEnd = Date.now();
    console.log(`Completed round ${round + 1} in ${roundEnd - roundStart} ms.`);
  }
  const end = Date.now();

  console.log(`Completed all performance tests in ${end - start} ms.`);
}


runPerformanceTests().catch(console.error);
