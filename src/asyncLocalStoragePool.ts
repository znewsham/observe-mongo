/**
 * This file currently exists solely for this comment - though in the future it may grow into a literal pool implementation
 * Why not just use AsyncLocalStorage directly?
 * We expect hundreds of thousands of queues, some short lived, some long lived.
 * When we create 1000 queues (and 1000 instances of AsyncLocalStorage) - we see this horrible scaling as we repeatedly create them
  Running performance tests: 100 rounds of 10000 tasks across 1000 queues.
  Starting round 1...
  Completed round 1 in 1858 ms.
  Starting round 2...
  Completed round 2 in 7297 ms.
  Starting round 3...
  Completed round 3 in 17897 ms.

  When we swap to array based single async local storage - we see this:
  Running performance tests: 100 rounds of 10000 tasks across 1000 queues.
  Completed round 1 in 47 ms.
  Starting round 2...
  Completed round 2 in 75 ms.
  Starting round 3...
  Completed round 3 in 41 ms.
  Starting round 4...
  Completed round 4 in 34 ms.
  Starting round 5...
  Completed round 5 in 33 ms.
  Starting round 6...
  Completed round 6 in 26 ms.
  Starting round 7...
  Completed round 7 in 16 ms.
  Starting round 8...
  Completed round 8 in 15 ms.
  Starting round 9...
  Completed round 9 in 17 ms.

  Massively faster - and scales better (stays around 15-17ms for subsequent rounds)

  In the future, we may want to make the slots claimable - so in the case of lots of short lived queues, we don't constantly grow the array
  Brief experiments show that neither memory nor time are significantly affected by this, so we can leave it for now.
 */
