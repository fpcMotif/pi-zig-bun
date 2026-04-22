import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempWorkspace<T>(
  prefix: string,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
