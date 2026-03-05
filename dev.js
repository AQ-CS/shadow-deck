import { spawn } from 'child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Spawn React Dev Server
const vite = spawn(npmCmd, ['run', 'react:dev'], { stdio: 'inherit' });

// Spawn Electron Dev Process
const electron = spawn(npmCmd, ['run', 'electron:dev'], { stdio: 'inherit' });

let isExiting = false;

[vite, electron].forEach(proc => {
    proc.on('close', code => {
        if (isExiting) return;
        isExiting = true;
        if (code !== 0 && code !== null) {
            console.error(`Process exited with code ${code}`);
        }
        try { vite.kill('SIGINT'); } catch (e) { }
        try { electron.kill('SIGINT'); } catch (e) { }
        process.exit(code || 0);
    });
});

process.on('SIGINT', () => {
    if (isExiting) return;
    isExiting = true;
    try { vite.kill('SIGINT'); } catch (e) { }
    try { electron.kill('SIGINT'); } catch (e) { }
    process.exit();
});
