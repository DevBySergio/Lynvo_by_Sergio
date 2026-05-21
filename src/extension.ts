import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";
import { GitService } from "./providers/GitService";

async function quickCreateTask(): Promise<void> {
  const board = await DataManager.loadBoard();
  if (!board) {
    vscode.window.showWarningMessage(
      "No se encontró el tablero de Lynvo. Abre una carpeta de proyecto primero.",
    );
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Título de la tarea",
    validateInput: (value) =>
      value.trim().length === 0 ? "El título no puede estar vacío." : null,
  });
  if (!title) {return;}

  const description =
    (await vscode.window.showInputBox({
      prompt: "Descripción (opcional)",
      placeHolder: "Contexto breve de la tarea...",
    })) || "";

  const sortedColumns = Object.values(board.columns).sort(
    (a, b) => a.position - b.position,
  );

  const selectedColumn = await vscode.window.showQuickPick(
    sortedColumns.map((column) => ({
      label: column.title,
      description: column.id,
      columnId: column.id,
    })),
    {
      title: "Selecciona la columna inicial",
      placeHolder: "¿En qué columna quieres crear la tarea?",
    },
  );

  if (!selectedColumn) {return;}

  await DataManager.createTask(title.trim(), description, selectedColumn.columnId);
  vscode.window.showInformationMessage("Tarea creada correctamente en Lynvo.");
  LynvoPanel.refreshData();
  GitService.scheduleBoardSync();
}

export function activate(context: vscode.ExtensionContext) {
  const lynvoMenuProvider = new LynvoMenuProvider();
  const treeDataRegistration = vscode.window.registerTreeDataProvider(
    "lynvo.sidebarMenu",
    lynvoMenuProvider,
  );
  let refreshTimer: NodeJS.Timeout | undefined;
  const schedulePanelRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      LynvoPanel.refreshData();
    }, 250);
  };
  const boardWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/lynvo/**/*.json",
  );
  boardWatcher.onDidChange(schedulePanelRefresh, null, context.subscriptions);
  boardWatcher.onDidCreate(schedulePanelRefresh, null, context.subscriptions);
  boardWatcher.onDidDelete(schedulePanelRefresh, null, context.subscriptions);

  DataManager.initializeBoard().catch((err) =>
    console.error("Lynvo Init Error:", err),
  );
  DataManager.touchCurrentUser().catch((err) =>
    console.error("Lynvo Presence Error:", err),
  );

  context.subscriptions.push(treeDataRegistration);
  context.subscriptions.push(boardWatcher);
  const autoSyncInterval = setInterval(async () => {
    await DataManager.touchCurrentUser().catch((err) =>
      console.error("Lynvo Presence Error:", err),
    );
    const result = await GitService.syncBoard();
    if (result.success) {
      await LynvoPanel.refreshData();
      if (result.hasConflicts) {
        vscode.window.showWarningMessage(
          "Lynvo detectó conflictos de sincronización. Abre el Conflict Center para resolverlos.",
          "Abrir conflictos",
        ).then((action) => {
          if (action === "Abrir conflictos") {
            LynvoPanel.render(context.extensionUri, "conflicts");
          }
        });
        return;
      }
      if (result.remoteChanged) {
        vscode.window.showInformationMessage(
          "Lynvo detectó cambios del equipo y actualizó el tablero.",
        );
      }
    } else {
      console.warn(`Lynvo periodic sync skipped: ${result.message}`);
    }
  }, 120000);

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      clearInterval(autoSyncInterval);
      GitService.cancelScheduledSync();
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.connectGitHub", async () => {
      const user = await AuthProvider.getGitHubUser({ createIfNone: true });
      if (user) {
        await DataManager.touchCurrentUser();
        vscode.window.showInformationMessage(`Conectado como: ${user.username}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.testAuth", async () => {
      const user = await AuthProvider.getGitHubUser({ createIfNone: true });
      if (user) {
        await DataManager.touchCurrentUser();
        vscode.window.showInformationMessage(`Conectado como: ${user.username}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openBoard", () => {
      LynvoPanel.render(context.extensionUri, "board");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openInsights", () => {
      LynvoPanel.render(context.extensionUri, "insights");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openTable", () => {
      LynvoPanel.render(context.extensionUri, "table");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openActivity", () => {
      LynvoPanel.render(context.extensionUri, "activity");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openConflicts", () => {
      LynvoPanel.render(context.extensionUri, "conflicts");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openLabels", () => {
      LynvoPanel.render(context.extensionUri, "labels");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.syncBoard", async () => {
      const result = await GitService.syncBoard();
      if (result.success && result.hasConflicts) {
        const action = await vscode.window.showWarningMessage(
          "Lynvo sincronizó el tablero, pero hay conflictos por resolver.",
          "Abrir conflictos",
        );
        if (action === "Abrir conflictos") {
          LynvoPanel.render(context.extensionUri, "conflicts");
        }
      } else if (result.success) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showWarningMessage(result.message);
      }
      LynvoPanel.refreshData();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.quickCreateTask", async () => {
      await quickCreateTask();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.createTaskFromCode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No hay ningún archivo abierto.");
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection).trim();
      if (!text) {
        vscode.window.showErrorMessage(
          "Selecciona un fragmento de código primero.",
        );
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: "Título de la tarea",
        validateInput: (value) =>
          value.trim().length === 0 ? "El título no puede estar vacío." : null,
      });
      if (!title) {return;}

      const codeRef = {
        filePath: vscode.workspace.asRelativePath(editor.document.uri),
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };

      await DataManager.createTask(title.trim(), text, undefined, [], codeRef);
      vscode.window.showInformationMessage("Tarea creada en Lynvo.");
      LynvoPanel.refreshData();
      GitService.scheduleBoardSync();
    }),
  );
}

export function deactivate() {}
