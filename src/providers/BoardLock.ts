import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

// Coordinate extension hosts using the same board without adding a lock file to
// its persistence format. A crashed host's lock can be safely reclaimed.
const withLockDirectory = async <T>(lock: string, operation: () => Promise<T>, deadline: number): Promise<T> => {
  const owner = path.join(lock, "owner.json");
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const abandoned = async (): Promise<boolean> => {
    try {
      const info: unknown = JSON.parse(await fs.readFile(owner, "utf8"));
      if (info && typeof info === "object" && "pid" in info &&
        Number.isInteger(info.pid) && Number(info.pid) > 0) {
        try {process.kill(Number(info.pid), 0); return false;} catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {return true;}
          // EPERM means a process exists but is owned by another user.
          return false;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const stat = await fs.stat(lock).catch(() => undefined);
        if (!stat) {return false;}
        return Date.now() - stat.mtimeMs > 30000;
      }
    }
    // Allow the creator time to write ownership before reclaiming incomplete
    // locks. Malformed ownership is never passed to process.kill().
    const stat = await fs.stat(lock).catch(() => undefined);
    return !!stat && Date.now() - stat.mtimeMs > 30000;
  };
  while (true) {
    try {
      await fs.mkdir(lock);
      try {await fs.writeFile(owner, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });} catch (error) {
        await fs.rm(lock, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {throw error;}
      if (await abandoned()) {
        // Reclaimers are serialized separately, then recheck ownership. A stale
        // observation must not remove a new lock acquired by another host.
        // The same helper recovers a recovery guard abandoned by a crashed host.
        await withLockDirectory(`${lock}.recovery`, async () => {
          if (await abandoned()) {
            await fs.rm(lock, { recursive: true, force: true });
          }
        }, deadline);
        continue;
      }
      if (Date.now() >= deadline) {throw new Error("Another Lynvo window is saving this board. Try again shortly.");}
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  try {return await operation();} finally {
    const info = await fs.readFile(owner, "utf8").then((raw) => JSON.parse(raw) as { token: string }).catch(() => undefined);
    if (info?.token === token) {await fs.rm(lock, { recursive: true, force: true });}
  }
};

const canonicalWorkspaceKey = async (workspaceKey: string): Promise<string> => {
  const file = /^file:([^:]*):([\s\S]+)$/.exec(workspaceKey);
  if (!file) {return workspaceKey;}
  const authority = file[1].toLowerCase();
  let directory = file[2];
  if (authority && authority !== "localhost") {directory = `//${authority}${directory}`;}
  else if (process.platform === "win32") {directory = directory.replace(/^\/([a-zA-Z]:\/)/, "$1");}
  directory = path.resolve(directory);
  // Resolve the closest existing parent as well: a missing/new workspace below
  // a symlinked parent must use the same lock as its physical path.
  const suffix: string[] = [];
  while (true) {
    try {
      directory = path.join(await fs.realpath(directory), ...suffix);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}
      const parent = path.dirname(directory);
      if (parent === directory) {directory = path.join(directory, ...suffix); break;}
      suffix.unshift(path.basename(directory));
      directory = parent;
    }
  }
  try {
    const stat = await fs.stat(directory, { bigint: true });
    if (stat.isDirectory() && stat.ino !== 0n) {
      // realpath alone can preserve differently cased spellings on an
      // insensitive filesystem. Device/inode identify the physical directory.
      return `file:directory:${stat.dev}:${stat.ino}`;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}
  }
  if (process.platform === "win32") {directory = directory.toLowerCase();}
  return `file:${process.platform === "win32" || authority === "localhost" ? "" : authority}:${directory}`;
};

export const withBoardLock = async <T>(workspaceKey: string, operation: () => Promise<T>): Promise<T> => {
  const canonicalKey = await canonicalWorkspaceKey(workspaceKey);
  const lock = path.join(os.tmpdir(), `lynvo-board-${createHash("sha256").update(canonicalKey).digest("hex")}.lock`);
  return withLockDirectory(lock, operation, Date.now() + 15000);
};
