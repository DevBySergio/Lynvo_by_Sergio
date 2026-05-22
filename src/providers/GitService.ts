import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DataManager } from "./DataManager";
import {
  LynvoActivity,
  LynvoBoard,
  LynvoColumn,
  LynvoConflict,
  LynvoLabel,
  LynvoPresenceUser,
  LynvoSyncMetadata,
  LynvoTask,
  LynvoTombstone,
} from "../types";

type ExecOptions = {
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
};

type SyncStage =
  | "repo"
  | "exclude"
  | "load"
  | "fetch"
  | "branch"
  | "worktree"
  | "merge"
  | "commit"
  | "push";

type BoardMetadata = {
  version: string;
  labels?: Record<string, LynvoLabel>;
};

export type LynvoSyncResult = {
  success: boolean;
  message: string;
  remoteChanged?: boolean;
  hasConflicts?: boolean;
};

const DEFAULT_SYNC: LynvoSyncMetadata = {
  branch: "lynvo-sync",
  status: "idle",
  pendingChanges: false,
  lastSyncAt: null,
  lastRemoteCommit: null,
  updatedAt: 0,
};

export class GitService {
  private static readonly SHADOW_BRANCH = "lynvo-sync";
  private static readonly EMPTY_TREE_SHA =
    "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  private static syncQueue: Promise<LynvoSyncResult> = Promise.resolve({
    success: true,
    message: "Sincronización pendiente.",
  });
  private static scheduledSync: NodeJS.Timeout | undefined;

  private static getWorkspacePath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  }

  private static execGit(args: string[], options: ExecOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = cp.spawn("git", args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const details = stderr.trim() || stdout.trim() || `git ${args[0]} failed`;
          reject(new Error(`git ${args.join(" ")}: ${details}`));
        }
      });

      if (options.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }

  private static async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private static async readJson<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      await this.backupCorruptJson(filePath, raw).catch((backupError) =>
        console.error(`Lynvo: failed to backup corrupt remote json ${filePath}`, backupError),
      );
      throw error;
    }
  }

  private static async backupCorruptJson(
    filePath: string,
    raw: string,
  ): Promise<void> {
    const fileName = path.basename(filePath);
    if (fileName.includes(".corrupt-")) {
      return;
    }

    await fs.writeFile(`${filePath}.corrupt-${Date.now()}`, raw, "utf8");
  }

  private static async readOptionalJson<T>(
    filePath: string,
    fallback: T,
  ): Promise<T> {
    if (!(await this.pathExists(filePath))) {
      return fallback;
    }

    try {
      return await this.readJson<T>(filePath);
    } catch {
      return fallback;
    }
  }

  private static async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private static async ensureExcludedFromActiveWorktree(
    repoRoot: string,
    relativeLynvoPath: string,
  ): Promise<void> {
    const excludePath = await this.execGit(["rev-parse", "--git-path", "info/exclude"], {
      cwd: repoRoot,
    });
    const absoluteExcludePath = path.isAbsolute(excludePath)
      ? excludePath
      : path.join(repoRoot, excludePath);
    const normalizedEntry = `/${relativeLynvoPath}/`;
    const current = (await this.pathExists(absoluteExcludePath))
      ? await fs.readFile(absoluteExcludePath, "utf8")
      : "";

    if (current.split(/\r?\n/).includes(normalizedEntry)) {
      return;
    }

    await fs.mkdir(path.dirname(absoluteExcludePath), { recursive: true });
    await fs.appendFile(
      absoluteExcludePath,
      `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${normalizedEntry}\n`,
      "utf8",
    );
  }

  private static async readBoardFromFolder(root: string): Promise<LynvoBoard | null> {
    const boardPath = path.join(root, "board.json");
    const columnsPath = path.join(root, "columns.json");
    const usersPath = path.join(root, "users.json");
    const tasksPath = path.join(root, "tasks");
    const activityPath = path.join(root, "activity");
    const metadataPath = path.join(root, "metadata");

    if (!(await this.pathExists(boardPath)) || !(await this.pathExists(columnsPath))) {
      return null;
    }

    const metadata = await this.readJson<BoardMetadata>(boardPath);
    const columns = await this.readJson<Record<string, LynvoColumn>>(columnsPath);
    const users = await this.readOptionalJson<Record<string, LynvoPresenceUser>>(
      usersPath,
      {},
    );
    const tasks: Record<string, LynvoTask> = {};
    const activity: Record<string, LynvoActivity> = {};
    const sync = await this.readOptionalJson<LynvoSyncMetadata>(
      path.join(metadataPath, "sync.json"),
      DEFAULT_SYNC,
    );
    const tombstones = await this.readOptionalJson<Record<string, LynvoTombstone>>(
      path.join(metadataPath, "tombstones.json"),
      {},
    );
    const conflicts = await this.readOptionalJson<Record<string, LynvoConflict>>(
      path.join(metadataPath, "conflicts.json"),
      {},
    );

    if (await this.pathExists(tasksPath)) {
      const entries = await fs.readdir(tasksPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {continue;}
        try {
          const task = await this.readJson<LynvoTask>(path.join(tasksPath, entry.name));
          if (task.id) {tasks[task.id] = task;}
        } catch (error) {
          console.error(`Lynvo: invalid remote task file ${entry.name}`, error);
        }
      }
    }

    if (await this.pathExists(activityPath)) {
      const entries = await fs.readdir(activityPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {continue;}
        try {
          const item = await this.readJson<LynvoActivity>(
            path.join(activityPath, entry.name),
          );
          if (item.id) {activity[item.id] = item;}
        } catch (error) {
          console.error(`Lynvo: invalid remote activity file ${entry.name}`, error);
        }
      }
    }

    return {
      version: metadata.version || "2.0.0",
      columns,
      tasks,
      labels: metadata.labels || {},
      users,
      activity,
      sync,
      tombstones,
      conflicts,
    };
  }

  private static async writeBoardToFolder(
    root: string,
    board: LynvoBoard,
  ): Promise<void> {
    const tasksPath = path.join(root, "tasks");
    const activityPath = path.join(root, "activity");
    await fs.mkdir(tasksPath, { recursive: true });
    await fs.mkdir(path.join(root, "comments"), { recursive: true });
    await fs.mkdir(path.join(root, "activity"), { recursive: true });
    await fs.mkdir(path.join(root, "metadata"), { recursive: true });

    await this.writeJson(path.join(root, "board.json"), {
      version: "2.0.0",
      labels: board.labels || {},
    });
    await this.writeJson(path.join(root, "columns.json"), board.columns);
    await this.writeJson(path.join(root, "users.json"), board.users || {});
    await this.writeJson(path.join(root, "settings.json"), {});
    await this.writeJson(path.join(root, "metadata", "version.json"), {
      schemaVersion: "2.0.0",
    });
    await this.writeJson(path.join(root, "metadata", "sync.json"), {
      branch: this.SHADOW_BRANCH,
      status: board.sync?.status || "synced",
      pendingChanges: board.sync?.pendingChanges || false,
      lastSyncAt: board.sync?.lastSyncAt || null,
      lastRemoteCommit: board.sync?.lastRemoteCommit || null,
      message: board.sync?.message,
      updatedAt: Date.now(),
    });
    await this.writeJson(
      path.join(root, "metadata", "tombstones.json"),
      board.tombstones || {},
    );
    await this.writeJson(
      path.join(root, "metadata", "conflicts.json"),
      board.conflicts || {},
    );

    const expected = new Set<string>();
    for (const task of Object.values(board.tasks)) {
      expected.add(`${task.id}.json`);
      await this.writeJson(path.join(tasksPath, `${task.id}.json`), task);
    }

    const entries = await fs.readdir(tasksPath, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() && entry.name.endsWith(".json") && !expected.has(entry.name),
        )
        .map((entry) => fs.unlink(path.join(tasksPath, entry.name))),
    );

    const expectedActivity = new Set<string>();
    for (const item of Object.values(board.activity || {})
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500)) {
      expectedActivity.add(`${item.id}.json`);
      await this.writeJson(path.join(activityPath, `${item.id}.json`), item);
    }

    const activityEntries = await fs.readdir(activityPath, { withFileTypes: true });
    await Promise.all(
      activityEntries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            !expectedActivity.has(entry.name),
        )
        .map((entry) => fs.unlink(path.join(activityPath, entry.name))),
    );
  }

  private static mergeBoards(localBoard: LynvoBoard, remoteBoard: LynvoBoard): LynvoBoard {
    const mergedTombstones = {
      ...(remoteBoard.tombstones || {}),
      ...(localBoard.tombstones || {}),
    };
    const mergedConflicts: Record<string, LynvoConflict> = {
      ...(remoteBoard.conflicts || {}),
      ...(localBoard.conflicts || {}),
    };
    const mergedTasks: Record<string, LynvoTask> = {};

    const isDeleted = (taskId: string, updatedAt: number) => {
      const tombstone = mergedTombstones[`task-${taskId}`];
      return Boolean(tombstone && tombstone.deletedAt >= updatedAt);
    };

    for (const [taskId, remoteTask] of Object.entries(remoteBoard.tasks)) {
      if (!isDeleted(taskId, remoteTask.updatedAt)) {
        mergedTasks[taskId] = remoteTask;
      }
    }

    for (const [taskId, localTask] of Object.entries(localBoard.tasks)) {
      if (isDeleted(taskId, localTask.updatedAt)) {
        delete mergedTasks[taskId];
        continue;
      }

      const remoteTask = mergedTasks[taskId];
      if (!remoteTask || localTask.updatedAt >= remoteTask.updatedAt) {
        if (remoteTask && localTask.updatedAt !== remoteTask.updatedAt) {
          (["title", "description", "status", "priority", "dueDate"] as const).forEach(
            (field) => {
              const localValue = localTask[field] ?? null;
              const remoteValue = remoteTask[field] ?? null;
              if (localValue !== remoteValue) {
                const conflictId = `task-${taskId}-${field}`;
                mergedConflicts[conflictId] = {
                  id: conflictId,
                  entityType: "task",
                  entityId: taskId,
                  field,
                  localValue,
                  remoteValue,
                  createdAt: Date.now(),
                  resolved: false,
                };
              }
            },
          );
        }
        mergedTasks[taskId] = localTask;
      }
    }

    const mergedColumns = {
      ...remoteBoard.columns,
      ...localBoard.columns,
    };
    const mergedLabels = {
      ...(remoteBoard.labels || {}),
      ...(localBoard.labels || {}),
    };

    Object.values(mergedTombstones).forEach((tombstone) => {
      if (tombstone.entityType === "column") {delete mergedColumns[tombstone.entityId];}
      if (tombstone.entityType === "label") {delete mergedLabels[tombstone.entityId];}
    });

    return {
      version: "2.0.0",
      columns: mergedColumns,
      tasks: mergedTasks,
      labels: mergedLabels,
      users: {
        ...(remoteBoard.users || {}),
        ...(localBoard.users || {}),
      },
      activity: {
        ...(remoteBoard.activity || {}),
        ...(localBoard.activity || {}),
      },
      tombstones: mergedTombstones,
      conflicts: mergedConflicts,
      sync: {
        ...DEFAULT_SYNC,
        ...(localBoard.sync || {}),
        status:
          Object.values(mergedConflicts).some((conflict) => !conflict.resolved)
            ? "conflict"
            : "syncing",
        pendingChanges: true,
        message: "Sync merge completed",
        updatedAt: Date.now(),
      },
    };
  }

  private static async ensureShadowBranch(repoRoot: string): Promise<void> {
    try {
      await this.execGit(["show-ref", "--verify", `refs/heads/${this.SHADOW_BRANCH}`], {
        cwd: repoRoot,
      });
      return;
    } catch {
      // Continue and try to create it from remote or an empty technical commit.
    }

    try {
      await this.execGit(
        ["show-ref", "--verify", `refs/remotes/origin/${this.SHADOW_BRANCH}`],
        { cwd: repoRoot },
      );
      await this.execGit(["branch", this.SHADOW_BRANCH, `origin/${this.SHADOW_BRANCH}`], {
        cwd: repoRoot,
      });
      return;
    } catch {
      // Remote branch does not exist yet.
    }

    const commitSha = await this.execGit(
      ["commit-tree", this.EMPTY_TREE_SHA, "-m", "Initialize Lynvo sync branch"],
      {
        cwd: repoRoot,
        env: {
          GIT_AUTHOR_NAME: "Lynvo",
          GIT_AUTHOR_EMAIL: "lynvo-sync@users.noreply.github.com",
          GIT_COMMITTER_NAME: "Lynvo",
          GIT_COMMITTER_EMAIL: "lynvo-sync@users.noreply.github.com",
        },
      },
    );
    await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, commitSha], {
      cwd: repoRoot,
    });
  }

  private static async pushShadowBranch(
    repoRoot: string,
    worktreePath: string,
  ): Promise<void> {
    try {
      await this.execGit(["push", "-u", "origin", `HEAD:${this.SHADOW_BRANCH}`], {
        cwd: worktreePath,
      });
      return;
    } catch (firstError) {
      try {
        await this.execGit(
          [
            "push",
            "-u",
            "origin",
            `refs/heads/${this.SHADOW_BRANCH}:refs/heads/${this.SHADOW_BRANCH}`,
          ],
          { cwd: repoRoot },
        );
        return;
      } catch (secondError) {
        const firstMessage =
          firstError instanceof Error ? firstError.message : String(firstError);
        const secondMessage =
          secondError instanceof Error ? secondError.message : String(secondError);
        throw new Error(`${firstMessage}. Retry failed: ${secondMessage}`);
      }
    }
  }

  private static async syncBoardNow(): Promise<LynvoSyncResult> {
    const workspacePath = this.getWorkspacePath();
      if (!workspacePath) {
      return {
        success: false,
        message: "Workspace not found.",
        hasConflicts: false,
      };
    }

    let tempWorktree: string | undefined;
    let stage: SyncStage = "repo";

    try {
      const repoRoot = await this.execGit(["rev-parse", "--show-toplevel"], {
        cwd: workspacePath,
      });
      stage = "exclude";
      const localLynvoPath = path.join(workspacePath, ".vscode", "lynvo");
      const relativeLynvoPath = path
        .relative(repoRoot, localLynvoPath)
        .split(path.sep)
        .join("/");
      await this.ensureExcludedFromActiveWorktree(repoRoot, relativeLynvoPath);

      stage = "load";
      await DataManager.updateSyncMetadata({
        status: "syncing",
        message: "Synchronizing Lynvo board",
      });
      const localBoard = await DataManager.loadBoard();
      if (!localBoard) {
        return {
          success: false,
          message: "No local board to sync.",
          remoteChanged: false,
          hasConflicts: false,
        };
      }
      const previousRemoteCommit = localBoard.sync?.lastRemoteCommit || null;
      let fetchedRemoteCommit: string | null = null;

      stage = "fetch";
      try {
        await this.execGit(["fetch", "origin", this.SHADOW_BRANCH], {
          cwd: repoRoot,
        });
      } catch {
        // First sync or offline remote branch absence. We can still update locally.
      }

      stage = "branch";
      await this.ensureShadowBranch(repoRoot);
      try {
        const remoteSha = await this.execGit(
          ["rev-parse", `refs/remotes/origin/${this.SHADOW_BRANCH}`],
          { cwd: repoRoot },
        );
        fetchedRemoteCommit = remoteSha;
        await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, remoteSha], {
          cwd: repoRoot,
        });
      } catch {
        // Offline or first sync. Keep the local technical branch as the base.
      }

      stage = "worktree";
      tempWorktree = await fs.mkdtemp(path.join(os.tmpdir(), "lynvo-sync-"));
      await this.execGit(
        ["worktree", "add", "--force", "--detach", tempWorktree, this.SHADOW_BRANCH],
        {
          cwd: repoRoot,
        },
      );

      stage = "merge";
      const shadowLynvoPath = path.join(tempWorktree, relativeLynvoPath);
      const remoteBoard = await this.readBoardFromFolder(shadowLynvoPath);
      const mergedBoard = remoteBoard
        ? this.mergeBoards(localBoard, remoteBoard)
        : localBoard;

      await DataManager.saveBoard(mergedBoard);
      await this.writeBoardToFolder(shadowLynvoPath, mergedBoard);

      stage = "commit";
      await this.execGit(["add", "-f", relativeLynvoPath], { cwd: tempWorktree });
      const status = await this.execGit(["status", "--porcelain", relativeLynvoPath], {
        cwd: tempWorktree,
      });

      if (status) {
        await this.execGit(
          [
            "-c",
            "user.name=Lynvo",
            "-c",
            "user.email=lynvo-sync@users.noreply.github.com",
            "commit",
            "-m",
            "(Lynvo): sync board state [skip ci]",
          ],
          { cwd: tempWorktree },
        );
      }

      const shadowHead = await this.execGit(["rev-parse", "HEAD"], {
        cwd: tempWorktree,
      });
      await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, shadowHead], {
        cwd: repoRoot,
      });

      stage = "push";
      try {
        await this.pushShadowBranch(repoRoot, tempWorktree);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await DataManager.updateSyncMetadata({
          status: "offline",
          message: detail,
        }).catch(() => {});
        return {
          success: false,
          message:
            `Lynvo guardó los cambios localmente, pero no pudo subir lynvo-sync. ${detail}`,
          remoteChanged: false,
          hasConflicts: false,
        };
      }

      const hasConflicts = Object.values(mergedBoard.conflicts || {}).some(
        (conflict) => !conflict.resolved,
      );
      await DataManager.updateSyncMetadata({
        status: hasConflicts ? "conflict" : "synced",
        pendingChanges: false,
        lastSyncAt: Date.now(),
        lastRemoteCommit: shadowHead,
        message: "Synced",
      });

      return {
        success: true,
        message: "Lynvo synced the board on the technical branch lynvo-sync.",
        remoteChanged: Boolean(
          previousRemoteCommit &&
            fetchedRemoteCommit &&
            fetchedRemoteCommit !== previousRemoteCommit,
        ),
        hasConflicts,
      };
    } catch (error) {
      console.error("Lynvo Git Error:", error);
      const detail = error instanceof Error ? error.message : String(error);
      await DataManager.updateSyncMetadata({
        status: stage === "fetch" || stage === "push" ? "offline" : "failed",
        message: detail,
      }).catch(() => {});
      return {
        success: false,
        message: `Lynvo no pudo sincronizar (${stage}). ${detail}`,
        remoteChanged: false,
        hasConflicts: false,
      };
    } finally {
      if (tempWorktree) {
        const workspacePathForCleanup = this.getWorkspacePath();
        if (workspacePathForCleanup) {
          try {
            const repoRoot = await this.execGit(["rev-parse", "--show-toplevel"], {
              cwd: workspacePathForCleanup,
            });
            await this.execGit(["worktree", "remove", "--force", tempWorktree], {
              cwd: repoRoot,
            });
          } catch {
            await fs.rm(tempWorktree, { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    }
  }

  public static async syncBoard(): Promise<LynvoSyncResult> {
    this.syncQueue = this.syncQueue.then(() => this.syncBoardNow());
    return this.syncQueue;
  }

  public static scheduleBoardSync(
    delayMs = 15000,
    onComplete?: (result: LynvoSyncResult) => void,
  ): void {
    if (this.scheduledSync) {
      clearTimeout(this.scheduledSync);
    }

    this.scheduledSync = setTimeout(() => {
      this.scheduledSync = undefined;
      this.syncBoard().then((result) => {
        onComplete?.(result);
        if (!result.success) {
          console.warn(`Lynvo background sync skipped: ${result.message}`);
        }
      });
    }, delayMs);
  }

  public static cancelScheduledSync(): void {
    if (this.scheduledSync) {
      clearTimeout(this.scheduledSync);
      this.scheduledSync = undefined;
    }
  }
}
