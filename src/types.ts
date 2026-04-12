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

// NUEVO: Definición de una Columna
export interface LynvoColumn {
  id: string; // Identificador único (ej: "col-123")
  title: string; // Nombre visible (ej: "En espera")
  color: string; // Color en formato Hex o CSS variable
  position: number;
}

// NUEVO: Definición de una Etiqueta
export interface LynvoLabel {
  id: string;
  name: string;
  color: string;
}

export interface LynvoTask {
  id: string;
  title: string;
  description: string;
  status: string; // Ahora apunta al ID de una columna dinámica
  createdBy: LynvoUser;
  lastModifiedBy: LynvoUser;
  createdAt: number;
  updatedAt: number;
  codeReference?: CodeReference;
  position?: number;
  labelIds?: string[]; // Referencia a las etiquetas
  priority?: "low" | "medium" | "high";
}

export interface LynvoBoard {
  version: string;
  columns: Record<string, LynvoColumn>; // NUEVO: Diccionario de columnas
  tasks: Record<string, LynvoTask>;
  labels?: Record<string, LynvoLabel>; // NUEVO: Diccionario de etiquetas
}
