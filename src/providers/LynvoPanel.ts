// src/providers/LynvoPanel.ts
import * as vscode from "vscode";
import { DataManager } from "./DataManager";
import { GitService } from "./GitService";

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

  public static render(extensionUri: vscode.Uri) {
    if (LynvoPanel.currentPanel) {
      LynvoPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
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

  public dispose() {
    LynvoPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(
      async (message: any) => {
        switch (message.command) {
          case "requestData":
            const board = await DataManager.loadBoard();
            webview.postMessage({ command: "loadData", data: board });
            return;
          case "updateTaskStatus":
            await DataManager.updateTaskStatus(
              message.taskId,
              message.newStatus,
            );
            LynvoPanel.refreshData();
            return;
          case "reorderTasks":
            await DataManager.reorderTasks(message.updates);
            LynvoPanel.refreshData();
            return;
          case "createTask":
            await DataManager.createTask(
              message.title,
              message.description,
              message.targetColId,
              message.labelIds,
            );
            LynvoPanel.refreshData();
            return;
          case "editTask":
            await DataManager.editTask(
              message.taskId,
              message.title,
              message.description,
              message.labelIds,
            );
            LynvoPanel.refreshData();
            return;
          case "deleteTask":
            const confirmTask = await vscode.window.showWarningMessage(
              "Delete task?",
              { modal: true },
              "Delete",
            );
            if (confirmTask === "Delete") {
              await DataManager.deleteTask(message.taskId);
              LynvoPanel.refreshData();
            }
            return;
          case "createColumn":
            await DataManager.createColumn(message.title, message.color);
            LynvoPanel.refreshData();
            return;
          case "editColumn":
            await DataManager.editColumn(
              message.colId,
              message.title,
              message.color,
            );
            LynvoPanel.refreshData();
            return;
          case "deleteColumn":
            const confirmCol = await vscode.window.showWarningMessage(
              "Delete column? ALL TASKS inside will be deleted.",
              { modal: true },
              "Delete",
            );
            if (confirmCol === "Delete") {
              await DataManager.deleteColumn(message.colId);
              LynvoPanel.refreshData();
            }
            return;
          case "reorderColumns":
            await DataManager.reorderColumns(message.updates);
            LynvoPanel.refreshData();
            return;
          case "createLabel":
            await DataManager.createLabel(message.name, message.color);
            LynvoPanel.refreshData();
            return;
          case "deleteLabel":
            await DataManager.deleteLabel(message.labelId);
            LynvoPanel.refreshData();
            return;
          case "syncBoard":
            const result = await GitService.syncBoard();
            if (result.success) {
              vscode.window.showInformationMessage(result.message);
            } else {
              vscode.window.showWarningMessage(result.message);
            }
            LynvoPanel.refreshData();
            return;
          case "openCode":
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
              const fileUri = vscode.Uri.joinPath(
                folders[0].uri,
                message.filePath,
              );
              const doc = await vscode.workspace.openTextDocument(fileUri);
              const editor = await vscode.window.showTextDocument(
                doc,
                vscode.ViewColumn.Beside,
              );
              const pos = new vscode.Position(message.lineStart - 1, 0);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(
                new vscode.Range(pos, pos),
                vscode.TextEditorRevealType.InCenter,
              );
            }
            return;
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
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground); }
            * { box-sizing: border-box; }
            button { font-family: inherit; }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; transition: all .15s ease; border-radius: 6px; }
            .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }
}
function getNonce() {
  let t = "";
  const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    t += p.charAt(Math.floor(Math.random() * p.length));
  return t;
}
