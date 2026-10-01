---
name: lynvo
description: Local-first Kanban board extension. Use when creating, editing, or managing tasks, columns, labels, checklists, or sync operations in a workspace with .vscode/lynvo/
license: MIT
---

# Lynvo Integration Skill

Use this skill when working on projects that have the **Lynvo** VS Code extension installed. Lynvo is a local-first Kanban project board that stores data in `.vscode/lynvo/` and syncs via a Git shadow branch (`lynvo-sync`).

## When to Use

- The workspace contains `.vscode/lynvo/` directory
- The user wants tasks tracked on the Lynvo board
- You are planning multi-step work and want progress visible on the board
- The user explicitly asks you to use Lynvo for task tracking

## Data Storage Structure

All board data lives in `.vscode/lynvo/` within the workspace root:

```
.vscode/lynvo/
  board.json          # Schema version + labels registry
  columns.json        # Board columns (id, title, color, position)
  users.json          # Presence data (GitHub users with lastSeenAt)
  settings.json       # User settings (currently empty object)
  tasks/
    {taskId}.json     # One JSON file per task
  comments/           # Reserved for future comments feature
  activity/
    {activityId}.json # One JSON file per activity log entry
  metadata/
    sync.json         # Sync state (status, lastSyncAt, branch, pendingChanges)
    tombstones.json   # Soft-deleted entities (task, column, label)
    conflicts.json    # Unresolved sync conflicts by field
    version.json      # Schema version marker
```

## Complete Type Definitions

### LynvoBoard (assembled from modular files)

```typescript
interface LynvoBoard {
  version: string;              // "2.0.0"
  columns: Record<string, LynvoColumn>;
  tasks: Record<string, LynvoTask>;
  labels?: Record<string, LynvoLabel>;      // Optional — filled with defaults on load
  users?: Record<string, LynvoPresenceUser>; // Optional — filled with defaults on load
  activity?: Record<string, LynvoActivity>;  // Optional — filled with defaults on load
  sync?: LynvoSyncMetadata;                  // Optional — filled with defaults on load
  tombstones?: Record<string, LynvoTombstone>; // Optional — filled with defaults on load
  conflicts?: Record<string, LynvoConflict>;   // Optional — filled with defaults on load
}
```

### LynvoColumn

```typescript
interface LynvoColumn {
  id: string;       // e.g. "todo", "in-progress", "done"
  title: string;    // e.g. "To Do", "In Progress", "Done"
  color: string;    // CSS color or VS Code theme variable
  position: number; // Sort order (0 = leftmost)
}
```

### LynvoTask

```typescript
interface LynvoTask {
  id: string;                          // Format: "task-{base36timestamp}-{random8}"
  title: string;
  description: string;                 // Markdown: lists, checklists, code, links, quotes
  status: string;                      // Column id reference
  createdBy: LynvoUser;                // { githubId, username, avatarUrl? }
  lastModifiedBy: LynvoUser;
  createdAt: number;                   // Unix timestamp in milliseconds
  updatedAt: number;                   // Unix timestamp in milliseconds
  position?: number;                   // Order within the column (defaults to createdAt)
  labelIds?: string[];                 // Array of label IDs from board.json labels
  priority?: "low" | "medium" | "high";
  dueDate?: number;                    // Unix timestamp in milliseconds
  codeReference?: {                    // Link to source code location
    filePath: string;                  // Relative path from workspace root
    lineStart: number;                 // 1-based line number
    lineEnd: number;                   // 1-based line number
  };
  checklist?: LynvoChecklistItem[];
  relations?: LynvoTaskRelation[];
}
```

### LynvoChecklistItem

```typescript
interface LynvoChecklistItem {
  id: string;        // Format: "check-{base36timestamp}-{random8}"
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### LynvoTaskRelation

```typescript
interface LynvoTaskRelation {
  id: string;          // Format: "rel-{base36timestamp}-{random8}"
  type: "blocks" | "blocked-by" | "related" | "duplicates";
  targetTaskId: string;
  createdAt: number;
}
```

### LynvoLabel

```typescript
interface LynvoLabel {
  id: string;    // Format: "label-{base36timestamp}-{random8}"
  name: string;
  color: string; // Hex color e.g. "#f85149"
}
```

### LynvoActivity

```typescript
interface LynvoActivity {
  id: string;          // Format: "activity-{base36timestamp}-{random8}"
  type: LynvoActivityType;
  message: string;     // Human-readable description
  createdAt: number;
  actor: LynvoUser;
  taskId?: string;     // Primary task affected
  targetTaskId?: string; // Secondary task (for relations)
  metadata?: Record<string, string | number | boolean | null>;
}
```

### LynvoActivityType Values

| Value | When to Use |
|---|---|
| `task_created` | New task created |
| `task_updated` | Task title, description, labels, priority, or dueDate changed |
| `task_moved` | Task moved between columns or reordered within column |
| `task_deleted` | Task removed |
| `column_created` | New board column added |
| `column_updated` | Column title or color changed |
| `column_deleted` | Column removed |
| `label_created` | New label added |
| `label_deleted` | Label removed |
| `checklist_added` | Checklist item added to task |
| `checklist_updated` | Checklist item toggled done/undone or text edited |
| `checklist_deleted` | Checklist item removed from task |
| `relation_added` | Task relation created |
| `relation_deleted` | Task relation removed |

### LynvoSyncMetadata

```typescript
interface LynvoSyncMetadata {
  branch: string;              // "lynvo-sync"
  status: "idle" | "pending" | "syncing" | "synced" | "offline" | "failed" | "conflict";
  pendingChanges: boolean;
  lastSyncAt: number | null;
  lastRemoteCommit: string | null;
  message?: string;
  updatedAt: number;
}
```

### LynvoTombstone

```typescript
interface LynvoTombstone {
  id: string;              // "{entityType}-{entityId}"
  entityType: "task" | "column" | "label";
  entityId: string;
  deletedAt: number;
  deletedBy: LynvoUser;
}
```

### LynvoConflict

```typescript
interface LynvoConflict {
  id: string;              // "{entityType}-{entityId}-{field}"
  entityType: "task" | "column" | "label";
  entityId: string;
  field: "title" | "description" | "status" | "priority" | "dueDate" |
    "checklist" | "relations" | "labelIds" | "codeReference" | "position" | "name" | "color";
  localValue: LynvoConflictValue;
  remoteValue: LynvoConflictValue;
  createdAt: number;
  resolved: boolean;
}

type LynvoConflictValue = string | number | boolean | null | string[] |
  LynvoChecklistItem[] | LynvoTaskRelation[] | CodeReference;
```

### LynvoUser / LynvoPresenceUser

```typescript
interface LynvoUser {
  githubId: string;
  username: string;
  avatarUrl?: string;
}

interface LynvoPresenceUser extends LynvoUser {
  lastSeenAt: number;  // Unix timestamp, active if within last 5 minutes
}
```

## Default Board State

### Default Columns

| ID | Title | Color |
|---|---|---|
| `todo` | To Do | `var(--vscode-charts-blue)` |
| `in-progress` | In Progress | `var(--vscode-charts-yellow)` |
| `done` | Done | `var(--vscode-charts-green)` |

### Default Labels

| ID | Name | Color |
|---|---|---|
| `bug` | Bug | `#f85149` |
| `feat` | Feature | `#a371f7` |

## ID Generation

All IDs follow the pattern: `{prefix}-{base36timestamp}-{random8chars}`
IDs must be safe filename components. Never use path separators, `.`/`..`, absolute paths, or control characters. Record keys and entity IDs must match.

Generate them like this:
- **Timestamp**: `Date.now().toString(36)`
- **Random**: `Math.random().toString(36).slice(2, 10)`
- **Prefixes**: `task`, `col`, `label`, `check`, `rel`, `activity`

Examples:
- Task: `task-m5xk2abc-d7f3g9h1`
- Column: `col-m5xk2def-a1b2c3d4`
- Label: `label-m5xk2ghi-e5f6g7h8`
- Checklist: `check-m5xk2jkl-i9j0k1l2`
- Relation: `rel-m5xk2mno-m3n4o5p6`
- Activity: `activity-m5xk2pqr-q7r8s9t0`

## Default User Identity for Agent Operations

When creating or modifying tasks without GitHub authentication, use this identity:

```json
{ "githubId": "unknown", "username": "Lynvo - Agent" }
```

This is the direct-agent attribution convention. Extension-created unauthenticated changes may use `{ "githubId": "unknown", "username": "Unknown" }`, but AI agents should prefer `Lynvo - Agent` so their direct JSON edits are recognizable.

## Field Defaults (Board Integrity)

The extension fills missing fields on load via `ensureBoardIntegrity()`. You can omit these when creating tasks:

| Field | Default if missing |
|---|---|
| `position` | `createdAt` timestamp |
| `labelIds` | `[]` (empty array) |
| `priority` | `"medium"` |
| `checklist` | `[]` (empty array) |
| `relations` | `[]` (empty array) |
| `createdBy` | `{ githubId: "unknown", username: "Unknown" }` |
| `lastModifiedBy` | copies `createdBy` |
| `updatedAt` | copies `createdAt` |

If a task's `status` references a deleted column, it is reassigned to the leftmost column.

## How to Create and Manage Tasks

### Option A: Via VS Code Commands (Preferred when inside VS Code)

| Command | Purpose |
|---|---|
| `lynvo.quickCreateTask` | Create task via interactive input prompts |
| `lynvo.createTaskFromCode` | Create task from currently selected code (captures codeReference) |
| `lynvo.openBoard` | Open the Kanban board webview |
| `lynvo.openTable` | Open the table view webview |
| `lynvo.openActivity` | Open the activity feed webview |
| `lynvo.openConflicts` | Open the conflict center webview |
| `lynvo.openLabels` | Open the labels manager webview |
| `lynvo.openInsights` | Open the insights/metrics webview |
| `lynvo.syncBoard` | Trigger manual shadow-branch sync |
| `lynvo.connectGitHub` | Authenticate with GitHub for user identity |
| `lynvo.installSkills` | Reinstall bundled Lynvo agent skills into supported agent locations |

### Option B: Direct JSON File Manipulation

When operating outside VS Code or when commands are unavailable, create/edit task files directly.

#### Step 1: Generate IDs

```
taskId = "task-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
activityId = "activity-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
```

#### Step 2: Create the task file

Write to `.vscode/lynvo/tasks/{taskId}.json`:

```json
{
  "id": "task-m5xk2abc-d7f3g9h1",
  "title": "Implement user authentication",
  "description": "Add login/signup flow with GitHub OAuth.\n\n- [ ] Create login page\n- [ ] Add OAuth callback\n- [ ] Store session token",
  "status": "todo",
  "createdBy": {
    "githubId": "unknown",
    "username": "Lynvo - Agent"
  },
  "lastModifiedBy": {
    "githubId": "unknown",
    "username": "Lynvo - Agent"
  },
  "createdAt": 1716300000000,
  "updatedAt": 1716300000000,
  "position": 1716300000000,
  "labelIds": ["feat"],
  "priority": "high",
  "dueDate": 1716904800000,
  "codeReference": {
    "filePath": "src/auth/login.ts",
    "lineStart": 42,
    "lineEnd": 58
  },
  "checklist": [
    {
      "id": "check-m5xk2def-a1b2c3d4",
      "text": "Create login page",
      "done": false,
      "createdAt": 1716300000000,
      "updatedAt": 1716300000000
    }
  ],
  "relations": []
}
```

#### Step 3: Create the activity entry

Write to `.vscode/lynvo/activity/{activityId}.json`:

```json
{
  "id": "activity-m5xk2ghi-e5f6g7h8",
  "type": "task_created",
  "message": "Created \"Implement user authentication\"",
  "actor": {
    "githubId": "unknown",
    "username": "Lynvo - Agent"
  },
  "createdAt": 1716300000000,
  "taskId": "task-m5xk2abc-d7f3g9h1"
}
```

#### Step 4: Mark sync pending

After every direct JSON mutation, update `.vscode/lynvo/metadata/sync.json` while preserving any existing `lastSyncAt` and `lastRemoteCommit` values. Set `pendingChanges: true`; use `status: "conflict"` while unresolved conflicts remain, otherwise `status: "pending"`:

```json
{
  "branch": "lynvo-sync",
  "status": "pending",
  "pendingChanges": true,
  "lastSyncAt": null,
  "lastRemoteCommit": null,
  "message": "Local changes pending sync",
  "updatedAt": 1716300000000
}
```

### Direct JSON Operation Recipes

When VS Code commands are unavailable, follow these recipes exactly. Always read the current board files first, preserve unrelated fields, write an activity entry for every meaningful mutation, and mark sync pending afterward.

| Operation | Required direct edits |
|---|---|
| Move task | Update `tasks/{taskId}.json`: set `status` to an existing column id, update `position` if reordering, set `updatedAt`, set `lastModifiedBy`. Add `task_moved` activity with `metadata.from` and `metadata.to`. |
| Reorder tasks | Update each affected task's `position`, `updatedAt`, and `lastModifiedBy`; add activity for the dragged/primary task. Use numeric positions sorted within the destination column. |
| Edit task | Update `title`, `description`, `labelIds`, `priority`, `dueDate`, `updatedAt`, and `lastModifiedBy`. Add `task_updated` activity. |
| Delete task | Delete `tasks/{taskId}.json`, add `metadata/tombstones.json` entry `task-{taskId}`, remove relations in other tasks that target the deleted task and update their timestamps/actor, and add `task_deleted` activity. |
| Add checklist item | Append a `LynvoChecklistItem` to `checklist`, update task timestamps/actor, and add `checklist_added` activity. |
| Update checklist item | Modify only `text` and/or `done`, update item and task timestamps/actor, and add `checklist_updated` activity. |
| Delete checklist item | Remove the checklist item, update task timestamps/actor, and add `checklist_deleted` activity. |
| Add relation | Add one directed relation to the source task only after confirming both tasks exist, source and target differ, and the same `targetTaskId` + `type` is not already present. Add `relation_added` activity. |
| Delete relation | Remove the relation from the source task by relation id, update task timestamps/actor, and add `relation_deleted` activity. |
| Create column | Reuse an existing case-insensitive column title first. If creating, add a `col-*` entry to `columns.json` with deterministic `position` and add `column_created` activity. |
| Create label | Reuse an existing case-insensitive label name first. If creating, add a `label-*` entry under `board.json.labels` and add `label_created` activity. |
| Resolve conflict | Re-read and verify the conflict still matches the version reviewed. Update the supported task, column, or label field only when choosing or synthesizing a new value; mark the conflict `resolved`. Update task timestamps/actor when its value changes. Set sync metadata to `conflict` if unresolved conflicts remain or `pending` if all are resolved. Do not invent an activity type for conflict resolution. |

## Markdown Description Format

Task descriptions support a Markdown subset rendered by the webview: bullet lists, checkboxes, quotes, fenced code, inline code, and links. This is not a full CommonMark renderer:

````markdown
- [ ] Unchecked checklist item
- [x] Completed checklist item

- Bullet list item

> Blockquote for notes or context

`inline code` for technical references

```typescript
code blocks with language hint
```

[Link text](https://example.com) for external links
````

**Security notes:**
- Links are sanitized: only `http:`, `https:`, `mailto:`, and `#` anchors allowed
- Code blocks are rendered in `<pre><code>` without execution

## Priority Guidelines

| Priority | Color | When to Use |
|---|---|---|
| `high` | `#f85149` (red) | Blocking issues, critical bugs, user-requested features with deadlines |
| `medium` | `#d29922` (yellow) | Standard features, improvements, non-blocking bugs |
| `low` | `#3fb950` (green) | Nice-to-have features, refactoring, documentation |

## Task Relations

| Type | Meaning |
|---|---|
| `blocks` | This task prevents the target task from being done |
| `blocked-by` | This task cannot proceed until the target task is done |
| `related` | This task is connected to the target task (general association) |
| `duplicates` | This task is a duplicate of the target task |

### Dependency Inference for Agents

Before creating a task, scan existing tasks for matching titles, shared code references, parent planning tasks, prerequisites, blockers, and duplicated scope. Add relations proactively when they improve navigation or execution order.

- Use `blocked-by` from the dependent task to the prerequisite task.
- Use `blocks` only when the current task is clearly the prerequisite preventing the target task.
- Use `related` for shared context without ordering, including tasks from the same plan or touching the same subsystem.
- Use `duplicates` for near-identical work; prefer updating the existing task instead of creating a duplicate when possible.
- Do not create reciprocal dependency edges by default. A single directed relation is enough and avoids duplicated map lines.
- Never relate a task to itself, and never add the same `targetTaskId` + `type` twice on one source task.

## Due Date States

The webview calculates due date states for display:
- **`none`**: No dueDate set
- **`future`**: Due date is more than 3 days away
- **`soon`**: Due date is within the next 3 days
- **`overdue`**: Task card display marks any past dueDate as overdue. Insights metrics exclude tasks in done-like columns from the overdue count.

Insights recognizes the default `done` and `in-progress` column IDs even after their titles change. If a default ID is absent, the existing title-based recognition is used for that workflow category. Completed tasks are excluded from stale metrics as well as overdue metrics.

## Column and Label Stewardship

Agents should keep the board taxonomy useful without creating noisy one-off structure.

### Columns

- Reuse an existing column first, comparing titles case-insensitively and ignoring punctuation differences.
- Create a column only for a real workflow state that will hold multiple tasks or materially improves visibility, such as `Backlog`, `Blocked`, `Review`, or `QA`.
- Place new columns deterministically: `Backlog` before `To Do`; `Blocked` after `To Do`; `Review` or `QA` before done-like columns; otherwise append after the current rightmost non-done column.
- Use clear, workflow-state names. Do not create columns for labels, individual features, people, or temporary notes.
- Do not delete columns autonomously. The extension's `deleteColumn` behavior deletes every task currently in that column.

### Labels

- Reuse existing labels case-insensitively before creating a new label.
- Prefer stable category labels: `bug`, `feat`, `docs`, `test`, `refactor`, `ci`, `security`, `perf`, `ux`, `infra`, and `chore`.
- Create custom labels only when at least two tasks share the category or the user explicitly asks for that category.
- Keep labels noun-like and short. Do not encode status, priority, due date, or assignee as a label.
- Choose readable, stable hex colors. Reuse the nearest existing category color when unsure.

## Sync System

### How Sync Works

1. **Shadow branch pattern**: All sync happens on a dedicated Git branch `lynvo-sync`
2. **Temporary worktree**: A temporary Git worktree is created in the OS temp directory (`/tmp/lynvo-sync-*` on Linux, `/var/folders/...` on macOS) for merge operations
3. **Isolation**: The `.vscode/lynvo/` folder is excluded from the active worktree via `.git/info/exclude`
4. **Merge strategy**: Use the last synchronized Git commit as the common base. Merge task, column, and label fields independently; combine independent changes and merge checklist/relation collections by item ID. Label membership is merged independently.
5. **Conflict detection**: Incompatible concurrent edits produce field conflicts instead of replacing the whole task. Without a common base, incompatible differences are retained as conflicts for review. Edits made locally during sync remain pending until sent.
6. **Tombstone handling**: Deleted entities are tracked to prevent resurrection during merges
7. **Push retry**: A rejected concurrent push triggers fetch, merge, and a new commit before retrying, up to three attempts. Git operations have a timeout and active operations can be cancelled during extension disposal
8. **Cleanup**: Temporary worktree is removed after sync completes

### Sync States

| Status | Meaning |
|---|---|
| `idle` | No sync activity |
| `pending` | Local changes waiting to be synced |
| `syncing` | Sync in progress |
| `synced` | Successfully synced, no conflicts |
| `offline` | Remote unreachable, changes saved locally |
| `failed` | Sync error (not network-related) |
| `conflict` | Sync completed but unresolved conflicts exist |

### Sync Triggers

- **Automatic**: Every 120 seconds via background interval
- **After changes**: 15-second debounce after any task/column/label mutation
- **Manual**: `lynvo.syncBoard` command

### Conflict Resolution

When conflicts are detected:
1. They are stored in `metadata/conflicts.json`
2. The user is prompted to open the Conflict Center
3. Each conflict can be resolved as `"local"` (keep local value) or `"remote"` (accept remote value)
4. When resolving as `"remote"`, the task field is updated to the remote value

### Autonomous Conflict Resolution for Agents

Agents may resolve conflicts directly when the user has asked for autonomous task management or when a conflict blocks progress. The policies below cover unresolved task conflicts for `title`, `description`, `status`, `priority`, and `dueDate`. For collection fields or column/label conflicts, retain both sides for user review unless the user has provided a policy; never discard unknown conflict shapes.

Resolution procedure:

1. Read `metadata/conflicts.json`, `columns.json`, and the affected task file. Re-read before saving and stop if the conflict changed since review.
2. For each unresolved conflict, choose a value using the field policy below.
3. Apply the chosen value to the task only when it differs from the current task value.
4. Set `conflict.resolved = true`.
5. Update the task's `updatedAt` and `lastModifiedBy` if the task field changed.
6. Update `metadata/sync.json`: use `status: "conflict"` while unresolved conflicts remain, otherwise `status: "pending"` with `pendingChanges: true`.

Field policy:

| Field | Autonomous resolution rule |
|---|---|
| `title` | Prefer the non-empty, non-placeholder, more specific title. If both are useful, choose the clearer title that mentions the concrete subsystem or action. |
| `description` | Prefer the value that is a strict superset. If both contain unique information, synthesize both with headings `Local notes` and `Remote notes`, preserving all non-duplicate content. |
| `status` | Choose the furthest valid workflow stage by column position, preferring done-like columns when one side is done-like. If the chosen status does not exist, use the other valid status; if neither exists, use the leftmost column. |
| `priority` | Choose the higher urgency using `high > medium > low`. If one value is invalid, use the valid value; if both are invalid, use `medium`. |
| `dueDate` | Choose the earlier non-null numeric due date. If one side is null or invalid, use the valid date; if both are null or invalid, clear `dueDate`. |

General rule: non-empty beats empty when the field policy does not decide. Do not invent unsupported fields, unsupported conflict types, or a new activity type for conflict resolution.

## Presence System

- Users are tracked in `users.json` with `lastSeenAt` timestamps
- A user is considered "active" if `lastSeenAt` is within the last 5 minutes
- Presence is updated via `touchCurrentUser()` on extension activation and every 120 seconds
- Requires GitHub authentication to identify users

## Activity Feed

- Activity entries are stored as individual files in `activity/`
- Maximum 500 entries are kept (oldest are pruned on save)
- Entries are sorted by `createdAt` descending for display
- Filterable by activity type and actor username in the UI

## Webview Views

The extension provides 6 views accessible via the toolbar tabs:

| View | Purpose |
|---|---|
| `board` | Kanban board with drag-and-drop, inline editing, checklists, relations |
| `table` | Spreadsheet-like task overview ordered by last update, plus a relation map |
| `activity` | Chronological feed of all board changes |
| `conflicts` | Sync conflict resolution UI with diff view |
| `insights` | Project metrics (total, completed, rate, overdue, stale, in-progress) |
| `labels` | Label creation and deletion manager |

### Board View Features
- Drag-and-drop tasks between columns
- Inline task editing (title, description, labels, priority, due date)
- Editor checklist and relation changes stay in the draft until Save; Cancel abandons them with the other fields. Save failures keep the editor open, and a newer task version rejects an old draft
- Checklist management (add, toggle, edit, delete items)
- Task relations management (add/remove relations with type selector)
- Column management (add, edit, reorder with buttons, delete)
- Search and filter by label or priority
- Task card shows: title, priority badge, labels, checklist progress, due date indicator, code reference indicator

### Table View Features
- Two modes: `rows` (spreadsheet) and `map` (node graph)
- Row mode: tasks ordered by `updatedAt` descending; headers do not change the sort order
- Map mode: draggable cards grouped by status, automatic framing and Fit, zoom/pan, relation lines, side panel for details. Layout and checklist expansion remain in webview state only.
- Hiding the panel retains its UI context. Editor drafts are also saved to VS Code webview state if VS Code recreates the same webview, and cleared when switching workspaces; task files do not store UI state. Closing the panel explicitly or restarting VS Code is not a supported draft-restoration path.

## VS Code Commands Reference

| Command | Title | Context |
|---|---|---|
| `lynvo.connectGitHub` | Lynvo: Connect GitHub | Activity bar menu |
| `lynvo.openBoard` | Lynvo: Open Project Board | Activity bar menu, Command Palette |
| `lynvo.openInsights` | Lynvo: Open Insights View | Activity bar menu, Command Palette |
| `lynvo.openTable` | Lynvo: Open Table View | Activity bar menu, Command Palette |
| `lynvo.openActivity` | Lynvo: Open Activity Feed | Activity bar menu, Command Palette |
| `lynvo.openConflicts` | Lynvo: Open Conflict Center | Activity bar menu, Command Palette |
| `lynvo.openLabels` | Lynvo: Open Labels Manager | Activity bar menu, Command Palette |
| `lynvo.quickCreateTask` | Lynvo: Quick Create Task | Activity bar menu, Command Palette |
| `lynvo.createTaskFromCode` | Lynvo: Create Task from Selection | Editor context menu (right-click on selection) |
| `lynvo.syncBoard` | Lynvo: Sync Team Board | Activity bar menu, Command Palette |
| `lynvo.installSkills` | Lynvo: Install Agent Skills | Activity bar menu, Command Palette |

## Webview Message Protocol

### Outbound Messages (webview → extension)

| Command | Payload |
|---|---|
| `requestData` | `{}` |
| `syncBoard` | `{}` |
| `updateTaskStatus` | `{ taskId, newStatus }` |
| `reorderTasks` | `{ updates: [{ id, status, position, isDraggedTask? }] }` |
| `createTask` | `{ title, description, targetColId, labelIds, priority, dueDate?, codeReference? }` |
| `editTask` | `{ taskId, title, description, labelIds, priority, dueDate?, expectedUpdatedAt?, checklist?, relations? }` — pass the reviewed task timestamp to reject a stale draft |
| `deleteTask` | `{ taskId }` |
| `addChecklistItem` | `{ taskId, text }` |
| `updateChecklistItem` | `{ taskId, itemId, text?, done? }` |
| `deleteChecklistItem` | `{ taskId, itemId }` |
| `addTaskRelation` | `{ taskId, targetTaskId, relationType }` |
| `deleteTaskRelation` | `{ taskId, relationId }` |
| `createColumn` | `{ title, color }` |
| `editColumn` | `{ colId, title, color }` |
| `deleteColumn` | `{ colId }` |
| `reorderColumns` | `{ updates: [{ id, position }] }` |
| `createLabel` | `{ name, color }` |
| `deleteLabel` | `{ labelId }` |
| `resolveConflict` | `{ conflictId, resolution: "local" | "remote", expectedConflict? }` — include the reviewed conflict snapshot |
| `resolveConflicts` | `{ conflictIds: string[], resolution: "local" | "remote", expectedConflicts? }` — one queued save; include reviewed snapshots keyed by ID. Local retains current values, remote applies the reviewed remote values |
| `openCode` | `{ filePath, lineStart, lineEnd }` |

### Inbound Messages (extension → webview)

| Command | Payload |
|---|---|
| `loadData` | `{ data: LynvoBoard | null, workspaceId? }` |
| `switchView` | `{ view: "board" | "table" | "activity" | "conflicts" | "insights" | "labels" }` |
| `conflictResolutionComplete` | `{ error?: string }` — bulk resolution finished; restores the controls and reports a write failure if present |
| `operationComplete` | `{ requestId, operation, error? }` — completes an outbound message carrying `requestId`; editors close only after a successful save |

## File Watcher

The extension watches `**/.vscode/lynvo/**/*.json` for changes and refreshes the webview after a ~250ms debounce. Reads wait for extension writes to finish. Direct agents should still use atomic writes and avoid simultaneous edits of the same file.

## Data Integrity Features

- **Atomic file writes**: Changed files are written to a temp file first, then renamed; the collection of files is not one filesystem transaction
- **Corrupt backup**: If JSON parsing fails, the corrupt file is backed up with `.corrupt-{timestamp}` suffix
- **Validation**: Invalid JSON shapes and unsafe IDs stop loading and saving. Recover the affected file manually; do not initialize a replacement board or fall back to a stale legacy file
- **Board integrity check**: Optional missing fields are filled with defaults, orphaned tasks are reassigned to valid columns
- **Write queue**: Extension mutations and reads are serialized through a promise queue; external JSON editors do not participate in that queue
- **Activity pruning**: Only the 500 most recent activity entries are kept
- **Orphaned file cleanup**: On save, files that don't correspond to in-memory entities are deleted

## Legacy Migration

Projects with the old `.vscode/lynvo.json` single-file format are automatically migrated only when no modular board exists:
1. The legacy file is read and parsed
2. Data is split into the modular structure
3. The modular files are written
4. The legacy file is left intact (not deleted)

An existing modular board remains authoritative even when it is incomplete or damaged. Loading stops with an error so that its data can be recovered manually; it is never replaced automatically by an old legacy file or an empty board. Updates keep schema `2.0.0` and the existing paths.

## Autonomous Task Workflow for AI Agents

When working on a project with Lynvo, follow this complete workflow:

### Phase 1: Planning — Create a Parent Task with Checklist

Before starting any multi-step work, create a planning task:

```json
{
  "id": "task-{id}",
  "title": "Plan: <feature or fix name>",
  "description": "Autonomous plan generated by AI agent.\n\nEach checklist item represents a step. Items are marked [x] when completed.",
  "status": "in-progress",
  "createdBy": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "lastModifiedBy": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "createdAt": <now>,
  "updatedAt": <now>,
  "position": <now>,
  "priority": "medium",
  "checklist": [
    { "id": "check-{id}", "text": "Analyze existing codebase and dependencies", "done": false, "createdAt": <now>, "updatedAt": <now> },
    { "id": "check-{id}", "text": "Design the implementation approach", "done": false, "createdAt": <now>, "updatedAt": <now> },
    { "id": "check-{id}", "text": "Implement core logic", "done": false, "createdAt": <now>, "updatedAt": <now> },
    { "id": "check-{id}", "text": "Add tests", "done": false, "createdAt": <now>, "updatedAt": <now> },
    { "id": "check-{id}", "text": "Verify and clean up", "done": false, "createdAt": <now>, "updatedAt": <now> }
  ],
  "relations": []
}
```

Also create the matching activity:
```json
{
  "id": "activity-{id}",
  "type": "task_created",
  "message": "Created \"Plan: <feature or fix name>\"",
  "actor": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "createdAt": <now>,
  "taskId": "task-{id}"
}
```

### Phase 2: Execution — Update Progress in Real Time

As you complete each step:

1. **Read the planning task** from `.vscode/lynvo/tasks/{taskId}.json`
2. **Find the relevant checklist item** by matching the `text` field
3. **Update it**: set `done: true` and `updatedAt: <now>`
4. **Update the task**: set `updatedAt: <now>` and `lastModifiedBy`
5. **Write the updated task file** back
6. **Create an activity entry** of type `checklist_updated`:

```json
{
  "id": "activity-{id}",
  "type": "checklist_updated",
  "message": "Completed checklist item in \"Plan: <feature or fix name>\"",
  "actor": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "createdAt": <now>,
  "taskId": "task-{id}"
}
```

### Phase 3: Create Implementation Tasks

For each substantial piece of work identified during planning:

```json
{
  "id": "task-{id}",
  "title": "Implement <specific feature>",
  "description": "Detailed description of what this task covers.\n\n- Context about the change\n- Technical approach\n- Any relevant notes",
  "status": "todo",
  "createdBy": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "lastModifiedBy": { "githubId": "unknown", "username": "Lynvo - Agent" },
  "createdAt": <now>,
  "updatedAt": <now>,
  "position": <now>,
  "priority": "high",
  "labelIds": ["feat"],
  "relations": [
    {
      "id": "rel-{id}",
      "type": "related",
      "targetTaskId": "task-{planning-task-id}",
      "createdAt": <now>
    }
  ],
  "checklist": []
}
```

When the implementation task starts:
- Change status to `"in-progress"`
- Create `task_moved` activity

When the implementation task completes:
- Change status to `"done"`
- Create `task_moved` activity

### Phase 4: Completion — Finalize Everything

1. Move all implementation tasks to `"done"` status
2. Create `task_moved` activity entries for each
3. Mark all checklist items in the planning task as done
4. Move the planning task to `"done"` status
5. Optionally trigger sync via `lynvo.syncBoard` command

## Best Practices for Agents

1. **Always create a planning task first** with a checklist of all steps you plan to execute
2. **Update checklist items as you work** — this gives the user real-time visibility on the board
3. **Use descriptive titles** — they appear on the board cards and in the activity feed
4. **Include code references** when creating tasks from code analysis (use `codeReference` with relative file paths and 1-based line numbers)
5. **Use relations** to document dependencies between tasks (`blocks`, `blocked-by`, `related`, `duplicates`) after scanning existing tasks for prerequisites, duplicates, and shared code references
6. **Set due dates** when there are time constraints (convert dates to Unix timestamps in milliseconds)
7. **Apply labels** to categorize work (`bug`, `feat`, or reusable custom labels); create new labels only for stable categories
8. **Create activity entries** for every meaningful change so the Activity Feed stays accurate
9. **Move tasks to `done`** only when the work is fully complete and verified
10. **Trigger sync** after significant changes if working in a team environment
11. **Use the write queue pattern** — if making multiple mutations, serialize them to avoid race conditions
12. **Always update `updatedAt`** and `lastModifiedBy` on every task mutation
13. **When deleting**, always create a tombstone entry to prevent the entity from reappearing after sync
14. **Use the `openCode` message** to navigate the user to code references from the board
15. **Mark sync pending** after every direct JSON mutation by updating `metadata/sync.json`
16. **Resolve conflicts deterministically** when autonomous operation is requested and the supported field policy can choose a safe value

## Important Operational Notes

### `openCode` Security
The `openCode` message validates file paths: must be relative (no `..`, no absolute paths, no drive letters). Only workspace-relative paths are accepted.

### `deleteColumn` Side Effect
Deleting a column also deletes **all tasks** that were in that column. Use with caution.

### Sync Merge Behavior
Sync merges fields against the last synchronized Git commit and combines independent edits. Incompatible edits produce conflicts for tasks, columns, or labels. Checklist and relation collections are merged by item ID. Without a common base, differing incompatible values are retained for review. `updatedAt` alone never authorizes discarding another side's task.

### `settings.json`
Existing `settings.json` contents are preserved; the extension does not expose settings stored in this file as a user configuration interface.

### Agent Skill Installation
Activation inspects each supported destination independently, including every local folder in a multi-root workspace, and respects each folder's `lynvo.autoInstallSkills` setting. Shared instruction files receive a managed Lynvo block while preserving surrounding project instructions. Dedicated Lynvo files retain their YAML frontmatter. Only unchanged, owned Lynvo content is updated; customized content is preserved even when `lynvo.installSkills` is invoked manually. Uninstall removes only verifiably owned files or blocks. A known previous hash allows safe upgrades of older unmarked Lynvo files.

## Quick Reference: File Operations

| Operation | Files Affected | Activity Type |
|---|---|---|
| Read board | `board.json`, `columns.json`, `tasks/*.json`, `activity/*.json`, `metadata/*.json`, `users.json` | — |
| Create task | Write `tasks/{taskId}.json` + `activity/{activityId}.json` | `task_created` |
| Update task | Modify `tasks/{taskId}.json` + write `activity/{activityId}.json` | `task_updated` |
| Move task | Modify `status` in `tasks/{taskId}.json` + write activity | `task_moved` |
| Delete task | Remove `tasks/{taskId}.json` + update `metadata/tombstones.json` + write activity | `task_deleted` |
| Add checklist | Modify `tasks/{taskId}.json` + write activity | `checklist_added` |
| Toggle checklist | Modify `tasks/{taskId}.json` + write activity | `checklist_updated` |
| Add relation | Modify `tasks/{taskId}.json` + write activity | `relation_added` |
| Create column | Modify `columns.json` + write activity | `column_created` |
| Create label | Modify `board.json` labels + write activity | `label_created` |
| Resolve conflict | Modify the affected task, `columns.json`, or `board.json` label + update `metadata/conflicts.json` | — |
| Mark sync pending | Modify `metadata/sync.json` | — |
