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
  id: string;              // "task-{taskId}-{field}"
  entityType: "task";
  entityId: string;        // taskId
  field: "title" | "description" | "status" | "priority" | "dueDate";
  localValue: string | number | null;
  remoteValue: string | number | null;
  createdAt: number;
  resolved: boolean;
}
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

This is the convention used by the extension for unauthenticated automated operations.

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

## Markdown Description Format

Task descriptions support rich markdown rendered by the webview:

```markdown
- [ ] Unchecked checklist item
- [x] Completed checklist item

- Bullet list item

> Blockquote for notes or context

`inline code` for technical references

```typescript
code blocks with language hint
```

[Link text](https://example.com) for external links
```

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

## Due Date States

The webview calculates due date states for display:
- **`none`**: No dueDate set
- **`future`**: Due date is more than 3 days away
- **`soon`**: Due date is within the next 3 days
- **`overdue`**: Due date has passed and task is not in a "done" column

## Sync System

### How Sync Works

1. **Shadow branch pattern**: All sync happens on a dedicated Git branch `lynvo-sync`
2. **Temporary worktree**: A temporary Git worktree is created in the OS temp directory (`/tmp/lynvo-sync-*` on Linux, `/var/folders/...` on macOS) for merge operations
3. **Isolation**: The `.vscode/lynvo/` folder is excluded from the active worktree via `.git/info/exclude`
4. **Merge strategy**: Local and remote boards are merged per task; the task with newer `updatedAt` wins entirely. Fields that differ between local and remote tasks (with different timestamps) are recorded as conflict entries, not auto-resolved.
5. **Conflict detection**: Fields that differ between local and remote (with different timestamps) create conflict records
6. **Tombstone handling**: Deleted entities are tracked to prevent resurrection during merges
7. **Push retry**: Push is attempted twice with different ref specs before failing
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
| `table` | Spreadsheet-like task overview with sortable columns |
| `activity` | Chronological feed of all board changes |
| `conflicts` | Sync conflict resolution UI with diff view |
| `insights` | Project metrics (total, completed, rate, overdue, stale, in-progress) |
| `labels` | Label creation and deletion manager |

### Board View Features
- Drag-and-drop tasks between columns
- Inline task editing (title, description, labels, priority, due date)
- Checklist management (add, toggle, edit, delete items)
- Task relations management (add/remove relations with type selector)
- Column management (add, edit, reorder, delete)
- Search and filter by label or priority
- Task card shows: title, priority badge, labels, checklist progress, due date indicator, code reference indicator

### Table View Features
- Two modes: `rows` (spreadsheet) and `map` (node graph)
- Row mode: sortable columns for all task fields
- Map mode: draggable circular nodes with zoom/pan, relation lines, side panel for details

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

## Webview Message Protocol

### Outbound Messages (webview → extension)

| Command | Payload |
|---|---|
| `requestData` | `{}` |
| `syncBoard` | `{}` |
| `updateTaskStatus` | `{ taskId, newStatus }` |
| `reorderTasks` | `{ updates: [{ id, status, position, isDraggedTask? }] }` |
| `createTask` | `{ title, description, targetColId, labelIds, priority, dueDate?, codeReference? }` |
| `editTask` | `{ taskId, title, description, labelIds, priority, dueDate? }` |
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
| `resolveConflict` | `{ conflictId, resolution: "local" | "remote" }` |
| `openCode` | `{ filePath, lineStart, lineEnd }` |

### Inbound Messages (extension → webview)

| Command | Payload |
|---|---|
| `loadData` | `{ data: LynvoBoard | null }` |
| `switchView` | `{ view: "board" | "table" | "activity" | "conflicts" | "insights" | "labels" }` |

## File Watcher

The extension watches `**/.vscode/lynvo/**/*.json` for changes and refreshes the webview automatically. This means any direct file edits will be picked up within ~250ms.

## Data Integrity Features

- **Atomic writes**: Files are written to a temp file first, then renamed
- **Corrupt backup**: If JSON parsing fails, the corrupt file is backed up with `.corrupt-{timestamp}` suffix
- **Board integrity check**: On load, missing fields are filled with defaults, orphaned tasks are reassigned to valid columns
- **Write queue**: Mutations are serialized through a promise queue to prevent race conditions
- **Activity pruning**: Only the 500 most recent activity entries are kept
- **Orphaned file cleanup**: On save, files that don't correspond to in-memory entities are deleted

## Legacy Migration

Projects with the old `.vscode/lynvo.json` single-file format are automatically migrated:
1. The legacy file is read and parsed
2. Data is split into the modular structure
3. The modular files are written
4. The legacy file is left intact (not deleted)

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
5. **Use relations** to document dependencies between tasks (`blocks`, `blocked-by`, `related`, `duplicates`)
6. **Set due dates** when there are time constraints (convert dates to Unix timestamps in milliseconds)
7. **Apply labels** to categorize work (`bug`, `feat`, or create custom labels)
8. **Create activity entries** for every meaningful change so the Activity Feed stays accurate
9. **Move tasks to `done`** only when the work is fully complete and verified
10. **Trigger sync** after significant changes if working in a team environment
11. **Use the write queue pattern** — if making multiple mutations, serialize them to avoid race conditions
12. **Always update `updatedAt`** and `lastModifiedBy` on every task mutation
13. **When deleting**, always create a tombstone entry to prevent the entity from reappearing after sync
14. **Use the `openCode` message** to navigate the user to code references from the board

## Important Operational Notes

### `openCode` Security
The `openCode` message validates file paths: must be relative (no `..`, no absolute paths, no drive letters). Only workspace-relative paths are accepted.

### `deleteColumn` Side Effect
Deleting a column also deletes **all tasks** that were in that column. Use with caution.

### Sync Merge Behavior
During sync, the entire task with the newer `updatedAt` wins — not individual fields. Fields that differ between local and remote versions of the same task are recorded as conflict entries in `metadata/conflicts.json` for manual resolution.

### `settings.json`
The extension writes `settings.json` as an empty object `{}` on every save. Do not store custom data there.

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
| Resolve conflict | Modify `tasks/{taskId}.json` + update `metadata/conflicts.json` | — |
