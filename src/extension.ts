import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";
import { GitService } from "./providers/GitService";
import { SkillInstaller } from "./providers/SkillInstaller";

async function createTask(
   title: string,
   description: string,
   columnId: string | undefined,
   codeRef?: { filePath: string; lineStart: number; lineEnd: number }
): Promise<void> {
   await DataManager.createTask(title.trim(), description, columnId, [], codeRef);
   vscode.window.showInformationMessage("Task created in Lynvo.");
   LynvoPanel.refreshData();
   GitService.scheduleBoardSync();
}

async function quickCreateTask(): Promise<void> {
   const board = await DataManager.loadBoard();
   if (!board) {
     vscode.window.showWarningMessage(
       "Lynvo board not found. Open a project folder first.",
     );
     return;
   }

   const title = await vscode.window.showInputBox({
     prompt: "Task title",
     validateInput: (value) =>
       value.trim().length === 0 ? "Title cannot be empty." : null,
   });
   if (!title) {return;}

   const description =
     (await vscode.window.showInputBox({
       prompt: "Description (optional)",
       placeHolder: "Brief context for the task...",
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
       title: "Select initial column",
       placeHolder: "Which column should the task start in?",
     },
   );

   if (!selectedColumn) {return;}

   await createTask(title.trim(), description, selectedColumn.columnId);
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

  SkillInstaller.installAll(context.extensionUri, context, { silent: true }).then(
    (result) => {
      if (result.installed.length > 0) {
        console.log(`Lynvo: skills installed → ${result.installed.join(", ")}`);
      }
      if (result.errors.length > 0) {
        console.warn(`Lynvo: skill install errors → ${result.errors.join(", ")}`);
      }
    },
  ).catch((err) => console.error("Lynvo Skill Install Error:", err));

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
          "Lynvo detected sync conflicts. Open the Conflict Center to resolve them.",
          "Open conflicts",
        ).then((action) => {
          if (action === "Open conflicts") {
            LynvoPanel.render(context.extensionUri, "conflicts");
          }
        });
        return;
      }
      if (result.remoteChanged) {
        vscode.window.showInformationMessage(
          "Lynvo detected team changes and updated the board.",
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
        vscode.window.showInformationMessage(`Connected as: ${user.username}`);
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
          "Lynvo synced the board, but there are conflicts to resolve.",
          "Open conflicts",
        );
        if (action === "Open conflicts") {
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
        vscode.window.showErrorMessage("No file is currently open.");
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection).trim();
      if (!text) {
        vscode.window.showErrorMessage(
          "Select a code fragment first.",
        );
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: "Task title",
        validateInput: (value) =>
          value.trim().length === 0 ? "Title cannot be empty." : null,
      });
      if (!title) {return;}

      const codeRef = {
        filePath: vscode.workspace.asRelativePath(editor.document.uri),
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };

       await createTask(title.trim(), text, undefined, codeRef);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.installSkills", async () => {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Lynvo: Installing agent skills...",
          cancellable: false,
        },
        () => SkillInstaller.installAll(context.extensionUri, context, { force: true }),
      );

      const messages: string[] = [];
      if (result.installed.length > 0) {
        messages.push(`Installed: ${result.installed.length} location(s)`);
      }
      if (result.skipped.length > 0) {
        messages.push(`Skipped: ${result.skipped.length} location(s)`);
      }
      if (result.errors.length > 0) {
        messages.push(`Errors: ${result.errors.join("; ")}`);
      }

      if (messages.length === 0) {
        vscode.window.showInformationMessage("Lynvo skills are already up to date.");
      } else {
        const detail = messages.join("\n");
        if (result.errors.length > 0) {
          vscode.window.showWarningMessage(detail);
        } else {
          vscode.window.showInformationMessage(detail);
        }
      }
    }),
  );
}

export function deactivate() {}
