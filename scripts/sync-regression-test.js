"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const util = require("node:util");
const Module = require("node:module");
const ts = require("typescript");
const execFile = util.promisify(cp.execFile);
const root = path.resolve(__dirname, "..");
const user = { githubId: "test", username: "Test" };
const copy = (value) => structuredClone(value);

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

const makeBoard = () => ({
  version: "2.0.0",
  columns: {
    todo: { id: "todo", title: "To Do", color: "#58a6ff", position: 0 },
    done: { id: "done", title: "Done", color: "#00ff00", position: 1 },
  },
  labels: { label: { id: "label", name: "Label", color: "#ff0000" } },
  tasks: { task: {
    id: "task", title: "Original title", description: "Original description", status: "todo",
    createdAt: 1, updatedAt: 2, position: 1, createdBy: user, lastModifiedBy: user,
    priority: "medium", checklist: [{ id: "item", text: "Original item", done: false, createdAt: 1, updatedAt: 2 }],
    relations: [], labelIds: ["label"],
  } },
  users: {}, activity: {}, tombstones: {}, conflicts: {},
  sync: { branch: "lynvo-sync", status: "pending", pendingChanges: true, lastSyncAt: null, lastRemoteCommit: null, updatedAt: 1 },
});

const testMerge = () => {
  const { mergeBoards } = loadSource("src/providers/boardMerge.ts");
  const base = makeBoard();
  let local = copy(base), remote = copy(base);
  local.tasks.task.title = "Local title"; local.tasks.task.updatedAt = 4;
  remote.tasks.task.description = "Remote description"; remote.tasks.task.updatedAt = 5;
  let merged = mergeBoards(local, remote, base);
  assert.equal(merged.tasks.task.title, "Local title");
  assert.equal(merged.tasks.task.description, "Remote description");
  assert.equal(Object.keys(merged.conflicts).length, 0, "independent fields merge without conflicts");
  assert.equal(mergeBoards(base, remote, base).tasks.task.description, "Remote description");
  assert.equal(Object.keys(mergeBoards(base, remote, base).conflicts).length, 0, "one-sided changes are not conflicts");

  remote.tasks.task.title = "Remote title";
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.tasks.task.title, "Local title", "the timestamp must not silently discard a local edit");
  const conflict = merged.conflicts["task-task-title"];
  assert.equal(conflict.localValue, "Local title"); assert.equal(conflict.remoteValue, "Remote title");
  conflict.resolved = true;
  assert.equal(mergeBoards(merged, remote, base).conflicts[conflict.id].resolved, true, "the same resolved pair stays resolved");
  const equalTimestamp = copy(local); equalTimestamp.tasks.task.updatedAt = remote.tasks.task.updatedAt;
  assert.equal(mergeBoards(equalTimestamp, remote, base).conflicts[conflict.id].resolved, false, "equal timestamps do not hide conflicts");
  assert.equal(mergeBoards(local, remote).conflicts[conflict.id].resolved, false, "without a base differences remain reviewable");
  const withoutBase = mergeBoards(local, remote);
  assert.equal(withoutBase.tasks.task.title, withoutBase.conflicts[conflict.id].localValue, "the provisional task must match Keep local even when the remote timestamp is newer");

  const open = mergeBoards(local, remote, base);
  const openBase = copy(open), peer = copy(open);
  peer.tasks.task.title = "New remote title";
  const updatedOpen = mergeBoards(open, peer, openBase);
  assert.equal(updatedOpen.tasks.task.title, "Local title", "an unresolved local choice is still dirty after its provisional value has been synced");
  assert.equal(updatedOpen.conflicts[conflict.id].remoteValue, "New remote title");
  const resolvedPeer = copy(open);
  resolvedPeer.tasks.task.title = resolvedPeer.conflicts[conflict.id].remoteValue;
  resolvedPeer.conflicts[conflict.id].resolved = true;
  const acceptedPeer = mergeBoards(open, resolvedPeer, openBase);
  assert.equal(acceptedPeer.tasks.task.title, "Remote title", "a shared remote resolution supersedes the stale open conflict");
  assert.equal(acceptedPeer.conflicts[conflict.id].resolved, true);
  const chosenRemote = copy(open);
  chosenRemote.tasks.task.title = chosenRemote.conflicts[conflict.id].remoteValue;
  chosenRemote.conflicts[conflict.id].resolved = true;
  const staleProvisional = copy(open);
  const noBaseResolved = mergeBoards(chosenRemote, staleProvisional);
  assert.equal(noBaseResolved.tasks.task.title, "Remote title");
  assert.equal(noBaseResolved.conflicts[conflict.id].resolved, true, "the same reviewed pair in reversed order does not reopen when the baseline is unavailable");

  local = copy(base); remote = copy(base);
  local.tasks.task.checklist[0].text = "Local item text";
  remote.tasks.task.checklist[0].done = true;
  local.tasks.task.checklist.push({ id: "local", text: "Local addition", done: false, createdAt: 4, updatedAt: 4 });
  remote.tasks.task.checklist.push({ id: "remote", text: "Remote addition", done: false, createdAt: 5, updatedAt: 5 });
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.tasks.task.checklist.length, 3);
  assert.equal(merged.tasks.task.checklist[0].text, "Local item text");
  assert.equal(merged.tasks.task.checklist[0].done, true);
  assert.equal(Object.keys(merged.conflicts).length, 0);
  remote.tasks.task.checklist[0].text = "Remote incompatible text";
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.conflicts["task-task-checklist"].localValue.length, 3);
  assert.equal(merged.conflicts["task-task-checklist"].remoteValue.length, 3, "either conflict choice retains independent additions");
  assert.equal(merged.conflicts["task-task-checklist"].remoteValue[0].text, "Remote incompatible text");
  const checklistOpen = copy(merged);
  const remoteAddition = copy(checklistOpen);
  remoteAddition.tasks.task.checklist.push({ id: "later", text: "Later remote addition", done: false, createdAt: 6, updatedAt: 6 });
  const afterAddition = mergeBoards(checklistOpen, remoteAddition, checklistOpen);
  assert.deepEqual(afterAddition.conflicts["task-task-checklist"].localValue, afterAddition.tasks.task.checklist, "conflict guards remain resolvable after independent incoming additions");
  assert.equal(afterAddition.conflicts["task-task-checklist"].remoteValue.length, 4, "the original remote alternative also receives independent additions");
  assert.equal(afterAddition.conflicts["task-task-checklist"].remoteValue[0].text, "Remote incompatible text");
  remoteAddition.tasks.task.checklist[0].text = "Third remote text";
  const afterCollision = mergeBoards(checklistOpen, remoteAddition, checklistOpen);
  assert.equal(afterCollision.tasks.task.checklist[0].text, "Local item text", "a new remote edit must not replace an unresolved checklist choice");
  assert.equal(afterCollision.conflicts["task-task-checklist"].remoteValue[0].text, "Third remote text");
  assert.equal(afterCollision.tasks.task.checklist.length, 4);
  local = copy(base); remote = copy(base); local.tasks.task.checklist = [];
  assert.deepEqual(mergeBoards(local, remote, base).tasks.task.checklist, [], "deleted unchanged items stay deleted");
  remote.tasks.task.checklist[0].text = "Edited remotely";
  const deletedOpen = mergeBoards(local, remote, base);
  assert.ok(deletedOpen.conflicts["task-task-checklist"], "delete versus edit is reviewable");
  const deletedPeer = copy(deletedOpen); deletedPeer.tasks.task.checklist = copy(remote.tasks.task.checklist);
  const deletionPending = mergeBoards(deletedOpen, deletedPeer, deletedOpen);
  assert.deepEqual(deletionPending.tasks.task.checklist, [], "a pending local item deletion is not silently resurrected");

  local = copy(base); remote = copy(base);
  local.labels.second = { id: "second", name: "Second", color: "#ffffff" }; remote.labels.second = copy(local.labels.second);
  remote.tasks.task.labelIds = ["second"];
  const labelsOpen = mergeBoards(local, remote);
  const labelsPeer = copy(labelsOpen);
  labelsPeer.labels.later = { id: "later", name: "Later", color: "#ffffff" }; labelsPeer.tasks.task.labelIds.push("later");
  const labelsUpdated = mergeBoards(labelsOpen, labelsPeer, labelsOpen);
  assert.deepEqual(labelsUpdated.tasks.task.labelIds, ["label", "later"]);
  assert.deepEqual([...labelsUpdated.conflicts["task-task-labelIds"].remoteValue].sort(), ["later", "second"], "independent memberships are retained in both pending alternatives");

  local = copy(base); remote = copy(base);
  remote.columns.todo.title = "Remote column"; remote.labels.label.color = "#0000ff";
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.columns.todo.title, "Remote column"); assert.equal(merged.labels.label.color, "#0000ff");
  local.columns.todo.title = "Local column"; local.labels.label.color = "#ffffff";
  merged = mergeBoards(local, remote, base);
  assert.ok(merged.conflicts["column-todo-title"]); assert.ok(merged.conflicts["label-label-color"]);

  local = copy(base); remote = copy(base);
  local.tombstones["task-task"] = { id: "task-task", entityType: "task", entityId: "task", deletedAt: 4, deletedBy: user };
  remote.tombstones["task-task"] = { ...local.tombstones["task-task"], deletedAt: 8 };
  delete local.tasks.task; remote.tasks.task.updatedAt = 9;
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.tombstones["task-task"].deletedAt, 8); assert.equal(merged.tasks.task, undefined, "a deletion must never silently resurrect");
  local = copy(base); remote = copy(base);
  local.tombstones["column-todo"] = { id: "column-todo", entityType: "column", entityId: "todo", deletedAt: 8, deletedBy: user };
  delete local.columns.todo; delete local.tasks.task;
  merged = mergeBoards(local, remote, base);
  assert.equal(merged.tasks.task, undefined, "old column deletions without task tombstones remain deleted");
  assert.ok(merged.tombstones["task-task"]);
  assert.throws(() => mergeBoards({ ...base, tasks: { "../escape": { ...base.tasks.task, id: "../escape" } } }, base), /Invalid/);
};

class Uri {
  constructor(value) {this.path = value; this.fsPath = value; this.scheme = "file";}
  static joinPath(uri, ...segments) {return new Uri(path.join(uri.path, ...segments));}
  static file(value) {return new Uri(value);}
  with(change) {return new Uri(change.path || this.path);}
  toString() {return `file://${this.path}`;}
}
const createClient = (workspacePath) => {
  const vscodeMock = {
    Uri, FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    authentication: { getSession: async () => ({ account: { id: user.githubId, label: user.username } }) },
    window: { showWarningMessage: async () => undefined, showErrorMessage: async () => undefined },
    workspace: {
      workspaceFolders: [{ uri: new Uri(workspacePath) }],
      fs: {
        stat: (uri) => fsp.stat(uri.path), readFile: (uri) => fsp.readFile(uri.path), writeFile: (uri, data) => fsp.writeFile(uri.path, data),
        rename: (from, to) => fsp.rename(from.path, to.path), createDirectory: (uri) => fsp.mkdir(uri.path, { recursive: true }),
        delete: (uri) => fsp.rm(uri.path, { recursive: true, force: true }),
        readDirectory: async (uri) => (await fsp.readdir(uri.path, { withFileTypes: true })).map((entry) => [entry.name, entry.isFile() ? 1 : entry.isDirectory() ? 2 : 64]),
      },
    },
  };
  const cache = new Map();
  return {
    ...loadSource("src/providers/GitService.ts", vscodeMock, cache),
    ...loadSource("src/providers/DataManager.ts", vscodeMock, cache),
    workspacePath,
  };
};
const git = async (cwd, ...args) => (await execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();

const testWorkspaceScheduling = async () => {
  const client = createClient(path.join(os.tmpdir(), "lynvo-schedule-first"));
  const first = Uri.file(client.workspacePath), second = Uri.file(path.join(os.tmpdir(), "lynvo-schedule-second"));
  const scheduled = [];
  client.GitService.syncBoardNow = async () => {
    scheduled.push(client.DataManager.getWorkspaceUri().fsPath);
    return { success: true, message: "Test sync" };
  };
  const dispatch = (uri) => new Promise((resolve) => {
    client.DataManager.withWorkspace(uri, async () => client.GitService.scheduleBoardSync(10, resolve));
  });
  await Promise.all([dispatch(first), dispatch(second)]);
  assert.deepEqual(scheduled.sort(), [first.fsPath, second.fsPath].sort(), "a different project must not cancel or redirect a scheduled board sync");

  let release;
  client.GitService.syncBoardNow = () => new Promise((resolve) => {release = resolve;});
  const active = client.GitService.syncBoard();
  await new Promise((resolve) => setImmediate(resolve));
  const queued = client.GitService.syncBoard();
  client.GitService.cancelScheduledSync();
  release({ success: false, message: "Cancelled active test" });
  await active;
  assert.match((await queued).message, /cancelled/, "deactivation also prevents previously queued syncs from starting");
};

const testRealGit = async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-sync-regression-"));
  const origin = path.join(directory, "origin.git"), firstPath = path.join(directory, "first"), secondPath = path.join(directory, "second");
  const originalError = console.error;
  try {
    await git(directory, "init", "--bare", origin);
    await git(directory, "clone", origin, firstPath);
    await git(firstPath, "config", "user.name", "Test"); await git(firstPath, "config", "user.email", "test@example.com");
    await fsp.writeFile(path.join(firstPath, "main.txt"), "Main project file\n");
    await git(firstPath, "add", "main.txt"); await git(firstPath, "commit", "-m", "Initial project");
    await git(firstPath, "push", "origin", "HEAD");
    await git(directory, "clone", origin, secondPath);
    const first = createClient(firstPath), second = createClient(secondPath);
    const mainBranch = await git(firstPath, "symbolic-ref", "--short", "HEAD");
    const unicodeId = "café-🚀".normalize("NFD"), unicodeText = "á😀中文\n".repeat(30000);
    const seed = makeBoard();
    seed.tasks[unicodeId] = { ...copy(seed.tasks.task), id: unicodeId, title: "Área 中文 🚀", description: unicodeText };
    await first.DataManager.initializeBoard(); await first.DataManager.saveBoard(seed);
    assert.equal((await first.GitService.syncBoard()).success, true, "first sync creates the technical branch");
    const firstSynced = await first.DataManager.loadBoard();
    assert.equal(firstSynced.sync.pendingChanges, false);
    assert.match(firstSynced.sync.lastRemoteCommit, /^[0-9a-f]{40,64}$/);
    assert.equal((await first.GitService.readBoardFromCommit(firstPath, firstSynced.sync.lastRemoteCommit, ".vscode/lynvo")).tasks.task.title, "Original title");
    assert.equal((await first.GitService.readBoardFromCommit(firstPath, firstSynced.sync.lastRemoteCommit, ".vscode/lynvo")).tasks[unicodeId].description, unicodeText, "batch blob byte offsets and stream chunks preserve Unicode text and decomposed filename IDs");
    const unicodeWriter = path.join(directory, "unicode-writer"), canonicalId = unicodeId.normalize("NFC");
    const unicodeBoard = makeBoard();
    unicodeBoard.tasks = { [unicodeId]: { ...copy(seed.tasks[unicodeId]), description: "Small Unicode filename fixture" } };
    await first.GitService.writeBoardToFolder(unicodeWriter, unicodeBoard, directory);
    const unicodeNamesBefore = await fsp.readdir(path.join(unicodeWriter, "tasks"));
    unicodeBoard.tasks = { [canonicalId]: { ...copy(unicodeBoard.tasks[unicodeId]), id: canonicalId, title: "Updated canonical ID" } };
    await first.GitService.writeBoardToFolder(unicodeWriter, unicodeBoard, directory);
    assert.deepEqual(await fsp.readdir(path.join(unicodeWriter, "tasks")), unicodeNamesBefore, "NFD filenames stay in place when the JSON ID is canonically equivalent NFC");
    assert.equal((await first.GitService.readBoardFromFolder(unicodeWriter, directory)).tasks[canonicalId].title, "Updated canonical ID");

    // Construct a Git tree containing canonically equivalent filenames without
    // checking it out: macOS would collapse the two names during checkout.
    const object = (value) => first.GitService.execGit(["hash-object", "-w", "--stdin"], { cwd: firstPath, input: JSON.stringify(value) });
    const tree = (entries) => first.GitService.execGit(["mktree"], { cwd: firstPath, input: `${entries.join("\n")}\n` });
    const duplicateTask = { ...copy(seed.tasks[unicodeId]), id: canonicalId, description: "Duplicate ID fixture" };
    const duplicateOid = await object(duplicateTask);
    const duplicateTasks = await tree([`100644 blob ${duplicateOid}\t${canonicalId}.json`, `100644 blob ${duplicateOid}\t${unicodeId}.json`]);
    const boardTree = await tree([
      `100644 blob ${await object({ version: "2.0.0", labels: {} })}\tboard.json`,
      `100644 blob ${await object(seed.columns)}\tcolumns.json`, `040000 tree ${duplicateTasks}\ttasks`,
    ]);
    const vscodeTree = await tree([`040000 tree ${boardTree}\tlynvo`]);
    const rootTree = await tree([`040000 tree ${vscodeTree}\t.vscode`]);
    const duplicateCommit = await git(firstPath, "commit-tree", rootTree, "-m", "Duplicate Unicode filename fixture");
    await assert.rejects(first.GitService.readBoardFromCommit(firstPath, duplicateCommit, ".vscode/lynvo"), /Duplicate baseline task ID/);
    await second.DataManager.initializeBoard();
    assert.equal((await second.GitService.syncBoard()).success, true);
    assert.equal(Object.keys((await second.DataManager.loadBoard()).conflicts).length, 0, "a pristine project adopts the team board without false default-column conflicts");

    // Two clients edit distinct fields and column/label metadata independently.
    await first.DataManager.editTask("task", "Local title", "Original description", ["label"], "medium");
    await second.DataManager.editTask("task", "Original title", "Remote description", ["label"], "medium");
    await second.DataManager.editColumn("todo", "Remote To Do", "#00ffff");
    assert.equal((await second.GitService.syncBoard()).success, true);
    assert.equal((await first.GitService.syncBoard()).success, true);
    let latest = await first.DataManager.loadBoard();
    assert.equal(latest.tasks.task.title, "Local title"); assert.equal(latest.tasks.task.description, "Remote description");
    assert.equal(latest.columns.todo.title, "Remote To Do"); assert.equal(Object.keys(latest.conflicts).length, 0);

    // Pause at fetch and enqueue a real local edit after the initial snapshot.
    const originalFirstExec = first.GitService.execGit;
    let editDuringFetch = true;
    first.GitService.execGit = async function(args, options) {
      if (args[0] === "fetch" && editDuringFetch) {
        editDuringFetch = false;
        await first.DataManager.editTask("task", "Edited during fetch", "Remote description", ["label"], "medium");
      }
      return originalFirstExec.call(this, args, options);
    };
    assert.equal((await first.GitService.syncBoard()).success, true);
    assert.equal((await first.DataManager.loadBoard()).tasks.task.title, "Edited during fetch");
    first.GitService.execGit = originalFirstExec;

    // A late edit is retained and stays pending even when the earlier push succeeds.
    let editDuringPush = true;
    first.GitService.execGit = async function(args, options) {
      const result = await originalFirstExec.call(this, args, options);
      if (args[0] === "push" && editDuringPush) {
        editDuringPush = false;
        await first.DataManager.editTask("task", "Edited during push", "Remote description", ["label"], "medium");
      }
      return result;
    };
    assert.equal((await first.GitService.syncBoard()).success, true);
    latest = await first.DataManager.loadBoard();
    assert.equal(latest.tasks.task.title, "Edited during push"); assert.equal(latest.sync.pendingChanges, true);
    const pushed = await first.GitService.readBoardFromCommit(firstPath, latest.sync.lastRemoteCommit, ".vscode/lynvo");
    assert.equal(pushed.tasks.task.title, "Edited during fetch");
    first.GitService.execGit = originalFirstExec;
    assert.equal((await first.GitService.syncBoard()).success, true);
    assert.equal((await first.DataManager.loadBoard()).sync.pendingChanges, false);

    // Another client wins the race between fetch and push. The retry must merge it.
    assert.equal((await second.GitService.syncBoard()).success, true);
    await first.DataManager.editTask("task", "Race local title", "Remote description", ["label"], "medium");
    await second.DataManager.editTask("task", "Edited during push", "Race remote description", ["label"], "medium");
    let race = true, pushCalls = 0;
    first.GitService.execGit = async function(args, options) {
      if (args[0] === "push") {
        pushCalls++;
        if (race) {race = false; assert.equal((await second.GitService.syncBoard()).success, true);}
      }
      return originalFirstExec.call(this, args, options);
    };
    assert.equal((await first.GitService.syncBoard()).success, true, "a rejected push is merged and retried");
    assert.equal(pushCalls, 2);
    latest = await first.DataManager.loadBoard();
    assert.equal(latest.tasks.task.title, "Race local title"); assert.equal(latest.tasks.task.description, "Race remote description");
    assert.equal(Object.values(latest.conflicts).some((conflict) => !conflict.resolved), false);
    first.GitService.execGit = originalFirstExec;

    // A rewritten remote history must use the true common ancestor, not the
    // last sent snapshot as if it still belonged to the new remote branch.
    const rewrittenPath = await fsp.realpath(await fsp.mkdtemp(path.join(directory, "rewritten-")));
    await git(firstPath, "worktree", "add", "--force", "--detach", rewrittenPath, firstSynced.sync.lastRemoteCommit);
    try {
      const rewritten = await first.GitService.readBoardFromCommit(firstPath, firstSynced.sync.lastRemoteCommit, ".vscode/lynvo");
      rewritten.tasks.task.description = "Rewritten remote description";
      rewritten.tasks.task.updatedAt = Date.now();
      await first.GitService.writeBoardToFolder(path.join(rewrittenPath, ".vscode", "lynvo"), rewritten, rewrittenPath);
      await git(rewrittenPath, "add", "-f", ".vscode/lynvo");
      await git(rewrittenPath, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Rewrite remote history");
      await git(rewrittenPath, "push", "--force", "origin", "HEAD:refs/heads/lynvo-sync");
      const rewrittenHead = await git(rewrittenPath, "rev-parse", "HEAD");
      const commonBase = await first.GitService.loadMergeBase(firstPath, latest.sync.lastRemoteCommit, rewrittenHead, ".vscode/lynvo");
      assert.equal(commonBase.tasks.task.title, "Original title");
      assert.equal((await first.GitService.syncBoard()).success, true);
      latest = await first.DataManager.loadBoard();
      assert.equal(latest.tasks.task.title, "Race local title", "unchanged fields from a rewritten history cannot erase local work");
      assert.equal(latest.tasks.task.description, "Race remote description");
      assert.equal(latest.conflicts["task-task-description"].remoteValue, "Rewritten remote description");
      assert.equal(latest.conflicts["task-task-title"], undefined);
      assert.equal((await second.GitService.syncBoard()).success, true);
      await first.DataManager.resolveConflict("task-task-description", "remote", copy(latest.conflicts["task-task-description"]));
      assert.equal((await first.GitService.syncBoard()).success, true);
      assert.equal((await second.GitService.syncBoard()).success, true);
      const resolved = await second.DataManager.loadBoard();
      assert.equal(resolved.tasks.task.description, "Rewritten remote description");
      assert.equal(resolved.conflicts["task-task-description"].resolved, true, "a resolution shared by another client is accepted without reopening");
    } finally {
      await git(firstPath, "worktree", "remove", "--force", rewrittenPath);
    }

    // Deleting a column remains deleted after another client's stale board syncs.
    assert.equal((await second.GitService.syncBoard()).success, true);
    await first.DataManager.deleteColumn("todo");
    assert.equal((await first.GitService.syncBoard()).success, true);
    assert.equal((await second.GitService.syncBoard()).success, true);
    latest = await second.DataManager.loadBoard();
    assert.equal(latest.tasks.task, undefined); assert.equal(latest.columns.todo, undefined);

    const invalidPath = await fsp.realpath(await fsp.mkdtemp(path.join(directory, "invalid-")));
    const beforeInvalid = await first.DataManager.loadBoard();
    const validHead = beforeInvalid.sync.lastRemoteCommit;
    await git(firstPath, "worktree", "add", "--force", "--detach", invalidPath, validHead);
    try {
      await fsp.writeFile(path.join(invalidPath, ".vscode", "lynvo", "metadata", "version.json"), '{"schemaVersion":"99.0.0"}\n');
      await git(invalidPath, "add", "-f", ".vscode/lynvo/metadata/version.json");
      await git(invalidPath, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Invalid remote metadata fixture");
      await git(invalidPath, "push", "--force", "origin", "HEAD:refs/heads/lynvo-sync");
      const invalidHead = await git(invalidPath, "rev-parse", "HEAD");
      console.error = () => {};
      const rejected = await first.GitService.syncBoard();
      console.error = originalError;
      assert.equal(rejected.success, false); assert.match(rejected.message, /schema metadata/);
      const afterInvalid = await first.DataManager.loadBoard();
      for (const field of ["tasks", "columns", "labels", "conflicts", "tombstones", "activity"]) {
        assert.deepEqual(afterInvalid[field], beforeInvalid[field], "invalid remote JSON must not mutate local board content");
      }
      assert.equal(await git(origin, "rev-parse", "refs/heads/lynvo-sync"), invalidHead, "an invalid remote snapshot is never overwritten by a fallback");
      await git(firstPath, "push", "--force", "origin", `${validHead}:refs/heads/lynvo-sync`);
    } finally {
      console.error = originalError;
      await git(firstPath, "worktree", "remove", "--force", invalidPath);
    }

    // Failed networking must not clear pending state or alter the active branch.
    const beforeOffline = await first.DataManager.loadBoard();
    await git(firstPath, "remote", "set-url", "origin", path.join(directory, "missing-origin.git"));
    console.error = () => {};
    assert.equal((await first.GitService.syncBoard()).success, false);
    console.error = originalError;
    latest = await first.DataManager.loadBoard();
    assert.deepEqual(latest.tasks, beforeOffline.tasks); assert.equal(latest.sync.pendingChanges, true);
    assert.equal(await git(firstPath, "symbolic-ref", "--short", "HEAD"), mainBranch);
    assert.equal(await git(firstPath, "status", "--porcelain"), "", "project files stay untouched");
    assert.equal((await git(firstPath, "worktree", "list", "--porcelain")).split("worktree ").length - 1, 1, "temporary worktrees are removed");
    const boardRoot = path.join(firstPath, ".vscode", "lynvo");
    assert.deepEqual((await fsp.readdir(boardRoot)).sort(), ["activity", "board.json", "columns.json", "comments", "metadata", "settings.json", "tasks", "users.json"]);
    assert.equal(fs.existsSync(path.join(firstPath, ".vscode", "lynvo.json")), false, "no legacy board is created");

    // Git timeout and cancellation kill the command and its hook subprocesses.
    const hook = path.join(firstPath, ".git", "hooks", "pre-commit");
    await fsp.writeFile(hook, "#!/bin/sh\nsleep 10\n", { mode: 0o755 });
    const start = Date.now();
    await assert.rejects(first.GitService.execGit(["commit", "--allow-empty", "-m", "Timeout test"], { cwd: firstPath, timeoutMs: 100 }), /timed out/);
    assert.ok(Date.now() - start < 3000, "timeout must terminate child hooks too");
    first.GitService.activeSyncController = new AbortController();
    const cancelPromise = first.GitService.execGit(["commit", "--allow-empty", "-m", "Cancellation test"], { cwd: firstPath });
    setTimeout(() => first.GitService.cancelScheduledSync(), 100);
    await assert.rejects(cancelPromise, /cancelled/);
    first.GitService.activeSyncController = undefined;
  } finally {
    console.error = originalError;
    await fsp.rm(directory, { recursive: true, force: true });
  }
};

(async () => {
  testMerge();
  await testWorkspaceScheduling();
  await testRealGit();
  process.stdout.write("Sync regression tests passed (three-way merge, real Git/two clients, concurrent edits, push races, deletion, timeout, cancellation).\n");
})().catch((error) => {console.error(error); process.exitCode = 1;});
