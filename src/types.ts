// src/types.ts

export interface LynvoUser {
  githubId: string;
  username: string;
  avatarUrl?: string;
}

export interface CodeReference {
  filePath: string;
  lineStart: number;
  lineEnd?: number;
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

export type LynvoPriority = "low" | "medium" | "high";

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
  priority?: LynvoPriority;
  dueDate?: number;
  archived?: boolean;
}

export interface LynvoBoard {
  version: string;
  columns: Record<string, LynvoColumn>;
  tasks: Record<string, LynvoTask>;
  labels?: Record<string, LynvoLabel>;
}
