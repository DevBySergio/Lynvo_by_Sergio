import * as vscode from "vscode";
import { DataManager } from "./DataManager";
import { GitService } from "./GitService";
import { LynvoChecklistItem, LynvoConflict, LynvoTaskRelation, LynvoTaskRelationType } from "../types";

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
  !filePath.split(/[\\/]/).some((segment) => segment === "..") &&
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

const asChecklist = (value: unknown): LynvoChecklistItem[] | undefined => {
  if (value === undefined) {return undefined;}
  if (!Array.isArray(value) || value.some((item) => !isRecord(item) || !asString(item.id) ||
    typeof item.text !== "string" || typeof item.done !== "boolean" || asNumber(item.createdAt) === undefined || asNumber(item.updatedAt) === undefined)) {
    throw new Error("Invalid checklist draft.");
  }
  return value as LynvoChecklistItem[];
};

const asRelations = (value: unknown): LynvoTaskRelation[] | undefined => {
  if (value === undefined) {return undefined;}
  if (!Array.isArray(value) || value.some((item) => !isRecord(item) || !asString(item.id) ||
    !asRelationType(item.type) || !asString(item.targetTaskId) || asNumber(item.createdAt) === undefined)) {
    throw new Error("Invalid relations draft.");
  }
  return value as LynvoTaskRelation[];
};

const asConflict = (value: unknown): LynvoConflict | undefined => {
  if (value === undefined) {return undefined;}
  if (!isRecord(value) || !asString(value.id) || !asString(value.entityId) ||
    !["task", "column", "label"].includes(String(value.entityType)) || !asString(value.field) || asNumber(value.createdAt) === undefined || typeof value.resolved !== "boolean") {
    throw new Error("Invalid conflict snapshot.");
  }
  return value as unknown as LynvoConflict;
};

const asConflicts = (value: unknown): Record<string, LynvoConflict> | undefined => {
  if (value === undefined) {return undefined;}
  if (!isRecord(value)) {throw new Error("Invalid conflict snapshots.");}
  return Object.fromEntries(Object.entries(value).map(([id, conflict]) => [id, asConflict(conflict)!]));
};

export class LynvoPanel {
  public static currentPanel: LynvoPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _requestedView: LynvoView | undefined;
  private _webviewReady = false;
  private _disposed = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialView: LynvoView) {
    this._panel = panel;
    this._requestedView = initialView;
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
      LynvoPanel.currentPanel._requestedView = initialView;
      void LynvoPanel.refreshData();
      if (LynvoPanel.currentPanel._webviewReady) {
        LynvoPanel.currentPanel._panel.webview.postMessage({ command: "switchView", view: initialView });
        LynvoPanel.currentPanel._requestedView = undefined;
      }
    } else {
      const panel = vscode.window.createWebviewPanel(
        "lynvoBoard",
        "Lynvo - Project Board",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
        },
      );
      LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri, initialView);
    }
  }

  public static async refreshData() {
    if (LynvoPanel.currentPanel) {
      const panel = LynvoPanel.currentPanel;
      const workspaceUri = DataManager.getActiveWorkspaceUri();
      const workspaceId = workspaceUri?.toString();
      try {
        const board = workspaceUri ? await DataManager.withWorkspace(workspaceUri, () => DataManager.loadBoard()) : await DataManager.loadBoard();
        if (DataManager.getActiveWorkspaceUri()?.toString() !== workspaceId || LynvoPanel.currentPanel !== panel) {return;}
        panel._panel.webview.postMessage({ command: "loadData", data: board, workspaceId });
      } catch (error) {
        if (DataManager.getActiveWorkspaceUri()?.toString() !== workspaceId || LynvoPanel.currentPanel !== panel) {return;}
        panel._panel.webview.postMessage({ command: "operationComplete", operation: "refresh", requestId: "refresh", workspaceId,
          error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private static async refreshDataAndScheduleSync() {
    GitService.scheduleBoardSync(15000, (result) => {
      if (result.success) {
        LynvoPanel.refreshData();
      }
    });
    await LynvoPanel.refreshData();
  }

  public dispose() {
    if (this._disposed) {return;}
    this._disposed = true;
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

        const requestId = asString(message.requestId);
        let errorDetail: string | undefined;
        const originWorkspace = DataManager.getActiveWorkspaceUri();
        try {
        const messageWorkspaceId = asString(message.workspaceId);
        if (messageWorkspaceId && messageWorkspaceId !== originWorkspace?.toString()) {
          throw new Error("The active project changed. Wait for the board to refresh before making changes.");
        }
        const operation = async () => {
        switch (message.command) {
          case "requestData": {
            this._webviewReady = true;
            const workspaceId = DataManager.getWorkspaceUri()?.toString();
            const board = await DataManager.loadBoard();
            if (DataManager.getActiveWorkspaceUri()?.toString() === workspaceId) {
              webview.postMessage({ command: "loadData", data: board, workspaceId });
            } else {await LynvoPanel.refreshData();}
            if (this._requestedView) {
              webview.postMessage({ command: "switchView", view: this._requestedView });
              this._requestedView = undefined;
            }
            return;
          }
          case "updateTaskStatus": {
            const taskId = asString(message.taskId);
            const newStatus = asString(message.newStatus);
            if (!taskId || !newStatus) {
              return;
            }
            await DataManager.updateTaskStatus(taskId, newStatus);
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "reorderTasks": {
            const updates = asTaskReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderTasks(updates);
            await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "editTask": {
            const taskId = asString(message.taskId);
            const title = asString(message.title);
            if (!taskId || !title?.trim()) {
              throw new Error("Task title cannot be empty.");
            }
            await DataManager.editTask(
              taskId,
              title,
              asString(message.description) || "",
              asStringArray(message.labelIds),
              asPriority(message.priority),
              asNumber(message.dueDate),
              {
                expectedUpdatedAt: asNumber(message.expectedUpdatedAt),
                checklist: asChecklist(message.checklist),
                relations: asRelations(message.relations),
              },
            );
            await LynvoPanel.refreshDataAndScheduleSync();
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
              await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
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
              await LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
          case "reorderColumns": {
            const updates = asColumnReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderColumns(updates);
            await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteLabel": {
            const labelId = asString(message.labelId);
            if (!labelId) {
              return;
            }
            await DataManager.deleteLabel(labelId);
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "addChecklistItem": {
            const taskId = asString(message.taskId);
            const text = asString(message.text);
            if (!taskId || !text) {
              return;
            }
            await DataManager.addChecklistItem(taskId, text);
            await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteChecklistItem": {
            const taskId = asString(message.taskId);
            const itemId = asString(message.itemId);
            if (!taskId || !itemId) {
              return;
            }
            await DataManager.deleteChecklistItem(taskId, itemId);
            await LynvoPanel.refreshDataAndScheduleSync();
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
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteTaskRelation": {
            const taskId = asString(message.taskId);
            const relationId = asString(message.relationId);
            if (!taskId || !relationId) {
              return;
            }
            await DataManager.deleteTaskRelation(taskId, relationId);
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "resolveConflict": {
            const conflictId = asString(message.conflictId);
            const resolution = asResolution(message.resolution);
            if (!conflictId || !resolution) {
              return;
            }
            await DataManager.resolveConflict(conflictId, resolution, asConflict(message.expectedConflict));
            await LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "resolveConflicts": {
            const conflictIds = asStringArray(message.conflictIds);
            const resolution = asResolution(message.resolution);
            if (!conflictIds?.length || !resolution) {
              return;
            }
            await DataManager.resolveConflicts(conflictIds, resolution, asConflicts(message.expectedConflicts));
            await LynvoPanel.refreshDataAndScheduleSync();
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
            const workspaceUri = DataManager.getWorkspaceUri();
            if (!workspaceUri) {
              return;
            }

            const fileUri = vscode.Uri.joinPath(workspaceUri, filePath);
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
        };
        if (originWorkspace) {await DataManager.withWorkspace(originWorkspace, operation);}
        else {await operation();}
        } catch (error) {
          errorDetail = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Lynvo could not complete the operation: ${errorDetail}`);
          if (message.command === "requestData" && this._requestedView) {
            webview.postMessage({ command: "switchView", view: this._requestedView });
            this._requestedView = undefined;
          }
          if (!requestId) {
            webview.postMessage({ command: "operationComplete", operation: message.command, requestId: "untracked", error: errorDetail });
          }
          // Roll back optimistic moves and refresh any newer values without losing editor drafts.
          try { await LynvoPanel.refreshData(); } catch { /* Preserve the original error. */ }
        } finally {
          if (message.command === "resolveConflict" || message.command === "resolveConflicts") {
            webview.postMessage({ command: "conflictResolutionComplete", ...(asString(message.workspaceId) ? { workspaceId: message.workspaceId } : {}), ...(errorDetail ? { error: errorDetail } : {}) });
          }
          if (requestId) {
            webview.postMessage({ command: "operationComplete", requestId, operation: message.command, workspaceId: asString(message.workspaceId), error: errorDetail });
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
