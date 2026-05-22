import * as vscode from "vscode";
import { DataManager } from "./DataManager";
import { GitService } from "./GitService";
import { LynvoTaskRelationType } from "../types";

type LynvoView =
  | "board"
  | "table"
  | "activity"
  | "conflicts"
  | "insights"
  | "labels";

type WebviewMessage = {
  command?: string;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asRelationType = (value: unknown): LynvoTaskRelationType | undefined =>
  value === "blocks" ||
  value === "blocked-by" ||
  value === "related" ||
  value === "duplicates"
    ? value
    : undefined;

const asPriority = (value: unknown): "low" | "medium" | "high" | undefined =>
  value === "low" || value === "medium" || value === "high" ? value : undefined;

const asResolution = (value: unknown): "local" | "remote" | undefined =>
  value === "local" || value === "remote" ? value : undefined;

const asCodeReference = (
  value: unknown,
): { filePath: string; lineStart: number; lineEnd: number } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const filePath = asString(value.filePath);
  const lineStart = asNumber(value.lineStart);
  const lineEnd = asNumber(value.lineEnd);
  if (!filePath || lineStart === undefined || lineEnd === undefined) {
    return undefined;
  }
  return { filePath, lineStart, lineEnd };
};

const isSafeWorkspaceRelativePath = (filePath: string): boolean =>
  !filePath.startsWith("/") &&
  !filePath.startsWith("\\") &&
  !filePath.includes("..") &&
  !/^[a-zA-Z]:[\\/]/.test(filePath);

const asTaskReorderUpdates = (
  value: unknown,
): Array<{
  id: string;
  status: string;
  position: number;
  isDraggedTask?: boolean;
}> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = asString(item.id);
    const status = asString(item.status);
    const position = asNumber(item.position);
    if (!id || !status || position === undefined) {
      return [];
    }
    return [
      { id, status, position, isDraggedTask: asBoolean(item.isDraggedTask) },
    ];
  });
};

const asColumnReorderUpdates = (
  value: unknown,
): Array<{ id: string; position: number }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = asString(item.id);
    const position = asNumber(item.position);
    if (!id || position === undefined) {
      return [];
    }
    return [{ id, position }];
  });
};

export class LynvoPanel {
  public static currentPanel: LynvoPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static render(
    extensionUri: vscode.Uri,
    initialView: LynvoView = "board",
  ) {
    if (LynvoPanel.currentPanel) {
      LynvoPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "switchView",
        view: initialView,
      });
    } else {
      const panel = vscode.window.createWebviewPanel(
        "lynvoBoard",
        "Lynvo - Project Board",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
        },
      );
      LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "switchView",
        view: initialView,
      });
    }
  }

  public static async refreshData() {
    if (LynvoPanel.currentPanel) {
      const board = await DataManager.loadBoard();
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "loadData",
        data: board,
      });
    }
  }

  private static async refreshDataAndScheduleSync() {
    await LynvoPanel.refreshData();
    GitService.scheduleBoardSync(15000, (result) => {
      if (result.success) {
        LynvoPanel.refreshData();
      }
    });
  }

  public dispose() {
    LynvoPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (!isRecord(message) || !asString(message.command)) {
          return;
        }

        switch (message.command) {
          case "requestData": {
            const board = await DataManager.loadBoard();
            webview.postMessage({ command: "loadData", data: board });
            return;
          }
          case "updateTaskStatus": {
            const taskId = asString(message.taskId);
            const newStatus = asString(message.newStatus);
            if (!taskId || !newStatus) {
              return;
            }
            await DataManager.updateTaskStatus(taskId, newStatus);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "reorderTasks": {
            const updates = asTaskReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderTasks(updates);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "createTask": {
            const title = asString(message.title);
            if (!title) {
              return;
            }
            await DataManager.createTask(
              title,
              asString(message.description) || "",
              asString(message.targetColId),
              asStringArray(message.labelIds),
              asCodeReference(message.codeReference),
              asPriority(message.priority),
              asNumber(message.dueDate),
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "editTask": {
            const taskId = asString(message.taskId);
            const title = asString(message.title);
            if (!taskId || !title) {
              return;
            }
            await DataManager.editTask(
              taskId,
              title,
              asString(message.description) || "",
              asStringArray(message.labelIds),
              asPriority(message.priority),
              asNumber(message.dueDate),
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteTask": {
            const taskId = asString(message.taskId);
            if (!taskId) {
              return;
            }
            const confirmTask = await vscode.window.showWarningMessage(
              "Delete task?",
              { modal: true },
              "Delete",
            );
            if (confirmTask === "Delete") {
              await DataManager.deleteTask(taskId);
              LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
          case "createColumn": {
            const title = asString(message.title);
            if (!title) {
              return;
            }
            await DataManager.createColumn(
              title,
              asString(message.color) || "var(--vscode-charts-blue)",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "editColumn": {
            const colId = asString(message.colId);
            const title = asString(message.title);
            if (!colId || !title) {
              return;
            }
            await DataManager.editColumn(
              colId,
              title,
              asString(message.color) || "var(--vscode-charts-blue)",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteColumn": {
            const colId = asString(message.colId);
            if (!colId) {
              return;
            }
            const confirmCol = await vscode.window.showWarningMessage(
              "Delete column? ALL TASKS inside will be deleted.",
              { modal: true },
              "Delete",
            );
            if (confirmCol === "Delete") {
              await DataManager.deleteColumn(colId);
              LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
          case "reorderColumns": {
            const updates = asColumnReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderColumns(updates);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "createLabel": {
            const name = asString(message.name);
            if (!name) {
              return;
            }
            await DataManager.createLabel(
              name,
              asString(message.color) || "#f85149",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteLabel": {
            const labelId = asString(message.labelId);
            if (!labelId) {
              return;
            }
            await DataManager.deleteLabel(labelId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "addChecklistItem": {
            const taskId = asString(message.taskId);
            const text = asString(message.text);
            if (!taskId || !text) {
              return;
            }
            await DataManager.addChecklistItem(taskId, text);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "updateChecklistItem": {
            const taskId = asString(message.taskId);
            const itemId = asString(message.itemId);
            if (!taskId || !itemId) {
              return;
            }
            await DataManager.updateChecklistItem(taskId, itemId, {
              text: asString(message.text),
              done: asBoolean(message.done),
            });
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteChecklistItem": {
            const taskId = asString(message.taskId);
            const itemId = asString(message.itemId);
            if (!taskId || !itemId) {
              return;
            }
            await DataManager.deleteChecklistItem(taskId, itemId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "addTaskRelation": {
            const taskId = asString(message.taskId);
            const targetTaskId = asString(message.targetTaskId);
            const relationType = asRelationType(message.relationType);
            if (!taskId || !targetTaskId || !relationType) {
              return;
            }
            await DataManager.addTaskRelation(
              taskId,
              targetTaskId,
              relationType,
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteTaskRelation": {
            const taskId = asString(message.taskId);
            const relationId = asString(message.relationId);
            if (!taskId || !relationId) {
              return;
            }
            await DataManager.deleteTaskRelation(taskId, relationId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "resolveConflict": {
            const conflictId = asString(message.conflictId);
            const resolution = asResolution(message.resolution);
            if (!conflictId || !resolution) {
              return;
            }
            await DataManager.resolveConflict(conflictId, resolution);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "syncBoard": {
            const result = await GitService.syncBoard();
            if (result.success && result.hasConflicts) {
              const action = await vscode.window.showWarningMessage(
                "Lynvo has synchronized the dashboard, but there are still conflicts to resolve.",
                "Open conflicts",
              );
              if (action === "Open conflicts") {
                this._panel.webview.postMessage({
                  command: "switchView",
                  view: "conflicts",
                });
              }
            } else if (result.success) {
              vscode.window.showInformationMessage(result.message);
            } else {
              vscode.window.showWarningMessage(result.message);
            }
            LynvoPanel.refreshData();
            return;
          }
          case "openCode": {
            const filePath = asString(message.filePath);
            const lineStart = asNumber(message.lineStart);
            if (
              !filePath ||
              !isSafeWorkspaceRelativePath(filePath) ||
              lineStart === undefined
            ) {
              return;
            }
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
              return;
            }

            const fileUri = vscode.Uri.joinPath(folders[0].uri, filePath);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(
              doc,
              vscode.ViewColumn.Beside,
            );
            const pos = new vscode.Position(Math.max(0, lineStart - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter,
            );
            return;
          }
        }
      },
      undefined,
      this._disposables,
    );
  }

  private _getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
  ) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
    );
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src data: https:",
      "font-src data:",
    ].join("; ");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; }
            .icon-btn:hover { opacity: 1; }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
            button { border-radius: 4px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}

function getNonce() {
  let t = "";
  const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    t += p.charAt(Math.floor(Math.random() * p.length));
  }
  return t;
}
