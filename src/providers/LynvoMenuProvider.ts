// src/providers/LynvoMenuProvider.ts
import * as vscode from "vscode";

export class LynvoMenuProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      return Promise.resolve([
        this.createMenuItem(
          "Open Board",
          "lynvo.openBoard",
          "Abre el tablero principal",
          "project",
        ),
        this.createMenuItem(
          "Add Task from Code",
          "lynvo.createTaskFromCode",
          "Crea una tarea desde tu selección actual",
          "add",
        ),
        this.createMenuItem(
          "Connect GitHub",
          "lynvo.connectGitHub",
          "Inicia sesión o vincula tu cuenta de GitHub",
          "vm-connect",
        ),
        this.createMenuItem(
          "Check GitHub Status",
          "lynvo.checkGitHubStatus",
          "Comprueba si hay sesión de GitHub activa",
          "account",
        ),
        this.createMenuItem(
          "Sync Board",
          "lynvo.syncBoard",
          "Sincroniza el tablero con el repositorio remoto",
          "cloud-upload",
        ),
      ]);
    }
  }

  private createMenuItem(
    label: string,
    command: string,
    tooltip: string,
    iconId?: string,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.command = { command: command, title: label };
    item.tooltip = tooltip;
    item.description = tooltip;
    if (iconId) {
      item.iconPath = new vscode.ThemeIcon(iconId);
    }
    return item;
  }
}
