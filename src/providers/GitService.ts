// src/providers/GitService.ts
import * as vscode from "vscode";
import * as cp from "child_process";
import { DataManager } from "./DataManager";
import { LynvoBoard } from "../types";

export class GitService {
  private static getWorkspacePath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  }

  private static execPromise(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          console.warn(`Lynvo Git Warn: ${stderr}`);
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  public static async syncBoard(): Promise<{
    success: boolean;
    message: string;
  }> {
    const cwd = this.getWorkspacePath();
    if (!cwd)
      return { success: false, message: "No se encontró el workspace." };

    try {
      // 1. Descargamos la info de la nube de forma invisible
      await this.execPromise("git fetch origin", cwd);
      const branch = await this.execPromise(
        "git rev-parse --abbrev-ref HEAD",
        cwd,
      );

      // 2. Extraemos el tablero remoto directamente de la memoria de Git
      let remoteBoardStr = "";
      try {
        remoteBoardStr = await this.execPromise(
          `git show origin/${branch}:.vscode/lynvo.json`,
          cwd,
        );
      } catch (e) {
        // Es normal si el archivo aún no existe en el repositorio remoto
      }

      const localBoard = await DataManager.loadBoard();
      if (!localBoard)
        return {
          success: false,
          message: "No hay tablero local que sincronizar.",
        };

      // 3. FUSIÓN MATEMÁTICA INTELIGENTE (Anti-Pérdida de Datos)
      if (remoteBoardStr) {
        const remoteBoard: LynvoBoard = JSON.parse(remoteBoardStr);
        const mergedTasks = { ...remoteBoard.tasks };

        for (const taskId in localBoard.tasks) {
          const localTask = localBoard.tasks[taskId];
          const remoteTask = mergedTasks[taskId];

          // Regla de oro: Gana la tarea que se haya modificado más recientemente
          if (!remoteTask || localTask.updatedAt >= remoteTask.updatedAt) {
            mergedTasks[taskId] = localTask;
          }
        }

        // Estructura del tablero: la versión local es la fuente de verdad
        // para evitar "resurrección" de columnas/labels eliminadas por el usuario.
        localBoard.tasks = mergedTasks;
        localBoard.columns = { ...localBoard.columns };
        localBoard.labels = { ...(localBoard.labels || {}) };

        await DataManager.saveBoard(localBoard);
      }

      // 4. Aseguramos la fusión perfecta creando un commit local
      await this.execPromise("git add .vscode/lynvo.json", cwd);
      const status = await this.execPromise(
        "git status --porcelain .vscode/lynvo.json",
        cwd,
      );
      if (status) {
        await this.execPromise(
          'git commit -m "(Lynvo): auto-merge team board [skip ci]"',
          cwd,
        );
      }

      // 5. Unimos los historiales. Si Git detecta conflicto de texto, le obligamos a usar nuestra fusión (-X ours)
      try {
        await this.execPromise(
          `git merge origin/${branch} -X ours -m "(Lynvo): integrate remote changes"`,
          cwd,
        );
      } catch (mergeErr) {
        await this.execPromise("git merge --abort", cwd).catch(() => {});
        return {
          success: false,
          message:
            "Hay conflictos en el código de tu proyecto que bloquean la sincronización de Lynvo. Haz commit o pull de tus archivos primero.",
        };
      }

      // 6. Subimos todo a GitHub
      await this.execPromise(`git push origin ${branch}`, cwd);

      return {
        success: true,
        message:
          "¡Sincronización Total! Datos fusionados inteligentemente y subidos a GitHub.",
      };
    } catch (error: any) {
      console.error("Lynvo Git Error:", error);
      return {
        success: false,
        message: "Error al hacer push. Revisa tu consola de Git.",
      };
    }
  }
}
