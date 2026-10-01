"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

const loadSource = (relative, mocks = {}, cache = new Map()) => {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) {return cache.get(filename).exports;}
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);
  mod.require = (name) => {
    if (name in mocks) {return mocks[name];}
    if (name.startsWith(".")) {
      const candidate = path.resolve(path.dirname(filename), name) + ".ts";
      if (fs.existsSync(candidate)) {return loadSource(candidate, mocks, cache);}
    }
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return mod.exports;
};

// Execute the real App handlers with deterministic React hooks. No browser,
// board files, or bundled production assets are changed by these tests.
const appHarness = (restoredState) => {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let state = restoredState;
  const messages = [];
  const listeners = new Map();
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (initial) => {
      const slot = cursor++;
      if (!(slot in hooks)) {hooks[slot] = typeof initial === "function" ? initial() : initial;}
      return [hooks[slot], (next) => {hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next;}];
    },
    useRef: (initial) => {
      const slot = cursor++;
      if (!(slot in hooks)) {hooks[slot] = { current: initial };}
      return hooks[slot];
    },
    useMemo: (make) => {cursor++; return make();},
    useEffect: (effect, deps) => {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        effects.push(() => {
          previous?.cleanup?.();
          hooks[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  global.acquireVsCodeApi = () => ({ postMessage: (message) => messages.push(message), getState: () => state, setState: (next) => {state = next;} });
  global.window = { addEventListener: (type, cb) => listeners.set(type, cb), removeEventListener: (type) => listeners.delete(type), setTimeout };
  const { App } = loadSource("src/webview/App.tsx", { react });
  return {
    messages,
    render: () => {cursor = 0; effects = []; const tree = App(); effects.forEach((effect) => effect()); return tree;},
    receive: (message) => listeners.get("message")({ data: message }),
    savedState: () => state,
  };
};
const elements = (tree) => {
  if (!tree || typeof tree !== "object") {return [];}
  if (Array.isArray(tree)) {return tree.flatMap(elements);}
  return [tree, ...elements(tree.props?.children)];
};
const text = (tree) => {
  if (tree === null || tree === undefined || typeof tree === "boolean") {return "";}
  if (Array.isArray(tree)) {return tree.map(text).join("");}
  if (typeof tree === "object") {return text(tree.props?.children);}
  return String(tree);
};
const find = (tree, predicate) => {
  const found = elements(tree).find(predicate);
  assert.ok(found, "Expected UI element was not rendered");
  return found;
};
const button = (tree, label) => find(tree, (item) => item.type === "button" && text(item) === label);
const card = (tree) => find(tree, (item) => item.props.className === "lynvo-card" && text(item).includes("Task one"));
const editor = (tree) => find(tree, (item) => item.type === "fieldset");
const boardFixture = () => {
  const user = { githubId: "test", username: "Test" };
  const task = (id, status) => ({ id, title: id === "one" ? "Task one" : id, description: "Description", status,
    createdBy: user, lastModifiedBy: user, createdAt: 1, updatedAt: 2, priority: "medium", dueDate: 3,
    checklist: [{ id: "item", text: "Original item", done: false, createdAt: 1, updatedAt: 1 }],
    relations: [{ id: "relation", type: "related", targetTaskId: "two", createdAt: 1 }], labelIds: [] });
  return { version: "2.0.0", columns: Object.fromEntries([["todo", "Pendiente"], ["in-progress", "En curso"], ["done", "Finalizado"]]
    .map(([id, title], position) => [id, { id, title, position, color: "#58a6ff" }])),
    tasks: { one: task("one", "todo"), two: task("two", "done"), three: task("three", "in-progress") }, labels: {}, conflicts: {} };
};

const testEditor = () => {
  const app = appHarness();
  let tree = app.render();
  app.receive({ command: "loadData", data: boardFixture(), workspaceId: "project-a" });
  tree = app.render();
  const metrics = elements(tree).filter((item) => item.props.className === "lynvo-stat");
  assert.equal(text(metrics[1]), "Completed1", "renaming Done must preserve completed metrics");
  assert.equal(text(metrics[2]), "Overdue2", "completed tasks must not be overdue");
  button(card(tree), "E").props.onClick();
  tree = app.render();
  let form = editor(tree);
  find(form, (item) => item.type === "input" && item.props.type === "checkbox").props.onChange({ target: { checked: true } });
  find(form, (item) => item.type === "input" && item.props.value === "Original item").props.onChange({ target: { value: "Changed draft" } });
  button(form, "×").props.onClick();
  tree = app.render();
  find(editor(tree), (item) => item.props.placeholder === "Add checklist item...").props.onChange({ target: { value: "New draft item" } });
  tree = app.render();
  button(editor(tree), "Add").props.onClick();
  tree = app.render();
  assert.ok(text(editor(tree)).includes("Checklist"));
  const relationRemove = elements(editor(tree)).filter((item) => item.type === "button" && text(item) === "×").at(-1);
  relationRemove.props.onClick();
  tree = app.render();
  const relationSelect = find(editor(tree), (item) => item.type === "select" && text(item).includes("Select task..."));
  relationSelect.props.onChange({ target: { value: "three" } });
  tree = app.render(); button(editor(tree), "Link").props.onClick(); tree = app.render();
  assert.ok(text(editor(tree)).includes("three"), "relation additions must be visible in the draft");
  assert.equal(app.messages.filter((message) => message.command !== "requestData").length, 0,
    "checklist edits must remain local until Save");
  find(editor(tree), (item) => item.props.placeholder === "Add checklist item...").props.onChange({ target: { value: "Discard this unfinished item" } });
  tree = app.render();
  button(editor(tree), "Cancel").props.onClick();
  tree = app.render();
  assert.equal(app.messages.length, 1, "Cancel must not persist checklist or relation edits");
  button(card(tree), "E").props.onClick();
  tree = app.render();
  form = editor(tree);
  assert.ok(find(form, (item) => item.props.value === "Original item"));
  assert.equal(find(form, (item) => item.props.placeholder === "Add checklist item...").props.value, "", "Cancel must clear the unfinished add-item input");
  find(form, (item) => item.type === "input" && item.props.value === "Task one").props.onChange({ target: { value: "My unsaved title" } });
  find(form, (item) => item.type === "input" && item.props.value === "Original item").props.onChange({ target: { value: "Saved checklist draft" } });
  tree = app.render();
  button(editor(tree), "Save").props.onClick();
  tree = app.render();
  const editMessage = app.messages.at(-1);
  assert.equal(editMessage.command, "editTask");
  assert.equal(editMessage.expectedUpdatedAt, 2);
  assert.equal(editMessage.checklist[0].text, "Saved checklist draft");
  assert.equal(editMessage.relations[0].id, "relation");
  assert.ok(editor(tree).props.disabled, "editor must wait for the write acknowledgement");
  app.receive({ command: "operationComplete", operation: "editTask", requestId: editMessage.requestId, error: "Task changed remotely. Reopen it before saving." });
  tree = app.render();
  assert.equal(find(editor(tree), (item) => item.type === "input" && item.props.value === "My unsaved title").props.value, "My unsaved title");
  assert.ok(text(find(tree, (item) => item.props.role === "alert")).includes("changed remotely"));
  const newer = boardFixture(); newer.tasks.one.updatedAt = 9; newer.tasks.one.title = "Remote title";
  app.receive({ command: "loadData", data: newer, workspaceId: "project-a" });
  tree = app.render();
  assert.ok(find(editor(tree), (item) => item.props.value === "My unsaved title"), "refresh must preserve editor draft");
  // Restoring a disposed webview preserves its draft and original optimistic version.
  const restored = appHarness(app.savedState());
  restored.render(); restored.receive({ command: "loadData", data: newer, workspaceId: "project-a" });
  tree = restored.render();
  assert.ok(find(editor(tree), (item) => item.props.value === "My unsaved title"));
  // Changing workspace while a draft is open clears it; reopening this
  // original snapshot separately verifies the successful acknowledgement.
  const otherProject = appHarness(restored.savedState());
  otherProject.render(); otherProject.receive({ command: "loadData", data: boardFixture(), workspaceId: "project-b" });
  assert.equal(elements(otherProject.render()).filter((item) => item.type === "fieldset").length, 0);
  button(editor(tree), "Save").props.onClick();
  const restoredSave = restored.messages.at(-1);
  assert.equal(restoredSave.expectedUpdatedAt, 2);
  restored.receive({ command: "operationComplete", operation: "editTask", requestId: restoredSave.requestId });
  tree = restored.render();
  assert.equal(elements(tree).filter((item) => item.type === "fieldset").length, 0, "successful acknowledgement closes the editor");
  restored.receive({ command: "loadData", data: boardFixture(), workspaceId: "project-b" });
  tree = restored.render();
  assert.equal(elements(tree).filter((item) => item.type === "fieldset").length, 0, "drafts must not leak between projects");
};

const testConflictMessages = () => {
  const app = appHarness(); app.render();
  const board = boardFixture();
  board.conflicts.c = { id: "c", entityType: "task", entityId: "one", field: "checklist", localValue: board.tasks.one.checklist,
    remoteValue: [], createdAt: 7, resolved: false };
  app.receive({ command: "loadData", data: board, workspaceId: "project-a" });
  app.receive({ command: "switchView", view: "conflicts" });
  let tree = app.render();
  button(tree, "Discard all").props.onClick();
  assert.deepEqual(app.messages.at(-1).expectedConflicts, board.conflicts);
  app.receive({ command: "conflictResolutionComplete" }); tree = app.render();
  button(tree, "Keep Local").props.onClick();
  assert.deepEqual(app.messages.at(-1).expectedConflict, board.conflicts.c);
};

const testPanel = async () => {
  const sent = [], errors = [], calls = [];
  const scope = new AsyncLocalStorage();
  let activeWorkspace = "project-a";
  const uri = () => ({ toString: () => activeWorkspace });
  const dm = { getActiveWorkspaceUri: uri, getWorkspaceUri: () => scope.getStore() || uri(), withWorkspace: (workspace, operation) => scope.run(workspace, operation), loadBoard: async () => boardFixture(),
    editTask: async (...args) => {calls.push(args);}, resolveConflicts: async (...args) => {calls.push(args);} };
  const mock = { window: { showErrorMessage: (detail) => errors.push(detail) },
    Uri: { joinPath: (_uri, ...parts) => ({ toString: () => parts.join("/") }) } };
  const { LynvoPanel } = loadSource("src/providers/LynvoPanel.ts", { vscode: mock,
    "./DataManager": { DataManager: dm }, "./GitService": { GitService: {} } });
  const panel = Object.create(LynvoPanel.prototype); panel._disposables = []; panel._requestedView = "table";
  let handler;
  panel._setWebviewMessageListener({ onDidReceiveMessage: (fn) => {handler = fn;}, postMessage: (message) => sent.push(message) });
  LynvoPanel.refreshDataAndScheduleSync = async () => {};
  const originalRefresh = LynvoPanel.refreshData;
  LynvoPanel.refreshData = async () => {};
  await handler({ command: "requestData" });
  assert.deepEqual(sent.map((message) => message.command), ["loadData", "switchView"]);
  assert.equal(sent[1].view, "table", "initial view must be delivered after UI readiness");
  const draft = boardFixture().tasks.one;
  await handler({ command: "editTask", requestId: "edit", taskId: "one", title: "Edited", description: "Draft", expectedUpdatedAt: 2,
    checklist: draft.checklist, relations: draft.relations });
  assert.deepEqual(calls.at(-1)[6], { expectedUpdatedAt: 2, checklist: draft.checklist, relations: draft.relations });
  assert.equal(sent.at(-1).command, "operationComplete");
  dm.editTask = async () => {throw new Error("write failed");};
  await handler({ command: "editTask", requestId: "failed", taskId: "one", title: "Edited" });
  assert.equal(sent.at(-1).error, "write failed");
  assert.equal(sent.at(-1).requestId, "failed");
  assert.equal(errors.length, 1, "write failures must reach the user");
  const conflict = { id: "c", entityType: "column", entityId: "todo", field: "color", localValue: "red", remoteValue: "blue", createdAt: 7, resolved: false };
  await handler({ command: "resolveConflicts", requestId: "resolve", conflictIds: ["c"], resolution: "remote", expectedConflicts: { c: conflict } });
  assert.deepEqual(calls.at(-1), [["c"], "remote", { c: conflict }]);
  const previousCallCount = calls.length;
  await handler({ command: "resolveConflicts", requestId: "stale-project", workspaceId: "project-b", conflictIds: ["c"], resolution: "local" });
  assert.equal(calls.length, previousCallCount, "messages from another project must never mutate the active board");
  assert.ok(sent.at(-1).error.includes("active project changed"));
  LynvoPanel.refreshData = originalRefresh;
  LynvoPanel.currentPanel = panel;
  panel._panel = { webview: { postMessage: (message) => sent.push(message) } };
  let completeRead;
  dm.loadBoard = () => new Promise((resolve) => {completeRead = resolve;});
  const beforeRefresh = sent.length;
  const refreshing = LynvoPanel.refreshData();
  activeWorkspace = "project-b";
  completeRead(boardFixture()); await refreshing;
  assert.equal(sent.length, beforeRefresh, "an older read must not repaint a different project");
  LynvoPanel.currentPanel = undefined;
};

const testPanelWorkspace = async () => {
  const scope = new AsyncLocalStorage();
  let active = "project-a", confirmDelete, completeMutation;
  const calls = [], sent = [];
  const uri = (name) => ({ toString: () => name });
  const dm = { getActiveWorkspaceUri: () => uri(active), getWorkspaceUri: () => scope.getStore() || uri(active),
    withWorkspace: (workspace, operation) => scope.run(workspace, operation),
    loadBoard: async () => {calls.push(["read", dm.getWorkspaceUri().toString()]); return boardFixture();},
    deleteTask: async () => {calls.push(["delete", dm.getWorkspaceUri().toString()]);},
    updateTaskStatus: () => new Promise((resolve) => {completeMutation = () => {calls.push(["update", dm.getWorkspaceUri().toString()]); resolve();};}),
  };
  const mock = { window: { showWarningMessage: () => new Promise((resolve) => {confirmDelete = resolve;}), showErrorMessage: (error) => {throw new Error(error);} } };
  const { LynvoPanel } = loadSource("src/providers/LynvoPanel.ts", { vscode: mock, "./DataManager": { DataManager: dm },
    "./GitService": { GitService: { scheduleBoardSync: () => calls.push(["schedule", dm.getWorkspaceUri().toString()]) } } });
  const panel = Object.create(LynvoPanel.prototype); panel._disposables = [];
  panel._panel = { webview: { postMessage: (message) => sent.push(message) } }; LynvoPanel.currentPanel = panel;
  let handler;
  panel._setWebviewMessageListener({ onDidReceiveMessage: (callback) => {handler = callback;}, postMessage: (message) => sent.push(message) });
  const deleting = handler({ command: "deleteTask", taskId: "one", requestId: "delete", workspaceId: "project-a" });
  active = "project-b"; confirmDelete("Delete"); await deleting;
  assert.deepEqual(calls.filter(([type]) => type === "delete" || type === "schedule"), [["delete", "project-a"], ["schedule", "project-a"]],
    "modal confirmation and scheduled sync must remain in the originating project");
  assert.ok(calls.some(([type, workspace]) => type === "read" && workspace === "project-b"), "UI refresh must use the active project outside the operation scope");
  calls.length = 0; active = "project-a";
  const updating = handler({ command: "updateTaskStatus", taskId: "one", newStatus: "done", requestId: "move", workspaceId: "project-a" });
  active = "project-b"; completeMutation(); await updating;
  assert.ok(calls.some(([type, workspace]) => type === "schedule" && workspace === "project-a"), "awaiting a mutation must not switch its sync target");
  assert.equal(sent.filter((message) => message.command === "loadData").at(-1).workspaceId, "project-b");
  LynvoPanel.currentPanel = undefined;
};

const testExtension = async () => {
  const commands = new Map(), created = [], workspaces = [], sequence = [], scheduled = [];
  const scope = new AsyncLocalStorage();
  let completeInit;
  const initialized = new Promise((resolve) => {completeInit = resolve;});
  const folder = { uri: { toString: () => "project-b" } };
  let activeWorkspace = folder.uri;
  const doc = { uri: { toString: () => "project-b/src/example.ts" }, languageId: "typescript", getText: () => "const answer = 42;" };
  const dm = { getWorkspaceUri: () => scope.getStore() || activeWorkspace, withWorkspace: (workspace, operation) => scope.run(workspace, operation),
    setWorkspaceUri: (uri) => {activeWorkspace = uri; workspaces.push(uri);}, initializeBoard: async () => {await initialized; sequence.push("init");},
    touchCurrentUser: async () => sequence.push("presence"), createTask: async (...args) => {
      created.push(args); await Promise.resolve(); activeWorkspace = { toString: () => "project-a" };
    }, loadBoard: async () => boardFixture() };
  const disposable = { dispose: () => {} };
  const watcher = { ...disposable, onDidChange: () => {}, onDidCreate: () => {}, onDidDelete: () => {} };
  const mock = {
    workspace: { getWorkspaceFolder: () => folder, createFileSystemWatcher: () => watcher,
      asRelativePath: (uri, includeFolder) => {assert.equal(uri, doc.uri); assert.equal(includeFolder, false); return "src/example.ts";} },
    window: { activeTextEditor: { document: doc, selection: { start: { line: 1, character: 0 }, end: { line: 4, character: 0 } } },
      registerTreeDataProvider: () => disposable, showInputBox: async () => "Code task", showInformationMessage: () => {}, showErrorMessage: (error) => {throw new Error(error);} },
    commands: { registerCommand: (name, callback) => {commands.set(name, callback); return disposable;} },
  };
  const { activate } = loadSource("src/extension.ts", { vscode: mock,
    "./providers/DataManager": { DataManager: dm },
    "./providers/AuthProvider": { AuthProvider: {} },
    "./providers/LynvoPanel": { LynvoPanel: { refreshData: async () => {} } },
    "./providers/LynvoMenuProvider": { LynvoMenuProvider: class {} },
    "./providers/GitService": { GitService: { scheduleBoardSync: () => scheduled.push(dm.getWorkspaceUri().toString()), cancelScheduledSync: () => {} } },
    "./providers/SkillInstaller": { SkillInstaller: { installAll: async () => ({ installed: [], skipped: [], errors: [] }) } },
  });
  const context = { subscriptions: [], extensionUri: {} };
  const activating = activate(context);
  assert.equal(commands.size, 0, "commands must wait for board initialization");
  completeInit(); await activating;
  assert.deepEqual(sequence.slice(0, 2), ["init", "presence"], "presence writes must follow initialization");
  await commands.get("lynvo.createTaskFromCode")();
  assert.ok(workspaces.every((uri) => uri === folder.uri), "code tasks must use the selected file's project");
  assert.equal(created[0][1], "```typescript\nconst answer = 42;\n```");
  assert.deepEqual(created[0][4], { filePath: "src/example.ts", lineStart: 2, lineEnd: 4 });
  assert.deepEqual(scheduled, ["project-b"], "task creation must schedule sync in its original folder after an awaited mutation");
  let inputCount = 0;
  mock.window.showInputBox = async () => ++inputCount === 1 ? "Cancelled task" : undefined;
  await commands.get("lynvo.quickCreateTask")();
  assert.equal(created.length, 1, "cancelling the description prompt must cancel task creation");
  context.subscriptions.forEach((item) => item.dispose());
};

(async () => {
  testEditor(); testConflictMessages(); await testPanel(); await testPanelWorkspace(); await testExtension();
  console.log("Lynvo UI regression checks passed (draft cancellation, stale edit guards, save acknowledgements, conflict snapshots, initial view).");
})().catch((error) => {console.error(error); process.exitCode = 1;});
