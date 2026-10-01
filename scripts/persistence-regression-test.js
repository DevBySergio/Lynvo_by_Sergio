"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const Module = require("node:module");
const childProcess = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const actor = { githubId: "qa", username: "QA" };
const task = (id, status = "todo", position = 0) => ({
  id, title: id, description: "Original description", status, position,
  createdAt: 1, updatedAt: 2, createdBy: actor, lastModifiedBy: actor,
  labelIds: ["bug"], priority: "medium", checklist: [], relations: [],
});
const board = () => ({
  version: "2.0.0",
  columns: Object.fromEntries(["todo", "work", "done"].map((id, position) => [id, { id, title: id, color: "#58a6ff", position }])),
  labels: { bug: { id: "bug", name: "Bug", color: "#ff0000" }, feat: { id: "feat", name: "Feature", color: "#00ff00" } },
  tasks: { "task-a": task("task-a", "work"), "task-b": task("task-b", "todo", 1), "task-c": task("task-c", "work", 2) },
  activity: {}, users: {}, tombstones: {}, conflicts: {},
  sync: { branch: "lynvo-sync", status: "synced", pendingChanges: false, lastSyncAt: 1, lastRemoteCommit: "old-commit", updatedAt: 1 },
});
const conflict = (id, entityType, entityId, field, localValue, remoteValue) => ({
  id, entityType, entityId, field, localValue, remoteValue, createdAt: 3, resolved: false,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const loadSource = (relative, mocks, cache = new Map()) => {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) { return cache.get(filename).exports; }
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);
  mod.require = (specifier) => {
    if (specifier === "vscode") { return mocks.vscode; }
    if (specifier === "os") { return { ...os, tmpdir: () => mocks.tmp }; }
    if (specifier === "./AuthProvider") { return { AuthProvider: { getGitHubUser: mocks.auth } }; }
    if (specifier.startsWith(".")) {
      const nested = path.resolve(path.dirname(filename), specifier) + ".ts";
      if (fs.existsSync(nested)) { return loadSource(nested, mocks, cache); }
    }
    return require(specifier);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
};

const files = async (directory) => {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, data] of Object.entries(await files(filename))) { result[path.join(entry.name, name)] = data; }
    } else { result[entry.name] = await fsp.readFile(filename, "utf8"); }
  }
  return result;
};
const withoutCorruptBackups = (snapshot) => Object.fromEntries(Object.entries(snapshot).filter(([name]) => !name.includes(".corrupt-")));

const run = async () => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-persistence-regression-"));
  const lockDirectory = path.join(fixture, "locks");
  await fsp.mkdir(lockDirectory);
  let sequence = 0;
  let holdAuth;
  let renameHook;
  const writes = [];
  const notices = [];
  class Uri {
    constructor(value) { this.path = value; this.fsPath = value; this.scheme = "file"; this.authority = ""; }
    static joinPath(uri, ...parts) { return new Uri(path.join(uri.path, ...parts)); }
    with(change) { return new Uri(change.path || this.path); }
    toString() { return `file://${this.path}`; }
  }
  const folders = [];
  const vscode = {
    Uri, FileType: { File: 1, Directory: 2 },
    window: { showWarningMessage: (message) => notices.push(message) },
    workspace: {
      get workspaceFolders() { return folders.map((uri) => ({ uri })); },
      fs: {
        stat: (uri) => fsp.stat(uri.path), readFile: (uri) => fsp.readFile(uri.path),
        writeFile: (uri, data) => fsp.writeFile(uri.path, data),
        rename: async (from, to) => {
          if (renameHook) { await renameHook(from, to); }
          writes.push(to.path);
          await fsp.rename(from.path, to.path);
        },
        createDirectory: (uri) => fsp.mkdir(uri.path, { recursive: true }),
        delete: (uri) => fsp.rm(uri.path, { recursive: true }),
        readDirectory: async (uri) => (await fsp.readdir(uri.path, { withFileTypes: true })).map((entry) => [entry.name, entry.isFile() ? 1 : 2]),
      },
    },
  };
  const mocks = { vscode, tmp: lockDirectory, auth: async () => {
    if (holdAuth) { await holdAuth(); }
    return actor;
  } };
  const { DataManager } = loadSource("src/providers/DataManager.ts", mocks);
  const { normalizeBoard } = loadSource("src/boardValidation.ts", mocks);
  const fresh = async (initial = board()) => {
    const uri = new Uri(path.join(fixture, `project-${++sequence}`));
    await fsp.mkdir(uri.path);
    folders.push(uri);
    DataManager.setWorkspaceUri(uri);
    await DataManager.saveBoard(initial);
    return uri;
  };
  const boardPath = (uri, relative) => path.join(uri.path, ".vscode/lynvo", relative);
  const readJson = async (filename) => JSON.parse(await fsp.readFile(filename, "utf8"));
  try {
    // Every unreadable modular board remains authoritative over a stale legacy copy.
    for (const [name, content] of [
      ["board.json", "{"], ["columns.json", "{"], ["tasks/task-a.json", "{"],
      ["metadata/tombstones.json", "{"], ["metadata/conflicts.json", "{"],
      ["columns.json", "null"], ["metadata/tombstones.json", "null"], ["metadata/conflicts.json", "null"],
      ["metadata/version.json", "{"], ["metadata/version.json", "null"],
      ["metadata/version.json", JSON.stringify({ schemaVersion: "3.0.0" })],
      ["board.json", JSON.stringify({ version: "2.0.0", labels: null })],
      ["tasks/task-a.json", JSON.stringify({ ...task("task-a"), title: { malformed: true } })],
      ["tasks/task-a.json", JSON.stringify({ ...task("task-a"), checklist: {} })],
      ["tasks/task-a.json", JSON.stringify({ ...task("task-a"), checklist: [{ id: "item", text: { malformed: true } }] })],
      ["tasks/task-a.json", JSON.stringify({ ...task("task-a"), checklist: [{ id: "item", text: "Todo", done: "true" }] })],
      ["tasks/task-a.json", JSON.stringify({ ...task("task-a"), status: { malformed: true } })],
    ]) {
      const uri = await fresh();
      const legacy = { ...board(), tasks: { old: task("old") } };
      await fsp.writeFile(path.join(uri.path, ".vscode/lynvo.json"), JSON.stringify(legacy));
      await fsp.writeFile(boardPath(uri, name), content);
      const before = await files(uri.path);
      await assert.rejects(DataManager.loadBoard(), undefined, `corrupt ${name} must fail loading`);
      await assert.rejects(DataManager.initializeBoard(), undefined, `corrupt ${name} must not initialize defaults`);
      await assert.rejects(DataManager.createTask("New task", ""), undefined, `corrupt ${name} must block mutations`);
      assert.deepEqual(withoutCorruptBackups(await files(uri.path)), before, `corrupt ${name} must not delete, replace, or migrate data`);
    }
    for (const required of ["board.json", "columns.json"]) {
      const uri = await fresh();
      await fsp.writeFile(path.join(uri.path, ".vscode/lynvo.json"), JSON.stringify(board()));
      await fsp.unlink(boardPath(uri, required));
      const before = await files(uri.path);
      await assert.rejects(DataManager.initializeBoard(), /Incomplete/);
      assert.deepEqual(await files(uri.path), before, "incomplete board must not fall back to legacy");
    }

    // A task that cannot be parsed is not skipped and later removed by a save.
    let uri = await fresh();
    await fsp.writeFile(boardPath(uri, "tasks/not-a-valid-task.json"), "[]");
    let before = await files(uri.path);
    await assert.rejects(DataManager.updateSyncMetadata({ status: "pending" }));
    assert.deepEqual(await files(uri.path), before);

    // JSON symlinks cannot silently disappear from a board during a save/sync.
    for (const folder of ["tasks", "activity"]) {
      uri = await fresh();
      const outsideFile = path.join(fixture, `outside-${folder}.json`);
      await fsp.writeFile(outsideFile, JSON.stringify(task("linked")));
      const link = boardPath(uri, `${folder}/linked.json`);
      await fsp.symlink(outsideFile, link);
      before = await files(uri.path);
      await assert.rejects(DataManager.createTask("Must not save", ""), /regular JSON file/);
      assert.deepEqual(await files(uri.path), before);
      assert.ok((await fsp.lstat(link)).isSymbolicLink());
    }

    // Validate IDs before any write; no traversal or case-insensitive file collision.
    uri = await fresh();
    before = await files(uri.path);
    for (const id of ["../escaped", "../../outside", "slash/name", "back\\name", "__proto__", "CON", "trailing.", "\ud800", "\ud801"]) {
      const invalid = board();
      invalid.tasks = Object.fromEntries([[id, task(id)]]);
      await assert.rejects(DataManager.saveBoard(invalid), undefined, `reject unsafe ID ${id}`);
      assert.deepEqual(await files(uri.path), before);
    }
    const collision = board();
    collision.tasks = { Mixed: task("Mixed"), mixed: task("mixed") };
    await assert.rejects(DataManager.saveBoard(collision), undefined, "IDs must not collide on Windows/macOS filesystems");
    assert.deepEqual(await files(uri.path), before);
    assert.ok(!fs.existsSync(path.join(uri.path, ".vscode/escaped.json")));
    const unicode = board();
    unicode.tasks = { "tarea-á-🚀": task("tarea-á-🚀") };
    await fresh(unicode);
    assert.equal((await DataManager.loadBoard()).tasks["tarea-á-🚀"].title, "tarea-á-🚀");

    // Equivalent accent spellings preserve the physical task/activity filenames.
    const accented = board(); accented.tasks = { "café": task("café") };
    accented.activity = { "evento-é": { id: "evento-é", type: "task_created", message: "History", actor, createdAt: 1 } };
    uri = await fresh(accented);
    await fsp.rename(boardPath(uri, "tasks/café.json"), boardPath(uri, "tasks/café.json".normalize("NFD")));
    await fsp.rename(boardPath(uri, "activity/evento-é.json"), boardPath(uri, "activity/evento-é.json".normalize("NFD")));
    const taskNames = await fsp.readdir(boardPath(uri, "tasks"));
    const activityNames = await fsp.readdir(boardPath(uri, "activity"));
    await DataManager.editTask("café", "Preserved accent filename", "");
    assert.deepEqual(await fsp.readdir(boardPath(uri, "tasks")), taskNames);
    assert.ok((await fsp.readdir(boardPath(uri, "activity"))).includes(activityNames[0]));
    assert.equal((await DataManager.loadBoard()).tasks["café"].title, "Preserved accent filename");
    for (const [folder, id, value] of [
      ["tasks", "café", accented.tasks["café"]],
      ["activity", "evento-é", accented.activity["evento-é"]],
    ]) {
      uri = await fresh(accented);
      const duplicate = boardPath(uri, `${folder}/${id.normalize("NFD")}.json`);
      let created = false;
      try { await fsp.writeFile(duplicate, JSON.stringify(value), { flag: "wx" }); created = true; }
      catch (error) { if (error.code !== "EEXIST") { throw error; } }
      // Insensitive filesystems already reject the second equivalent filename.
      if (created) {
        before = await files(uri.path);
        await assert.rejects(DataManager.loadBoard(), /Invalid (task|activity) file/);
        assert.deepEqual(await files(uri.path), before);
      }
    }

    // Stable files/settings keep their exact contents and schema during updates.
    uri = await fresh();
    const settings = '{ "customSettings": { "retain": true } }\n';
    await fsp.writeFile(boardPath(uri, "settings.json"), settings);
    const loaded = await DataManager.loadBoard();
    const writeStart = writes.length;
    before = await files(uri.path);
    await DataManager.saveBoard(loaded);
    assert.equal(writes.length, writeStart, "saving identical normalized content does not rewrite files");
    assert.deepEqual(await files(uri.path), before);
    await DataManager.editTask("task-a", "Edited title", loaded.tasks["task-a"].description);
    assert.equal(await fsp.readFile(boardPath(uri, "settings.json"), "utf8"), settings);
    assert.equal(await fsp.readFile(boardPath(uri, "tasks/task-b.json"), "utf8"), before[".vscode/lynvo/tasks/task-b.json"]);
    assert.deepEqual(await readJson(boardPath(uri, "metadata/version.json")), { schemaVersion: "2.0.0" });
    assert.ok(!fs.existsSync(path.join(uri.path, ".vscode/lynvo.json")));
    assert.deepEqual(Object.keys(await files(uri.path)).sort().filter((name) => !name.includes("activity/")),
      Object.keys(before).sort().filter((name) => !name.includes("activity/")), "normal updates keep the persistence paths");

    {
      // An external agent can update other task files while a mutation awaits auth.
      uri = await fresh();
      let authStarted = deferred(); let authReleased = deferred();
      holdAuth = async () => { authStarted.resolve(); await authReleased.promise; };
      let mutation = DataManager.editTask("task-a", "Extension edit", "");
      await authStarted.promise;
      const external = { ...task("task-b"), title: "External edit", updatedAt: 42 };
      const externalRaw = JSON.stringify(external);
      await fsp.writeFile(boardPath(uri, "tasks/task-b.json"), externalRaw);
      const addedRaw = JSON.stringify(task("new-external-task"));
      await fsp.writeFile(boardPath(uri, "tasks/new-external-task.json"), addedRaw);
      authReleased.resolve(); await mutation; holdAuth = undefined;
      assert.equal(await fsp.readFile(boardPath(uri, "tasks/task-b.json"), "utf8"), externalRaw);
      assert.equal(await fsp.readFile(boardPath(uri, "tasks/new-external-task.json"), "utf8"), addedRaw);
      assert.equal((await DataManager.loadBoard()).tasks["task-a"].title, "Extension edit");

      // A competing edit to the same file aborts instead of overwriting that edit.
      uri = await fresh();
      authStarted = deferred(); authReleased = deferred();
      holdAuth = async () => { authStarted.resolve(); await authReleased.promise; };
      mutation = DataManager.editTask("task-a", "Stale extension edit", "");
      await authStarted.promise;
      const competingRaw = JSON.stringify({ ...task("task-a", "work"), title: "Newest external edit", updatedAt: 99 });
      await fsp.writeFile(boardPath(uri, "tasks/task-a.json"), competingRaw);
      authReleased.resolve();
      await assert.rejects(mutation, /changed while saving/); holdAuth = undefined;
      assert.equal(await fsp.readFile(boardPath(uri, "tasks/task-a.json"), "utf8"), competingRaw);
      assert.ok(!Object.keys(await files(uri.path)).some((name) => name.endsWith(".tmp")));

      // Large boards write only the edited task, pending metadata and one event.
      const large = board();
      large.tasks = Object.fromEntries(Array.from({ length: 1200 }, (_, index) => {
        const id = `large-task-${index}`; return [id, task(id)];
      }));
      uri = await fresh(large);
      const largeWriteStart = writes.length;
      await DataManager.editTask("large-task-657", "Edited on a large board", "");
      const largeWrites = writes.slice(largeWriteStart);
      assert.equal(largeWrites.filter((name) => name.includes("/tasks/")).length, 1);
      assert.ok(largeWrites.length <= 3, "editing one task must not rewrite the whole board");
      assert.equal(Object.keys((await DataManager.loadBoard()).tasks).length, 1200);
    }

    // Column deletion tracks every deleted task and cleans links on surviving tasks.
    let initial = board();
    initial.tasks["task-b"].relations = [{ id: "rel-a", type: "related", targetTaskId: "task-a", createdAt: 1 }];
    uri = await fresh(initial);
    await DataManager.deleteColumn("work");
    let result = await DataManager.loadBoard();
    assert.ok(!result.columns.work && !result.tasks["task-a"] && !result.tasks["task-c"]);
    for (const id of ["column-work", "task-task-a", "task-task-c"]) { assert.ok(result.tombstones[id]); }
    assert.deepEqual(result.tasks["task-b"].relations, []);
    assert.ok(result.tasks["task-b"].updatedAt > 2);
    assert.deepEqual(result.tasks["task-b"].lastModifiedBy, actor);

    // Reorders and reference/label cleanup update every changed task timestamp.
    uri = await fresh();
    await DataManager.reorderTasks([
      { id: "task-a", status: "todo", position: 10, isDraggedTask: true },
      { id: "task-b", status: "todo", position: 20 },
    ]);
    result = await DataManager.loadBoard();
    assert.ok(result.tasks["task-a"].updatedAt > 2 && result.tasks["task-b"].updatedAt > 2);
    assert.equal(result.tasks["task-c"].updatedAt, 2);
    await DataManager.deleteLabel("bug");
    result = await DataManager.loadBoard();
    assert.ok(Object.values(result.tasks).every((item) => item.updatedAt > 2 && !item.labelIds.includes("bug")));
    const longId = "t".repeat(240);
    initial = board(); initial.tasks[longId] = task(longId);
    uri = await fresh(initial);
    await DataManager.deleteTask(longId);
    result = await DataManager.loadBoard();
    assert.ok(result.tombstones[`task-${longId}`], "valid long task IDs can still be deleted");

    // Stale editors reject the whole draft, including checklist/relations.
    uri = await fresh();
    before = await files(uri.path);
    await assert.rejects(DataManager.editTask("task-a", "Unseen overwrite", "", [], "high", undefined, {
      expectedUpdatedAt: 1, checklist: [{ id: "check-draft", text: "Draft", done: false, createdAt: 1, updatedAt: 1 }],
    }), /changed while/);
    assert.deepEqual(await files(uri.path), before);
    await assert.rejects(DataManager.editTask("task-a", "Bad linked draft", "", [], "high", undefined, {
      expectedUpdatedAt: 2, relations: [{ id: "bad-link", type: "related", targetTaskId: "gone", createdAt: 1 }],
    }), /linked task no longer exists/);
    assert.deepEqual(await files(uri.path), before);

    // Bulk resolution validates all snapshots/values before persisting anything.
    initial = board();
    initial.conflicts = {
      title: conflict("title", "task", "task-a", "title", "task-a", "Remote title"),
      checklist: conflict("checklist", "task", "task-a", "checklist", [], [{ id: "check-remote", text: "Remote item", done: true, createdAt: 1, updatedAt: 3 }]),
      relations: conflict("relations", "task", "task-a", "relations", [], [{ id: "rel-remote", type: "blocks", targetTaskId: "task-b", createdAt: 3 }]),
      column: conflict("column", "column", "work", "title", "work", "Remote work"),
      label: conflict("label", "label", "bug", "color", "#ff0000", "#123456"),
    };
    initial.sync.status = "conflict";
    uri = await fresh(initial);
    const displayed = (await DataManager.loadBoard()).conflicts;
    const stale = structuredClone(displayed); stale.label.remoteValue = "#different";
    before = await files(uri.path);
    await assert.rejects(DataManager.resolveConflicts(Object.keys(displayed), "remote", stale), /conflicts changed/);
    assert.deepEqual(await files(uri.path), before, "one stale conflict cancels the full bulk resolution");
    await DataManager.resolveConflict("title", "local", displayed.title);
    result = await DataManager.loadBoard();
    assert.equal(result.tasks["task-a"].title, "task-a");
    assert.equal(result.sync.status, "conflict"); assert.equal(result.sync.pendingChanges, true);
    const rest = result.conflicts;
    await DataManager.resolveConflicts(["checklist", "relations", "column", "label"], "remote", rest);
    result = await DataManager.loadBoard();
    assert.deepEqual(result.tasks["task-a"].checklist, initial.conflicts.checklist.remoteValue);
    assert.deepEqual(result.tasks["task-a"].relations, initial.conflicts.relations.remoteValue);
    assert.equal(result.columns.work.title, "Remote work"); assert.equal(result.labels.bug.color, "#123456");
    assert.equal(result.sync.status, "pending");
    assert.ok(Object.values(result.conflicts).every((item) => item.resolved));

    // Even an invalid later remote value must not persist earlier resolved fields.
    initial = board();
    initial.conflicts = {
      title: conflict("title", "task", "task-a", "title", "task-a", "Remote title"),
      checklist: conflict("checklist", "task", "task-a", "checklist", [], { invalid: "not-an-array" }),
    };
    uri = await fresh(initial);
    before = await files(uri.path);
    await assert.rejects(DataManager.resolveConflicts(["title", "checklist"], "remote"), /Invalid/);
    assert.deepEqual(await files(uri.path), before);

    // Queue operations capture the intended workspace before the active one changes.
    const first = await fresh();
    const second = await fresh();
    DataManager.setWorkspaceUri(first);
    const authStarted = deferred(); const authReleased = deferred();
    let held = false;
    holdAuth = async () => { if (!held) { held = true; authStarted.resolve(); await authReleased.promise; } };
    const editFirst = DataManager.editTask("task-a", "First workspace", "");
    await authStarted.promise;
    DataManager.setWorkspaceUri(second);
    const editSecond = DataManager.editTask("task-a", "Second workspace", "");
    DataManager.setWorkspaceUri(first);
    authReleased.resolve();
    await Promise.all([editFirst, editSecond]);
    holdAuth = undefined;
    assert.equal((await readJson(boardPath(first, "tasks/task-a.json"))).title, "First workspace");
    assert.equal((await readJson(boardPath(second, "tasks/task-a.json"))).title, "Second workspace");

    // Reads wait for writes, including a save paused before the task-file rename.
    DataManager.setWorkspaceUri(first);
    const renameStarted = deferred(); const renameReleased = deferred();
    let paused = false;
    renameHook = async (_from, to) => {
      if (!paused && to.path.endsWith("tasks/task-a.json")) { paused = true; renameStarted.resolve(); await renameReleased.promise; }
    };
    const saving = DataManager.editTask("task-a", "Completed save", "");
    await renameStarted.promise;
    let readFinished = false;
    const reading = DataManager.loadBoard().then((value) => { readFinished = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(readFinished, false);
    renameReleased.resolve();
    await saving; result = await reading; renameHook = undefined;
    assert.equal(result.tasks["task-a"].title, "Completed save");

    // Finish metadata must not report edits made during push as already sent.
    const pushed = await DataManager.loadBoard();
    await DataManager.editTask("task-b", "Edited during push", "");
    result = await DataManager.finishSync(pushed, { lastRemoteCommit: "pushed-commit", lastSyncAt: 123 });
    assert.equal(result.tasks["task-b"].title, "Edited during push");
    assert.equal(result.sync.pendingChanges, true); assert.equal(result.sync.status, "pending");
    const latestPushed = await DataManager.loadBoard();
    result = await DataManager.finishSync(latestPushed, { lastRemoteCommit: "latest-commit", lastSyncAt: 124 });
    assert.equal(result.sync.pendingChanges, false); assert.equal(result.sync.status, "synced");
    const conflictBoard = board(); conflictBoard.conflicts = { title: conflict("title", "task", "task-a", "title", "task-a", "Remote") };
    uri = await fresh(conflictBoard);
    result = await DataManager.finishSync(await DataManager.loadBoard(), { lastRemoteCommit: "conflict-commit" });
    assert.equal(result.sync.status, "conflict");

    // Missing optional fields from older valid boards continue to normalize safely.
    const compatible = board();
    delete compatible.tasks["task-a"].checklist; delete compatible.tasks["task-a"].relations;
    delete compatible.tasks["task-a"].priority; delete compatible.tasks["task-a"].position;
    result = normalizeBoard(compatible);
    assert.equal(result.version, "2.0.0"); assert.deepEqual(result.tasks["task-a"].checklist, []);
    assert.equal(result.tasks["task-a"].priority, "medium");

    // Do not require newer global APIs than the declared VS Code minimum host.
    uri = await fresh();
    const savedClone = global.structuredClone;
    const savedHasOwn = Object.hasOwn;
    try {
      global.structuredClone = undefined; Object.hasOwn = undefined;
      await DataManager.editTask("task-a", "Compatible extension host", "");
      assert.equal((await DataManager.loadBoard()).tasks["task-a"].title, "Compatible extension host");
    } finally {global.structuredClone = savedClone; Object.hasOwn = savedHasOwn;}

    // Existing older modular boards open without migrating or rewriting files.
    uri = await fresh();
    await fsp.writeFile(boardPath(uri, "board.json"), JSON.stringify({ version: "1.0.0", labels: board().labels }));
    const olderTask = task("task-a", "work");
    delete olderTask.checklist; delete olderTask.relations; olderTask.description = null;
    await fsp.writeFile(boardPath(uri, "tasks/task-a.json"), JSON.stringify(olderTask));
    await fsp.unlink(boardPath(uri, "metadata/version.json"));
    before = await files(uri.path);
    await DataManager.initializeBoard();
    result = await DataManager.loadBoard();
    assert.equal(result.tasks["task-a"].description, "");
    assert.deepEqual(result.tasks["task-a"].checklist, []);
    assert.deepEqual(await files(uri.path), before);
    assert.ok(!fs.existsSync(path.join(uri.path, ".vscode/lynvo.json")));

    // The existing legacy migration still works only when no modular root exists.
    uri = new Uri(path.join(fixture, `project-${++sequence}`));
    await fsp.mkdir(path.join(uri.path, ".vscode"), { recursive: true });
    folders.push(uri); DataManager.setWorkspaceUri(uri);
    const legacyBoard = { ...board(), version: "0.0.1" };
    const legacyRaw = JSON.stringify(legacyBoard);
    const legacyFile = path.join(uri.path, ".vscode/lynvo.json");
    await fsp.writeFile(legacyFile, legacyRaw);
    await DataManager.initializeBoard();
    result = await DataManager.loadBoard();
    assert.equal(Object.keys(result.tasks).length, 3);
    assert.equal(result.version, "2.0.0");
    assert.equal(await fsp.readFile(legacyFile, "utf8"), legacyRaw);
    assert.equal((await readJson(boardPath(uri, "tasks/task-b.json"))).title, "task-b");

    await testBoardLocks(lockDirectory, mocks);
    console.log("Lynvo persistence regression checks passed.");
  } finally {
    holdAuth = undefined; renameHook = undefined;
    await fsp.rm(fixture, { recursive: true, force: true });
  }
};

const testBoardLocks = async (directory, mocks) => {
  const { withBoardLock } = loadSource("src/providers/BoardLock.ts", mocks);
  const key = "isolated-lock-test";
  const lockPath = path.join(directory, `lynvo-board-${crypto.createHash("sha256").update(key).digest("hex")}.lock`);
  const childSource = ts.transpileModule(fs.readFileSync(path.join(root, "src/providers/BoardLock.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const runner = path.join(directory, "lock-child.cjs");
  await fsp.writeFile(runner, `
    const Module = require("node:module");
    const fs = require("node:fs/promises");
    const os = require("node:os");
    const mod = new Module(__filename);
    mod.require = (name) => name === "os" ? { ...os, tmpdir: () => ${JSON.stringify(directory)} } : require(name);
    mod._compile(${JSON.stringify(childSource)}, __filename);
    mod.exports.withBoardLock(process.argv[2], async () => {
      process.send("entered");
      await new Promise((resolve) => process.once("message", resolve));
    }).then(() => { process.send("done"); process.disconnect(); }, (error) => { process.send({ error: error.message }); process.exitCode = 1; process.disconnect(); });
  `);
  const spawnLock = () => {
    const child = childProcess.fork(runner, [key], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const entered = deferred(); const finished = deferred();
    child.on("message", (message) => {
      if (message === "entered") { entered.resolve(); }
      else if (message && message.error) { finished.resolve(new Error(message.error)); }
    });
    child.on("exit", (code) => finished.resolve(code === 0 ? undefined : new Error(`Lock child exited ${code}`)));
    return { child, entered: entered.promise, finished: finished.promise };
  };
  let child;
  try {
    child = spawnLock(); await child.entered;
    let parentEntered = false;
    const parent = withBoardLock(key, async () => { parentEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(parentEntered, false, "a second process must wait for the current owner");
    child.child.send("release");
    const failure = await child.finished; if (failure) { throw failure; }
    await parent; assert.equal(parentEntered, true);
    assert.ok(!fs.existsSync(lockPath));

    // A killed process leaves its owner record; the next host reclaims it safely.
    child = spawnLock(); await child.entered;
    child.child.kill("SIGKILL"); await child.finished;
    assert.ok(fs.existsSync(lockPath));
    await Promise.all(Array.from({ length: 8 }, () => withBoardLock(key, async () => {
      const owner = await fsp.readFile(path.join(lockPath, "owner.json"), "utf8");
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(await fsp.readFile(path.join(lockPath, "owner.json"), "utf8"), owner,
        "simultaneous stale reclaimers must not remove another owner's active lock");
    })));
    assert.ok(!fs.existsSync(lockPath));

    // Invalid ownership created by a crashed host is reclaimable after grace.
    await fsp.mkdir(lockPath); await fsp.writeFile(path.join(lockPath, "owner.json"), '{"pid":"invalid"}');
    const old = new Date(Date.now() - 31000); await fsp.utimes(lockPath, old, old);
    await withBoardLock(key, async () => undefined);
    assert.ok(!fs.existsSync(lockPath));
    await fsp.unlink(runner);
  } finally {
    if (child && child.child.exitCode === null && child.child.signalCode === null) { child.child.kill("SIGKILL"); await child.finished; }
  }
};

const runLocks = async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-lock-regression-"));
  try {
    await testBoardLocks(directory, { tmp: directory });
    console.log("Lynvo board lock regression checks passed.");
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
};

(process.argv.includes("--locks") ? runLocks() : run()).catch((error) => { console.error(error); process.exitCode = 1; });
