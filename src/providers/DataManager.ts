// src/providers/DataManager.ts
import * as vscode from "vscode";
import {
  LynvoBoard,
  LynvoTask,
  CodeReference,
  LynvoColumn,
  LynvoLabel,
} from "../types";
import { AuthProvider } from "./AuthProvider";

export class DataManager {
  private static readonly FILENAME = "lynvo.json";
  private static readonly FOLDER = ".vscode";

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

  public static async initializeBoard(): Promise<void> {
    const fileUri = this.getFileUri();
    if (!fileUri) return;
    try {
      await vscode.workspace.fs.stat(fileUri);
      const board = await this.loadBoard();
      let changed = false;
      if (board && !board.columns) {
        board.columns = {
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
        changed = true;
      }
      if (board && !board.labels) {
        board.labels = {
          bug: { id: "bug", name: "Bug", color: "#f85149" },
          feat: { id: "feat", name: "Feature", color: "#a371f7" },
        };
        changed = true;
      }
      if (changed && board) await this.saveBoard(board);
    } catch (error) {
      const initialData: LynvoBoard = {
        version: "1.1.0",
        columns: {
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
        },
        tasks: {},
        labels: {
          bug: { id: "bug", name: "Bug", color: "#f85149" },
          feat: { id: "feat", name: "Feature", color: "#a371f7" },
        },
      };
      await this.saveBoard(initialData);
    }
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    const fileUri = this.getFileUri();
    if (!fileUri) return null;
    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      return JSON.parse(Buffer.from(fileData).toString("utf8")) as LynvoBoard;
    } catch (error) {
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

  public static async updateTaskStatus(
    taskId: string,
    newStatus: string,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.tasks[taskId]) return;
    const user = await AuthProvider.getGitHubUser();
    board.tasks[taskId].status = newStatus;
    board.tasks[taskId].updatedAt = Date.now();
    if (user) board.tasks[taskId].lastModifiedBy = user;
    await this.saveBoard(board);
  }

  public static async reorderTasks(updates: any[]): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    const user = await AuthProvider.getGitHubUser();
    updates.forEach((upd) => {
      if (board.tasks[upd.id]) {
        board.tasks[upd.id].status = upd.status;
        board.tasks[upd.id].position = upd.position;
        if (upd.isDraggedTask) {
          board.tasks[upd.id].updatedAt = Date.now();
          if (user) board.tasks[upd.id].lastModifiedBy = user;
        }
      }
    });
    await this.saveBoard(board);
  }

  public static async createTask(
    title: string,
    description: string,
    targetColId?: string,
    labelIds: string[] = [],
    codeReference?: CodeReference,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    const user = await AuthProvider.getGitHubUser();
    const taskId = "task-" + Date.now();

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
      codeReference: codeReference,
      position: Date.now(),
      labelIds: labelIds || [],
    };
    await this.saveBoard(board);
  }

  public static async editTask(
    taskId: string,
    title: string,
    description: string,
    labelIds: string[] = [],
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.tasks[taskId]) return;
    const user = await AuthProvider.getGitHubUser();
    board.tasks[taskId].title = title;
    board.tasks[taskId].description = description;
    board.tasks[taskId].labelIds = labelIds;
    board.tasks[taskId].updatedAt = Date.now();
    if (user) board.tasks[taskId].lastModifiedBy = user;
    await this.saveBoard(board);
  }

  public static async deleteTask(taskId: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    delete board.tasks[taskId];
    await this.saveBoard(board);
  }

  public static async createColumn(
    title: string,
    color: string,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    const colId = "col-" + Date.now();
    const position = Object.keys(board.columns).length;
    board.columns[colId] = { id: colId, title, color, position };
    await this.saveBoard(board);
  }

  public static async editColumn(
    id: string,
    title: string,
    color: string,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.columns[id]) return;
    board.columns[id].title = title;
    board.columns[id].color = color;
    await this.saveBoard(board);
  }

  public static async deleteColumn(id: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.columns[id]) return;
    delete board.columns[id];
    for (const taskId in board.tasks) {
      if (board.tasks[taskId].status === id) {
        delete board.tasks[taskId];
      }
    }
    await this.saveBoard(board);
  }

  public static async reorderColumns(
    updates: { id: string; position: number }[],
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    updates.forEach((upd) => {
      if (board.columns[upd.id]) {
        board.columns[upd.id].position = upd.position;
      }
    });
    await this.saveBoard(board);
  }

  public static async createLabel(name: string, color: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;
    if (!board.labels) board.labels = {};
    const labelId = "label-" + Date.now();
    board.labels[labelId] = { id: labelId, name, color };
    await this.saveBoard(board);
  }

  public static async deleteLabel(id: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.labels) return;
    delete board.labels[id];
    for (const taskId in board.tasks) {
      if (board.tasks[taskId].labelIds) {
        board.tasks[taskId].labelIds = board.tasks[taskId].labelIds!.filter(
          (l) => l !== id,
        );
      }
    }
    await this.saveBoard(board);
  }
}
