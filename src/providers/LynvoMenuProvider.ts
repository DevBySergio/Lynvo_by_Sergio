import * as vscode from "vscode";

interface MenuItem {
  label: string;
  command: string;
  tooltip: string;
  icon: string;
}

export class LynvoMenuProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly menuItems: MenuItem[] = [
    {
      label: "Open Board",
      command: "lynvo.openBoard",
      tooltip: "Abre el tablero principal de Kanban",
      icon: "board",
    },
    {
      label: "Open Insights",
      command: "lynvo.openInsights",
      tooltip: "Muestra métricas y salud del proyecto",
      icon: "graph",
    },
    {
      label: "Open Table",
      command: "lynvo.openTable",
      tooltip: "Abre la vista tabla de tareas",
      icon: "table",
    },
    {
      label: "Open Activity",
      command: "lynvo.openActivity",
      tooltip: "Muestra el historial de actividad del equipo",
      icon: "history",
    },
    {
      label: "Open Conflicts",
      command: "lynvo.openConflicts",
      tooltip: "Revisa conflictos de sincronización pendientes",
      icon: "warning",
    },
    {
      label: "Manage Labels",
      command: "lynvo.openLabels",
      tooltip: "Administra etiquetas del tablero",
      icon: "tag",
    },
    {
      label: "New Task",
      command: "lynvo.quickCreateTask",
      tooltip: "Crea una tarea rápida desde un asistente",
      icon: "add",
    },
    {
      label: "New Task from Code",
      command: "lynvo.createTaskFromCode",
      tooltip: "Crea una tarea usando la selección actual de código",
      icon: "code",
    },
    {
      label: "Sync Team Board",
      command: "lynvo.syncBoard",
      tooltip: "Sincroniza Lynvo mediante la rama técnica lynvo-sync",
      icon: "sync",
    },
    {
      label: "Connect GitHub",
      command: "lynvo.connectGitHub",
      tooltip: "Conecta y valida tu identidad de GitHub",
      icon: "github",
    },
  ];

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      this.menuItems.map((item) =>
        this.createMenuItem(item),
      ),
    );
  }

  private createMenuItem({ label, command, tooltip, icon }: MenuItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.command = { command, title: label };
    item.tooltip = tooltip;
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
