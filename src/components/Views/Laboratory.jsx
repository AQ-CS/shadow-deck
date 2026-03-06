// src/components/Views/Laboratory.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  THE LABORATORY — Agent Council Overview (v5: Multi-Provider Edition)
//
//  ARCHITECTURE:
//    • Renders a grid of 6 Agent Cards — one per council member.
//    • Each card shows: icon, name, role description, provider badge, model,
//      and an [ Initialize ] button that opens the Pre-Flight Modal.
//    • Clicking [ Initialize ] never executes immediately. It opens the
//      Pre-Flight Modal so the user can review scope, provider, and model.
//    • A Usage Tracker bar shows live Groq / GitHub daily consumption.
//    • A TerminalLog panel at the bottom shows output from this view's
//      own useChatEngine instance.
//
//  PROPS:
//    accentColor   — global accent hex
//    glare         — glare shield active
//    projectRoot   — absolute path of connected project (may be null)
//    config        — current store config (for providers check)
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FlaskConical, Activity, Zap, Cloud, Server,
    XCircle, Trash2, StopCircle,
} from 'lucide-react';
import {
    AGENT_TYPES,
    AGENT_DESCRIPTIONS,
    AGENT_PROVIDER,
    AGENT_MODELS,
    AGENT_SCOPE_LABEL,
    PROVIDER_META,
    PROVIDER_LIMITS,
} from '../../agents/prompts';
import { useChatEngine } from '../../hooks/useChatEngine';
import { PreFlightModal } from '../PreFlightModal';
import { TerminalLog } from '../arsenal/TerminalLog';

// ── Agent display metadata ─────────────────────────────────────────────────────

const COUNCIL = [
    {
        key: AGENT_TYPES.INQUISITOR,
        label: 'The Inquisitor',
        role: 'File Linter',
        icon: '🔎',
        color: '#f97316',
    },
    {
        key: AGENT_TYPES.FORGER,
        label: 'The Forger',
        role: 'Unit Test Forge',
        icon: '⚒️',
        color: '#22d3ee',
    },
    {
        key: AGENT_TYPES.HERALD,
        label: 'The Herald',
        role: 'Commit Generator',
        icon: '📣',
        color: '#38bdf8',
    },
    {
        key: AGENT_TYPES.ARCHITECT,
        label: 'The Architect',
        role: 'Deep Refactor',
        icon: '🏗️',
        color: '#818cf8',
    },
    {
        key: AGENT_TYPES.VAULT_GUARD,
        label: 'The Vault Guard',
        role: 'Secret Scanner',
        icon: '🔒',
        color: '#4ade80',
    },
    {
        key: AGENT_TYPES.LAWYER,
        label: 'The Lawyer',
        role: 'License Audit',
        icon: '⚖️',
        color: '#eab308',
    },
];

// ── Provider Badge ─────────────────────────────────────────────────────────────

function ProviderBadge({ provider }) {
    const meta = PROVIDER_META[provider] || PROVIDER_META.ollama;
    const icons = { groq: Zap, github: Cloud, ollama: Server };
    const Icon = icons[provider] || Server;

    return (
        <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{
                background: meta.bg,
                border: `1px solid ${meta.border}`,
                color: meta.color,
            }}
        >
            <Icon size={9} />
            {meta.label}
        </span>
    );
}

// ── Usage Tracker Bar ──────────────────────────────────────────────────────────

function UsageTracker({ usageStats, borderColor, textDim }) {
    // v6: usageStats is keyed by provider: { groq, github, openrouter }
    // Each entry: { requests, inTokens, outTokens }
    const groq = usageStats?.groq || {};
    const github = usageStats?.github || {};
    const openrouter = usageStats?.openrouter || {};

    const groqReqs = groq.requests || 0;
    const groqIn = groq.inTokens || 0;
    const groqOut = groq.outTokens || 0;
    const githubReqs = github.requests || 0;
    const orReqs = openrouter.requests || 0;
    const orIn = openrouter.inTokens || 0;
    const orOut = openrouter.outTokens || 0;

    const groqLimit = PROVIDER_LIMITS.groq;
    const groqPct = Math.min((groqReqs / groqLimit) * 100, 100);
    const groqColor = groqPct > 90 ? '#f43f5e' : groqPct > 70 ? '#f59e0b' : PROVIDER_META.groq.color;
    const githubColor = PROVIDER_META.github.color;
    const orColor = PROVIDER_META.openrouter?.color || '#38bdf8';

    const fmtTok = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

    return (
        <div className="flex items-center gap-3 flex-wrap">
            {/* Groq */}
            {groqReqs > 0 && (
                <div className="flex items-center gap-1.5">
                    <Zap size={9} style={{ color: groqColor }} />
                    <div className="h-1 w-12 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${groqPct}%`, backgroundColor: groqColor }} />
                    </div>
                    <span className="text-[10px] font-mono" style={{ color: groqColor }}>
                        {groqReqs}req · {fmtTok(groqIn + groqOut)}t
                    </span>
                </div>
            )}
            {/* GitHub */}
            {githubReqs > 0 && (
                <div className="flex items-center gap-1.5">
                    <Cloud size={9} style={{ color: githubColor }} />
                    <span className="text-[10px] font-mono" style={{ color: githubColor }}>
                        {githubReqs}req
                    </span>
                </div>
            )}
            {/* OpenRouter */}
            {orReqs > 0 && (
                <div className="flex items-center gap-1.5">
                    <Activity size={9} style={{ color: orColor }} />
                    <span className="text-[10px] font-mono" style={{ color: orColor }}>
                        OR {orReqs}req · {fmtTok(orIn + orOut)}t
                    </span>
                </div>
            )}
            {groqReqs === 0 && githubReqs === 0 && orReqs === 0 && (
                <span className="text-[10px] font-mono" style={{ color: textDim }}>no usage today</span>
            )}
        </div>
    );
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({
    agent, isRunning, isActive,
    onInitialize,
    accentColor, borderColor,
    textPrimary, textSub, textDim,
}) {
    const provider = AGENT_PROVIDER[agent.key];
    const model = AGENT_MODELS[agent.key];
    const scope = AGENT_SCOPE_LABEL[agent.key];
    const desc = AGENT_DESCRIPTIONS[agent.key];

    const cardBorder = isActive
        ? `color-mix(in srgb, ${agent.color} 45%, transparent)`
        : borderColor;
    const cardBg = isActive
        ? `color-mix(in srgb, ${agent.color} 8%, rgba(0,0,0,0.5))`
        : 'rgba(255,255,255,0.025)';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col rounded-xl overflow-hidden border transition-colors"
            style={{ borderColor: cardBorder, background: cardBg }}
        >
            {/* Card header */}
            <div
                className="flex items-center gap-3 px-4 py-3 border-b"
                style={{
                    borderColor: cardBorder,
                    background: `color-mix(in srgb, ${agent.color} 5%, transparent)`,
                }}
            >
                <span style={{ fontSize: 20 }}>{agent.icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold tracking-wider uppercase" style={{ color: agent.color }}>
                        {agent.label}
                    </div>
                    <div className="text-[10px] tracking-wide uppercase mt-0.5" style={{ color: textDim }}>
                        {agent.role}
                    </div>
                </div>
                {isActive && (
                    <motion.div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: agent.color }}
                        animate={{ opacity: [1, 0.2, 1] }}
                        transition={{ duration: 0.9, repeat: Infinity }}
                    />
                )}
            </div>

            {/* Card body */}
            <div className="flex-1 flex flex-col px-4 py-3 gap-3">
                {/* Description */}
                <p className="text-[11px] leading-relaxed flex-1" style={{ color: textSub }}>
                    {desc}
                </p>

                {/* Provider badge + model */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <ProviderBadge provider={provider} />
                    <span className="text-[10px] font-mono truncate" style={{ color: textDim }} title={model}>
                        {model}
                    </span>
                </div>

                {/* Scope indicator */}
                <div className="flex items-center gap-1.5">
                    <Activity size={10} style={{ color: textDim }} />
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: textDim }}>
                        {scope}
                    </span>
                </div>
            </div>

            {/* Initialize button */}
            <div className="px-4 pb-4">
                <motion.button
                    onClick={() => onInitialize(agent.key)}
                    disabled={isRunning}
                    whileHover={!isRunning ? { scale: 1.02 } : {}}
                    whileTap={!isRunning ? { scale: 0.97 } : {}}
                    className="w-full py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                        background: `color-mix(in srgb, ${agent.color} 14%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${agent.color} 35%, transparent)`,
                        color: isActive ? agent.color : textSub,
                    }}
                >
                    {isActive ? '▶ Running…' : '⚡ Initialize'}
                </motion.button>
            </div>
        </motion.div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════
//  Laboratory — Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function Laboratory({
    accentColor = '#14b8a6',
    glare = false,
    projectRoot = null,
    config = {},
    onViewChange = null,   // Called with 'chat' to redirect to CommandCenter after Execute
}) {
    // ── Engine ────────────────────────────────────────────────────────────────
    const {
        logs, isRunning, activeTask, streamBuffer,
        usageStats, dispatch, clearLogs, abort, refreshUsage,
    } = useChatEngine({ projectRoot });

    // ── Pre-Flight state ──────────────────────────────────────────────────────
    const [preFlightKey, setPreFlightKey] = useState(null);
    const [preFlightScope, setPreFlightScope] = useState(null);
    const [scopeCount, setScopeCount] = useState(null);

    // Refresh usage stats on mount
    useEffect(() => { refreshUsage(); }, [refreshUsage]);

    // ── Open Pre-Flight (fetch scope count for file-based agents) ─────────────
    const handleInitialize = useCallback(async (agentKey) => {
        if (isRunning) return;

        // For agents that need a file count, try to fetch project tree
        const fileAgents = [AGENT_TYPES.INQUISITOR, AGENT_TYPES.FORGER, AGENT_TYPES.ARCHITECT];
        if (fileAgents.includes(agentKey) && projectRoot) {
            try {
                const res = await fetch('http://localhost:9090/project/tree', { cache: 'no-store' });
                const data = await res.json();
                const fileCount = (data.entries || []).filter(e => e.type === 'file').length;
                setScopeCount(fileCount);
            } catch {
                setScopeCount(null);
            }
        } else {
            setScopeCount(null);
        }

        setPreFlightKey(agentKey);
    }, [isRunning, projectRoot]);

    // ── Execute (called by PreFlight confirm) ─────────────────────────────────
    // UX Flow: dispatch → close modal → redirect to CommandCenter log stream
    const handleExecute = useCallback(async (provider, model) => {
        if (!preFlightKey) return;

        const fileAgents = [AGENT_TYPES.INQUISITOR, AGENT_TYPES.FORGER, AGENT_TYPES.ARCHITECT];
        const payload = fileAgents.includes(preFlightKey) ? {} : {};

        // Dispatch the agent task
        dispatch(preFlightKey, payload, { provider, model });

        // Close the Pre-Flight Modal immediately
        setPreFlightKey(null);

        // Redirect the user to CommandCenter so they can watch the log stream
        onViewChange?.('chat');
    }, [preFlightKey, dispatch, onViewChange]);

    // ── Colour tokens ─────────────────────────────────────────────────────────
    const panelBg = glare ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.88)';
    const headerBg = glare ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.88)';
    const textPrimary = glare ? '#ffffff' : '#e4e4e7';
    const textSub = glare ? '#a1a1aa' : '#71717a';
    const textDim = glare ? '#71717a' : '#52525b';
    const borderColor = 'rgba(255,255,255,0.06)';
    const accentDim = `color-mix(in srgb, ${accentColor} 15%, transparent)`;

    // Show terminal panel only when there's output
    const showTerminal = logs.length > 0 || isRunning;

    return (
        <div className="relative w-full h-full flex flex-col overflow-hidden" style={{ background: panelBg }}>

            {/* ── Pre-Flight Modal ── */}
            <PreFlightModal
                isOpen={!!preFlightKey}
                agentKey={preFlightKey}
                scopeCount={scopeCount}
                usageStats={usageStats}
                onExecute={handleExecute}
                onClose={() => setPreFlightKey(null)}
                accentColor={accentColor}
                glare={glare}
            />

            {/* ── Header ── */}
            <div
                className="flex items-center justify-between px-5 py-3 border-b shrink-0"
                style={{ background: headerBg, borderColor }}
            >
                <div className="flex items-center gap-2.5">
                    <FlaskConical size={14} style={{ color: accentColor }} />
                    <span className="text-xs tracking-[0.28em] uppercase font-bold" style={{ color: accentColor }}>
                        The Council
                    </span>
                    <span className="text-[10px] tracking-widest" style={{ color: textDim }}>
                        · {COUNCIL.length} agents
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    {/* Live usage tracker */}
                    <UsageTracker usageStats={usageStats} borderColor={borderColor} textDim={textDim} />

                    {/* Project status */}
                    <div className="flex items-center gap-1.5">
                        <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                                backgroundColor: projectRoot ? '#22c55e' : '#f59e0b',
                                boxShadow: projectRoot ? '0 0 6px #22c55e80' : '0 0 6px #f59e0b80',
                            }}
                        />
                        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textDim }}>
                            {projectRoot ? 'project linked' : 'no project'}
                        </span>
                    </div>

                    {/* Abort / Clear controls */}
                    {isRunning && (
                        <button
                            onClick={abort}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] uppercase tracking-wider transition-all"
                            style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: '#f87171' }}
                        >
                            <StopCircle size={11} /> Abort
                        </button>
                    )}
                    {logs.length > 0 && !isRunning && (
                        <button
                            onClick={clearLogs}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] uppercase tracking-wider transition-all hover:opacity-80"
                            style={{ color: textDim }}
                        >
                            <Trash2 size={11} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Agent Grid + Terminal ── */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Grid */}
                <div
                    className="overflow-y-auto px-5 py-5"
                    style={{ flex: showTerminal ? '0 0 auto' : '1 1 0', maxHeight: showTerminal ? '55%' : '100%' }}
                >
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {COUNCIL.map((agent, i) => (
                            <motion.div
                                key={agent.key}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04, duration: 0.25 }}
                            >
                                <AgentCard
                                    agent={agent}
                                    isRunning={isRunning}
                                    isActive={activeTask === agent.key}
                                    onInitialize={handleInitialize}
                                    accentColor={accentColor}
                                    borderColor={borderColor}
                                    textPrimary={textPrimary}
                                    textSub={textSub}
                                    textDim={textDim}
                                />
                            </motion.div>
                        ))}
                    </div>

                    {/* No-project hint for file-based agents */}
                    {!projectRoot && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border"
                            style={{ borderColor: 'rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)' }}
                        >
                            <XCircle size={12} style={{ color: '#f59e0b' }} />
                            <span className="text-[11px]" style={{ color: '#f59e0b' }}>
                                Connect a project to enable file-based agents (Inquisitor, Forger, Architect).
                            </span>
                        </motion.div>
                    )}
                </div>

                {/* Terminal Output Panel */}
                <AnimatePresence>
                    {showTerminal && (
                        <motion.div
                            key="lab-terminal"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="flex-1 border-t overflow-hidden flex flex-col min-h-0"
                            style={{ borderColor }}
                        >
                            {/* Terminal header */}
                            <div
                                className="flex items-center justify-between px-5 py-2 border-b shrink-0"
                                style={{ background: headerBg, borderColor }}
                            >
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{
                                            backgroundColor: isRunning ? accentColor : '#52525b',
                                            boxShadow: isRunning ? `0 0 6px ${accentColor}80` : 'none',
                                        }}
                                    />
                                    <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: textDim }}>
                                        {isRunning ? `${activeTask} — processing` : 'output'}
                                    </span>
                                </div>
                                {streamBuffer && (
                                    <span className="text-[10px] font-mono animate-pulse" style={{ color: accentColor }}>
                                        streaming…
                                    </span>
                                )}
                            </div>

                            {/* TerminalLog */}
                            <div className="flex-1 overflow-hidden min-h-0">
                                <TerminalLog
                                    logs={logs}
                                    streamBuffer={streamBuffer}
                                    isRunning={isRunning}
                                    activeTask={activeTask}
                                    accentColor={accentColor}
                                    glare={glare}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}