#!/usr/bin/env node
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VITE_URL = 'http://localhost:5173';
const POLL_MS = 1000;
const TIMEOUT_MS = 60_000;

function findElectron() {
    const electronDir = path.join(ROOT, 'node_modules', 'electron');

    // 1. Read path.txt — electron package always ships this
    try {
        const rel = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim();
        const resolved = path.join(electronDir, rel);
        if (fs.existsSync(resolved)) {
            console.log(`[electron-dev] Found via path.txt: ${resolved}`);
            return resolved;
        }
        // path.txt exists but file doesn't — log what it said so we can debug
        console.warn(`[electron-dev] path.txt says "${rel}" but file not found at ${resolved}`);
    } catch (_) { }

    // 2. Walk node_modules/electron/ and find any .exe
    try {
        const files = fs.readdirSync(electronDir);
        for (const f of files) {
            if (f.endsWith('.exe')) {
                const full = path.join(electronDir, f);
                console.log(`[electron-dev] Found by scan: ${full}`);
                return full;
            }
        }
        // Check one level deeper (dist/ subfolder pattern)
        for (const f of files) {
            const sub = path.join(electronDir, f);
            if (fs.statSync(sub).isDirectory()) {
                const inner = fs.readdirSync(sub);
                for (const ff of inner) {
                    if (ff.endsWith('.exe')) {
                        const full = path.join(sub, ff);
                        console.log(`[electron-dev] Found in subfolder: ${full}`);
                        return full;
                    }
                }
            }
        }
    } catch (_) { }

    console.error('[electron-dev] Could not locate electron.exe — run npm install');
    process.exit(1);
}

function waitForVite(elapsed = 0) {
    if (elapsed >= TIMEOUT_MS) {
        console.error('[electron-dev] Timed out waiting for Vite.');
        process.exit(1);
    }
    http.get(VITE_URL, (res) => {
        if (res.statusCode < 500) launchElectron();
        else setTimeout(() => waitForVite(elapsed + POLL_MS), POLL_MS);
    }).on('error', () => setTimeout(() => waitForVite(elapsed + POLL_MS), POLL_MS));
}

function launchElectron() {
    const electronExe = findElectron();
    console.log('[electron-dev] Vite ready — launching Electron...');

    const e = spawn(electronExe, [ROOT], {
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, ELECTRON_START_URL: VITE_URL },
    });

    e.on('error', err => { console.error('[electron-dev]', err.message); process.exit(1); });
    e.on('close', code => process.exit(code ?? 0));
}

console.log(`[electron-dev] Waiting for ${VITE_URL}...`);
waitForVite();