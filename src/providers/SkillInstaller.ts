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
  shared?: boolean;
};

const WORKSPACE_TARGETS: WorkspaceTarget[] = [
  {
    label: "Cursor",
    dirName: ".cursor",
    fileName: "rules.md",
    priority: "secondary",
    shared: true,
  },
  {
    label: "Windsurf",
    dirName: ".windsurf",
    fileName: "rules.md",
    priority: "secondary",
    shared: true,
  },
  {
    label: "GitHub Copilot",
    dirName: ".github",
    fileName: "copilot-instructions.md",
    priority: "tertiary",
    shared: true,
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
  private static readonly TARGET_HASHES_KEY = "skillTargetHashes";
  private static readonly BLOCK_END = "<!-- lynvo:managed:end -->";

  private static getWorkspaceUris(): vscode.Uri[] {
    return (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri);
  }

  private static getConfig(uri?: vscode.Uri): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("lynvo", uri);
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

  private static async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  private static async readInstalledSkill(filePath: string): Promise<string | null> {
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error("Preserving symbolic link; install into a regular file instead");
      }
      return await fs.readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  // Dedicated SKILL.md files keep their YAML frontmatter at the beginning.
  private static dedicatedContent(embedded: string): string {
    return `${embedded}\n<!-- lynvo:managed sha256=${this.hash(embedded)} -->\n`;
  }

  private static sharedContent(embedded: string): string {
    return `\n<!-- lynvo:managed:start sha256=${this.hash(embedded)} -->\n${embedded}\n${this.BLOCK_END}\n`;
  }

  private static dedicatedBody(content: string): string | undefined {
    const marker = /\n<!-- lynvo:managed sha256=([a-f0-9]{16}) -->\n$/.exec(content);
    if (!marker) {
      return undefined;
    }
    const body = content.slice(0, marker.index);
    return this.hash(body) === marker[1] ? body : undefined;
  }

  private static sharedBlock(content: string): { start: number; end: number; body: string } | undefined {
    const marker = /\n<!-- lynvo:managed:start sha256=([a-f0-9]{16}) -->\n/.exec(content);
    if (!marker) {
      return undefined;
    }
    const bodyStart = marker.index + marker[0].length;
    const endMarker = `\n${this.BLOCK_END}\n`;
    const bodyEnd = content.indexOf(endMarker, bodyStart);
    if (bodyEnd < 0 || content.indexOf("<!-- lynvo:managed:start", bodyStart) >= 0) {
      return undefined;
    }
    const body = content.slice(bodyStart, bodyEnd);
    if (this.hash(body) !== marker[1]) {
      return undefined;
    }
    return { start: marker.index, end: bodyEnd + endMarker.length, body };
  }

  private static async writeInstalledSkill(filePath: string, content: string, expected: string | null): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (await this.readInstalledSkill(filePath) !== expected) {
      throw new Error("Instructions changed during installation; preserving the current file");
    }
    const temporary = `${filePath}.lynvo-${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
      if (await this.readInstalledSkill(filePath) !== expected) {
        throw new Error("Instructions changed during installation; preserving the current file");
      }
      if (expected === null) {
        // link() does not replace a file that another process created meanwhile.
        await fs.link(temporary, filePath);
      } else {
        await fs.rename(temporary, filePath);
      }
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
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
    const legacyHash = context.globalState.get<string>(this.LAST_HASH_KEY);
    const targetHashes = { ...context.globalState.get<Record<string, string>>(this.TARGET_HASHES_KEY, {}) };
    const targets = GLOBAL_TARGETS.map((target) => ({
      label: target.label, filePath: path.join(target.getPath(), target.fileName), shared: false,
    }));
    for (const workspaceUri of this.getWorkspaceUris()) {
      if (workspaceUri.scheme !== "file") {
        skipped.push(`Project skills: only local file workspaces are supported (${workspaceUri.path})`);
        continue;
      }
      if (!options.force && !this.getConfig(workspaceUri).get<boolean>(this.SETTING_KEY, true)) {
        skipped.push(`Project skills: autoInstallSkills is disabled (${workspaceUri.fsPath})`);
        continue;
      }
      for (const target of WORKSPACE_TARGETS) {
        try {
          const targetDir = path.join(workspaceUri.fsPath, target.dirName);
          if (!(await this.dirExists(targetDir))) {
            skipped.push(`${target.label}: directory not found (${target.dirName})`);
            continue;
          }

          targets.push({
            label: target.label,
            filePath: path.join(targetDir, target.fileName),
            shared: target.shared ?? false,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          errors.push(`${target.label}: ${detail}`);
        }
      }
    }

    // Inspect every destination on each activation: new workspaces and failed
    // destinations must not be hidden behind one global version/hash flag.
    for (const target of targets) {
      try {
        const existing = await this.readInstalledSkill(target.filePath);
        const plainOwned = existing !== null && [embeddedHash, legacyHash, targetHashes[target.filePath]]
          .some((known) => known !== undefined && this.hash(existing) === known);
        let next: string;
        if (target.shared) {
          const block = existing === null ? undefined : this.sharedBlock(existing);
          if (block) {
            next = existing!.slice(0, block.start) + this.sharedContent(embedded) + existing!.slice(block.end);
          } else if (existing?.includes("<!-- lynvo:managed")) {
            skipped.push(`${target.label}: preserving modified Lynvo instructions`);
            continue;
          } else {
            // Migrate a verified legacy Lynvo-only file. Any project text is retained.
            next = (plainOwned ? "" : existing ?? "") + this.sharedContent(embedded);
          }
        } else {
          if (existing !== null && this.dedicatedBody(existing) === undefined && !plainOwned) {
            skipped.push(`${target.label}: preserving existing custom instructions`);
            continue;
          }
          next = this.dedicatedContent(embedded);
        }
        if (existing === next) {
          skipped.push(`${target.label}: up to date`);
        } else {
          await this.writeInstalledSkill(target.filePath, next, existing);
          installed.push(`${target.label}: ${target.filePath}`);
        }
        targetHashes[target.filePath] = embeddedHash;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`${target.label}: ${detail}`);
      }
    }
    await context.globalState.update(this.TARGET_HASHES_KEY, targetHashes);

    return { installed, skipped, errors };
  }

  static async uninstallAll(context?: vscode.ExtensionContext): Promise<{ removed: string[]; errors: string[] }> {
    const removed: string[] = [];
    const errors: string[] = [];

    const targets = GLOBAL_TARGETS.map((target) => ({
      label: target.label, filePath: path.join(target.getPath(), target.fileName), shared: false,
    }));
    for (const workspaceUri of this.getWorkspaceUris()) {
      if (workspaceUri.scheme !== "file") {continue;}
      targets.push(...WORKSPACE_TARGETS.map((target) => ({
        label: target.label, filePath: path.join(workspaceUri.fsPath, target.dirName, target.fileName), shared: target.shared ?? false,
      })));
    }
    const knownHashes = context?.globalState.get<Record<string, string>>(this.TARGET_HASHES_KEY, {}) ?? {};
    const legacyHash = context?.globalState.get<string>(this.LAST_HASH_KEY);
    for (const target of targets) {
      try {
        const existing = await this.readInstalledSkill(target.filePath);
        if (existing === null) {
          continue;
        }
        const block = target.shared ? this.sharedBlock(existing) : undefined;
        const plainOwned = [knownHashes[target.filePath], legacyHash].some((known) =>
          known !== undefined && this.hash(existing) === known,
        );
        const dedicatedOwned = this.dedicatedBody(existing) !== undefined;
        if (block) {
          const rest = existing.slice(0, block.start) + existing.slice(block.end);
          await this.writeInstalledSkill(target.filePath, rest, existing);
        } else if (plainOwned || (!target.shared && dedicatedOwned)) {
          if (await this.readInstalledSkill(target.filePath) !== existing) {
            throw new Error("Instructions changed during uninstall; preserving the current file");
          }
          await fs.unlink(target.filePath);
        } else {
          continue;
        }
        removed.push(`${target.label}: ${target.filePath}`);
        delete knownHashes[target.filePath];
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`${target.label}: ${detail}`);
      }
    }
    if (context) {
      await context.globalState.update(this.TARGET_HASHES_KEY, knownHashes);
    }

    return { removed, errors };
  }
}
