import * as vscode from "vscode";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { withBoardLock } from "./BoardLock";
import { cloneBoardValue, conflictSnapshotMatches, getBoardContentFingerprint, hasOwn, isSafeEntityId, normalizeBoard, normalizeChecklist, normalizeRelations, stableStringify } from "../boardValidation";
import {
  CodeReference,
  LynvoActivity,
  LynvoActivityType,
  LynvoBoard,
  LynvoChecklistItem,
  LynvoColumn,
  LynvoConflict,
  LynvoLabel,
  LynvoPresenceUser,
  LynvoSyncMetadata,
  LynvoTask,
  LynvoTaskRelation,
  LynvoTaskRelationType,
  LynvoTombstone,
} from "../types";
import { AuthProvider } from "./AuthProvider";

type BoardMetadata = {
  version: string;
  labels?: Record<string, LynvoLabel>;
};

const UNKNOWN_USER = { githubId: "unknown", username: "Unknown" };

export class DataManager {
  private static readonly LEGACY_FILENAME = "lynvo.json";
  private static readonly FOLDER = ".vscode";
  private static readonly MODULAR_FOLDER = "lynvo";
  private static readonly SCHEMA_VERSION = "2.0.0";
  private static writeQueue: Promise<void> = Promise.resolve();
  private static selectedWorkspaceUri: vscode.Uri | undefined;
  private static workspaceContext = new AsyncLocalStorage<vscode.Uri>();
  private static readBaseline = new Map<string, string>();
  private static readLocations = new Map<string, vscode.Uri>();

  public static getWorkspaceUri(): vscode.Uri | undefined {
    const scoped = this.workspaceContext.getStore();
    if (scoped) {return scoped;}
    return this.getActiveWorkspaceUri();
  }

  public static getActiveWorkspaceUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {return undefined;}
    if (this.selectedWorkspaceUri && workspaceFolders.some((folder) => folder.uri.path === this.selectedWorkspaceUri?.path)) {
      return this.selectedWorkspaceUri;
    }
    return workspaceFolders[0].uri;
  }

  public static setWorkspaceUri(uri: vscode.Uri): void {this.selectedWorkspaceUri = uri;}

  public static withWorkspace<T>(uri: vscode.Uri, operation: () => Promise<T>): Promise<T> {
    return this.workspaceContext.run(uri, operation);
  }

  private static enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const workspace = this.getWorkspaceUri();
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const execute = async () => {
        this.readBaseline = new Map();
        this.readLocations = new Map();
        return operation();
      };
      if (!workspace) {return execute();}
      return this.withWorkspace(workspace, () => withBoardLock(
        `${workspace.scheme || "file"}:${workspace.authority || ""}:${workspace.path}`, execute,
      ));
    });
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private static getFolderUri(): vscode.Uri | undefined {
    const workspace = this.getWorkspaceUri();
    if (!workspace) {return undefined;}
    return vscode.Uri.joinPath(workspace, this.FOLDER);
  }

  private static getLegacyFileUri(): vscode.Uri | undefined {
    const folderUri = this.getFolderUri();
    if (!folderUri) {return undefined;}
    return vscode.Uri.joinPath(folderUri, this.LEGACY_FILENAME);
  }

  private static getModularRootUri(): vscode.Uri | undefined {
    const folderUri = this.getFolderUri();
    if (!folderUri) {return undefined;}
    return vscode.Uri.joinPath(folderUri, this.MODULAR_FOLDER);
  }

  private static joinModularPath(...segments: string[]): vscode.Uri | undefined {
    const root = this.getModularRootUri();
    if (!root) {return undefined;}
    return vscode.Uri.joinPath(root, ...segments);
  }

  public static getDefaultBoard(): LynvoBoard {
    return {
      version: this.SCHEMA_VERSION,
      columns: {
        todo: {
          id: "todo",
          title: "To Do",
          color: "var(--vscode-charts-blue)",
          position: 0,
        },
        "in-progress": {
          id: "in-progress",
          title: "In Progress",
          color: "var(--vscode-charts-yellow)",
          position: 1,
        },
        done: {
          id: "done",
          title: "Done",
          color: "var(--vscode-charts-green)",
          position: 2,
        },
      },
      tasks: {},
      labels: {
        bug: { id: "bug", name: "Bug", color: "#f85149" },
        feat: { id: "feat", name: "Feature", color: "#a371f7" },
      },
      users: {},
      sync: this.getDefaultSyncMetadata(),
      tombstones: {},
      conflicts: {},
    };
  }

  public static isDefaultUntouchedBoard(board: LynvoBoard): boolean {
    const defaults = this.getDefaultBoard();
    return stableStringify(board.columns) === stableStringify(defaults.columns) &&
      stableStringify(board.labels || {}) === stableStringify(defaults.labels || {}) &&
      [board.tasks, board.activity, board.tombstones, board.conflicts].every((value) => !Object.keys(value || {}).length) &&
      !board.sync?.pendingChanges && !board.sync?.lastSyncAt && !board.sync?.lastRemoteCommit;
  }

  private static getDefaultSyncMetadata(): LynvoSyncMetadata {
    return {
      branch: "lynvo-sync",
      status: "idle",
      pendingChanges: false,
      lastSyncAt: null,
      lastRemoteCommit: null,
      updatedAt: Date.now(),
    };
  }

  private static createId(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  private static ensureBoardIntegrity(board: Partial<LynvoBoard>): LynvoBoard {
    return normalizeBoard(board, this.getDefaultBoard());
  }

  private static async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "FileNotFound") {return false;}
      throw error;
    }
  }

  private static async readJson<T>(uri: vscode.Uri): Promise<T> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const raw = Buffer.from(fileData).toString("utf8");
    this.readBaseline.set(uri.path.normalize("NFC"), raw);
    this.readLocations.set(uri.path.normalize("NFC"), uri);
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      await this.backupCorruptJson(uri, fileData).catch((backupError) =>
        console.error(`Lynvo: failed to backup corrupt json ${uri.path}`, backupError),
      );
      throw error;
    }
  }

  private static async writeJsonAtomic(uri: vscode.Uri, value: unknown): Promise<void> {
    // Preserve the existing filename even when its Unicode spelling differs
    // from the equivalent ID (e.g. decomposed accents on macOS filesystems).
    uri = this.readLocations.get(uri.path.normalize("NFC")) || uri;
    const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
    const loaded = this.readBaseline.get(uri.path.normalize("NFC"));
    if (loaded !== undefined && stableStringify(JSON.parse(loaded)) === stableStringify(value)) {return;}
    let existing: string | undefined;
    if (await this.exists(uri)) {
      existing = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      const baseline = this.readBaseline.get(uri.path.normalize("NFC"));
      if (baseline !== undefined && baseline !== existing) {
        throw new Error(`The board file changed while saving: ${uri.path}. Reload and try again.`);
      }
      if (stableStringify(JSON.parse(existing)) === stableStringify(value)) {return;}
    }
    await vscode.workspace.fs.createDirectory(parent);
    const tempUri = vscode.Uri.joinPath(parent, `.${randomUUID()}.tmp`);
    try {
      await vscode.workspace.fs.writeFile(tempUri, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
      const current = await this.exists(uri) ? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8") : undefined;
      if (current !== existing) {throw new Error(`The board file changed while saving: ${uri.path}. Reload and try again.`);}
      await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
      this.readBaseline.set(uri.path.normalize("NFC"), `${JSON.stringify(value, null, 2)}\n`);
    } finally {
      if (await this.exists(tempUri)) {await vscode.workspace.fs.delete(tempUri);}
    }
  }

  private static async backupCorruptJson(
    uri: vscode.Uri,
    fileData: Uint8Array,
  ): Promise<void> {
    const fileName = uri.path.split("/").pop() || "file.json";
    if (fileName.includes(".corrupt-")) {
      return;
    }

    const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
    const backupUri = vscode.Uri.joinPath(
      parent,
      `${fileName}.corrupt-${Date.now()}`,
    );
    await vscode.workspace.fs.writeFile(backupUri, fileData);
  }

  private static async readTasks(tasksUri: vscode.Uri): Promise<Record<string, LynvoTask>> {
    const tasks: Record<string, LynvoTask> = {};

    if (!(await this.exists(tasksUri))) {
      return tasks;
    }

    const entries = await vscode.workspace.fs.readDirectory(tasksUri);
    for (const [name, type] of entries) {
      if (!name.endsWith(".json")) {continue;}
      if (type !== vscode.FileType.File) {
        throw new Error(`Invalid task file ${name}: expected a regular JSON file. The board has been left untouched.`);
      }
      const task = await this.readJson<LynvoTask>(vscode.Uri.joinPath(tasksUri, name));
      if (!task || !isSafeEntityId(task.id) || `${task.id}.json`.normalize("NFC") !== name.normalize("NFC") || hasOwn(tasks, task.id)) {
        throw new Error(`Invalid task file ${name}. The original has been left untouched.`);
      }
      tasks[task.id] = task;
    }

    return tasks;
  }

  private static async readActivity(
    activityUri: vscode.Uri,
  ): Promise<Record<string, LynvoActivity>> {
    const activity: Record<string, LynvoActivity> = {};

    if (!(await this.exists(activityUri))) {
      return activity;
    }

    const entries = await vscode.workspace.fs.readDirectory(activityUri);
    for (const [name, type] of entries) {
      if (!name.endsWith(".json")) {continue;}
      if (type !== vscode.FileType.File) {
        throw new Error(`Invalid activity file ${name}: expected a regular JSON file. The board has been left untouched.`);
      }
      const item = await this.readJson<LynvoActivity>(vscode.Uri.joinPath(activityUri, name));
      if (!item || !isSafeEntityId(item.id) || `${item.id}.json`.normalize("NFC") !== name.normalize("NFC") || hasOwn(activity, item.id)) {
        throw new Error(`Invalid activity file ${name}. The original has been left untouched.`);
      }
      activity[item.id] = item;
    }

    return activity;
  }

  private static async readOptionalJson<T>(
    uri: vscode.Uri,
    fallback: T,
  ): Promise<T> {
    if (!(await this.exists(uri))) {
      return fallback;
    }

    return this.readJson<T>(uri);
  }

  private static async loadModularBoard(): Promise<LynvoBoard | null> {
    const boardUri = this.joinModularPath("board.json");
    const columnsUri = this.joinModularPath("columns.json");
    const usersUri = this.joinModularPath("users.json");
    const tasksUri = this.joinModularPath("tasks");
    const activityUri = this.joinModularPath("activity");
    const syncUri = this.joinModularPath("metadata", "sync.json");
    const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
    const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
    const versionUri = this.joinModularPath("metadata", "version.json");
    if (
      !boardUri ||
      !columnsUri ||
      !usersUri ||
      !tasksUri ||
      !activityUri ||
      !syncUri ||
      !tombstonesUri ||
      !conflictsUri ||
      !versionUri
    ) {return null;}
    const root = this.getModularRootUri();
    if (!root || !(await this.exists(root))) {return null;}
    if (!(await this.exists(boardUri)) || !(await this.exists(columnsUri))) {
      throw new Error("Incomplete Lynvo board in .vscode/lynvo. Restore its missing files before editing.");
    }

    try {
      if (await this.exists(versionUri)) {
        const version = await this.readJson<{ schemaVersion?: unknown }>(versionUri);
        if (!version || Array.isArray(version) || typeof version.schemaVersion !== "string" ||
          (version.schemaVersion !== this.SCHEMA_VERSION && !/^[01]\.\d+\.\d+$/.test(version.schemaVersion))) {
          throw new Error("Invalid or unsupported board schema metadata. The original files have been left untouched.");
        }
      }
      const metadata = await this.readJson<BoardMetadata>(boardUri);
      const columns = await this.readJson<Record<string, LynvoColumn>>(columnsUri);
      if (!metadata || Array.isArray(metadata) || typeof metadata.version !== "string" ||
        !columns || Array.isArray(columns) || !Object.keys(columns).length) {
        throw new Error("Invalid board metadata or columns. The original files have been left untouched.");
      }
      const users = await this.readOptionalJson<Record<string, LynvoPresenceUser>>(
        usersUri,
        {},
      );
      const tasks = await this.readTasks(tasksUri);
      const activity = await this.readActivity(activityUri);
      const sync = await this.readOptionalJson<LynvoSyncMetadata>(
        syncUri,
        this.getDefaultSyncMetadata(),
      );
      const tombstones = await this.readOptionalJson<Record<string, LynvoTombstone>>(
        tombstonesUri,
        {},
      );
      const conflicts = await this.readOptionalJson<Record<string, LynvoConflict>>(
        conflictsUri,
        {},
      );

      return this.ensureBoardIntegrity({
        version: metadata.version,
        columns,
        tasks,
        labels: metadata.labels,
        users,
        activity,
        sync,
        tombstones,
        conflicts,
      });
    } catch (error) {
      console.error("Lynvo: error loading modular board", error);
      vscode.window.showWarningMessage(
        "Lynvo no pudo leer la persistencia modular. Revisa .vscode/lynvo.",
      );
      throw error;
    }
  }

  private static async loadLegacyBoard(): Promise<LynvoBoard | null> {
    const legacyUri = this.getLegacyFileUri();
    if (!legacyUri || !(await this.exists(legacyUri))) {return null;}

    try {
      const parsed = await this.readJson<LynvoBoard>(legacyUri);
      return this.ensureBoardIntegrity(parsed);
    } catch (error) {
      console.error("Lynvo: error loading legacy board", error);
      vscode.window.showWarningMessage(
        "Lynvo no pudo leer .vscode/lynvo.json. El archivo puede estar corrupto.",
      );
      throw error;
    }
  }

  private static async saveBoardUnsafe(board: LynvoBoard): Promise<void> {
    const root = this.getModularRootUri();
    const boardUri = this.joinModularPath("board.json");
    const columnsUri = this.joinModularPath("columns.json");
    const usersUri = this.joinModularPath("users.json");
    const settingsUri = this.joinModularPath("settings.json");
    const tasksUri = this.joinModularPath("tasks");
    const commentsUri = this.joinModularPath("comments");
    const activityUri = this.joinModularPath("activity");
    const metadataUri = this.joinModularPath("metadata");
    const syncUri = this.joinModularPath("metadata", "sync.json");
    const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
    const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
    const versionUri = this.joinModularPath("metadata", "version.json");
    if (
      !root ||
      !boardUri ||
      !columnsUri ||
      !usersUri ||
      !settingsUri ||
      !tasksUri ||
      !commentsUri ||
      !activityUri ||
      !metadataUri ||
      !syncUri ||
      !tombstonesUri ||
      !conflictsUri ||
      !versionUri
    ) {
      return;
    }

    const cleanBoard = this.ensureBoardIntegrity(board);

    await vscode.workspace.fs.createDirectory(root);
    await vscode.workspace.fs.createDirectory(tasksUri);
    await vscode.workspace.fs.createDirectory(commentsUri);
    await vscode.workspace.fs.createDirectory(activityUri);
    await vscode.workspace.fs.createDirectory(metadataUri);

    await this.writeJsonAtomic(boardUri, {
      version: this.SCHEMA_VERSION,
      labels: cleanBoard.labels || {},
    });
    await this.writeJsonAtomic(columnsUri, cleanBoard.columns);
    await this.writeJsonAtomic(usersUri, cleanBoard.users || {});
    if (!(await this.exists(settingsUri))) {await this.writeJsonAtomic(settingsUri, {});}
    await this.writeJsonAtomic(syncUri, cleanBoard.sync || this.getDefaultSyncMetadata());
    await this.writeJsonAtomic(tombstonesUri, cleanBoard.tombstones || {});
    await this.writeJsonAtomic(conflictsUri, cleanBoard.conflicts || {});
    await this.writeJsonAtomic(versionUri, {
      schemaVersion: this.SCHEMA_VERSION,
    });

    const expectedTaskFiles = new Set<string>();
    for (const task of Object.values(cleanBoard.tasks)) {
      expectedTaskFiles.add(`${task.id}.json`.normalize("NFC"));
      await this.writeJsonAtomic(vscode.Uri.joinPath(tasksUri, `${task.id}.json`), task);
    }

    const existingTaskFiles = await vscode.workspace.fs.readDirectory(tasksUri);
    for (const [name, type] of existingTaskFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".json") &&
        !expectedTaskFiles.has(name.normalize("NFC")) &&
        this.readBaseline.has(vscode.Uri.joinPath(tasksUri, name).path.normalize("NFC"))
      ) {
        const file = vscode.Uri.joinPath(tasksUri, name);
        const raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
        if (raw !== this.readBaseline.get(file.path.normalize("NFC"))) {throw new Error(`Task ${name} changed while deleting. Try again.`);}
        await vscode.workspace.fs.delete(file);
      }
    }

    const expectedActivityFiles = new Set<string>();
    const activityItems = Object.values(cleanBoard.activity || {})
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
    for (const activity of activityItems) {
      expectedActivityFiles.add(`${activity.id}.json`.normalize("NFC"));
      await this.writeJsonAtomic(
        vscode.Uri.joinPath(activityUri, `${activity.id}.json`),
        activity,
      );
    }

    const existingActivityFiles = await vscode.workspace.fs.readDirectory(activityUri);
    for (const [name, type] of existingActivityFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".json") &&
        !expectedActivityFiles.has(name.normalize("NFC")) &&
        this.readBaseline.has(vscode.Uri.joinPath(activityUri, name).path.normalize("NFC"))
      ) {
        const file = vscode.Uri.joinPath(activityUri, name);
        const raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
        if (raw !== this.readBaseline.get(file.path.normalize("NFC"))) {throw new Error(`Activity ${name} changed while deleting. Try again.`);}
        await vscode.workspace.fs.delete(file);
      }
    }
  }

  private static addActivity(
    board: LynvoBoard,
    type: LynvoActivityType,
    message: string,
    actor: LynvoActivity["actor"] | undefined,
    options: Pick<LynvoActivity, "taskId" | "targetTaskId" | "metadata"> = {},
  ): void {
    const id = this.createId("activity");
    board.activity = board.activity || {};
    board.activity[id] = {
      id,
      type,
      message,
      actor: actor || { githubId: "unknown", username: "Unknown" },
      createdAt: Date.now(),
      ...options,
    };
  }

  private static addTombstone(
    board: LynvoBoard,
    entityType: LynvoTombstone["entityType"],
    entityId: string,
    actor: LynvoTombstone["deletedBy"] | undefined,
  ): void {
    const id = `${entityType}-${entityId}`;
    board.tombstones = board.tombstones || {};
    board.tombstones[id] = {
      id,
      entityType,
      entityId,
      deletedAt: Date.now(),
      deletedBy: actor || UNKNOWN_USER,
    };
  }

  private static touchTask(task: LynvoTask, actor?: LynvoTask["lastModifiedBy"]): void {
    task.updatedAt = Math.max(Date.now(), task.updatedAt + 1);
    if (actor) {task.lastModifiedBy = actor;}
  }

  private static markPendingSync(board: LynvoBoard): void {
    board.sync = {
      ...this.getDefaultSyncMetadata(),
      ...(board.sync || {}),
      status: Object.values(board.conflicts || {}).some((conflict) => !conflict.resolved) ? "conflict" : "pending",
      pendingChanges: true,
      message: Object.values(board.conflicts || {}).some((conflict) => !conflict.resolved) ? "Unresolved conflicts" : "Local changes pending sync",
      updatedAt: Date.now(),
    };
  }

  private static async mutateBoard(
    mutator: (board: LynvoBoard) => Promise<void> | void,
  ): Promise<void> {
    return this.enqueue(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {throw new Error("Lynvo board not found. Open a project board first.");}
      const before = stableStringify(board);
      await mutator(board);
      if (stableStringify(board) === before) {return;}
      // Keep displayed alternatives current after a local edit, so a pending
      // click against an earlier conflict version cannot discard that edit.
      for (const conflict of Object.values(board.conflicts || {})) {
        if (conflict.resolved) {continue;}
        const entity = conflict.entityType === "task" ? board.tasks[conflict.entityId]
          : conflict.entityType === "column" ? board.columns[conflict.entityId] : board.labels?.[conflict.entityId];
        if (!entity) {continue;}
        const value = (entity as unknown as Record<string, LynvoConflict["localValue"]>)[conflict.field] ?? null;
        if (stableStringify(value) !== stableStringify(conflict.localValue)) {
          conflict.localValue = cloneBoardValue(value);
          conflict.createdAt = Math.max(Date.now(), conflict.createdAt + 1);
        }
      }
      this.markPendingSync(board);
      await this.saveBoardUnsafe(board);
    });
  }

  private static async loadBoardUnsafe(): Promise<LynvoBoard | null> {
    const modular = await this.loadModularBoard();
    if (modular) {return modular;}

    const legacy = await this.loadLegacyBoard();
    if (legacy) {
      await this.saveBoardUnsafe(legacy);
      return legacy;
    }

    return null;
  }

  public static async initializeBoard(): Promise<void> {
    return this.enqueue(async () => {
      const folderUri = this.getFolderUri();
      if (!folderUri) {return;}
      await vscode.workspace.fs.createDirectory(folderUri);
      const board = await this.loadBoardUnsafe();
      if (!board) {await this.saveBoardUnsafe(this.getDefaultBoard());}
    });
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    return this.enqueue(() => this.loadBoardUnsafe());
  }

  public static async saveBoard(board: LynvoBoard): Promise<void> {
    return this.enqueue(async () => {
      await this.loadModularBoard();
      await this.saveBoardUnsafe(board);
    });
  }

  public static async reconcileBoard(
    _baseSnapshot: LynvoBoard,
    mergeLatest: (latest: LynvoBoard) => LynvoBoard,
  ): Promise<LynvoBoard | null> {
    return this.enqueue(async () => {
      const latest = await this.loadBoardUnsafe();
      if (!latest) {return null;}
      const merged = this.ensureBoardIntegrity(mergeLatest(latest));
      await this.saveBoardUnsafe(merged);
      return merged;
    });
  }

  public static async finishSync(
    pushedSnapshot: LynvoBoard,
    metadata: Partial<LynvoSyncMetadata>,
  ): Promise<LynvoBoard | null> {
    return this.enqueue(async () => {
      const latest = await this.loadBoardUnsafe();
      if (!latest) {return null;}
      const pending = getBoardContentFingerprint(latest) !== getBoardContentFingerprint(pushedSnapshot);
      const conflicts = Object.values(latest.conflicts || {}).some((conflict) => !conflict.resolved);
      latest.sync = { ...this.getDefaultSyncMetadata(), ...latest.sync, ...metadata,
        status: conflicts ? "conflict" : pending ? "pending" : "synced", pendingChanges: pending,
        message: conflicts ? "Unresolved conflicts" : pending ? "Local changes pending sync" : "Synced", updatedAt: Date.now() };
      await this.saveBoardUnsafe(latest);
      return latest;
    });
  }

  public static async updateSyncMetadata(updates: Partial<LynvoSyncMetadata>): Promise<void> {
    return this.enqueue(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      board.sync = { ...this.getDefaultSyncMetadata(), ...board.sync, ...updates, updatedAt: Date.now() };
      await this.saveBoardUnsafe(board);
    });
  }

  public static async touchCurrentUser(): Promise<void> {
    return this.enqueue(async () => {
      const user = await AuthProvider.getGitHubUser();
      if (!user) {return;}
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      board.users = board.users || {};
      board.users[user.githubId] = { ...user, lastSeenAt: Date.now() };
      await this.saveBoardUnsafe(board);
    });
  }

  public static async updateTaskStatus(
    taskId: string,
    newStatus: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.tasks[taskId] || !board.columns[newStatus]) {return;}

      const user = await AuthProvider.getGitHubUser();
      const previousStatus = board.tasks[taskId].status;
      board.tasks[taskId].status = newStatus;
      this.touchTask(board.tasks[taskId], user);
      this.addActivity(
        board,
        "task_moved",
        `Moved "${board.tasks[taskId].title}" to ${board.columns[newStatus].title}`,
        user,
        {
          taskId,
          metadata: { from: previousStatus, to: newStatus },
        },
      );
    });
  }

  public static async reorderTasks(
    updates: Array<{
      id: string;
      status: string;
      position: number;
      isDraggedTask?: boolean;
    }>,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      updates.forEach((upd) => {
        if (!board.tasks[upd.id] || !board.columns[upd.status]) {return;}

        const task = board.tasks[upd.id];
        const changed = task.status !== upd.status || task.position !== upd.position;
        task.status = upd.status;
        task.position = upd.position;
        if (changed) {this.touchTask(task, user);}
        if (upd.isDraggedTask && changed) {
          this.addActivity(
            board,
            "task_moved",
            `Reordered "${board.tasks[upd.id].title}"`,
            user,
            {
              taskId: upd.id,
              metadata: { status: upd.status, position: upd.position },
            },
          );
        }
      });
    });
  }

  public static async createTask(
    title: string,
    description: string,
    targetColId?: string,
    labelIds: string[] = [],
    codeReference?: CodeReference,
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      const taskId = this.createId("task");

      let status = targetColId;
      if (!status || !board.columns[status]) {
        const sortedCols = Object.values(board.columns).sort(
          (a, b) => a.position - b.position,
        );
        status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
      }

      const now = Date.now();
      board.tasks[taskId] = {
        id: taskId,
        title,
        description,
        status,
        createdBy: user || { githubId: "unknown", username: "Unknown" },
        lastModifiedBy: user || { githubId: "unknown", username: "Unknown" },
        createdAt: now,
        updatedAt: now,
        codeReference,
        position: now,
        labelIds,
        priority,
        dueDate,
      };
      this.addActivity(board, "task_created", `Created "${title}"`, user, {
        taskId,
      });
    });
  }

  public static async editTask(
    taskId: string,
    title: string,
    description: string,
    labelIds: string[] = [],
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
    options: { expectedUpdatedAt?: number; checklist?: LynvoChecklistItem[]; relations?: LynvoTaskRelation[] } = {},
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {throw new Error("This task was deleted. Your draft has been preserved.");}
      if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== task.updatedAt) {
        throw new Error("This task changed while you were editing it. Your draft has been preserved; reopen the latest task before saving.");
      }
      if (!title.trim()) {throw new Error("Task title cannot be empty.");}
      const user = await AuthProvider.getGitHubUser();
      task.title = title.trim(); task.description = description; task.labelIds = labelIds;
      task.priority = priority; task.dueDate = dueDate;
      if (options.checklist !== undefined) {task.checklist = normalizeChecklist(options.checklist, task.updatedAt);}
      if (options.relations !== undefined) {
        task.relations = normalizeRelations(options.relations);
        if (task.relations.some((relation) => relation.targetTaskId === taskId || !board.tasks[relation.targetTaskId])) {
          throw new Error("A linked task no longer exists. Review the draft relations before saving.");
        }
      }
      this.touchTask(task, user);
      this.addActivity(board, "task_updated", `Updated "${task.title}"`, user, { taskId });
    });
  }

  public static async deleteTask(taskId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const taskTitle = board.tasks[taskId]?.title || "task";
      const user = await AuthProvider.getGitHubUser();
      this.addTombstone(board, "task", taskId, user);
      delete board.tasks[taskId];
      Object.values(board.tasks).forEach((task) => {
        const previous = task.relations || [];
        task.relations = previous.filter((relation) => relation.targetTaskId !== taskId);
        if (task.relations.length !== previous.length) {this.touchTask(task, user);}
      });
      this.addActivity(board, "task_deleted", `Deleted "${taskTitle}"`, user, {
        taskId,
      });
    });
  }

  public static async addChecklistItem(
    taskId: string,
    text: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task || !text.trim()) {return;}

      const user = await AuthProvider.getGitHubUser();
      const now = Date.now();
      const item: LynvoChecklistItem = {
        id: this.createId("check"),
        text: text.trim(),
        done: false,
        createdAt: now,
        updatedAt: now,
      };

      task.checklist = [...(task.checklist || []), item];
      this.touchTask(task, user);
      this.addActivity(board, "checklist_added", `Added checklist item to "${task.title}"`, user, {
        taskId,
      });
    });
  }

  public static async updateChecklistItem(
    taskId: string,
    itemId: string,
    updates: Partial<Pick<LynvoChecklistItem, "text" | "done">>,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      const item = task?.checklist?.find((entry) => entry.id === itemId);
      if (!task || !item) {return;}

      const user = await AuthProvider.getGitHubUser();
      if (typeof updates.text === "string") {
        item.text = updates.text.trim();
      }
      if (typeof updates.done === "boolean") {
        item.done = updates.done;
      }

      const now = Date.now();
      item.updatedAt = now;
      this.touchTask(task, user);
      this.addActivity(
        board,
        "checklist_updated",
        `${item.done ? "Completed" : "Updated"} checklist item in "${task.title}"`,
        user,
        { taskId },
      );
    });
  }

  public static async deleteChecklistItem(
    taskId: string,
    itemId: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const user = await AuthProvider.getGitHubUser();
      task.checklist = (task.checklist || []).filter((item) => item.id !== itemId);
      this.touchTask(task, user);
      this.addActivity(board, "checklist_deleted", `Removed checklist item from "${task.title}"`, user, {
        taskId,
      });
    });
  }

  public static async addTaskRelation(
    taskId: string,
    targetTaskId: string,
    type: LynvoTaskRelationType,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task || !board.tasks[targetTaskId] || taskId === targetTaskId) {return;}

      const relations = task.relations || [];
      const alreadyExists = relations.some(
        (relation) =>
          relation.targetTaskId === targetTaskId && relation.type === type,
      );
      if (alreadyExists) {return;}

      const user = await AuthProvider.getGitHubUser();
      const relation: LynvoTaskRelation = {
        id: this.createId("rel"),
        type,
        targetTaskId,
        createdAt: Date.now(),
      };

      task.relations = [...relations, relation];
      this.touchTask(task, user);
      this.addActivity(
        board,
        "relation_added",
        `Linked "${task.title}" to "${board.tasks[targetTaskId].title}"`,
        user,
        { taskId, targetTaskId, metadata: { type } },
      );
    });
  }

  public static async deleteTaskRelation(
    taskId: string,
    relationId: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const user = await AuthProvider.getGitHubUser();
      task.relations = (task.relations || []).filter(
        (relation) => relation.id !== relationId,
      );
      this.touchTask(task, user);
      this.addActivity(board, "relation_deleted", `Removed relation from "${task.title}"`, user, {
        taskId,
      });
    });
  }

  public static async resolveConflict(
    conflictId: string,
    resolution: "local" | "remote",
    expected?: LynvoConflict,
  ): Promise<void> {
    await this.resolveConflicts([conflictId], resolution, expected ? { [conflictId]: expected } : undefined);
  }

  public static async resolveConflicts(
    conflictIds: string[],
    resolution: "local" | "remote",
    expected?: Record<string, LynvoConflict>,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const ids = [...new Set(conflictIds)];
      // Validate every displayed version before applying even the first value.
      for (const id of ids) {
        const current = board.conflicts?.[id];
        if (expected) {
          if (!expected[id] || !current || !conflictSnapshotMatches(current, expected[id])) {
            throw new Error("The conflicts changed while you were reviewing them. Reload and review the latest values.");
          }
        }
        if (current && !current.resolved && resolution === "remote") {
          const entity = current.entityType === "task" ? board.tasks[current.entityId]
            : current.entityType === "column" ? board.columns[current.entityId] : board.labels?.[current.entityId];
          const value = entity ? (entity as unknown as Record<string, unknown>)[current.field] ?? null : null;
          if (entity && stableStringify(value) !== stableStringify(current.localValue)) {
            throw new Error("A conflicting value changed after synchronization. Sync again and review its latest values before discarding it.");
          }
        }
      }
      const user = await AuthProvider.getGitHubUser();
      for (const id of ids) {
        const conflict = board.conflicts?.[id];
        if (!conflict || conflict.resolved) {continue;}
        if (conflict.entityType === "task") {
          const task = board.tasks[conflict.entityId];
          if (task && resolution === "remote") {
            const value = cloneBoardValue(conflict.remoteValue);
            switch (conflict.field) {
              case "dueDate": task.dueDate = typeof value === "number" && Number.isFinite(value) ? value : undefined; break;
              case "position": task.position = typeof value === "number" && Number.isFinite(value) ? value : undefined; break;
              case "priority": task.priority = value === "low" || value === "medium" || value === "high" ? value : "medium"; break;
              case "checklist": task.checklist = normalizeChecklist(value, task.updatedAt); break;
              case "relations": task.relations = normalizeRelations(value); break;
              case "labelIds": task.labelIds = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; break;
              case "codeReference":
                if (value && !Array.isArray(value) && typeof value === "object" && "filePath" in value) {task.codeReference = value;}
                else {task.codeReference = undefined;}
                break;
              case "title": case "description": case "status": task[conflict.field] = typeof value === "string" ? value : ""; break;
              default: throw new Error("Unsupported task conflict field.");
            }
            this.touchTask(task, user);
          }
        } else if (conflict.entityType === "column") {
          const column = board.columns[conflict.entityId];
          if (column && resolution === "remote") {
            if (conflict.field === "position") {column.position = typeof conflict.remoteValue === "number" ? conflict.remoteValue : column.position;}
            else if (conflict.field === "title" || conflict.field === "color") {
              if (typeof conflict.remoteValue !== "string") {throw new Error("Invalid column conflict value.");}
              column[conflict.field] = conflict.remoteValue;
            } else {throw new Error("Unsupported column conflict field.");}
          }
        } else if (conflict.entityType === "label") {
          const label = board.labels?.[conflict.entityId];
          if (label && resolution === "remote") {
            if ((conflict.field !== "name" && conflict.field !== "color") || typeof conflict.remoteValue !== "string") {
              throw new Error("Invalid label conflict value.");
            }
            label[conflict.field] = conflict.remoteValue;
          }
        }
        conflict.resolved = true;
      }
    });
  }

  public static async createColumn(title: string, color: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      const colId = this.createId("col");
      const position = Object.keys(board.columns).length;
      board.columns[colId] = { id: colId, title, color, position };
      this.addActivity(board, "column_created", `Created column "${title}"`, user, {
        metadata: { columnId: colId },
      });
    });
  }

  public static async editColumn(
    id: string,
    title: string,
    color: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.columns[id]) {return;}

      const user = await AuthProvider.getGitHubUser();
      board.columns[id].title = title;
      board.columns[id].color = color;
      this.addActivity(board, "column_updated", `Updated column "${title}"`, user, {
        metadata: { columnId: id },
      });
    });
  }

  public static async deleteColumn(id: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.columns[id]) {return;}

      const user = await AuthProvider.getGitHubUser();
      const title = board.columns[id].title;
      const columnsCount = Object.keys(board.columns).length;
      if (columnsCount <= 1) {
        vscode.window.showWarningMessage(
          "No puedes eliminar la última columna del tablero.",
        );
        return;
      }

      delete board.columns[id];
      this.addTombstone(board, "column", id, user);
      this.addActivity(board, "column_deleted", `Deleted column "${title}"`, user, {
        metadata: { columnId: id },
      });

      for (const taskId in board.tasks) {
        if (board.tasks[taskId].status === id) {
          this.addTombstone(board, "task", taskId, user);
          delete board.tasks[taskId];
        }
      }
      for (const task of Object.values(board.tasks)) {
        const previous = task.relations || [];
        task.relations = previous.filter((relation) => Boolean(board.tasks[relation.targetTaskId]));
        if (task.relations.length !== previous.length) {this.touchTask(task, user);}
      }
    });
  }

  public static async reorderColumns(
    updates: { id: string; position: number }[],
  ): Promise<void> {
    await this.mutateBoard((board) => {
      updates.forEach((upd) => {
        if (board.columns[upd.id]) {
          board.columns[upd.id].position = upd.position;
        }
      });
    });
  }

  public static async createLabel(name: string, color: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      if (!board.labels) {board.labels = {};}
      const labelId = this.createId("label");
      board.labels[labelId] = { id: labelId, name, color };
      this.addActivity(board, "label_created", `Created label "${name}"`, user, {
        metadata: { labelId },
      });
    });
  }

  public static async deleteLabel(labelId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.labels || !board.labels[labelId]) {return;}

      const user = await AuthProvider.getGitHubUser();
      const name = board.labels[labelId].name;
      this.addTombstone(board, "label", labelId, user);
      delete board.labels[labelId];

      Object.values(board.tasks).forEach((task) => {
        const previous = task.labelIds || [];
        task.labelIds = previous.filter((id) => id !== labelId);
        if (task.labelIds.length !== previous.length) {this.touchTask(task, user);}
      });
      this.addActivity(board, "label_deleted", `Deleted label "${name}"`, user, {
        metadata: { labelId },
      });
    });
  }
}
