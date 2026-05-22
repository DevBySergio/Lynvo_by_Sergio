import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

type SkillTarget = {
  label: string;
  getPath: () => string;
  fileName: string;
  priority: "primary" | "secondary" | "tertiary";
};

const SKILL_NAME = "lynvo";

const GLOBAL_TARGETS: SkillTarget[] = [
  {
    label: "OpenCode",
    getPath: () =>
      path.join(os.homedir(), ".config", "opencode", "skills", SKILL_NAME),
    fileName: "SKILL.md",
    priority: "primary",
  },
  {
    label: "Claude Code",
    getPath: () => path.join(os.homedir(), ".claude", "skills", SKILL_NAME),
    fileName: "SKILL.md",
    priority: "primary",
  },
  {
    label: "Cline / Roo Code",
    getPath: () => path.join(os.homedir(), ".clinerules"),
    fileName: `${SKILL_NAME}.md`,
    priority: "secondary",
  },
];

type WorkspaceTarget = {
  label: string;
  dirName: string;
  fileName: string;
  priority: "primary" | "secondary" | "tertiary";
};

const WORKSPACE_TARGETS: WorkspaceTarget[] = [
  {
    label: "Cursor",
    dirName: ".cursor",
    fileName: "rules.md",
    priority: "secondary",
  },
  {
    label: "Windsurf",
    dirName: ".windsurf",
    fileName: "rules.md",
    priority: "secondary",
  },
  {
    label: "GitHub Copilot",
    dirName: ".github",
    fileName: "copilot-instructions.md",
    priority: "tertiary",
  },
  {
    label: "OpenCode (project)",
    dirName: ".opencode",
    fileName: `skills/${SKILL_NAME}/SKILL.md`,
    priority: "primary",
  },
  {
    label: "Claude Code (project)",
    dirName: ".claude",
    fileName: `skills/${SKILL_NAME}/SKILL.md`,
    priority: "primary",
  },
  {
    label: "Agents (project)",
    dirName: ".agents",
    fileName: `skills/${SKILL_NAME}/SKILL.md`,
    priority: "secondary",
  },
];

export class SkillInstaller {
  private static readonly SETTING_KEY = "autoInstallSkills";
  private static readonly LAST_HASH_KEY = "skillHash";

  private static getWorkspaceUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri : undefined;
  }

  private static getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("lynvo");
  }

  private static async readEmbeddedSkill(
    extensionUri: vscode.Uri,
  ): Promise<string> {
    const uri = vscode.Uri.joinPath(extensionUri, "SKILL.md");
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString("utf8");
  }

  private static hash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private static async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private static async readInstalledSkill(filePath: string): Promise<string | null> {
    if (!(await this.fileExists(filePath))) {
      return null;
    }
    return fs.readFile(filePath, "utf8");
  }

  static async installAll(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    options: { force?: boolean; silent?: boolean } = {},
  ): Promise<{ installed: string[]; skipped: string[]; errors: string[] }> {
    const installed: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    const autoInstall = this.getConfig().get<boolean>(this.SETTING_KEY, true);
    if (!autoInstall && !options.force) {
      return { installed, skipped: ["autoInstallSkills is disabled"], errors };
    }

    const embedded = await this.readEmbeddedSkill(extensionUri);
    const embeddedHash = this.hash(embedded);
    const storedHash = context.globalState.get<string>(this.LAST_HASH_KEY);

    if (!options.force && storedHash === embeddedHash) {
      return { installed, skipped: ["no changes detected"], errors };
    }

    for (const target of GLOBAL_TARGETS) {
      try {
        const dir = target.getPath();
        const filePath = path.join(dir, target.fileName);
        const existing = await this.readInstalledSkill(filePath);

        if (existing && !options.force) {
          const existingHash = this.hash(existing);
          if (existingHash === embeddedHash) {
            skipped.push(`${target.label}: up to date`);
            continue;
          }
        }

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, embedded, "utf8");
        installed.push(`${target.label}: ${filePath}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`${target.label}: ${detail}`);
      }
    }

    const workspaceUri = this.getWorkspaceUri();
    if (workspaceUri) {
      for (const target of WORKSPACE_TARGETS) {
        try {
          const targetDir = path.join(workspaceUri.fsPath, target.dirName);
          if (!(await this.dirExists(targetDir))) {
            skipped.push(`${target.label}: directory not found (${target.dirName})`);
            continue;
          }

          const filePath = path.join(workspaceUri.fsPath, target.dirName, target.fileName);
          const existing = await this.readInstalledSkill(filePath);

          if (existing && !options.force) {
            const existingHash = this.hash(existing);
            if (existingHash === embeddedHash) {
              skipped.push(`${target.label}: up to date`);
              continue;
            }
          }

          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, embedded, "utf8");
          installed.push(`${target.label}: ${filePath}`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          errors.push(`${target.label}: ${detail}`);
        }
      }
    }

    if (installed.length > 0) {
      await context.globalState.update(this.LAST_HASH_KEY, embeddedHash);
    }

    return { installed, skipped, errors };
  }

  static async uninstallAll(): Promise<{ removed: string[]; errors: string[] }> {
    const removed: string[] = [];
    const errors: string[] = [];

    for (const target of GLOBAL_TARGETS) {
      try {
        const filePath = path.join(target.getPath(), target.fileName);
        if (await this.fileExists(filePath)) {
          await fs.unlink(filePath);
          removed.push(`${target.label}: ${filePath}`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`${target.label}: ${detail}`);
      }
    }

    return { removed, errors };
  }
}
