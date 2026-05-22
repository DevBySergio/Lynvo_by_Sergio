import * as vscode from "vscode";
import { LynvoUser } from "../types";

interface GitHubUserOptions {
  createIfNone?: boolean;
}

export class AuthProvider {
  public static async getGitHubUser(
    options: GitHubUserOptions = {},
  ): Promise<LynvoUser | undefined> {
    const { createIfNone = false } = options;

    try {
      const session = await vscode.authentication.getSession(
        "github",
        ["read:user"],
        { createIfNone },
      );

      if (session) {
        return {
          githubId: session.account.id,
          username: session.account.label,
        };
      }
    } catch (error) {
      console.error("Lynvo: Error authenticating with GitHub", error);
      if (createIfNone) {
        vscode.window.showErrorMessage(
          "Lynvo: You must sign in to GitHub to view the changes.",
        );
      }
    }

    return undefined;
  }
}
