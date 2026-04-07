import { performance } from "node:perf_hooks";

// A dummy stream simulating tokens arriving fast
async function* createDummyStream(count: number) {
  for (let i = 0; i < count; i++) {
    yield { type: "token", token: "a" };
  }
}

// A mock UI update function that takes a small amount of time (e.g., 1ms RPC overhead)
async function mockUiUpdate() {
  await new Promise(r => setTimeout(r, 1));
}

// Current blocking implementation
async function streamAgentTurnBlocking(tokenCount: number) {
  const stream = createDummyStream(tokenCount);
  let count = 0;
  for await (const event of stream) {
    if (event.type === "token") {
      count++;
      await mockUiUpdate();
    }
  }
}

// Optimized implementation
async function streamAgentTurnOptimized(tokenCount: number) {
  const stream = createDummyStream(tokenCount);
  let count = 0;
  const pendingUiUpdates: Promise<void>[] = [];

  for await (const event of stream) {
    if (event.type === "token") {
      count++;
      pendingUiUpdates.push(mockUiUpdate());
    }
  }
  await Promise.all(pendingUiUpdates);
}

async function runBenchmark() {
  const tokenCount = 1000;

  console.log(`Running benchmark with ${tokenCount} tokens...`);

  // Warmup
  await streamAgentTurnBlocking(100);
  await streamAgentTurnOptimized(100);

  const startBlocking = performance.now();
  await streamAgentTurnBlocking(tokenCount);
  const endBlocking = performance.now();
  const blockingTime = endBlocking - startBlocking;

  const startOptimized = performance.now();
  await streamAgentTurnOptimized(tokenCount);
  const endOptimized = performance.now();
  const optimizedTime = endOptimized - startOptimized;

  console.log(`Blocking time: ${blockingTime.toFixed(2)} ms`);
  console.log(`Optimized time: ${optimizedTime.toFixed(2)} ms`);
  console.log(`Improvement: ${((blockingTime - optimizedTime) / blockingTime * 100).toFixed(2)}% faster`);
}

runBenchmark().catch(console.error);
