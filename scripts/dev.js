#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Resolve a package's CLI entry from its package.json "bin" field
function resolvebin(pkgName) {
    const pkgJson = path.join(ROOT, 'node_modules', pkgName, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    const bin = pkg.bin;
    const rel = typeof bin === 'string' ? bin
        : typeof bin === 'object' ? (bin[pkgName] ?? Object.values(bin)[0])
            : null;
    if (!rel) throw new Error(`No bin entry in ${pkgName}/package.json`);
    return path.join(ROOT, 'node_modules', pkgName, rel);
}

const nodeExe = process.execPath; // exact node binary currently running — always works
const viteEntry = resolvebin('vite');

const COLORS = ['\x1b[36m', '\x1b[35m'];
const RESET = '\x1b[0m';

const commands = [
    { label: 'vite', cmd: nodeExe, args: [viteEntry] },
    { label: 'electron', cmd: nodeExe, args: [path.join(ROOT, 'scripts', 'electron-dev.js')] },
];

const processes = [];
let killed = false;

function killAll() {
    if (killed) return;
    killed = true;
    processes.forEach(p => {
        try {
            if (!p.killed) p.kill();
        } catch (_) { }
    });
}

commands.forEach(({ label, cmd, args }, i) => {
    const color = COLORS[i % COLORS.length];
    const prefix = `${color}[${label}]${RESET} `;

    const p = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env },
        cwd: ROOT,
    });

    processes.push(p);

    const tag = d => d.toString().trimEnd().split('\n').map(l => prefix + l).join('\n') + '\n';
    p.stdout.on('data', d => process.stdout.write(tag(d)));
    p.stderr.on('data', d => process.stderr.write(tag(d)));
    p.on('close', code => { console.log(`${prefix}exited with code ${code}`); killAll(); });
    p.on('error', err => { console.error(`${prefix}${err.message}`); killAll(); });
});

process.on('SIGINT', killAll);
process.on('SIGTERM', killAll);