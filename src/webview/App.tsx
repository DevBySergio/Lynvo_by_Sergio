import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LynvoBoard, LynvoColumn, LynvoLabel, LynvoPriority, LynvoTask } from "../types";

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
const formatDate = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const toInputDate = (timestamp?: number) => (timestamp ? new Date(timestamp - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0] : "");
const fromInputDate = (value: string) => (value ? new Date(`${value}T23:59:59`).getTime() : undefined);

export const App: React.FC = () => {
  const [boardData, setBoardData] = useState<LynvoBoard | null>(null);
  const [activeView, setActiveView] = useState<"board" | "insights" | "labels">("board");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState("");
  const [activePriority, setActivePriority] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortMode, setSortMode] = useState<"manual" | "updated" | "priority">("manual");
  const [isSyncing, setIsSyncing] = useState(false);

  const [addingTaskColId, setAddingTaskColId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskLabels, setNewTaskLabels] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] = useState<LynvoPriority>("medium");
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

  const isFiltering = searchTerm || activeFilterLabel || activePriority || showArchived || sortMode !== "manual";

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

  const toggleLabel = (labelId: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId]);
  };

  const doneColumnIds = useMemo(() => {
    if (!boardData) return [] as string[];
    return Object.values(boardData.columns)
      .filter((c) => /done|hecho|complet/i.test(c.title))
      .map((c) => c.id);
  }, [boardData]);

  const getTasksByStatusFiltered = (status: string) => {
    if (!boardData) return [] as LynvoTask[];
    const tasks = Object.values(boardData.tasks)
      .filter((t) => t.status === status)
      .filter((t) => !t.archived)
      .filter((t) => !searchTerm || t.title.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter((t) => !activeFilterLabel || t.labelIds?.includes(activeFilterLabel))
      .filter((t) => !activePriority || (t.priority || "medium") === activePriority);

    if (sortMode === "updated") return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    if (sortMode === "priority") {
      const rank = { high: 3, medium: 2, low: 1 };
      return tasks.sort((a, b) => rank[(b.priority || "medium") as LynvoPriority] - rank[(a.priority || "medium") as LynvoPriority]);
    }
    return tasks.sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
  };

  const getArchivedDoneTasks = () => {
    if (!boardData) return [] as LynvoTask[];
    const tasks = Object.values(boardData.tasks)
      .filter((t) => t.archived && doneColumnIds.includes(t.status))
      .filter((t) => !searchTerm || t.title.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter((t) => !activeFilterLabel || t.labelIds?.includes(activeFilterLabel))
      .filter((t) => !activePriority || (t.priority || "medium") === activePriority);

    if (sortMode === "updated") return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    if (sortMode === "priority") {
      const rank = { high: 3, medium: 2, low: 1 };
      return tasks.sort((a, b) => rank[(b.priority || "medium") as LynvoPriority] - rank[(a.priority || "medium") as LynvoPriority]);
    }
    return tasks.sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
  };

  const boardMetrics = useMemo(() => {
    if (!boardData) return null;
    const tasks = Object.values(boardData.tasks).filter((t) => !t.archived);
    const doneColumnIds = Object.values(boardData.columns).filter((c) => /done|hecho|complet/i.test(c.title)).map((c) => c.id);
    const doneTasks = tasks.filter((t) => doneColumnIds.includes(t.status));
    const activeTasks = tasks.filter((t) => !doneColumnIds.includes(t.status));
    const doneInLast7Days = doneTasks.filter((t) => t.updatedAt >= Date.now() - 7 * HOURS_24);
    const completionRate = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
    const overdueTasks = activeTasks.filter((t) => t.dueDate && t.dueDate < Date.now());
    const participants = Array.from(tasks.reduce((acc, t) => {
      const key = t.lastModifiedBy?.githubId || "unknown";
      const curr = acc.get(key);
      if (curr) curr.updates += 1;
      else acc.set(key, { username: t.lastModifiedBy?.username || "Unknown", updates: 1 });
      return acc;
    }, new Map<string, { username: string; updates: number }>()).values()).sort((a, b) => b.updates - a.updates);

    const avgCycleHours = doneTasks.length ? Math.round(doneTasks.reduce((acc, t) => acc + (t.updatedAt - t.createdAt), 0) / doneTasks.length / 3600000) : 0;
    const activitySeries = Array.from({ length: DAYS_14 }, (_, i) => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - (DAYS_14 - 1 - i));
      const dayEnd = dayStart.getTime() + HOURS_24;
      return {
        label: dayStart.toLocaleDateString([], { month: "short", day: "numeric" }),
        count: tasks.filter((t) => t.updatedAt >= dayStart.getTime() && t.updatedAt < dayEnd).length,
      };
    });

    return { tasks, doneTasks, doneInLast7Days, completionRate, overdueTasks, participants, avgCycleHours, activitySeries };
  }, [boardData]);

  const renderLabelSelector = (selected: string[], setter: (v: string[]) => void) => (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
      {boardData?.labels && Object.values(boardData.labels).map((label) => {
        const isSelected = selected.includes(label.id);
        return (
          <span
            key={label.id}
            onClick={() => toggleLabel(label.id, selected, setter)}
            style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, cursor: "pointer", backgroundColor: isSelected ? label.color : "transparent", color: isSelected ? "#fff" : label.color, border: `1px solid ${label.color}` }}
          >{label.name}</span>
        );
      })}
    </div>
  );

  const taskEditorExtras = (priority: LynvoPriority, setPriority: (p: LynvoPriority) => void, dueDate: string, setDueDate: (d: string) => void) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
      <select value={priority} onChange={(e) => setPriority(e.target.value as LynvoPriority)} style={{ flex: 1, padding: 5 }}>
        <option value="low">Low priority</option>
        <option value="medium">Medium priority</option>
        <option value="high">High priority</option>
      </select>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ flex: 1, padding: 5 }} />
    </div>
  );

  const renderTaskCard = (task: LynvoTask) => {
    const isEditing = editingTaskId === task.id;
    const priority = task.priority || "medium";
    const isOverdue = Boolean(task.dueDate && task.dueDate < Date.now() && !task.archived);
    return (
      <div key={task.id} draggable={!isEditing && !isFiltering} onDragStart={(e) => { if (isEditing || isFiltering) { e.preventDefault(); return; } draggedTaskRef.current = task.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); }} onDragEnter={() => { dragOverTaskRef.current = task.id; }} style={{ backgroundColor: "var(--vscode-editor-background)", border: `1px solid ${isOverdue ? "var(--vscode-errorForeground)" : "var(--vscode-widget-border)"}`, padding: 12, marginBottom: 10, borderRadius: 10, position: "relative" }}>
        {isEditing ? (
          <>
            <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ width: "100%", marginBottom: 8, padding: 5 }} />
            <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} style={{ width: "100%", marginBottom: 8, padding: 5 }} />
            {taskEditorExtras(editPriority, setEditPriority, editDueDate, setEditDueDate)}
            {renderLabelSelector(editLabelIds, setEditLabelIds)}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 5 }}>
              <button onClick={() => setEditingTaskId(null)}>Cancel</button>
              <button onClick={() => {
                if (!editingTaskId || !editTitle.trim()) return;
                vscode.postMessage({ command: "editTask", taskId: editingTaskId, title: editTitle, description: editDesc, labelIds: editLabelIds, priority: editPriority, dueDate: fromInputDate(editDueDate) });
                setEditingTaskId(null);
              }} style={{ background: "var(--vscode-button-background)", color: "white", border: "none" }}>Save</button>
            </div>
          </>
        ) : (
          <>
            <h4 style={{ margin: "0 0 8px 0", paddingRight: 50 }}>{task.title}</h4>
            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 2 }}>
              {task.archived ? <button className="icon-btn" onClick={() => vscode.postMessage({ command: "restoreTask", taskId: task.id })}>♻️</button> : <button className="icon-btn" onClick={() => { setEditingTaskId(task.id); setEditTitle(task.title); setEditDesc(task.description); setEditLabelIds(task.labelIds || []); setEditPriority(task.priority || "medium"); setEditDueDate(toInputDate(task.dueDate)); }}>✏️</button>}
              <button className="icon-btn delete" onClick={() => vscode.postMessage({ command: "deleteTask", taskId: task.id })}>🗑️</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, border: `1px solid ${PRIORITY_META[priority].color}`, color: PRIORITY_META[priority].color }}>⚡ {PRIORITY_META[priority].label}</span>
              {task.dueDate && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, border: `1px solid ${isOverdue ? "var(--vscode-errorForeground)" : "var(--vscode-widget-border)"}`, color: isOverdue ? "var(--vscode-errorForeground)" : "inherit" }}>📅 {formatDate(task.dueDate)}</span>}
              {task.archived && <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, border: "1px solid var(--vscode-widget-border)" }}>Archived</span>}
            </div>
            {task.labelIds && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>{task.labelIds.map((id) => {
              const l = boardData?.labels?.[id]; if (!l) return null;
              return <span key={id} style={{ backgroundColor: l.color, color: "#fff", padding: "2px 6px", borderRadius: 8, fontSize: 10 }}>{l.name}</span>;
            })}</div>}
            {task.codeReference && <div onClick={() => vscode.postMessage({ command: "openCode", filePath: task.codeReference!.filePath, lineStart: task.codeReference!.lineStart })} style={{ fontSize: 10, backgroundColor: "var(--vscode-button-secondaryBackground)", padding: "3px 6px", borderRadius: 3, cursor: "pointer", marginBottom: 8, display: "inline-block" }}>🔗 {task.codeReference.filePath.split("/").pop()} (L: {task.codeReference.lineStart})</div>}
            <p style={{ fontSize: 12, opacity: 0.85, margin: "0 0 8px 0" }}>{task.description || "Sin descripción"}</p>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.7 }}><span>👤 {task.lastModifiedBy?.username}</span><span>🕒 {formatDateTime(task.updatedAt)}</span></div>
          </>
        )}
      </div>
    );
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (isFiltering || !boardData) return;
    const taskId = draggedTaskRef.current || e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    const targetId = dragOverTaskRef.current;
    const updatedTasks = { ...boardData.tasks };
    updatedTasks[taskId].status = newStatus;
    updatedTasks[taskId].archived = false;
    let colTasks = Object.values(updatedTasks).filter((t) => t.status === newStatus && !t.archived).sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt));
    colTasks = colTasks.filter((t) => t.id !== taskId);
    const targetIdx = colTasks.findIndex((t) => t.id === targetId);
    if (targetIdx === -1) colTasks.push(updatedTasks[taskId]); else colTasks.splice(targetIdx, 0, updatedTasks[taskId]);
    const updates = colTasks.map((t, i) => ({ id: t.id, status: newStatus, position: i, isDraggedTask: t.id === taskId }));
    setBoardData({ ...boardData, tasks: updatedTasks });
    vscode.postMessage({ command: "reorderTasks", updates });
    draggedTaskRef.current = null;
    dragOverTaskRef.current = null;
  };

  return (
    <div style={{ padding: 18, height: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, borderBottom: "1px solid var(--vscode-widget-border)", paddingBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>🚀 Lynvo</h1>
          {(["board", "insights", "labels"] as const).map((view) => <button key={view} onClick={() => setActiveView(view)} style={{ background: activeView === view ? "var(--vscode-button-background)" : "transparent", color: activeView === view ? "white" : "inherit", border: "1px solid var(--vscode-widget-border)", borderRadius: 999, padding: "6px 12px" }}>{view}</button>)}
          <button onClick={() => { setIsSyncing(true); vscode.postMessage({ command: "syncBoard" }); }} disabled={isSyncing} style={{ borderRadius: 999, padding: "6px 12px" }}>{isSyncing ? "⏳ Syncing..." : "☁️ Sync Team"}</button>
          <button onClick={() => vscode.postMessage({ command: "archiveCompletedTasks" })} style={{ borderRadius: 999, padding: "6px 12px" }}>🗄️ Archive Done</button>
        </div>

        {activeView === "board" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="🔍 Search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ padding: 6 }} />
            <select value={activeFilterLabel} onChange={(e) => setActiveFilterLabel(e.target.value)}><option value="">🏷️ Labels</option>{boardData?.labels && Object.values(boardData.labels).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <select value={activePriority} onChange={(e) => setActivePriority(e.target.value)}><option value="">⚡ Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)}><option value="manual">Manual</option><option value="updated">Updated</option><option value="priority">Priority</option></select>
            <button onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Showing done archived" : "Show done archived"}</button>
          </div>
        )}
      </div>

      {boardData && activeView === "board" && !showArchived && (
        <div style={{ display: "flex", gap: 16, overflowX: "auto", flex: 1, paddingBottom: 16 }}>
          {Object.values(boardData.columns).sort((a, b) => a.position - b.position).map((col: LynvoColumn) => (
            <div key={col.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, col.id)} onDragEnter={() => { dragOverTaskRef.current = null; }} style={{ flex: "0 0 320px", background: "var(--vscode-editor-inactiveSelectionBackground)", border: "1px solid var(--vscode-widget-border)", borderTop: `4px solid ${col.color}`, borderRadius: 10, padding: 12, overflowY: "auto" }}>
              {editingColId === col.id ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button onClick={() => {
                    const cols = Object.values(boardData.columns).sort((a, b) => a.position - b.position);
                    const idx = cols.findIndex((c) => c.id === col.id);
                    if (idx > 0) {
                      [cols[idx].position, cols[idx - 1].position] = [cols[idx - 1].position, cols[idx].position];
                      vscode.postMessage({ command: "reorderColumns", updates: cols.map((c) => ({ id: c.id, position: c.position })) });
                    }
                  }}>{"<"}</button>
                  <input type="color" value={editColColor} onChange={(e) => setEditColColor(e.target.value)} />
                  <input value={editColTitle} onChange={(e) => setEditColTitle(e.target.value)} style={{ flex: 1 }} />
                  <button onClick={() => {
                    const cols = Object.values(boardData.columns).sort((a, b) => a.position - b.position);
                    const idx = cols.findIndex((c) => c.id === col.id);
                    if (idx < cols.length - 1 && idx >= 0) {
                      [cols[idx].position, cols[idx + 1].position] = [cols[idx + 1].position, cols[idx].position];
                      vscode.postMessage({ command: "reorderColumns", updates: cols.map((c) => ({ id: c.id, position: c.position })) });
                    }
                  }}>{">"}</button>
                  <button onClick={() => {
                    if (!editColTitle.trim() || !editingColId) return;
                    vscode.postMessage({ command: "editColumn", colId: editingColId, title: editColTitle, color: editColColor });
                    setEditingColId(null);
                  }}>💾</button>
                  <button onClick={() => setEditingColId(null)}>✖</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{col.title}</h3>
                  <div>
                    <button className="icon-btn" onClick={() => { setEditingColId(col.id); setEditColTitle(col.title); setEditColColor(col.color); }}>✏️</button>
                    <button className="icon-btn delete" onClick={() => vscode.postMessage({ command: "deleteColumn", colId: col.id })}>🗑️</button>
                  </div>
                </div>
              )}

              {addingTaskColId === col.id ? (
                <div style={{ marginBottom: 12, padding: 10, border: "1px solid var(--vscode-focusBorder)", borderRadius: 6 }}>
                  <input autoFocus placeholder="Task title" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
                  <textarea placeholder="Description" value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} rows={2} style={{ width: "100%", marginBottom: 8 }} />
                  {taskEditorExtras(newTaskPriority, setNewTaskPriority, newTaskDueDate, setNewTaskDueDate)}
                  {renderLabelSelector(newTaskLabels, setNewTaskLabels)}
                  <div style={{ display: "flex", gap: 5 }}>
                    <button onClick={() => setAddingTaskColId(null)} style={{ flex: 1 }}>Cancel</button>
                    <button onClick={() => {
                      if (!newTaskTitle.trim()) return;
                      vscode.postMessage({ command: "createTask", title: newTaskTitle, description: newTaskDesc, targetColId: col.id, labelIds: newTaskLabels, priority: newTaskPriority, dueDate: fromInputDate(newTaskDueDate) });
                      setAddingTaskColId(null);
                    }} style={{ flex: 1, background: "var(--vscode-button-background)", color: "white", border: "none" }}>Save</button>
                  </div>
                </div>
              ) : (
                !isFiltering && <button onClick={() => { setAddingTaskColId(col.id); setNewTaskTitle(""); setNewTaskDesc(""); setNewTaskLabels([]); setNewTaskPriority("medium"); setNewTaskDueDate(""); }} style={{ width: "100%", marginBottom: 12 }}>+ Add Task</button>
              )}

              {getTasksByStatusFiltered(col.id).map(renderTaskCard)}
            </div>
          ))}

          <div style={{ flex: "0 0 240px" }}>
            {isAddingColumn ? (
              <div style={{ padding: 12, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input type="color" value={newColColor} onChange={(e) => setNewColColor(e.target.value)} />
                  <input autoFocus placeholder="Column name" value={newColTitle} onChange={(e) => setNewColTitle(e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setIsAddingColumn(false)} style={{ flex: 1 }}>Cancel</button>
                  <button onClick={() => { if (newColTitle.trim()) { vscode.postMessage({ command: "createColumn", title: newColTitle, color: newColColor }); setIsAddingColumn(false); setNewColTitle(""); } }} style={{ flex: 1 }}>Create</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setIsAddingColumn(true)} style={{ width: "100%", padding: 14 }}>+ Add Column</button>
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "board" && showArchived && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
          <div style={{ maxWidth: 720, margin: "0 auto", background: "var(--vscode-editor-inactiveSelectionBackground)", border: "1px solid var(--vscode-widget-border)", borderTop: "4px solid var(--vscode-charts-green)", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>✅ Archived from Done</h3>
            {getArchivedDoneTasks().length === 0 ? (
              <p style={{ opacity: 0.75 }}>No archived done tasks match the current filters.</p>
            ) : (
              getArchivedDoneTasks().map(renderTaskCard)
            )}
          </div>
        </div>
      )}

      {boardData && activeView === "insights" && boardMetrics && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ padding: 16, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>Completion: <strong>{boardMetrics.completionRate}%</strong></div>
          <div style={{ padding: 16, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>Overdue: <strong>{boardMetrics.overdueTasks.length}</strong></div>
          <div style={{ padding: 16, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>Avg cycle: <strong>{boardMetrics.avgCycleHours}h</strong></div>
          <div style={{ padding: 16, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>Done (7d): <strong>{boardMetrics.doneInLast7Days.length}</strong></div>
          <div style={{ gridColumn: "1 / -1", padding: 16, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Activity 14 days</h3>
            <div style={{ display: "flex", alignItems: "flex-end", height: 100, gap: 6 }}>
              {boardMetrics.activitySeries.map((p) => {
                const max = Math.max(1, ...boardMetrics.activitySeries.map((s) => s.count));
                return <div key={p.label} title={`${p.label}: ${p.count}`} style={{ flex: 1, height: `${Math.max((p.count / max) * 90, 4)}px`, background: "var(--vscode-button-background)", opacity: p.count ? 1 : 0.3 }} />;
              })}
            </div>
          </div>
        </div>
      )}

      {boardData && activeView === "labels" && (
        <div style={{ padding: 20, border: "1px solid var(--vscode-widget-border)", borderRadius: 8 }}>
          <h2>Manage Labels</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} />
            <input placeholder="New label" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} />
            <button onClick={() => { if (newLabelName.trim()) { vscode.postMessage({ command: "createLabel", name: newLabelName, color: newLabelColor }); setNewLabelName(""); } }}>Create</button>
          </div>
          {boardData.labels && Object.values(boardData.labels).map((label: LynvoLabel) => (
            <div key={label.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--vscode-widget-border)" }}>
              <span style={{ background: label.color, color: "#fff", borderRadius: 999, padding: "4px 10px" }}>{label.name}</span>
              <button className="icon-btn delete" onClick={() => vscode.postMessage({ command: "deleteLabel", labelId: label.id })}>🗑️ Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
