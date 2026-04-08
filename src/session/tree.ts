import { mkdir, access, stat } from "node:fs/promises";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export interface SessionTurn {
  id: string;
  parentId: string | null;
  rootId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SessionTreeStats {
  roots: number;
  turns: number;
}

const SESSION_FILE = "sessions.jsonl";

export class SessionStore {
  private filePath: string;
  private cachedTurns: SessionTurn[] | null = null;
  private lastFileStats: { size: number; mtimeMs: number } | null = null;

  constructor(private readonly workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, ".pi", SESSION_FILE);
  }

  private async ensureStore(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await access(this.filePath);
    } catch {
      await appendFile(this.filePath, "", "utf8");
    }
  }

  private deserialize(raw: string): SessionTurn[] {
    const items: SessionTurn[] = [];
    for (const line of raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)) {
      try {
        const parsed = JSON.parse(line) as SessionTurn;
        items.push(parsed);
      } catch {
        // ignore malformed line
      }
    }
    return items;
  }

  private cloneTurns(turns: SessionTurn[]): SessionTurn[] {
    return turns.map((turn) => ({
      ...turn,
      metadata: turn.metadata ? { ...turn.metadata } : undefined,
    }));
  }

  public async allTurns(): Promise<SessionTurn[]> {
    await this.ensureStore();
    const stats = await stat(this.filePath);

    if (this.cachedTurns && this.lastFileStats && stats.size === this.lastFileStats.size && stats.mtimeMs === this.lastFileStats.mtimeMs) {
      return this.cloneTurns(this.cachedTurns);
    }

    const content = await readFile(this.filePath, "utf8");
    this.cachedTurns = this.deserialize(content);
    this.lastFileStats = { size: stats.size, mtimeMs: stats.mtimeMs };
    return this.cloneTurns(this.cachedTurns);
  }

  public async addTurn(turn: SessionTurn): Promise<void> {
    await this.ensureStore();
    await appendFile(this.filePath, `${JSON.stringify(turn)}\n`, "utf8");
    if (this.cachedTurns) {
      this.cachedTurns.push(turn);
    }
    this.lastFileStats = null;
  }

  public createRootTurn(role: SessionTurn["role"], content: string): SessionTurn {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    return {
      id,
      parentId: null,
      rootId: id,
      role,
      content,
      createdAt: now,
    };
  }

  public async appendTurn(parentId: string, role: SessionTurn["role"], content: string): Promise<SessionTurn> {
    const all = await this.allTurns();
    const parent = all.find((item) => item.id === parentId);
    if (!parent) {
      throw new Error(`Parent session turn not found: ${parentId}`);
    }

    const turn: SessionTurn = {
      id: crypto.randomUUID(),
      parentId,
      rootId: parent.rootId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };

    await this.addTurn(turn);
    return turn;
  }

  public async branch(leafId: string, role: SessionTurn["role"], content: string): Promise<SessionTurn> {
    return this.appendTurn(leafId, role, content);
  }

  public async getTurn(id: string): Promise<SessionTurn | undefined> {
    const turns = await this.allTurns();
    return turns.find((item) => item.id === id);
  }

  public async getBranch(leafId: string): Promise<SessionTurn[]> {
    const turns = await this.allTurns();
    const map = new Map<string, SessionTurn>(turns.map((turn) => [turn.id, turn]));
    const chain: SessionTurn[] = [];
    let current = map.get(leafId);

    while (current) {
      chain.push(current);
      current = current.parentId ? map.get(current.parentId) : undefined;
    }

    return chain.reverse();
  }

  public async getHeads(): Promise<SessionTurn[]> {
    const turns = await this.allTurns();
    const parents = new Set<string>(turns.map((turn) => turn.parentId).filter((id): id is string => Boolean(id)));
    return turns
      .filter((turn) => !parents.has(turn.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  public async stats(): Promise<SessionTreeStats> {
    const turns = await this.allTurns();
    return { roots: turns.filter(t => !t.parentId).length, turns: turns.length };
  }
}

export class SessionTree {
  constructor(private readonly store: SessionStore) {}

  public async createRoot(role: SessionTurn["role"], content: string): Promise<SessionTurn> {
    const root = this.store.createRootTurn(role, content);
    await this.store.addTurn(root);
    return root;
  }

  public async fork(leafId: string, role: SessionTurn["role"], content: string): Promise<SessionTurn> {
    return this.store.branch(leafId, role, content);
  }

  public async tree(): Promise<SessionTurn[]> {
    return this.store.getHeads();
  }

  public async history(leafId: string): Promise<SessionTurn[]> {
    return this.store.getBranch(leafId);
  }

  public async getTurn(id: string): Promise<SessionTurn | undefined> {
    return this.store.getTurn(id);
  }
}
