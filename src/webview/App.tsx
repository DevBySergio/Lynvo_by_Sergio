import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LynvoBoard,
  LynvoColumn,
  LynvoLabel,
  LynvoPriority,
  LynvoTask,
} from "../types";

declare const acquireVsCodeApi: () => { postMessage: (msg: any) => void };
const vscode = acquireVsCodeApi();

const HOURS_24 = 24 * 60 * 60 * 1000;
const DAYS_14 = 14;

const PRIORITY_META: Record<LynvoPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "#2ea043" },
  medium: { label: "Medium", color: "#d29922" },
  high: { label: "High", color: "#f85149" },
};

const formatDateTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};
const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const toInputDate = (timestamp?: number) =>
  timestamp
    ? new Date(timestamp - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .split("T")[0]
    : "";
const fromInputDate = (value: string) =>
  value ? new Date(`${value}T23:59:59`).getTime() : undefined;

export const App: React.FC = () => {
  const [boardData, setBoardData] = useState<LynvoBoard | null>(null);
  const [activeView, setActiveView] = useState<"board" | "insights" | "labels">(
    "board",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState("");
  const [activePriority, setActivePriority] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortMode, setSortMode] = useState<"manual" | "updated" | "priority">(
    "manual",
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] =
    useState<LynvoPriority>("medium");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [editPriority, setEditPriority] = useState<LynvoPriority>("medium");
  const [editDueDate, setEditDueDate] = useState("");

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#007acc");
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColTitle, setEditColTitle] = useState("");
  const [editColColor, setEditColColor] = useState("");

  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#f85149");

  const draggedTaskRef = useRef<string | null>(null);
  const dragOverTaskRef = useRef<string | null>(null);

  const isFiltering =
    searchTerm ||
    activeFilterLabel ||
    activePriority ||
    showArchived ||
    sortMode !== "manual";

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === "loadData") {
        setBoardData(event.data.data);
        setIsSyncing(false);
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "requestData" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const toggleLabel = (
    labelId: string,
    current: string[],
    setter: (v: string[]) => void,
  ) => {
    setter(
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (isFiltering) return;

    const taskId = draggedTaskRef.current;
    const targetId = dragOverTaskRef.current;
    if (!taskId || !boardData) return;

    const updatedTasks = { ...boardData.tasks };
    updatedTasks[taskId].status = newStatus;

    let colTasks = Object.values(updatedTasks)
      .filter((t) => t.status === newStatus)
      .sort(
        (a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
      );

    colTasks = colTasks.filter((t) => t.id !== taskId);

    const targetIdx = colTasks.findIndex((t) => t.id === targetId);
    if (targetIdx === -1) colTasks.push(updatedTasks[taskId]);
    else colTasks.splice(targetIdx, 0, updatedTasks[taskId]);

    const updates = colTasks.map((t, i) => ({
      id: t.id,
      status: newStatus,
      position: i,
      isDraggedTask: t.id === taskId,
    }));

    setBoardData({ ...boardData, tasks: updatedTasks });
    vscode.postMessage({ command: "reorderTasks", updates });
    draggedTaskRef.current = null;
    dragOverTaskRef.current = null;
  };

  // --- CRUD TAREAS ---
  const openAddTaskForm = (colId: string) => {
    setAddingTaskColId(colId);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskLabels([]);
  };

  const submitNewTask = () => {
    if (!newTaskTitle.trim() || !addingTaskColId) return;
    vscode.postMessage({
      command: "createTask",
      title: newTaskTitle,
      description: newTaskDesc,
      targetColId: addingTaskColId,
      labelIds: newTaskLabels,
    });
    setAddingTaskColId(null);
  };

  const startEditingTask = (task: LynvoTask) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditLabelIds(task.labelIds || []);
  };

  const saveEditTask = () => {
    if (!editTitle.trim() || !editingTaskId) return;
    vscode.postMessage({
      command: "editTask",
      taskId: editingTaskId,
      title: editTitle,
      description: editDesc,
      labelIds: editLabelIds,
    });
    setEditingTaskId(null);
  };

  const toggleLabelSelection = (
    labelId: string,
    current: string[],
    setter: (val: string[]) => void,
  ) => {
    if (current.includes(labelId))
      setter(current.filter((id) => id !== labelId));
    else setter([...current, labelId]);
  };

  // --- CRUD COLUMNAS ---
  const submitNewColumn = () => {
    if (!newColTitle.trim()) return;
    vscode.postMessage({
      command: "createColumn",
      title: newColTitle,
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
    if (!editColTitle.trim() || !editingColId) return;
    vscode.postMessage({
      command: "editColumn",
      colId: editingColId,
      title: editColTitle,
      color: editColColor,
    });
    setEditingColId(null);
  };

  const moveColumn = (colId: string, direction: "left" | "right") => {
    if (!boardData) return;
    const cols = Object.values(boardData.columns).sort(
      (a, b) => a.position - b.position,
    );
    const idx = cols.findIndex((c) => c.id === colId);

    if (direction === "left" && idx > 0) {
      const temp = cols[idx].position;
      cols[idx].position = cols[idx - 1].position;
      cols[idx - 1].position = temp;
    } else if (direction === "right" && idx < cols.length - 1) {
      const temp = cols[idx].position;
      cols[idx].position = cols[idx + 1].position;
      cols[idx + 1].position = temp;
    } else return;

    const updates = cols.map((c) => ({ id: c.id, position: c.position }));
    setBoardData({
      ...boardData,
      columns: Object.fromEntries(cols.map((c) => [c.id, c])),
    });
    vscode.postMessage({ command: "reorderColumns", updates });
  };

  const boardMetrics = useMemo(() => {
    if (!boardData) return null;
    const tasks = Object.values(boardData.tasks).filter((t) => !t.archived);
    const doneColumnIds = Object.values(boardData.columns)
      .filter((c) => /done|hecho|complet/i.test(c.title))
      .map((c) => c.id);
    const doneTasks = tasks.filter((t) => doneColumnIds.includes(t.status));
    const activeTasks = tasks.filter((t) => !doneColumnIds.includes(t.status));
    const doneInLast7Days = doneTasks.filter(
      (t) => t.updatedAt >= Date.now() - 7 * HOURS_24,
    );
    const completionRate = tasks.length
      ? Math.round((doneTasks.length / tasks.length) * 100)
      : 0;
    const overdueTasks = activeTasks.filter(
      (t) => t.dueDate && t.dueDate < Date.now(),
    );
    const participants = Array.from(
      tasks
        .reduce((acc, t) => {
          const key = t.lastModifiedBy?.githubId || "unknown";
          const curr = acc.get(key);
          if (curr) curr.updates += 1;
          else
            acc.set(key, {
              username: t.lastModifiedBy?.username || "Unknown",
              updates: 1,
            });
          return acc;
        }, new Map<string, { username: string; updates: number }>())
        .values(),
    ).sort((a, b) => b.updates - a.updates);

    const avgCycleHours = doneTasks.length
      ? Math.round(
          doneTasks.reduce((acc, t) => acc + (t.updatedAt - t.createdAt), 0) /
            doneTasks.length /
            3600000,
        )
      : 0;
    const activitySeries = Array.from({ length: DAYS_14 }, (_, i) => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - (DAYS_14 - 1 - i));
      const dayEnd = dayStart.getTime() + HOURS_24;
      return {
        label: dayStart.toLocaleDateString([], {
          month: "short",
          day: "numeric",
        }),
        count: tasks.filter(
          (t) => t.updatedAt >= dayStart.getTime() && t.updatedAt < dayEnd,
        ).length,
      };
    });

    return {
      tasks,
      doneTasks,
      doneInLast7Days,
      completionRate,
      overdueTasks,
      participants,
      avgCycleHours,
      activitySeries,
    };
  }, [boardData]);

  const renderLabelSelector = (
    selected: string[],
    setter: (v: string[]) => void,
  ) => (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
      {boardData?.labels &&
        Object.values(boardData.labels).map((label) => {
          const isSelected = selected.includes(label.id);
          return (
            <span
              key={label.id}
              onClick={() => toggleLabel(label.id, selected, setter)}
              style={{
                padding: "2px 8px",
                borderRadius: 10,
                fontSize: 10,
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

  const taskEditorExtras = (
    priority: LynvoPriority,
    setPriority: (p: LynvoPriority) => void,
    dueDate: string,
    setDueDate: (d: string) => void,
  ) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as LynvoPriority)}
        style={{ flex: 1, padding: 5 }}
      >
        <option value="low">Low priority</option>
        <option value="medium">Medium priority</option>
        <option value="high">High priority</option>
      </select>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        style={{ flex: 1, padding: 5 }}
      />
    </div>
  );

  const renderTaskCard = (task: LynvoTask) => {
    const isEditing = editingTaskId === task.id;
    const priority = task.priority || "medium";
    const isOverdue = Boolean(
      task.dueDate && task.dueDate < Date.now() && !task.archived,
    );
    return (
      <div
        key={task.id}
        draggable={!isEditing && !isFiltering}
        onDragStart={(e) => handleDragStart(e, task.id)}
        onDragEnter={() => {
          dragOverTaskRef.current = task.id;
        }}
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          border:
            "1px solid color-mix(in srgb, var(--vscode-widget-border) 80%, transparent)",
          padding: "12px",
          marginBottom: "10px",
          borderRadius: "10px",
          position: "relative",
          opacity: isFiltering ? 0.9 : 1,
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
        }}
      >
        {isEditing ? (
          <>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ width: "100%", marginBottom: 8, padding: 5 }}
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              style={{ width: "100%", marginBottom: 8, padding: 5 }}
            />
            {taskEditorExtras(
              editPriority,
              setEditPriority,
              editDueDate,
              setEditDueDate,
            )}
            {renderLabelSelector(editLabelIds, setEditLabelIds)}
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 5 }}
            >
              <button onClick={() => setEditingTaskId(null)}>Cancel</button>
              <button
                onClick={() => {
                  if (!editingTaskId || !editTitle.trim()) return;
                  vscode.postMessage({
                    command: "editTask",
                    taskId: editingTaskId,
                    title: editTitle,
                    description: editDesc,
                    labelIds: editLabelIds,
                    priority: editPriority,
                    dueDate: fromInputDate(editDueDate),
                  });
                  setEditingTaskId(null);
                }}
                style={{
                  background: "var(--vscode-button-background)",
                  color: "white",
                  border: "none",
                }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <h4 style={{ margin: "0 0 8px 0", paddingRight: 50 }}>
              {task.title}
            </h4>
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                display: "flex",
                gap: 2,
              }}
            >
              {task.archived ? (
                <button
                  className="icon-btn"
                  onClick={() =>
                    vscode.postMessage({
                      command: "restoreTask",
                      taskId: task.id,
                    })
                  }
                >
                  ♻️
                </button>
              ) : (
                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditingTaskId(task.id);
                    setEditTitle(task.title);
                    setEditDesc(task.description);
                    setEditLabelIds(task.labelIds || []);
                    setEditPriority(task.priority || "medium");
                    setEditDueDate(toInputDate(task.dueDate));
                  }}
                >
                  ✏️
                </button>
              )}
              <button
                className="icon-btn delete"
                onClick={() =>
                  vscode.postMessage({ command: "deleteTask", taskId: task.id })
                }
              >
                🗑️
              </button>
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 10,
                  border: `1px solid ${PRIORITY_META[priority].color}`,
                  color: PRIORITY_META[priority].color,
                }}
              >
                ⚡ {PRIORITY_META[priority].label}
              </span>
              {task.dueDate && (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                    border: `1px solid ${isOverdue ? "var(--vscode-errorForeground)" : "var(--vscode-widget-border)"}`,
                    color: isOverdue
                      ? "var(--vscode-errorForeground)"
                      : "inherit",
                  }}
                >
                  📅 {formatDate(task.dueDate)}
                </span>
              )}
              {task.archived && (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                    border: "1px solid var(--vscode-widget-border)",
                  }}
                >
                  Archived
                </span>
              )}
            </div>
            {task.labelIds && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                {task.labelIds.map((id) => {
                  const l = boardData?.labels?.[id];
                  if (!l) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        backgroundColor: l.color,
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: 8,
                        fontSize: 10,
                      }}
                    >
                      {l.name}
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
                  })
                }
                style={{
                  fontSize: 10,
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  padding: "3px 6px",
                  borderRadius: 3,
                  cursor: "pointer",
                  marginBottom: 8,
                  display: "inline-block",
                }}
              >
                🔗 {task.codeReference.filePath.split("/").pop()} (L:{" "}
                {task.codeReference.lineStart})
              </div>
            )}
            <p style={{ fontSize: 12, opacity: 0.85, margin: "0 0 8px 0" }}>
              {task.description || "Sin descripción"}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                opacity: 0.7,
              }}
            >
              <span>👤 {task.lastModifiedBy?.username}</span>
              <span>🕒 {formatDateTime(task.updatedAt)}</span>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderLabelsManager = () => {
    return (
      <div
        style={{
          padding: "20px",
          backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
          borderRadius: "8px",
        }}
      >
        <h2>Manage Labels</h2>
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
            alignItems: "center",
          }}
        >
          <input
            type="color"
            value={newLabelColor}
            onChange={(e) => setNewLabelColor(e.target.value)}
          />
          <input
            placeholder="New label name..."
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            style={{ padding: "6px" }}
          />
          <button
            onClick={() => {
              if (newLabelName.trim()) {
                vscode.postMessage({
                  command: "createLabel",
                  name: newLabelName,
                  color: newLabelColor,
                });
                setNewLabelName("");
              }
            }}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--vscode-button-background)",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
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
                  onClick={() =>
                    vscode.postMessage({
                      command: "deleteLabel",
                      labelId: label.id,
                    })
                  }
                >
                  🗑️ Delete
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  };

  const renderInsights = () => {
    if (!boardMetrics) return null;
    const maxActivity = Math.max(
      1,
      ...boardMetrics.activitySeries.map((point) => point.count),
    );

    return (
      <div
        style={{
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            flex: "1 1 220px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "11px", opacity: 0.7 }}>Completion Rate</div>
          <div
            style={{ fontSize: "28px", fontWeight: "bold", margin: "8px 0" }}
          >
            {boardMetrics.completionRate}%
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            {boardMetrics.doneTasks.length} / {boardMetrics.tasks.length} tasks
            done
          </div>
        </div>
        <div
          style={{
            flex: "1 1 220px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "11px", opacity: 0.7 }}>
            Tasks in progress
          </div>
          <div
            style={{ fontSize: "28px", fontWeight: "bold", margin: "8px 0" }}
          >
            {boardMetrics.activeTasks.length}
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            {boardMetrics.doneInLast7Days.length} completadas últimos 7 días
          </div>
        </div>
        <div
          style={{
            flex: "1 1 220px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "11px", opacity: 0.7 }}>
            Team participants
          </div>
          <div
            style={{ fontSize: "28px", fontWeight: "bold", margin: "8px 0" }}
          >
            {boardMetrics.participants.length}
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            Basado en actividad reciente del board
          </div>
        </div>
        <div
          style={{
            flex: "1 1 220px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "11px", opacity: 0.7 }}>Avg cycle time</div>
          <div
            style={{ fontSize: "28px", fontWeight: "bold", margin: "8px 0" }}
          >
            {boardMetrics.avgCycleHours}h
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            Promedio entre creación y última actualización en tareas done
          </div>
        </div>

        <div
          style={{
            flex: "1 1 100%",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Project Progress</h3>
          <div
            style={{
              width: "100%",
              height: "12px",
              backgroundColor: "var(--vscode-editor-background)",
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${boardMetrics.completionRate}%`,
                height: "100%",
                backgroundColor: "var(--vscode-button-background)",
              }}
            ></div>
          </div>
        </div>
        <div
          style={{
            flex: "1 1 300px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Status Breakdown</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(boardMetrics.byStatus).map(([status, count]) => (
              <li
                key={status}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                }}
              >
                {status}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div
          style={{
            flex: "2 1 500px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Task Activity (last 14 days)</h3>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "flex-end",
              height: "120px",
            }}
          >
            {boardMetrics.activitySeries.map((point) => (
              <div
                key={point.label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <div
                  title={`${point.label}: ${point.count}`}
                  style={{
                    width: "100%",
                    borderRadius: "4px 4px 0 0",
                    minHeight: "4px",
                    height: `${Math.max((point.count / maxActivity) * 90, 4)}px`,
                    backgroundColor: "var(--vscode-button-background)",
                    opacity: point.count === 0 ? 0.3 : 0.95,
                  }}
                />
                <span style={{ fontSize: "9px", opacity: 0.7 }}>
                  {point.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            flex: "1 1 300px",
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            padding: "20px",
            borderRadius: "6px",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Participants</h3>
          {boardMetrics.participants.length === 0 ? (
            <div style={{ opacity: 0.7 }}>
              Sin actividad registrada todavía.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {boardMetrics.participants.slice(0, 8).map((person) => (
                <li
                  key={person.username}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--vscode-widget-border)",
                    padding: "8px 0",
                  }}
                >
                  <span>👤 {person.username}</span>
                  <strong>{person.updates} updates</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 18,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(180deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
          borderBottom: "1px solid var(--vscode-widget-border)",
          paddingBottom: 12,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>🚀 Lynvo</h1>
          {(["board", "insights", "labels"] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              style={{
                background:
                  activeView === view
                    ? "var(--vscode-button-background)"
                    : "transparent",
                color: activeView === view ? "white" : "inherit",
                border: "1px solid var(--vscode-widget-border)",
                borderRadius: 999,
                padding: "6px 12px",
              }}
            >
              {view}
            </button>
          ))}
          <button
            onClick={() => {
              setIsSyncing(true);
              vscode.postMessage({ command: "syncBoard" });
            }}
            disabled={isSyncing}
            style={{ borderRadius: 999, padding: "6px 12px" }}
          >
            {isSyncing ? "⏳ Syncing..." : "☁️ Sync Team"}
          </button>
          <button
            onClick={() =>
              vscode.postMessage({ command: "archiveCompletedTasks" })
            }
            style={{ borderRadius: 999, padding: "6px 12px" }}
          >
            🗄️ Archive Done
          </button>
        </div>

        {activeView === "board" && (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              placeholder="🔍 Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ padding: "6px", width: "200px" }}
            />
            <select
              value={activeFilterLabel}
              onChange={(e) => setActiveFilterLabel(e.target.value)}
              style={{ padding: "6px" }}
            >
              <option value="">🏷️ All Labels</option>
              {boardData?.labels &&
                Object.values(boardData.labels).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            {isFiltering && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--vscode-editorWarning-foreground)",
                }}
              >
                Drag & Drop disabled
              </span>
            )}
          </div>
        )}
      </div>

      {boardData && activeView === "board" && (
        <div
          style={{
            display: "flex",
            gap: "20px",
            flex: 1,
            overflowX: "auto",
            alignItems: "flex-start",
            paddingBottom: "20px",
          }}
        >
          {Object.values(boardData.columns)
            .sort((a, b) => a.position - b.position)
            .map((col) => (
              <div
                key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, col.id)}
                onDragEnter={() => {
                  dragOverTaskRef.current = null;
                }}
                style={{
                  flex: "0 0 320px",
                  backgroundColor:
                    "var(--vscode-editor-inactiveSelectionBackground)",
                  padding: "15px",
                  borderRadius: "12px",
                  height: "100%",
                  overflowY: "auto",
                  borderTop: `4px solid ${col.color}`,
                  border: "1px solid var(--vscode-widget-border)",
                  boxSizing: "border-box",
                }}
              >
                {editingColId === col.id ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "5px",
                      marginBottom: "15px",
                      alignItems: "center",
                      backgroundColor: "var(--vscode-editor-background)",
                      padding: "8px",
                      borderRadius: "6px",
                    }}
                  >
                    <button
                      className="icon-btn"
                      onClick={() => moveColumn(col.id, "left")}
                    >
                      &lt;
                    </button>
                    <input
                      type="color"
                      value={editColColor}
                      onChange={(e) => setEditColColor(e.target.value)}
                      title="Pick column color"
                    />
                    <input
                      value={editColTitle}
                      onChange={(e) => setEditColTitle(e.target.value)}
                      style={{ flex: 1, padding: "4px", width: "100px" }}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => moveColumn(col.id, "right")}
                    >
                      &gt;
                    </button>
                    <button className="icon-btn" onClick={saveEditColumn}>
                      💾
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => setEditingColId(null)}
                    >
                      ❌
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "15px",
                      position: "sticky",
                      top: 0,
                      backgroundColor:
                        "var(--vscode-editor-inactiveSelectionBackground)",
                      zIndex: 1,
                      paddingBottom: "10px",
                      borderBottom: "1px solid var(--vscode-widget-border)",
                    }}
                  >
                    <h3 style={{ margin: 0 }}>{col.title}</h3>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        className="icon-btn"
                        onClick={() => startEditingColumn(col)}
                      >
                        ✏️
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() =>
                          vscode.postMessage({
                            command: "deleteColumn",
                            colId: col.id,
                          })
                        }
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )}

                {addingTaskColId === col.id ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      border: "1px solid var(--vscode-focusBorder)",
                      borderRadius: 6,
                    }}
                  >
                    <input
                      autoFocus
                      placeholder="Task title"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      style={{ width: "100%", marginBottom: 8 }}
                    />
                    <textarea
                      placeholder="Description"
                      value={newTaskDesc}
                      onChange={(e) => setNewTaskDesc(e.target.value)}
                      rows={2}
                      style={{ width: "100%", marginBottom: 8 }}
                    />
                    {taskEditorExtras(
                      newTaskPriority,
                      setNewTaskPriority,
                      newTaskDueDate,
                      setNewTaskDueDate,
                    )}
                    {renderLabelSelector(newTaskLabels, setNewTaskLabels)}
                    <div style={{ display: "flex", gap: 5 }}>
                      <button
                        onClick={() => setAddingTaskColId(null)}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!newTaskTitle.trim()) return;
                          vscode.postMessage({
                            command: "createTask",
                            title: newTaskTitle,
                            description: newTaskDesc,
                            targetColId: col.id,
                            labelIds: newTaskLabels,
                            priority: newTaskPriority,
                            dueDate: fromInputDate(newTaskDueDate),
                          });
                          setAddingTaskColId(null);
                        }}
                        style={{
                          flex: 1,
                          background: "var(--vscode-button-background)",
                          color: "white",
                          border: "none",
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  !isFiltering && (
                    <button
                      onClick={() => {
                        setAddingTaskColId(col.id);
                        setNewTaskTitle("");
                        setNewTaskDesc("");
                        setNewTaskLabels([]);
                        setNewTaskPriority("medium");
                        setNewTaskDueDate("");
                      }}
                      style={{ width: "100%", marginBottom: 12 }}
                    >
                      + Add Task
                    </button>
                  )
                )}

                {getTasksByStatusFiltered(col.id).map(renderTaskCard)}
              </div>
            ))}

          <div style={{ flex: "0 0 240px" }}>
            {isAddingColumn ? (
              <div
                style={{
                  padding: 12,
                  border: "1px solid var(--vscode-widget-border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="color"
                    value={newColColor}
                    onChange={(e) => setNewColColor(e.target.value)}
                  />
                  <input
                    autoFocus
                    placeholder="Column name"
                    value={newColTitle}
                    onChange={(e) => setNewColTitle(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    onClick={() => setIsAddingColumn(false)}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (newColTitle.trim()) {
                        vscode.postMessage({
                          command: "createColumn",
                          title: newColTitle,
                          color: newColColor,
                        });
                        setIsAddingColumn(false);
                        setNewColTitle("");
                      }
                    }}
                    style={{ flex: 1 }}
                  >
                    Create
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingColumn(true)}
                style={{
                  width: "100%",
                  padding: "15px",
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                + Add another column
              </button>
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "insights" && boardMetrics && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div
            style={{
              padding: 16,
              border: "1px solid var(--vscode-widget-border)",
              borderRadius: 8,
            }}
          >
            Completion: <strong>{boardMetrics.completionRate}%</strong>
          </div>
          <div
            style={{
              padding: 16,
              border: "1px solid var(--vscode-widget-border)",
              borderRadius: 8,
            }}
          >
            Overdue: <strong>{boardMetrics.overdueTasks.length}</strong>
          </div>
          <div
            style={{
              padding: 16,
              border: "1px solid var(--vscode-widget-border)",
              borderRadius: 8,
            }}
          >
            Avg cycle: <strong>{boardMetrics.avgCycleHours}h</strong>
          </div>
          <div
            style={{
              padding: 16,
              border: "1px solid var(--vscode-widget-border)",
              borderRadius: 8,
            }}
          >
            Done (7d): <strong>{boardMetrics.doneInLast7Days.length}</strong>
          </div>
          <div
            style={{
              gridColumn: "1 / -1",
              padding: 16,
              border: "1px solid var(--vscode-widget-border)",
              borderRadius: 8,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Activity 14 days</h3>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                height: 100,
                gap: 6,
              }}
            >
              {boardMetrics.activitySeries.map((p) => {
                const max = Math.max(
                  1,
                  ...boardMetrics.activitySeries.map((s) => s.count),
                );
                return (
                  <div
                    key={p.label}
                    title={`${p.label}: ${p.count}`}
                    style={{
                      flex: 1,
                      height: `${Math.max((p.count / max) * 90, 4)}px`,
                      background: "var(--vscode-button-background)",
                      opacity: p.count ? 1 : 0.3,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {boardData && activeView === "labels" && (
        <div
          style={{
            padding: 20,
            border: "1px solid var(--vscode-widget-border)",
            borderRadius: 8,
          }}
        >
          <h2>Manage Labels</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="color"
              value={newLabelColor}
              onChange={(e) => setNewLabelColor(e.target.value)}
            />
            <input
              placeholder="New label"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
            />
            <button
              onClick={() => {
                if (newLabelName.trim()) {
                  vscode.postMessage({
                    command: "createLabel",
                    name: newLabelName,
                    color: newLabelColor,
                  });
                  setNewLabelName("");
                }
              }}
            >
              Create
            </button>
          </div>
          {boardData.labels &&
            Object.values(boardData.labels).map((label: LynvoLabel) => (
              <div
                key={label.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--vscode-widget-border)",
                }}
              >
                <span
                  style={{
                    background: label.color,
                    color: "#fff",
                    borderRadius: 999,
                    padding: "4px 10px",
                  }}
                >
                  {label.name}
                </span>
                <button
                  className="icon-btn delete"
                  onClick={() =>
                    vscode.postMessage({
                      command: "deleteLabel",
                      labelId: label.id,
                    })
                  }
                >
                  🗑️ Delete
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
