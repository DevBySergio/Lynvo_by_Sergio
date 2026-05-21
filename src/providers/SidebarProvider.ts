import * as vscode from "vscode";

export class SidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const openBoardItem = new vscode.TreeItem(
      "Open Board",
      vscode.TreeItemCollapsibleState.None,
    );
    openBoardItem.tooltip = "Abre el panel Kanban en pantalla completa";
    openBoardItem.iconPath = new vscode.ThemeIcon("board");
    openBoardItem.command = {
      command: "lynvo.openBoard",
      title: "Open Board",
    };

    const authItem = new vscode.TreeItem(
      "Connect GitHub",
      vscode.TreeItemCollapsibleState.None,
    );
    authItem.tooltip = "Verifica tu identidad en GitHub";
    authItem.iconPath = new vscode.ThemeIcon("github");
    authItem.command = {
      command: "lynvo.testAuth",
      title: "Connect GitHub",
    };

    return [openBoardItem, authItem];
  }
}
