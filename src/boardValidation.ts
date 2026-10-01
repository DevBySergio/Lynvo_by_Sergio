import { LynvoBoard, LynvoChecklistItem, LynvoConflict, LynvoTaskRelation, LynvoUser } from "./types";
import { deserialize, serialize } from "v8";

// VS Code 1.80's extension host runs Node 16, before global structuredClone.
export const cloneBoardValue = <T>(value: T): T => deserialize(serialize(value));
export const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const unknownUser = { githubId: "unknown", username: "Unknown" };
const user = (value: unknown): LynvoUser => record(value)
  ? { githubId: text(value.githubId, "unknown"), username: text(value.username, "Unknown"),
    ...(typeof value.avatarUrl === "string" ? { avatarUrl: value.avatarUrl } : {}) }
  : { ...unknownUser };

// IDs are filenames on every supported platform. Reject path components and
// prototype keys without changing existing human-readable task IDs.
export const isSafeEntityId = (id: unknown): id is string => typeof id === "string" &&
  Buffer.from(id, "utf8").toString("utf8") === id &&
  id.length > 0 && id.length <= 1024 && !/[\\/\u0000-\u001f<>:"|?*]/.test(id) &&
  !/[. ]$/.test(id) && ![".", "..", "__proto__", "constructor", "prototype"].includes(id) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id);

export const stableStringify = (value: unknown): string => {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : record(item) ? Object.fromEntries(Object.keys(item).sort()
      .filter((key) => item[key] !== undefined).map((key) => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value)) ?? "null";
};

const records = (value: unknown, label: string): Record<string, Record<string, unknown>> => {
  if (value === undefined) {return {};}
  if (!record(value)) {throw new Error(`Invalid ${label}: expected a JSON object.`);}
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, item] of Object.entries(value)) {
    if (!isSafeEntityId(id) || !record(item)) {throw new Error(`Invalid ${label} entry: ${id}.`);}
    if (item.id !== undefined && item.id !== id) {throw new Error(`Mismatched ${label} ID: ${id}.`);}
    result[id] = { ...item, id };
  }
  return result;
};

export const normalizeChecklist = (value: unknown, timestamp = Date.now()): LynvoChecklistItem[] => {
  if (value === undefined || value === null) {return [];}
  if (!Array.isArray(value)) {throw new Error("Invalid checklist: expected an array.");}
  const seen = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !isSafeEntityId(item.id) || seen.has(item.id)) {throw new Error("Invalid checklist item ID.");}
    if (item.text !== undefined && item.text !== null && typeof item.text !== "string") {
      throw new Error("Invalid checklist item text.");
    }
    if (item.done !== undefined && item.done !== null && typeof item.done !== "boolean") {
      throw new Error("Invalid checklist completion value.");
    }
    seen.add(item.id);
    return { ...item, id: item.id, text: text(item.text), done: item.done === true,
      createdAt: finite(item.createdAt, timestamp), updatedAt: finite(item.updatedAt, timestamp) };
  });
};

export const normalizeRelations = (value: unknown): LynvoTaskRelation[] => {
  if (value === undefined || value === null) {return [];}
  if (!Array.isArray(value)) {throw new Error("Invalid relations: expected an array.");}
  const seen = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !isSafeEntityId(item.id) || seen.has(item.id) ||
      !isSafeEntityId(item.targetTaskId) || !["blocks", "blocked-by", "related", "duplicates"].includes(String(item.type))) {
      throw new Error("Invalid task relation.");
    }
    seen.add(item.id);
    return { ...item, id: item.id, targetTaskId: item.targetTaskId,
      type: item.type as LynvoTaskRelation["type"], createdAt: finite(item.createdAt, 0) };
  });
};

export const normalizeBoard = (value: unknown, defaults?: LynvoBoard): LynvoBoard => {
  if (!record(value)) {throw new Error("Invalid board: expected a JSON object.");}
  const raw = cloneBoardValue(value);
  if (raw.version !== undefined && typeof raw.version !== "string") {
    throw new Error("Invalid Lynvo schema version. The board has been left untouched.");
  }
  if (typeof raw.version === "string" && raw.version !== "2.0.0" && !/^[01]\.\d+\.\d+$/.test(raw.version)) {
    throw new Error(`Unsupported Lynvo schema ${raw.version}. The board has been left untouched.`);
  }
  const columns = records(raw.columns, "columns");
  if (!Object.keys(columns).length) {
    Object.assign(columns, cloneBoardValue(defaults?.columns || {
      todo: { id: "todo", title: "To Do", color: "var(--vscode-charts-blue)", position: 0 },
    }));
  }
  Object.values(columns).forEach((column, index) => {
    if ([column.title, column.color].some((value) => value !== undefined && value !== null && typeof value !== "string")) {
      throw new Error(`Invalid column text fields in ${column.id}.`);
    }
    column.title = text(column.title, "Untitled"); column.color = text(column.color, "var(--vscode-charts-blue)");
    column.position = finite(column.position, index);
  });
  const firstColumn = Object.values(columns).sort((a, b) => Number(a.position) - Number(b.position))[0].id;
  const labels = records(raw.labels === undefined ? defaults?.labels : raw.labels, "labels");
  Object.values(labels).forEach((label) => {
    if ([label.name, label.color].some((value) => value !== undefined && value !== null && typeof value !== "string")) {
      throw new Error(`Invalid label text fields in ${label.id}.`);
    }
    label.name = text(label.name, "Untitled"); label.color = text(label.color, "#58a6ff");
  });
  const tasks = records(raw.tasks, "tasks");
  const taskNames = new Set<string>();
  for (const task of Object.values(tasks)) {
    const name = String(task.id).normalize("NFC").toLowerCase();
    if (Buffer.byteLength(String(task.id), "utf8") > 240 || taskNames.has(name)) {throw new Error("Task IDs collide or exceed the filesystem filename limit.");}
    taskNames.add(name);
    if ([task.title, task.description].some((value) => value !== undefined && value !== null && typeof value !== "string")) {
      throw new Error(`Invalid text fields in task ${task.id}. The file has been left untouched.`);
    }
    task.title = text(task.title, "Untitled task"); task.description = text(task.description);
    if ([task.status, task.priority].some((value) => value !== undefined && value !== null && typeof value !== "string")) {
      throw new Error(`Invalid status or priority in task ${task.id}. The file has been left untouched.`);
    }
    task.status = typeof task.status === "string" && hasOwn(columns, task.status) ? task.status : firstColumn;
    task.createdAt = finite(task.createdAt, 0); task.updatedAt = finite(task.updatedAt, Number(task.createdAt));
    task.createdBy = user(task.createdBy); task.lastModifiedBy = user(task.lastModifiedBy ?? task.createdBy);
    task.priority = ["low", "medium", "high"].includes(String(task.priority)) ? task.priority : "medium";
    if (task.labelIds !== undefined && task.labelIds !== null && (!Array.isArray(task.labelIds) || !task.labelIds.every(isSafeEntityId))) {
      throw new Error(`Invalid label IDs in task ${task.id}.`);
    }
    task.labelIds = Array.isArray(task.labelIds) ? [...new Set(task.labelIds)] : [];
    task.checklist = normalizeChecklist(task.checklist, Number(task.updatedAt));
    task.relations = normalizeRelations(task.relations);
    for (const field of ["dueDate", "position"] as const) {
      if (task[field] !== undefined && task[field] !== null && (typeof task[field] !== "number" || !Number.isFinite(task[field]))) {
        throw new Error(`Invalid ${field} in task ${task.id}. The file has been left untouched.`);
      }
    }
    if (typeof task.dueDate !== "number" || !Number.isFinite(task.dueDate)) {delete task.dueDate;}
    if (typeof task.position !== "number" || !Number.isFinite(task.position)) {delete task.position;}
    if (task.codeReference !== undefined) {
      const ref = task.codeReference;
      if (!record(ref) || typeof ref.filePath !== "string" || !Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) ||
        Number(ref.lineStart) < 1 || Number(ref.lineEnd) < Number(ref.lineStart)) {
        throw new Error(`Invalid code reference in task ${task.id}. The file has been left untouched.`);
      }
    }
  }
  const users = records(raw.users, "users");
  // Presence IDs are account keys, not entity IDs stored inside each user.
  for (const [id, presence] of Object.entries(users)) {users[id] = { ...user(presence), lastSeenAt: finite(presence.lastSeenAt, 0) };}
  const activity = records(raw.activity, "activity");
  const activityNames = new Set<string>();
  Object.values(activity).forEach((event) => {
    const name = String(event.id).normalize("NFC").toLowerCase();
    if (Buffer.byteLength(String(event.id), "utf8") > 240 || activityNames.has(name)) {throw new Error("Activity IDs collide or exceed the filesystem filename limit.");}
    activityNames.add(name);
    event.message = text(event.message); event.type = text(event.type, "task_updated");
    event.actor = user(event.actor); event.createdAt = finite(event.createdAt, 0);
  });
  const tombstones = records(raw.tombstones, "tombstones");
  for (const item of Object.values(tombstones)) {
    if (!["task", "column", "label"].includes(String(item.entityType)) || !isSafeEntityId(item.entityId) ||
      typeof item.deletedAt !== "number" || !Number.isFinite(item.deletedAt)) {throw new Error("Invalid deletion record. The board has been left untouched.");}
    item.deletedBy = user(item.deletedBy);
  }
  const conflicts = records(raw.conflicts, "conflicts");
  const fields = {
    task: ["title", "description", "status", "priority", "dueDate", "checklist", "relations", "labelIds", "codeReference", "position"],
    column: ["title", "color", "position"], label: ["name", "color"],
  };
  for (const item of Object.values(conflicts)) {
    if (!hasOwn(fields, String(item.entityType)) || !isSafeEntityId(item.entityId) ||
      !fields[item.entityType as keyof typeof fields].includes(String(item.field))) {throw new Error("Unsupported conflict record. The board has been left untouched.");}
    item.createdAt = finite(item.createdAt, 0); item.resolved = item.resolved === true;
    item.localValue ??= null; item.remoteValue ??= null;
  }
  if (raw.sync !== undefined && !record(raw.sync)) {throw new Error("Invalid sync metadata. The file has been left untouched.");}
  const sync = record(raw.sync) ? raw.sync : {};
  const validStatuses = ["idle", "pending", "syncing", "synced", "offline", "failed", "conflict"];
  return {
    ...raw, version: "2.0.0", columns, tasks, labels, users, activity, tombstones, conflicts,
    sync: { ...sync, branch: text(sync.branch, "lynvo-sync"),
      status: validStatuses.includes(String(sync.status)) ? sync.status : "idle",
      pendingChanges: sync.pendingChanges === true, lastSyncAt: typeof sync.lastSyncAt === "number" ? sync.lastSyncAt : null,
      lastRemoteCommit: typeof sync.lastRemoteCommit === "string" ? sync.lastRemoteCommit : null,
      updatedAt: finite(sync.updatedAt, 0) },
  } as unknown as LynvoBoard;
};

export const getBoardContentFingerprint = (board: LynvoBoard): string => {
  const { sync: _sync, users: _users, ...content } = board;
  return stableStringify(content);
};

export const conflictSnapshotMatches = (actual: LynvoConflict, expected: LynvoConflict) =>
  stableStringify(actual) === stableStringify(expected);
