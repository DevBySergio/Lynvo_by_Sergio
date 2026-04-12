/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/extension.ts"
/*!**************************!*\
  !*** ./src/extension.ts ***!
  \**************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
// src/extension.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const AuthProvider_1 = __webpack_require__(/*! ./providers/AuthProvider */ "./src/providers/AuthProvider.ts");
const LynvoPanel_1 = __webpack_require__(/*! ./providers/LynvoPanel */ "./src/providers/LynvoPanel.ts");
const DataManager_1 = __webpack_require__(/*! ./providers/DataManager */ "./src/providers/DataManager.ts");
const LynvoMenuProvider_1 = __webpack_require__(/*! ./providers/LynvoMenuProvider */ "./src/providers/LynvoMenuProvider.ts");
const GitService_1 = __webpack_require__(/*! ./providers/GitService */ "./src/providers/GitService.ts");
function activate(context) {
    // 1. REGISTRAMOS EL MENÚ LATERAL
    const lynvoMenuProvider = new LynvoMenuProvider_1.LynvoMenuProvider();
    // Corregido: Ahora coincide exactamente con el ID de tu package.json
    context.subscriptions.push(vscode.window.registerTreeDataProvider("lynvo.sidebarMenu", lynvoMenuProvider));
    // 2. INICIALIZAMOS LA BASE DE DATOS
    DataManager_1.DataManager.initializeBoard().catch((err) => console.error("Lynvo Init Error:", err));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.testAuth", async () => {
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        if (user) {
            vscode.window.showInformationMessage(`Conectado como: ${user.username}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.connectGitHub", async () => {
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        if (user) {
            vscode.window.showInformationMessage(`GitHub conectado como ${user.username}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.checkGitHubStatus", async () => {
        const user = await AuthProvider_1.AuthProvider.getCurrentGitHubUser();
        if (user) {
            vscode.window.showInformationMessage(`Conexión activa con GitHub: ${user.username}`);
        }
        else {
            vscode.window.showWarningMessage("No hay sesión de GitHub activa. Usa “Connect GitHub”.");
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.syncBoard", async () => {
        const result = await GitService_1.GitService.syncBoard();
        if (result.success) {
            vscode.window.showInformationMessage(result.message);
        }
        else {
            vscode.window.showWarningMessage(result.message);
        }
        LynvoPanel_1.LynvoPanel.refreshData();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.openBoard", () => {
        LynvoPanel_1.LynvoPanel.render(context.extensionUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("lynvo.createTaskFromCode", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No hay ningún archivo abierto.");
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text) {
            vscode.window.showErrorMessage("Selecciona un fragmento de código primero.");
            return;
        }
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const codeRef = {
            filePath: filePath,
            lineStart: selection.start.line + 1,
        };
        const title = await vscode.window.showInputBox({
            prompt: "Título de la tarea",
        });
        if (!title)
            return;
        // Usamos el DataManager que ya tienes, que está perfecto
        await DataManager_1.DataManager.createTask(title, text, undefined, [], codeRef);
        vscode.window.showInformationMessage("Tarea creada en Lynvo.");
        LynvoPanel_1.LynvoPanel.refreshData();
    }));
}
function deactivate() { }


/***/ },

/***/ "./src/providers/AuthProvider.ts"
/*!***************************************!*\
  !*** ./src/providers/AuthProvider.ts ***!
  \***************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AuthProvider = void 0;
// src/providers/AuthProvider.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
class AuthProvider {
    static async getGitHubSession(createIfNone) {
        return vscode.authentication.getSession("github", ["read:user"], {
            createIfNone,
        });
    }
    /**
     * Solicita la sesión de GitHub a través de VS Code.
     * Si el usuario no ha iniciado sesión, VS Code le mostrará un prompt nativo.
     */
    static async getGitHubUser() {
        try {
            const session = await this.getGitHubSession(true);
            if (session) {
                return {
                    githubId: session.account.id,
                    username: session.account.label, // El nombre de usuario de GitHub
                };
            }
        }
        catch (error) {
            console.error("Lynvo: Error al autenticar con GitHub", error);
            vscode.window.showErrorMessage("Lynvo: Se requiere iniciar sesión con GitHub para identificar los cambios.");
        }
        return undefined; // Retorna undefined si el usuario cancela o hay un error
    }
    static async getCurrentGitHubUser() {
        try {
            const session = await this.getGitHubSession(false);
            if (!session)
                return undefined;
            return {
                githubId: session.account.id,
                username: session.account.label,
            };
        }
        catch {
            return undefined;
        }
    }
}
exports.AuthProvider = AuthProvider;


/***/ },

/***/ "./src/providers/DataManager.ts"
/*!**************************************!*\
  !*** ./src/providers/DataManager.ts ***!
  \**************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DataManager = void 0;
// src/providers/DataManager.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const AuthProvider_1 = __webpack_require__(/*! ./AuthProvider */ "./src/providers/AuthProvider.ts");
class DataManager {
    static FILENAME = "lynvo.json";
    static FOLDER = ".vscode";
    static getFileUri() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return undefined;
        return vscode.Uri.joinPath(workspaceFolders[0].uri, this.FOLDER, this.FILENAME);
    }
    static getFolderUri() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return undefined;
        return vscode.Uri.joinPath(workspaceFolders[0].uri, this.FOLDER);
    }
    static async initializeBoard() {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return;
        try {
            await vscode.workspace.fs.stat(fileUri);
            const board = await this.loadBoard();
            let changed = false;
            if (board && !board.columns) {
                board.columns = {
                    todo: {
                        id: "todo",
                        title: "📋 To Do",
                        color: "var(--vscode-charts-blue)",
                        position: 0,
                    },
                    "in-progress": {
                        id: "in-progress",
                        title: "⏳ In Progress",
                        color: "var(--vscode-charts-yellow)",
                        position: 1,
                    },
                    done: {
                        id: "done",
                        title: "✅ Done",
                        color: "var(--vscode-charts-green)",
                        position: 2,
                    },
                };
                changed = true;
            }
            if (board && !board.labels) {
                board.labels = {
                    bug: { id: "bug", name: "Bug", color: "#f85149" },
                    feat: { id: "feat", name: "Feature", color: "#a371f7" },
                };
                changed = true;
            }
            if (changed && board)
                await this.saveBoard(board);
        }
        catch (error) {
            const initialData = {
                version: "1.1.0",
                columns: {
                    todo: {
                        id: "todo",
                        title: "📋 To Do",
                        color: "var(--vscode-charts-blue)",
                        position: 0,
                    },
                    "in-progress": {
                        id: "in-progress",
                        title: "⏳ In Progress",
                        color: "var(--vscode-charts-yellow)",
                        position: 1,
                    },
                    done: {
                        id: "done",
                        title: "✅ Done",
                        color: "var(--vscode-charts-green)",
                        position: 2,
                    },
                },
                tasks: {},
                labels: {
                    bug: { id: "bug", name: "Bug", color: "#f85149" },
                    feat: { id: "feat", name: "Feature", color: "#a371f7" },
                },
            };
            await this.saveBoard(initialData);
        }
    }
    static async loadBoard() {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return null;
        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(fileData).toString("utf8"));
        }
        catch (error) {
            return null;
        }
    }
    static async saveBoard(board) {
        const fileUri = this.getFileUri();
        const folderUri = this.getFolderUri();
        if (!fileUri || !folderUri)
            return;
        await vscode.workspace.fs.createDirectory(folderUri);
        const data = Buffer.from(JSON.stringify(board, null, 2), "utf8");
        await vscode.workspace.fs.writeFile(fileUri, data);
    }
    static async updateTaskStatus(taskId, newStatus) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId])
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        board.tasks[taskId].status = newStatus;
        board.tasks[taskId].updatedAt = Date.now();
        if (user)
            board.tasks[taskId].lastModifiedBy = user;
        await this.saveBoard(board);
    }
    static async reorderTasks(updates) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        updates.forEach((upd) => {
            if (board.tasks[upd.id]) {
                board.tasks[upd.id].status = upd.status;
                board.tasks[upd.id].position = upd.position;
                if (upd.isDraggedTask) {
                    board.tasks[upd.id].updatedAt = Date.now();
                    if (user)
                        board.tasks[upd.id].lastModifiedBy = user;
                }
            }
        });
        await this.saveBoard(board);
    }
    static async createTask(title, description, targetColId, labelIds = [], codeReference) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        const taskId = "task-" + Date.now();
        let status = targetColId;
        if (!status) {
            const sortedCols = Object.values(board.columns).sort((a, b) => a.position - b.position);
            status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
        }
        board.tasks[taskId] = {
            id: taskId,
            title,
            description,
            status,
            createdBy: user || { githubId: "unknown", username: "Unknown" },
            lastModifiedBy: user || { githubId: "unknown", username: "Unknown" },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            codeReference: codeReference,
            position: Date.now(),
            labelIds: labelIds || [],
        };
        await this.saveBoard(board);
    }
    static async editTask(taskId, title, description, labelIds = []) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId])
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        board.tasks[taskId].title = title;
        board.tasks[taskId].description = description;
        board.tasks[taskId].labelIds = labelIds;
        board.tasks[taskId].updatedAt = Date.now();
        if (user)
            board.tasks[taskId].lastModifiedBy = user;
        await this.saveBoard(board);
    }
    static async deleteTask(taskId) {
        const board = await this.loadBoard();
        if (!board)
            return;
        delete board.tasks[taskId];
        await this.saveBoard(board);
    }
    static async createColumn(title, color) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const colId = "col-" + Date.now();
        const position = Object.keys(board.columns).length;
        board.columns[colId] = { id: colId, title, color, position };
        await this.saveBoard(board);
    }
    static async editColumn(id, title, color) {
        const board = await this.loadBoard();
        if (!board || !board.columns[id])
            return;
        board.columns[id].title = title;
        board.columns[id].color = color;
        await this.saveBoard(board);
    }
    static async deleteColumn(id) {
        const board = await this.loadBoard();
        if (!board || !board.columns[id])
            return;
        delete board.columns[id];
        for (const taskId in board.tasks) {
            if (board.tasks[taskId].status === id) {
                delete board.tasks[taskId];
            }
        }
        await this.saveBoard(board);
    }
    static async reorderColumns(updates) {
        const board = await this.loadBoard();
        if (!board)
            return;
        updates.forEach((upd) => {
            if (board.columns[upd.id]) {
                board.columns[upd.id].position = upd.position;
            }
        });
        await this.saveBoard(board);
    }
    static async createLabel(name, color) {
        const board = await this.loadBoard();
        if (!board)
            return;
        if (!board.labels)
            board.labels = {};
        const labelId = "label-" + Date.now();
        board.labels[labelId] = { id: labelId, name, color };
        await this.saveBoard(board);
    }
    static async deleteLabel(id) {
        const board = await this.loadBoard();
        if (!board || !board.labels)
            return;
        delete board.labels[id];
        for (const taskId in board.tasks) {
            if (board.tasks[taskId].labelIds) {
                board.tasks[taskId].labelIds = board.tasks[taskId].labelIds.filter((l) => l !== id);
            }
        }
        await this.saveBoard(board);
    }
}
exports.DataManager = DataManager;


/***/ },

/***/ "./src/providers/GitService.ts"
/*!*************************************!*\
  !*** ./src/providers/GitService.ts ***!
  \*************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GitService = void 0;
// src/providers/GitService.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const cp = __importStar(__webpack_require__(/*! child_process */ "child_process"));
const DataManager_1 = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
class GitService {
    static getWorkspacePath() {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
    }
    static execPromise(command, cwd) {
        return new Promise((resolve, reject) => {
            cp.exec(command, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`Lynvo Git Warn: ${stderr}`);
                    reject(error);
                }
                else {
                    resolve(stdout.trim());
                }
            });
        });
    }
    static async syncBoard() {
        const cwd = this.getWorkspacePath();
        if (!cwd)
            return { success: false, message: "No se encontró el workspace." };
        try {
            // 1. Descargamos la info de la nube de forma invisible
            await this.execPromise("git fetch origin", cwd);
            const branch = await this.execPromise("git rev-parse --abbrev-ref HEAD", cwd);
            // 2. Extraemos el tablero remoto directamente de la memoria de Git
            let remoteBoardStr = "";
            try {
                remoteBoardStr = await this.execPromise(`git show origin/${branch}:.vscode/lynvo.json`, cwd);
            }
            catch (e) {
                // Es normal si el archivo aún no existe en el repositorio remoto
            }
            const localBoard = await DataManager_1.DataManager.loadBoard();
            if (!localBoard)
                return {
                    success: false,
                    message: "No hay tablero local que sincronizar.",
                };
            // 3. FUSIÓN MATEMÁTICA INTELIGENTE (Anti-Pérdida de Datos)
            if (remoteBoardStr) {
                const remoteBoard = JSON.parse(remoteBoardStr);
                const mergedTasks = { ...remoteBoard.tasks };
                for (const taskId in localBoard.tasks) {
                    const localTask = localBoard.tasks[taskId];
                    const remoteTask = mergedTasks[taskId];
                    // Regla de oro: Gana la tarea que se haya modificado más recientemente
                    if (!remoteTask || localTask.updatedAt >= remoteTask.updatedAt) {
                        mergedTasks[taskId] = localTask;
                    }
                }
                // Mezclamos la estructura (columnas y etiquetas)
                localBoard.tasks = mergedTasks;
                localBoard.columns = { ...remoteBoard.columns, ...localBoard.columns };
                if (remoteBoard.labels) {
                    localBoard.labels = {
                        ...remoteBoard.labels,
                        ...(localBoard.labels || {}),
                    };
                }
                await DataManager_1.DataManager.saveBoard(localBoard);
            }
            // 4. Aseguramos la fusión perfecta creando un commit local
            await this.execPromise("git add .vscode/lynvo.json", cwd);
            const status = await this.execPromise("git status --porcelain .vscode/lynvo.json", cwd);
            if (status) {
                await this.execPromise('git commit -m "(Lynvo): auto-merge team board [skip ci]"', cwd);
            }
            // 5. Unimos los historiales. Si Git detecta conflicto de texto, le obligamos a usar nuestra fusión (-X ours)
            try {
                await this.execPromise(`git merge origin/${branch} -X ours -m "(Lynvo): integrate remote changes"`, cwd);
            }
            catch (mergeErr) {
                await this.execPromise("git merge --abort", cwd).catch(() => { });
                return {
                    success: false,
                    message: "Hay conflictos en el código de tu proyecto que bloquean la sincronización de Lynvo. Haz commit o pull de tus archivos primero.",
                };
            }
            // 6. Subimos todo a GitHub
            await this.execPromise(`git push origin ${branch}`, cwd);
            return {
                success: true,
                message: "¡Sincronización Total! Datos fusionados inteligentemente y subidos a GitHub.",
            };
        }
        catch (error) {
            console.error("Lynvo Git Error:", error);
            return {
                success: false,
                message: "Error al hacer push. Revisa tu consola de Git.",
            };
        }
    }
}
exports.GitService = GitService;


/***/ },

/***/ "./src/providers/LynvoMenuProvider.ts"
/*!********************************************!*\
  !*** ./src/providers/LynvoMenuProvider.ts ***!
  \********************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LynvoMenuProvider = void 0;
// src/providers/LynvoMenuProvider.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
class LynvoMenuProvider {
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        else {
            return Promise.resolve([
                this.createMenuItem("Open Board", "lynvo.openBoard", "Abre el tablero principal", "project"),
                this.createMenuItem("Add Task from Code", "lynvo.createTaskFromCode", "Crea una tarea desde tu selección actual", "add"),
                this.createMenuItem("Connect GitHub", "lynvo.connectGitHub", "Inicia sesión o vincula tu cuenta de GitHub", "vm-connect"),
                this.createMenuItem("Check GitHub Status", "lynvo.checkGitHubStatus", "Comprueba si hay sesión de GitHub activa", "account"),
                this.createMenuItem("Sync Board", "lynvo.syncBoard", "Sincroniza el tablero con el repositorio remoto", "cloud-upload"),
            ]);
        }
    }
    createMenuItem(label, command, tooltip, iconId) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command: command, title: label };
        item.tooltip = tooltip;
        item.description = tooltip;
        if (iconId) {
            item.iconPath = new vscode.ThemeIcon(iconId);
        }
        return item;
    }
}
exports.LynvoMenuProvider = LynvoMenuProvider;


/***/ },

/***/ "./src/providers/LynvoPanel.ts"
/*!*************************************!*\
  !*** ./src/providers/LynvoPanel.ts ***!
  \*************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LynvoPanel = void 0;
// src/providers/LynvoPanel.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const DataManager_1 = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
const GitService_1 = __webpack_require__(/*! ./GitService */ "./src/providers/GitService.ts");
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
    static render(extensionUri) {
        if (LynvoPanel.currentPanel) {
            LynvoPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
        }
        else {
            const panel = vscode.window.createWebviewPanel("lynvoBoard", "Lynvo - Project Board", vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
            });
            LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
        }
    }
    static async refreshData() {
        if (LynvoPanel.currentPanel) {
            const board = await DataManager_1.DataManager.loadBoard();
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "loadData",
                data: board,
            });
        }
    }
    dispose() {
        LynvoPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
    _setWebviewMessageListener(webview) {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "requestData":
                    const board = await DataManager_1.DataManager.loadBoard();
                    webview.postMessage({ command: "loadData", data: board });
                    return;
                case "updateTaskStatus":
                    await DataManager_1.DataManager.updateTaskStatus(message.taskId, message.newStatus);
                    LynvoPanel.refreshData();
                    return;
                case "reorderTasks":
                    await DataManager_1.DataManager.reorderTasks(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createTask":
                    await DataManager_1.DataManager.createTask(message.title, message.description, message.targetColId, message.labelIds);
                    LynvoPanel.refreshData();
                    return;
                case "editTask":
                    await DataManager_1.DataManager.editTask(message.taskId, message.title, message.description, message.labelIds);
                    LynvoPanel.refreshData();
                    return;
                case "deleteTask":
                    const confirmTask = await vscode.window.showWarningMessage("Delete task?", { modal: true }, "Delete");
                    if (confirmTask === "Delete") {
                        await DataManager_1.DataManager.deleteTask(message.taskId);
                        LynvoPanel.refreshData();
                    }
                    return;
                case "createColumn":
                    await DataManager_1.DataManager.createColumn(message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "editColumn":
                    await DataManager_1.DataManager.editColumn(message.colId, message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteColumn":
                    const confirmCol = await vscode.window.showWarningMessage("Delete column? ALL TASKS inside will be deleted.", { modal: true }, "Delete");
                    if (confirmCol === "Delete") {
                        await DataManager_1.DataManager.deleteColumn(message.colId);
                        LynvoPanel.refreshData();
                    }
                    return;
                case "reorderColumns":
                    await DataManager_1.DataManager.reorderColumns(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createLabel":
                    await DataManager_1.DataManager.createLabel(message.name, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteLabel":
                    await DataManager_1.DataManager.deleteLabel(message.labelId);
                    LynvoPanel.refreshData();
                    return;
                case "syncBoard":
                    const result = await GitService_1.GitService.syncBoard();
                    if (result.success) {
                        vscode.window.showInformationMessage(result.message);
                    }
                    else {
                        vscode.window.showWarningMessage(result.message);
                    }
                    LynvoPanel.refreshData();
                    return;
                case "openCode":
                    const folders = vscode.workspace.workspaceFolders;
                    if (folders) {
                        const fileUri = vscode.Uri.joinPath(folders[0].uri, message.filePath);
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        const pos = new vscode.Position(message.lineStart - 1, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    }
                    return;
            }
        }, undefined, this._disposables);
    }
    _getWebviewContent(webview, extensionUri) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
        const nonce = getNonce();
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground); }
            * { box-sizing: border-box; }
            button { font-family: inherit; }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; transition: all .15s ease; border-radius: 6px; }
            .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}
exports.LynvoPanel = LynvoPanel;
function getNonce() {
    let t = "";
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++)
        t += p.charAt(Math.floor(Math.random() * p.length));
    return t;
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
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/extension.ts");
/******/ 	var __webpack_export_target__ = exports;
/******/ 	for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
/******/ 	if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map