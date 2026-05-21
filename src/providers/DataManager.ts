import * as vscode from "vscode";
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

  private static getWorkspaceUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {return undefined;}
    return workspaceFolders[0].uri;
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

  private static getDefaultBoard(): LynvoBoard {
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
    const defaults = this.getDefaultBoard();
    const next: LynvoBoard = {
      version: this.SCHEMA_VERSION,
      columns:
        board.columns && Object.keys(board.columns).length > 0
          ? board.columns
          : defaults.columns,
      tasks: board.tasks || {},
      labels: board.labels || defaults.labels,
      users: board.users || {},
      activity: board.activity || {},
      sync: {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
      },
      tombstones: board.tombstones || {},
      conflicts: board.conflicts || {},
    };

    const sortedColumns = Object.values(next.columns).sort(
      (a, b) => a.position - b.position,
    );
    const fallbackColumnId = sortedColumns[0]?.id ?? "todo";

    Object.values(next.columns).forEach((column, index) => {
      if (!column.id) {column.id = this.createId("col");}
      if (!column.title) {column.title = "Untitled";}
      if (!column.color) {column.color = "var(--vscode-charts-blue)";}
      if (!Number.isFinite(column.position)) {column.position = index;}
    });

    Object.values(next.tasks).forEach((task) => {
      if (!next.columns[task.status]) {
        task.status = fallbackColumnId;
      }

      if (!task.createdAt) {task.createdAt = Date.now();}
      if (!task.updatedAt) {task.updatedAt = task.createdAt;}
      if (!task.createdBy) {
        task.createdBy = UNKNOWN_USER;
      }
      if (!task.lastModifiedBy) {
        task.lastModifiedBy = task.createdBy;
      }
      if (!task.labelIds) {
        task.labelIds = [];
      }
      if (!task.priority) {
        task.priority = "medium";
      }
      if (!task.checklist) {
        task.checklist = [];
      }
      if (!task.relations) {
        task.relations = [];
      }
    });

    return next;
  }

  private static async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private static async readJson<T>(uri: vscode.Uri): Promise<T> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const raw = Buffer.from(fileData).toString("utf8");
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
    const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
    await vscode.workspace.fs.createDirectory(parent);

    const tempUri = vscode.Uri.joinPath(
      parent,
      `.${uri.path.split("/").pop()}.${Date.now()}.tmp`,
    );
    const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await vscode.workspace.fs.writeFile(tempUri, data);
    await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
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
      if (type !== vscode.FileType.File || !name.endsWith(".json")) {continue;}
      try {
        const task = await this.readJson<LynvoTask>(vscode.Uri.joinPath(tasksUri, name));
        if (task.id) {
          tasks[task.id] = task;
        }
      } catch (error) {
        console.error(`Lynvo: invalid task file ${name}`, error);
      }
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
      if (type !== vscode.FileType.File || !name.endsWith(".json")) {continue;}
      try {
        const item = await this.readJson<LynvoActivity>(
          vscode.Uri.joinPath(activityUri, name),
        );
        if (item.id) {
          activity[item.id] = item;
        }
      } catch (error) {
        console.error(`Lynvo: invalid activity file ${name}`, error);
      }
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

    try {
      return await this.readJson<T>(uri);
    } catch (error) {
      console.error(`Lynvo: invalid json ${uri.path}`, error);
      return fallback;
    }
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
    if (
      !boardUri ||
      !columnsUri ||
      !usersUri ||
      !tasksUri ||
      !activityUri ||
      !syncUri ||
      !tombstonesUri ||
      !conflictsUri
    ) {return null;}
    if (!(await this.exists(boardUri)) || !(await this.exists(columnsUri))) {
      return null;
    }

    try {
      const metadata = await this.readJson<BoardMetadata>(boardUri);
      const columns = await this.readJson<Record<string, LynvoColumn>>(columnsUri);
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
      return null;
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
      return null;
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
    await this.writeJsonAtomic(settingsUri, {});
    await this.writeJsonAtomic(syncUri, cleanBoard.sync || this.getDefaultSyncMetadata());
    await this.writeJsonAtomic(tombstonesUri, cleanBoard.tombstones || {});
    await this.writeJsonAtomic(conflictsUri, cleanBoard.conflicts || {});
    await this.writeJsonAtomic(versionUri, {
      schemaVersion: this.SCHEMA_VERSION,
    });

    const expectedTaskFiles = new Set<string>();
    for (const task of Object.values(cleanBoard.tasks)) {
      expectedTaskFiles.add(`${task.id}.json`);
      await this.writeJsonAtomic(vscode.Uri.joinPath(tasksUri, `${task.id}.json`), task);
    }

    const existingTaskFiles = await vscode.workspace.fs.readDirectory(tasksUri);
    for (const [name, type] of existingTaskFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".json") &&
        !expectedTaskFiles.has(name)
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(tasksUri, name));
      }
    }

    const expectedActivityFiles = new Set<string>();
    const activityItems = Object.values(cleanBoard.activity || {})
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
    for (const activity of activityItems) {
      expectedActivityFiles.add(`${activity.id}.json`);
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
        !expectedActivityFiles.has(name)
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(activityUri, name));
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

  private static markPendingSync(board: LynvoBoard): void {
    board.sync = {
      ...this.getDefaultSyncMetadata(),
      ...(board.sync || {}),
      status: "pending",
      pendingChanges: true,
      message: "Local changes pending sync",
      updatedAt: Date.now(),
    };
  }

  private static async mutateBoard(
    mutator: (board: LynvoBoard) => Promise<void> | void,
  ): Promise<void> {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      await mutator(board);
      this.markPendingSync(board);
      await this.saveBoardUnsafe(board);
    });

    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
    const folderUri = this.getFolderUri();
    if (!folderUri) {return;}

    await vscode.workspace.fs.createDirectory(folderUri);
    const board = await this.loadBoardUnsafe();
    await this.saveBoard(board || this.getDefaultBoard());
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    return this.loadBoardUnsafe();
  }

  public static async saveBoard(board: LynvoBoard): Promise<void> {
    const run = this.writeQueue
      .catch(() => undefined)
      .then(() => this.saveBoardUnsafe(board));
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public static async updateSyncMetadata(
    updates: Partial<LynvoSyncMetadata>,
  ): Promise<void> {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      board.sync = {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
        ...updates,
        updatedAt: Date.now(),
      };
      await this.saveBoardUnsafe(board);
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public static async touchCurrentUser(): Promise<void> {
    const user = await AuthProvider.getGitHubUser();
    if (!user) {
      return;
    }

    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {
        return;
      }
      board.users = board.users || {};
      board.users[user.githubId] = {
        ...user,
        lastSeenAt: Date.now(),
      };
      await this.saveBoardUnsafe(board);
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
      board.tasks[taskId].updatedAt = Date.now();
      if (user) {board.tasks[taskId].lastModifiedBy = user;}
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

        board.tasks[upd.id].status = upd.status;
        board.tasks[upd.id].position = upd.position;
        if (upd.isDraggedTask) {
          board.tasks[upd.id].updatedAt = Date.now();
          if (user) {board.tasks[upd.id].lastModifiedBy = user;}
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
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.tasks[taskId]) {return;}

      const user = await AuthProvider.getGitHubUser();
      board.tasks[taskId].title = title;
      board.tasks[taskId].description = description;
      board.tasks[taskId].labelIds = labelIds;
      board.tasks[taskId].priority = priority;
      board.tasks[taskId].dueDate = dueDate;
      board.tasks[taskId].updatedAt = Date.now();

      if (user) {board.tasks[taskId].lastModifiedBy = user;}
      this.addActivity(board, "task_updated", `Updated "${title}"`, user, {
        taskId,
      });
    });
  }

  public static async deleteTask(taskId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const taskTitle = board.tasks[taskId]?.title || "task";
      const user = await AuthProvider.getGitHubUser();
      this.addTombstone(board, "task", taskId, user);
      delete board.tasks[taskId];
      Object.values(board.tasks).forEach((task) => {
        task.relations = (task.relations || []).filter(
          (relation) => relation.targetTaskId !== taskId,
        );
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
      task.updatedAt = now;
      if (user) {task.lastModifiedBy = user;}
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
      task.updatedAt = now;
      if (user) {task.lastModifiedBy = user;}
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
      task.updatedAt = Date.now();
      if (user) {task.lastModifiedBy = user;}
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
      task.updatedAt = Date.now();
      if (user) {task.lastModifiedBy = user;}
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
      task.updatedAt = Date.now();
      if (user) {task.lastModifiedBy = user;}
      this.addActivity(board, "relation_deleted", `Removed relation from "${task.title}"`, user, {
        taskId,
      });
    });
  }

  public static async resolveConflict(
    conflictId: string,
    resolution: "local" | "remote",
  ): Promise<void> {
    await this.mutateBoard((board) => {
      const conflict = board.conflicts?.[conflictId];
      if (!conflict || conflict.resolved) {return;}

      const task = board.tasks[conflict.entityId];
      if (task && resolution === "remote") {
        if (conflict.field === "dueDate") {
          task.dueDate =
            typeof conflict.remoteValue === "number" ? conflict.remoteValue : undefined;
        } else if (conflict.field === "priority") {
          task.priority =
            conflict.remoteValue === "low" ||
            conflict.remoteValue === "medium" ||
            conflict.remoteValue === "high"
              ? conflict.remoteValue
              : "medium";
        } else {
          task[conflict.field] =
            typeof conflict.remoteValue === "string" ? conflict.remoteValue : "";
        }
        task.updatedAt = Date.now();
      }

      conflict.resolved = true;
      const unresolved = Object.values(board.conflicts || {}).some(
        (item) => !item.resolved,
      );
      board.sync = {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
        status: unresolved ? "conflict" : "pending",
        pendingChanges: true,
        message: unresolved ? "Unresolved conflicts" : "Conflicts resolved",
        updatedAt: Date.now(),
      };
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
          delete board.tasks[taskId];
        }
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
        task.labelIds = (task.labelIds || []).filter((id) => id !== labelId);
      });
      this.addActivity(board, "label_deleted", `Deleted label "${name}"`, user, {
        metadata: { labelId },
      });
    });
  }
}
