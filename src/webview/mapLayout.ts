import { LynvoColumn, LynvoTask } from "../types";

export type MapNodePosition = { x: number; y: number };
export type MapBounds = { x: number; y: number; width: number; height: number };
export type MapLane = {
  id: string;
  title: string;
  color: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const mapNodeWidth = 184;
export const mapNodeHeight = 96;
const padding = 24;
const margin = 32;
const headerHeight = 52;
const gapX = 24;
const gapY = 36;

// Positions belong to the webview only. They never change task or board files.
export const createMapLayout = (tasks: LynvoTask[], columns: LynvoColumn[]) => {
  const groups = new Map(columns.map((column) => [column.id, [] as LynvoTask[]]));
  for (const task of tasks) {
    const group = groups.get(task.status) || [];
    group.push(task);
    groups.set(task.status, group);
  }

  const activeGroups = [...groups.entries()].filter(([, group]) => group.length);
  // Wrap status groups on large boards instead of creating an extremely wide
  // strip. Balance each group so the whole map remains easy to frame.
  const laneColumns = activeGroups.length <= 3
    ? Math.max(1, activeGroups.length)
    : Math.ceil(Math.sqrt(activeGroups.length));
  const laneRows = Math.max(1, Math.ceil(activeGroups.length / laneColumns));
  const tileAspect = 1.2 * laneRows / laneColumns;
  const positions = new Map<string, MapNodePosition>();
  const lanes: MapLane[] = [];
  const orderedTasks: LynvoTask[] = [];
  let x = margin;
  let y = margin;
  let rowHeight = 0;
  let width = 320;

  for (const [groupIndex, [status, group]] of activeGroups.entries()) {
    group.sort((a, b) =>
      (a.position ?? a.createdAt) - (b.position ?? b.createdAt) || a.id.localeCompare(b.id),
    );
    const column = columns.find((entry) => entry.id === status);
    const gridColumns = Math.max(1, Math.ceil(Math.sqrt(
      group.length * (mapNodeHeight + gapY) / (mapNodeWidth + gapX) * tileAspect,
    )));
    const rows = Math.ceil(group.length / gridColumns);
    const laneWidth = padding * 2 + gridColumns * (mapNodeWidth + gapX) - gapX;
    const laneHeight = headerHeight + padding * 2 + rows * (mapNodeHeight + gapY) - gapY;
    lanes.push({
      id: status,
      title: column?.title || "No column",
      color: column?.color || "var(--vscode-charts-blue)",
      count: group.length,
      x,
      y,
      width: laneWidth,
      height: laneHeight,
    });
    group.forEach((task, index) => {
      positions.set(task.id, {
        x: x + padding + mapNodeWidth / 2 + (index % gridColumns) * (mapNodeWidth + gapX),
        y: y + headerHeight + padding + mapNodeHeight / 2 +
          Math.floor(index / gridColumns) * (mapNodeHeight + gapY),
      });
    });
    orderedTasks.push(...group);
    rowHeight = Math.max(rowHeight, laneHeight);
    width = Math.max(width, x + laneWidth + margin);
    x += laneWidth + margin;
    if ((groupIndex + 1) % laneColumns === 0 && groupIndex + 1 < activeGroups.length) {
      y += rowHeight + margin;
      x = margin;
      rowHeight = 0;
    }
  }

  return {
    tasks: orderedTasks,
    lanes,
    positions,
    width,
    height: Math.max(320, y + rowHeight + margin),
  };
};

export const fitMapBounds = (bounds: MapBounds, viewportWidth: number, viewportHeight: number) => {
  const inset = 24;
  const zoom = Math.min(
    1,
    Math.max(1, viewportWidth - inset * 2) / Math.max(1, bounds.width),
    Math.max(1, viewportHeight - inset * 2) / Math.max(1, bounds.height),
  );
  return {
    zoom,
    offset: {
      x: (viewportWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: (viewportHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
    },
  };
};
