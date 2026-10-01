---
name: lynvo
description: Create, audit, and maintain Lynvo project boards, tasks, columns, labels, checklists, dependencies, and sync state. Use for requested board planning or tracking in workspaces with .vscode/lynvo/, or when the user asks to initialize a Lynvo board. Do not create a board merely because a coding task has several steps.
license: MIT
---

# Lynvo agent operations

Lynvo is a local-first project board stored in `.vscode/lynvo/`. Produce a useful, maintainable plan using the existing board and actual project context. Follow the user's scope, language, workflow, and authorization. A request to review produces findings; a request to organize authorizes relevant board changes; tracking work does not authorize implementing every task or publishing/synchronizing it externally.

## Operational workflow

1. **Locate the board.** Identify the intended workspace folder, including in multi-root projects. Keep every read, write, command, and code reference in that folder. Read project instructions and the requested scope. Do not silently use the first workspace or create a second board in a subdirectory.
2. **Inventory before planning.** Read `board.json`, `columns.json`, every task file, and sync/conflict/tombstone metadata. Read relevant project files and activity when needed to understand existing decisions. Include completed tasks in the search. Record IDs, titles, objectives, status, labels, checklist items, relations, and code references. For large boards, build an index and select relevant candidates; do not rely on a truncated directory listing or UI search alone.
3. **Reconcile the request with existing work.** For each requested outcome, choose reuse, update/extend, create, or report ambiguity using the rules below. Keep a short change plan of affected IDs and genuinely missing entities. Apply it directly within authorized scope; ask only when an unresolved choice would change scope or discard meaningful work. Continue independent work while that choice is pending.
4. **Use native structure.** Assign real workflow states, reusable categories, meaningful priorities, executable checklist criteria, and explicit dependencies. Create missing columns/labels before tasks that reference them. Do not invent project facts, owners, deadlines, code locations, or completed work.
5. **Mutate safely.** Use supported extension UI operations when available. Direct JSON automation must follow the storage and write contracts below, re-reading the board while holding its shared lock. Recheck deduplication and affected snapshots at commit time. Only change intended fields/files.
6. **Verify the result.** Re-read changed records and referenced entities. Validate IDs, schema, timestamps, references, dependency cycles, and preservation of unrelated data. Confirm a repeated request would reuse the result without creating extra tasks, columns, labels, relations, or activity. Report created/updated/reused counts, affected IDs, remaining ambiguities, and actual local/sync state.

When following an existing execution workflow, keep its readiness and acceptance gates. Select work whose prerequisites are actually satisfied. Move a task to an active state only when execution starts; mark checklist items and completion only after the relevant outcome is verified. Record evidence and limitations in the description or a real linked project artifact. A plan, a generated document, or a passing subset of tests does not prove runtime integration or completion of dependent work. Respect an instruction to stop after a particular task.

## Reuse and duplicate prevention

- Compare meaning, not just exact title. Normalize candidate titles/names with Unicode normalization, case folding, trimmed/collapsed whitespace, and punctuation; consider language aliases such as `Review`/`Revisión` and `Bug`/`Error`. Normalization finds candidates; inspect descriptions, deliverables, code references, and scope before deciding they are equivalent.
- **Reuse** a task when the same deliverable and acceptance criteria are already covered. **Extend** it when the request refines that deliverable without introducing independent status or acceptance. Preserve its ID, history, status, timestamps of unchanged checklist items, and valid relations.
- **Create** a task for a distinct, independently verifiable outcome missing from the board. A matching code file or a generic title alone does not establish equivalence. A completed task with the same accepted scope remains completed; a new regression or changed requirement may need a separate linked task explaining the difference.
- Deduplicate checklist items by meaning within the selected task. Retain existing IDs and `done` values; append only missing criteria. Update by stable ID, not text alone. If a changed requirement invalidates a completed criterion, explain that specific change and update it deliberately.
- Reuse a column or label with equivalent meaning even if its spelling, language, or color differs. Keep its existing ID. Never use a tombstoned ID for a new entity.
- Re-read candidates immediately before writing. If another writer already created an equivalent entity, reuse it. If the current task differs from the reviewed snapshot, reconcile or retry from the new state instead of overwriting it.
- Existing duplicates are findings, not permission to delete. Identify the canonical task and propose consolidation; apply a `duplicates` relation or merge/delete only within the requested scope. Preserve useful content, references, and history; deletions require tombstones.

## Choose tasks, checklists, columns, and labels

| Structure | Use it for | Avoid |
|---|---|---|
| Task | A concrete outcome with independent acceptance, state, priority, or dependencies | Generic cards such as “Do development”; one card per trivial action |
| Checklist | Steps or acceptance criteria belonging to the same outcome | Duplicating the checklist in the description; hiding independent tasks as checklist steps |
| Column | A recurring workflow state with a clear entry/exit condition | One column per feature, person, sprint, label, or checklist step |
| Label | A reusable category for filtering: work type, area, risk, release scope | Repeating priority, workflow state, deadline, or every word in the title |
| Relation | A real prerequisite, relevant connection, or duplicate | A fictional parent/child hierarchy or dense links between every task |

Task titles should name an action and its result. Descriptions should contain the problem/context, bounded scope and exclusions when material, implementation constraints, and evidence/technical notes. Use native fields for status, priority, labels, due date, code reference, checklist, and relations. Do not repeat them as Markdown metadata sections. Keep detail proportional to the work; do not inflate every task with boilerplate.

There is no native parent task, epic, assignee, sprint, estimate, custom field, or nested checklist. Do not add those JSON fields. `createdBy`/`lastModifiedBy` identify authors, not assignees; presence does not establish availability or responsibility. An optional index/milestone task can be useful for an explicitly requested roadmap; describe its navigation purpose and link with `related`. Do not automatically create a “Plan:” task before every request or mirror child progress in another checklist. Such cards also count in board metrics.

### Columns

Reuse the current workflow first. Preserve `todo`, `in-progress`, and `done` IDs when they exist, even if renamed or translated. Insights recognizes these IDs; its fallback for missing default IDs looks for English `done`/`progress` in titles, not arbitrary custom completion semantics. Do not create multiple completion columns expecting configurable metrics.

Create a missing state when the requested workflow needs a distinct queue/transition, for example Backlog for not-yet-ready work, Blocked for externally blocked work, Review for review awaiting acceptance, or QA for separate validation. A single relevant task can justify a state; do not require an arbitrary minimum count. Avoid adding every possible state “for completeness.” Decide the entry/exit condition from project context before moving tasks.

Reuse the board's terminology/colors. For a new state, choose a distinguishable hex color or existing VS Code chart variable. Place it intentionally in the workflow (normally Backlog before To Do, Review/QA before Done; Blocked is a side queue). Use unique finite numeric positions; reorder affected columns deterministically. Position controls presentation, not readiness or completeness. Preserve task statuses when renaming/reordering a column.

Deleting a column through Lynvo **also deletes every task in it**. For an authorized consolidation, first move tasks to a valid destination, preserve their ordering and references, verify the column is empty, then delete/tombstone it. Keep at least one valid column. Never rename a column by deleting it and recreating it.

### Labels

Search existing IDs/names and semantic aliases first, including defaults `bug`/Bug and `feat`/Feature. Create a category when it materially improves filtering, planning, or triage and no equivalent exists. Useful examples include Documentation, Tests, Refactor, Security, Performance, UX, Infrastructure, and a project-specific area. These are examples, not a mandatory taxonomy. A security issue may justify a new label for one task. Keep names concise, colors consistent, and `labelIds` unique.

Renaming/recoloring a label through direct JSON preserves its ID and assignments. The current Labels UI supports create/delete; it has no label edit operation. For an authorized merge, replace the retired ID with the canonical ID on affected tasks, deduplicate assignments, then delete/tombstone the retired label. Deleting a label must remove its ID from every task; update affected task timestamps and actors. Do not delete unused labels just because they are unused today.

### Priority, deadlines, and references

Use `low`, `medium`, or `high` based on the user's policy and actual impact, urgency, and blocking value. Retain priorities absent a reason to change them; default new tasks to `medium` when context does not distinguish them. Do not make every implementation task high priority or automatically rank all documentation low.

Set `dueDate` only for a stated/agreed deadline. Parse its date/time with the user's timezone; clarify a consequential ambiguity. Store finite Unix milliseconds, not seconds or an ISO string. Omit an unknown deadline rather than setting zero or guessing an earlier one.

Set `codeReference` only after verifying the workspace-relative file exists and its 1-based inclusive line range is valid. Use no absolute path, drive letter, `..`, or invented line numbers. Omit it for design work without a known location. A task supports one code reference; additional verified paths can appear in its technical description.

### Dependencies and readiness

`A blocks B` means A must complete before B; `B blocked-by A` expresses the same edge. Store one representation per prerequisite pair. `related` is a non-directional conceptual connection; store it once. `duplicates` points from the duplicate to the canonical task. Relations have no parent/child semantics and do not automatically move or schedule tasks.

Resolve both endpoints to existing, non-tombstoned task IDs. Reject self-links, repeated semantic edges, dangling targets, and cycles. Build a prerequisite graph treating `blocks` as source→target and `blocked-by` as target→source; check the complete affected graph before adding edges. Connect only real prerequisites, not all tasks sharing a label or code path. Remove obsolete edges only with evidence or user direction.

Determine readiness from actual prerequisites and required information, not column position. A Blocked state should describe the blocker and an actionable unblock condition. Done requires the task's actual acceptance evidence; never mark all implementation tasks done as an end-of-session cleanup step.

## Storage contract — schema 2.0.0

Keep existing paths and the modular format. Do not create `.vscode/lynvo.json`, “legacy” boards, extra per-board configuration, or new schema fields.

```text
.vscode/lynvo/
  board.json                 { "version": "2.0.0", "labels": { id: label } }
  columns.json               { id: column }
  tasks/{taskId}.json         one task per file
  activity/{activityId}.json  one activity per file
  users.json                 presence records; do not fabricate users
  settings.json              preserve existing contents
  comments/                  reserved; leave existing contents intact
  metadata/sync.json         sync state; patch rather than replace
  metadata/tombstones.json   { id: tombstone }
  metadata/conflicts.json    { id: conflict }
  metadata/version.json      { "schemaVersion": "2.0.0" }
```

An existing modular directory is authoritative, including when incomplete/corrupt. Stop affected writes and report the precise bad/missing file; preserve original bytes and recover from a verified backup/source. Never replace it with defaults or a stale legacy file. The extension migrates a valid legacy `.vscode/lynvo.json` only when the modular root is absent; use that migration rather than inventing a second board.

For a genuinely new board, prefer opening Lynvo in the intended folder to let it initialize. If no extension UI is available and initialization was requested, under the shared lock verify neither modular nor legacy data exists. Build the normal structure in a temporary sibling directory, validate it, recheck absence, then rename into place. Use schema/version above; empty tasks/activity/comments directories; `{}` for users/settings/tombstones/conflicts; sync defaults below. Defaults are `todo` (To Do, position 0, color `var(--vscode-charts-blue)`), `in-progress` (In Progress, 1, `var(--vscode-charts-yellow)`), `done` (Done, 2, `var(--vscode-charts-green)`), and labels `bug` (Bug, `#f85149`) and `feat` (Feature, `#a371f7`). Add custom workflow only when needed. After creating requested content, mark sync pending.

### Entity shapes

| Entity | Fields |
|---|---|
| Column | `id`, `title`, `color`, `position` (finite number) |
| Label | `id`, `name`, `color` |
| User/actor | `githubId`, `username`, optional `avatarUrl` |
| Task | `id`, `title`, `description`, `status` (column ID), `createdBy`, `lastModifiedBy`, `createdAt`, `updatedAt`; optional `position`, `labelIds`, `priority`, `dueDate`, `codeReference`, `checklist`, `relations` |
| Checklist item | `id`, `text`, `done` (boolean), `createdAt`, `updatedAt` |
| Relation | `id`, `type` (`blocks`, `blocked-by`, `related`, `duplicates`), `targetTaskId`, `createdAt` |
| Code reference | `filePath`, `lineStart`, `lineEnd` |
| Activity | `id`, `type`, `message`, `actor`, `createdAt`; optional `taskId`, `targetTaskId`, `metadata` (flat string/number/boolean/null values) |
| Tombstone | `id` = `entityType + "-" + entityId`, `entityType` (`task`, `column`, `label`), `entityId`, `deletedAt`, `deletedBy` |
| Conflict | `id`, `entityType`, `entityId`, `field`, `localValue`, `remoteValue`, `createdAt`, `resolved` |

Record keys must equal entity IDs. Preserve existing IDs and actual filenames, including Unicode filename spelling. For new IDs use safe ASCII `prefix-base36Timestamp-randomHex`, e.g. the factory below, and verify uniqueness across current entities and tombstones. Avoid path separators, control characters, reserved names, trailing spaces/dots, and case/Unicode collisions. Each task/activity filename is its ID plus `.json`; IDs used as filenames must fit within 240 UTF-8 bytes. Never rename every file or regenerate IDs to standardize them.

Timestamps are finite Unix milliseconds. On an actual task mutation set `updatedAt = Math.max(Date.now(), old.updatedAt + 1)` and `lastModifiedBy` to the authenticated actor, or `{ "githubId": "unknown", "username": "Lynvo - Agent" }`. Preserve `createdAt`/`createdBy`. Touch only changed checklist items. No-op requests must not change timestamps, sync state, or history. Task ordering uses `position`, falling back to `createdAt`; use deliberate numeric positions within the destination column.

Description rendering supports paragraphs, hyphen lists/checkbox lists, blockquotes, fenced/inline code, and links. It is a subset of Markdown, not full CommonMark (headings, bold/italic, tables, images, and horizontal rules are not rendered as such). Use native checklists for interactive progress.

## Direct JSON write contract

External agents do not participate in the extension's in-process write queue. Atomic rename protects one file, not the whole board. Use a shared board lock, not an unrelated agent-only lock. This self-contained Node.js recipe matches the extension's lock for an existing local workspace, including symlink aliases, on the same host and with the same OS temporary directory. For remote/virtual workspaces use supported extension operations. The recipe deliberately waits/fails rather than reclaiming someone else's lock. If it times out, stop/retry after inspecting the owner; do not delete an active lock.

```javascript
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isDeepStrictEqual } = require("util");

async function withBoardWrite(workspacePath, operation, timeoutMs = 15000) {
  const real = await fs.realpath(workspacePath);
  const stat = await fs.stat(real, { bigint: true });
  if (!stat.isDirectory()) throw new Error("Expected a workspace directory");
  const key = stat.ino !== 0n
    ? `file:directory:${stat.dev}:${stat.ino}`
    : `file::${process.platform === "win32" ? real.toLowerCase() : real}`;
  const lock = path.join(os.tmpdir(), `lynvo-board-${crypto.createHash("sha256").update(key).digest("hex")}.lock`);
  const owner = path.join(lock, "owner.json");
  const token = crypto.randomBytes(16).toString("hex");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await fs.mkdir(lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Lynvo board is busy; retry from a fresh snapshot");
      await new Promise(resolve => setTimeout(resolve, 30));
      continue;
    }
    try {
      await fs.writeFile(owner, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
    } catch (error) {
      const info = await fs.readFile(owner, "utf8").then(JSON.parse).catch(() => null);
      if (info?.token === token) await fs.rm(lock, { recursive: true, force: true });
      throw error;
    }
    break;
  }
  try {
    return await operation();
  } finally {
    const info = await fs.readFile(owner, "utf8").then(JSON.parse).catch(() => null);
    if (info?.token === token) await fs.rm(lock, { recursive: true, force: true });
  }
}

async function readSnapshot(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected regular file: ${file}`);
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(file, value, expectedRaw) {
  if (expectedRaw !== null && typeof expectedRaw !== "string") throw new Error("A reviewed snapshot is required");
  if (await readSnapshot(file) !== expectedRaw) throw new Error(`Changed externally: ${file}`);
  const content = JSON.stringify(value, null, 2) + "\n";
  if (expectedRaw !== null && isDeepStrictEqual(JSON.parse(expectedRaw), JSON.parse(content))) return false;
  const temporary = `${file}.lynvo-agent-${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    const mode = expectedRaw === null ? 0o600 : (await fs.stat(file)).mode;
    await fs.writeFile(temporary, content, { flag: "wx", mode });
    if (await readSnapshot(file) !== expectedRaw) throw new Error(`Changed externally: ${file}`);
    if (expectedRaw === null) await fs.link(temporary, file);
    else await fs.rename(temporary, file);
    return true;
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

const newId = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
```

This provides lock and file primitives, not a complete validator or transaction. Generate a small operation script outside the board and call `withBoardWrite(workspacePath, async () => { ... })`. Within that callback:

1. Read fresh raw snapshots and parse the whole relevant board; do not treat parse errors as empty data. Recheck matching candidates and reviewed task/conflict versions. Validate that destination paths stay inside the intended modular board; reject symlinked board directories that redirect writes elsewhere (a symlink alias of the workspace itself is supported). Never take another Lynvo command/backend lock inside this callback; read/write files directly there.
2. Construct the full proposed patch in memory and validate every changed entity and reference **before any write**. Preserve unrelated and unknown existing fields. Compare semantic content; skip unchanged operations. Check the dependency graph and label/column IDs after the proposed patch.
3. Recheck all affected/dependency snapshots before the first write, then use `writeJson` with each reviewed raw snapshot. Write new columns/labels before referencing tasks; write updated task references before removing entities. Serialize writes and keep the lock until verification completes. UI readers and sync use this same lock; other raw editors must also cooperate.
4. For deletions, write the tombstone before removing the entity file/record. Remove incoming relations when deleting a task; remove label assignments when deleting a label. Touch affected tasks. Mark surviving conflicts for deleted entities resolved, preserving the records. Never delete arbitrary task files absent from an in-memory/truncated inventory.
5. Add actual activity entries, then patch sync metadata. Re-read and validate the resulting affected board before releasing the lock. If any write fails after partial changes, keep/mark sync pending where possible using fresh metadata, report the exact applied/remaining changes, preserve snapshots outside the board, and re-inventory before recovery. Do not blindly roll back over newer data. File writes are not an all-or-nothing batch.

For a new task, construct fields from verified request data, generate distinct IDs for every task/checklist/relation/activity, set native arrays to `[]` when empty, use the selected existing column ID, and use the actual current timestamp/actor. Do not copy example titles, code paths, deadlines, or placeholder IDs into a user's board.

### Activity and deletion records

Supported activity types are `task_created`, `task_updated`, `task_moved`, `task_deleted`, `column_created`, `column_updated`, `column_deleted`, `label_created`, `label_deleted`, `checklist_added`, `checklist_updated`, `checklist_deleted`, `relation_added`, `relation_deleted`. Record meaningful changes once with truthful actor/message and relevant IDs. The extension prunes to the latest 500 entries; do not rewrite historical activities. There is no `label_updated` or `conflict_resolved` activity type: do not invent one or claim an edit was a creation. Report label edits/conflict decisions in the result; task field changes may use `task_updated`.

Tombstones prevent deleted task/column/label IDs from returning through sync. Preserve previous tombstones; never clear them to “fix” synchronization. A populated column deletion also requires task tombstones and incoming relation cleanup. Prefer moving tasks first when the objective is column consolidation.

### Sync metadata

Only for a newly initialized board, defaults are:

```json
{
  "branch": "lynvo-sync",
  "status": "idle",
  "pendingChanges": false,
  "lastSyncAt": null,
  "lastRemoteCommit": null,
  "updatedAt": 0
}
```

Replace the new-board example's `updatedAt` with the actual creation time. For existing boards, after a real direct mutation **spread the current metadata**, preserving `branch`, `lastSyncAt`, `lastRemoteCommit`, and other existing fields. Set `pendingChanges: true`, `status` to `conflict` if unresolved conflicts remain, otherwise `pending`, and advance `updatedAt` monotonically. Do not reset the merge base or mark local edits `synced`.

The file watcher refreshes the UI after approximately 250 ms; it does not itself schedule the 15-second edit sync used by extension operations. Periodic auto-sync runs roughly every 120 seconds while the extension is active. Timing is not proof of success. A local edit is distinct from a remote push. Trigger `lynvo.syncBoard` only within the user's sync authorization/policy; never force-push, manipulate the shadow branch/worktrees manually, stage unrelated files, or bypass a conflict. The local Git exclusion does not untrack already-versioned board files; do not automatically remove them from the index.

After sync, re-read `sync.json` and conflicts. Report remote synchronization only when the operation succeeded, `pendingChanges` is false, and there are no unresolved conflicts. An offline/failed/conflict state or pending edits remains an explicit limitation even if `lastSyncAt` is recent.

## Conflict handling

Conflicts can affect tasks, columns, or labels. Supported fields are task `title`, `description`, `status`, `priority`, `dueDate`, `checklist`, `relations`, `labelIds`, `codeReference`, `position`; column `title`, `color`, `position`; label `name`, `color`. Arrays and references are structured values, not text to concatenate.

Read the affected entity and both alternatives. Resolve within an explicit user choice or an established, applicable conflict policy. General permission to organize tasks does not select which competing content to discard. If meaning/intent is ambiguous, keep the conflict and present the relevant difference; continue unrelated work. Do not choose the furthest workflow column, highest priority, earliest due date, longest description, or newest timestamp as a universal winner. Empty values can be intentional deletions.

In the Conflict Center, **Keep all** retains current local values; **Discard all** applies reviewed remote values for the displayed unresolved conflicts. These labels describe board conflicts, not deleting tasks or discarding Git files. Verify the displayed scope. Bulk choice requires that choice for every included conflict; do not infer it from a request to “fix sync.”

Use current conflict snapshots, not IDs alone. Via the internal webview bridge, send `expectedConflict` for a single decision, or `expectedConflicts` keyed by ID for a bulk decision; pass the reviewed task `expectedUpdatedAt` for task drafts. If stale, re-read and reconsider. The extension prevalidates bulk snapshots before applying a queued save.

For direct JSON resolution under the shared lock, compare the full reviewed conflict and current entity field with its `localValue` before any write. For local, keep the current field. For remote, apply the reviewed `remoteValue` using its field's supported representation and validate the resulting entity and references. A `null` for task `dueDate`, `position`, or `codeReference` removes the optional field; collection fields use `[]` for absence, and an absent priority normalizes to `medium`. Required fields must remain valid; stop/report an invalid remote choice instead of guessing a replacement. Mark the existing conflict `resolved: true`, retain its alternatives/history, touch a task only if its field changed, and mark sync pending. Validate every decision in a bulk batch before the first write. Do not merge checklist/relations arrays by replacing independent items arbitrarily.

When a direct edit changes a field with an unresolved conflict, preserve `remoteValue`, update that conflict's `localValue` to the actual new local value (use `null` for an absent optional field), and advance its `createdAt` so stale decisions cannot apply. Do not mark it resolved unless the competing versions were actually reconciled under the user's policy.

## Supported controls and boundaries

Public VS Code commands are interactive entry points, not a programmatic task CRUD API. Use UI tooling only when available; do not assume shell commands can execute these or arbitrary JSON arguments are accepted:

| Purpose | Commands |
|---|---|
| Open views | `lynvo.openBoard`, `lynvo.openTable`, `lynvo.openActivity`, `lynvo.openConflicts`, `lynvo.openLabels`, `lynvo.openInsights` |
| Interactive creation | `lynvo.quickCreateTask`, `lynvo.createTaskFromCode` (current editor selection) |
| Connection/sync | `lynvo.connectGitHub`, `lynvo.syncBoard` |
| Skill installation | `lynvo.installSkills` |

Board supports columns/task drag ordering, search/filtering, native checklist expansion/collapse, and task editors. Table offers List and Map with zoom/pan/Fit and relations. Map is a view of existing tasks, not a second board or file format. Activity/Insights/Conflicts/Labels read the same modular data. A filter can hide tasks without deleting them; inspect files before reporting missing work. UI search covers task title/description, not all native fields; Insights counts the whole board, independently of those filters.

The webview message protocol is an **internal extension bridge**, usable only when a real bridge is available, not a general HTTP/MCP/CLI API. Relevant mutations:

| Message | Payload fields |
|---|---|
| `createTask` | `title`, `description`, `targetColId`, `labelIds`, `priority`, optional `dueDate`, `codeReference` |
| `editTask` | `taskId`, `title`, `description`, `labelIds`, `priority`, optional `dueDate`, `expectedUpdatedAt`, `checklist`, `relations` |
| `updateTaskStatus` / `reorderTasks` | `taskId`, `newStatus` / `updates: [{ id, status, position, isDraggedTask? }]` |
| `deleteTask` | `taskId` |
| `addChecklistItem` / `updateChecklistItem` / `deleteChecklistItem` | `taskId`, `text` / `taskId`, `itemId`, optional `text`, `done` / `taskId`, `itemId` |
| `addTaskRelation` / `deleteTaskRelation` | `taskId`, `targetTaskId`, `relationType` / `taskId`, `relationId` |
| `createColumn` / `editColumn` / `deleteColumn` | `title`, `color` / `colId`, `title`, `color` / `colId` |
| `reorderColumns` | `updates: [{ id, position }]` |
| `createLabel` / `deleteLabel` | `name`, `color` / `labelId` |
| `resolveConflict` | `conflictId`, `resolution: "local" or "remote"`, `expectedConflict` |
| `resolveConflicts` | `conflictIds`, `resolution`, `expectedConflicts` |
| `openCode` | workspace-relative `filePath`, `lineStart`, `lineEnd` |

Use `requestData` to refresh and `syncBoard` for an authorized sync. `loadData` provides the board and workspace identity; carry that reviewed `workspaceId` and a unique `requestId` with mutations. A mutation with `requestId` receives `operationComplete` with its operation and optional error; bulk conflict resolution also provides `conflictResolutionComplete`. Wait for completion and verify fresh data; sending a message is not evidence of a successful save. If an acknowledgement is lost, re-read before retrying a creation. Do not use creation messages to simulate label editing or undocumented fields.

## Completion report

State the requested outcome and actual changes, linking relevant tasks/artifacts where the host supports it. For a substantial organization/audit, give concise created/updated/reused counts, workflow/label decisions, dependency or integrity findings, and remaining work. Separate verified completion, local persistence, and remote synchronization. Do not call the board synchronized, the project finished, or the version bug-free without corresponding evidence.

This SKILL is self-contained because Lynvo installs only its `SKILL.md` body. Activation updates verified managed copies/blocks for supported agent destinations in enabled local workspace folders and existing global targets; customized instructions and surrounding project text are preserved. A customized installed copy may therefore require the user to integrate these changes manually. Do not overwrite such copies or install into unrelated agent directories to force adoption.
