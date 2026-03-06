// electron/bridge.js
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck Express Bridge  —  v3: Agentic Terminal Execution
//
//  NEW in this version:
//    POST /system/exec   — streams stdout/stderr from child_process.exec
//                          with safety gates (allowlist, cwd validation)
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import { exec, execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { initStore, getConfig, setConfig, getHistory, saveSession, clearHistory } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_OLLAMA_PATH = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');

// ── Active project state ─────────────────────────────────────────────────────
let activeProjectPath = null;

// ── Exec safety: deny-list of dangerous command prefixes ─────────────────────
// These are blocked regardless of what the AI proposes.
const EXEC_DENY_PATTERNS = [
    /^\s*rm\s+-rf?\s+\//i,          // rm -rf /
    /^\s*rmdir\s+\/[^/]/i,          // rmdir /root etc.
    /\bdd\s+if=/i,                   // disk wiper
    /\bchmod\s+-R\s+777\s+\//i,     // chmod 777 root
    /\bmkfs\b/i,                     // format disk
    /\bformat\s+[A-Z]:/i,           // Windows format
    />\s*\/dev\/sd[a-z]\b/i,        // write to raw device
    /\bsudo\s+rm\s+-rf/i,           // sudo rm -rf
    /\bshutdown\b/i,                 // system shutdown
    /\breboot\b/i,                   // system reboot
    /\bpoweroff\b/i,
    /\bcurl\b.*\|\s*(?:bash|sh)/i,  // curl | bash (script injection)
    /\bwget\b.*\|\s*(?:bash|sh)/i,
];

/** @returns {string | null} denial reason or null if safe */
function checkExecSafety(command) {
    for (const pattern of EXEC_DENY_PATTERNS) {
        if (pattern.test(command)) {
            return `Command matches blocked pattern: ${pattern.source}`;
        }
    }
    // Block commands that try to escape the project directory
    if (/\.\.\/\.\.\//.test(command)) return 'Path traversal detected in command';
    return null;
}

export function startBridge(mainWindow, userDataPath) {
    if (userDataPath) initStore(userDataPath);

    const app = express();
    const PORT = 9090;

    app.use(cors());
    app.use(express.json({ limit: '5mb' }));

    // ── IDE Analyze Endpoint ─────────────────────────────────────────────────
    app.post('/analyze', (req, res) => {
        const { code, file, projectPath } = req.body;

        if (projectPath && typeof projectPath === 'string' && projectPath.trim()) {
            activeProjectPath = projectPath.trim();
            console.log(`[BRIDGE] Active project set to: ${activeProjectPath}`);
        }

        console.log(`[BRIDGE] Analysis request — file: ${file} | project: ${activeProjectPath ?? 'unknown'}`);

        if (mainWindow) {
            mainWindow.webContents.send('ide-trigger', {
                type: 'ANALYZE',
                payload: { code, file, projectPath: activeProjectPath },
            });
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }

        res.json({ status: 'processing', message: 'ShadowDeck activated' });
    });

    // ── Project Connect Endpoint ─────────────────────────────────────────────
    app.post('/project/connect', (req, res) => {
        const { path: projectPath } = req.body;
        if (projectPath && typeof projectPath === 'string' && projectPath.trim()) {
            activeProjectPath = projectPath.trim();
            console.log(`[BRIDGE] Manual project connect: ${activeProjectPath}`);
            res.json({ status: 'connected', path: activeProjectPath });
        } else {
            res.status(400).json({ error: 'Invalid path' });
        }
    });

    // ── Git Diff Endpoint ─────────────────────────────────────────────────────
    // Strategy (covers ALL change states):
    //   1. git diff            — unstaged changes to tracked files
    //   2. git diff --cached   — staged-but-not-committed changes
    //   3. git ls-files --others — completely new untracked files (read directly)
    //   4. git status --porcelain — diagnostic metadata returned to the caller
    //
    // Memory safety:
    //   Hard cap is 200MB total diff output. Rather than killing the process mid-
    //   stream (which could leave the git process zombie), we stop collecting
    //   chunks once the cap is hit and let git finish naturally. The collected
    //   portion is marked truncated=true so the caller knows to warn the user.
    //
    //   For individual untracked files we skip files over 200KB to avoid reading
    //   minified bundles, lock files, or generated assets.
    //
    //   Binary files are excluded via --diff-filter=d (skip deleted binary files
    //   is handled by git automatically; added binary shows as "Binary files differ").
    //
    // Response: { diff, truncated, diagnostics }
    const MAX_DIFF_BYTES = 200 * 1024 * 1024;   // 200MB — generous for monorepos
    const MAX_UNTRACKED_FILE_BYTES = 200 * 1024; // 200KB per untracked file
    const MAX_UNTRACKED_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB for all untracked
    // 👇 Update this set to include repomix-output.xml
    const NOISE_FILES_SET = new Set([
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lockb',
        'repomix-output.xml'
    ]);

    app.post('/git/diff', async (req, res) => {
        try {
            const cwd = req.body?.projectPath || activeProjectPath || path.resolve(__dirname, '..');
            console.log(`[BRIDGE/git/diff] cwd=${cwd} | activeProjectPath=${activeProjectPath ?? 'NOT SET'}`);

            // ── Helper: run git command and collect stdout ──────────────────────────
            const runGit = (args) => new Promise((resolve) => {
                let out = '', err = '';
                const child = spawn('git', args, { cwd });
                child.stdout.on('data', d => out += d);
                child.stderr.on('data', d => err += d);
                child.on('error', () => resolve({ output: '', error: err, code: -1 }));
                child.on('close', code => resolve({ output: out, error: err, code }));
            });

            // ── Helper: stream git command with a soft memory cap ──────────────────
            // Stops collecting after MAX_DIFF_BYTES but does NOT kill the process.
            const streamGit = (args) => new Promise((resolve) => {
                const child = spawn('git', args, { cwd });
                const chunks = [];
                let totalBytes = 0;
                let softCapped = false;
                let err = '';

                child.stdout.on('data', (data) => {
                    if (softCapped) return; // stop collecting but let process finish
                    totalBytes += data.length;
                    if (totalBytes > MAX_DIFF_BYTES) {
                        softCapped = true;
                        console.warn(`[BRIDGE/git/diff] Soft cap (${MAX_DIFF_BYTES / 1024 / 1024}MB) reached — truncating collection`);
                        return;
                    }
                    chunks.push(data);
                });
                child.stderr.on('data', d => err += d);
                child.on('error', () => resolve({ output: '', error: err, truncated: false }));
                child.on('close', () => {
                    const output = Buffer.concat(chunks).toString('utf-8');
                    resolve({ output, error: err, truncated: softCapped });
                });
            });

            // ── 1. Check if repo has any commits ───────────────────────────────────
            const headCheck = await runGit(['rev-parse', '--verify', 'HEAD']);
            const hasCommits = headCheck.code === 0;

            // ── 2. Collect status for diagnostics ──────────────────────────────────
            const statusResult = await runGit(['status', '--porcelain=v1']);
            const statusLines = statusResult.output.split('\n').filter(Boolean);
            const stagedFiles = statusLines.filter(l => l[0] !== ' ' && l[0] !== '?').map(l => l.slice(3));
            const unstagedFiles = statusLines.filter(l => l[1] === 'M' || l[1] === 'D').map(l => l.slice(3));
            const untrackedFiles = statusLines.filter(l => l.startsWith('??')).map(l => l.slice(3));

            const diagnostics = { cwd, hasCommits, stagedFiles, unstagedFiles, untrackedCount: untrackedFiles.length };
            console.log(`[BRIDGE/git/diff] status: ${stagedFiles.length} staged, ${unstagedFiles.length} unstaged, ${untrackedFiles.length} untracked, hasCommits=${hasCommits}`);

            let diffParts = [];
            let totalBytes = 0;
            let truncated = false;

            const appendPart = (text, partTruncated = false) => {
                if (!text || !text.trim()) return;
                totalBytes += Buffer.byteLength(text);
                diffParts.push(text.trim());
                if (partTruncated) truncated = true;
            };

            const EXCLUDE_SPECS = [
                ':!**/node_modules/**',
                ':!**/package-lock.json',
                ':!**/yarn.lock',
                ':!**/pnpm-lock.yaml',
                ':!**/bun.lockb',
                ':!**/*.min.js',
                ':!**/*.map',
                ':!**/dist/**',
                ':!**/build/**',
                ':!**/release/**',
                ':!**/repomix-output.xml'
            ];

            // ── 3. Unstaged changes to tracked files ───────────────────────────────
            const unstagedResult = await streamGit(['diff', '--', '.', ...EXCLUDE_SPECS]);
            appendPart(unstagedResult.output, unstagedResult.truncated);

            // ── 4. Staged (cached) changes ─────────────────────────────────────────
            if (!truncated) {
                const stagedResult = await streamGit(['diff', '--cached', '--', '.', ...EXCLUDE_SPECS]);
                appendPart(stagedResult.output, stagedResult.truncated);
            }

            // ── 5. If HEAD exists and parts are still empty, try diff HEAD ─────────
            if (hasCommits && diffParts.length === 0 && !truncated) {
                const headDiff = await streamGit(['diff', 'HEAD', '--', '.', ...EXCLUDE_SPECS]);
                appendPart(headDiff.output, headDiff.truncated);
            }

            // ── 6. New untracked files — read content and format as fake diff ──────
            let untrackedBytes = 0;

            for (const file of untrackedFiles) {
                if (truncated || untrackedBytes > MAX_UNTRACKED_TOTAL_BYTES) break;
                if (NOISE_FILES_SET.has(path.basename(file))) continue;
                try {
                    const absPath = path.join(cwd, file.trim());
                    const stat = fs.statSync(absPath);
                    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) continue;
                    untrackedBytes += stat.size;
                    const content = fs.readFileSync(absPath, 'utf-8');
                    const lines = content.split('\n');
                    const fakeDiff = `diff --git a/${file.trim()} b/${file.trim()}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.trim()}\n@@ -0,0 +1,${lines.length} @@\n` +
                        lines.map(l => `+${l}`).join('\n');
                    appendPart(fakeDiff);
                } catch { /* skip unreadable */ }
            }

            const rawDiff = diffParts.join('\n\n');

            // ── 7. BULLETPROOF NODE.JS FILTER ──────────────────────────────────────
            // Immune to Windows Git pathspec bugs. Forcibly strips noise from the output.
            const filterDiff = (diffText) => {
                // Split diff into per-file chunks while keeping the 'diff --git' header intact
                const chunks = diffText.split(/(?=^diff --git a\/)/m);

                const BAD_FILES = new Set([
                    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
                    'repomix-output.xml', 'diff_output.json' // <-- Strips your debug dumps!
                ]);

                const ignoredList = [];

                const filteredChunks = chunks.filter(chunk => {
                    const match = chunk.match(/^diff --git a\/.+ b\/(.+)$/m);
                    if (!match) return true; // Keep metadata/preamble

                    const filepath = match[1].trim();
                    const filename = filepath.split(/[/\\]/).pop();

                    // Nuke lockfiles and debug dumps
                    if (BAD_FILES.has(filename)) { ignoredList.push(filepath); return false; }

                    // Nuke minified bundles and compiled directories
                    if (filepath.includes('node_modules/') || filepath.includes('dist/')) { ignoredList.push(filepath); return false; }
                    if (filename.endsWith('.map') || filename.endsWith('.min.js') || filename.endsWith('.svg')) { ignoredList.push(filepath); return false; }

                    return true; // Keep everything else
                });

                if (ignoredList.length > 0) {
                    console.log(`[BRIDGE/git/diff] ⛔ Filtered out ${ignoredList.length} noise files:`);
                    ignoredList.forEach(f => console.log(`    - ${f}`));
                }

                return filteredChunks.join('').trim();
            };

            const diff = filterDiff(rawDiff);

            console.log(`[BRIDGE/git/diff] result: ${diff.length.toLocaleString()} chars (filtered down from ${rawDiff.length.toLocaleString()}), truncated=${truncated}`);
            res.json({ diff, truncated, diagnostics });
        } catch (error) {
            console.error('[BRIDGE/git/diff] Error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // ── Project file ─────────────────────────────────────────────────────────
    const MAX_FILE_BYTES = 500 * 1024;
    app.get('/project/file', (req, res) => {
        if (!activeProjectPath) return res.status(400).json({ error: 'No project connected' });
        const rel = req.query.rel;
        const abs = req.query.abs;

        let absPath;
        if (abs) {
            absPath = path.resolve(abs);
        } else if (rel) {
            absPath = path.resolve(activeProjectPath, String(rel));
            if (!absPath.startsWith(path.resolve(activeProjectPath))) {
                return res.status(403).json({ error: 'Path traversal rejected' });
            }
        } else {
            return res.status(400).json({ error: 'Missing ?rel= or ?abs= parameter' });
        }

        try {
            const stat = fs.statSync(absPath);
            if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
            if (stat.size > MAX_FILE_BYTES) {
                return res.json({ content: fs.readFileSync(absPath, 'utf-8').slice(0, MAX_FILE_BYTES), truncated: true });
            }
            res.json({ content: fs.readFileSync(absPath, 'utf-8'), truncated: false });
        } catch (err) {
            res.status(404).json({ error: `File not found: ${err.message}` });
        }
    });

    // ── Project file tree ─────────────────────────────────────────────────────
    app.get('/project/tree', (_req, res) => {
        if (!activeProjectPath) return res.status(400).json({ error: 'No project connected' });

        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv']);
        const MAX_ENTRIES = 500;
        const entries = [];

        function walk(dir, depth) {
            if (depth > 3 || entries.length >= MAX_ENTRIES) return;
            let items;
            try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const item of items) {
                if (SKIP.has(item.name) || item.name.startsWith('.')) continue;
                const rel = path.relative(activeProjectPath, path.join(dir, item.name)).replace(/\\/g, '/');
                const absPath = path.join(dir, item.name);
                let size = 0;
                try {
                    if (!item.isDirectory()) size = fs.statSync(absPath).size;
                } catch { /* ignore */ }
                entries.push({ name: rel, relative: rel, type: item.isDirectory() ? 'dir' : 'file', size });
                if (entries.length >= MAX_ENTRIES) return;
                if (item.isDirectory()) walk(absPath, depth + 1);
            }
        }

        walk(activeProjectPath, 0);
        res.json({ root: activeProjectPath, entries, truncated: entries.length >= MAX_ENTRIES });
    });

    // ════════════════════════════════════════════════════════════════════════
    //  NEW ▶  POST /system/exec — Agentic Terminal Execution
    // ════════════════════════════════════════════════════════════════════════
    //
    //  Body: { command: string, cwd?: string }
    //
    //  Streams NDJSON lines:
    //    { type: 'stdout',  data: string }
    //    { type: 'stderr',  data: string }
    //    { type: 'exit',    code: number }
    //    { type: 'error',   message: string }
    //    { type: 'denied',  reason: string }
    //
    //  Safety gates:
    //    1. Deny-pattern list blocks destructive commands.
    //    2. cwd is validated to prevent path traversal.
    //    3. Execution timeout: 120 seconds hard cap.
    //    4. Output cap: 512 KB to prevent memory exhaustion.
    // ════════════════════════════════════════════════════════════════════════

    app.post('/system/exec', (req, res) => {
        const { command, cwd: reqCwd } = req.body || {};

        if (!command || typeof command !== 'string' || !command.trim()) {
            return res.status(400).json({ error: 'Missing or invalid "command" field' });
        }

        // ── Safety gate 1: deny-list ─────────────────────────────────────────
        const denyReason = checkExecSafety(command);
        if (denyReason) {
            console.warn(`[BRIDGE/exec] ⛔ Blocked: ${denyReason}  cmd="${command}"`);
            res.setHeader('Content-Type', 'application/x-ndjson');
            res.write(JSON.stringify({ type: 'denied', reason: denyReason }) + '\n');
            res.end();
            return;
        }

        // ── Safety gate 2: validated cwd ─────────────────────────────────────
        let execCwd = activeProjectPath || process.cwd();
        if (reqCwd) {
            const resolved = path.resolve(reqCwd);
            // Only allow cwd inside the active project or a temp dir
            if (activeProjectPath && !resolved.startsWith(path.resolve(activeProjectPath))) {
                console.warn(`[BRIDGE/exec] cwd outside project — falling back to project root`);
            } else {
                execCwd = resolved;
            }
        }

        console.log(`[BRIDGE/exec] ▶ ${command}  (cwd: ${execCwd})`);

        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering

        let outputBytes = 0;
        const MAX_OUTPUT_BYTES = 512 * 1024;
        let capped = false;

        const child = exec(command, {
            cwd: execCwd,
            timeout: 120_000,   // 2-minute hard cap
            maxBuffer: MAX_OUTPUT_BYTES,
            windowsHide: true,
        });

        const writeChunk = (type, data) => {
            if (capped || res.writableEnded) return;
            outputBytes += data.length;
            if (outputBytes > MAX_OUTPUT_BYTES) {
                capped = true;
                try { res.write(JSON.stringify({ type: 'stderr', data: '\n[OUTPUT CAP REACHED — truncated at 512KB]' }) + '\n'); } catch (e) { }
                try { child.kill('SIGTERM'); } catch (e) { }
                return;
            }
            try {
                res.write(JSON.stringify({ type, data: data.toString() }) + '\n');
            } catch (e) {
                console.warn('[BRIDGE/exec] write error:', e.message);
            }
        };

        child.stdout?.on('data', (data) => writeChunk('stdout', data));
        child.stderr?.on('data', (data) => writeChunk('stderr', data));

        const reqCloseHandler = () => {
            if (!child.killed) child.kill('SIGTERM');
        };

        const cleanup = () => {
            req.off('close', reqCloseHandler);
        };

        child.on('close', (code) => {
            cleanup();
            if (!res.headersSent && !res.writableEnded) return;
            try {
                res.write(JSON.stringify({ type: 'exit', code: code ?? 0 }) + '\n');
                res.end();
            } catch { /* client disconnected */ }
            console.log(`[BRIDGE/exec] ✓ exit ${code}  cmd="${command}"`);
        });

        child.on('error', (err) => {
            cleanup();
            console.error(`[BRIDGE/exec] spawn error: ${err.message}`);
            try {
                res.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
                res.end();
            } catch { /* client disconnected */ }
        });

        // Clean up if client disconnects
        req.on('close', reqCloseHandler);
    });

    // ── Store: Config ─────────────────────────────────────────────────────────
    app.get('/store/config', (_req, res) => res.json(getConfig()));
    app.post('/store/config', (req, res) => res.json(setConfig(req.body)));

    // ── Store: Usage ──────────────────────────────────────────────────────────
    app.post('/store/usage', (req, res) => {
        const { provider, inputTokens, outputTokens } = req.body;
        if (!provider) return res.status(400).json({ error: 'Missing provider' });
        res.json(incrementUsage(provider, inputTokens, outputTokens));
    });

    // ── Store: History ────────────────────────────────────────────────────────
    app.get('/store/history', (_req, res) => res.json(getHistory()));
    app.post('/store/history', (req, res) => res.json(saveSession(req.body)));
    app.delete('/store/history', (_req, res) => { clearHistory(); res.json({ ok: true }); });

    // ── Ollama AI Proxy (Streaming) ───────────────────────────────────────────
    app.post('/ai/generate', async (req, res) => {
        try {
            const isChat = !!req.body.messages;
            const endpoint = isChat
                ? 'http://localhost:11434/api/chat'
                : 'http://localhost:11434/api/generate';

            const ollamaRes = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            });

            if (!ollamaRes.ok) {
                const errText = await ollamaRes.text();
                console.error(`[BRIDGE] Ollama error ${ollamaRes.status}: ${errText}`);
                return res.status(ollamaRes.status).json({ error: errText });
            }

            res.setHeader('Content-Type', 'application/x-ndjson');
            res.setHeader('Transfer-Encoding', 'chunked');

            const reader = ollamaRes.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        } catch (err) {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        }
    });

    // ── Ollama Management ─────────────────────────────────────────────────────
    app.get('/ollama/status', async (_req, res) => {
        try {
            const r = await fetch('http://localhost:11434/api/tags');
            const data = await r.json();
            res.json({ running: true, models: data.models || [] });
        } catch {
            res.json({ running: false, models: [] });
        }
    });

    app.listen(PORT, '127.0.0.1', () => {
        console.log(`[BRIDGE] Listening on http://127.0.0.1:${PORT}`);
    });
}