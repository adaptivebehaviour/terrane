import { randomUUID } from 'node:crypto';
import { open, readFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

/** The `workspace.json` format version this app reads and writes. */
export const FORMAT_VERSION = 1;

interface LockInfo {
  pid: number;
  instanceId: string;
  startedAt: string;
}

interface LockOptions {
  /** A lock whose heartbeat is older than this is taken over, even if its pid still exists (pid reuse). */
  staleMs?: number;
  heartbeatMs?: number;
}

const LOCK_FILE = '.lock';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not ours: still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readInfo(path: string): Promise<LockInfo | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockInfo>;
    if (typeof value.pid === 'number' && typeof value.instanceId === 'string') return value as LockInfo;
  } catch {
    // unreadable or half-written lock: treated as stale by the caller
  }
  return undefined;
}

/** Holds the single-instance lock on one workspace until `release()`. */
export class WorkspaceLock {
  readonly info: LockInfo;
  private readonly path: string;
  private readonly timer: NodeJS.Timeout;
  private released = false;

  constructor(path: string, info: LockInfo, heartbeatMs: number) {
    this.path = path;
    this.info = info;
    this.timer = setInterval(() => {
      const now = new Date();
      utimes(this.path, now, now).catch(() => undefined);
    }, heartbeatMs);
    this.timer.unref();
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    clearInterval(this.timer);
    const current = await readInfo(this.path);
    if (current?.instanceId === this.info.instanceId) await rm(this.path, { force: true });
  }
}

/**
 * Takes the workspace lock by creating `.lock` exclusively. If a live lock exists, throws (another instance has the
 * workspace open); a stale one (dead pid, unreadable, or no heartbeat for `staleMs`) is taken over.
 */
export async function acquireLock(root: string, options: LockOptions = {}): Promise<WorkspaceLock> {
  const staleMs = options.staleMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const path = join(root, LOCK_FILE);
  const info: LockInfo = { pid: process.pid, instanceId: randomUUID(), startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(JSON.stringify(info));
        await handle.datasync();
      } finally {
        await handle.close();
      }
      return new WorkspaceLock(path, info, heartbeatMs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const existing = await readInfo(path);
    let fresh: boolean;
    try {
      fresh = Date.now() - (await stat(path)).mtimeMs < staleMs;
    } catch {
      continue; // vanished between the two calls: try again
    }
    if (existing && fresh && pidAlive(existing.pid)) {
      throw new Error(`Workspace is in use by another instance (pid ${existing.pid}, since ${existing.startedAt})`);
    }
    await rm(path, { force: true });
  }
  throw new Error('Could not take the workspace lock');
}
