import { exec, spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';

// 🚀 THE 2026 STACK
const MODELS = ['deepseek-r1:14b', 'qwen3.5:9b'];
const IS_WINDOWS = os.platform() === 'win32';

const POWERSHELL_PATHS = [
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
];

const LOCAL_OLLAMA_PATH = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');

let ollamaCommand = 'ollama';

// Retry config — "upgrade in progress" means the service just installed and needs time
const PULL_MAX_RETRIES = 8;
const PULL_RETRY_DELAY_MS = 8000;
const TRANSIENT_ERRORS = [
    'upgrade in progress',
    'context deadline exceeded',
    'connection refused',
    'could not connect',
    'service unavailable',
    'try again',
];

console.log("\x1b[36m%s\x1b[0m", "/// SHADOW_DECK NEURAL INSTALLER ///");

checkOllama();

function getPowerShell() {
    for (const p of POWERSHELL_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return 'powershell';
}

function checkOllama() {
    try {
        exec('ollama --version', (error) => {
            if (!error) {
                console.log("\x1b[32m[OK] Ollama detected (Global).\x1b[0m");
                ollamaCommand = 'ollama';
                pullModels(0);
                return;
            }

            if (IS_WINDOWS && fs.existsSync(LOCAL_OLLAMA_PATH)) {
                console.log("\x1b[32m[OK] Ollama detected (Local Path).\x1b[0m");
                ollamaCommand = LOCAL_OLLAMA_PATH;
                pullModels(0);
                return;
            }

            console.log("\x1b[33m[MISSING] Ollama not found. Starting Auto-Install...\x1b[0m");
            installOllama();
        });
    } catch (err) {
        console.error("\x1b[31m[ERROR] Failed to check for Ollama:\x1b[0m", err.message);
        installOllama();
    }
}

function installOllama() {
    if (!IS_WINDOWS) {
        console.error("\x1b[31m[ERROR] Mac/Linux: run `curl -fsSL https://ollama.com/install.sh | sh`\x1b[0m");
        process.exit(1);
    }

    const psExe = getPowerShell();
    console.log(`[INFO] using ${psExe}...`);

    const installer = spawn(psExe,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://ollama.com/install.ps1 | iex'],
        { stdio: 'inherit' }
    );

    installer.on('error', (err) => {
        console.error(`\x1b[31m[FAIL] Installer error: ${err.message}\x1b[0m`);
        process.exit(1);
    });

    installer.on('close', (code) => {
        if (code === 0) {
            console.log("\x1b[32m[SUCCESS] Install Complete.\x1b[0m");
            console.log("Verifying executable directly...");

            if (fs.existsSync(LOCAL_OLLAMA_PATH)) {
                console.log("\x1b[32m[OK] Found executable. Starting Download...\x1b[0m");
                ollamaCommand = LOCAL_OLLAMA_PATH;
                pullModels(0);
            } else {
                console.error("\x1b[31m[ERROR] Install appeared to work, but file is missing.\x1b[0m");
                console.log(`Checked: ${LOCAL_OLLAMA_PATH}`);
                console.log("Please install manually: https://ollama.com");
                process.exit(1);
            }
        } else {
            console.error("\x1b[31m[FAIL] Installer failed.\x1b[0m");
            process.exit(1);
        }
    });
}

function pullModels(index) {
    if (index >= MODELS.length) {
        console.log("\x1b[32m\n[SYSTEM READY] ShadowDeck is Online.\x1b[0m");
        console.log("Run 'npm run dev' to start.");
        return;
    }
    pullWithRetry(MODELS[index], index, 0);
}

function pullWithRetry(model, modelIndex, attempt) {
    if (attempt === 0) {
        console.log(`\n[Downloading] Neural Core: ${model}...`);
    } else {
        console.log(`\x1b[33m[RETRY ${attempt}/${PULL_MAX_RETRIES}] Ollama not ready yet. Waiting ${PULL_RETRY_DELAY_MS / 1000}s...\x1b[0m`);
    }

    // pipe stderr so we can inspect it for transient errors AND still show it in the terminal
    const p = spawn(ollamaCommand, ['pull', model], {
        stdio: ['inherit', 'inherit', 'pipe'],
    });

    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });

    p.on('error', (err) => {
        console.error(`\x1b[31m[ERROR] Could not start download: ${err.message}\x1b[0m`);
        process.exit(1);
    });

    p.on('close', (code) => {
        if (code === 0) {
            pullModels(modelIndex + 1);
            return;
        }
        const isTransient = TRANSIENT_ERRORS.some(phrase => stderr.toLowerCase().includes(phrase));
        if (isTransient && attempt < PULL_MAX_RETRIES) {
            setTimeout(() => pullWithRetry(model, modelIndex, attempt + 1), PULL_RETRY_DELAY_MS);
        } else {
            console.error(`\x1b[31m[ERROR] Failed to download ${model} after ${attempt + 1} attempt(s).\x1b[0m`);
            console.log("Make sure Ollama is running: open a new terminal and run 'ollama serve'");
            process.exit(1);
        }
    });
}