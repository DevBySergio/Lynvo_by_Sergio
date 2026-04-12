// src/providers/AuthProvider.ts
import * as vscode from "vscode";
import { LynvoUser } from "../types";

export class AuthProvider {
  public static async getGitHubSession(
    createIfNone: boolean,
  ): Promise<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession("github", ["read:user"], {
      createIfNone,
    });
  }

  /**
   * Solicita la sesión de GitHub a través de VS Code.
   * Si el usuario no ha iniciado sesión, VS Code le mostrará un prompt nativo.
   */
  public static async getGitHubUser(): Promise<LynvoUser | undefined> {
    try {
      const session = await this.getGitHubSession(true);

      if (session) {
        return {
          githubId: session.account.id,
          username: session.account.label, // El nombre de usuario de GitHub
        };
      }
    } catch (error) {
      console.error("Lynvo: Error al autenticar con GitHub", error);
      vscode.window.showErrorMessage(
        "Lynvo: Se requiere iniciar sesión con GitHub para identificar los cambios.",
      );
    }

    return undefined; // Retorna undefined si el usuario cancela o hay un error
  }

  public static async getCurrentGitHubUser(): Promise<LynvoUser | undefined> {
    try {
      const session = await this.getGitHubSession(false);
      if (!session) return undefined;
      return {
        githubId: session.account.id,
        username: session.account.label,
      };
    } catch {
      return undefined;
    }
  }
}
