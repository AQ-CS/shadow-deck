// src/components/Views/Laboratory.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  THE LABORATORY — Agent Prompt Editor
//
//  FIX #5: Phase 1 gutted prompts.js down to 3 agents (Inquisitor, Herald,
//  Lawyer). This file previously tried to import and render 9 agents —
//  the missing exports caused silent crashes. Fixed by:
//    1. Removing all imports for non-existent agent systems.
//    2. Updating AGENT_META to only list the 3 surviving agents.
//    3. Updating DEFAULT_PROMPTS to only map those 3 keys.
//
//  Layout:
//    ┌─────────────────────────────────────────────────────┐
//    │  LEFT RAIL: Agent list cards                        │
//    ├─────────────────────────────────────────────────────┤
//    │  RIGHT PANEL: Active prompt textarea + controls     │
//    └─────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Save, RotateCcw, Copy, Check, FlaskConical,
    AlertTriangle, CheckCircle2, Info, ChevronRight,
} from 'lucide-react';
import {
    AGENT_TYPES,
    AGENT_DESCRIPTIONS,
    INQUISITOR_SYSTEM,
    HERALD_SYSTEM,
    LAWYER_SYSTEM,
} from '../../agents/prompts';

const BRIDGE = 'http://localhost:9090';

// ── Default prompts indexed by agent key ─────────────────────────────────────
// FIX #5: Only map the 3 agents that actually exist in prompts.js.
// The old DEFAULT_PROMPTS had 9 entries pointing to undefined exports.
const DEFAULT_PROMPTS = {
    [AGENT_TYPES.INQUISITOR]: INQUISITOR_SYSTEM,
    [AGENT_TYPES.HERALD]: HERALD_SYSTEM,
    [AGENT_TYPES.LAWYER]: LAWYER_SYSTEM,
};

// FIX #5: Trimmed from 9 agents to 3. The old array referenced AGENT_TYPES
// keys that no longer exist (WRAITH, ARCHITECT, ARTIST, GHOST, SENTINEL, SCRIBE),
// causing the UI to map over undefined properties and crash silently.
const AGENT_META = [
    {
        key: AGENT_TYPES.INQUISITOR,
        label: 'Inquisitor',
        icon: '🔎',
        color: '#f97316',
        model: 'deepseek-r1:14b',
    },
    {
        key: AGENT_TYPES.HERALD,
        label: 'Herald',
        icon: '📣',
        color: '#38bdf8',
        model: 'qwen3.5:9b',
    },
    {
        key: AGENT_TYPES.LAWYER,
        label: 'Lawyer',
        icon: '⚖️',
        color: '#eab308',
        model: 'qwen3.5:9b',
    },
];

// ── Token estimator (rough: 1 token ≈ 4 chars) ───────────────────────────────
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

// Token budget indicator
function TokenBar({ tokens, accentColor }) {
    const WARN = 1200;
    const LIMIT = 2048;
    const pct = Math.min((tokens / LIMIT) * 100, 100);
    const color = tokens > LIMIT ? '#f43f5e' : tokens > WARN ? '#f59e0b' : '#22c55e';

    return (
        <div className="flex items-center gap-2">
            <div className="h-1 w-24 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-[10px] font-mono" style={{ color }}>
                ~{tokens.toLocaleString()} tokens
            </span>
            {tokens > LIMIT && (
                <span className="text-[10px] text-rose-400 font-semibold">⚠ exceeds 2k</span>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function Laboratory({
    accentColor = '#14b8a6',
    glare = false,
    config = {},
    onConfigChange,
}) {
    // Saved overrides come from the global config store
    const savedOverrides = config?.customPrompts || {};

    // Local editing state — keyed by agent
    const [drafts, setDrafts] = useState(() => ({ ...savedOverrides }));
    const [activeKey, setActiveKey] = useState(AGENT_TYPES.INQUISITOR);
    const [saveState, setSaveState] = useState('idle');   // 'idle' | 'saving' | 'saved' | 'error'
    const [copied, setCopied] = useState(false);
    const [showDiff, setShowDiff] = useState(false);

    // Sync if config loads async
    useEffect(() => {
        if (config?.customPrompts) {
            setDrafts(prev => ({ ...config.customPrompts, ...prev }));
        }
    }, []);

    // ── Active agent data ─────────────────────────────────────────────────────
    const activeMeta = AGENT_META.find(a => a.key === activeKey) || AGENT_META[0];
    const defaultPrompt = DEFAULT_PROMPTS[activeKey] || '';
    const currentDraft = drafts[activeKey] ?? defaultPrompt;
    const isModified = currentDraft !== defaultPrompt;
    const tokens = useMemo(() => estimateTokens(currentDraft), [currentDraft]);

    // ── Edit ──────────────────────────────────────────────────────────────────
    const handleEdit = useCallback((value) => {
        setDrafts(prev => ({ ...prev, [activeKey]: value }));
        setSaveState('idle');
    }, [activeKey]);

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = useCallback(async () => {
        setSaveState('saving');
        try {
            // Merge into existing config — only store overrides that differ from default
            const overrides = {};
            for (const [key, val] of Object.entries(drafts)) {
                if (val !== DEFAULT_PROMPTS[key]) overrides[key] = val;
            }
            await onConfigChange?.({ customPrompts: overrides });
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 2500);
        } catch {
            setSaveState('error');
            setTimeout(() => setSaveState('idle'), 3000);
        }
    }, [drafts, onConfigChange]);

    // ── Reset single agent ────────────────────────────────────────────────────
    const handleReset = useCallback(() => {
        setDrafts(prev => {
            const next = { ...prev };
            delete next[activeKey];
            return next;
        });
        setSaveState('idle');
    }, [activeKey]);

    // ── Reset all agents ──────────────────────────────────────────────────────
    const handleResetAll = useCallback(async () => {
        setDrafts({});
        await onConfigChange?.({ customPrompts: {} });
        setSaveState('idle');
    }, [onConfigChange]);

    // ── Copy prompt ───────────────────────────────────────────────────────────
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(currentDraft);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [currentDraft]);

    // ── Colour tokens ─────────────────────────────────────────────────────────
    const panelBg = glare ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.55)';
    const headerBg = glare ? 'rgba(0,0,0,0.90)' : 'rgba(0,0,0,0.70)';
    const textPrimary = glare ? '#ffffff' : '#e4e4e7';
    const textSub = glare ? '#a1a1aa' : '#71717a';
    const borderColor = 'rgba(255,255,255,0.06)';
    const accentDim = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
    const accentBorder = `color-mix(in srgb, ${accentColor} 30%, transparent)`;

    // Count how many agents have custom prompts
    const modifiedCount = Object.keys(savedOverrides).length;

    return (
        <div className="w-full h-full flex overflow-hidden" style={{ background: panelBg }}>

            {/* ── LEFT RAIL: Agent list ── */}
            <div
                className="w-56 shrink-0 flex flex-col border-r overflow-hidden"
                style={{ borderColor, background: headerBg }}
            >
                {/* Header */}
                <div
                    className="flex items-center gap-2 px-4 py-3 shrink-0 border-b"
                    style={{ borderColor }}
                >
                    <FlaskConical size={13} style={{ color: textSub }} />
                    <span className="text-xs tracking-[0.25em] uppercase font-semibold" style={{ color: textSub }}>
                        Council
                    </span>
                    {modifiedCount > 0 && (
                        <span
                            className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: accentDim, color: accentColor, border: `1px solid ${accentBorder}` }}
                        >
                            {modifiedCount} edited
                        </span>
                    )}
                </div>

                {/* Agent list — FIX #5: Now correctly maps only 3 agents */}
                <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
                    {AGENT_META.map(({ key, label, icon, color }) => {
                        const isActive = key === activeKey;
                        const hasOverride = drafts[key] !== undefined && drafts[key] !== DEFAULT_PROMPTS[key];

                        return (
                            <button
                                key={key}
                                onClick={() => setActiveKey(key)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                                style={{
                                    background: isActive ? `color-mix(in srgb, ${color} 14%, rgba(0,0,0,0.4))` : 'transparent',
                                    border: `1px solid ${isActive ? `color-mix(in srgb, ${color} 35%, transparent)` : 'rgba(255,255,255,0.04)'}`,
                                }}
                            >
                                <span style={{ fontSize: 16 }}>{icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div
                                        className="text-xs font-semibold tracking-wider uppercase"
                                        style={{ color: isActive ? color : textSub }}
                                    >
                                        {label}
                                    </div>
                                    <div className="text-[10px] mt-0.5 truncate" style={{ color: isActive ? `${color}99` : '#3f3f46' }}>
                                        {AGENT_DESCRIPTIONS[key]?.slice(0, 36)}…
                                    </div>
                                </div>
                                {/* Dot indicator for modified prompts */}
                                {hasOverride && (
                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Reset all */}
                {modifiedCount > 0 && (
                    <div className="px-3 py-3 shrink-0 border-t" style={{ borderColor }}>
                        <button
                            onClick={handleResetAll}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] uppercase tracking-wider transition-all hover:opacity-80"
                            style={{
                                background: 'rgba(244,63,94,0.08)',
                                border: '1px solid rgba(244,63,94,0.25)',
                                color: '#f87171',
                            }}
                        >
                            <RotateCcw size={10} />
                            Reset all to defaults
                        </button>
                    </div>
                )}
            </div>

            {/* ── RIGHT PANEL: Prompt editor ── */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">

                {/* Editor header */}
                <div
                    className="flex items-center justify-between gap-3 px-4 py-2.5 shrink-0 border-b"
                    style={{ background: headerBg, borderColor }}
                >
                    {/* Agent identity */}
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span style={{ fontSize: 18 }}>{activeMeta.icon}</span>
                        <div>
                            <div className="text-sm font-bold tracking-wider uppercase" style={{ color: activeMeta.color }}>
                                {activeMeta.label}
                            </div>
                            <div className="text-[10px] font-mono" style={{ color: textSub }}>
                                {activeMeta.model}
                            </div>
                        </div>
                        {isModified && (
                            <span
                                className="text-[10px] px-2 py-0.5 rounded font-semibold ml-1"
                                style={{ background: `color-mix(in srgb, ${activeMeta.color} 12%, transparent)`, color: activeMeta.color, border: `1px solid color-mix(in srgb, ${activeMeta.color} 30%, transparent)` }}
                            >
                                modified
                            </span>
                        )}
                    </div>

                    {/* Right controls */}
                    <div className="flex items-center gap-2 shrink-0">
                        <TokenBar tokens={tokens} accentColor={accentColor} />

                        {/* Diff toggle */}
                        {isModified && (
                            <button
                                onClick={() => setShowDiff(v => !v)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] uppercase tracking-wider transition-all hover:opacity-80"
                                style={{
                                    background: showDiff ? accentDim : 'transparent',
                                    border: `1px solid ${showDiff ? accentBorder : borderColor}`,
                                    color: showDiff ? accentColor : textSub,
                                }}
                            >
                                <ChevronRight size={11} style={{ transform: showDiff ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                                Diff
                            </button>
                        )}

                        {/* Copy */}
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] uppercase tracking-wider transition-all hover:opacity-80"
                            style={{ background: 'transparent', border: `1px solid ${borderColor}`, color: textSub }}
                        >
                            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                        </button>

                        {/* Reset agent */}
                        {isModified && (
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] uppercase tracking-wider transition-all hover:opacity-80"
                                style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#f87171' }}
                            >
                                <RotateCcw size={11} />
                                Reset
                            </button>
                        )}

                        {/* Save */}
                        <button
                            onClick={handleSave}
                            disabled={saveState === 'saving'}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-50"
                            style={{
                                background: saveState === 'saved' ? 'rgba(34,197,94,0.15)' : saveState === 'error' ? 'rgba(244,63,94,0.15)' : accentDim,
                                border: `1px solid ${saveState === 'saved' ? 'rgba(34,197,94,0.35)' : saveState === 'error' ? 'rgba(244,63,94,0.35)' : accentBorder}`,
                                color: saveState === 'saved' ? '#4ade80' : saveState === 'error' ? '#f87171' : accentColor,
                            }}
                        >
                            {saveState === 'saving' ? (
                                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                                    <Save size={11} />
                                </motion.div>
                            ) : saveState === 'saved' ? (
                                <><CheckCircle2 size={11} /> Saved</>
                            ) : saveState === 'error' ? (
                                <><AlertTriangle size={11} /> Error</>
                            ) : (
                                <><Save size={11} /> Save</>
                            )}
                        </button>
                    </div>
                </div>

                {/* Diff view */}
                <AnimatePresence>
                    {showDiff && isModified && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 180, opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="shrink-0 overflow-hidden border-b"
                            style={{ borderColor }}
                        >
                            <div className="h-full grid grid-cols-2 divide-x" style={{ borderColor: borderColor }}>
                                {/* Default */}
                                <div className="flex flex-col overflow-hidden">
                                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest shrink-0" style={{ color: '#52525b', borderBottom: `1px solid ${borderColor}` }}>
                                        Default
                                    </div>
                                    <div
                                        className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
                                        style={{ color: '#52525b' }}
                                    >
                                        {defaultPrompt}
                                    </div>
                                </div>
                                {/* Custom */}
                                <div className="flex flex-col overflow-hidden">
                                    <div
                                        className="px-3 py-1.5 text-[10px] uppercase tracking-widest shrink-0"
                                        style={{ color: activeMeta.color, borderBottom: `1px solid ${borderColor}` }}
                                    >
                                        Custom
                                    </div>
                                    <div
                                        className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
                                        style={{ color: textPrimary }}
                                    >
                                        {currentDraft}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Agent description hint */}
                <div
                    className="flex items-start gap-2 px-4 py-2.5 shrink-0 border-b"
                    style={{ background: 'rgba(255,255,255,0.015)', borderColor }}
                >
                    <Info size={11} style={{ color: textSub, marginTop: 1, shrink: 0 }} />
                    <p className="text-[11px] leading-relaxed" style={{ color: textSub }}>
                        {AGENT_DESCRIPTIONS[activeKey]}
                    </p>
                </div>

                {/* Main textarea */}
                <textarea
                    value={currentDraft}
                    onChange={e => handleEdit(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full p-5 text-[12px] font-mono resize-none outline-none leading-relaxed"
                    style={{
                        background: 'transparent',
                        color: textPrimary,
                        caretColor: activeMeta.color,
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.08) transparent',
                        tabSize: 2,
                    }}
                    placeholder="Enter the system prompt for this agent…"
                />

                {/* Footer hint */}
                <div
                    className="flex items-center justify-between px-4 py-2 shrink-0 border-t text-[10px] font-mono"
                    style={{ borderColor, color: '#3f3f46' }}
                >
                    <span>
                        Changes apply to the next chat session.
                        {!isModified && ' This agent is using the default prompt.'}
                    </span>
                    <span>{currentDraft.length.toLocaleString()} chars</span>
                </div>
            </div>
        </div>
    );
}