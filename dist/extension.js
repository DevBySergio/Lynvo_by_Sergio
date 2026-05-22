/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/providers/AuthProvider.ts"
/*!***************************************!*\
  !*** ./src/providers/AuthProvider.ts ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AuthProvider: () => (/* binding */ AuthProvider)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);

class AuthProvider {
    static async getGitHubUser(options = {}) {
        const { createIfNone = false } = options;
        try {
            const session = await vscode__WEBPACK_IMPORTED_MODULE_0__.authentication.getSession("github", ["read:user"], { createIfNone });
            if (session) {
                return {
                    githubId: session.account.id,
                    username: session.account.label,
                };
            }
        }
        catch (error) {
            console.error("Lynvo: Error authenticating with GitHub", error);
            if (createIfNone) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("Lynvo: You must sign in to GitHub to view the changes.");
            }
        }
        return undefined;
    }
}


/***/ },

/***/ "./src/providers/DataManager.ts"
/*!**************************************!*\
  !*** ./src/providers/DataManager.ts ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DataManager: () => (/* binding */ DataManager)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _AuthProvider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./AuthProvider */ "./src/providers/AuthProvider.ts");


const UNKNOWN_USER = { githubId: "unknown", username: "Unknown" };
class DataManager {
    static LEGACY_FILENAME = "lynvo.json";
    static FOLDER = ".vscode";
    static MODULAR_FOLDER = "lynvo";
    static SCHEMA_VERSION = "2.0.0";
    static writeQueue = Promise.resolve();
    static getWorkspaceUri() {
        const workspaceFolders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri;
    }
    static getFolderUri() {
        const workspace = this.getWorkspaceUri();
        if (!workspace) {
            return undefined;
        }
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(workspace, this.FOLDER);
    }
    static getLegacyFileUri() {
        const folderUri = this.getFolderUri();
        if (!folderUri) {
            return undefined;
        }
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(folderUri, this.LEGACY_FILENAME);
    }
    static getModularRootUri() {
        const folderUri = this.getFolderUri();
        if (!folderUri) {
            return undefined;
        }
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(folderUri, this.MODULAR_FOLDER);
    }
    static joinModularPath(...segments) {
        const root = this.getModularRootUri();
        if (!root) {
            return undefined;
        }
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(root, ...segments);
    }
    static getDefaultBoard() {
        return {
            version: this.SCHEMA_VERSION,
            columns: {
                todo: {
                    id: "todo",
                    title: "To Do",
                    color: "var(--vscode-charts-blue)",
                    position: 0,
                },
                "in-progress": {
                    id: "in-progress",
                    title: "In Progress",
                    color: "var(--vscode-charts-yellow)",
                    position: 1,
                },
                done: {
                    id: "done",
                    title: "Done",
                    color: "var(--vscode-charts-green)",
                    position: 2,
                },
            },
            tasks: {},
            labels: {
                bug: { id: "bug", name: "Bug", color: "#f85149" },
                feat: { id: "feat", name: "Feature", color: "#a371f7" },
            },
            users: {},
            sync: this.getDefaultSyncMetadata(),
            tombstones: {},
            conflicts: {},
        };
    }
    static getDefaultSyncMetadata() {
        return {
            branch: "lynvo-sync",
            status: "idle",
            pendingChanges: false,
            lastSyncAt: null,
            lastRemoteCommit: null,
            updatedAt: Date.now(),
        };
    }
    static createId(prefix) {
        const random = Math.random().toString(36).slice(2, 10);
        return `${prefix}-${Date.now().toString(36)}-${random}`;
    }
    static ensureBoardIntegrity(board) {
        const defaults = this.getDefaultBoard();
        const next = {
            version: this.SCHEMA_VERSION,
            columns: board.columns && Object.keys(board.columns).length > 0
                ? board.columns
                : defaults.columns,
            tasks: board.tasks || {},
            labels: board.labels || defaults.labels,
            users: board.users || {},
            activity: board.activity || {},
            sync: {
                ...this.getDefaultSyncMetadata(),
                ...(board.sync || {}),
            },
            tombstones: board.tombstones || {},
            conflicts: board.conflicts || {},
        };
        const sortedColumns = Object.values(next.columns).sort((a, b) => a.position - b.position);
        const fallbackColumnId = sortedColumns[0]?.id ?? "todo";
        Object.values(next.columns).forEach((column, index) => {
            if (!column.id) {
                column.id = this.createId("col");
            }
            if (!column.title) {
                column.title = "Untitled";
            }
            if (!column.color) {
                column.color = "var(--vscode-charts-blue)";
            }
            if (!Number.isFinite(column.position)) {
                column.position = index;
            }
        });
        Object.values(next.tasks).forEach((task) => {
            if (!next.columns[task.status]) {
                task.status = fallbackColumnId;
            }
            if (!task.createdAt) {
                task.createdAt = Date.now();
            }
            if (!task.updatedAt) {
                task.updatedAt = task.createdAt;
            }
            if (!task.createdBy) {
                task.createdBy = UNKNOWN_USER;
            }
            if (!task.lastModifiedBy) {
                task.lastModifiedBy = task.createdBy;
            }
            if (!task.labelIds) {
                task.labelIds = [];
            }
            if (!task.priority) {
                task.priority = "medium";
            }
            if (!task.checklist) {
                task.checklist = [];
            }
            if (!task.relations) {
                task.relations = [];
            }
        });
        return next;
    }
    static async exists(uri) {
        try {
            await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.stat(uri);
            return true;
        }
        catch {
            return false;
        }
    }
    static async readJson(uri) {
        const fileData = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readFile(uri);
        const raw = Buffer.from(fileData).toString("utf8");
        try {
            return JSON.parse(raw);
        }
        catch (error) {
            await this.backupCorruptJson(uri, fileData).catch((backupError) => console.error(`Lynvo: failed to backup corrupt json ${uri.path}`, backupError));
            throw error;
        }
    }
    static async writeJsonAtomic(uri, value) {
        const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(parent);
        const tempUri = vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(parent, `.${uri.path.split("/").pop()}.${Date.now()}.tmp`);
        const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.writeFile(tempUri, data);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.rename(tempUri, uri, { overwrite: true });
    }
    static async backupCorruptJson(uri, fileData) {
        const fileName = uri.path.split("/").pop() || "file.json";
        if (fileName.includes(".corrupt-")) {
            return;
        }
        const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
        const backupUri = vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(parent, `${fileName}.corrupt-${Date.now()}`);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.writeFile(backupUri, fileData);
    }
    static async readTasks(tasksUri) {
        const tasks = {};
        if (!(await this.exists(tasksUri))) {
            return tasks;
        }
        const entries = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readDirectory(tasksUri);
        for (const [name, type] of entries) {
            if (type !== vscode__WEBPACK_IMPORTED_MODULE_0__.FileType.File || !name.endsWith(".json")) {
                continue;
            }
            try {
                const task = await this.readJson(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(tasksUri, name));
                if (task.id) {
                    tasks[task.id] = task;
                }
            }
            catch (error) {
                console.error(`Lynvo: invalid task file ${name}`, error);
            }
        }
        return tasks;
    }
    static async readActivity(activityUri) {
        const activity = {};
        if (!(await this.exists(activityUri))) {
            return activity;
        }
        const entries = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readDirectory(activityUri);
        for (const [name, type] of entries) {
            if (type !== vscode__WEBPACK_IMPORTED_MODULE_0__.FileType.File || !name.endsWith(".json")) {
                continue;
            }
            try {
                const item = await this.readJson(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(activityUri, name));
                if (item.id) {
                    activity[item.id] = item;
                }
            }
            catch (error) {
                console.error(`Lynvo: invalid activity file ${name}`, error);
            }
        }
        return activity;
    }
    static async readOptionalJson(uri, fallback) {
        if (!(await this.exists(uri))) {
            return fallback;
        }
        try {
            return await this.readJson(uri);
        }
        catch (error) {
            console.error(`Lynvo: invalid json ${uri.path}`, error);
            return fallback;
        }
    }
    static async loadModularBoard() {
        const boardUri = this.joinModularPath("board.json");
        const columnsUri = this.joinModularPath("columns.json");
        const usersUri = this.joinModularPath("users.json");
        const tasksUri = this.joinModularPath("tasks");
        const activityUri = this.joinModularPath("activity");
        const syncUri = this.joinModularPath("metadata", "sync.json");
        const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
        const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
        if (!boardUri ||
            !columnsUri ||
            !usersUri ||
            !tasksUri ||
            !activityUri ||
            !syncUri ||
            !tombstonesUri ||
            !conflictsUri) {
            return null;
        }
        if (!(await this.exists(boardUri)) || !(await this.exists(columnsUri))) {
            return null;
        }
        try {
            const metadata = await this.readJson(boardUri);
            const columns = await this.readJson(columnsUri);
            const users = await this.readOptionalJson(usersUri, {});
            const tasks = await this.readTasks(tasksUri);
            const activity = await this.readActivity(activityUri);
            const sync = await this.readOptionalJson(syncUri, this.getDefaultSyncMetadata());
            const tombstones = await this.readOptionalJson(tombstonesUri, {});
            const conflicts = await this.readOptionalJson(conflictsUri, {});
            return this.ensureBoardIntegrity({
                version: metadata.version,
                columns,
                tasks,
                labels: metadata.labels,
                users,
                activity,
                sync,
                tombstones,
                conflicts,
            });
        }
        catch (error) {
            console.error("Lynvo: error loading modular board", error);
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo no pudo leer la persistencia modular. Revisa .vscode/lynvo.");
            return null;
        }
    }
    static async loadLegacyBoard() {
        const legacyUri = this.getLegacyFileUri();
        if (!legacyUri || !(await this.exists(legacyUri))) {
            return null;
        }
        try {
            const parsed = await this.readJson(legacyUri);
            return this.ensureBoardIntegrity(parsed);
        }
        catch (error) {
            console.error("Lynvo: error loading legacy board", error);
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo no pudo leer .vscode/lynvo.json. El archivo puede estar corrupto.");
            return null;
        }
    }
    static async saveBoardUnsafe(board) {
        const root = this.getModularRootUri();
        const boardUri = this.joinModularPath("board.json");
        const columnsUri = this.joinModularPath("columns.json");
        const usersUri = this.joinModularPath("users.json");
        const settingsUri = this.joinModularPath("settings.json");
        const tasksUri = this.joinModularPath("tasks");
        const commentsUri = this.joinModularPath("comments");
        const activityUri = this.joinModularPath("activity");
        const metadataUri = this.joinModularPath("metadata");
        const syncUri = this.joinModularPath("metadata", "sync.json");
        const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
        const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
        const versionUri = this.joinModularPath("metadata", "version.json");
        if (!root ||
            !boardUri ||
            !columnsUri ||
            !usersUri ||
            !settingsUri ||
            !tasksUri ||
            !commentsUri ||
            !activityUri ||
            !metadataUri ||
            !syncUri ||
            !tombstonesUri ||
            !conflictsUri ||
            !versionUri) {
            return;
        }
        const cleanBoard = this.ensureBoardIntegrity(board);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(root);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(tasksUri);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(commentsUri);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(activityUri);
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(metadataUri);
        await this.writeJsonAtomic(boardUri, {
            version: this.SCHEMA_VERSION,
            labels: cleanBoard.labels || {},
        });
        await this.writeJsonAtomic(columnsUri, cleanBoard.columns);
        await this.writeJsonAtomic(usersUri, cleanBoard.users || {});
        await this.writeJsonAtomic(settingsUri, {});
        await this.writeJsonAtomic(syncUri, cleanBoard.sync || this.getDefaultSyncMetadata());
        await this.writeJsonAtomic(tombstonesUri, cleanBoard.tombstones || {});
        await this.writeJsonAtomic(conflictsUri, cleanBoard.conflicts || {});
        await this.writeJsonAtomic(versionUri, {
            schemaVersion: this.SCHEMA_VERSION,
        });
        const expectedTaskFiles = new Set();
        for (const task of Object.values(cleanBoard.tasks)) {
            expectedTaskFiles.add(`${task.id}.json`);
            await this.writeJsonAtomic(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(tasksUri, `${task.id}.json`), task);
        }
        const existingTaskFiles = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readDirectory(tasksUri);
        for (const [name, type] of existingTaskFiles) {
            if (type === vscode__WEBPACK_IMPORTED_MODULE_0__.FileType.File &&
                name.endsWith(".json") &&
                !expectedTaskFiles.has(name)) {
                await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.delete(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(tasksUri, name));
            }
        }
        const expectedActivityFiles = new Set();
        const activityItems = Object.values(cleanBoard.activity || {})
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 500);
        for (const activity of activityItems) {
            expectedActivityFiles.add(`${activity.id}.json`);
            await this.writeJsonAtomic(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(activityUri, `${activity.id}.json`), activity);
        }
        const existingActivityFiles = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readDirectory(activityUri);
        for (const [name, type] of existingActivityFiles) {
            if (type === vscode__WEBPACK_IMPORTED_MODULE_0__.FileType.File &&
                name.endsWith(".json") &&
                !expectedActivityFiles.has(name)) {
                await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.delete(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(activityUri, name));
            }
        }
    }
    static addActivity(board, type, message, actor, options = {}) {
        const id = this.createId("activity");
        board.activity = board.activity || {};
        board.activity[id] = {
            id,
            type,
            message,
            actor: actor || { githubId: "unknown", username: "Unknown" },
            createdAt: Date.now(),
            ...options,
        };
    }
    static addTombstone(board, entityType, entityId, actor) {
        const id = `${entityType}-${entityId}`;
        board.tombstones = board.tombstones || {};
        board.tombstones[id] = {
            id,
            entityType,
            entityId,
            deletedAt: Date.now(),
            deletedBy: actor || UNKNOWN_USER,
        };
    }
    static markPendingSync(board) {
        board.sync = {
            ...this.getDefaultSyncMetadata(),
            ...(board.sync || {}),
            status: "pending",
            pendingChanges: true,
            message: "Local changes pending sync",
            updatedAt: Date.now(),
        };
    }
    static async mutateBoard(mutator) {
        const run = this.writeQueue.catch(() => undefined).then(async () => {
            const board = await this.loadBoardUnsafe();
            if (!board) {
                return;
            }
            await mutator(board);
            this.markPendingSync(board);
            await this.saveBoardUnsafe(board);
        });
        this.writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    static async loadBoardUnsafe() {
        const modular = await this.loadModularBoard();
        if (modular) {
            return modular;
        }
        const legacy = await this.loadLegacyBoard();
        if (legacy) {
            await this.saveBoardUnsafe(legacy);
            return legacy;
        }
        return null;
    }
    static async initializeBoard() {
        const folderUri = this.getFolderUri();
        if (!folderUri) {
            return;
        }
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(folderUri);
        const board = await this.loadBoardUnsafe();
        await this.saveBoard(board || this.getDefaultBoard());
    }
    static async loadBoard() {
        return this.loadBoardUnsafe();
    }
    static async saveBoard(board) {
        const run = this.writeQueue
            .catch(() => undefined)
            .then(() => this.saveBoardUnsafe(board));
        this.writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    static async updateSyncMetadata(updates) {
        const run = this.writeQueue.catch(() => undefined).then(async () => {
            const board = await this.loadBoardUnsafe();
            if (!board) {
                return;
            }
            board.sync = {
                ...this.getDefaultSyncMetadata(),
                ...(board.sync || {}),
                ...updates,
                updatedAt: Date.now(),
            };
            await this.saveBoardUnsafe(board);
        });
        this.writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    static async touchCurrentUser() {
        const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
        if (!user) {
            return;
        }
        const run = this.writeQueue.catch(() => undefined).then(async () => {
            const board = await this.loadBoardUnsafe();
            if (!board) {
                return;
            }
            board.users = board.users || {};
            board.users[user.githubId] = {
                ...user,
                lastSeenAt: Date.now(),
            };
            await this.saveBoardUnsafe(board);
        });
        this.writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    static async updateTaskStatus(taskId, newStatus) {
        await this.mutateBoard(async (board) => {
            if (!board.tasks[taskId] || !board.columns[newStatus]) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const previousStatus = board.tasks[taskId].status;
            board.tasks[taskId].status = newStatus;
            board.tasks[taskId].updatedAt = Date.now();
            if (user) {
                board.tasks[taskId].lastModifiedBy = user;
            }
            this.addActivity(board, "task_moved", `Moved "${board.tasks[taskId].title}" to ${board.columns[newStatus].title}`, user, {
                taskId,
                metadata: { from: previousStatus, to: newStatus },
            });
        });
    }
    static async reorderTasks(updates) {
        await this.mutateBoard(async (board) => {
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            updates.forEach((upd) => {
                if (!board.tasks[upd.id] || !board.columns[upd.status]) {
                    return;
                }
                board.tasks[upd.id].status = upd.status;
                board.tasks[upd.id].position = upd.position;
                if (upd.isDraggedTask) {
                    board.tasks[upd.id].updatedAt = Date.now();
                    if (user) {
                        board.tasks[upd.id].lastModifiedBy = user;
                    }
                    this.addActivity(board, "task_moved", `Reordered "${board.tasks[upd.id].title}"`, user, {
                        taskId: upd.id,
                        metadata: { status: upd.status, position: upd.position },
                    });
                }
            });
        });
    }
    static async createTask(title, description, targetColId, labelIds = [], codeReference, priority = "medium", dueDate) {
        await this.mutateBoard(async (board) => {
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const taskId = this.createId("task");
            let status = targetColId;
            if (!status || !board.columns[status]) {
                const sortedCols = Object.values(board.columns).sort((a, b) => a.position - b.position);
                status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
            }
            const now = Date.now();
            board.tasks[taskId] = {
                id: taskId,
                title,
                description,
                status,
                createdBy: user || { githubId: "unknown", username: "Unknown" },
                lastModifiedBy: user || { githubId: "unknown", username: "Unknown" },
                createdAt: now,
                updatedAt: now,
                codeReference,
                position: now,
                labelIds,
                priority,
                dueDate,
            };
            this.addActivity(board, "task_created", `Created "${title}"`, user, {
                taskId,
            });
        });
    }
    static async editTask(taskId, title, description, labelIds = [], priority = "medium", dueDate) {
        await this.mutateBoard(async (board) => {
            if (!board.tasks[taskId]) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            board.tasks[taskId].title = title;
            board.tasks[taskId].description = description;
            board.tasks[taskId].labelIds = labelIds;
            board.tasks[taskId].priority = priority;
            board.tasks[taskId].dueDate = dueDate;
            board.tasks[taskId].updatedAt = Date.now();
            if (user) {
                board.tasks[taskId].lastModifiedBy = user;
            }
            this.addActivity(board, "task_updated", `Updated "${title}"`, user, {
                taskId,
            });
        });
    }
    static async deleteTask(taskId) {
        await this.mutateBoard(async (board) => {
            const taskTitle = board.tasks[taskId]?.title || "task";
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            this.addTombstone(board, "task", taskId, user);
            delete board.tasks[taskId];
            Object.values(board.tasks).forEach((task) => {
                task.relations = (task.relations || []).filter((relation) => relation.targetTaskId !== taskId);
            });
            this.addActivity(board, "task_deleted", `Deleted "${taskTitle}"`, user, {
                taskId,
            });
        });
    }
    static async addChecklistItem(taskId, text) {
        await this.mutateBoard(async (board) => {
            const task = board.tasks[taskId];
            if (!task || !text.trim()) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const now = Date.now();
            const item = {
                id: this.createId("check"),
                text: text.trim(),
                done: false,
                createdAt: now,
                updatedAt: now,
            };
            task.checklist = [...(task.checklist || []), item];
            task.updatedAt = now;
            if (user) {
                task.lastModifiedBy = user;
            }
            this.addActivity(board, "checklist_added", `Added checklist item to "${task.title}"`, user, {
                taskId,
            });
        });
    }
    static async updateChecklistItem(taskId, itemId, updates) {
        await this.mutateBoard(async (board) => {
            const task = board.tasks[taskId];
            const item = task?.checklist?.find((entry) => entry.id === itemId);
            if (!task || !item) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            if (typeof updates.text === "string") {
                item.text = updates.text.trim();
            }
            if (typeof updates.done === "boolean") {
                item.done = updates.done;
            }
            const now = Date.now();
            item.updatedAt = now;
            task.updatedAt = now;
            if (user) {
                task.lastModifiedBy = user;
            }
            this.addActivity(board, "checklist_updated", `${item.done ? "Completed" : "Updated"} checklist item in "${task.title}"`, user, { taskId });
        });
    }
    static async deleteChecklistItem(taskId, itemId) {
        await this.mutateBoard(async (board) => {
            const task = board.tasks[taskId];
            if (!task) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            task.checklist = (task.checklist || []).filter((item) => item.id !== itemId);
            task.updatedAt = Date.now();
            if (user) {
                task.lastModifiedBy = user;
            }
            this.addActivity(board, "checklist_deleted", `Removed checklist item from "${task.title}"`, user, {
                taskId,
            });
        });
    }
    static async addTaskRelation(taskId, targetTaskId, type) {
        await this.mutateBoard(async (board) => {
            const task = board.tasks[taskId];
            if (!task || !board.tasks[targetTaskId] || taskId === targetTaskId) {
                return;
            }
            const relations = task.relations || [];
            const alreadyExists = relations.some((relation) => relation.targetTaskId === targetTaskId && relation.type === type);
            if (alreadyExists) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const relation = {
                id: this.createId("rel"),
                type,
                targetTaskId,
                createdAt: Date.now(),
            };
            task.relations = [...relations, relation];
            task.updatedAt = Date.now();
            if (user) {
                task.lastModifiedBy = user;
            }
            this.addActivity(board, "relation_added", `Linked "${task.title}" to "${board.tasks[targetTaskId].title}"`, user, { taskId, targetTaskId, metadata: { type } });
        });
    }
    static async deleteTaskRelation(taskId, relationId) {
        await this.mutateBoard(async (board) => {
            const task = board.tasks[taskId];
            if (!task) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            task.relations = (task.relations || []).filter((relation) => relation.id !== relationId);
            task.updatedAt = Date.now();
            if (user) {
                task.lastModifiedBy = user;
            }
            this.addActivity(board, "relation_deleted", `Removed relation from "${task.title}"`, user, {
                taskId,
            });
        });
    }
    static async resolveConflict(conflictId, resolution) {
        await this.mutateBoard((board) => {
            const conflict = board.conflicts?.[conflictId];
            if (!conflict || conflict.resolved) {
                return;
            }
            const task = board.tasks[conflict.entityId];
            if (task && resolution === "remote") {
                if (conflict.field === "dueDate") {
                    task.dueDate =
                        typeof conflict.remoteValue === "number" ? conflict.remoteValue : undefined;
                }
                else if (conflict.field === "priority") {
                    task.priority =
                        conflict.remoteValue === "low" ||
                            conflict.remoteValue === "medium" ||
                            conflict.remoteValue === "high"
                            ? conflict.remoteValue
                            : "medium";
                }
                else {
                    task[conflict.field] =
                        typeof conflict.remoteValue === "string" ? conflict.remoteValue : "";
                }
                task.updatedAt = Date.now();
            }
            conflict.resolved = true;
            const unresolved = Object.values(board.conflicts || {}).some((item) => !item.resolved);
            board.sync = {
                ...this.getDefaultSyncMetadata(),
                ...(board.sync || {}),
                status: unresolved ? "conflict" : "pending",
                pendingChanges: true,
                message: unresolved ? "Unresolved conflicts" : "Conflicts resolved",
                updatedAt: Date.now(),
            };
        });
    }
    static async createColumn(title, color) {
        await this.mutateBoard(async (board) => {
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const colId = this.createId("col");
            const position = Object.keys(board.columns).length;
            board.columns[colId] = { id: colId, title, color, position };
            this.addActivity(board, "column_created", `Created column "${title}"`, user, {
                metadata: { columnId: colId },
            });
        });
    }
    static async editColumn(id, title, color) {
        await this.mutateBoard(async (board) => {
            if (!board.columns[id]) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            board.columns[id].title = title;
            board.columns[id].color = color;
            this.addActivity(board, "column_updated", `Updated column "${title}"`, user, {
                metadata: { columnId: id },
            });
        });
    }
    static async deleteColumn(id) {
        await this.mutateBoard(async (board) => {
            if (!board.columns[id]) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const title = board.columns[id].title;
            const columnsCount = Object.keys(board.columns).length;
            if (columnsCount <= 1) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("No puedes eliminar la última columna del tablero.");
                return;
            }
            delete board.columns[id];
            this.addTombstone(board, "column", id, user);
            this.addActivity(board, "column_deleted", `Deleted column "${title}"`, user, {
                metadata: { columnId: id },
            });
            for (const taskId in board.tasks) {
                if (board.tasks[taskId].status === id) {
                    delete board.tasks[taskId];
                }
            }
        });
    }
    static async reorderColumns(updates) {
        await this.mutateBoard((board) => {
            updates.forEach((upd) => {
                if (board.columns[upd.id]) {
                    board.columns[upd.id].position = upd.position;
                }
            });
        });
    }
    static async createLabel(name, color) {
        await this.mutateBoard(async (board) => {
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            if (!board.labels) {
                board.labels = {};
            }
            const labelId = this.createId("label");
            board.labels[labelId] = { id: labelId, name, color };
            this.addActivity(board, "label_created", `Created label "${name}"`, user, {
                metadata: { labelId },
            });
        });
    }
    static async deleteLabel(labelId) {
        await this.mutateBoard(async (board) => {
            if (!board.labels || !board.labels[labelId]) {
                return;
            }
            const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
            const name = board.labels[labelId].name;
            this.addTombstone(board, "label", labelId, user);
            delete board.labels[labelId];
            Object.values(board.tasks).forEach((task) => {
                task.labelIds = (task.labelIds || []).filter((id) => id !== labelId);
            });
            this.addActivity(board, "label_deleted", `Deleted label "${name}"`, user, {
                metadata: { labelId },
            });
        });
    }
}


/***/ },

/***/ "./src/providers/GitService.ts"
/*!*************************************!*\
  !*** ./src/providers/GitService.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GitService: () => (/* binding */ GitService)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var child_process__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! child_process */ "child_process");
/* harmony import */ var child_process__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(child_process__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! fs/promises */ "fs/promises");
/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(fs_promises__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var os__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! os */ "os");
/* harmony import */ var os__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(os__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! path */ "path");
/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(path__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _DataManager__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");






const DEFAULT_SYNC = {
    branch: "lynvo-sync",
    status: "idle",
    pendingChanges: false,
    lastSyncAt: null,
    lastRemoteCommit: null,
    updatedAt: 0,
};
class GitService {
    static SHADOW_BRANCH = "lynvo-sync";
    static EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    static syncQueue = Promise.resolve({
        success: true,
        message: "Sincronización pendiente.",
    });
    static scheduledSync;
    static getWorkspacePath() {
        const folders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
    }
    static execGit(args, options) {
        return new Promise((resolve, reject) => {
            const child = child_process__WEBPACK_IMPORTED_MODULE_1__.spawn("git", args, {
                cwd: options.cwd,
                env: {
                    ...process.env,
                    ...options.env,
                },
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    const details = stderr.trim() || stdout.trim() || `git ${args[0]} failed`;
                    reject(new Error(`git ${args.join(" ")}: ${details}`));
                }
            });
            if (options.input) {
                child.stdin.write(options.input);
            }
            child.stdin.end();
        });
    }
    static async pathExists(filePath) {
        try {
            await fs_promises__WEBPACK_IMPORTED_MODULE_2__.stat(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    static async readJson(filePath) {
        const raw = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readFile(filePath, "utf8");
        try {
            return JSON.parse(raw);
        }
        catch (error) {
            await this.backupCorruptJson(filePath, raw).catch((backupError) => console.error(`Lynvo: failed to backup corrupt remote json ${filePath}`, backupError));
            throw error;
        }
    }
    static async backupCorruptJson(filePath, raw) {
        const fileName = path__WEBPACK_IMPORTED_MODULE_4__.basename(filePath);
        if (fileName.includes(".corrupt-")) {
            return;
        }
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.writeFile(`${filePath}.corrupt-${Date.now()}`, raw, "utf8");
    }
    static async readOptionalJson(filePath, fallback) {
        if (!(await this.pathExists(filePath))) {
            return fallback;
        }
        try {
            return await this.readJson(filePath);
        }
        catch {
            return fallback;
        }
    }
    static async writeJson(filePath, value) {
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(path__WEBPACK_IMPORTED_MODULE_4__.dirname(filePath), { recursive: true });
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    static async ensureExcludedFromActiveWorktree(repoRoot, relativeLynvoPath) {
        const excludePath = await this.execGit(["rev-parse", "--git-path", "info/exclude"], {
            cwd: repoRoot,
        });
        const absoluteExcludePath = path__WEBPACK_IMPORTED_MODULE_4__.isAbsolute(excludePath)
            ? excludePath
            : path__WEBPACK_IMPORTED_MODULE_4__.join(repoRoot, excludePath);
        const normalizedEntry = `/${relativeLynvoPath}/`;
        const current = (await this.pathExists(absoluteExcludePath))
            ? await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readFile(absoluteExcludePath, "utf8")
            : "";
        if (current.split(/\r?\n/).includes(normalizedEntry)) {
            return;
        }
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(path__WEBPACK_IMPORTED_MODULE_4__.dirname(absoluteExcludePath), { recursive: true });
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.appendFile(absoluteExcludePath, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${normalizedEntry}\n`, "utf8");
    }
    static async readBoardFromFolder(root) {
        const boardPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "board.json");
        const columnsPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "columns.json");
        const usersPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "users.json");
        const tasksPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "tasks");
        const activityPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "activity");
        const metadataPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata");
        if (!(await this.pathExists(boardPath)) || !(await this.pathExists(columnsPath))) {
            return null;
        }
        const metadata = await this.readJson(boardPath);
        const columns = await this.readJson(columnsPath);
        const users = await this.readOptionalJson(usersPath, {});
        const tasks = {};
        const activity = {};
        const sync = await this.readOptionalJson(path__WEBPACK_IMPORTED_MODULE_4__.join(metadataPath, "sync.json"), DEFAULT_SYNC);
        const tombstones = await this.readOptionalJson(path__WEBPACK_IMPORTED_MODULE_4__.join(metadataPath, "tombstones.json"), {});
        const conflicts = await this.readOptionalJson(path__WEBPACK_IMPORTED_MODULE_4__.join(metadataPath, "conflicts.json"), {});
        if (await this.pathExists(tasksPath)) {
            const entries = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readdir(tasksPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith(".json")) {
                    continue;
                }
                try {
                    const task = await this.readJson(path__WEBPACK_IMPORTED_MODULE_4__.join(tasksPath, entry.name));
                    if (task.id) {
                        tasks[task.id] = task;
                    }
                }
                catch (error) {
                    console.error(`Lynvo: invalid remote task file ${entry.name}`, error);
                }
            }
        }
        if (await this.pathExists(activityPath)) {
            const entries = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readdir(activityPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith(".json")) {
                    continue;
                }
                try {
                    const item = await this.readJson(path__WEBPACK_IMPORTED_MODULE_4__.join(activityPath, entry.name));
                    if (item.id) {
                        activity[item.id] = item;
                    }
                }
                catch (error) {
                    console.error(`Lynvo: invalid remote activity file ${entry.name}`, error);
                }
            }
        }
        return {
            version: metadata.version || "2.0.0",
            columns,
            tasks,
            labels: metadata.labels || {},
            users,
            activity,
            sync,
            tombstones,
            conflicts,
        };
    }
    static async writeBoardToFolder(root, board) {
        const tasksPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "tasks");
        const activityPath = path__WEBPACK_IMPORTED_MODULE_4__.join(root, "activity");
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(tasksPath, { recursive: true });
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "comments"), { recursive: true });
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "activity"), { recursive: true });
        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdir(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata"), { recursive: true });
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "board.json"), {
            version: "2.0.0",
            labels: board.labels || {},
        });
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "columns.json"), board.columns);
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "users.json"), board.users || {});
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "settings.json"), {});
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata", "version.json"), {
            schemaVersion: "2.0.0",
        });
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata", "sync.json"), {
            branch: this.SHADOW_BRANCH,
            status: board.sync?.status || "synced",
            pendingChanges: board.sync?.pendingChanges || false,
            lastSyncAt: board.sync?.lastSyncAt || null,
            lastRemoteCommit: board.sync?.lastRemoteCommit || null,
            message: board.sync?.message,
            updatedAt: Date.now(),
        });
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata", "tombstones.json"), board.tombstones || {});
        await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(root, "metadata", "conflicts.json"), board.conflicts || {});
        const expected = new Set();
        for (const task of Object.values(board.tasks)) {
            expected.add(`${task.id}.json`);
            await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(tasksPath, `${task.id}.json`), task);
        }
        const entries = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readdir(tasksPath, { withFileTypes: true });
        await Promise.all(entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !expected.has(entry.name))
            .map((entry) => fs_promises__WEBPACK_IMPORTED_MODULE_2__.unlink(path__WEBPACK_IMPORTED_MODULE_4__.join(tasksPath, entry.name))));
        const expectedActivity = new Set();
        for (const item of Object.values(board.activity || {})
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 500)) {
            expectedActivity.add(`${item.id}.json`);
            await this.writeJson(path__WEBPACK_IMPORTED_MODULE_4__.join(activityPath, `${item.id}.json`), item);
        }
        const activityEntries = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.readdir(activityPath, { withFileTypes: true });
        await Promise.all(activityEntries
            .filter((entry) => entry.isFile() &&
            entry.name.endsWith(".json") &&
            !expectedActivity.has(entry.name))
            .map((entry) => fs_promises__WEBPACK_IMPORTED_MODULE_2__.unlink(path__WEBPACK_IMPORTED_MODULE_4__.join(activityPath, entry.name))));
    }
    static mergeBoards(localBoard, remoteBoard) {
        const mergedTombstones = {
            ...(remoteBoard.tombstones || {}),
            ...(localBoard.tombstones || {}),
        };
        const mergedConflicts = {
            ...(remoteBoard.conflicts || {}),
            ...(localBoard.conflicts || {}),
        };
        const mergedTasks = {};
        const isDeleted = (taskId, updatedAt) => {
            const tombstone = mergedTombstones[`task-${taskId}`];
            return Boolean(tombstone && tombstone.deletedAt >= updatedAt);
        };
        for (const [taskId, remoteTask] of Object.entries(remoteBoard.tasks)) {
            if (!isDeleted(taskId, remoteTask.updatedAt)) {
                mergedTasks[taskId] = remoteTask;
            }
        }
        for (const [taskId, localTask] of Object.entries(localBoard.tasks)) {
            if (isDeleted(taskId, localTask.updatedAt)) {
                delete mergedTasks[taskId];
                continue;
            }
            const remoteTask = mergedTasks[taskId];
            if (!remoteTask || localTask.updatedAt >= remoteTask.updatedAt) {
                if (remoteTask && localTask.updatedAt !== remoteTask.updatedAt) {
                    ["title", "description", "status", "priority", "dueDate"].forEach((field) => {
                        const localValue = localTask[field] ?? null;
                        const remoteValue = remoteTask[field] ?? null;
                        if (localValue !== remoteValue) {
                            const conflictId = `task-${taskId}-${field}`;
                            mergedConflicts[conflictId] = {
                                id: conflictId,
                                entityType: "task",
                                entityId: taskId,
                                field,
                                localValue,
                                remoteValue,
                                createdAt: Date.now(),
                                resolved: false,
                            };
                        }
                    });
                }
                mergedTasks[taskId] = localTask;
            }
        }
        const mergedColumns = {
            ...remoteBoard.columns,
            ...localBoard.columns,
        };
        const mergedLabels = {
            ...(remoteBoard.labels || {}),
            ...(localBoard.labels || {}),
        };
        Object.values(mergedTombstones).forEach((tombstone) => {
            if (tombstone.entityType === "column") {
                delete mergedColumns[tombstone.entityId];
            }
            if (tombstone.entityType === "label") {
                delete mergedLabels[tombstone.entityId];
            }
        });
        return {
            version: "2.0.0",
            columns: mergedColumns,
            tasks: mergedTasks,
            labels: mergedLabels,
            users: {
                ...(remoteBoard.users || {}),
                ...(localBoard.users || {}),
            },
            activity: {
                ...(remoteBoard.activity || {}),
                ...(localBoard.activity || {}),
            },
            tombstones: mergedTombstones,
            conflicts: mergedConflicts,
            sync: {
                ...DEFAULT_SYNC,
                ...(localBoard.sync || {}),
                status: Object.values(mergedConflicts).some((conflict) => !conflict.resolved)
                    ? "conflict"
                    : "syncing",
                pendingChanges: true,
                message: "Sync merge completed",
                updatedAt: Date.now(),
            },
        };
    }
    static async ensureShadowBranch(repoRoot) {
        try {
            await this.execGit(["show-ref", "--verify", `refs/heads/${this.SHADOW_BRANCH}`], {
                cwd: repoRoot,
            });
            return;
        }
        catch {
            // Continue and try to create it from remote or an empty technical commit.
        }
        try {
            await this.execGit(["show-ref", "--verify", `refs/remotes/origin/${this.SHADOW_BRANCH}`], { cwd: repoRoot });
            await this.execGit(["branch", this.SHADOW_BRANCH, `origin/${this.SHADOW_BRANCH}`], {
                cwd: repoRoot,
            });
            return;
        }
        catch {
            // Remote branch does not exist yet.
        }
        const commitSha = await this.execGit(["commit-tree", this.EMPTY_TREE_SHA, "-m", "Initialize Lynvo sync branch"], {
            cwd: repoRoot,
            env: {
                GIT_AUTHOR_NAME: "Lynvo",
                GIT_AUTHOR_EMAIL: "lynvo-sync@users.noreply.github.com",
                GIT_COMMITTER_NAME: "Lynvo",
                GIT_COMMITTER_EMAIL: "lynvo-sync@users.noreply.github.com",
            },
        });
        await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, commitSha], {
            cwd: repoRoot,
        });
    }
    static async pushShadowBranch(repoRoot, worktreePath) {
        try {
            await this.execGit(["push", "-u", "origin", `HEAD:${this.SHADOW_BRANCH}`], {
                cwd: worktreePath,
            });
            return;
        }
        catch (firstError) {
            try {
                await this.execGit([
                    "push",
                    "-u",
                    "origin",
                    `refs/heads/${this.SHADOW_BRANCH}:refs/heads/${this.SHADOW_BRANCH}`,
                ], { cwd: repoRoot });
                return;
            }
            catch (secondError) {
                const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
                const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
                throw new Error(`${firstMessage}. Retry failed: ${secondMessage}`);
            }
        }
    }
    static async syncBoardNow() {
        const workspacePath = this.getWorkspacePath();
        if (!workspacePath) {
            return {
                success: false,
                message: "Workspace not found.",
                hasConflicts: false,
            };
        }
        let tempWorktree;
        let stage = "repo";
        try {
            const repoRoot = await this.execGit(["rev-parse", "--show-toplevel"], {
                cwd: workspacePath,
            });
            stage = "exclude";
            const localLynvoPath = path__WEBPACK_IMPORTED_MODULE_4__.join(workspacePath, ".vscode", "lynvo");
            const relativeLynvoPath = path__WEBPACK_IMPORTED_MODULE_4__.relative(repoRoot, localLynvoPath)
                .split(path__WEBPACK_IMPORTED_MODULE_4__.sep)
                .join("/");
            await this.ensureExcludedFromActiveWorktree(repoRoot, relativeLynvoPath);
            stage = "load";
            await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.updateSyncMetadata({
                status: "syncing",
                message: "Synchronizing Lynvo board",
            });
            const localBoard = await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.loadBoard();
            if (!localBoard) {
                return {
                    success: false,
                    message: "No local board to sync.",
                    remoteChanged: false,
                    hasConflicts: false,
                };
            }
            const previousRemoteCommit = localBoard.sync?.lastRemoteCommit || null;
            let fetchedRemoteCommit = null;
            stage = "fetch";
            try {
                await this.execGit(["fetch", "origin", this.SHADOW_BRANCH], {
                    cwd: repoRoot,
                });
            }
            catch {
                // First sync or offline remote branch absence. We can still update locally.
            }
            stage = "branch";
            await this.ensureShadowBranch(repoRoot);
            try {
                const remoteSha = await this.execGit(["rev-parse", `refs/remotes/origin/${this.SHADOW_BRANCH}`], { cwd: repoRoot });
                fetchedRemoteCommit = remoteSha;
                await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, remoteSha], {
                    cwd: repoRoot,
                });
            }
            catch {
                // Offline or first sync. Keep the local technical branch as the base.
            }
            stage = "worktree";
            tempWorktree = await fs_promises__WEBPACK_IMPORTED_MODULE_2__.mkdtemp(path__WEBPACK_IMPORTED_MODULE_4__.join(os__WEBPACK_IMPORTED_MODULE_3__.tmpdir(), "lynvo-sync-"));
            await this.execGit(["worktree", "add", "--force", "--detach", tempWorktree, this.SHADOW_BRANCH], {
                cwd: repoRoot,
            });
            stage = "merge";
            const shadowLynvoPath = path__WEBPACK_IMPORTED_MODULE_4__.join(tempWorktree, relativeLynvoPath);
            const remoteBoard = await this.readBoardFromFolder(shadowLynvoPath);
            const mergedBoard = remoteBoard
                ? this.mergeBoards(localBoard, remoteBoard)
                : localBoard;
            await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.saveBoard(mergedBoard);
            await this.writeBoardToFolder(shadowLynvoPath, mergedBoard);
            stage = "commit";
            await this.execGit(["add", "-f", relativeLynvoPath], { cwd: tempWorktree });
            const status = await this.execGit(["status", "--porcelain", relativeLynvoPath], {
                cwd: tempWorktree,
            });
            if (status) {
                await this.execGit([
                    "-c",
                    "user.name=Lynvo",
                    "-c",
                    "user.email=lynvo-sync@users.noreply.github.com",
                    "commit",
                    "-m",
                    "(Lynvo): sync board state [skip ci]",
                ], { cwd: tempWorktree });
            }
            const shadowHead = await this.execGit(["rev-parse", "HEAD"], {
                cwd: tempWorktree,
            });
            await this.execGit(["update-ref", `refs/heads/${this.SHADOW_BRANCH}`, shadowHead], {
                cwd: repoRoot,
            });
            stage = "push";
            try {
                await this.pushShadowBranch(repoRoot, tempWorktree);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.updateSyncMetadata({
                    status: "offline",
                    message: detail,
                }).catch(() => { });
                return {
                    success: false,
                    message: `Lynvo guardó los cambios localmente, pero no pudo subir lynvo-sync. ${detail}`,
                    remoteChanged: false,
                    hasConflicts: false,
                };
            }
            const hasConflicts = Object.values(mergedBoard.conflicts || {}).some((conflict) => !conflict.resolved);
            await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.updateSyncMetadata({
                status: hasConflicts ? "conflict" : "synced",
                pendingChanges: false,
                lastSyncAt: Date.now(),
                lastRemoteCommit: shadowHead,
                message: "Synced",
            });
            return {
                success: true,
                message: "Lynvo synced the board on the technical branch lynvo-sync.",
                remoteChanged: Boolean(previousRemoteCommit &&
                    fetchedRemoteCommit &&
                    fetchedRemoteCommit !== previousRemoteCommit),
                hasConflicts,
            };
        }
        catch (error) {
            console.error("Lynvo Git Error:", error);
            const detail = error instanceof Error ? error.message : String(error);
            await _DataManager__WEBPACK_IMPORTED_MODULE_5__.DataManager.updateSyncMetadata({
                status: stage === "fetch" || stage === "push" ? "offline" : "failed",
                message: detail,
            }).catch(() => { });
            return {
                success: false,
                message: `Lynvo no pudo sincronizar (${stage}). ${detail}`,
                remoteChanged: false,
                hasConflicts: false,
            };
        }
        finally {
            if (tempWorktree) {
                const workspacePathForCleanup = this.getWorkspacePath();
                if (workspacePathForCleanup) {
                    try {
                        const repoRoot = await this.execGit(["rev-parse", "--show-toplevel"], {
                            cwd: workspacePathForCleanup,
                        });
                        await this.execGit(["worktree", "remove", "--force", tempWorktree], {
                            cwd: repoRoot,
                        });
                    }
                    catch {
                        await fs_promises__WEBPACK_IMPORTED_MODULE_2__.rm(tempWorktree, { recursive: true, force: true }).catch(() => { });
                    }
                }
            }
        }
    }
    static async syncBoard() {
        this.syncQueue = this.syncQueue.then(() => this.syncBoardNow());
        return this.syncQueue;
    }
    static scheduleBoardSync(delayMs = 15000, onComplete) {
        if (this.scheduledSync) {
            clearTimeout(this.scheduledSync);
        }
        this.scheduledSync = setTimeout(() => {
            this.scheduledSync = undefined;
            this.syncBoard().then((result) => {
                onComplete?.(result);
                if (!result.success) {
                    console.warn(`Lynvo background sync skipped: ${result.message}`);
                }
            });
        }, delayMs);
    }
    static cancelScheduledSync() {
        if (this.scheduledSync) {
            clearTimeout(this.scheduledSync);
            this.scheduledSync = undefined;
        }
    }
}


/***/ },

/***/ "./src/providers/LynvoMenuProvider.ts"
/*!********************************************!*\
  !*** ./src/providers/LynvoMenuProvider.ts ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LynvoMenuProvider: () => (/* binding */ LynvoMenuProvider)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);

class LynvoMenuProvider {
    menuItems = [
        {
            label: "Open Board",
            command: "lynvo.openBoard",
            tooltip: "Abre el tablero principal de Kanban",
            icon: "board",
        },
        {
            label: "Open Insights",
            command: "lynvo.openInsights",
            tooltip: "Muestra métricas y salud del proyecto",
            icon: "graph",
        },
        {
            label: "Open Table",
            command: "lynvo.openTable",
            tooltip: "Abre la vista tabla de tareas",
            icon: "table",
        },
        {
            label: "Open Activity",
            command: "lynvo.openActivity",
            tooltip: "Muestra el historial de actividad del equipo",
            icon: "history",
        },
        {
            label: "Open Conflicts",
            command: "lynvo.openConflicts",
            tooltip: "Revisa conflictos de sincronización pendientes",
            icon: "warning",
        },
        {
            label: "Manage Labels",
            command: "lynvo.openLabels",
            tooltip: "Administra etiquetas del tablero",
            icon: "tag",
        },
        {
            label: "New Task",
            command: "lynvo.quickCreateTask",
            tooltip: "Crea una tarea rápida desde un asistente",
            icon: "add",
        },
        {
            label: "New Task from Code",
            command: "lynvo.createTaskFromCode",
            tooltip: "Crea una tarea usando la selección actual de código",
            icon: "code",
        },
        {
            label: "Sync Team Board",
            command: "lynvo.syncBoard",
            tooltip: "Sincroniza Lynvo mediante la rama técnica lynvo-sync",
            icon: "sync",
        },
        {
            label: "Connect GitHub",
            command: "lynvo.connectGitHub",
            tooltip: "Conecta y valida tu identidad de GitHub",
            icon: "github",
        },
    ];
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.menuItems.map((item) => this.createMenuItem(item)));
    }
    createMenuItem({ label, command, tooltip, icon }) {
        const item = new vscode__WEBPACK_IMPORTED_MODULE_0__.TreeItem(label, vscode__WEBPACK_IMPORTED_MODULE_0__.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.tooltip = tooltip;
        item.iconPath = new vscode__WEBPACK_IMPORTED_MODULE_0__.ThemeIcon(icon);
        return item;
    }
}


/***/ },

/***/ "./src/providers/LynvoPanel.ts"
/*!*************************************!*\
  !*** ./src/providers/LynvoPanel.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LynvoPanel: () => (/* binding */ LynvoPanel)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _DataManager__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
/* harmony import */ var _GitService__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./GitService */ "./src/providers/GitService.ts");



const isRecord = (value) => typeof value === "object" && value !== null;
const asString = (value) => typeof value === "string" ? value : undefined;
const asStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
const asNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const asBoolean = (value) => typeof value === "boolean" ? value : undefined;
const asRelationType = (value) => value === "blocks" ||
    value === "blocked-by" ||
    value === "related" ||
    value === "duplicates"
    ? value
    : undefined;
const asPriority = (value) => value === "low" || value === "medium" || value === "high" ? value : undefined;
const asResolution = (value) => value === "local" || value === "remote" ? value : undefined;
const asCodeReference = (value) => {
    if (!isRecord(value)) {
        return undefined;
    }
    const filePath = asString(value.filePath);
    const lineStart = asNumber(value.lineStart);
    const lineEnd = asNumber(value.lineEnd);
    if (!filePath || lineStart === undefined || lineEnd === undefined) {
        return undefined;
    }
    return { filePath, lineStart, lineEnd };
};
const isSafeWorkspaceRelativePath = (filePath) => !filePath.startsWith("/") &&
    !filePath.startsWith("\\") &&
    !filePath.includes("..") &&
    !/^[a-zA-Z]:[\\/]/.test(filePath);
const asTaskReorderUpdates = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!isRecord(item)) {
            return [];
        }
        const id = asString(item.id);
        const status = asString(item.status);
        const position = asNumber(item.position);
        if (!id || !status || position === undefined) {
            return [];
        }
        return [
            { id, status, position, isDraggedTask: asBoolean(item.isDraggedTask) },
        ];
    });
};
const asColumnReorderUpdates = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!isRecord(item)) {
            return [];
        }
        const id = asString(item.id);
        const position = asNumber(item.position);
        if (!id || position === undefined) {
            return [];
        }
        return [{ id, position }];
    });
};
class LynvoPanel {
    static currentPanel;
    _panel;
    _disposables = [];
    constructor(panel, extensionUri) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
        this._setWebviewMessageListener(this._panel.webview);
    }
    static render(extensionUri, initialView = "board") {
        if (LynvoPanel.currentPanel) {
            LynvoPanel.currentPanel._panel.reveal(vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One);
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "switchView",
                view: initialView,
            });
        }
        else {
            const panel = vscode__WEBPACK_IMPORTED_MODULE_0__.window.createWebviewPanel("lynvoBoard", "Lynvo - Project Board", vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, "dist")],
            });
            LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "switchView",
                view: initialView,
            });
        }
    }
    static async refreshData() {
        if (LynvoPanel.currentPanel) {
            const board = await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.loadBoard();
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "loadData",
                data: board,
            });
        }
    }
    static async refreshDataAndScheduleSync() {
        await LynvoPanel.refreshData();
        _GitService__WEBPACK_IMPORTED_MODULE_2__.GitService.scheduleBoardSync(15000, (result) => {
            if (result.success) {
                LynvoPanel.refreshData();
            }
        });
    }
    dispose() {
        LynvoPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }
    _setWebviewMessageListener(webview) {
        webview.onDidReceiveMessage(async (message) => {
            if (!isRecord(message) || !asString(message.command)) {
                return;
            }
            switch (message.command) {
                case "requestData": {
                    const board = await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.loadBoard();
                    webview.postMessage({ command: "loadData", data: board });
                    return;
                }
                case "updateTaskStatus": {
                    const taskId = asString(message.taskId);
                    const newStatus = asString(message.newStatus);
                    if (!taskId || !newStatus) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.updateTaskStatus(taskId, newStatus);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "reorderTasks": {
                    const updates = asTaskReorderUpdates(message.updates);
                    if (updates.length === 0) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.reorderTasks(updates);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "createTask": {
                    const title = asString(message.title);
                    if (!title) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createTask(title, asString(message.description) || "", asString(message.targetColId), asStringArray(message.labelIds), asCodeReference(message.codeReference), asPriority(message.priority), asNumber(message.dueDate));
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "editTask": {
                    const taskId = asString(message.taskId);
                    const title = asString(message.title);
                    if (!taskId || !title) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.editTask(taskId, title, asString(message.description) || "", asStringArray(message.labelIds), asPriority(message.priority), asNumber(message.dueDate));
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "deleteTask": {
                    const taskId = asString(message.taskId);
                    if (!taskId) {
                        return;
                    }
                    const confirmTask = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Delete task?", { modal: true }, "Delete");
                    if (confirmTask === "Delete") {
                        await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteTask(taskId);
                        LynvoPanel.refreshDataAndScheduleSync();
                    }
                    return;
                }
                case "createColumn": {
                    const title = asString(message.title);
                    if (!title) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createColumn(title, asString(message.color) || "var(--vscode-charts-blue)");
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "editColumn": {
                    const colId = asString(message.colId);
                    const title = asString(message.title);
                    if (!colId || !title) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.editColumn(colId, title, asString(message.color) || "var(--vscode-charts-blue)");
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "deleteColumn": {
                    const colId = asString(message.colId);
                    if (!colId) {
                        return;
                    }
                    const confirmCol = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Delete column? ALL TASKS inside will be deleted.", { modal: true }, "Delete");
                    if (confirmCol === "Delete") {
                        await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteColumn(colId);
                        LynvoPanel.refreshDataAndScheduleSync();
                    }
                    return;
                }
                case "reorderColumns": {
                    const updates = asColumnReorderUpdates(message.updates);
                    if (updates.length === 0) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.reorderColumns(updates);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "createLabel": {
                    const name = asString(message.name);
                    if (!name) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createLabel(name, asString(message.color) || "#f85149");
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "deleteLabel": {
                    const labelId = asString(message.labelId);
                    if (!labelId) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteLabel(labelId);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "addChecklistItem": {
                    const taskId = asString(message.taskId);
                    const text = asString(message.text);
                    if (!taskId || !text) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.addChecklistItem(taskId, text);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "updateChecklistItem": {
                    const taskId = asString(message.taskId);
                    const itemId = asString(message.itemId);
                    if (!taskId || !itemId) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.updateChecklistItem(taskId, itemId, {
                        text: asString(message.text),
                        done: asBoolean(message.done),
                    });
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "deleteChecklistItem": {
                    const taskId = asString(message.taskId);
                    const itemId = asString(message.itemId);
                    if (!taskId || !itemId) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteChecklistItem(taskId, itemId);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "addTaskRelation": {
                    const taskId = asString(message.taskId);
                    const targetTaskId = asString(message.targetTaskId);
                    const relationType = asRelationType(message.relationType);
                    if (!taskId || !targetTaskId || !relationType) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.addTaskRelation(taskId, targetTaskId, relationType);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "deleteTaskRelation": {
                    const taskId = asString(message.taskId);
                    const relationId = asString(message.relationId);
                    if (!taskId || !relationId) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteTaskRelation(taskId, relationId);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "resolveConflict": {
                    const conflictId = asString(message.conflictId);
                    const resolution = asResolution(message.resolution);
                    if (!conflictId || !resolution) {
                        return;
                    }
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.resolveConflict(conflictId, resolution);
                    LynvoPanel.refreshDataAndScheduleSync();
                    return;
                }
                case "syncBoard": {
                    const result = await _GitService__WEBPACK_IMPORTED_MODULE_2__.GitService.syncBoard();
                    if (result.success && result.hasConflicts) {
                        const action = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo has synchronized the dashboard, but there are still conflicts to resolve.", "Open conflicts");
                        if (action === "Open conflicts") {
                            this._panel.webview.postMessage({
                                command: "switchView",
                                view: "conflicts",
                            });
                        }
                    }
                    else if (result.success) {
                        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(result.message);
                    }
                    else {
                        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage(result.message);
                    }
                    LynvoPanel.refreshData();
                    return;
                }
                case "openCode": {
                    const filePath = asString(message.filePath);
                    const lineStart = asNumber(message.lineStart);
                    if (!filePath ||
                        !isSafeWorkspaceRelativePath(filePath) ||
                        lineStart === undefined) {
                        return;
                    }
                    const folders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) {
                        return;
                    }
                    const fileUri = vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(folders[0].uri, filePath);
                    const doc = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.openTextDocument(fileUri);
                    const editor = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showTextDocument(doc, vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.Beside);
                    const pos = new vscode__WEBPACK_IMPORTED_MODULE_0__.Position(Math.max(0, lineStart - 1), 0);
                    editor.selection = new vscode__WEBPACK_IMPORTED_MODULE_0__.Selection(pos, pos);
                    editor.revealRange(new vscode__WEBPACK_IMPORTED_MODULE_0__.Range(pos, pos), vscode__WEBPACK_IMPORTED_MODULE_0__.TextEditorRevealType.InCenter);
                    return;
                }
            }
        }, undefined, this._disposables);
    }
    _getWebviewContent(webview, extensionUri) {
        const scriptUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, "dist", "webview.js"));
        const nonce = getNonce();
        const csp = [
            "default-src 'none'",
            `script-src 'nonce-${nonce}'`,
            "style-src 'unsafe-inline'",
            "img-src data: https:",
            "font-src data:",
        ].join("; ");
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; }
            .icon-btn:hover { opacity: 1; }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
            button { border-radius: 4px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}
function getNonce() {
    let t = "";
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        t += p.charAt(Math.floor(Math.random() * p.length));
    }
    return t;
}


/***/ },

/***/ "./src/providers/SkillInstaller.ts"
/*!*****************************************!*\
  !*** ./src/providers/SkillInstaller.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SkillInstaller: () => (/* binding */ SkillInstaller)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! fs/promises */ "fs/promises");
/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(fs_promises__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! path */ "path");
/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(path__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var os__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! os */ "os");
/* harmony import */ var os__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(os__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! crypto */ "crypto");
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(crypto__WEBPACK_IMPORTED_MODULE_4__);





const SKILL_NAME = "lynvo";
const GLOBAL_TARGETS = [
    {
        label: "OpenCode",
        getPath: () => path__WEBPACK_IMPORTED_MODULE_2__.join(os__WEBPACK_IMPORTED_MODULE_3__.homedir(), ".config", "opencode", "skills", SKILL_NAME),
        fileName: "SKILL.md",
        priority: "primary",
    },
    {
        label: "Claude Code",
        getPath: () => path__WEBPACK_IMPORTED_MODULE_2__.join(os__WEBPACK_IMPORTED_MODULE_3__.homedir(), ".claude", "skills", SKILL_NAME),
        fileName: "SKILL.md",
        priority: "primary",
    },
    {
        label: "Cline / Roo Code",
        getPath: () => path__WEBPACK_IMPORTED_MODULE_2__.join(os__WEBPACK_IMPORTED_MODULE_3__.homedir(), ".clinerules"),
        fileName: `${SKILL_NAME}.md`,
        priority: "secondary",
    },
];
const WORKSPACE_TARGETS = [
    {
        label: "Cursor",
        dirName: ".cursor",
        fileName: "rules.md",
        priority: "secondary",
    },
    {
        label: "Windsurf",
        dirName: ".windsurf",
        fileName: "rules.md",
        priority: "secondary",
    },
    {
        label: "GitHub Copilot",
        dirName: ".github",
        fileName: "copilot-instructions.md",
        priority: "tertiary",
    },
    {
        label: "OpenCode (project)",
        dirName: ".opencode",
        fileName: `skills/${SKILL_NAME}/SKILL.md`,
        priority: "primary",
    },
    {
        label: "Claude Code (project)",
        dirName: ".claude",
        fileName: `skills/${SKILL_NAME}/SKILL.md`,
        priority: "primary",
    },
    {
        label: "Agents (project)",
        dirName: ".agents",
        fileName: `skills/${SKILL_NAME}/SKILL.md`,
        priority: "secondary",
    },
];
class SkillInstaller {
    static SETTING_KEY = "autoInstallSkills";
    static LAST_HASH_KEY = "skillHash";
    static getWorkspaceUri() {
        const folders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri : undefined;
    }
    static getConfig() {
        return vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.getConfiguration("lynvo");
    }
    static async readEmbeddedSkill(extensionUri) {
        const uri = vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, "SKILL.md");
        const data = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readFile(uri);
        return Buffer.from(data).toString("utf8");
    }
    static hash(content) {
        return crypto__WEBPACK_IMPORTED_MODULE_4__.createHash("sha256").update(content).digest("hex").slice(0, 16);
    }
    static async fileExists(filePath) {
        try {
            await fs_promises__WEBPACK_IMPORTED_MODULE_1__.stat(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    static async dirExists(dirPath) {
        try {
            const stat = await fs_promises__WEBPACK_IMPORTED_MODULE_1__.stat(dirPath);
            return stat.isDirectory();
        }
        catch {
            return false;
        }
    }
    static async readInstalledSkill(filePath) {
        if (!(await this.fileExists(filePath))) {
            return null;
        }
        return fs_promises__WEBPACK_IMPORTED_MODULE_1__.readFile(filePath, "utf8");
    }
    static async installAll(extensionUri, context, options = {}) {
        const installed = [];
        const skipped = [];
        const errors = [];
        const autoInstall = this.getConfig().get(this.SETTING_KEY, true);
        if (!autoInstall && !options.force) {
            return { installed, skipped: ["autoInstallSkills is disabled"], errors };
        }
        const embedded = await this.readEmbeddedSkill(extensionUri);
        const embeddedHash = this.hash(embedded);
        const storedHash = context.globalState.get(this.LAST_HASH_KEY);
        if (!options.force && storedHash === embeddedHash) {
            return { installed, skipped: ["no changes detected"], errors };
        }
        for (const target of GLOBAL_TARGETS) {
            try {
                const dir = target.getPath();
                const filePath = path__WEBPACK_IMPORTED_MODULE_2__.join(dir, target.fileName);
                const existing = await this.readInstalledSkill(filePath);
                if (existing && !options.force) {
                    const existingHash = this.hash(existing);
                    if (existingHash === embeddedHash) {
                        skipped.push(`${target.label}: up to date`);
                        continue;
                    }
                }
                await fs_promises__WEBPACK_IMPORTED_MODULE_1__.mkdir(dir, { recursive: true });
                await fs_promises__WEBPACK_IMPORTED_MODULE_1__.writeFile(filePath, embedded, "utf8");
                installed.push(`${target.label}: ${filePath}`);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                errors.push(`${target.label}: ${detail}`);
            }
        }
        const workspaceUri = this.getWorkspaceUri();
        if (workspaceUri) {
            for (const target of WORKSPACE_TARGETS) {
                try {
                    const targetDir = path__WEBPACK_IMPORTED_MODULE_2__.join(workspaceUri.fsPath, target.dirName);
                    if (!(await this.dirExists(targetDir))) {
                        skipped.push(`${target.label}: directory not found (${target.dirName})`);
                        continue;
                    }
                    const filePath = path__WEBPACK_IMPORTED_MODULE_2__.join(workspaceUri.fsPath, target.dirName, target.fileName);
                    const existing = await this.readInstalledSkill(filePath);
                    if (existing && !options.force) {
                        const existingHash = this.hash(existing);
                        if (existingHash === embeddedHash) {
                            skipped.push(`${target.label}: up to date`);
                            continue;
                        }
                    }
                    await fs_promises__WEBPACK_IMPORTED_MODULE_1__.mkdir(path__WEBPACK_IMPORTED_MODULE_2__.dirname(filePath), { recursive: true });
                    await fs_promises__WEBPACK_IMPORTED_MODULE_1__.writeFile(filePath, embedded, "utf8");
                    installed.push(`${target.label}: ${filePath}`);
                }
                catch (err) {
                    const detail = err instanceof Error ? err.message : String(err);
                    errors.push(`${target.label}: ${detail}`);
                }
            }
        }
        if (installed.length > 0) {
            await context.globalState.update(this.LAST_HASH_KEY, embeddedHash);
        }
        return { installed, skipped, errors };
    }
    static async uninstallAll() {
        const removed = [];
        const errors = [];
        for (const target of GLOBAL_TARGETS) {
            try {
                const filePath = path__WEBPACK_IMPORTED_MODULE_2__.join(target.getPath(), target.fileName);
                if (await this.fileExists(filePath)) {
                    await fs_promises__WEBPACK_IMPORTED_MODULE_1__.unlink(filePath);
                    removed.push(`${target.label}: ${filePath}`);
                }
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                errors.push(`${target.label}: ${detail}`);
            }
        }
        return { removed, errors };
    }
}


/***/ },

/***/ "vscode"
/*!*************************!*\
  !*** external "vscode" ***!
  \*************************/
(module) {

module.exports = require("vscode");

/***/ },

/***/ "child_process"
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
(module) {

module.exports = require("child_process");

/***/ },

/***/ "crypto"
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
(module) {

module.exports = require("crypto");

/***/ },

/***/ "fs/promises"
/*!******************************!*\
  !*** external "fs/promises" ***!
  \******************************/
(module) {

module.exports = require("fs/promises");

/***/ },

/***/ "os"
/*!*********************!*\
  !*** external "os" ***!
  \*********************/
(module) {

module.exports = require("os");

/***/ },

/***/ "path"
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
(module) {

module.exports = require("path");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!**************************!*\
  !*** ./src/extension.ts ***!
  \**************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   activate: () => (/* binding */ activate),
/* harmony export */   deactivate: () => (/* binding */ deactivate)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _providers_AuthProvider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./providers/AuthProvider */ "./src/providers/AuthProvider.ts");
/* harmony import */ var _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./providers/LynvoPanel */ "./src/providers/LynvoPanel.ts");
/* harmony import */ var _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./providers/DataManager */ "./src/providers/DataManager.ts");
/* harmony import */ var _providers_LynvoMenuProvider__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./providers/LynvoMenuProvider */ "./src/providers/LynvoMenuProvider.ts");
/* harmony import */ var _providers_GitService__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./providers/GitService */ "./src/providers/GitService.ts");
/* harmony import */ var _providers_SkillInstaller__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./providers/SkillInstaller */ "./src/providers/SkillInstaller.ts");







async function createTask(title, description, columnId, codeRef) {
    await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.createTask(title.trim(), description, columnId, [], codeRef);
    vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage("Task created in Lynvo.");
    _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
    _providers_GitService__WEBPACK_IMPORTED_MODULE_5__.GitService.scheduleBoardSync();
}
async function quickCreateTask() {
    const board = await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.loadBoard();
    if (!board) {
        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo board not found. Open a project folder first.");
        return;
    }
    const title = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
        prompt: "Task title",
        validateInput: (value) => value.trim().length === 0 ? "Title cannot be empty." : null,
    });
    if (!title) {
        return;
    }
    const description = (await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
        prompt: "Description (optional)",
        placeHolder: "Brief context for the task...",
    })) || "";
    const sortedColumns = Object.values(board.columns).sort((a, b) => a.position - b.position);
    const selectedColumn = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showQuickPick(sortedColumns.map((column) => ({
        label: column.title,
        description: column.id,
        columnId: column.id,
    })), {
        title: "Select initial column",
        placeHolder: "Which column should the task start in?",
    });
    if (!selectedColumn) {
        return;
    }
    await createTask(title.trim(), description, selectedColumn.columnId);
}
function activate(context) {
    const lynvoMenuProvider = new _providers_LynvoMenuProvider__WEBPACK_IMPORTED_MODULE_4__.LynvoMenuProvider();
    const treeDataRegistration = vscode__WEBPACK_IMPORTED_MODULE_0__.window.registerTreeDataProvider("lynvo.sidebarMenu", lynvoMenuProvider);
    let refreshTimer;
    const schedulePanelRefresh = () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
        }, 250);
    };
    const boardWatcher = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.createFileSystemWatcher("**/.vscode/lynvo/**/*.json");
    boardWatcher.onDidChange(schedulePanelRefresh, null, context.subscriptions);
    boardWatcher.onDidCreate(schedulePanelRefresh, null, context.subscriptions);
    boardWatcher.onDidDelete(schedulePanelRefresh, null, context.subscriptions);
    _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.initializeBoard().catch((err) => console.error("Lynvo Init Error:", err));
    _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.touchCurrentUser().catch((err) => console.error("Lynvo Presence Error:", err));
    _providers_SkillInstaller__WEBPACK_IMPORTED_MODULE_6__.SkillInstaller.installAll(context.extensionUri, context, { silent: true }).then((result) => {
        if (result.installed.length > 0) {
            console.log(`Lynvo: skills installed → ${result.installed.join(", ")}`);
        }
        if (result.errors.length > 0) {
            console.warn(`Lynvo: skill install errors → ${result.errors.join(", ")}`);
        }
    }).catch((err) => console.error("Lynvo Skill Install Error:", err));
    context.subscriptions.push(treeDataRegistration);
    context.subscriptions.push(boardWatcher);
    const autoSyncInterval = setInterval(async () => {
        await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.touchCurrentUser().catch((err) => console.error("Lynvo Presence Error:", err));
        const result = await _providers_GitService__WEBPACK_IMPORTED_MODULE_5__.GitService.syncBoard();
        if (result.success) {
            await _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
            if (result.hasConflicts) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo detected sync conflicts. Open the Conflict Center to resolve them.", "Open conflicts").then((action) => {
                    if (action === "Open conflicts") {
                        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "conflicts");
                    }
                });
                return;
            }
            if (result.remoteChanged) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage("Lynvo detected team changes and updated the board.");
            }
        }
        else {
            console.warn(`Lynvo periodic sync skipped: ${result.message}`);
        }
    }, 120000);
    context.subscriptions.push({
        dispose: () => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
                refreshTimer = undefined;
            }
            clearInterval(autoSyncInterval);
            _providers_GitService__WEBPACK_IMPORTED_MODULE_5__.GitService.cancelScheduledSync();
        },
    });
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.connectGitHub", async () => {
        const user = await _providers_AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser({ createIfNone: true });
        if (user) {
            await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.touchCurrentUser();
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(`Connected as: ${user.username}`);
        }
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openBoard", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "board");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openInsights", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "insights");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openTable", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "table");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openActivity", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "activity");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openConflicts", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "conflicts");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openLabels", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "labels");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.syncBoard", async () => {
        const result = await _providers_GitService__WEBPACK_IMPORTED_MODULE_5__.GitService.syncBoard();
        if (result.success && result.hasConflicts) {
            const action = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Lynvo synced the board, but there are conflicts to resolve.", "Open conflicts");
            if (action === "Open conflicts") {
                _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "conflicts");
            }
        }
        else if (result.success) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(result.message);
        }
        else {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage(result.message);
        }
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.quickCreateTask", async () => {
        await quickCreateTask();
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.createTaskFromCode", async () => {
        const editor = vscode__WEBPACK_IMPORTED_MODULE_0__.window.activeTextEditor;
        if (!editor) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("No file is currently open.");
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection).trim();
        if (!text) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("Select a code fragment first.");
            return;
        }
        const title = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
            prompt: "Task title",
            validateInput: (value) => value.trim().length === 0 ? "Title cannot be empty." : null,
        });
        if (!title) {
            return;
        }
        const codeRef = {
            filePath: vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.asRelativePath(editor.document.uri),
            lineStart: selection.start.line + 1,
            lineEnd: selection.end.line + 1,
        };
        await createTask(title.trim(), text, undefined, codeRef);
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.installSkills", async () => {
        const result = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.withProgress({
            location: vscode__WEBPACK_IMPORTED_MODULE_0__.ProgressLocation.Notification,
            title: "Lynvo: Installing agent skills...",
            cancellable: false,
        }, () => _providers_SkillInstaller__WEBPACK_IMPORTED_MODULE_6__.SkillInstaller.installAll(context.extensionUri, context, { force: true }));
        const messages = [];
        if (result.installed.length > 0) {
            messages.push(`Installed: ${result.installed.length} location(s)`);
        }
        if (result.skipped.length > 0) {
            messages.push(`Skipped: ${result.skipped.length} location(s)`);
        }
        if (result.errors.length > 0) {
            messages.push(`Errors: ${result.errors.join("; ")}`);
        }
        if (messages.length === 0) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage("Lynvo skills are already up to date.");
        }
        else {
            const detail = messages.join("\n");
            if (result.errors.length > 0) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage(detail);
            }
            else {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(detail);
            }
        }
    }));
}
function deactivate() { }

})();

var __webpack_export_target__ = exports;
for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ })()
;
//# sourceMappingURL=extension.js.map