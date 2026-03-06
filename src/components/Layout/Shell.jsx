// src/components/Layout/Shell.jsx
// ─── CHANGES FROM ORIGINAL ──────────────────────────────────────────────────
//  1. NAV updated: 'live' + 'lab' → 'chat' (unified console). 'history' + 'settings' kept.
//  2. New `floating` prop: when true, the shell is a rounded glass card instead of
//     a full-screen panel. App.jsx wraps it in a padded container so the animated
//     background bleeds through around the edges.
//  3. The outer wrapper uses `h-full w-full` (fits inside App's padded container)
//     vs the old `h-screen w-screen` (which always covered the entire viewport).
//  FIX #7: Added a dedicated [ 📁 Change Project ] button in the title bar logo
//     area (WebkitAppRegion: no-drag). Wires to the existing onConnectProject prop
//     without disrupting the drag region or window controls.
// ────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, History, Settings, FlaskConical,
    Minus, X, Maximize2, Zap, ChevronRight, Sun,
    FileCode2, Link2, FolderOpen,
} from 'lucide-react';

const { ipcRenderer } = window.require('electron');

// ── Navigation items ─────────────────────────────────────────────────────────
const NAV = [
    { id: 'chat', icon: MessageSquare, label: 'Console' },
    { id: 'lab', icon: FlaskConical, label: 'Laboratory' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'settings', icon: Settings, label: 'Settings' },
];

const SEVERITY_COLOR = {
    CRITICAL: '#f43f5e',
    WARNING: '#f59e0b',
    ERROR: '#f43f5e',
    SUCCESS: '#34d399',
    INFO: '#a1a1aa',
    ANALYSIS: '#14b8a6',
    DATA: '#d4d4d8',
    SESSION: '#818cf8', // indigo — threaded session entries
};

// ── Sidebar tooltip ───────────────────────────────────────────────────────────
function Tip({ label }) {
    return (
        <div
            className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                       px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none
                       text-xs tracking-wide border
                       opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{
                background: 'rgba(0,0,0,0.92)',
                color: '#e4e4e7',
                backdropFilter: 'blur(12px)',
                borderColor: 'rgba(255,255,255,0.12)',
            }}
        >
            {label}
        </div>
    );
}

// ── Project breadcrumb bar ────────────────────────────────────────────────────
function Breadcrumb({ activeProject, currentFile, colors, onConnectProject }) {
    const { textMuted, textSub, textPrimary, accentColor } = colors;

    if (!activeProject && !currentFile) {
        return (
            <div className="flex items-center gap-3 w-full">
                <span
                    className="text-xs tracking-[0.25em] uppercase font-semibold animate-pulse"
                    style={{ color: '#f59e0b' }}
                >
                    ⚡ AWAITING NEURAL UPLINK
                </span>
                {onConnectProject && (
                    <button
                        onClick={onConnectProject}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold tracking-wider uppercase transition-all hover:scale-105"
                        style={{
                            background: `color-mix(in srgb, ${accentColor} 20%, transparent)`,
                            border: `1px solid ${accentColor}`,
                            color: accentColor,
                        }}
                    >
                        <Link2 size={12} />
                        CONNECT PROJECT
                    </button>
                )}
            </div>
        );
    }

    const normProject = activeProject ? activeProject.replace(/\\/g, '/') : null;
    const projectName = normProject ? normProject.split('/').filter(Boolean).pop() : null;

    const normFile = currentFile ? currentFile.replace(/\\/g, '/') : null;
    let fileName = null;
    if (normFile) {
        const parts = normFile.split('/').filter(Boolean);
        fileName = parts.pop() || null;
    }

    return (
        <div className="flex items-center gap-2 min-w-0 overflow-hidden text-xs tracking-wide">
            <span style={{ color: textMuted }} className="uppercase font-semibold shrink-0">PROJECT:</span>
            <span className="font-bold shrink-0" style={{ color: accentColor }}>
                {projectName || '—'}
            </span>
            <span style={{ color: textMuted }} className="shrink-0">│</span>
            <span style={{ color: textMuted }} className="uppercase font-semibold shrink-0">PATH:</span>
            <span className="truncate" style={{ color: textSub, maxWidth: '260px' }}>
                {normProject || '—'}
            </span>
            <span style={{ color: textMuted }} className="shrink-0">│</span>
            <span style={{ color: textMuted }} className="uppercase font-semibold shrink-0">FILE:</span>
            <span className="flex items-center gap-1 truncate" style={{ color: textPrimary, maxWidth: '180px' }}>
                {fileName ? (
                    <>
                        <FileCode2 size={11} className="shrink-0" style={{ color: textMuted }} />
                        {fileName}
                    </>
                ) : (
                    <span style={{ color: textMuted }} className="italic">waiting…</span>
                )}
            </span>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Shell
// ═════════════════════════════════════════════════════════════════════════════
export function Shell({
    accentColor = '#14b8a6',
    activeView,
    onViewChange,
    children,
    logs = [],
    bridgeStatus = 'online',
    activeAgent = 'INQUISITOR',
    isThinking = false,
    glareShield = false,
    onGlareToggle,
    activeProject = null,
    currentFile = null,
    connectionMode = null,
    onConnectProject = null,
    onHistoryClick = null,
    // New: when true, Shell renders as a floating glass card inside its parent container.
    // When false (legacy), it fills the entire screen (h-screen w-screen).
    floating = false,
}) {
    const [historyOpen, setHistoryOpen] = useState(false);

    // ── Colour tokens ─────────────────────────────────────────────────────────
    const textPrimary = '#ffffff';
    const textSub = glareShield ? '#f4f4f5' : '#e4e4e7';
    const textMuted = glareShield ? '#d4d4d8' : '#a1a1aa';
    const textDim = glareShield ? '#a1a1aa' : '#71717a';

    const panelBg = glareShield ? 'rgba(0,0,0,0.98)' : 'rgba(0,0,0,0.88)';
    const sidebarBg = glareShield ? 'rgba(0,0,0,0.98)' : 'rgba(0,0,0,0.92)';
    const statusBg = glareShield ? 'rgba(0,0,0,0.98)' : 'rgba(0,0,0,0.95)';
    const borderColor = glareShield ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)';
    const accentDim = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
    const accentGlow = `0 0 12px color-mix(in srgb, ${accentColor} 50%, transparent)`;

    const colorTokens = { textPrimary, textSub, textMuted, textDim, accentColor };

    const handleNav = (id) => {
        if (id === 'history') { setHistoryOpen(v => !v); }
        else { setHistoryOpen(false); onViewChange(id); }
    };

    // ── Root wrapper ──────────────────────────────────────────────────────────
    const rootClass = floating
        ? 'flex flex-col h-full w-full overflow-hidden font-mono'
        : 'flex flex-col h-screen w-screen overflow-hidden font-mono';

    const rootStyle = floating
        ? {
            borderRadius: '16px',
            border: `1px solid ${borderColor}`,
            boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 32px 80px rgba(0,0,0,0.7), 0 0 40px color-mix(in srgb, ${accentColor} 8%, transparent)`,
            backdropFilter: 'blur(2px)',
            overflow: 'hidden', // Clip children to rounded corners
        }
        : {};

    return (
        <div className={rootClass} style={rootStyle}>

            {/* ═══════════════════════════════════════════
                TITLE BAR
            ═══════════════════════════════════════════ */}
            <div
                className="relative flex items-center justify-between h-11 px-4 shrink-0 z-30 border-b"
                style={{
                    WebkitAppRegion: 'drag',
                    background: panelBg,
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    borderColor,
                    transition: 'background 0.5s ease',
                    borderRadius: floating ? '16px 16px 0 0' : undefined,
                }}
            >
                {/* Logo + FIX #7: Change Project button */}
                <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: 'no-drag' }}>
                    <div className="relative flex items-center justify-center w-[16px] h-[16px] mt-0.5">
                        <img src="/sdeck.png" alt="ShadowDeck" className="absolute inset-0 w-full h-full object-contain" />
                        <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: accentColor, mixBlendMode: 'color' }} />
                    </div>
                    <span className="text-sm font-bold tracking-[0.22em] uppercase" style={{ color: textPrimary }}>
                        Shadow<span style={{ color: accentColor }}>Deck</span>
                    </span>
                    <span className="text-xs tracking-widest ml-1" style={{ color: textDim }}>v0.1</span>

                    {/* FIX #7: Dedicated Change Project button in the title bar.
                        Lives inside the no-drag zone next to the logo so it's
                        always reachable — no longer buried behind "Run Inquisitor". */}
                    {onConnectProject && (
                        <>
                            <div className="w-px h-4 mx-1" style={{ backgroundColor: borderColor }} />
                            <button
                                onClick={onConnectProject}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wider uppercase transition-all hover:scale-105"
                                style={{
                                    background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                                    border: `1px solid color-mix(in srgb, ${accentColor} 28%, transparent)`,
                                    color: textMuted,
                                }}
                                title="Change active project directory"
                            >
                                <FolderOpen size={11} />
                                {activeProject ? 'Change Project' : 'Open Project'}
                            </button>
                        </>
                    )}
                </div>

                {/* Center: agent status pill */}
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
                    {isThinking ? (
                        <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2"
                        >
                            <motion.div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: accentColor }}
                                animate={{ opacity: [1, 0.2, 1] }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                            />
                            <span className="text-xs tracking-widest uppercase font-medium" style={{ color: accentColor }}>
                                {activeAgent} — Processing
                            </span>
                        </motion.div>
                    ) : (
                        <span className="text-xs tracking-widest uppercase" style={{ color: textDim }}>
                            {activeAgent} — Standby
                        </span>
                    )}
                </div>

                {/* Right: Glare Shield + Window controls */}
                <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
                    <button
                        onClick={onGlareToggle}
                        title={glareShield ? 'Glare Shield: ON' : 'Glare Shield: OFF'}
                        className="w-8 h-8 flex items-center justify-center rounded transition-all"
                        style={{
                            background: glareShield ? `color-mix(in srgb, ${accentColor} 20%, transparent)` : 'transparent',
                            border: `1px solid ${glareShield ? `color-mix(in srgb, ${accentColor} 40%, transparent)` : 'transparent'}`,
                            color: glareShield ? accentColor : textMuted,
                        }}
                    >
                        <Sun size={13} />
                    </button>
                    <div className="w-px h-4 mx-1" style={{ backgroundColor: borderColor }} />
                    {[
                        { icon: Minus, event: 'window-min' },
                        { icon: Maximize2, event: 'window-max' },
                        { icon: X, event: 'window-close', danger: true },
                    ].map(({ icon: Icon, event, danger }) => (
                        <button
                            key={event}
                            onClick={() => ipcRenderer.send(event)}
                            className="w-8 h-8 flex items-center justify-center rounded transition-all"
                            style={{ color: textMuted }}
                            onMouseEnter={e => {
                                e.currentTarget.style.color = danger ? '#f87171' : textPrimary;
                                e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.10)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.color = textMuted;
                                e.currentTarget.style.background = 'transparent';
                            }}
                        >
                            <Icon size={12} />
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══════════════════════════════════════════
                BREADCRUMB BAR
            ═══════════════════════════════════════════ */}
            <div
                className="flex items-center px-4 h-9 shrink-0 border-b"
                style={{
                    background: glareShield ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.88)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    borderColor,
                    transition: 'background 0.5s ease',
                }}
            >
                <Breadcrumb
                    activeProject={activeProject}
                    currentFile={currentFile}
                    colors={colorTokens}
                    onConnectProject={onConnectProject}
                    connectionMode={connectionMode}
                />
            </div>

            {/* ═══════════════════════════════════════════
                BODY
            ═══════════════════════════════════════════ */}
            <div className="flex flex-1 overflow-hidden">

                {/* ── Icon sidebar rail ── */}
                <div
                    className="relative w-14 flex flex-col items-center py-3 gap-1 shrink-0 border-r z-20"
                    style={{
                        background: sidebarBg,
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        borderColor,
                        transition: 'background 0.5s ease',
                    }}
                >
                    {/* S-Deck logomark */}
                    <div className="mb-2 relative flex items-center justify-center w-8 h-8">
                        <img src="/sdeck.png" alt="ShadowDeck" className="absolute inset-0 w-full h-full object-contain" />
                        <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: accentColor, mixBlendMode: 'color' }} />
                    </div>

                    {NAV.map(({ id, icon: Icon, label }) => {
                        const isActive = id === 'history' ? historyOpen : activeView === id;
                        return (
                            <button
                                key={id}
                                onClick={() => handleNav(id)}
                                className="group relative w-10 h-10 flex items-center justify-center rounded-xl transition-all"
                                style={{ backgroundColor: isActive ? accentDim : 'transparent' }}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="nav-pill"
                                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full"
                                        style={{ backgroundColor: accentColor, boxShadow: accentGlow }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                    />
                                )}
                                <Icon
                                    size={17}
                                    style={{ color: isActive ? accentColor : textMuted, transition: 'color 0.15s' }}
                                />
                                <Tip label={label} />
                            </button>
                        );
                    })}
                </div>

                {/* ── History drawer (slide-in panel) ── */}
                <AnimatePresence>
                    {historyOpen && (
                        <motion.div
                            key="history-drawer"
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 300, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                            className="h-full border-r shrink-0 overflow-hidden z-10"
                            style={{
                                borderColor,
                                background: 'rgba(0,0,0,0.80)',
                                backdropFilter: 'blur(24px)',
                                WebkitBackdropFilter: 'blur(24px)',
                            }}
                        >
                            <div className="w-[300px] h-full flex flex-col">
                                {/* Drawer header */}
                                <div
                                    className="flex items-center justify-between px-4 py-3 border-b shrink-0"
                                    style={{ borderColor }}
                                >
                                    <span className="text-sm font-semibold tracking-wide" style={{ color: textSub }}>
                                        Mission Log
                                    </span>
                                    <button
                                        onClick={() => setHistoryOpen(false)}
                                        className="hover:opacity-70 transition-opacity"
                                        style={{ color: textMuted }}
                                    >
                                        <ChevronRight size={14} />
                                    </button>
                                </div>

                                {/* Log list */}
                                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
                                    {logs.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-32 gap-3">
                                            <div
                                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                                style={{ border: `1px solid ${borderColor}` }}
                                            >
                                                <History size={16} style={{ color: textDim }} />
                                            </div>
                                            <span className="text-xs tracking-widest uppercase" style={{ color: textDim }}>
                                                No records
                                            </span>
                                        </div>
                                    ) : (
                                        [...logs].reverse().map((log) => (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, x: -6 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                onClick={() => onHistoryClick?.(log)}
                                                className="p-3 rounded-lg border cursor-pointer hover:border-white/20 transition-colors"
                                                style={{ borderColor, background: 'rgba(255,255,255,0.03)' }}
                                            >
                                                {/* Row 1: title + timestamp */}
                                                <p className="text-xs font-semibold line-clamp-2 leading-relaxed mb-1.5" style={{ color: textSub }}>
                                                    {log.message || 'Untitled Session'}
                                                </p>
                                                {/* Row 2: type badge + time */}
                                                <div className="flex items-center justify-between">
                                                    <span
                                                        className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded"
                                                        style={{
                                                            color: SEVERITY_COLOR[log.type] || textMuted,
                                                            background: `color-mix(in srgb, ${SEVERITY_COLOR[log.type] || '#a1a1aa'} 12%, transparent)`,
                                                        }}
                                                    >
                                                        {log.type}
                                                    </span>
                                                    <span className="text-[10px] font-mono" style={{ color: textDim }}>
                                                        {log.time}
                                                    </span>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Main content area ── */}
                <div className="flex-1 min-w-0 overflow-hidden relative">
                    {children}
                </div>
            </div>

            {/* ═══════════════════════════════════════════
                STATUS BAR
            ═══════════════════════════════════════════ */}
            <div
                className="h-7 flex items-center justify-between px-4 border-t shrink-0"
                style={{
                    background: statusBg,
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    borderColor,
                    transition: 'background 0.5s ease',
                    borderRadius: floating ? '0 0 16px 16px' : undefined,
                }}
            >
                <div className="flex items-center gap-5">
                    {(() => {
                        const isOnline = bridgeStatus === 'online';
                        let label, color;
                        if (!isOnline) { label = 'DISCONNECTED'; color = '#f43f5e'; }
                        else if (connectionMode === 'ide') { label = 'IDE_LINKED'; color = '#34d399'; }
                        else if (connectionMode === 'manual') { label = 'MANUAL_LINK'; color = '#60a5fa'; }
                        else { label = 'DISCONNECTED'; color = '#f43f5e'; }
                        return (
                            <div className="flex items-center gap-2">
                                <motion.div
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }}
                                    animate={isOnline ? { opacity: [1, 0.4, 1] } : {}}
                                    transition={{ duration: 2.5, repeat: Infinity }}
                                />
                                <span className="text-xs tracking-wider uppercase font-semibold" style={{ color }}>
                                    {label}
                                </span>
                            </div>
                        );
                    })()}
                    <span className="text-xs font-mono" style={{ color: textDim }}>
                        deepseek-r1:14b · qwen3.5:9b
                    </span>
                </div>
                <span className="text-xs font-mono" style={{ color: textDim }}>:9090</span>
            </div>
        </div>
    );
}