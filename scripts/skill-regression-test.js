"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const Module = require("node:module");
const ts = require("typescript");

const hash = (content) => crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
const sourcePath = path.resolve(__dirname, "../src/providers/SkillInstaller.ts");
const skill = (version) => `---\nname: lynvo\ndescription: Lynvo ${version}\n---\n\n# Lynvo ${version}\n`;
const stripBlock = (content) => content.replace(/\n<!-- lynvo:managed:start sha256=[a-f0-9]{16} -->\n[\s\S]*?\n<!-- lynvo:managed:end -->\n/, "");

const run = async () => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-skills-regression-"));
  const fakeHome = path.join(fixture, "home");
  const extension = path.join(fixture, "extension");
  let workspace = path.join(fixture, "project-a");
  let extraWorkspaces = [];
  const disabledProjects = new Set();
  let enabled = true;
  let failFile;
  let failedOnce = false;
  let raceFile;
  let racedOnce = false;
  const state = new Map();
  const context = { globalState: {
    get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
    update: async (key, value) => state.set(key, value),
  } };
  const vscode = {
    Uri: { joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts), scheme: "file" }) },
    workspace: {
      get workspaceFolders() { return [workspace, ...extraWorkspaces].map((value) => ({ uri: { path: value, fsPath: value, scheme: "file" } })); },
      getConfiguration: (_section, uri) => ({ get: () => enabled && !disabledProjects.has(uri?.fsPath) }),
      fs: { readFile: (uri) => fsp.readFile(uri.fsPath) },
    },
  };
  const fsMock = {
    ...fsp,
    mkdir: async (directory, options) => {
      await fsp.mkdir(directory, options);
      if (raceFile && !racedOnce && directory === path.dirname(raceFile)) {
        racedOnce = true;
        await fsp.writeFile(raceFile, "User edited during installation\n");
      }
    },
    writeFile: async (filename, ...args) => {
      if (failFile && !failedOnce && filename.startsWith(`${failFile}.lynvo-`)) {
        failedOnce = true;
        const error = new Error("simulated write denied");
        error.code = "EACCES";
        throw error;
      }
      return fsp.writeFile(filename, ...args);
    },
  };
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded.require = (specifier) => {
    if (specifier === "vscode") { return vscode; }
    if (specifier === "os") { return { ...os, homedir: () => fakeHome }; }
    if (specifier === "fs/promises") { return fsMock; }
    return require(specifier);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, sourcePath);
  const { SkillInstaller } = loaded.exports;
  const extensionUri = { fsPath: extension, scheme: "file" };
  const install = (options) => SkillInstaller.installAll(extensionUri, context, options);
  const globalClaude = path.join(fakeHome, ".claude/skills/lynvo/SKILL.md");
  const globalCline = path.join(fakeHome, ".clinerules/lynvo.md");
  const globalOpenCode = path.join(fakeHome, ".config/opencode/skills/lynvo/SKILL.md");
  const createProject = async (directory) => {
    for (const name of [".github", ".cursor", ".windsurf", ".agents", ".claude", ".opencode"]) {
      await fsp.mkdir(path.join(directory, name), { recursive: true });
    }
  };
  try {
    await fsp.mkdir(extension, { recursive: true });
    await fsp.writeFile(path.join(extension, "SKILL.md"), skill(1));
    await createProject(workspace);
    const copilot = path.join(workspace, ".github/copilot-instructions.md");
    const projectInstructions = "# Project instructions\n\nUse the existing architecture.\n";
    await fsp.writeFile(copilot, projectInstructions);
    const custom = path.join(workspace, ".agents/skills/lynvo/SKILL.md");
    await fsp.mkdir(path.dirname(custom), { recursive: true });
    await fsp.writeFile(custom, "# My custom Lynvo instructions\n");
    failFile = globalCline;
    let result = await install();
    assert.equal(result.errors.length, 1, "one failed destination must be reported");
    assert.equal(stripBlock(await fsp.readFile(copilot, "utf8")), projectInstructions);
    assert.equal(await fsp.readFile(custom, "utf8"), "# My custom Lynvo instructions\n");
    assert.ok((await fsp.readFile(globalClaude, "utf8")).startsWith("---\n"), "frontmatter stays first");

    state.set("skillHash", hash(skill(1))); // Old global flag must not hide failed/new destinations.
    result = await install();
    assert.equal(result.errors.length, 0);
    assert.ok(result.installed.some((entry) => entry.includes("Cline")), "retry a previously failed destination");
    assert.equal(result.installed.length, 1, "up-to-date files are not rewritten");
    assert.equal((await install()).installed.length, 0, "installation is idempotent");

    const suffix = "\n# Added project notes\nKeep this after the Lynvo block.\n";
    await fsp.appendFile(copilot, suffix);
    await fsp.writeFile(path.join(extension, "SKILL.md"), skill(2));
    await install();
    const upgraded = await fsp.readFile(copilot, "utf8");
    assert.ok(upgraded.includes("Lynvo 2"));
    assert.equal(stripBlock(upgraded), projectInstructions + suffix, "update preserves text before/after managed block");
    const modifiedGlobal = (await fsp.readFile(globalClaude, "utf8")).replace("# Lynvo 2", "# My customized workflow");
    const modifiedShared = upgraded.replace("# Lynvo 2", "# Customized shared Lynvo rules");
    await fsp.writeFile(globalClaude, modifiedGlobal);
    await fsp.writeFile(copilot, modifiedShared);
    await fsp.writeFile(path.join(extension, "SKILL.md"), skill(3));
    result = await install({ force: true });
    assert.equal(await fsp.readFile(globalClaude, "utf8"), modifiedGlobal, "force preserves dedicated user modifications");
    assert.equal(await fsp.readFile(copilot, "utf8"), modifiedShared, "force preserves modified shared block");
    assert.equal(await fsp.readFile(custom, "utf8"), "# My custom Lynvo instructions\n", "force preserves unowned files");
    assert.ok(result.skipped.some((entry) => entry.includes("preserving modified")));

    workspace = path.join(fixture, "project-b");
    await createProject(workspace);
    const secondCopilot = path.join(workspace, ".github/copilot-instructions.md");
    await fsp.writeFile(secondCopilot, projectInstructions);
    await install();
    assert.ok((await fsp.readFile(secondCopilot, "utf8")).includes("Lynvo 3"), "new workspace installs despite global hash");
    const legacy = path.join(workspace, ".opencode/skills/lynvo/SKILL.md");
    await fsp.writeFile(legacy, skill(1));
    await install();
    assert.ok((await fsp.readFile(legacy, "utf8")).includes("Lynvo 3"), "known old plain Lynvo skill upgrades");

    const legacyShared = path.join(workspace, ".cursor/rules.md");
    await fsp.writeFile(legacyShared, skill(1));
    await install();
    assert.equal(stripBlock(await fsp.readFile(legacyShared, "utf8")), "", "known old Lynvo-only shared file becomes one managed block");

    const secondRoot = path.join(fixture, "project-c");
    await createProject(secondRoot);
    const secondRootCopilot = path.join(secondRoot, ".github/copilot-instructions.md");
    await fsp.writeFile(secondRootCopilot, projectInstructions);
    extraWorkspaces = [secondRoot];
    disabledProjects.add(secondRoot);
    await install();
    assert.equal(await fsp.readFile(secondRootCopilot, "utf8"), projectInstructions, "a disabled folder in a multi-root workspace stays untouched");
    disabledProjects.delete(secondRoot);
    await install();
    assert.ok((await fsp.readFile(secondRootCopilot, "utf8")).includes("Lynvo 3"), "all enabled folders in a multi-root workspace are installed");
    assert.equal(stripBlock(await fsp.readFile(secondRootCopilot, "utf8")), projectInstructions);

    enabled = false;
    await fsp.writeFile(path.join(extension, "SKILL.md"), skill(4));
    assert.equal((await install()).installed.length, 0);
    await install({ force: true });
    assert.ok((await fsp.readFile(secondCopilot, "utf8")).includes("Lynvo 4"), "manual installation bypasses disabled setting safely");
    assert.equal(stripBlock(await fsp.readFile(secondCopilot, "utf8")), projectInstructions);

    // Detect edits made between reading a file and starting the write.
    enabled = true;
    raceFile = globalOpenCode;
    await fsp.writeFile(path.join(extension, "SKILL.md"), skill(5));
    result = await install();
    assert.ok(result.errors.some((entry) => entry.includes("changed during installation")));
    assert.equal(await fsp.readFile(raceFile, "utf8"), "User edited during installation\n");
    raceFile = undefined;

    // Symlinks to other instructions are never followed for writes or deletion.
    const link = path.join(workspace, ".windsurf/rules.md");
    await fsp.unlink(link);
    const external = path.join(fixture, "other-instructions.md");
    await fsp.writeFile(external, "Do not overwrite this target\n");
    await fsp.symlink(external, link);
    result = await install({ force: true });
    assert.ok(result.errors.some((entry) => entry.includes("symbolic link")));
    assert.equal(await fsp.readFile(external, "utf8"), "Do not overwrite this target\n");

    const removed = await SkillInstaller.uninstallAll(context);
    assert.ok(removed.removed.some((entry) => entry.includes("GitHub Copilot")));
    assert.equal(await fsp.readFile(secondCopilot, "utf8"), projectInstructions, "uninstall only removes owned block");
    assert.equal(await fsp.readFile(secondRootCopilot, "utf8"), projectInstructions, "uninstall preserves instructions in every workspace folder");
    assert.equal(await fsp.readFile(globalClaude, "utf8"), modifiedGlobal, "uninstall preserves modified dedicated skill");
    assert.equal(await fsp.readFile(globalOpenCode, "utf8"), "User edited during installation\n");
    assert.ok((await fsp.lstat(link)).isSymbolicLink());
    assert.equal(await fsp.readFile(external, "utf8"), "Do not overwrite this target\n");
    await assert.rejects(fsp.readFile(globalCline), { code: "ENOENT" }, "uninstall deletes owned dedicated skill");
    // Return to the first project to check modified shared blocks remain untouched.
    workspace = path.join(fixture, "project-a");
    extraWorkspaces = [];
    await SkillInstaller.uninstallAll(context);
    assert.equal(await fsp.readFile(copilot, "utf8"), modifiedShared);
    assert.equal(await fsp.readFile(custom, "utf8"), "# My custom Lynvo instructions\n");
    await testLockAliases(fixture);
    console.log("Lynvo skill installer regression checks passed.");
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
};

const testLockAliases = async (fixture) => {
  const directory = path.join(fixture, "alias-locks");
  const workspace = path.join(fixture, "physical-workspace");
  const alias = path.join(fixture, "workspace-alias");
  await fsp.mkdir(directory); await fsp.mkdir(workspace);
  await fsp.symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
  const filename = path.resolve(__dirname, "../src/providers/BoardLock.ts");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (specifier) => specifier === "os" ? { ...os, tmpdir: () => directory } : require(specifier);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  const { withBoardLock } = loaded.exports;
  const aliases = [`file::${alias}`, `file:localhost:${workspace}`, `file::${path.join(workspace, ".")}${path.sep}`];
  const caseAlias = path.join(fixture, "PHYSICAL-WORKSPACE");
  if (await fsp.stat(caseAlias).catch(() => undefined)) { aliases.push(`file::${caseAlias}`); }
  for (const key of aliases) {
    let release;
    let started;
    const held = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { started = resolve; });
    const first = withBoardLock(`file::${workspace}`, async () => { started(); await held; });
    await entered;
    let secondEntered = false;
    const second = withBoardLock(key, async () => { secondEntered = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(secondEntered, false, `workspace aliases must share a lock: ${key}`);
    } finally { release(); }
    await Promise.all([first, second]);
    assert.equal(secondEntered, true);
    assert.deepEqual(await fsp.readdir(directory), [], "alias locks leave no files behind");
  }
};

run().catch((error) => { console.error(error); process.exitCode = 1; });
