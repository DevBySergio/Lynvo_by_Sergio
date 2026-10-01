"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const user = { githubId: "test", username: "Test" };
const columns = Object.fromEntries(["todo", "doing", "done"].map((id, position) => [
  id, { id, title: id, position, color: "#58a6ff" },
]));
const makeTask = (index, status = "todo") => ({
  id: `task-${index}`, title: `Task ${index}`, description: "Local description",
  status, position: index, createdAt: 1, updatedAt: 2,
  createdBy: user, lastModifiedBy: user, labelIds: ["label"], priority: "high", dueDate: 123,
  checklist: [{ id: "check", text: "Keep this item", done: false, createdAt: 1, updatedAt: 1 }],
  relations: [{ id: "link", type: "related", targetTaskId: "task-1", createdAt: 1 }],
  codeReference: { filePath: "src/example.ts", lineStart: 1, lineEnd: 3 },
});

// Run the real TypeScript modules with a small filesystem-backed VS Code adapter.
// Every board used here lives in an isolated temporary workspace.
const loadSource = (relativePath, vscodeMock = {}, cache = new Map()) => {
  const filename = path.resolve(root, relativePath);
  if (cache.has(filename)) {return cache.get(filename).exports;}
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);
  mod.require = (specifier) => {
    if (specifier === "vscode") {return vscodeMock;}
    if (specifier.startsWith(".")) {
      const candidate = path.resolve(path.dirname(filename), specifier) + ".ts";
      if (fs.existsSync(candidate)) {return loadSource(candidate, vscodeMock, cache);}
    }
    return require(specifier);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return mod.exports;
};

const testMap = () => {
  const { createMapLayout, fitMapBounds, mapNodeWidth, mapNodeHeight } = loadSource("src/webview/mapLayout.ts");
  for (const count of [0, 1, 3, 657, 1200, 10000]) {
    for (const columnCount of [1, 3, 18]) {
      const mapColumns = Array.from({ length: columnCount }, (_, index) => ({
        id: `col-${index}`, title: `Column ${index}`, color: "#58a6ff", position: index,
      }));
      // Exercise both uneven distributions and a board concentrated in one status.
      for (const concentrated of [false, true]) {
        const tasks = Array.from({ length: count }, (_, index) =>
          makeTask(index, mapColumns[concentrated ? 0 : index % columnCount].id),
        );
        const original = JSON.stringify(tasks);
        const layout = createMapLayout(tasks, mapColumns);
        assert.equal(layout.tasks.length, count, "the map must not truncate tasks");
        assert.equal(layout.positions.size, count);
        assert.equal(JSON.stringify(tasks), original, "layout must not mutate persisted task data");
        assert.deepEqual(createMapLayout([...tasks].reverse(), mapColumns).positions, layout.positions);
        const rows = new Map();
        for (const position of layout.positions.values()) {
          assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
          assert.ok(position.x - mapNodeWidth / 2 >= 0);
          assert.ok(position.x + mapNodeWidth / 2 <= layout.width);
          assert.ok(position.y - mapNodeHeight / 2 >= 0);
          assert.ok(position.y + mapNodeHeight / 2 <= layout.height);
          const row = rows.get(position.y) || [];
          row.push(position.x);
          rows.set(position.y, row);
        }
        for (const row of rows.values()) {
          row.sort((a, b) => a - b);
          for (let i = 1; i < row.length; i++) {assert.ok(row[i] - row[i - 1] >= mapNodeWidth);}
        }
        const ys = [...rows.keys()].sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) {assert.ok(ys[i] - ys[i - 1] >= mapNodeHeight);}
        for (const [width, height] of [[1200, 600], [700, 280], [320, 260]]) {
          const view = fitMapBounds({ x: 0, y: 0, width: layout.width, height: layout.height }, width, height);
          assert.ok(view.zoom > 0 && view.zoom <= 1);
          for (const position of layout.positions.values()) {
            const left = view.offset.x + (position.x - mapNodeWidth / 2) * view.zoom;
            const top = view.offset.y + (position.y - mapNodeHeight / 2) * view.zoom;
            assert.ok(left >= 0 && top >= 0);
            assert.ok(left + mapNodeWidth * view.zoom <= width);
            assert.ok(top + mapNodeHeight * view.zoom <= height);
          }
        }
      }
    }
  }
  const orphan = makeTask(0, "removed-column");
  assert.ok(createMapLayout([orphan], []).positions.has(orphan.id), "unknown statuses must stay visible");
  const translated = fitMapBounds({ x: 100, y: 200, width: 800, height: 600 }, 1000, 800);
  assert.equal(translated.offset.x + 500 * translated.zoom, 500);
  assert.equal(translated.offset.y + 500 * translated.zoom, 400);
};

const makeBoard = () => {
  const tasks = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const task = makeTask(index);
    return [task.id, task];
  }));
  const specs = [
    ["task-0", "title", "Remote title"],
    ["task-0", "description", "Remote description"],
    ["task-0", "status", "done"],
    ["task-0", "priority", "low"],
    ["task-0", "dueDate", null],
    ["task-1", "dueDate", 456],
    ["task-2", "priority", "invalid-priority"],
    ["deleted-task", "title", "Never resurrect this task"],
  ];
  const conflicts = Object.fromEntries(specs.map(([entityId, field, remoteValue], index) => [
    `conflict-${index}`, {
      id: `conflict-${index}`, entityType: "task", entityId, field,
      localValue: tasks[entityId]?.[field] ?? null, remoteValue, createdAt: 3, resolved: false,
    },
  ]));
  conflicts.resolved = { ...conflicts["conflict-0"], id: "resolved", remoteValue: "Already resolved", resolved: true };
  return {
    version: "2.0.0", columns: structuredClone(columns), tasks,
    labels: { label: { id: "label", name: "Keep label", color: "#00ff00" } },
    users: { test: { ...user, lastSeenAt: 1 } },
    activity: { event: { id: "event", type: "task_created", message: "Keep history", actor: user, createdAt: 1 } },
    sync: { branch: "lynvo-sync", status: "conflict", pendingChanges: false, lastSyncAt: 1, lastRemoteCommit: "commit", updatedAt: 1 },
    tombstones: { deleted: { id: "deleted", entityType: "task", entityId: "deleted-task", deletedAt: 1, deletedBy: user } },
    conflicts,
  };
};

const testConflictsAndPersistence = async () => {
  const workspacePath = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-regression-"));
  const writes = [];
  const errors = [];
  class Uri {
    constructor(value) {this.path = value; this.fsPath = value;}
    static joinPath(uri, ...segments) {return new Uri(path.join(uri.path, ...segments));}
    with(change) {return new Uri(change.path || this.path);}
  }
  const vscodeMock = {
    Uri, FileType: { File: 1, Directory: 2 },
    authentication: { getSession: async () => undefined },
    window: { showWarningMessage: async () => undefined, showErrorMessage: (error) => errors.push(error) },
    workspace: {
      workspaceFolders: [{ uri: new Uri(workspacePath) }],
      fs: {
        stat: (uri) => fsp.stat(uri.path),
        readFile: (uri) => fsp.readFile(uri.path),
        writeFile: (uri, data) => fsp.writeFile(uri.path, data),
        rename: async (from, to) => {writes.push(to.path); await fsp.rename(from.path, to.path);},
        createDirectory: (uri) => fsp.mkdir(uri.path, { recursive: true }),
        delete: (uri) => fsp.rm(uri.path, { recursive: true }),
        readDirectory: async (uri) => (await fsp.readdir(uri.path, { withFileTypes: true })).map((entry) =>
          [entry.name, entry.isFile() ? 1 : 2],
        ),
      },
    },
  };
  const cache = new Map();
  const { DataManager } = loadSource("src/providers/DataManager.ts", vscodeMock, cache);
  const listFiles = async (dir = workspacePath) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory()
      ? listFiles(path.join(dir, entry.name))
      : [path.relative(workspacePath, path.join(dir, entry.name))]))).flat().sort();
  };
  try {
    for (const resolution of ["local", "remote"]) {
      const fixture = makeBoard();
      await DataManager.saveBoard(fixture);
      const pathsBefore = await listFiles();
      const taskFilesBefore = structuredClone(fixture.tasks);
      const writeCount = writes.length;
      const ids = Object.keys(fixture.conflicts);
      await DataManager.resolveConflicts([...ids, ids[0], "missing-conflict"], resolution);
      const board = await DataManager.loadBoard();
      assert.ok(Object.values(board.conflicts).every((conflict) => conflict.resolved));
      assert.equal(writes.slice(writeCount).filter((name) => name.endsWith("/metadata/conflicts.json")).length, 1,
        "bulk resolution must persist all conflict decisions together");
      assert.equal(writes.slice(writeCount).filter((name) => name.endsWith("/board.json")).length, 0,
        "unchanged board metadata must not be rewritten");
      assert.deepEqual(await listFiles(), pathsBefore, "updating a modular board must preserve its file paths");
      assert.ok(!fs.existsSync(path.join(workspacePath, ".vscode", "lynvo.json")));
      assert.equal(board.version, "2.0.0");
      assert.deepEqual(JSON.parse(await fsp.readFile(path.join(workspacePath, ".vscode/lynvo/metadata/version.json"))),
        { schemaVersion: "2.0.0" });
      for (const field of ["labels", "columns", "activity", "users", "tombstones"]) {
        assert.deepEqual(board[field], fixture[field], `${field} must be preserved`);
      }
      assert.ok(!board.tasks["deleted-task"], "resolution must not resurrect a deleted task");
      assert.equal(board.sync.pendingChanges, true);
      assert.equal(board.sync.lastRemoteCommit, "commit");
      if (resolution === "local") {
        assert.deepEqual(board.tasks, taskFilesBefore, "Keep all must preserve current local task data");
      } else {
        assert.equal(board.tasks["task-0"].title, "Remote title");
        assert.equal(board.tasks["task-0"].description, "Remote description");
        assert.equal(board.tasks["task-0"].status, "done");
        assert.equal(board.tasks["task-0"].priority, "low");
        assert.equal(board.tasks["task-0"].dueDate, undefined);
        assert.equal(board.tasks["task-1"].dueDate, 456);
        assert.equal(board.tasks["task-2"].priority, "medium");
        assert.ok(board.tasks["task-0"].updatedAt > 2);
        for (const field of ["checklist", "relations", "labelIds", "codeReference", "createdBy", "lastModifiedBy"]) {
          assert.deepEqual(board.tasks["task-0"][field], taskFilesBefore["task-0"][field]);
        }
        assert.deepEqual(board.tasks["task-3"], taskFilesBefore["task-3"]);
      }
    }
    // An unseen new conflict must remain pending; individual resolution still works.
    await DataManager.saveBoard(makeBoard());
    await DataManager.resolveConflicts(["conflict-0"], "remote");
    let board = await DataManager.loadBoard();
    assert.equal(board.conflicts["conflict-1"].resolved, false);
    await DataManager.resolveConflict("conflict-1", "remote");
    board = await DataManager.loadBoard();
    assert.equal(board.tasks["task-0"].description, "Remote description");
    await DataManager.resolveConflict("resolved", "remote");
    board = await DataManager.loadBoard();
    assert.equal(board.tasks["task-0"].title, "Remote title", "resolved records must not be applied again");

    // Verify message validation and the completion/error response used by the UI.
    const { LynvoPanel } = loadSource("src/providers/LynvoPanel.ts", vscodeMock, cache);
    const panel = Object.create(LynvoPanel.prototype);
    panel._disposables = [];
    const messages = [];
    let handler;
    panel._setWebviewMessageListener({
      onDidReceiveMessage: (callback) => {handler = callback;},
      postMessage: (message) => messages.push(message),
    });
    let refreshes = 0;
    LynvoPanel.refreshDataAndScheduleSync = async () => {refreshes++;};
    await handler({ command: "resolveConflicts", conflictIds: [123], resolution: "local" });
    await handler({ command: "resolveConflicts", conflictIds: [], resolution: "local" });
    await handler({ command: "resolveConflicts", conflictIds: ["conflict-2"], resolution: "invalid" });
    assert.equal(refreshes, 0);
    await handler({ command: "resolveConflicts", conflictIds: ["conflict-2"], resolution: "local" });
    assert.equal(refreshes, 1);
    assert.deepEqual(messages.pop(), { command: "conflictResolutionComplete" });
    DataManager.resolveConflicts = async () => {throw new Error("test write failure");};
    await handler({ command: "resolveConflicts", conflictIds: ["conflict-2"], resolution: "remote" });
    assert.deepEqual(messages.pop(), { command: "conflictResolutionComplete", error: "test write failure" });
    assert.equal(errors.length, 1);
  } finally {
    await fsp.rm(workspacePath, { recursive: true, force: true });
  }
};

(async () => {
  testMap();
  await testConflictsAndPersistence();
  console.log("Lynvo regression checks passed (large maps, bulk conflicts, modular persistence).");
})().catch((error) => {console.error(error); process.exitCode = 1;});
