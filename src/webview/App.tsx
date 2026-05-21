import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LynvoActivity,
  LynvoBoard,
  LynvoColumn,
  LynvoTask,
  LynvoTaskRelationType,
} from "../types";

type WebviewOutboundMessage =
  | { command: "requestData" }
  | { command: "syncBoard" }
  | { command: "updateTaskStatus"; taskId: string; newStatus: string }
  | {
      command: "reorderTasks";
      updates: Array<{
        id: string;
        status: string;
        position: number;
        isDraggedTask?: boolean;
      }>;
    }
  | {
      command: "createTask";
      title: string;
      description: string;
      targetColId: string;
      labelIds: string[];
      priority: Priority;
      dueDate?: number;
    }
  | {
      command: "editTask";
      taskId: string;
      title: string;
      description: string;
      labelIds: string[];
      priority: Priority;
      dueDate?: number;
    }
  | { command: "deleteTask"; taskId: string }
  | { command: "addChecklistItem"; taskId: string; text: string }
  | { command: "updateChecklistItem"; taskId: string; itemId: string; text?: string; done?: boolean }
  | { command: "deleteChecklistItem"; taskId: string; itemId: string }
  | {
      command: "addTaskRelation";
      taskId: string;
      targetTaskId: string;
      relationType: LynvoTaskRelationType;
    }
  | { command: "deleteTaskRelation"; taskId: string; relationId: string }
  | { command: "createColumn"; title: string; color: string }
  | { command: "editColumn"; colId: string; title: string; color: string }
  | { command: "deleteColumn"; colId: string }
  | { command: "reorderColumns"; updates: Array<{ id: string; position: number }> }
  | { command: "createLabel"; name: string; color: string }
  | { command: "deleteLabel"; labelId: string }
  | { command: "resolveConflict"; conflictId: string; resolution: "local" | "remote" }
  | { command: "openCode"; filePath: string; lineStart: number; lineEnd: number };

declare const acquireVsCodeApi: () => {
  postMessage: (msg: WebviewOutboundMessage) => void;
};
const vscode = acquireVsCodeApi();

type LynvoView = "board" | "table" | "activity" | "conflicts" | "insights" | "labels";

type Priority = "low" | "medium" | "high";
type TableMode = "rows" | "map";
type MapNodePosition = { x: number; y: number };
type MapDragState = {
  taskId: string;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};
type MapPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
};

const minMapZoom = 0.55;
const maxMapZoom = 1.85;
const mapZoomStep = 0.15;

const clampMapZoom = (value: number): number =>
  Math.max(minMapZoom, Math.min(maxMapZoom, Math.round(value * 100) / 100));

type WebviewInboundMessage =
  | { command: "loadData"; data: LynvoBoard | null }
  | { command: "switchView"; view: LynvoView };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isLynvoView = (value: unknown): value is LynvoView =>
  value === "board" ||
  value === "table" ||
  value === "activity" ||
  value === "conflicts" ||
  value === "insights" ||
  value === "labels";

const parseInboundMessage = (value: unknown): WebviewInboundMessage | null => {
  if (!isRecord(value)) {return null;}
  if (value.command === "loadData") {
    return { command: "loadData", data: (value.data as LynvoBoard | null) || null };
  }
  if (value.command === "switchView" && isLynvoView(value.view)) {
    return { command: "switchView", view: value.view };
  }
  return null;
};

const priorityColors: Record<Priority, string> = {
  low: "#3fb950",
  medium: "#d29922",
  high: "#f85149",
};

const relationLabels: Record<LynvoTaskRelationType, string> = {
  blocks: "Blocks",
  "blocked-by": "Blocked by",
  related: "Related",
  duplicates: "Duplicates",
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const toDateInputValue = (timestamp?: number) => {
  if (!timestamp) {return "";}
  const dt = new Date(timestamp);
  const year = dt.getFullYear();
  const month = `${dt.getMonth() + 1}`.padStart(2, "0");
  const day = `${dt.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromDateInputValue = (value: string): number | undefined => {
  if (!value) {return undefined;}
  const ts = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
};

const getTaskPriority = (task: LynvoTask): Priority => task.priority || "medium";

const getReadableTextColor = (hexColor: string): string => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
  if (!match) {return "var(--vscode-foreground)";}

  const red = parseInt(match[1], 16);
  const green = parseInt(match[2], 16);
  const blue = parseInt(match[3], 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? "#0d1117" : "#ffffff";
};

const getDueState = (task: LynvoTask): "none" | "future" | "soon" | "overdue" => {
  if (!task.dueDate) {return "none";}
  const now = Date.now();
  if (task.dueDate < now) {return "overdue";}
  return task.dueDate - now < 1000 * 60 * 60 * 24 * 3 ? "soon" : "future";
};

const hashTaskId = (taskId: string): number =>
  taskId.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 17);

const getDefaultMapPosition = (
  task: LynvoTask,
  taskIndex: number,
  columns: LynvoColumn[],
  mapWidth: number,
  mapHeight: number,
): MapNodePosition => {
  const hash = hashTaskId(task.id);
  const columnIndex = Math.max(0, columns.findIndex((column) => column.id === task.status));
  const columnRatio = columns.length <= 1 ? 0.5 : columnIndex / Math.max(columns.length - 1, 1);
  const wave = Math.sin((hash % 360) * (Math.PI / 180));
  const ring = 90 + (hash % 260);
  const x = 160 + columnRatio * (mapWidth - 320) + wave * 80;
  const y = mapHeight / 2 + Math.cos(taskIndex * 1.8 + hash) * ring;

  return {
    x: Math.max(90, Math.min(mapWidth - 90, x)),
    y: Math.max(90, Math.min(mapHeight - 90, y)),
  };
};

const sanitizeMarkdownHref = (href: string): string | null => {
  try {
    const parsed = new URL(href);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? href : null;
  } catch {
    return href.startsWith("#") ? href : null;
  }
};

const renderInlineText = (text: string) => {
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} style={{ background: "var(--vscode-textCodeBlock-background)", padding: "1px 4px", borderRadius: "3px" }}>
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const safeHref = sanitizeMarkdownHref(linkMatch[2]);
      if (!safeHref) {
        return <React.Fragment key={index}>{linkMatch[1]}</React.Fragment>;
      }

      return (
        <a
          key={index}
          href={safeHref}
          rel="noreferrer"
          style={{ color: "var(--vscode-textLink-foreground)" }}
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

const renderRichText = (text: string) => {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push(
          <pre key={`code-${index}`} style={{ overflowX: "auto", background: "var(--vscode-textCodeBlock-background)", padding: "8px", borderRadius: "4px", fontSize: "11px" }}>
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    const checklistMatch = line.match(/^\s*-\s+\[( |x)\]\s+(.+)$/i);
    if (checklistMatch) {
      blocks.push(
        <div key={index} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={checklistMatch[1].toLowerCase() === "x"} readOnly />
          <span>{renderInlineText(checklistMatch[2])}</span>
        </div>,
      );
      return;
    }

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch) {
      blocks.push(
        <div key={index} style={{ paddingLeft: "10px" }}>
          • {renderInlineText(listMatch[1])}
        </div>,
      );
      return;
    }

    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={index} style={{ margin: "4px 0", paddingLeft: "8px", borderLeft: "2px solid var(--vscode-widget-border)", color: "var(--vscode-descriptionForeground)" }}>
          {renderInlineText(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
      return;
    }

    blocks.push(
      <div key={index}>
        {line.trim() ? renderInlineText(line) : <br />}
      </div>,
    );
  });

  if (codeLines.length > 0) {
    blocks.push(
      <pre key="code-tail" style={{ overflowX: "auto", background: "var(--vscode-textCodeBlock-background)", padding: "8px", borderRadius: "4px", fontSize: "11px" }}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }

  return blocks;
};

const formatConflictValue = (value: string | number | null): string =>
  value === null || value === undefined || value === "" ? "Empty" : String(value);

const renderConflictDiff = (
  localValue: string | number | null,
  remoteValue: string | number | null,
) => {
  const localText = formatConflictValue(localValue);
  const remoteText = formatConflictValue(remoteValue);
  const localLines = localText.split("\n");
  const remoteLines = remoteText.split("\n");
  const lineCount = Math.max(localLines.length, remoteLines.length);

  if (lineCount <= 1 && localText.length < 90 && remoteText.length < 90) {
    return null;
  }

  return (
    <div style={{ border: "1px solid var(--vscode-widget-border)", borderRadius: "6px", overflow: "hidden", marginBottom: "10px" }}>
      {Array.from({ length: lineCount }).map((_, index) => {
        const localLine = localLines[index] ?? "";
        const remoteLine = remoteLines[index] ?? "";
        const changed = localLine !== remoteLine;
        if (!changed) {
          return (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
              <div style={{ padding: "4px 8px", borderRight: "1px solid var(--vscode-widget-border)" }}>{localLine || " "}</div>
              <div style={{ padding: "4px 8px" }}>{remoteLine || " "}</div>
            </div>
          );
        }

        return (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", fontSize: "11px" }}>
            <div style={{ padding: "4px 8px", borderRight: "1px solid var(--vscode-widget-border)", backgroundColor: "rgba(248, 81, 73, 0.14)" }}>
              {localLine || " "}
            </div>
            <div style={{ padding: "4px 8px", backgroundColor: "rgba(63, 185, 80, 0.14)" }}>
              {remoteLine || " "}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const lynvoStyles = `
  :root {
    color-scheme: light dark;
    --lynvo-border: var(--vscode-widget-border, #3d444d);
    --lynvo-panel: var(--vscode-sideBar-background, #161b22);
    --lynvo-panel-strong: var(--vscode-editorWidget-background, #1f242c);
    --lynvo-card-bg: var(--vscode-editor-background, #0d1117);
    --lynvo-hover: var(--vscode-list-hoverBackground, #1f2937);
    --lynvo-radius: 8px;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--vscode-foreground, #e6edf3);
    background: var(--vscode-editor-background, #0d1117);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }

  button, input, select, textarea {
    font: inherit;
  }

  button {
    min-height: 28px;
    border-radius: 6px;
    border: 1px solid var(--lynvo-border);
    background: var(--vscode-button-secondaryBackground, #30363d);
    color: var(--vscode-button-secondaryForeground, #f0f6fc);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, #3d444d);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  input, select, textarea {
    border-radius: 6px;
    border: 1px solid var(--vscode-input-border, var(--lynvo-border));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    outline: none;
  }

  input:focus, select:focus, textarea:focus, button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .lynvo-shell {
    height: 100vh;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 12px;
    padding: 16px;
    overflow: hidden;
  }

  .lynvo-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;
  }

  .lynvo-stat {
    background: var(--lynvo-panel-strong);
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    padding: 10px 12px;
  }

  .lynvo-stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
  }

  .lynvo-stat-value {
    font-size: 21px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .lynvo-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    border-bottom: 1px solid var(--lynvo-border);
    padding-bottom: 10px;
  }

  .lynvo-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .lynvo-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 6px;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0;
    color: var(--vscode-foreground);
  }

  .lynvo-brand-mark {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: transparent;
    color: var(--vscode-foreground, #f0f6fc);
    display: inline-grid;
    place-items: center;
    font-size: 12px;
    font-weight: 800;
  }

  .lynvo-brand-mark::before {
    content: "";
    width: 3px;
    height: 12px;
    border-radius: 2px;
    background: #58a6ff;
    box-shadow: 6px -3px 0 #3fb950, 12px 2px 0 #d29922;
  }

  .lynvo-tab {
    padding: 5px 10px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
  }

  .lynvo-tab.active {
    background: var(--vscode-button-background);
    border-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .lynvo-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }

  .lynvo-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .lynvo-search {
    width: 220px;
    padding: 6px 8px;
  }

  .lynvo-board {
    display: flex;
    gap: 12px;
    min-height: 0;
    overflow-x: auto;
    align-items: stretch;
    padding-bottom: 10px;
  }

  .lynvo-column {
    flex: 0 0 320px;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    background: var(--lynvo-panel);
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    padding: 12px;
    scrollbar-color: var(--vscode-scrollbarSlider-background, #30363d) transparent;
  }

  .lynvo-column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    position: sticky;
    top: -12px;
    z-index: 5;
    padding: 12px 0 10px;
    background: var(--lynvo-panel);
    border-bottom: 1px solid var(--lynvo-border);
    box-shadow: 0 8px 12px -10px rgba(0, 0, 0, 0.75);
  }

  .lynvo-column-title {
    min-width: 0;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .lynvo-count {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    font-weight: 600;
  }

  .lynvo-card {
    background: var(--lynvo-card-bg);
    border: 1px solid var(--lynvo-border);
    padding: 12px;
    margin-bottom: 10px;
    border-radius: var(--lynvo-radius);
    position: relative;
    box-shadow: 0 1px 2px rgba(0,0,0,0.18);
    transition: border-color 120ms ease, transform 120ms ease, background 120ms ease;
  }

  .lynvo-card:hover {
    border-color: var(--vscode-focusBorder);
    transform: translateY(-1px);
  }

  .icon-btn {
    width: 26px;
    min-width: 26px;
    min-height: 26px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
  }

  .icon-btn.delete:hover {
    border-color: #f85149;
    color: #f85149;
  }

  .lynvo-table-shell {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 10px;
  }

  .lynvo-view-switcher {
    display: inline-flex;
    width: max-content;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    background: var(--lynvo-panel);
  }

  .lynvo-view-switcher button {
    min-height: 26px;
    padding: 4px 10px;
    border: 0;
    background: transparent;
    color: var(--vscode-descriptionForeground);
  }

  .lynvo-view-switcher button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .lynvo-map-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .lynvo-map-controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    background: var(--lynvo-panel);
  }

  .lynvo-map-controls button {
    min-width: 30px;
    min-height: 26px;
    padding: 0 8px;
  }

  .lynvo-map-zoom-value {
    min-width: 48px;
    text-align: center;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .lynvo-map-layout {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 10px;
  }

  .lynvo-task-map {
    position: relative;
    min-height: 520px;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    background:
      radial-gradient(circle at center, rgba(88, 166, 255, 0.12), transparent 34%),
      radial-gradient(circle at 70% 28%, rgba(63, 185, 80, 0.08), transparent 24%),
      radial-gradient(circle at 28% 72%, rgba(210, 153, 34, 0.08), transparent 22%),
      var(--lynvo-panel);
  }

  .lynvo-task-map.panning {
    cursor: grabbing;
  }

  .lynvo-task-map:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .lynvo-task-map-zoom-surface {
    position: absolute;
    inset: 0;
    min-width: 100%;
    min-height: 100%;
  }

  .lynvo-task-map-canvas {
    position: relative;
    min-width: 100%;
    min-height: 100%;
    transform-origin: 0 0;
    transition: transform 120ms ease;
  }

  .lynvo-task-map-canvas svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .lynvo-map-node {
    position: absolute;
    width: 118px;
    height: 118px;
    min-height: 118px;
    padding: 14px;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.25;
    word-break: break-word;
    overflow: hidden;
    cursor: grab;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 36px rgba(0, 0, 0, 0.28);
    transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
    touch-action: none;
  }

  .lynvo-map-node:hover,
  .lynvo-map-node.selected {
    transform: translate(-50%, -50%) scale(1.05);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 20px 42px rgba(0, 0, 0, 0.38);
  }

  .lynvo-map-node:active {
    cursor: grabbing;
  }

  .lynvo-map-node.link-source {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 5px;
  }

  .lynvo-map-node.overdue {
    opacity: 0.68;
    box-shadow: 0 0 0 4px rgba(248, 81, 73, 0.22), 0 10px 24px rgba(0, 0, 0, 0.28);
  }

  .lynvo-map-node.soon {
    opacity: 0.86;
    box-shadow: 0 0 0 4px rgba(210, 153, 34, 0.22), 0 10px 24px rgba(0, 0, 0, 0.28);
  }

  .lynvo-map-node small {
    display: block;
    margin-top: 4px;
    font-size: 9px;
    font-weight: 700;
    opacity: 0.9;
  }

  .lynvo-map-empty {
    height: 100%;
    min-height: 320px;
    display: grid;
    place-items: center;
    color: var(--vscode-descriptionForeground);
  }

  .lynvo-map-panel {
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--lynvo-border);
    border-radius: var(--lynvo-radius);
    background: var(--lynvo-panel);
    padding: 12px;
  }

  .lynvo-map-panel h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  .lynvo-relation-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--lynvo-border);
  }

  .lynvo-relation-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 11px;
  }

  .lynvo-danger-button {
    color: #f85149;
    border-color: rgba(248, 81, 73, 0.45);
  }

  @media (max-width: 820px) {
    .lynvo-shell {
      padding: 10px;
    }

    .lynvo-toolbar {
      grid-template-columns: 1fr;
    }

    .lynvo-actions {
      justify-content: flex-start;
    }

    .lynvo-search {
      width: min(100%, 260px);
    }

    .lynvo-map-layout {
      grid-template-columns: 1fr;
    }
  }
`;

export const App: React.FC = () => {
  const [boardData, setBoardData] = useState<LynvoBoard | null>(null);
  const [activeView, setActiveView] = useState<LynvoView>("board");
  const [tableMode, setTableMode] = useState<TableMode>("rows");
  const [mapLinkSourceId, setMapLinkSourceId] = useState<string | null>(null);
  const [selectedMapTaskId, setSelectedMapTaskId] = useState<string | null>(null);
  const [isMapLinkMode, setIsMapLinkMode] = useState(false);
  const [mapNodePositions, setMapNodePositions] = useState<Record<string, MapNodePosition>>({});
  const [mapZoom, setMapZoom] = useState(1);
  const [isMapPanning, setIsMapPanning] = useState(false);
  const [mapPanOffset, setMapPanOffset] = useState({ x: 0, y: 0 });

  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState<string>("");
  const [activePriorityFilter, setActivePriorityFilter] = useState<string>("");
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>("");
  const [activityUserFilter, setActivityUserFilter] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState(false);

  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("medium");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [editDueDate, setEditDueDate] = useState("");

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#007acc");

  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColTitle, setEditColTitle] = useState("");
  const [editColColor, setEditColColor] = useState("");

  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#f85149");
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const [relationTargetByTask, setRelationTargetByTask] = useState<Record<string, string>>({});
  const [relationTypeByTask, setRelationTypeByTask] = useState<
    Record<string, LynvoTaskRelationType>
  >({});

  const draggedTaskRef = useRef<string | null>(null);
  const draggedFromColumnRef = useRef<string | null>(null);
  const dragOverTaskRef = useRef<string | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapDragRef = useRef<MapDragState | null>(null);
  const mapPanRef = useRef<MapPanState | null>(null);
  const suppressMapClickRef = useRef<string | null>(null);

  const isFiltering =
    searchTerm.trim().length > 0 ||
    activeFilterLabel !== "" ||
    activePriorityFilter !== "";

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = parseInboundMessage(event.data);
      if (!message) {return;}

      if (message.command === "loadData") {
        setBoardData(message.data);
        setIsSyncing(false);
      }

      if (message.command === "switchView") {
        setActiveView(message.view);
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "requestData" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pan = mapPanRef.current;
      if (pan) {
        setMapPanOffset({
          x: pan.startOffsetX + event.clientX - pan.startX,
          y: pan.startOffsetY + event.clientY - pan.startY,
        });
        return;
      }

      const drag = mapDragRef.current;
      const canvas = mapCanvasRef.current;
      if (!drag || !canvas) {return;}

      const rect = canvas.getBoundingClientRect();
      const pointerX = (event.clientX - rect.left) / mapZoom;
      const pointerY = (event.clientY - rect.top) / mapZoom;
      const nextX = Math.max(70, Math.min(canvas.offsetWidth - 70, pointerX - drag.offsetX));
      const nextY = Math.max(70, Math.min(canvas.offsetHeight - 70, pointerY - drag.offsetY));
      drag.moved = true;
      setMapNodePositions((positions) => ({
        ...positions,
        [drag.taskId]: { x: nextX, y: nextY },
      }));
    };

    const handlePointerUp = () => {
      mapPanRef.current = null;
      setIsMapPanning(false);

      const drag = mapDragRef.current;
      if (drag?.moved) {
        suppressMapClickRef.current = drag.taskId;
        window.setTimeout(() => {
          if (suppressMapClickRef.current === drag.taskId) {
            suppressMapClickRef.current = null;
          }
        }, 0);
      }
      mapDragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [mapZoom]);

  const sortedColumns = useMemo(
    () =>
      boardData
        ? Object.values(boardData.columns).sort((a, b) => a.position - b.position)
        : [],
    [boardData],
  );

  const tasks = useMemo(() => Object.values(boardData?.tasks || {}), [boardData]);

  const filteredTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            !searchTerm ||
            task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            task.description.toLowerCase().includes(searchTerm.toLowerCase()),
        )
        .filter(
          (task) =>
            !activeFilterLabel ||
            (task.labelIds && task.labelIds.includes(activeFilterLabel)),
        )
        .filter(
          (task) =>
            !activePriorityFilter || getTaskPriority(task) === activePriorityFilter,
        ),
    [activeFilterLabel, activePriorityFilter, searchTerm, tasks],
  );

  const activityItems = useMemo(
    () =>
      Object.values(boardData?.activity || {}).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [boardData],
  );

  const activityTypes = useMemo(
    () => Array.from(new Set(activityItems.map((item) => item.type))).sort(),
    [activityItems],
  );

  const activityUsers = useMemo(
    () =>
      Array.from(new Set(activityItems.map((item) => item.actor.username))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [activityItems],
  );

  const filteredActivityItems = useMemo(
    () =>
      activityItems
        .filter((item) => !activityTypeFilter || item.type === activityTypeFilter)
        .filter((item) => !activityUserFilter || item.actor.username === activityUserFilter),
    [activityItems, activityTypeFilter, activityUserFilter],
  );

  const unresolvedConflicts = useMemo(
    () =>
      Object.values(boardData?.conflicts || {})
        .filter((conflict) => !conflict.resolved)
        .sort((a, b) => b.createdAt - a.createdAt),
    [boardData],
  );

  const syncStatus = boardData?.sync?.status || "idle";
  const syncColor =
    syncStatus === "synced"
      ? "#3fb950"
      : syncStatus === "failed" || syncStatus === "offline" || syncStatus === "conflict"
        ? "#f85149"
        : "#d29922";
  const activeUsers = useMemo(() => {
    const cutoff = Date.now() - 1000 * 60 * 5;
    return Object.values(boardData?.users || {})
      .filter((user) => user.lastSeenAt >= cutoff)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [boardData]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const doneIds = sortedColumns
      .filter((col) => col.title.toLowerCase().includes("done"))
      .map((col) => col.id);
    const completed = tasks.filter((task) => doneIds.includes(task.status)).length;
    const overdue = tasks.filter(
      (task) => task.dueDate && task.dueDate < now && !doneIds.includes(task.status),
    ).length;
    const stale = tasks.filter((task) => now - task.updatedAt > 1000 * 60 * 60 * 24 * 7).length;

    return {
      total: tasks.length,
      completed,
      completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
      overdue,
      stale,
      inProgress: tasks.filter((task) =>
        sortedColumns
          .find((col) => col.id === task.status)
          ?.title.toLowerCase()
          .includes("progress"),
      ).length,
    };
  }, [tasks, sortedColumns]);

  const triggerSync = () => {
    setIsSyncing(true);
    vscode.postMessage({ command: "syncBoard" });
  };

  const handleDragStart = (e: React.DragEvent, task: LynvoTask) => {
    if (editingTaskId === task.id || isFiltering) {
      e.preventDefault();
      return;
    }

    draggedTaskRef.current = task.id;
    draggedFromColumnRef.current = task.status;
    e.dataTransfer.setData("taskId", task.id);
  };

  const getColumnSortedTasks = (
    board: LynvoBoard,
    colId: string,
    excludedTaskId?: string,
  ) =>
    Object.values(board.tasks)
      .filter((task) => task.status === colId && task.id !== excludedTaskId)
      .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (isFiltering || !boardData) {return;}

    const taskId = draggedTaskRef.current;
    const sourceStatus = draggedFromColumnRef.current;
    const targetId = dragOverTaskRef.current;
    if (!taskId || !sourceStatus || !boardData.tasks[taskId]) {return;}

    const nextBoard: LynvoBoard = {
      ...boardData,
      tasks: { ...boardData.tasks },
    };

    nextBoard.tasks[taskId] = { ...nextBoard.tasks[taskId], status: newStatus };

    const targetTasks = getColumnSortedTasks(nextBoard, newStatus, taskId);
    const droppedTask = nextBoard.tasks[taskId];
    const targetIdx = targetTasks.findIndex((task) => task.id === targetId);

    if (targetIdx < 0) {
      targetTasks.push(droppedTask);
    } else {
      targetTasks.splice(targetIdx, 0, droppedTask);
    }

    const sourceTasks =
      sourceStatus === newStatus
        ? targetTasks
        : getColumnSortedTasks(nextBoard, sourceStatus, taskId);

    const updates = [
      ...targetTasks.map((task, idx) => ({
        id: task.id,
        status: newStatus,
        position: idx,
        isDraggedTask: task.id === taskId,
      })),
      ...(sourceStatus === newStatus
        ? []
        : sourceTasks.map((task, idx) => ({
            id: task.id,
            status: sourceStatus,
            position: idx,
          }))),
    ];

    updates.forEach((update) => {
      const task = nextBoard.tasks[update.id];
      if (!task) {return;}
      nextBoard.tasks[update.id] = {
        ...task,
        status: update.status,
        position: update.position,
      };
    });
    setBoardData(nextBoard);
    vscode.postMessage({ command: "reorderTasks", updates });
    draggedTaskRef.current = null;
    draggedFromColumnRef.current = null;
    dragOverTaskRef.current = null;
  };

  const openAddTaskForm = (colId: string) => {
    setAddingTaskColId(colId);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskLabels([]);
    setNewTaskPriority("medium");
    setNewTaskDueDate("");
  };

  const submitNewTask = () => {
    if (!newTaskTitle.trim() || !addingTaskColId) {return;}

    vscode.postMessage({
      command: "createTask",
      title: newTaskTitle.trim(),
      description: newTaskDesc,
      targetColId: addingTaskColId,
      labelIds: newTaskLabels,
      priority: newTaskPriority,
      dueDate: fromDateInputValue(newTaskDueDate),
    });
    setAddingTaskColId(null);
  };

  const startEditingTask = (task: LynvoTask) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditLabelIds(task.labelIds || []);
    setEditPriority(getTaskPriority(task));
    setEditDueDate(toDateInputValue(task.dueDate));
  };

  const saveEditTask = () => {
    if (!editTitle.trim() || !editingTaskId) {return;}

    vscode.postMessage({
      command: "editTask",
      taskId: editingTaskId,
      title: editTitle.trim(),
      description: editDesc,
      labelIds: editLabelIds,
      priority: editPriority,
      dueDate: fromDateInputValue(editDueDate),
    });
    setEditingTaskId(null);
  };

  const getChecklistProgress = (task: LynvoTask) => {
    const checklist = task.checklist || [];
    const done = checklist.filter((item) => item.done).length;
    return { done, total: checklist.length };
  };

  const addChecklistItem = (taskId: string) => {
    const text = checklistDrafts[taskId]?.trim();
    if (!text) {return;}

    vscode.postMessage({ command: "addChecklistItem", taskId, text });
    setChecklistDrafts({ ...checklistDrafts, [taskId]: "" });
  };

  const addTaskRelation = (taskId: string) => {
    const targetTaskId = relationTargetByTask[taskId];
    const relationType = relationTypeByTask[taskId] || "related";
    if (!targetTaskId || targetTaskId === taskId) {return;}

    createTaskRelation(taskId, targetTaskId, relationType);
    setRelationTargetByTask({ ...relationTargetByTask, [taskId]: "" });
  };

  const deleteTaskRelation = (taskId: string, relationId: string) => {
    if (!boardData) {return;}
    const task = boardData.tasks[taskId];
    if (!task) {return;}

    setBoardData({
      ...boardData,
      tasks: {
        ...boardData.tasks,
        [taskId]: {
          ...task,
          relations: (task.relations || []).filter((relation) => relation.id !== relationId),
        },
      },
    });
    vscode.postMessage({
      command: "deleteTaskRelation",
      taskId,
      relationId,
    });
  };

  const createTaskRelation = (
    taskId: string,
    targetTaskId: string,
    relationType: LynvoTaskRelationType,
  ) => {
    if (!boardData || taskId === targetTaskId) {return;}

    const sourceTask = boardData.tasks[taskId];
    const targetTask = boardData.tasks[targetTaskId];
    if (!sourceTask || !targetTask) {return;}

    const exists = (sourceTask.relations || []).some(
      (relation) =>
        relation.targetTaskId === targetTaskId && relation.type === relationType,
    );
    if (exists) {return;}

    vscode.postMessage({
      command: "addTaskRelation",
      taskId,
      targetTaskId,
      relationType,
    });
  };

  const handleMapTaskClick = (taskId: string) => {
    if (suppressMapClickRef.current === taskId) {
      suppressMapClickRef.current = null;
      return;
    }

    setSelectedMapTaskId(taskId);
    if (!isMapLinkMode) {return;}

    if (!mapLinkSourceId) {
      setMapLinkSourceId(taskId);
      return;
    }

    if (mapLinkSourceId === taskId) {
      setMapLinkSourceId(null);
      return;
    }

    createTaskRelation(
      mapLinkSourceId,
      taskId,
      relationTypeByTask[mapLinkSourceId] || "related",
    );
    setMapLinkSourceId(null);
    setIsMapLinkMode(false);
  };

  const updateMapZoom = (nextZoom: number) => {
    setMapZoom(clampMapZoom(nextZoom));
  };

  const handleMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {return;}

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    updateMapZoom(mapZoom + direction * mapZoomStep);
  };

  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      updateMapZoom(mapZoom + mapZoomStep);
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      updateMapZoom(mapZoom - mapZoomStep);
    }
    if (event.key === "0") {
      event.preventDefault();
      updateMapZoom(1);
    }
  };

  const handleMapBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      event.button !== 0 ||
      !(target instanceof Element) ||
      target.closest(".lynvo-map-node")
    ) {
      return;
    }

    mapPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: mapPanOffset.x,
      startOffsetY: mapPanOffset.y,
    };
    setIsMapPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const toggleLabelSelection = (
    labelId: string,
    current: string[],
    setter: (val: string[]) => void,
  ) => {
    if (current.includes(labelId)) {setter(current.filter((id) => id !== labelId));}
    else {setter([...current, labelId]);}
  };

  const submitNewColumn = () => {
    if (!newColTitle.trim()) {return;}

    vscode.postMessage({
      command: "createColumn",
      title: newColTitle.trim(),
      color: newColColor,
    });
    setIsAddingColumn(false);
    setNewColTitle("");
  };

  const startEditingColumn = (col: LynvoColumn) => {
    setEditingColId(col.id);
    setEditColTitle(col.title);
    setEditColColor(col.color);
  };

  const saveEditColumn = () => {
    if (!editColTitle.trim() || !editingColId) {return;}

    vscode.postMessage({
      command: "editColumn",
      colId: editingColId,
      title: editColTitle.trim(),
      color: editColColor,
    });
    setEditingColId(null);
  };

  const moveColumn = (colId: string, direction: "left" | "right") => {
    if (!boardData) {return;}

    const cols = [...sortedColumns];
    const idx = cols.findIndex((c) => c.id === colId);
    const swapIndex = direction === "left" ? idx - 1 : idx + 1;

    if (idx < 0 || swapIndex < 0 || swapIndex >= cols.length) {return;}

    const currentPosition = cols[idx].position;
    cols[idx].position = cols[swapIndex].position;
    cols[swapIndex].position = currentPosition;

    const updates = cols.map((c) => ({ id: c.id, position: c.position }));
    setBoardData({
      ...boardData,
      columns: Object.fromEntries(cols.map((c) => [c.id, c])),
    });
    vscode.postMessage({ command: "reorderColumns", updates });
  };

  const getTasksByStatusFiltered = (status: string): LynvoTask[] => {
    if (!boardData || !boardData.tasks) {return [];}

    return filteredTasks
      .filter((task) => task.status === status)
      .sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
  };

  const renderLabelSelector = (
    selected: string[],
    setter: (val: string[]) => void,
  ) => {
    if (!boardData || !boardData.labels) {return null;}

    return (
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "8px" }}>
        {Object.values(boardData.labels).map((label) => {
          const isSelected = selected.includes(label.id);
          return (
            <span
              key={label.id}
              onClick={() => toggleLabelSelection(label.id, selected, setter)}
              style={{
                padding: "2px 8px",
                borderRadius: "10px",
                fontSize: "10px",
                cursor: "pointer",
                backgroundColor: isSelected ? label.color : "transparent",
                color: isSelected ? "#fff" : label.color,
                border: `1px solid ${label.color}`,
              }}
            >
              {label.name}
            </span>
          );
        })}
      </div>
    );
  };

  const renderTaskCard = (task: LynvoTask) => {
    const isEditing = editingTaskId === task.id;
    const isEdited = task.updatedAt - task.createdAt > 60000;
    const priority = getTaskPriority(task);
    const dueDate = task.dueDate;
    const isOverdue = Boolean(dueDate && dueDate < Date.now());
    const checklistProgress = getChecklistProgress(task);
    const availableRelationTargets = tasks.filter((candidate) => candidate.id !== task.id);

    return (
      <div
        className="lynvo-card"
        key={task.id}
        draggable={!isEditing && !isFiltering}
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnter={(e) => {
          e.stopPropagation();
          dragOverTaskRef.current = task.id;
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragOverTaskRef.current = task.id;
        }}
        style={{ opacity: isFiltering ? 0.9 : 1 }}
      >
        {isEditing ? (
          <div>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ width: "100%", marginBottom: "8px", padding: "6px", boxSizing: "border-box" }}
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              style={{ width: "100%", marginBottom: "8px", padding: "6px", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as Priority)}
                style={{ flex: 1, padding: "6px" }}
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                style={{ flex: 1, padding: "6px" }}
              />
            </div>
            {renderLabelSelector(editLabelIds, setEditLabelIds)}
            <div style={{ borderTop: "1px solid var(--vscode-widget-border)", paddingTop: "8px", marginTop: "8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "6px" }}>Checklist</div>
              {(task.checklist || []).map((item) => (
                <div key={item.id} style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "5px" }}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) =>
                      vscode.postMessage({
                        command: "updateChecklistItem",
                        taskId: task.id,
                        itemId: item.id,
                        done: e.target.checked,
                      })
                    }
                  />
                  <input
                    defaultValue={item.text}
                    onBlur={(e) =>
                      vscode.postMessage({
                        command: "updateChecklistItem",
                        taskId: task.id,
                        itemId: item.id,
                        text: e.target.value,
                      })
                    }
                    style={{ flex: 1, padding: "4px" }}
                  />
                  <button
                    className="icon-btn delete"
                    onClick={() =>
                      vscode.postMessage({
                        command: "deleteChecklistItem",
                        taskId: task.id,
                        itemId: item.id,
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                <input
                  placeholder="Add checklist item..."
                  value={checklistDrafts[task.id] || ""}
                  onChange={(e) =>
                    setChecklistDrafts({
                      ...checklistDrafts,
                      [task.id]: e.target.value,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {addChecklistItem(task.id);}
                  }}
                  style={{ flex: 1, padding: "5px" }}
                />
                <button onClick={() => addChecklistItem(task.id)}>Add</button>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--vscode-widget-border)", paddingTop: "8px", marginTop: "8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "6px" }}>Relations</div>
              {(task.relations || []).map((relation) => {
                const target = boardData?.tasks[relation.targetTaskId];
                return (
                  <div key={relation.id} style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "5px" }}>
                    <span style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)", minWidth: "72px" }}>
                      {relationLabels[relation.type]}
                    </span>
                    <span style={{ flex: 1, fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {target?.title || "Missing task"}
                    </span>
                    <button
                      className="icon-btn delete"
                      onClick={() => deleteTaskRelation(task.id, relation.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: "6px" }}>
                <select
                  value={relationTypeByTask[task.id] || "related"}
                  onChange={(e) =>
                    setRelationTypeByTask({
                      ...relationTypeByTask,
                      [task.id]: e.target.value as LynvoTaskRelationType,
                    })
                  }
                  style={{ padding: "5px" }}
                >
                  {Object.entries(relationLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={relationTargetByTask[task.id] || ""}
                  onChange={(e) =>
                    setRelationTargetByTask({
                      ...relationTargetByTask,
                      [task.id]: e.target.value,
                    })
                  }
                  style={{ padding: "5px", minWidth: 0 }}
                >
                  <option value="">Select task...</option>
                  {availableRelationTargets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
                </select>
                <button onClick={() => addTaskRelation(task.id)}>Link</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: "5px", justifyContent: "flex-end" }}>
              <button onClick={() => setEditingTaskId(null)}>Cancel</button>
              <button
                onClick={saveEditTask}
                style={{
                  backgroundColor: "var(--vscode-button-background)",
                  color: "white",
                  border: "none",
                  padding: "4px 8px",
                }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h4
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "14px",
                  paddingRight: "40px",
                  color: "var(--vscode-editor-foreground)",
                }}
              >
                {task.title}
              </h4>
              <div style={{ position: "absolute", top: "8px", right: "8px", display: "flex", gap: "2px" }}>
	                <button className="icon-btn" onClick={() => startEditingTask(task)}>
	                  E
	                </button>
                <button
                  className="icon-btn delete"
                  onClick={() => vscode.postMessage({ command: "deleteTask", taskId: task.id })}
	                >
	                  D
	                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: "10px",
                  borderRadius: "10px",
                  padding: "2px 8px",
                  border: `1px solid ${priorityColors[priority]}`,
                  color: priorityColors[priority],
                }}
              >
                {priority.toUpperCase()}
              </span>
              {dueDate && (
                <span
                  style={{
                    fontSize: "10px",
                    borderRadius: "10px",
                    padding: "2px 8px",
                    border: `1px solid ${isOverdue ? "#f85149" : "var(--vscode-widget-border)"}`,
                    color: isOverdue ? "#f85149" : "var(--vscode-descriptionForeground)",
                  }}
                >
	                  {new Date(dueDate).toLocaleDateString()}
                </span>
              )}
              {checklistProgress.total > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    borderRadius: "10px",
                    padding: "2px 8px",
                    border: "1px solid var(--vscode-widget-border)",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {checklistProgress.done}/{checklistProgress.total} checks
                </span>
              )}
              {(task.relations || []).length > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    borderRadius: "10px",
                    padding: "2px 8px",
                    border: "1px solid var(--vscode-widget-border)",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {(task.relations || []).length} links
                </span>
              )}
            </div>

            {task.labelIds && task.labelIds.length > 0 && (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px" }}>
                {task.labelIds.map((id) => {
                  const label = boardData?.labels?.[id];
                  if (!label) {return null;}
                  return (
                    <span
                      key={id}
                      style={{
                        backgroundColor: label.color,
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: "8px",
                        fontSize: "10px",
                      }}
                    >
                      {label.name}
                    </span>
                  );
                })}
              </div>
            )}

            {task.codeReference && (
              <div
                onClick={() =>
                  vscode.postMessage({
                    command: "openCode",
                    filePath: task.codeReference!.filePath,
                    lineStart: task.codeReference!.lineStart,
                    lineEnd: task.codeReference!.lineEnd,
                  })
                }
                style={{
                  fontSize: "10px",
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  padding: "3px 6px",
                  borderRadius: "3px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  display: "inline-block",
                  color: "var(--vscode-button-secondaryForeground)",
                }}
              >
                {task.codeReference.filePath.split("/").pop()} · L{task.codeReference.lineStart}
              </div>
            )}
            <div
              style={{
                fontSize: "12px",
                opacity: 0.85,
                margin: "0 0 10px 0",
                color: "var(--vscode-descriptionForeground)",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              {renderRichText(task.description)}
            </div>
            {checklistProgress.total > 0 && (
              <div style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--vscode-descriptionForeground)", marginBottom: "4px" }}>
                  <span>Checklist</span>
                  <span>
                    {checklistProgress.done}/{checklistProgress.total}
                  </span>
                </div>
                <div style={{ height: "4px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "999px", overflow: "hidden", marginBottom: "6px" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((checklistProgress.done / checklistProgress.total) * 100)}%`,
                      backgroundColor: "var(--vscode-button-background)",
                    }}
                  />
                </div>
                {(task.checklist || []).slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      gap: "6px",
                      alignItems: "center",
                      fontSize: "11px",
                      color: item.done
                        ? "var(--vscode-descriptionForeground)"
                        : "var(--vscode-foreground)",
                      textDecoration: item.done ? "line-through" : "none",
                      marginBottom: "3px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) =>
                        vscode.postMessage({
                          command: "updateChecklistItem",
                          taskId: task.id,
                          itemId: item.id,
                          done: e.target.checked,
                        })
                      }
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.text}
                    </span>
                  </div>
                ))}
                {(task.checklist || []).length > 3 && (
                  <div style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)" }}>
                    +{(task.checklist || []).length - 3} more
                  </div>
                )}
              </div>
            )}
            {(task.relations || []).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                {(task.relations || []).slice(0, 3).map((relation) => {
                  const target = boardData?.tasks[relation.targetTaskId];
                  return (
                    <div
                      key={relation.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 1fr",
                        gap: "6px",
                        fontSize: "10px",
                        color: "var(--vscode-descriptionForeground)",
                        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                        borderRadius: "4px",
                        padding: "4px 6px",
                      }}
                    >
                      <span>{relationLabels[relation.type]}</span>
                      <span style={{ color: "var(--vscode-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {target?.title || "Missing task"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "10px",
                opacity: 0.75,
                color: "var(--vscode-textLink-foreground)",
              }}
            >
              <span>{task.lastModifiedBy?.username}</span>
              <div style={{ textAlign: "right", color: "var(--vscode-descriptionForeground)" }}>
                <div>{formatDateTime(task.createdAt)}</div>
                {isEdited && <div>✎ {formatDateTime(task.updatedAt)}</div>}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderLabelsManager = () => (
    <div style={{ padding: "20px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", borderRadius: "8px" }}>
      <h2>Manage Labels</h2>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", alignItems: "center" }}>
        <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} />
        <input
          placeholder="New label name..."
          value={newLabelName}
          onChange={(e) => setNewLabelName(e.target.value)}
          style={{ padding: "6px" }}
        />
        <button
          onClick={() => {
            if (!newLabelName.trim()) {return;}
            vscode.postMessage({ command: "createLabel", name: newLabelName.trim(), color: newLabelColor });
            setNewLabelName("");
          }}
          style={{ padding: "6px 12px", backgroundColor: "var(--vscode-button-background)", color: "white", border: "none", cursor: "pointer" }}
        >
          Create Label
        </button>
      </div>
      <div>
        {boardData?.labels &&
          Object.values(boardData.labels).map((label) => (
            <div
              key={label.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px",
                borderBottom: "1px solid var(--vscode-widget-border)",
              }}
            >
              <span
                style={{
                  backgroundColor: label.color,
                  color: "#fff",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              >
                {label.name}
              </span>
              <button
                className="icon-btn delete"
                onClick={() => vscode.postMessage({ command: "deleteLabel", labelId: label.id })}
              >
	                Delete
              </button>
            </div>
          ))}
      </div>
    </div>
  );

  const renderInsights = () => {
    if (!boardData) {return null;}

    const statusStats = tasks.reduce(
      (acc, task) => {
        const colTitle = boardData.columns[task.status]?.title || "Unknown";
        acc[colTitle] = (acc[colTitle] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const priorityStats = tasks.reduce(
      (acc, task) => {
        const key = getTaskPriority(task);
        acc[key] += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 } as Record<Priority, number>,
    );

    return (
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", overflowY: "auto" }}>
        <div style={{ flex: "1 1 100%", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h2 style={{ marginTop: 0 }}>Project Progress</h2>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span>
              {metrics.completed} of {metrics.total} tasks completed
            </span>
            <span style={{ fontWeight: "bold" }}>{metrics.completionRate}%</span>
          </div>
          <div style={{ width: "100%", height: "12px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "6px", overflow: "hidden" }}>
            <div
              style={{
                width: `${metrics.completionRate}%`,
                height: "100%",
                backgroundColor: "var(--vscode-button-background)",
              }}
            ></div>
          </div>
        </div>

        <div style={{ flex: "1 1 320px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h3 style={{ marginTop: 0 }}>Status Breakdown</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(statusStats).map(([status, count]) => (
              <li key={status} style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
                {status}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: "1 1 320px", backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "20px", borderRadius: "6px" }}>
          <h3 style={{ marginTop: 0 }}>Risk Metrics</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <li style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
                Overdue tasks: <strong>{metrics.overdue}</strong>
              </li>
              <li style={{ padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
                Stale (&gt;7 days): <strong>{metrics.stale}</strong>
              </li>
              <li style={{ padding: "8px 0" }}>
                In progress: <strong>{metrics.inProgress}</strong>
              </li>
          </ul>

          <h4 style={{ marginTop: "16px", marginBottom: "8px" }}>Priority Distribution</h4>
          {(["high", "medium", "low"] as Priority[]).map((priority) => (
            <div key={priority} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span style={{ color: priorityColors[priority] }}>{priority.toUpperCase()}</span>
                <span>{priorityStats[priority]}</span>
              </div>
              <div style={{ width: "100%", height: "8px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "5px" }}>
                <div
                  style={{
                    width: `${tasks.length ? Math.round((priorityStats[priority] / tasks.length) * 100) : 0}%`,
                    height: "8px",
                    borderRadius: "5px",
                    backgroundColor: priorityColors[priority],
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTaskMapView = () => {
    if (!boardData) {return null;}

    const mapTasks = [...filteredTasks].sort(
      (a, b) =>
        sortedColumns.findIndex((column) => column.id === a.status) -
          sortedColumns.findIndex((column) => column.id === b.status) ||
        (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
    );

    const mapWidth = Math.max(1180, sortedColumns.length * 260 + 320);
    const mapHeight = Math.max(720, Math.ceil(mapTasks.length / 3) * 190 + 260);
    const nodePositions = new Map<string, MapNodePosition>();

    mapTasks.forEach((task, taskIndex) => {
      nodePositions.set(
        task.id,
        mapNodePositions[task.id] ||
          getDefaultMapPosition(task, taskIndex, sortedColumns, mapWidth, mapHeight),
      );
    });

    const relationLines = mapTasks.flatMap((task) =>
      (task.relations || []).map((relation) => ({
        relation,
        source: task,
        target: boardData.tasks[relation.targetTaskId],
      })),
    ).filter(({ target }) => Boolean(target));

    const selectedTask = selectedMapTaskId ? boardData.tasks[selectedMapTaskId] : null;
    const selectedColumn = selectedTask ? boardData.columns[selectedTask.status] : null;
    const selectedRelations = selectedTask?.relations || [];

	    return (
      <div className="lynvo-table-shell">
        <div className="lynvo-map-toolbar">
          <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>
            {isMapLinkMode && mapLinkSourceId
              ? `Choose a target for "${boardData.tasks[mapLinkSourceId]?.title || "task"}".`
              : "Drag tasks freely. Select a task to inspect it."}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={mapLinkSourceId ? relationTypeByTask[mapLinkSourceId] || "related" : "related"}
              onChange={(e) => {
                if (!mapLinkSourceId) {return;}
                setRelationTypeByTask({
                  ...relationTypeByTask,
                  [mapLinkSourceId]: e.target.value as LynvoTaskRelationType,
                });
              }}
              disabled={!isMapLinkMode || !mapLinkSourceId}
              style={{ padding: "5px 8px" }}
              title="Relation type"
            >
              {Object.entries(relationLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const sourceId = selectedMapTaskId || mapLinkSourceId;
                setIsMapLinkMode(true);
                setMapLinkSourceId(sourceId);
              }}
              disabled={!selectedMapTaskId && !mapLinkSourceId}
            >
              Create link
            </button>
            <button
              onClick={() => {
                setIsMapLinkMode(false);
                setMapLinkSourceId(null);
              }}
              disabled={!isMapLinkMode}
            >
              Cancel
            </button>
            <div className="lynvo-map-controls" aria-label="Map zoom controls">
              <button onClick={() => updateMapZoom(mapZoom - mapZoomStep)} title="Zoom out">
                -
              </button>
              <span className="lynvo-map-zoom-value">{Math.round(mapZoom * 100)}%</span>
              <button onClick={() => updateMapZoom(mapZoom + mapZoomStep)} title="Zoom in">
                +
              </button>
              <button onClick={() => updateMapZoom(1)} title="Reset zoom">
                1:1
              </button>
            </div>
          </div>
        </div>
        <div className="lynvo-map-layout">
          <div
            ref={mapViewportRef}
            className={`lynvo-task-map${isMapPanning ? " panning" : ""}`}
            tabIndex={0}
            onWheel={handleMapWheel}
            onKeyDown={handleMapKeyDown}
            onPointerDown={handleMapBackgroundPointerDown}
            title="Drag the background to move. Use Ctrl/Cmd + wheel or +, -, 0 to zoom"
          >
            {mapTasks.length > 0 ? (
              <div
                className="lynvo-task-map-zoom-surface"
                style={{
                  width: `${mapWidth}px`,
                  height: `${mapHeight}px`,
                  transform: `translate(${mapPanOffset.x}px, ${mapPanOffset.y}px)`,
                }}
              >
                <div
                  ref={mapCanvasRef}
                  className="lynvo-task-map-canvas"
                  style={{
                    width: `${mapWidth}px`,
                    height: `${mapHeight}px`,
                    transform: `scale(${mapZoom})`,
                  }}
                >
                  <svg viewBox={`0 0 ${mapWidth} ${mapHeight}`} preserveAspectRatio="none" aria-hidden="true">
                    {relationLines.map(({ relation, source, target }) => {
                      const from = nodePositions.get(source.id);
                      const to = target ? nodePositions.get(target.id) : undefined;
                      if (!from || !to) {return null;}

                      const isBlocking = relation.type === "blocks" || relation.type === "blocked-by";
                      return (
                        <line
                          key={relation.id}
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke={isBlocking ? "#f85149" : "var(--vscode-textLink-foreground)"}
                          strokeWidth={isBlocking ? 2.4 : 1.7}
                          strokeDasharray={relation.type === "related" ? "6 5" : undefined}
                          opacity={0.72}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  </svg>
                  {mapTasks.map((task) => {
                    const column = boardData.columns[task.status];
                    const position = nodePositions.get(task.id) || { x: mapWidth / 2, y: mapHeight / 2 };
                    const priority = getTaskPriority(task);
                    const dueState = getDueState(task);
                    const isSelected = selectedMapTaskId === task.id;
                    const isLinkSource = isMapLinkMode && mapLinkSourceId === task.id;
                    const borderWidth = priority === "high" ? 5 : priority === "medium" ? 4 : 3;
                    const relationCount = (task.relations || []).length;

                    return (
                      <button
                        key={task.id}
                        className={`lynvo-map-node ${dueState} ${isSelected ? "selected" : ""} ${isLinkSource ? "link-source" : ""}`}
                        onPointerDown={(event) => {
                          const target = event.currentTarget;
                          const canvas = mapCanvasRef.current;
                          if (!canvas) {return;}
                          const canvasRect = canvas.getBoundingClientRect();
                          const pointerX = (event.clientX - canvasRect.left) / mapZoom;
                          const pointerY = (event.clientY - canvasRect.top) / mapZoom;
                          mapDragRef.current = {
                            taskId: task.id,
                            offsetX: pointerX - position.x,
                            offsetY: pointerY - position.y,
                            moved: false,
                          };
                          target.setPointerCapture(event.pointerId);
                        }}
                        onClick={() => handleMapTaskClick(task.id)}
                        onDoubleClick={() => {
                          setActiveView("board");
                          startEditingTask(task);
                        }}
                        title={`${task.title} · ${column?.title || "No column"} · ${priority}`}
                        style={{
                          left: `${position.x}px`,
                          top: `${position.y}px`,
                          background: column?.color || "var(--vscode-button-background)",
                          border: `${borderWidth}px solid ${priorityColors[priority]}`,
                          color: getReadableTextColor(column?.color || "#007acc"),
                        }}
                      >
                        <span>
                          {task.title}
                          <small>
                            {column?.title || "No column"}
                            {task.dueDate ? ` · ${new Date(task.dueDate).toLocaleDateString()}` : ""}
                            {relationCount ? ` · ${relationCount} links` : ""}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="lynvo-map-empty">No tasks match the current filters.</div>
            )}
          </div>
          <aside className="lynvo-map-panel">
            {selectedTask ? (
              <>
                <h3>{selectedTask.title}</h3>
                <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px", marginBottom: "10px" }}>
                  {selectedColumn?.title || "No column"} · {getTaskPriority(selectedTask)}
                  {selectedTask.dueDate ? ` · ${new Date(selectedTask.dueDate).toLocaleDateString()}` : ""}
                </div>
                <button
                  onClick={() => {
                    setIsMapLinkMode(true);
                    setMapLinkSourceId(selectedTask.id);
                  }}
                  style={{ width: "100%", marginBottom: "10px" }}
                >
                  Create link from this task
                </button>
                <button
                  onClick={() => {
                    setActiveView("board");
                    startEditingTask(selectedTask);
                  }}
                  style={{ width: "100%", marginBottom: "12px" }}
                >
                  Open task
                </button>
                <div style={{ fontSize: "11px", fontWeight: 700, marginBottom: "4px" }}>Relations</div>
                {selectedRelations.length > 0 ? selectedRelations.map((relation) => {
                  const target = boardData.tasks[relation.targetTaskId];
                  return (
                    <div className="lynvo-relation-row" key={relation.id}>
                      <div className="lynvo-relation-meta">
                        <strong>{target?.title || "Missing task"}</strong>
                        <span style={{ color: "var(--vscode-descriptionForeground)" }}>{relationLabels[relation.type]}</span>
                      </div>
                      <button
                        className="lynvo-danger-button"
                        onClick={() => deleteTaskRelation(selectedTask.id, relation.id)}
                      >
                        Delete
                      </button>
                    </div>
                  );
                }) : (
                  <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>
                    No relations yet.
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>
                Select a task to inspect relations, open it, or start linking.
              </div>
            )}
          </aside>
        </div>
      </div>
    );
  };

  const renderTableView = () => {
    if (!boardData) {return null;}

    const sortedTableTasks = [...filteredTasks].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    return (
      <div className="lynvo-table-shell">
        <div className="lynvo-view-switcher" aria-label="Table view mode">
          <button
            className={tableMode === "rows" ? "active" : ""}
            onClick={() => setTableMode("rows")}
          >
            Rows
          </button>
          <button
            className={tableMode === "map" ? "active" : ""}
            onClick={() => setTableMode("map")}
          >
            Map
          </button>
        </div>
        {tableMode === "map" ? renderTaskMapView() : (
          <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--vscode-widget-border)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
              <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--vscode-editor-background)", zIndex: 2 }}>
                <tr>
                  {["Task", "Status", "Priority", "Due", "Checklist", "Relations", "Updated"].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: "left",
                        padding: "10px",
                        fontSize: "11px",
                        color: "var(--vscode-descriptionForeground)",
                        borderBottom: "1px solid var(--vscode-widget-border)",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTableTasks.map((task) => {
                  const checklistProgress = getChecklistProgress(task);
                  return (
                    <tr key={task.id} style={{ borderBottom: "1px solid var(--vscode-widget-border)" }}>
                      <td style={{ padding: "10px", verticalAlign: "top" }}>
                        <button
                          onClick={() => {
                            setActiveView("board");
                            startEditingTask(task);
                          }}
                          style={{
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--vscode-textLink-foreground)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontWeight: 700,
                          }}
                        >
                          {task.title}
                        </button>
                        <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginTop: "4px", maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {task.description || "No description"}
                        </div>
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top" }}>
                        <select
                          value={task.status}
                          onChange={(e) =>
                            vscode.postMessage({
                              command: "updateTaskStatus",
                              taskId: task.id,
                              newStatus: e.target.value,
                            })
                          }
                          style={{ padding: "5px", width: "150px" }}
                        >
                          {sortedColumns.map((column) => (
                            <option key={column.id} value={column.id}>
                              {column.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top", color: priorityColors[getTaskPriority(task)], fontSize: "12px", fontWeight: 700 }}>
                        {getTaskPriority(task).toUpperCase()}
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top", fontSize: "12px", color: task.dueDate && task.dueDate < Date.now() ? "#f85149" : "var(--vscode-foreground)" }}>
                        {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top", fontSize: "12px" }}>
                        {checklistProgress.total
                          ? `${checklistProgress.done}/${checklistProgress.total}`
                          : "—"}
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top", fontSize: "12px" }}>
                        {(task.relations || []).length || "—"}
                      </td>
                      <td style={{ padding: "10px", verticalAlign: "top", fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
                        {formatDateTime(task.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
                {sortedTableTasks.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: "24px", color: "var(--vscode-descriptionForeground)", textAlign: "center" }}>
                      No tasks match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderActivityView = () => {
    const getActivityColor = (type: LynvoActivity["type"]) => {
      if (type.includes("deleted")) {return "#f85149";}
      if (type.includes("created") || type.includes("added")) {return "#3fb950";}
      if (type.includes("moved")) {return "#58a6ff";}
      return "var(--vscode-descriptionForeground)";
    };

	    return (
	      <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--vscode-widget-border)", borderRadius: "8px", backgroundColor: "var(--vscode-editor-background)" }}>
	        {activityItems.length > 0 && (
	          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", padding: "10px", borderBottom: "1px solid var(--vscode-widget-border)", position: "sticky", top: 0, backgroundColor: "var(--vscode-editor-background)", zIndex: 1 }}>
	            <select
	              value={activityTypeFilter}
	              onChange={(e) => setActivityTypeFilter(e.target.value)}
	              style={{ padding: "5px", minWidth: "170px" }}
	            >
	              <option value="">All activity types</option>
	              {activityTypes.map((type) => (
	                <option key={type} value={type}>
	                  {type.replace(/_/g, " ")}
	                </option>
	              ))}
	            </select>
	            <select
	              value={activityUserFilter}
	              onChange={(e) => setActivityUserFilter(e.target.value)}
	              style={{ padding: "5px", minWidth: "150px" }}
	            >
	              <option value="">All users</option>
	              {activityUsers.map((user) => (
	                <option key={user} value={user}>
	                  {user}
	                </option>
	              ))}
	            </select>
	            {(activityTypeFilter || activityUserFilter) && (
	              <button
	                onClick={() => {
	                  setActivityTypeFilter("");
	                  setActivityUserFilter("");
	                }}
	              >
	                Clear
	              </button>
	            )}
	          </div>
	        )}
	        {activityItems.length === 0 ? (
	          <div style={{ padding: "28px", textAlign: "center", color: "var(--vscode-descriptionForeground)" }}>
	            No activity yet.
	          </div>
	        ) : filteredActivityItems.length === 0 ? (
	          <div style={{ padding: "28px", textAlign: "center", color: "var(--vscode-descriptionForeground)" }}>
	            No activity matches the current filters.
	          </div>
	        ) : (
	          filteredActivityItems.map((item) => {
            const task = item.taskId ? boardData?.tasks[item.taskId] : undefined;
            return (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "12px 1fr auto",
                  gap: "12px",
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                  alignItems: "start",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "999px",
                    backgroundColor: getActivityColor(item.type),
                    marginTop: "5px",
                  }}
                />
                <div>
                  <div style={{ fontSize: "13px", color: "var(--vscode-foreground)" }}>
                    {item.message}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px", fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
                    <span>{item.actor.username}</span>
                    {task && <span>{task.title}</span>}
                    <span>{item.type.replace(/_/g, " ")}</span>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", whiteSpace: "nowrap" }}>
                  {formatDateTime(item.createdAt)}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  };

  const renderConflictsView = () => (
    <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--vscode-widget-border)", borderRadius: "8px", backgroundColor: "var(--vscode-editor-background)" }}>
      {unresolvedConflicts.length === 0 ? (
        <div style={{ padding: "28px", textAlign: "center", color: "var(--vscode-descriptionForeground)" }}>
          No unresolved conflicts.
        </div>
      ) : (
        unresolvedConflicts.map((conflict) => {
          const task = boardData?.tasks[conflict.entityId];
          return (
            <div key={conflict.id} style={{ padding: "14px", borderBottom: "1px solid var(--vscode-widget-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{task?.title || conflict.entityId}</div>
                  <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
                    Field: {conflict.field}
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
                  {formatDateTime(conflict.createdAt)}
                </div>
	              </div>
	              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
	                <div style={{ border: "1px solid var(--vscode-widget-border)", borderRadius: "6px", padding: "8px" }}>
	                  <div style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)", marginBottom: "4px" }}>Local</div>
	                  <div style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>{formatConflictValue(conflict.localValue)}</div>
	                </div>
	                <div style={{ border: "1px solid var(--vscode-widget-border)", borderRadius: "6px", padding: "8px" }}>
	                  <div style={{ fontSize: "10px", color: "var(--vscode-descriptionForeground)", marginBottom: "4px" }}>Remote</div>
	                  <div style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>{formatConflictValue(conflict.remoteValue)}</div>
	                </div>
	              </div>
	              {renderConflictDiff(conflict.localValue, conflict.remoteValue)}
	              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  onClick={() =>
                    vscode.postMessage({
                      command: "resolveConflict",
                      conflictId: conflict.id,
                      resolution: "local",
                    })
                  }
                >
                  Keep Local
                </button>
                <button
                  onClick={() =>
                    vscode.postMessage({
                      command: "resolveConflict",
                      conflictId: conflict.id,
                      resolution: "remote",
                    })
                  }
                  style={{ backgroundColor: "var(--vscode-button-background)", color: "white", border: "none" }}
                >
                  Use Remote
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="lynvo-shell">
      <style>{lynvoStyles}</style>
      <div className="lynvo-metrics">
        <div className="lynvo-stat">
          <div className="lynvo-stat-label">Total tasks</div>
          <div className="lynvo-stat-value">{metrics.total}</div>
        </div>
        <div className="lynvo-stat">
          <div className="lynvo-stat-label">Completed</div>
          <div className="lynvo-stat-value">{metrics.completed}</div>
        </div>
        <div className="lynvo-stat">
          <div className="lynvo-stat-label">Overdue</div>
          <div className="lynvo-stat-value" style={{ color: metrics.overdue ? "#f85149" : "inherit" }}>
            {metrics.overdue}
          </div>
        </div>
        <div className="lynvo-stat">
          <div className="lynvo-stat-label">Completion rate</div>
          <div className="lynvo-stat-value">{metrics.completionRate}%</div>
        </div>
      </div>

      <div className="lynvo-toolbar">
        <div className="lynvo-nav">
          <div className="lynvo-brand">
            <span className="lynvo-brand-mark" aria-hidden="true" />
            <span>Lynvo</span>
          </div>
          {([
            { id: "board", label: "Board" },
            { id: "table", label: "Table" },
            { id: "activity", label: "Activity" },
            { id: "conflicts", label: `Conflicts${unresolvedConflicts.length ? ` (${unresolvedConflicts.length})` : ""}` },
            { id: "insights", label: "Insights" },
            { id: "labels", label: "Labels" },
          ] as { id: LynvoView; label: string }[]).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`lynvo-tab${activeView === item.id ? " active" : ""}`}
            >
              {item.label}
            </button>
          ))}

          <button
            onClick={triggerSync}
            disabled={isSyncing}
            style={{
              padding: "5px 10px",
              cursor: isSyncing ? "wait" : "pointer",
              fontWeight: "bold",
            }}
          >
            {isSyncing ? "Syncing..." : "Sync Team"}
          </button>
          <span
            title={boardData?.sync?.message || syncStatus}
            style={{
              fontSize: "11px",
              border: `1px solid ${syncColor}`,
              color: syncColor,
              borderRadius: "999px",
              padding: "3px 8px",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {syncStatus}
          </span>
          {activeUsers.length > 0 && (
            <span
              title={activeUsers.map((user) => user.username).join(", ")}
              style={{
                fontSize: "11px",
                border: "1px solid var(--vscode-widget-border)",
                color: "var(--vscode-descriptionForeground)",
                borderRadius: "999px",
                padding: "3px 8px",
                fontWeight: 700,
              }}
            >
              {activeUsers.length} online
            </span>
          )}
        </div>

        <div className="lynvo-actions">
          {(activeView === "board" || activeView === "table") && (
          <div className="lynvo-filters">
            <input className="lynvo-search" placeholder="Search tasks..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            <select value={activeFilterLabel} onChange={(e) => setActiveFilterLabel(e.target.value)} style={{ padding: "6px" }}>
              <option value="">All labels</option>
              {boardData?.labels &&
                Object.values(boardData.labels).map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
            </select>
            <select value={activePriorityFilter} onChange={(e) => setActivePriorityFilter(e.target.value)} style={{ padding: "6px" }}>
              <option value="">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {isFiltering && <span style={{ fontSize: "10px", color: "var(--vscode-editorWarning-foreground)" }}>Drag & Drop disabled</span>}
          </div>
          )}
        </div>
      </div>

      {boardData && activeView === "board" && (
        <div className="lynvo-board">
          {sortedColumns.map((col) => {
            const columnTasks = getTasksByStatusFiltered(col.id);

            return (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, col.id)}
                onDragEnter={() => {
                  dragOverTaskRef.current = null;
                }}
	                style={{
	                  borderTop: `4px solid ${col.color}`,
	                }}
	                className="lynvo-column"
	              >
                {editingColId === col.id ? (
                  <div style={{ display: "flex", gap: "5px", marginBottom: "15px", alignItems: "center", backgroundColor: "var(--vscode-editor-background)", padding: "8px", borderRadius: "6px" }}>
                    <button className="icon-btn" onClick={() => moveColumn(col.id, "left")}>{"<"}</button>
                    <input type="color" value={editColColor} onChange={(e) => setEditColColor(e.target.value)} title="Pick column color" />
                    <input value={editColTitle} onChange={(e) => setEditColTitle(e.target.value)} style={{ flex: 1, padding: "4px", width: "100px" }} />
                    <button className="icon-btn" onClick={() => moveColumn(col.id, "right")}>{">"}</button>
                    <button className="icon-btn" onClick={saveEditColumn}>S</button>
                    <button className="icon-btn" onClick={() => setEditingColId(null)}>X</button>
                  </div>
                ) : (
	                  <div className="lynvo-column-header">
	                    <h3 className="lynvo-column-title">
	                      <span>{col.title}</span>
	                      <span className="lynvo-count">{columnTasks.length}</span>
	                    </h3>
	                    <div style={{ display: "flex", gap: "5px" }}>
                      <button className="icon-btn" onClick={() => startEditingColumn(col)}>E</button>
                      <button className="icon-btn delete" onClick={() => vscode.postMessage({ command: "deleteColumn", colId: col.id })}>D</button>
                    </div>
                  </div>
                )}

                {addingTaskColId === col.id ? (
                  <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "var(--vscode-editor-background)", borderRadius: "6px", border: "1px solid var(--vscode-focusBorder)" }}>
                    <input autoFocus placeholder="Task title..." value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} style={{ width: "100%", marginBottom: "8px", padding: "5px", boxSizing: "border-box" }} />
                    <textarea placeholder="Description (optional)..." value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} rows={2} style={{ width: "100%", marginBottom: "8px", padding: "5px", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                      <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value as Priority)} style={{ flex: 1, padding: "6px" }}>
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                      </select>
                      <input type="date" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} style={{ flex: 1, padding: "6px" }} />
                    </div>
                    {renderLabelSelector(newTaskLabels, setNewTaskLabels)}
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button onClick={() => setAddingTaskColId(null)} style={{ flex: 1 }}>Cancel</button>
                      <button onClick={submitNewTask} style={{ flex: 1, backgroundColor: "var(--vscode-button-background)", color: "white", border: "none" }}>Save</button>
                    </div>
                  </div>
                ) : (
                  !isFiltering && <button onClick={() => openAddTaskForm(col.id)} style={{ width: "100%", padding: "6px", marginBottom: "15px", background: "transparent", border: "1px dashed var(--vscode-widget-border)", color: "var(--vscode-foreground)", cursor: "pointer", borderRadius: "4px" }}>+ Add Task here</button>
                )}

                {columnTasks.map(renderTaskCard)}
              </div>
            );
          })}

          <div style={{ flex: "0 0 250px" }}>
            {isAddingColumn ? (
              <div style={{ backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)", padding: "15px", borderRadius: "8px" }}>
                <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                  <input type="color" value={newColColor} onChange={(e) => setNewColColor(e.target.value)} />
                  <input autoFocus placeholder="Column Name" value={newColTitle} onChange={(e) => setNewColTitle(e.target.value)} style={{ flex: 1, padding: "4px" }} />
                </div>
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => setIsAddingColumn(false)} style={{ flex: 1 }}>Cancel</button>
                  <button onClick={submitNewColumn} style={{ flex: 1, backgroundColor: "var(--vscode-button-background)", color: "white", border: "none" }}>Create</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setIsAddingColumn(true)} style={{ width: "100%", padding: "15px", background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>+ Add another column</button>
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "table" && renderTableView()}
      {boardData && activeView === "activity" && renderActivityView()}
      {boardData && activeView === "conflicts" && renderConflictsView()}
      {boardData && activeView === "insights" && renderInsights()}
      {boardData && activeView === "labels" && renderLabelsManager()}
    </div>
  );
};
