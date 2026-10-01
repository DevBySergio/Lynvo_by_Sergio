# Change Log

All notable changes to the "lynvo" extension will be documented in this file.

## [1.0.2]

- Task checklists can expand beyond the first three items and collapse again.
- Added Keep all (local values) and Discard all (remote values) to the Conflict Center, resolving the displayed conflicts in one queued save.
- Fixed large boards disappearing from Table → Map with automatic framing, a Fit control, and a non-overlapping layout grouped by status.
- Refreshed map cards, column headings, and relation highlighting while preserving task dragging, linking, filters, and zoom/pan.
- Preserved the existing `.vscode/lynvo/` paths and board schema; no new migration or legacy board files.
- Fixed synchronization overwriting edits made while fetching or pushing, and replaced whole-task timestamp selection with a merge against the last synchronized Git commit.
- Added conflict handling for concurrent task, checklist, relation, column, and label edits; rejected stale conflict snapshots and preserved resolved conflicts for unchanged versions.
- Fetch, merge, and recommit after concurrent push rejection; bound Git operations with a timeout and cancellation during disposal.
- Stop loading and saving damaged boards instead of replacing them with legacy or default data; validate JSON and IDs before filesystem writes.
- Record task tombstones and clean references when deleting columns; update timestamps for affected reorder and reference changes.
- Preserve existing settings and avoid rewriting unchanged board files; serialize extension reads with writes.
- Preserve project instructions and customized agent skills, inspect every installation destination independently, and only update or uninstall verified Lynvo content.
- Install skills in every enabled workspace folder, and coordinate board locks across symbolic links and other aliases of the same physical directory.
- Keep task editors open on save failure and reject stale drafts. Checklist and relation edits in the editor now follow Save/Cancel with the other fields.
- Deliver the requested initial view after the webview is ready; preserve an editor draft if VS Code recreates the same webview and clear it when changing workspaces.
- Count renamed default completion/in-progress columns correctly; exclude completed tasks from stale metrics.
- Corrected documentation for table ordering, label creation/deletion, column reorder controls, and the supported Markdown subset.
- Expanded regression coverage for persistence, synchronization, installer preservation, and webview behavior.
- Reworked the embedded agent skill with semantic task reuse, deliberate column/label creation, native checklists and dependencies, evidence-based completion, and self-contained safe JSON write guidance.

## [0.0.1]

- Added Kanban board with dynamic columns, drag and drop, labels, priorities, due dates, filters, and search.
- Added modular local-first persistence under `.vscode/lynvo/` with automatic migration from `.vscode/lynvo.json`.
- Added Shadow Branch Sync using the internal `lynvo-sync` branch.
- Added checklist items, task relations, table view, activity feed, conflict center, labels manager, and presence indicators.
- Added GitHub/code integration for creating tasks from selected source code and reopening linked files.
- Added markdown rendering for technical task descriptions.
- Added production webpack packaging, extension metadata, and marketplace icon.
