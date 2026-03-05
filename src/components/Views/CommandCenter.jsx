// src/components/Views/CommandCenter.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — Command Center  (v4: Surgical Strike Edition)
//
//  FIXES APPLIED:
//    #1 — Export Report button: appears after Inquisitor scan completes,
//         triggers a browser JSON download of the full results array.
//    #3 — History save: fires POST /store/history in onComplete callback.
//    #4 — Herald regex armor: strips conversational filler from qwen3.5:9b
//         output using a strict Conventional Commits regex.
//    #6 — Per-file status updates: onFileComplete fires immediately when
//         each file resolves, updating its icon without waiting for the
//         full queue to finish.
//
//  LAYOUT:
//    ┌─────────────────────────────────────────────────────┐
//    │  TOP BAR: [ 🐛 Run Inquisitor ] [ 📜 Audit Licenses ] [ 🚀 Generate Commit ] │
//    ├──────────────────────┬──────────────────────────────┤
//    │  LEFT PANEL          │  MAIN PANEL                  │
//    │  (Target Queue)      │  (TerminalLog Stream)         │
//    │                      │                              │
//    │  • auth.js           │  [INQUISITOR] Scanning...    │
//    │  • api.js  ← active  │  [LAWYER] GPL-3.0 in dep X  │
//    │  • store.js          │  [HERALD] Commit ready       │
//    └──────────────────────┴──────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bug, ScrollText, Rocket, FolderOpen,
    X, Loader2, CheckCircle2, AlertCircle,
    ChevronRight, Square, Download
} from 'lucide-react';
import { TerminalLog } from '../arsenal/TerminalLog';
import { useChatEngine } from '../../hooks/useChatEngine';
import { TaskQueueEngine } from '../../utils/TaskQueueEngine';
import { AGENT_TYPES } from '../../agents/prompts';
import { cn } from '../../lib/utils';

const BRIDGE = 'http://localhost:9090';

// ── FIX #4: Conventional Commits regex ────────────────────────────────────────
// qwen3.5:9b (Herald's model) is an instruct model that can't help prepending
// "Here is the commit message:" before the actual output. This regex cuts through
// all conversational noise and extracts only the valid commit string.
// Matches: type(scope): message  OR  type!: breaking change message
const CONVENTIONAL_COMMIT_REGEX =
    /^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert)(\([^)]+\))?!?:\s+.+$/m;

// ── Fetch the project file tree from the bridge ───────────────────────────────
async function fetchProjectTree(projectRoot) {
    try {
        const res = await fetch(`${BRIDGE}/project/tree`, {
            method: 'GET',
            cache: 'no-store',
        });
        if (!res.ok) return [];
        const data = await res.json();
        // Return only source code files — skip lock files, dist, node_modules
        const SKIP = /node_modules|dist|build|\.min\.|package-lock|yarn\.lock|pnpm-lock/;
        const CODE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|rb|java|kt|swift)$/;
        return (data.entries || [])
            .filter(e => e.type === 'file' && CODE.test(e.name) && !SKIP.test(e.relative || ''))
            .map(e => e.relative || e.name);
    } catch {
        return [];
    }
}

// ── FIX #1: Trigger a browser JSON download ───────────────────────────────────
function downloadReport(results, projectRoot) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const projectName = projectRoot
        ? projectRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()
        : 'project';

    const report = {
        generated: new Date().toISOString(),
        project: projectRoot || 'unknown',
        summary: {
            total: results.length,
            clean: results.filter(r => r.status === 'CLEAN').length,
            dirty: results.filter(r => r.status === 'DIRTY').length,
            skipped: results.filter(r => !['CLEAN', 'DIRTY'].includes(r.status)).length,
        },
        files: results,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadowdeck-report-${projectName}-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-component: TriggerButton
// ─────────────────────────────────────────────────────────────────────────────
function TriggerButton({ icon: Icon, label, color, onClick, disabled, isActive }) {
    return (
        <motion.button
            onClick={onClick}
            disabled={disabled}
            whileHover={disabled ? {} : { scale: 1.03 }}
            whileTap={disabled ? {} : { scale: 0.97 }}
            className={cn(
                'relative flex items-center gap-2.5 px-5 py-2.5 rounded-lg',
                'text-sm font-semibold tracking-wide transition-all duration-150',
                'border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                isActive
                    ? `${color.activeBg} ${color.activeBorder} ${color.text} ring-2 ${color.ring}`
                    : `bg-zinc-900/80 border-white/10 text-zinc-300 hover:${color.hoverBg} hover:${color.hoverBorder} hover:${color.text}`,
                disabled && 'opacity-40 cursor-not-allowed',
            )}
        >
            {isActive
                ? <Loader2 size={15} className="animate-spin shrink-0" />
                : <Icon size={15} className="shrink-0" />
            }
            <span>{label}</span>
        </motion.button>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-component: TargetItem (left panel file row)
// ─────────────────────────────────────────────────────────────────────────────
function TargetItem({ filePath, status, isActive }) {
    const filename = filePath.split(/[\\\/]/).pop();
    const dirpath = filePath.replace(/[\\\/][^\\\/]+$/, '');

    const statusIcon = {
        pending: <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />,
        running: <Loader2 size={11} className="animate-spin text-teal-400 shrink-0" />,
        CLEAN: <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />,
        DIRTY: <AlertCircle size={11} className="text-red-400 shrink-0" />,
        SKIPPED: <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />,
        REJECTED: <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />,
        PARSE_ERROR: <span className="w-1.5 h-1.5 rounded-full bg-amber-700 shrink-0" />,
    }[status] || <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors',
                isActive ? 'bg-teal-500/10 border border-teal-500/20' : 'hover:bg-white/[0.03]'
            )}
        >
            {statusIcon}
            <div className="min-w-0 flex-1">
                <p className={cn(
                    'text-xs font-mono truncate',
                    isActive ? 'text-teal-300' : 'text-zinc-300'
                )}>
                    {filename}
                </p>
                {dirpath && (
                    <p className="text-[10px] text-zinc-600 truncate font-mono">{dirpath}</p>
                )}
            </div>
            {isActive && (
                <ChevronRight size={10} className="text-teal-500 shrink-0 animate-pulse" />
            )}
        </motion.div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════
//  CommandCenter — Main Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {Object}  props
 * @param {string}  props.projectRoot     — Absolute path from App state
 * @param {boolean} [props.isConnected]   — Whether a project is connected
 */
export function CommandCenter({ projectRoot = null, isConnected = false }) {
    // ── Engine ────────────────────────────────────────────────────────────────
    const {
        logs,
        isRunning,
        activeTask,
        dispatch,
        clearLogs,
        abort,
        pushLog,
    } = useChatEngine({ projectRoot });

    // ── Local State ───────────────────────────────────────────────────────────
    /** Files currently in the Inquisitor queue */
    const [queue, setQueue] = useState([]);
    /** Per-file scan status map: filePath → 'pending'|'running'|'CLEAN'|'DIRTY'|... */
    const [fileStatuses, setFileStatuses] = useState({});
    /** The file currently being scanned */
    const [activeFile, setActiveFile] = useState(null);
    /** Commit message output from Herald */
    const [commitMessage, setCommitMessage] = useState('');
    /** FIX #1: Full results array from the last completed Inquisitor scan */
    const [completedResults, setCompletedResults] = useState(null);
    /** Track the project root used for the last scan (for the report filename) */
    const lastScannedRootRef = useRef(null);

    const queueEngineRef = useRef(null);

    // ── IDE trigger listener ──────────────────────────────────────────────────
    useEffect(() => {
        const { ipcRenderer } = window.require?.('electron') || {};
        if (!ipcRenderer) return;

        const handleIdeTrigger = (_, { type, payload }) => {
            if (type === 'ANALYZE' && payload?.file) {
                const filePath = payload.file;
                setQueue([filePath]);
                setFileStatuses({ [filePath]: 'pending' });
                setCompletedResults(null);
                dispatch(AGENT_TYPES.INQUISITOR, {
                    filePath,
                    content: payload.code || '',
                });
            }
        };

        ipcRenderer.on('ide-trigger', handleIdeTrigger);
        return () => ipcRenderer.removeListener('ide-trigger', handleIdeTrigger);
    }, [dispatch]);

    // ─────────────────────────────────────────────────────────────────────────
    //  TRIGGER 1: Run Inquisitor
    //  Opens the Electron directory picker, traverses the tree,
    //  and feeds all source files into TaskQueueEngine.
    // ─────────────────────────────────────────────────────────────────────────
    const handleRunInquisitor = useCallback(async () => {
        if (isRunning) return;

        let targetRoot = projectRoot;

        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('dialog:openDirectory');
                if (!result || result.canceled || !result.filePaths?.[0]) {
                    pushLog('WARNING', '[INQUISITOR] Directory picker cancelled.');
                    return;
                }
                targetRoot = result.filePaths[0];

                // Register the chosen path as active project with the bridge
                await fetch(`${BRIDGE}/project/connect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: targetRoot }),
                }).catch(() => { });

            } catch {
                if (!targetRoot) {
                    pushLog('ERROR', '[INQUISITOR] No project connected and no directory picker available.');
                    return;
                }
            }
        }

        if (!targetRoot) {
            pushLog('ERROR', '[INQUISITOR] No project root. Connect a project first.');
            return;
        }

        clearLogs();
        setQueue([]);
        setFileStatuses({});
        setActiveFile(null);
        setCompletedResults(null); // FIX #1: clear previous report
        lastScannedRootRef.current = targetRoot;

        pushLog('INFO', `[INQUISITOR] Fetching file tree from: ${targetRoot}`);
        const files = await fetchProjectTree(targetRoot);

        if (!files.length) {
            pushLog('WARNING', '[INQUISITOR] No source files found in selected directory.');
            return;
        }

        setQueue(files);
        setFileStatuses(Object.fromEntries(files.map(f => [f, 'pending'])));
        pushLog('INFO', `[INQUISITOR] ${files.length} source file(s) queued.`);

        // ── Wire up the TaskQueueEngine ──────────────────────────────────────────
        const engine = new TaskQueueEngine({
            projectRoot: targetRoot,
            dispatch,
            pushLog,

            onProgress: (current, total, filePath) => {
                // Mark the file as 'running' when it starts
                setActiveFile(filePath);
                setFileStatuses(prev => ({ ...prev, [filePath]: 'running' }));
            },

            // FIX #6: Update each file's icon the instant it resolves —
            // no more spinning loaders on files that are already done.
            onFileComplete: (filePath, status) => {
                setActiveFile(prev => (prev === filePath ? null : prev));
                setFileStatuses(prev => ({ ...prev, [filePath]: status }));
            },

            onComplete: (results) => {
                // onFileComplete has already updated individual statuses,
                // but we do a final bulk-set here as a consistency guarantee.
                setActiveFile(null);
                setFileStatuses(
                    Object.fromEntries(results.map(r => [r.filePath, r.status]))
                );

                // FIX #1: Store results so the Export Report button can appear
                setCompletedResults(results);

                // FIX #3: Persist the scan to the history vault in %APPDATA%
                const clean = results.filter(r => r.status === 'CLEAN').length;
                const dirty = results.filter(r => r.status === 'DIRTY').length;
                fetch(`${BRIDGE}/store/history`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: `inquisitor-${Date.now()}`,
                        type: 'ANALYSIS',
                        message: `Inquisitor scan: ${results.length} files — ${dirty} DIRTY · ${clean} CLEAN`,
                        timestamp: new Date().toISOString(),
                        projectRoot: targetRoot,
                        data: results,
                    }),
                }).catch(() => {
                    // Non-fatal — history save is best-effort
                });
            },
        });

        queueEngineRef.current = engine;
        await engine.run(files);

    }, [isRunning, projectRoot, dispatch, pushLog, clearLogs]);


    // ─────────────────────────────────────────────────────────────────────────
    //  TRIGGER 2: Audit Licenses
    //  Fetches package.json and sends it to The Lawyer.
    // ─────────────────────────────────────────────────────────────────────────
    const handleAuditLicenses = useCallback(async () => {
        if (isRunning) return;
        if (!projectRoot && !isConnected) {
            pushLog('ERROR', '[LAWYER] No project connected. Use Settings to connect one.');
            return;
        }
        clearLogs();
        setQueue(['package.json']);
        setCommitMessage('');
        setCompletedResults(null);
        await dispatch(AGENT_TYPES.LAWYER, {});
        setQueue([]);
    }, [isRunning, projectRoot, isConnected, dispatch, pushLog, clearLogs]);


    // ─────────────────────────────────────────────────────────────────────────
    //  TRIGGER 3: Generate Commit
    //  Fetches the git diff and sends it to The Herald.
    // ─────────────────────────────────────────────────────────────────────────
    const handleGenerateCommit = useCallback(async () => {
        if (isRunning) return;
        if (!projectRoot && !isConnected) {
            pushLog('ERROR', '[HERALD] No project connected. Use Settings to connect one.');
            return;
        }
        clearLogs();
        setQueue(['git diff']);
        setCommitMessage('');
        setCompletedResults(null);

        const result = await dispatch(AGENT_TYPES.HERALD, {});

        if (result) {
            // FIX #4: qwen3.5:9b is an instruct model and will prefix its output
            // with conversational filler ("Here is the commit message:", etc.).
            // We armour the extraction with a strict Conventional Commits regex
            // that ignores every line that doesn't match the required format.
            // Only if no valid commit line is found do we fall back to the first
            // non-empty line (which handles edge-case models that get it right).
            const match = result.match(CONVENTIONAL_COMMIT_REGEX);
            if (match) {
                setCommitMessage(match[0].trim());
            } else {
                const firstLine = result.split('\n').find(l => l.trim());
                if (firstLine) setCommitMessage(firstLine.trim());
            }
        }
        setQueue([]);
    }, [isRunning, projectRoot, isConnected, dispatch, pushLog, clearLogs]);


    // ─────────────────────────────────────────────────────────────────────────
    //  Abort handler
    // ─────────────────────────────────────────────────────────────────────────
    const handleAbort = useCallback(() => {
        queueEngineRef.current?.abort();
        abort();
        setActiveFile(null);
        setQueue([]);
    }, [abort]);


    // ─────────────────────────────────────────────────────────────────────────
    //  Render
    // ─────────────────────────────────────────────────────────────────────────
    const anyTaskActive = isRunning;
    // FIX #1: Show export button only after a scan finishes with results
    const showExportButton = !anyTaskActive && completedResults && completedResults.length > 0;

    return (
        <div className="flex flex-col h-full w-full bg-black/30 rounded-xl overflow-hidden">

            {/* ══════════════════════════════════════════════════════════════════
          TOP BAR — The Triggers
      ══════════════════════════════════════════════════════════════════ */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] bg-black/20 flex-wrap">

                {/* ── Title ────────────────────────────────────────────────────── */}
                <div className="flex items-center gap-2 mr-2">
                    <span className="text-[10px] font-bold tracking-[0.3em] text-zinc-600 uppercase">
                        ShadowDeck
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-[10px] font-bold tracking-[0.3em] text-teal-600 uppercase">
                        Command Center
                    </span>
                </div>

                <div className="flex-1 h-px bg-white/[0.05]" />

                {/* ── Trigger Buttons ──────────────────────────────────────────── */}
                <div className="flex items-center gap-2 flex-wrap">
                    <TriggerButton
                        icon={Bug}
                        label="Run Inquisitor"
                        color={{
                            activeBg: 'bg-orange-950/40',
                            activeBorder: 'border-orange-500/40',
                            text: 'text-orange-400',
                            hoverBg: 'bg-orange-950/20',
                            hoverBorder: 'border-orange-500/20',
                            ring: 'ring-orange-500/30',
                        }}
                        onClick={handleRunInquisitor}
                        disabled={anyTaskActive}
                        isActive={isRunning && activeTask === AGENT_TYPES.INQUISITOR}
                    />

                    <TriggerButton
                        icon={ScrollText}
                        label="Audit Licenses"
                        color={{
                            activeBg: 'bg-violet-950/40',
                            activeBorder: 'border-violet-500/40',
                            text: 'text-violet-400',
                            hoverBg: 'bg-violet-950/20',
                            hoverBorder: 'border-violet-500/20',
                            ring: 'ring-violet-500/30',
                        }}
                        onClick={handleAuditLicenses}
                        disabled={anyTaskActive}
                        isActive={isRunning && activeTask === AGENT_TYPES.LAWYER}
                    />

                    <TriggerButton
                        icon={Rocket}
                        label="Generate Commit"
                        color={{
                            activeBg: 'bg-sky-950/40',
                            activeBorder: 'border-sky-500/40',
                            text: 'text-sky-400',
                            hoverBg: 'bg-sky-950/20',
                            hoverBorder: 'border-sky-500/20',
                            ring: 'ring-sky-500/30',
                        }}
                        onClick={handleGenerateCommit}
                        disabled={anyTaskActive}
                        isActive={isRunning && activeTask === AGENT_TYPES.HERALD}
                    />

                    {/* ── Abort button (only visible when running) ─────────────── */}
                    <AnimatePresence>
                        {anyTaskActive && (
                            <motion.button
                                key="abort"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                onClick={handleAbort}
                                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg
                           bg-red-950/40 border border-red-500/30 text-red-400
                           text-sm font-semibold hover:bg-red-950/60 transition-colors"
                            >
                                <Square size={11} className="shrink-0" />
                                <span>Stop</span>
                            </motion.button>
                        )}
                    </AnimatePresence>

                    {/* ── FIX #1: Export Report button ──────────────────────────── */}
                    {/* Appears only after a scan completes. Downloads a timestamped  */}
                    {/* JSON file with the full results array.                        */}
                    <AnimatePresence>
                        {showExportButton && (
                            <motion.button
                                key="export"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                onClick={() => downloadReport(completedResults, lastScannedRootRef.current)}
                                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg
                           bg-teal-950/40 border border-teal-500/30 text-teal-400
                           text-sm font-semibold hover:bg-teal-950/60 transition-colors"
                                title="Download full Inquisitor report as JSON"
                            >
                                <Download size={11} className="shrink-0" />
                                <span>Export Report</span>
                            </motion.button>
                        )}
                    </AnimatePresence>

                    {/* ── Clear logs button ─────────────────────────────────────── */}
                    {!anyTaskActive && logs.length > 0 && (
                        <button
                            onClick={() => {
                                clearLogs();
                                setQueue([]);
                                setCommitMessage('');
                                setFileStatuses({});
                                setCompletedResults(null);
                            }}
                            className="p-2 rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04]
                         transition-colors"
                            title="Clear logs"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
          BODY — Left Panel + Main Panel
      ══════════════════════════════════════════════════════════════════ */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* ── LEFT PANEL: Target Queue ────────────────────────────────── */}
                <div className="w-56 shrink-0 flex flex-col border-r border-white/[0.06] bg-black/10 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-white/[0.05]">
                        <div className="flex items-center gap-2">
                            <FolderOpen size={11} className="text-zinc-600" />
                            <span className="text-[10px] font-bold tracking-[0.2em] text-zinc-600 uppercase">
                                Targets
                            </span>
                            {queue.length > 0 && (
                                <span className="ml-auto text-[10px] tabular-nums text-zinc-600">
                                    {queue.length}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 px-1.5 min-h-0">
                        <AnimatePresence mode="popLayout">
                            {queue.length === 0 ? (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center justify-center h-24"
                                >
                                    <p className="text-[11px] text-zinc-700 text-center leading-relaxed">
                                        Select a trigger<br />to populate targets
                                    </p>
                                </motion.div>
                            ) : (
                                queue.map((filePath) => (
                                    <TargetItem
                                        key={filePath}
                                        filePath={filePath}
                                        status={fileStatuses[filePath] || 'pending'}
                                        isActive={filePath === activeFile}
                                    />
                                ))
                            )}
                        </AnimatePresence>
                    </div>

                    {/* ── Queue summary ──────────────────────────────────────────── */}
                    {queue.length > 0 && !anyTaskActive && (
                        <div className="px-3 py-2 border-t border-white/[0.05] bg-black/20">
                            <div className="flex gap-3 text-[10px] tabular-nums">
                                <span className="text-emerald-500">
                                    {Object.values(fileStatuses).filter(s => s === 'CLEAN').length} CLEAN
                                </span>
                                <span className="text-red-400">
                                    {Object.values(fileStatuses).filter(s => s === 'DIRTY').length} DIRTY
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── MAIN PANEL: Terminal Stream ──────────────────────────────── */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <TerminalLog logs={logs} className="flex-1 rounded-none border-0" />

                    {/* ── Commit message copy bar (Herald output) ─────────────── */}
                    <AnimatePresence>
                        {commitMessage && (
                            <motion.div
                                key="commit-bar"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 16 }}
                                className="flex items-center gap-3 px-4 py-3 border-t border-sky-500/20
                           bg-sky-950/20"
                            >
                                <Rocket size={13} className="text-sky-400 shrink-0" />
                                <code className="flex-1 text-xs text-sky-300 font-mono truncate">
                                    {commitMessage}
                                </code>
                                <button
                                    onClick={() => navigator.clipboard?.writeText(commitMessage)}
                                    className="text-[10px] font-semibold text-sky-500 hover:text-sky-300
                             border border-sky-500/30 hover:border-sky-400/50 rounded px-2 py-1
                             transition-colors shrink-0"
                                >
                                    Copy
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

export default CommandCenter;