import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';
import fs from 'fs';
import { startBridge } from './bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// mainWindow acts as the primary app window
let mainWindow = null;

const LOCAL_OLLAMA_PATH = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');

// ── First-run: check if Ollama is reachable ─────────────────
// Uses the same 3-tier fallback as bridge.js:
//   1. `ollama list` via PATH
//   2. Check the local AppData install path
//   3. Probe the Ollama HTTP API
function checkFirstRun() {
    exec('ollama list', (error) => {
        if (!error) return; // Found in PATH — all good

        // Fallback: check local install path
        if (fs.existsSync(LOCAL_OLLAMA_PATH)) return; // Installed locally — all good

        // Fallback: probe the HTTP API
        fetch('http://localhost:11434/api/tags')
            .then(() => { /* API responding — all good */ })
            .catch(() => {
                // All three checks failed — show setup dialog
                if (mainWindow && !mainWindow.isDestroyed()) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        title: 'ShadowDeck — Setup Required',
                        message: 'Ollama is not installed or not reachable.',
                        detail: 'ShadowDeck requires Ollama for local AI inference.\n\nRun "npm run setup" from the project root, or install Ollama manually from https://ollama.com.',
                        buttons: ['OK'],
                    });
                }
            });
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        frame: false, // THE BEAST LOOK (No title bar)
        backgroundColor: '#050505', // Void Black
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Giving React full power (Security trade-off for personal tool)
            webSecurity: false // Allow loading local files/images easily
        }
    });

    // Load the React App
    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
    mainWindow.loadURL(startUrl);

    // Forward renderer console logs to the main process terminal
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[RENDERER] ${message}`);
    });

    // Start the Bridge Server
    startBridge(mainWindow, app.getPath('userData'));

    // Custom Window Controls (Since we removed the frame)
    ipcMain.on('window-min', () => mainWindow.minimize());
    ipcMain.on('window-max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
    ipcMain.on('window-close', () => mainWindow.close());

    // ── Open-directory dialog for manual project connection ──
    ipcMain.handle('dialog-open-project', async () => {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return null;
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Connect Project Workspace',
                properties: ['openDirectory'],
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            return result.filePaths[0];
        } catch (error) {
            console.error('[MAIN] error in dialog-open-project:', error);
            return null;
        }
    });

    // ── Directory picker for CommandCenter ──
    ipcMain.handle('dialog:openDirectory', async () => {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] };
            return await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: 'Select Project Root',
            });
        } catch (error) {
            console.error('[MAIN] error in dialog:openDirectory:', error);
            return { canceled: true, filePaths: [] };
        }
    });

    // Run first-run check after window is ready
    mainWindow.webContents.on('did-finish-load', () => {
        checkFirstRun();
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});