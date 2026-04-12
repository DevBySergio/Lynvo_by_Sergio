// src/extension.ts
import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";

export function activate(context: vscode.ExtensionContext) {
  // 1. REGISTRAMOS EL MENÚ LATERAL
  const lynvoMenuProvider = new LynvoMenuProvider();
  // Corregido: Ahora coincide exactamente con el ID de tu package.json
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "lynvo.sidebarMenu",
      lynvoMenuProvider,
    ),
  );

  // 2. INICIALIZAMOS LA BASE DE DATOS
  DataManager.initializeBoard().catch((err) =>
    console.error("Lynvo Init Error:", err),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.testAuth", async () => {
      const user = await AuthProvider.getGitHubUser();
      if (user) {
        vscode.window.showInformationMessage(
          `Conectado como: ${user.username}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openBoard", () => {
      LynvoPanel.render(context.extensionUri);
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
      const text = editor.document.getText(selection);
      if (!text) {
        vscode.window.showErrorMessage(
          "Selecciona un fragmento de código primero.",
        );
        return;
      }

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);

      const codeRef = {
        filePath: filePath,
        lineStart: selection.start.line + 1,
      };

      const title = await vscode.window.showInputBox({
        prompt: "Título de la tarea",
      });
      if (!title) return;

      // Usamos el DataManager que ya tienes, que está perfecto
      await DataManager.createTask(title, text, undefined, [], codeRef);

      vscode.window.showInformationMessage("Tarea creada en Lynvo.");
      LynvoPanel.refreshData();
    }),
  );
}

export function deactivate() {}
