import * as cp from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DataManager } from "./DataManager";
import { normalizeBoard, isSafeEntityId, hasOwn } from "../boardValidation";
import { mergeBoards } from "./boardMerge";
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
  timeoutMs?: number;
  ignoreCancellation?: boolean;
  trimOutput?: boolean;
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
  private static syncQueue: Promise<LynvoSyncResult> = Promise.resolve({
    success: true,
    message: "Sincronización pendiente.",
  });
  private static scheduledSync = new Map<string, NodeJS.Timeout>();
  private static activeSyncController: AbortController | undefined;
  private static cancellationGeneration = 0;

  private static getWorkspacePath(): string | null {
    return DataManager.getWorkspaceUri()?.fsPath || null;
  }

  private static execGit(args: string[], options: ExecOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const signal = options.ignoreCancellation ? undefined : this.activeSyncController?.signal;
      if (signal?.aborted) {reject(new Error("Lynvo sync cancelled.")); return;}
      const child = cp.spawn("git", args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });

      let stdout = "";
      let stderr = "";
      let stopReason: string | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const stop = (reason: string) => {
        if (stopReason) {return;}
        stopReason = reason;
        const kill = (signal: NodeJS.Signals) => {
          try {
            if (process.platform !== "win32" && child.pid) {process.kill(-child.pid, signal);}
            else if (child.pid) {
              const killer = cp.spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
              killer.on("error", () => child.kill(signal));
              killer.unref();
            }
            else {child.kill(signal);}
          } catch { /* The process may have already exited. */ }
        };
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1000);
        killTimer.unref();
      };
      const abort = () => stop("Lynvo sync cancelled.");
      const timeout = setTimeout(() => stop(`git ${args[0]} timed out after ${options.timeoutMs ?? 60000} ms.`), options.timeoutMs ?? 60000);
      timeout.unref();
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        // Keep escalation after cancellation: a hook may detach its stdio and
        // ignore SIGTERM even after Git's own process has closed.
        if (killTimer && !stopReason) {clearTimeout(killTimer);}
        signal?.removeEventListener("abort", abort);
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {cleanup(); reject(error);});
      child.on("close", (code) => {
        cleanup();
        if (stopReason) {reject(new Error(stopReason));}
        else if (code === 0) {
          resolve(options.trimOutput === false ? stdout : stdout.trim());
        } else {
          const details = stderr.trim() || stdout.trim() || `git ${args[0]} failed`;
          reject(new Error(`git ${args.join(" ")}: ${details}`));
        }
      });
      child.stdin.on("error", (error) => {
        // A killed or failed command may close stdin before its buffered input.
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") {reject(error);}
      });

      if (options.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }

  private static async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.lstat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {return false;}
      throw error;
    }
  }

  private static async readJson<T>(filePath: string): Promise<T> {
    if (!(await fs.lstat(filePath)).isFile()) {throw new Error(`Lynvo expected a regular JSON file: ${filePath}`);}
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

    return this.readJson<T>(filePath);
  }

  private static async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (await this.pathExists(filePath)) {
      if (!(await fs.lstat(filePath)).isFile()) {throw new Error(`Refusing to overwrite a non-regular Lynvo file: ${filePath}`);}
    }
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private static validateBoardMetadata(metadata: BoardMetadata, columns: Record<string, LynvoColumn>): void {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.version !== "2.0.0") {
      throw new Error("Invalid or unsupported remote Lynvo board metadata; no data has been overwritten.");
    }
    if (!columns || typeof columns !== "object" || Array.isArray(columns) || !Object.keys(columns).length) {
      throw new Error("Remote Lynvo columns are missing or invalid; no data has been overwritten.");
    }
    if (metadata.labels !== undefined && (!metadata.labels || typeof metadata.labels !== "object" || Array.isArray(metadata.labels))) {
      throw new Error("Remote Lynvo labels are invalid; no data has been overwritten.");
    }
  }

  private static validateVersionMetadata(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== "2.0.0") {
      throw new Error("Invalid or unsupported remote schema metadata; no data has been overwritten.");
    }
  }

  private static async validateBoardDirectory(root: string, worktreeRoot: string): Promise<void> {
    const relative = path.relative(worktreeRoot, root);
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {throw new Error("Remote board path is outside its temporary worktree.");}
    let current = worktreeRoot;
    for (const segment of ["", ...relative.split(path.sep)]) {
      current = path.join(current, segment);
      if (!(await this.pathExists(current))) {continue;}
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {throw new Error(`Refusing a non-regular board directory: ${current}`);}
    }
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

  private static async readBoardFromFolder(root: string, worktreeRoot = path.dirname(root)): Promise<LynvoBoard | null> {
    const boardPath = path.join(root, "board.json");
    const columnsPath = path.join(root, "columns.json");
    const usersPath = path.join(root, "users.json");
    const tasksPath = path.join(root, "tasks");
    const activityPath = path.join(root, "activity");
    const metadataPath = path.join(root, "metadata");

    await this.validateBoardDirectory(root, worktreeRoot);
    if (!(await this.pathExists(root))) {return null;}
    for (const folder of [root, path.dirname(root), tasksPath, activityPath, metadataPath]) {
      if (await this.pathExists(folder)) {
        const stat = await fs.lstat(folder);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {throw new Error(`Lynvo expected a regular board directory: ${folder}`);}
      }
    }
    if (!(await this.pathExists(boardPath)) || !(await this.pathExists(columnsPath))) {
      throw new Error("Remote Lynvo board is incomplete; refusing to overwrite it.");
    }

    const metadata = await this.readJson<BoardMetadata>(boardPath);
    const columns = await this.readJson<Record<string, LynvoColumn>>(columnsPath);
    this.validateBoardMetadata(metadata, columns);
    if (await this.pathExists(path.join(metadataPath, "version.json"))) {
      this.validateVersionMetadata(await this.readJson<unknown>(path.join(metadataPath, "version.json")));
    }
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
        if (entry.isSymbolicLink() && entry.name.endsWith(".json")) {throw new Error(`Refusing a symbolic link in remote tasks: ${entry.name}`);}
        if (!entry.name.endsWith(".json")) {continue;}
        if (!entry.isFile()) {throw new Error(`Invalid remote task JSON entry: ${entry.name}`);}
        const task = await this.readJson<LynvoTask>(path.join(tasksPath, entry.name));
        if (!isSafeEntityId(task.id) || entry.name.normalize("NFC") !== `${task.id}.json`.normalize("NFC")) {throw new Error(`Invalid remote task ID or filename: ${entry.name}`);}
        if (hasOwn(tasks, task.id)) {throw new Error(`Duplicate remote task ID: ${task.id}`);}
        tasks[task.id] = task;
      }
    }

    if (await this.pathExists(activityPath)) {
      const entries = await fs.readdir(activityPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink() && entry.name.endsWith(".json")) {throw new Error(`Refusing a symbolic link in remote activity: ${entry.name}`);}
        if (!entry.name.endsWith(".json")) {continue;}
        if (!entry.isFile()) {throw new Error(`Invalid remote activity JSON entry: ${entry.name}`);}
        const item = await this.readJson<LynvoActivity>(path.join(activityPath, entry.name));
        if (!isSafeEntityId(item.id) || entry.name.normalize("NFC") !== `${item.id}.json`.normalize("NFC")) {throw new Error(`Invalid remote activity ID or filename: ${entry.name}`);}
        if (hasOwn(activity, item.id)) {throw new Error(`Duplicate remote activity ID: ${item.id}`);}
        activity[item.id] = item;
      }
    }

    return normalizeBoard({
      version: metadata.version || "2.0.0",
      columns,
      tasks,
      labels: metadata.labels || {},
      users,
      activity,
      sync,
      tombstones,
      conflicts,
    });
  }

  private static async writeBoardToFolder(
    root: string,
    board: LynvoBoard,
    worktreeRoot = path.dirname(root),
  ): Promise<void> {
    board = normalizeBoard(board);
    await this.validateBoardDirectory(root, worktreeRoot);
    const tasksPath = path.join(root, "tasks");
    const activityPath = path.join(root, "activity");
    for (const folder of [tasksPath, activityPath, path.join(root, "metadata"), path.join(root, "comments")]) {
      await this.validateBoardDirectory(folder, worktreeRoot);
    }
    await fs.mkdir(tasksPath, { recursive: true });
    await fs.mkdir(path.join(root, "comments"), { recursive: true });
    await fs.mkdir(path.join(root, "activity"), { recursive: true });
    await fs.mkdir(path.join(root, "metadata"), { recursive: true });
    const fileLocations = async (folder: string) => {
      const locations = new Map<string, string>();
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (!entry.name.endsWith(".json")) {continue;}
        const name = entry.name.normalize("NFC");
        if (!entry.isFile() || locations.has(name)) {throw new Error(`Invalid or duplicate remote JSON filename: ${entry.name}`);}
        locations.set(name, path.join(folder, entry.name));
      }
      return locations;
    };
    const taskLocations = await fileLocations(tasksPath);
    const activityLocations = await fileLocations(activityPath);

    await this.writeJson(path.join(root, "board.json"), {
      version: "2.0.0",
      labels: board.labels || {},
    });
    await this.writeJson(path.join(root, "columns.json"), board.columns);
    await this.writeJson(path.join(root, "users.json"), board.users || {});
    if (!(await this.pathExists(path.join(root, "settings.json")))) {await this.writeJson(path.join(root, "settings.json"), {});}
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
      const name = `${task.id}.json`.normalize("NFC");
      expected.add(name);
      await this.writeJson(taskLocations.get(name) || path.join(tasksPath, `${task.id}.json`), task);
    }

    const entries = await fs.readdir(tasksPath, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() && entry.name.endsWith(".json") && !expected.has(entry.name.normalize("NFC")),
        )
        .map((entry) => fs.unlink(path.join(tasksPath, entry.name))),
    );

    const expectedActivity = new Set<string>();
    for (const item of Object.values(board.activity || {})
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500)) {
      const name = `${item.id}.json`.normalize("NFC");
      expectedActivity.add(name);
      await this.writeJson(activityLocations.get(name) || path.join(activityPath, `${item.id}.json`), item);
    }

    const activityEntries = await fs.readdir(activityPath, { withFileTypes: true });
    await Promise.all(
      activityEntries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            !expectedActivity.has(entry.name.normalize("NFC")),
        )
        .map((entry) => fs.unlink(path.join(activityPath, entry.name))),
    );
  }

  private static mergeBoards(localBoard: LynvoBoard, remoteBoard: LynvoBoard, baseBoard?: LynvoBoard | null): LynvoBoard {
    return mergeBoards(localBoard, remoteBoard, baseBoard);
  }

  private static async readBoardFromCommit(repoRoot: string, commit: string, relativeLynvoPath: string): Promise<LynvoBoard | null> {
    if (!/^[0-9a-f]{40,64}$/.test(commit)) {throw new Error("Invalid Lynvo baseline commit.");}
    const prefix = `${relativeLynvoPath}/`;
    const entries = (await this.execGit(["ls-tree", "-rz", commit, "--", relativeLynvoPath], { cwd: repoRoot, trimOutput: false }))
      .split("\0").filter(Boolean).map((entry) => {
        const match = /^([0-7]+) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
        if (!match || !match[4].startsWith(prefix)) {throw new Error("Invalid board tree entry.");}
        return { mode: match[1], kind: match[2], oid: match[3], name: match[4].slice(prefix.length) };
      }).filter((entry) => /^(board|columns|users)\.json$/.test(entry.name)
        || /^metadata\/(sync|tombstones|conflicts|version)\.json$/.test(entry.name)
        || /^(tasks|activity)\/[^/]+\.json$/.test(entry.name));
    if (!entries.length) {return null;}
    if (!entries.some((entry) => entry.name === "board.json") || !entries.some((entry) => entry.name === "columns.json")) {
      throw new Error("The synchronized baseline has an incomplete board.");
    }
    if (entries.some((entry) => entry.kind !== "blob" || !/^100(644|755)$/.test(entry.mode))) {
      throw new Error("The synchronized baseline contains non-regular board files.");
    }
    // One local Git process reads every JSON blob, even for very large boards.
    const output = Buffer.from(await this.execGit(["cat-file", "--batch"], {
      cwd: repoRoot, input: `${entries.map((entry) => entry.oid).join("\n")}\n`, trimOutput: false,
    }), "utf8");
    const json = new Map<string, unknown>();
    let offset = 0;
    for (const entry of entries) {
      const newline = output.indexOf(10, offset);
      const header = output.subarray(offset, newline).toString("utf8");
      const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
      if (newline < 0 || !match || match[1] !== entry.oid) {throw new Error("Invalid Git object response for board baseline.");}
      const size = Number(match[2]);
      const start = newline + 1;
      if (start + size >= output.length) {throw new Error("Truncated board baseline object.");}
      json.set(entry.name, JSON.parse(output.subarray(start, start + size).toString("utf8")));
      offset = start + size + 1;
    }
    const metadata = json.get("board.json") as BoardMetadata;
    this.validateBoardMetadata(metadata, json.get("columns.json") as Record<string, LynvoColumn>);
    if (json.has("metadata/version.json")) {this.validateVersionMetadata(json.get("metadata/version.json"));}
    const tasks: Record<string, LynvoTask> = {};
    const activity: Record<string, LynvoActivity> = {};
    for (const [filename, item] of json) {
      if (filename.startsWith("tasks/")) {
        const task = item as LynvoTask;
        if (!isSafeEntityId(task?.id) || filename.normalize("NFC") !== `tasks/${task.id}.json`.normalize("NFC")) {throw new Error(`Invalid baseline task ID: ${filename}`);}
        if (hasOwn(tasks, task.id)) {throw new Error(`Duplicate baseline task ID: ${task.id}`);}
        tasks[task.id] = task;
      } else if (filename.startsWith("activity/")) {
        const event = item as LynvoActivity;
        if (!isSafeEntityId(event?.id) || filename.normalize("NFC") !== `activity/${event.id}.json`.normalize("NFC")) {throw new Error(`Invalid baseline activity ID: ${filename}`);}
        if (hasOwn(activity, event.id)) {throw new Error(`Duplicate baseline activity ID: ${event.id}`);}
        activity[event.id] = event;
      }
    }
    return normalizeBoard({
      version: metadata?.version, labels: metadata?.labels, columns: json.get("columns.json"), tasks, activity,
      users: json.get("users.json"), sync: json.get("metadata/sync.json"),
      tombstones: json.get("metadata/tombstones.json"), conflicts: json.get("metadata/conflicts.json"),
    });
  }

  private static async ensureShadowBranch(repoRoot: string): Promise<void> {
    try {
      await this.execGit(["show-ref", "--verify", `refs/heads/${this.SHADOW_BRANCH}`], {
        cwd: repoRoot,
      });
      return;
    } catch (error) {
      if (/cancelled|timed out/i.test(error instanceof Error ? error.message : String(error))) {throw error;}
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
    } catch (error) {
      if (/cancelled|timed out/i.test(error instanceof Error ? error.message : String(error))) {throw error;}
      // Remote branch does not exist yet.
    }

    const emptyTree = await this.execGit(["mktree"], { cwd: repoRoot });
    const commitSha = await this.execGit(
      ["commit-tree", emptyTree, "-m", "Initialize Lynvo sync branch"],
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

  private static async fetchShadowBranch(repoRoot: string): Promise<string | null> {
    try {
      await this.execGit(["fetch", "origin", `+refs/heads/${this.SHADOW_BRANCH}:refs/remotes/origin/${this.SHADOW_BRANCH}`], { cwd: repoRoot });
      return this.execGit(["rev-parse", `refs/remotes/origin/${this.SHADOW_BRANCH}`], { cwd: repoRoot });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/couldn't find remote ref|could not find remote ref|remote ref does not exist/i.test(detail)) {return null;}
      throw error;
    }
  }

  private static async loadMergeBase(repoRoot: string, previousCommit: string | null, remoteCommit: string | null, relativeLynvoPath: string): Promise<LynvoBoard | null> {
    if (!previousCommit || !/^[0-9a-f]{40,64}$/.test(previousCommit)) {return null;}
    let commonCommit: string;
    try {
      // A rewritten remote history may have a different common ancestor. Never
      // pretend that a non-ancestor snapshot is the board's common base.
      commonCommit = remoteCommit
        ? await this.execGit(["merge-base", previousCommit, remoteCommit], { cwd: repoRoot })
        : await this.execGit(["rev-parse", `${previousCommit}^{commit}`], { cwd: repoRoot });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/cancelled|timed out/i.test(detail)) {throw error;}
      return null;
    }
    return this.readBoardFromCommit(repoRoot, commonCommit, relativeLynvoPath);
  }

  private static async commitBoard(repoRoot: string, worktreePath: string, relativeLynvoPath: string, board: LynvoBoard): Promise<string> {
    await this.writeBoardToFolder(path.join(worktreePath, relativeLynvoPath), board, worktreePath);
    await this.execGit(["add", "-f", relativeLynvoPath], { cwd: worktreePath });
    if (await this.execGit(["status", "--porcelain", relativeLynvoPath], { cwd: worktreePath })) {
      await this.execGit([
        "-c", "user.name=Lynvo", "-c", "user.email=lynvo-sync@users.noreply.github.com",
        "commit", "-m", "(Lynvo): sync board state [skip ci]",
      ], { cwd: worktreePath });
    }
    const head = await this.execGit(["rev-parse", "HEAD"], { cwd: worktreePath });
    await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, head], { cwd: repoRoot });
    return head;
  }

  private static async syncBoardNow(): Promise<LynvoSyncResult> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {return { success: false, message: "Workspace not found.", hasConflicts: false };}
    const controller = new AbortController();
    this.activeSyncController = controller;
    let tempWorktree: string | undefined;
    let repoRoot: string | undefined;
    let stage: SyncStage = "repo";
    try {
      repoRoot = await fs.realpath(await this.execGit(["rev-parse", "--show-toplevel"], { cwd: workspacePath }));
      stage = "exclude";
      const localLynvoPath = path.join(await fs.realpath(workspacePath), ".vscode", "lynvo");
      const relativeLynvoPath = path.relative(repoRoot, localLynvoPath).split(path.sep).join("/");
      if (relativeLynvoPath.startsWith("../") || path.isAbsolute(relativeLynvoPath)) {throw new Error("The board is outside the Git repository.");}
      await this.ensureExcludedFromActiveWorktree(repoRoot, relativeLynvoPath);
      stage = "load";
      await DataManager.updateSyncMetadata({ status: "syncing", message: "Synchronizing Lynvo board" });
      const initialBoard = await DataManager.loadBoard();
      if (!initialBoard) {return { success: false, message: "No local board to sync.", remoteChanged: false, hasConflicts: false };}
      const previousRemoteCommit = initialBoard.sync?.lastRemoteCommit || null;
      stage = "fetch";
      let fetchedRemoteCommit = await this.fetchShadowBranch(repoRoot);
      stage = "merge";
      if (fetchedRemoteCommit) {await this.readBoardFromCommit(repoRoot, fetchedRemoteCommit, relativeLynvoPath);}
      stage = "branch";
      await this.ensureShadowBranch(repoRoot);
      stage = "worktree";
      tempWorktree = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lynvo-sync-")));
      await this.execGit(["worktree", "add", "--force", "--detach", tempWorktree, fetchedRemoteCommit || this.SHADOW_BRANCH], { cwd: repoRoot });
      stage = "merge";
      let remoteBoard = fetchedRemoteCommit ? await this.readBoardFromFolder(path.join(tempWorktree, relativeLynvoPath), tempWorktree) : null;
      const baseBoard = await this.loadMergeBase(repoRoot, previousRemoteCommit, fetchedRemoteCommit, relativeLynvoPath)
        || (DataManager.isDefaultUntouchedBoard(initialBoard) ? DataManager.getDefaultBoard() : null);
      let candidate = await DataManager.reconcileBoard(initialBoard, (latest) => {
        if (!remoteBoard) {return latest;}
        if (DataManager.isDefaultUntouchedBoard(latest)) {
          // A newly opened project should adopt the team board, rather than
          // treating automatically generated defaults as intentional edits.
          return { ...remoteBoard, users: { ...remoteBoard.users, ...latest.users }, sync: latest.sync };
        }
        return this.mergeBoards(latest, remoteBoard, baseBoard);
      });
      if (!candidate) {throw new Error("The local board disappeared during synchronization.");}
      stage = "commit";
      let shadowHead = await this.commitBoard(repoRoot, tempWorktree, relativeLynvoPath, candidate);
      stage = "push";
      for (let attempt = 0; ; attempt++) {
        try {
          await this.execGit(["push", "-u", "origin", `HEAD:refs/heads/${this.SHADOW_BRANCH}`], { cwd: tempWorktree });
          break;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (attempt >= 2 || !/non-fast-forward|fetch first|failed to update ref|cannot lock ref|already exists/i.test(detail)) {throw error;}
          // Someone pushed after our fetch. Fetch and merge the new content;
          // retrying the same rejected commit would never recover this race.
          stage = "fetch";
          const nextRemoteCommit = await this.fetchShadowBranch(repoRoot);
          if (!nextRemoteCommit) {throw new Error("The remote sync branch disappeared during retry.");}
          stage = "merge";
          await this.readBoardFromCommit(repoRoot, nextRemoteCommit, relativeLynvoPath);
          await this.execGit(["reset", "--hard", nextRemoteCommit], { cwd: tempWorktree });
          stage = "merge";
          const nextRemote = await this.readBoardFromFolder(path.join(tempWorktree, relativeLynvoPath), tempWorktree);
          if (!nextRemote) {throw new Error("The updated remote sync branch has no board.");}
          const retryBase = remoteBoard;
          const previousCandidate = candidate;
          candidate = await DataManager.reconcileBoard(previousCandidate, (latest) => this.mergeBoards(latest, nextRemote, retryBase));
          if (!candidate) {throw new Error("The local board disappeared during retry.");}
          remoteBoard = nextRemote;
          fetchedRemoteCommit = nextRemoteCommit;
          stage = "commit";
          shadowHead = await this.commitBoard(repoRoot, tempWorktree, relativeLynvoPath, candidate);
          stage = "push";
        }
      }
      const finished = await DataManager.finishSync(candidate, {
        pendingChanges: false, lastSyncAt: Date.now(), lastRemoteCommit: shadowHead, message: "Synced",
      });
      const hasConflicts = Object.values(finished?.conflicts || {}).some((conflict) => !conflict.resolved);
      return {
        success: true,
        message: finished?.sync?.pendingChanges
          ? "Lynvo synced the board; newer local edits remain pending."
          : "Lynvo synced the board on the technical branch lynvo-sync.",
        remoteChanged: Boolean(fetchedRemoteCommit && fetchedRemoteCommit !== previousRemoteCommit), hasConflicts,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Lynvo Git Error:", error);
      await DataManager.updateSyncMetadata({
        status: stage === "fetch" || stage === "push" ? "offline" : "failed", pendingChanges: true, message: detail,
      }).catch(() => {});
      return { success: false, message: `Lynvo no pudo sincronizar (${stage}). ${detail}`, remoteChanged: false, hasConflicts: false };
    } finally {
      if (tempWorktree) {
        try {
          if (repoRoot) {await this.execGit(["worktree", "remove", "--force", tempWorktree], { cwd: repoRoot, ignoreCancellation: true });}
          else {await fs.rm(tempWorktree, { recursive: true, force: true });}
        } catch {
          await fs.rm(tempWorktree, { recursive: true, force: true }).catch(() => {});
          if (repoRoot) {await this.execGit(["worktree", "prune"], { cwd: repoRoot, ignoreCancellation: true }).catch(() => {});}
        }
      }
      if (this.activeSyncController === controller) {this.activeSyncController = undefined;}
    }
  }

  public static async syncBoard(): Promise<LynvoSyncResult> {
    const workspaceUri = DataManager.getWorkspaceUri();
    const generation = this.cancellationGeneration;
    this.syncQueue = this.syncQueue.then(() => generation !== this.cancellationGeneration
      ? { success: false, message: "Lynvo sync cancelled.", hasConflicts: false }
      : workspaceUri
      ? DataManager.withWorkspace(workspaceUri, () => this.syncBoardNow())
      : { success: false, message: "Workspace not found.", hasConflicts: false });
    return this.syncQueue;
  }

  public static scheduleBoardSync(
    delayMs = 15000,
    onComplete?: (result: LynvoSyncResult) => void,
  ): void {
    const workspaceUri = DataManager.getWorkspaceUri();
    if (!workspaceUri) {return;}
    const key = `${workspaceUri.scheme}:${workspaceUri.authority || ""}:${workspaceUri.path}`;
    const previous = this.scheduledSync.get(key);
    if (previous) {clearTimeout(previous);}
    const generation = this.cancellationGeneration;
    this.scheduledSync.set(key, setTimeout(() => {
      this.scheduledSync.delete(key);
      DataManager.withWorkspace(workspaceUri, async () => {
        const result = await this.syncBoard();
        if (generation !== this.cancellationGeneration) {return;}
        onComplete?.(result);
        if (!result.success) {console.warn(`Lynvo background sync skipped: ${result.message}`);}
      }).catch((error) => console.warn("Lynvo background sync failed:", error));
    }, delayMs));
  }

  public static cancelScheduledSync(): void {
    this.cancellationGeneration++;
    this.activeSyncController?.abort();
    for (const timer of this.scheduledSync.values()) {clearTimeout(timer);}
    this.scheduledSync.clear();
  }
}
