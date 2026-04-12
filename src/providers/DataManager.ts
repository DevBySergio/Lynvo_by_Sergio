import * as vscode from "vscode";
import { CodeReference, LynvoBoard, LynvoPriority } from "../types";
import { AuthProvider } from "./AuthProvider";

export class DataManager {
  private static readonly FILENAME = "lynvo.json";
  private static readonly FOLDER = ".vscode";

  private static getDefaultColumns() {
    return {
      todo: {
        id: "todo",
        title: "📋 To Do",
        color: "var(--vscode-charts-blue)",
        position: 0,
      },
      "in-progress": {
        id: "in-progress",
        title: "⏳ In Progress",
        color: "var(--vscode-charts-yellow)",
        position: 1,
      },
      done: {
        id: "done",
        title: "✅ Done",
        color: "var(--vscode-charts-green)",
        position: 2,
      },
    };
  }

  private static getDefaultLabels() {
    return {
      bug: { id: "bug", name: "Bug", color: "#f85149" },
      feat: { id: "feat", name: "Feature", color: "#a371f7" },
    };
  }

  private static getFileUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
    return vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      this.FOLDER,
      this.FILENAME,
    );
  }

  private static getFolderUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
    return vscode.Uri.joinPath(workspaceFolders[0].uri, this.FOLDER);
  }

  private static normalizeBoard(board: LynvoBoard): LynvoBoard {
    let changed = false;

    if (!board.columns || Object.keys(board.columns).length === 0) {
      board.columns = this.getDefaultColumns();
      changed = true;
    }

    if (!board.labels) {
      board.labels = this.getDefaultLabels();
      changed = true;
    }

    const sortedColumns = Object.values(board.columns).sort(
      (a, b) => a.position - b.position,
    );
    sortedColumns.forEach((col, idx) => {
      if (col.position !== idx) {
        col.position = idx;
        changed = true;
      }
    });

    const firstColumnId = sortedColumns[0]?.id;
    if (firstColumnId) {
      for (const task of Object.values(board.tasks || {})) {
        if (!board.columns[task.status]) {
          task.status = firstColumnId;
          changed = true;
        }
        if (!task.priority) {
          task.priority = "medium";
          changed = true;
        }
        if (task.archived === undefined) {
          task.archived = false;
          changed = true;
        }
      }
    }

    if (!board.version || board.version !== "1.2.0") {
      board.version = "1.2.0";
      changed = true;
    }

    if (changed) {
      // guardado fuera, solo devolvemos estado normalizado
    }

    return board;
  }

  public static async initializeBoard(): Promise<void> {
    const fileUri = this.getFileUri();
    if (!fileUri) return;

    try {
      await vscode.workspace.fs.stat(fileUri);
      const board = await this.loadBoard();
      if (board) {
        await this.saveBoard(this.normalizeBoard(board));
      }
    } catch {
      const initialData: LynvoBoard = {
        version: "1.2.0",
        columns: this.getDefaultColumns(),
        tasks: {},
        labels: this.getDefaultLabels(),
      };
      await this.saveBoard(initialData);
    }
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    const fileUri = this.getFileUri();
    if (!fileUri) return null;

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const board = JSON.parse(Buffer.from(fileData).toString("utf8")) as LynvoBoard;
      return this.normalizeBoard(board);
    } catch {
      return null;
    }
  }

  public static async saveBoard(board: LynvoBoard): Promise<void> {
    const fileUri = this.getFileUri();
    const folderUri = this.getFolderUri();
    if (!fileUri || !folderUri) return;

    await vscode.workspace.fs.createDirectory(folderUri);
    const data = Buffer.from(JSON.stringify(board, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(fileUri, data);
  }

  private static async withBoard(
    cb: (board: LynvoBoard) => void | Promise<void>,
  ): Promise<LynvoBoard | null> {
    const board = await this.loadBoard();
    if (!board) return null;
    await cb(board);
    await this.saveBoard(board);
    return board;
  }

  public static async updateTaskStatus(
    taskId: string,
    newStatus: string,
  ): Promise<void> {
    await this.withBoard(async (board) => {
      if (!board.tasks[taskId]) return;
      const user = await AuthProvider.getGitHubUser();
      board.tasks[taskId].status = newStatus;
      board.tasks[taskId].updatedAt = Date.now();
      board.tasks[taskId].archived = false;
      if (user) board.tasks[taskId].lastModifiedBy = user;
    });
  }

  public static async reorderTasks(updates: any[]): Promise<void> {
    await this.withBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      updates.forEach((upd) => {
        if (board.tasks[upd.id]) {
          board.tasks[upd.id].status = upd.status;
          board.tasks[upd.id].position = upd.position;
          board.tasks[upd.id].archived = false;
          if (upd.isDraggedTask) {
            board.tasks[upd.id].updatedAt = Date.now();
            if (user) board.tasks[upd.id].lastModifiedBy = user;
          }
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
    priority: LynvoPriority = "medium",
    dueDate?: number,
  ): Promise<void> {
    await this.withBoard(async (board) => {
      const user = await AuthProvider.getGitHubUser();
      const taskId = `task-${Date.now()}`;

      let status = targetColId;
      if (!status) {
        const sortedCols = Object.values(board.columns).sort(
          (a, b) => a.position - b.position,
        );
        status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
      }

      board.tasks[taskId] = {
        id: taskId,
        title,
        description,
        status,
        createdBy: user || { githubId: "unknown", username: "Unknown" },
        lastModifiedBy: user || { githubId: "unknown", username: "Unknown" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        codeReference,
        position: Date.now(),
        labelIds,
        priority,
        dueDate,
        archived: false,
      };
    });
  }

  public static async editTask(
    taskId: string,
    title: string,
    description: string,
    labelIds: string[] = [],
    priority: LynvoPriority = "medium",
    dueDate?: number,
  ): Promise<void> {
    await this.withBoard(async (board) => {
      if (!board.tasks[taskId]) return;
      const user = await AuthProvider.getGitHubUser();
      board.tasks[taskId].title = title;
      board.tasks[taskId].description = description;
      board.tasks[taskId].labelIds = labelIds;
      board.tasks[taskId].priority = priority;
      board.tasks[taskId].dueDate = dueDate;
      board.tasks[taskId].updatedAt = Date.now();
      if (user) board.tasks[taskId].lastModifiedBy = user;
    });
  }

  public static async deleteTask(taskId: string): Promise<void> {
    await this.withBoard((board) => {
      delete board.tasks[taskId];
    });
  }

  public static async archiveCompletedTasks(): Promise<number> {
    let archivedCount = 0;

    await this.withBoard((board) => {
      const doneColumnIds = Object.values(board.columns)
        .filter((col) => /done|hecho|complet/i.test(col.title))
        .map((col) => col.id);

      for (const task of Object.values(board.tasks)) {
        if (doneColumnIds.includes(task.status) && !task.archived) {
          task.archived = true;
          archivedCount += 1;
        }
      }
    });

    return archivedCount;
  }

  public static async restoreTask(taskId: string): Promise<void> {
    await this.withBoard((board) => {
      if (!board.tasks[taskId]) return;
      board.tasks[taskId].archived = false;
      board.tasks[taskId].updatedAt = Date.now();
    });
  }

  public static async createColumn(title: string, color: string): Promise<void> {
    await this.withBoard((board) => {
      const colId = `col-${Date.now()}`;
      const position = Object.keys(board.columns).length;
      board.columns[colId] = { id: colId, title, color, position };
    });
  }

  public static async editColumn(
    id: string,
    title: string,
    color: string,
  ): Promise<void> {
    await this.withBoard((board) => {
      if (!board.columns[id]) return;
      board.columns[id].title = title;
      board.columns[id].color = color;
    });
  }

  public static async deleteColumn(id: string): Promise<number> {
    let movedTasks = 0;

    await this.withBoard((board) => {
      if (!board.columns[id]) return;
      const remainingColumns = Object.values(board.columns)
        .filter((col) => col.id !== id)
        .sort((a, b) => a.position - b.position);

      if (remainingColumns.length === 0) {
        return;
      }

      const fallbackColId = remainingColumns[0].id;
      for (const task of Object.values(board.tasks)) {
        if (task.status === id) {
          task.status = fallbackColId;
          task.updatedAt = Date.now();
          movedTasks += 1;
        }
      }

      delete board.columns[id];
      remainingColumns.forEach((col, idx) => {
        col.position = idx;
      });
    });

    return movedTasks;
  }

  public static async reorderColumns(
    updates: { id: string; position: number }[],
  ): Promise<void> {
    await this.withBoard((board) => {
      updates.forEach((upd) => {
        if (board.columns[upd.id]) {
          board.columns[upd.id].position = upd.position;
        }
      });
    });
  }

  public static async createLabel(name: string, color: string): Promise<void> {
    await this.withBoard((board) => {
      if (!board.labels) board.labels = {};
      const labelId = `label-${Date.now()}`;
      board.labels[labelId] = { id: labelId, name, color };
    });
  }

  public static async deleteLabel(id: string): Promise<void> {
    await this.withBoard((board) => {
      if (!board.labels) return;
      delete board.labels[id];
      for (const taskId in board.tasks) {
        if (board.tasks[taskId].labelIds) {
          board.tasks[taskId].labelIds = board.tasks[taskId].labelIds!.filter(
            (l) => l !== id,
          );
        }
      }
    });
  }
}
