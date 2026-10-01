"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const skillPath = path.join(root, "SKILL.md");
const blocks = [...fs.readFileSync(skillPath, "utf8").matchAll(/```javascript\n([\s\S]*?)\n```/g)];
assert.equal(blocks.length, 1, "the installed skill must contain one self-contained write recipe");

function loadRecipe(fsOverride = fsp) {
  const loaded = new Module(skillPath, module);
  loaded.filename = skillPath;
  loaded.paths = Module._nodeModulePaths(root);
  loaded.require = (specifier) => specifier === "fs/promises" ? fsOverride : require(specifier);
  loaded._compile(`${blocks[0][1]}\nmodule.exports = { withBoardWrite, readSnapshot, writeJson, newId };`, skillPath);
  return loaded.exports;
}

const backendPath = path.join(root, "src/providers/BoardLock.ts");
const backend = new Module(backendPath, module);
backend.filename = backendPath;
backend.paths = Module._nodeModulePaths(path.dirname(backendPath));
backend._compile(ts.transpileModule(fs.readFileSync(backendPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, backendPath);
const { withBoardLock } = backend.exports;
const recipe = loadRecipe();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
};

async function run() {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-agent-skill-regression-"));
  const workspace = path.join(fixture, "workspace");
  const alias = path.join(fixture, "alias");
  await fsp.mkdir(workspace);
  await fsp.symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
  const stat = await fsp.stat(workspace, { bigint: true });
  const key = stat.ino !== 0n ? `file:directory:${stat.dev}:${stat.ino}` : `file::${process.platform === "win32" ? workspace.toLowerCase() : workspace}`;
  const lock = path.join(os.tmpdir(), `lynvo-board-${crypto.createHash("sha256").update(key).digest("hex")}.lock`);
  const owner = path.join(lock, "owner.json");
  try {
    // Both writers must share the actual backend lock, including workspace aliases.
    let entered = deferred();
    let release = deferred();
    let backendEntered = false;
    const agentWrite = recipe.withBoardWrite(alias, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const nativeWrite = withBoardLock(`file::${workspace}`, async () => { backendEntered = true; });
    try {
      await delay(60);
      assert.equal(backendEntered, false, "native writes wait for an agent using an alias");
    } finally {
      release.resolve();
      await Promise.all([agentWrite, nativeWrite]);
    }
    assert.equal(backendEntered, true);
    assert.equal(fs.existsSync(lock), false);

    entered = deferred();
    release = deferred();
    const nativeHold = withBoardLock(`file::${alias}`, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const existingOwner = await fsp.readFile(owner, "utf8");
    try {
      await assert.rejects(recipe.withBoardWrite(workspace, () => assert.fail("busy callback ran"), 60), /board is busy/);
      assert.equal(await fsp.readFile(owner, "utf8"), existingOwner, "timeouts preserve another writer's ownership");
    } finally {
      release.resolve();
      await nativeHold;
    }
    await assert.rejects(recipe.withBoardWrite(workspace, () => { throw new Error("operation failed"); }), /operation failed/);
    assert.equal(fs.existsSync(lock), false, "exceptions release the owned lock");

    // A lock transferred to a different owner must survive the original writer's cleanup.
    await recipe.withBoardWrite(workspace, async () => {
      await fsp.writeFile(owner, JSON.stringify({ pid: process.pid, token: "other-fixture-owner" }));
    });
    assert.equal(JSON.parse(await fsp.readFile(owner, "utf8")).token, "other-fixture-owner");
    await fsp.rm(lock, { recursive: true }); // Only this isolated fixture's simulated owner.

    const failedOwnerRecipe = loadRecipe({
      ...fsp,
      writeFile: async (file, ...args) => {
        if (file === owner) {
          await fsp.writeFile(owner, JSON.stringify({ pid: process.pid, token: "replacement-fixture-owner" }));
          const error = new Error("ownership changed");
          error.code = "EEXIST";
          throw error;
        }
        return fsp.writeFile(file, ...args);
      },
    });
    await assert.rejects(failedOwnerRecipe.withBoardWrite(workspace, () => assert.fail("failed owner callback ran")), /ownership changed/);
    assert.equal(JSON.parse(await fsp.readFile(owner, "utf8")).token, "replacement-fixture-owner");
    await fsp.rm(lock, { recursive: true });

    const file = path.join(workspace, "task.json");
    assert.equal(await recipe.readSnapshot(file), null);
    await recipe.withBoardWrite(workspace, async () => {
      assert.equal(await recipe.writeJson(file, { id: "task-one", title: "Original" }, null), true);
      const original = await recipe.readSnapshot(file);
      const before = await fsp.stat(file);
      assert.equal(await recipe.writeJson(file, { title: "Original", id: "task-one" }, original), false);
      assert.equal(await recipe.readSnapshot(file), original, "equivalent key order does not rewrite bytes");
      assert.equal((await fsp.stat(file)).mtimeMs, before.mtimeMs);
      await assert.rejects(recipe.writeJson(file, { title: "Replacement" }, null), /Changed externally/);
      await assert.rejects(recipe.writeJson(file, {}, undefined), /reviewed snapshot/);
      const changed = { id: "task-one", title: "Changed" };
      assert.equal(await recipe.writeJson(file, changed, original), true);
      await assert.rejects(recipe.writeJson(file, { title: "Stale" }, original), /Changed externally/);
      assert.deepEqual(JSON.parse(await recipe.readSnapshot(file)), changed);
    });

    const symlink = path.join(workspace, "task-link.json");
    await fsp.symlink(file, symlink, "file");
    await assert.rejects(recipe.readSnapshot(symlink), /Expected regular file/);
    await assert.rejects(recipe.writeJson(symlink, {}, null), /Expected regular file/);

    // Recheck after writing a temporary file catches a non-cooperating external editor.
    const raceFile = path.join(workspace, "race.json");
    await fsp.writeFile(raceFile, '{"title":"Reviewed"}\n');
    const reviewed = await recipe.readSnapshot(raceFile);
    const racingRecipe = loadRecipe({
      ...fsp,
      writeFile: async (destination, ...args) => {
        await fsp.writeFile(destination, ...args);
        if (destination.startsWith(`${raceFile}.lynvo-agent-`)) {
          await fsp.writeFile(raceFile, '{"title":"External edit"}\n');
        }
      },
    });
    await assert.rejects(racingRecipe.writeJson(raceFile, { title: "Agent edit" }, reviewed), /Changed externally/);
    assert.equal(JSON.parse(await fsp.readFile(raceFile, "utf8")).title, "External edit");

    // link() protects the final create race even after the second snapshot comparison.
    const newFile = path.join(workspace, "concurrent-create.json");
    const concurrentRecipe = loadRecipe({
      ...fsp,
      link: async (source, destination) => {
        await fsp.writeFile(destination, '{"title":"Other creation"}\n', { flag: "wx" });
        return fsp.link(source, destination);
      },
    });
    await assert.rejects(concurrentRecipe.writeJson(newFile, { title: "Agent creation" }, null), { code: "EEXIST" });
    assert.equal(JSON.parse(await fsp.readFile(newFile, "utf8")).title, "Other creation");

    const failedRecipe = loadRecipe({
      ...fsp,
      rename: async () => { const error = new Error("simulated write failure"); error.code = "EACCES"; throw error; },
    });
    const raw = await recipe.readSnapshot(file);
    await assert.rejects(failedRecipe.writeJson(file, { title: "Failed edit" }, raw), /simulated write failure/);
    assert.equal(await recipe.readSnapshot(file), raw);
    assert.equal((await fsp.readdir(workspace)).some((name) => name.endsWith(".tmp")), false, "failed writes clean temporary files");

    const ids = Array.from({ length: 1000 }, () => recipe.newId("check"));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^check-[a-z0-9]+-[a-f0-9]{8}$/.test(id) && Buffer.byteLength(id) <= 240));
    console.log("Lynvo installed agent skill write checks passed.");
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
    await fsp.rm(lock, { recursive: true, force: true }); // Unique fixture workspace; no live board.
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
