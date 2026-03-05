import { SessionStore } from "../src/session/tree";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function run() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-bench-"));

  try {
    const store = new SessionStore(root);

    console.log("Adding turns...");
    const turns = 1000;
    for (let i = 0; i < turns; i++) {
      await store.addTurn({
        id: `turn-${i}`,
        parentId: i > 0 ? `turn-${i-1}` : null,
        rootId: 'turn-0',
        role: 'user',
        content: 'hello world '.repeat(10),
        createdAt: new Date().toISOString()
      });
    }

    console.log(`Measuring allTurns() 100 times after ${turns} turns added...`);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await store.allTurns();
    }
    const end = performance.now();
    console.log(`100 calls to allTurns took ${end - start}ms`);

  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

run().catch(console.error);
