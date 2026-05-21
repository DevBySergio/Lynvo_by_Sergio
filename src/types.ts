export interface LynvoUser {
  githubId: string;
  username: string;
  avatarUrl?: string;
}

export interface LynvoPresenceUser extends LynvoUser {
  lastSeenAt: number;
}

export interface CodeReference {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

export interface LynvoColumn {
  id: string;
  title: string;
  color: string;
  position: number;
}

export interface LynvoLabel {
  id: string;
  name: string;
  color: string;
}

export interface LynvoChecklistItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LynvoTaskRelationType = "blocks" | "blocked-by" | "related" | "duplicates";

export interface LynvoTaskRelation {
  id: string;
  type: LynvoTaskRelationType;
  targetTaskId: string;
  createdAt: number;
}

export type LynvoActivityType =
  | "task_created"
  | "task_updated"
  | "task_moved"
  | "task_deleted"
  | "column_created"
  | "column_updated"
  | "column_deleted"
  | "label_created"
  | "label_deleted"
  | "checklist_added"
  | "checklist_updated"
  | "checklist_deleted"
  | "relation_added"
  | "relation_deleted";

export interface LynvoActivity {
  id: string;
  type: LynvoActivityType;
  message: string;
  createdAt: number;
  actor: LynvoUser;
  taskId?: string;
  targetTaskId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type LynvoSyncStatus =
  | "idle"
  | "pending"
  | "syncing"
  | "synced"
  | "offline"
  | "failed"
  | "conflict";

export interface LynvoSyncMetadata {
  branch: string;
  status: LynvoSyncStatus;
  pendingChanges: boolean;
  lastSyncAt: number | null;
  lastRemoteCommit: string | null;
  message?: string;
  updatedAt: number;
}

export interface LynvoTombstone {
  id: string;
  entityType: "task" | "column" | "label";
  entityId: string;
  deletedAt: number;
  deletedBy: LynvoUser;
}

export interface LynvoConflict {
  id: string;
  entityType: "task";
  entityId: string;
  field: "title" | "description" | "status" | "priority" | "dueDate";
  localValue: string | number | null;
  remoteValue: string | number | null;
  createdAt: number;
  resolved: boolean;
}

export interface LynvoTask {
  id: string;
  title: string;
  description: string;
  status: string;
  createdBy: LynvoUser;
  lastModifiedBy: LynvoUser;
  createdAt: number;
  updatedAt: number;
  codeReference?: CodeReference;
  position?: number;
  labelIds?: string[];
  priority?: "low" | "medium" | "high";
  dueDate?: number;
  checklist?: LynvoChecklistItem[];
  relations?: LynvoTaskRelation[];
}

export interface LynvoBoard {
  version: string;
  columns: Record<string, LynvoColumn>;
  tasks: Record<string, LynvoTask>;
  labels?: Record<string, LynvoLabel>;
  users?: Record<string, LynvoPresenceUser>;
  activity?: Record<string, LynvoActivity>;
  sync?: LynvoSyncMetadata;
  tombstones?: Record<string, LynvoTombstone>;
  conflicts?: Record<string, LynvoConflict>;
}
