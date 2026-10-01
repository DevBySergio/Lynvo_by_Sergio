import {
  LynvoBoard, LynvoColumn, LynvoConflict, LynvoConflictValue, LynvoLabel,
  LynvoSyncMetadata, LynvoTask, LynvoTombstone,
} from "../types";
import { cloneBoardValue, normalizeBoard, stableStringify } from "../boardValidation";

const equal = (left: unknown, right: unknown) => stableStringify(left ?? null) === stableStringify(right ?? null);
const clone = cloneBoardValue;
const taskFields = ["title", "description", "status", "priority", "dueDate", "position", "codeReference", "checklist", "relations", "labelIds"] as const;

// The base is the last successfully synchronized commit. Incompatible fields
// keep the local provisional value and expose both alternatives as a conflict.
export function mergeBoards(localInput: LynvoBoard, remoteInput: LynvoBoard, baseInput?: LynvoBoard | null): LynvoBoard {
  const local = normalizeBoard(clone(localInput));
  const remote = normalizeBoard(clone(remoteInput));
  const base = baseInput ? normalizeBoard(clone(baseInput)) : undefined;
  const conflicts: Record<string, LynvoConflict> = {};
  for (const conflict of [...Object.values(remote.conflicts || {}), ...Object.values(local.conflicts || {})]) {
    const previous = conflicts[conflict.id];
    if (!previous || conflict.createdAt > previous.createdAt || (conflict.createdAt === previous.createdAt && conflict.resolved)) {
      conflicts[conflict.id] = clone(conflict);
    }
  }
  const tombstones: Record<string, LynvoTombstone> = {};
  for (const item of [...Object.values(remote.tombstones || {}), ...Object.values(local.tombstones || {})]) {
    const key = `${item.entityType}-${item.entityId}`;
    if (!tombstones[key] || item.deletedAt > tombstones[key].deletedAt) {tombstones[key] = { ...clone(item), id: key };}
  }
  const recordConflict = (entityType: LynvoConflict["entityType"], entityId: string, field: LynvoConflict["field"], localValue: unknown, remoteValue: unknown) => {
    const id = `${entityType}-${entityId}-${field}`;
    const previous = conflicts[id];
    if (previous && equal(previous.localValue, localValue) && equal(previous.remoteValue, remoteValue)) {return;}
    if (previous?.resolved && equal(previous.localValue, remoteValue) && equal(previous.remoteValue, localValue)) {return;}
    conflicts[id] = {
      id, entityType, entityId, field,
      localValue: clone((localValue ?? null) as LynvoConflictValue),
      remoteValue: clone((remoteValue ?? null) as LynvoConflictValue),
      createdAt: Math.max(Date.now(), (previous?.createdAt || 0) + 1), resolved: false,
    };
  };
  const mergeValue = (localValue: unknown, remoteValue: unknown, baseValue: unknown, hasBase: boolean, onConflict: () => void, preferLocal = true): unknown => {
    if (equal(localValue, remoteValue)) {return clone(localValue);}
    if (hasBase && equal(localValue, baseValue)) {return clone(remoteValue);}
    if (hasBase && equal(remoteValue, baseValue)) {return clone(localValue);}
    onConflict();
    return clone(preferLocal ? localValue : remoteValue);
  };
  const mergeItems = (localItems: Array<{ id: string }>, remoteItems: Array<{ id: string }>, baseItems: Array<{ id: string }>, hasBase: boolean, preferLocal = true, pending?: LynvoConflict): { items: Array<{ id: string }>; incompatible: boolean } => {
    const localMap = new Map(localItems.map((item) => [item.id, item]));
    const remoteMap = new Map(remoteItems.map((item) => [item.id, item]));
    const baseMap = new Map(baseItems.map((item) => [item.id, item]));
    const pendingLocal = new Map((Array.isArray(pending?.localValue) ? pending.localValue as Array<{ id: string }> : []).map((item) => [item.id, item]));
    const pendingRemote = new Map((Array.isArray(pending?.remoteValue) ? pending.remoteValue as Array<{ id: string }> : []).map((item) => [item.id, item]));
    const items: Array<{ id: string }> = [];
    let incompatible = false;
    for (const id of new Set([...localMap.keys(), ...remoteMap.keys()])) {
      const l = localMap.get(id), r = remoteMap.get(id), b = baseMap.get(id);
      const pl = pendingLocal.get(id), pr = pendingRemote.get(id);
      if (!l || !r) {
        const present = l || r;
        if (pending && !equal(pl, pr) && equal(l, pl)) {
          incompatible = true;
          const selected = preferLocal ? l : r;
          if (selected) {items.push(clone(selected));}
        } else if (hasBase && b) {
          if (equal(present, b)) {continue;}
          // Delete versus edit needs an explicit decision. Keep the local side.
          incompatible = true;
          const selected = preferLocal ? l : r;
          if (selected) {items.push(clone(selected));}
        } else if (present) {items.push(clone(present));}
        continue;
      }
      const merged: Record<string, unknown> = { id };
      for (const field of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (field === "updatedAt") {
          merged[field] = Math.max(Number((l as Record<string, unknown>)[field]) || 0, Number((r as Record<string, unknown>)[field]) || 0);
        } else {
          const lf = (l as Record<string, unknown>)[field], rf = (r as Record<string, unknown>)[field];
          const bf = (b as Record<string, unknown> | undefined)?.[field];
          const plf = (pl as Record<string, unknown> | undefined)?.[field], prf = (pr as Record<string, unknown> | undefined)?.[field];
          const openChoiceChanged = Boolean(pending && !equal(plf, prf) && equal(lf, plf) && !equal(lf, rf) && (!hasBase || !equal(rf, bf)));
          merged[field] = mergeValue(
            lf, rf, bf, Boolean(hasBase && b && !openChoiceChanged),
            () => {incompatible = true;}, preferLocal,
          );
        }
      }
      items.push(merged as { id: string });
    }
    return { items, incompatible };
  };
  const tasks: Record<string, LynvoTask> = {};
  for (const id of new Set([...Object.keys(local.tasks), ...Object.keys(remote.tasks)])) {
    const l = local.tasks[id], r = remote.tasks[id], b = base?.tasks[id];
    if (tombstones[`task-${id}`]) {continue;}
    if (!l || !r) {
      // An explicit deletion is represented by a tombstone. A missing task alone
      // must not erase a task when upgrading an older/incomplete snapshot.
      tasks[id] = clone(l || r);
      continue;
    }
    // The provisional value must match the displayed "local" alternative.
    // Otherwise Keep local keeps the remote value and Discard fails its guard.
    const result = clone(l);
    for (const field of taskFields) {
      const lv = l[field], rv = r[field], bv = b?.[field];
      const conflictId = `task-${id}-${field}`;
      const previous = conflicts[conflictId]?.resolved ? conflicts[conflictId] : local.conflicts?.[conflictId] || conflicts[conflictId];
      const pending = previous && !previous.resolved && equal(previous.localValue, lv) ? previous : undefined;
      let value: unknown;
      if (field === "labelIds" && equal([...(l.labelIds || [])].sort(), [...(r.labelIds || [])].sort()) && !pending) {
        value = clone(lv);
      } else if (field === "labelIds" && b) {
        const ls = new Set(l.labelIds || []), rs = new Set(r.labelIds || []), bs = new Set(b.labelIds || []);
        const pl = new Set((pending?.localValue || []) as string[]), pr = new Set((pending?.remoteValue || []) as string[]);
        const labels = [...new Set([...ls, ...rs, ...pl, ...pr])];
        const selected: string[] = [], alternative: string[] = [];
        for (const labelId of labels) {
          const membership = ls.has(labelId) === rs.has(labelId) ? ls.has(labelId) : ls.has(labelId) === bs.has(labelId) ? rs.has(labelId) : ls.has(labelId);
          const sticky = Boolean(pending && pl.has(labelId) !== pr.has(labelId) && ls.has(labelId) === pl.has(labelId));
          if (sticky ? ls.has(labelId) : membership) {selected.push(labelId);}
          if (sticky ? pr.has(labelId) : membership) {alternative.push(labelId);}
        }
        value = selected;
        if (pending) {recordConflict("task", id, field, selected, alternative);}
      } else if ((field === "checklist" || field === "relations") && !equal(lv, rv) && (pending || !(b && (equal(lv, bv) || equal(rv, bv))))) {
        const merged = mergeItems((lv || []) as Array<{ id: string }>, (rv || []) as Array<{ id: string }>, (bv || []) as Array<{ id: string }>, Boolean(b), true, pending);
        value = merged.items;
        if (merged.incompatible) {
          const alternative = mergeItems((lv || []) as Array<{ id: string }>, (rv || []) as Array<{ id: string }>, (bv || []) as Array<{ id: string }>, Boolean(b), false, pending);
          recordConflict("task", id, field, merged.items, alternative.items);
        }
      } else {
        const openChoiceChanged = Boolean(pending && !equal(lv, rv) && (!b || !equal(rv, bv)));
        value = mergeValue(lv, rv, bv, Boolean(b && !openChoiceChanged), () => recordConflict("task", id, field, lv, rv));
      }
      (result as unknown as Record<string, unknown>)[field] = value;
    }
    result.updatedAt = Math.max(l.updatedAt, r.updatedAt);
    result.lastModifiedBy = clone(l.updatedAt >= r.updatedAt ? l.lastModifiedBy : r.lastModifiedBy);
    tasks[id] = result;
  }
  const mergeEntities = <T extends LynvoColumn | LynvoLabel>(entityType: "column" | "label", localItems: Record<string, T>, remoteItems: Record<string, T>, baseItems?: Record<string, T>): Record<string, T> => {
    const result: Record<string, T> = {};
    for (const id of new Set([...Object.keys(localItems), ...Object.keys(remoteItems)])) {
      if (tombstones[`${entityType}-${id}`]) {continue;}
      const l = localItems[id], r = remoteItems[id], b = baseItems?.[id];
      if (!l || !r) {result[id] = clone(l || r); continue;}
      const item: Record<string, unknown> = { id };
      for (const field of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (field === "id") {continue;}
        const lv = (l as unknown as Record<string, unknown>)[field], rv = (r as unknown as Record<string, unknown>)[field], bv = (b as unknown as Record<string, unknown> | undefined)?.[field];
        const conflictId = `${entityType}-${id}-${field}`;
        const previous = conflicts[conflictId]?.resolved ? conflicts[conflictId] : local.conflicts?.[conflictId] || conflicts[conflictId];
        const openChoiceChanged = Boolean(previous && !previous.resolved && equal(previous.localValue, lv) && !equal(lv, rv) && (!b || !equal(rv, bv)));
        item[field] = mergeValue(
          lv, rv, bv, Boolean(b && !openChoiceChanged),
          () => recordConflict(entityType, id, field as LynvoConflict["field"], (l as unknown as Record<string, unknown>)[field], (r as unknown as Record<string, unknown>)[field]),
        );
      }
      result[id] = item as unknown as T;
    }
    return result;
  };
  const columns = mergeEntities("column", local.columns, remote.columns, base?.columns);
  const labels = mergeEntities("label", local.labels || {}, remote.labels || {}, base?.labels);
  for (const task of Object.values(tasks)) {
    const deletedColumn = tombstones[`column-${task.status}`];
    if (deletedColumn) {
      // Older clients deleted columns without task tombstones. Honor that intent
      // rather than silently moving resurrected remote tasks to another column.
      tombstones[`task-${task.id}`] = { ...clone(deletedColumn), id: `task-${task.id}`, entityType: "task", entityId: task.id };
      delete tasks[task.id];
    }
  }
  for (const task of Object.values(tasks)) {
    task.labelIds = (task.labelIds || []).filter((id) => Boolean(labels[id]));
    task.relations = (task.relations || []).filter((relation) => Boolean(tasks[relation.targetTaskId]));
  }
  for (const conflict of Object.values(conflicts)) {
    const entities = conflict.entityType === "task" ? tasks : conflict.entityType === "column" ? columns : labels;
    const entity = entities[conflict.entityId];
    if (!entity) {delete conflicts[conflict.id]; continue;}
    if (conflict.resolved) {continue;}
    const current = (entity as unknown as Record<string, unknown>)[conflict.field] ?? null;
    if (!equal(current, conflict.localValue)) {
      if ((conflict.field === "checklist" || conflict.field === "relations") && Array.isArray(current) && Array.isArray(conflict.localValue) && Array.isArray(conflict.remoteValue)) {
        conflict.remoteValue = mergeItems(conflict.remoteValue as Array<{ id: string }>, current as Array<{ id: string }>, conflict.localValue as Array<{ id: string }>, true).items as LynvoConflictValue;
      }
      conflict.localValue = clone(current as LynvoConflictValue);
      conflict.createdAt = Math.max(Date.now(), conflict.createdAt + 1);
    }
    if (conflict.field === "relations" && Array.isArray(conflict.remoteValue)) {
      conflict.remoteValue = (conflict.remoteValue as LynvoTask["relations"] || []).filter((relation) => Boolean(tasks[relation.targetTaskId]));
    }
    if (conflict.field === "labelIds" && Array.isArray(conflict.remoteValue)) {
      conflict.remoteValue = (conflict.remoteValue as string[]).filter((labelId) => Boolean(labels[labelId]));
    }
  }
  const users = clone(remote.users || {});
  for (const [id, user] of Object.entries(local.users || {})) {
    if (!users[id] || user.lastSeenAt >= users[id].lastSeenAt) {users[id] = clone(user);}
  }
  const sync: LynvoSyncMetadata = {
    branch: "lynvo-sync", lastSyncAt: null, lastRemoteCommit: null, ...local.sync,
    status: Object.values(conflicts).some((conflict) => !conflict.resolved) ? "conflict" : "syncing",
    pendingChanges: true, message: base ? "Sync merge completed" : "Sync merge completed without a common board baseline", updatedAt: Date.now(),
  };
  return normalizeBoard({ version: "2.0.0", columns, labels, tasks, tombstones, conflicts, users, activity: { ...remote.activity, ...local.activity }, sync });
}
