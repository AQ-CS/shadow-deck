// src/components/PreFlightModal.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — Pre-Flight Modal  (v5.1: Hick's Law Edition)
//
//  UX PHILOSOPHY — Hick's Law applied:
//    Reaction time grows logarithmically with the number of choices.
//    Most users should be able to hit [ Execute ] in < 2 seconds.
//    We achieve this by surfacing only three pieces of information by
//    default: Who is acting, on what, and via which provider.
//    The Provider/Model dropdowns are deliberately hidden inside an
//    Advanced Options accordion — power users can override, but casual
//    users never encounter decision fatigue.
//
//  DEFAULT VIEW (what 95% of users will see):
//    ┌─────────────────────────────────────────┐
//    │  🔎 The Inquisitor  ·  Pre-Flight Check │
//    │  ─────────────────────────────────────  │
//    │  <agent description>                    │
//    │  ┌─────────────────────────────────┐    │
//    │  │ Scope: Active File              │    │
//    │  └─────────────────────────────────┘    │
//    │  ┌──────────────────────────────────┐   │
//    │  │  ⚡ Routing to Groq              │   │
//    │  │  llama-3.3-70b-versatile         │   │
//    │  └──────────────────────────────────┘   │
//    │  [ ⚙ Advanced Options ▾ ]              │
//    │                                         │
//    │  [ 🚀 Execute            ⌘↵ ]          │
//    └─────────────────────────────────────────┘
//
//  ADVANCED VIEW (revealed on accordion click):
//    Adds provider <select> with live usage bars + model <select>.
//    The accordion toggle is memoized — toggling never re-runs the
//    provider-config fetch or resets the selection state.
//
//  MISSING KEY GUARDRAIL:
//    On open, a single fetch reads /store/config. If the key required
//    by the currently selected provider is empty, the Execute button is
//    disabled and shows "⚠ Missing API Key in Settings". The check is
//    reactive: switching to a different provider re-evaluates instantly
//    from the already-fetched snapshot (no extra fetches needed).
//
//  PROPS:
//    isOpen      — boolean
//    agentKey    — keyof AGENT_TYPES
//    scopeLabel  — optional scope override string
//    scopeCount  — optional file count integer
//    usageStats  — { groq: {requests,inTokens,outTokens}, github: {...}, openrouter: {...} }
//    onExecute   — (provider: string, model: string) => void
//    onClose     — () => void
//    accentColor — hex string
//    glare       — boolean
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Rocket, AlertTriangle, ChevronDown,
    Zap, Cloud, Server, Activity, Settings2,
    FileCode, Globe, FileSearch
} from 'lucide-react';
import {
    AGENT_TYPES,
    AGENT_DESCRIPTIONS,
    AGENT_PROVIDER,
    AGENT_MODELS,
    AGENT_SCOPE_LABEL,
    PROVIDER_MODELS,
    PROVIDER_META,
    PROVIDER_LIMITS,
} from '../agents/prompts';

const BRIDGE = 'http://localhost:9090';

// ── Agent display metadata ─────────────────────────────────────────────────────

const AGENT_META = {
    [AGENT_TYPES.INQUISITOR]: { label: 'The Inquisitor', icon: '🔎', color: '#f97316' },
    [AGENT_TYPES.FORGER]: { label: 'The Forger', icon: '⚒️', color: '#22d3ee' },
    [AGENT_TYPES.HERALD]: { label: 'The Herald', icon: '📣', color: '#38bdf8' },
    [AGENT_TYPES.ARCHITECT]: { label: 'The Architect', icon: '🏗️', color: '#818cf8' },
    [AGENT_TYPES.VAULT_GUARD]: { label: 'The Vault Guard', icon: '🔒', color: '#4ade80' },
    [AGENT_TYPES.LAWYER]: { label: 'The Lawyer', icon: '⚖️', color: '#eab308' },
    [AGENT_TYPES.ORACLE]: { label: 'The Oracle', icon: '🔮', color: '#a855f7' },
};

const PROVIDER_ICONS = { groq: Zap, github: Cloud, ollama: Server };

// ── UsageBar ──────────────────────────────────────────────────────────────────
// Animated quota bar. Shown only inside the Advanced accordion.

const UsageBar = memo(function UsageBar({ used, limit, color }) {
    if (!isFinite(limit)) {
        return (
            <div className="flex items-center gap-2">
                <div className="h-1 w-16 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full w-full rounded-full opacity-30" style={{ backgroundColor: color }} />
                </div>
                <span className="text-[10px] font-mono" style={{ color }}>∞ local</span>
            </div>
        );
    }

    const pct = Math.min((used / limit) * 100, 100);
    const barColor = pct > 95 ? '#f43f5e' : pct > 80 ? '#f59e0b' : color;

    return (
        <div className="flex items-center gap-2">
            <div className="h-1 w-16 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{ backgroundColor: barColor }}
                />
            </div>
            <span className="text-[10px] font-mono" style={{ color: barColor }}>
                {used.toLocaleString()}/{limit >= 10000 ? `${(limit / 1000).toFixed(0)}k` : limit}
            </span>
            {pct > 95 && <AlertTriangle size={9} style={{ color: '#f43f5e' }} />}
        </div>
    );
});

// ── SelectDropdown ─────────────────────────────────────────────────────────────

const SelectDropdown = memo(function SelectDropdown({
    value, onChange, options, accentBorder, textPrimary, textDim, selectedColor,
}) {
    return (
        <div className="relative">
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-[12px] font-mono outline-none appearance-none cursor-pointer"
                style={{
                    background: 'rgba(0,0,0,0.85)',
                    border: `1px solid ${accentBorder || 'rgba(255,255,255,0.10)'}`,
                    color: selectedColor || textPrimary,
                    paddingRight: '32px',
                }}
            >
                {options.map(opt => (
                    <option
                        key={opt.value}
                        value={opt.value}
                        style={{ background: '#0a0a0a', color: textPrimary }}
                    >
                        {opt.label}
                    </option>
                ))}
            </select>
            <ChevronDown
                size={12}
                className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: textDim }}
            />
        </div>
    );
});

// ── RoutingBadge — the default "Routing to X" summary shown before Advanced ───

function RoutingBadge({ provider, model, agentColor, textDim }) {
    const meta = PROVIDER_META[provider] || PROVIDER_META.ollama;
    const Icon = PROVIDER_ICONS[provider] || Server;

    return (
        <div
            className="flex items-center justify-between px-4 py-3 rounded-xl border"
            style={{
                background: `color-mix(in srgb, ${meta.color} 6%, rgba(0,0,0,0.4))`,
                borderColor: meta.border,
            }}
        >
            <div className="flex items-center gap-2.5">
                <Icon size={13} style={{ color: meta.color }} />
                <div>
                    <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: textDim }}>
                        Auto-routing to
                    </div>
                    <div className="text-xs font-bold tracking-wide" style={{ color: meta.color }}>
                        {meta.label}
                    </div>
                </div>
            </div>
            <span
                className="text-[10px] font-mono text-right truncate max-w-[140px]"
                style={{ color: textDim }}
                title={model}
            >
                {model}
            </span>
        </div>
    );
}

// ── MissingKeyBanner — shown inside Advanced when the key is absent ────────────

function MissingKeyBanner({ provider, textDim }) {
    const meta = PROVIDER_META[provider] || {};
    const label = meta.label || provider;
    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg overflow-hidden"
            style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.30)' }}
        >
            <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: '#f87171' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: '#f87171' }}>
                No API key found for{' '}
                <span className="font-bold">{label}</span>.
                Add it in{' '}
                <span className="font-mono underline underline-offset-1">Settings → API Key Vault</span>
                {' '}or switch to a different provider below.
            </p>
        </motion.div>
    );
}

// ── HighUsageWarning — shown when GitHub is nearly exhausted ──────────────────

function HighUsageWarning({ pct }) {
    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg overflow-hidden"
            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)' }}
        >
            <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: '#fbbf24' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: '#fbbf24' }}>
                GitHub Models quota at <span className="font-bold">{pct}%</span>.
                Consider switching to Groq or Local via Advanced Options.
            </p>
        </motion.div>
    );
}


// ═══════════════════════════════════════════════════════════════════════════
//  PreFlightModal
// ═══════════════════════════════════════════════════════════════════════════

export function PreFlightModal({
    isOpen = false,
    agentKey = null,
    scopeLabel = null,
    scopeCount = null,
    usageStats = {},
    onExecute,
    onClose,
    accentColor = '#14b8a6',
    glare = false,
}) {
    // ── Resolved agent/provider defaults ──────────────────────────────────────
    const agentMeta = agentKey ? AGENT_META[agentKey] : null;
    const defaultProv = agentKey ? AGENT_PROVIDER[agentKey] : 'ollama';
    const defaultModel = agentKey ? AGENT_MODELS[agentKey] : '';
    const scopeText = scopeLabel ?? (agentKey ? AGENT_SCOPE_LABEL[agentKey] : '—');
    const description = agentKey ? AGENT_DESCRIPTIONS[agentKey] : '';

    // ── Local state ────────────────────────────────────────────────────────────
    // showAdvanced is deliberately NOT reset on provider change — the user
    // should be able to keep the accordion open while tweaking their selection.
    const [selectedProvider, setSelectedProvider] = useState(defaultProv);
    const [selectedModel, setSelectedModel] = useState(defaultModel);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // ── Scope selection state ────────────────────────────────────────────────
    const [scopeMode, setScopeMode] = useState('file'); // 'file' or 'project'
    const [selectedFile, setSelectedFile] = useState(null); // { path, name }
    const [isPickingFile, setIsPickingFile] = useState(false);

    // ── Provider config snapshot (fetched once per modal open) ────────────────
    // We fetch on open — not on every render — so there are no waterfalls.
    // The snapshot is sufficient for key validation; it never needs to be live
    // because the user can't edit Settings while this modal is open.
    const [providerKeys, setProviderKeys] = useState({
        groqApiKey: null,           // null = not yet fetched; '' = fetched but empty
        githubModelsApiKey: null,
        ollamaUrl: null,
    });

    useEffect(() => {
        if (!isOpen) return;

        // Reset UI state on each fresh open
        const prov = agentKey ? AGENT_PROVIDER[agentKey] : 'ollama';
        const model = agentKey ? AGENT_MODELS[agentKey] : '';
        setSelectedProvider(prov);
        setSelectedModel(model);
        setShowAdvanced(false);
        setScopeMode('file');
        setSelectedFile(null);
        // Reset key snapshot so stale data doesn't flash during next open
        setProviderKeys({ groqApiKey: null, githubModelsApiKey: null, ollamaUrl: null });

        // Fetch current key config (one request per modal open)
        fetch(`${BRIDGE}/store/config`, { cache: 'no-store' })
            .then(r => r.json())
            .then(cfg => {
                setProviderKeys({
                    groqApiKey: cfg.providers?.groqApiKey ?? '',
                    githubModelsApiKey: cfg.providers?.githubModelsApiKey ?? '',
                    ollamaUrl: cfg.providers?.ollamaUrl ?? 'http://localhost:11434',
                });
            })
            .catch(() => {
                // If the bridge is offline, assume keys are present to avoid
                // false-positive blocking. The actual dispatch will surface the error.
                setProviderKeys({ groqApiKey: '?', githubModelsApiKey: '?', ollamaUrl: '?' });
            });
    }, [isOpen, agentKey]);

    // ── Provider change: reset model to provider's first available option ──────
    const handleProviderChange = useCallback((prov) => {
        setSelectedProvider(prov);
        setSelectedModel(PROVIDER_MODELS[prov]?.[0] || '');
    }, []);

    // ── Key validation (derived — no extra state needed) ──────────────────────
    // null means the fetch hasn't returned yet → don't block (optimistic).
    const isMissingKey = useMemo(() => {
        if (selectedProvider === 'ollama') return false;   // local needs no key

        // Still loading? Don't block.
        if (providerKeys.groqApiKey === null) return false;

        if (selectedProvider === 'groq') return !providerKeys.groqApiKey;
        if (selectedProvider === 'github') return !providerKeys.githubModelsApiKey;
        return false;
    }, [selectedProvider, providerKeys]);

    // ── Quota warnings (computed from usageStats) ─────────────────────────────
    const githubPct = useMemo(() => {
        const used = usageStats.githubDailyUsage || 0;
        const limit = PROVIDER_LIMITS.github;
        return Math.round((used / limit) * 100);
    }, [usageStats?.github?.requests]);

    const showGithubQuotaWarn = selectedProvider === 'github' && githubPct >= 80 && !isMissingKey;

    // ── Execute ───────────────────────────────────────────────────────────────
    const handleExecute = useCallback(() => {
        if (isMissingKey) return;
        if (scopeMode === 'file' && !selectedFile) return;
        onExecute?.(selectedProvider, selectedModel, { scopeMode, selectedFile });
        onClose?.();
    }, [isMissingKey, onExecute, onClose, selectedProvider, selectedModel, scopeMode, selectedFile]);

    // ── Keyboard shortcuts: ⌘↵ execute · Esc close ───────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => {
            if (e.key === 'Escape') { onClose?.(); return; }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExecute();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, handleExecute, onClose]);

    // ── Colour tokens ─────────────────────────────────────────────────────────
    const textPrimary = glare ? '#ffffff' : '#e4e4e7';
    const textSub = glare ? '#a1a1aa' : '#71717a';
    const textDim = glare ? '#71717a' : '#52525b';
    const borderColor = glare ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)';

    const provMeta = PROVIDER_META[selectedProvider] || PROVIDER_META.ollama;

    // ── Execute button appearance (3 states: normal / missing-key / ready) ────
    const execButtonStyle = useMemo(() => {
        if (isMissingKey) {
            return {
                background: 'rgba(244,63,94,0.10)',
                border: '1px solid rgba(244,63,94,0.35)',
                color: '#f87171',
                boxShadow: 'none',
                cursor: 'not-allowed',
                opacity: 0.85,
            };
        }
        if (!agentMeta) return {};
        return {
            background: `linear-gradient(135deg,
                color-mix(in srgb, ${agentMeta.color} 22%, transparent),
                color-mix(in srgb, ${agentMeta.color} 10%, transparent))`,
            border: `1px solid color-mix(in srgb, ${agentMeta.color} 45%, transparent)`,
            color: agentMeta.color,
            boxShadow: `0 0 18px color-mix(in srgb, ${agentMeta.color} 18%, transparent)`,
            cursor: 'pointer',
        };
    }, [isMissingKey, agentMeta]);

    return (
        <AnimatePresence>
            {isOpen && agentMeta && (
                <>
                    {/* ── Backdrop ── */}
                    <motion.div
                        key="preflight-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-40"
                        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
                        onClick={onClose}
                    />

                    {/* ── Modal centering wrapper ── */}
                    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
                        {/* ── Modal card ── */}
                        <motion.div
                            key="preflight-modal"
                            initial={{ opacity: 0, scale: 0.94, y: 14 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.94, y: 8 }}
                            transition={{ type: 'spring', stiffness: 390, damping: 34 }}
                            className="w-[420px] max-w-full pointer-events-auto"
                        >
                            <div
                                className="rounded-2xl overflow-hidden"
                                style={{
                                    background: glare ? 'rgba(0,0,0,0.98)' : 'rgba(6,6,10,0.98)',
                                    border: `1px solid ${borderColor}`,
                                    boxShadow: `0 0 0 1px rgba(255,255,255,0.04),
                                             0 24px 64px rgba(0,0,0,0.85),
                                             0 0 44px color-mix(in srgb, ${agentMeta.color} 10%, transparent)`,
                                }}
                            >

                                {/* ════ HEADER ════ */}
                                <div
                                    className="flex items-center justify-between px-5 py-4 border-b"
                                    style={{
                                        borderColor,
                                        background: `color-mix(in srgb, ${agentMeta.color} 7%, transparent)`,
                                    }}
                                >
                                    <div className="flex items-center gap-3">
                                        <span style={{ fontSize: 22 }}>{agentMeta.icon}</span>
                                        <div>
                                            <div
                                                className="text-sm font-bold tracking-wider uppercase"
                                                style={{ color: agentMeta.color }}
                                            >
                                                {agentMeta.label}
                                            </div>
                                            <div
                                                className="text-[10px] uppercase tracking-widest mt-0.5"
                                                style={{ color: textDim }}
                                            >
                                                Pre-Flight Check
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={onClose}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:bg-white/10"
                                        style={{ color: textDim }}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>

                                {/* ════ BODY ════ */}
                                <div className="px-5 py-5 space-y-4">

                                    {/* Agent description */}
                                    <p className="text-[11px] leading-relaxed" style={{ color: textSub }}>
                                        {description}
                                    </p>

                                    {/* ── Scope Selection ── */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase tracking-widest text-[#71717a] font-bold">Target Scope</span>
                                            <div className="flex gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
                                                <button
                                                    onClick={() => setScopeMode('file')}
                                                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${scopeMode === 'file' ? 'bg-white/10 text-white' : 'text-[#52525b] hover:text-[#71717a]'}`}
                                                >
                                                    File
                                                </button>
                                                <button
                                                    onClick={() => setScopeMode('project')}
                                                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${scopeMode === 'project' ? 'bg-white/10 text-white' : 'text-[#52525b] hover:text-[#71717a]'}`}
                                                >
                                                    Project
                                                </button>
                                            </div>
                                        </div>

                                        {scopeMode === 'file' ? (
                                            <motion.div
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="relative flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-black/40"
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <FileCode size={13} style={{ color: selectedFile ? agentMeta.color : '#52525b' }} />
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] uppercase tracking-widest mb-0.5 text-[#71717a]">
                                                            {selectedFile ? 'Selected File' : 'No file selected'}
                                                        </div>
                                                        <div className="text-xs font-mono truncate" style={{ color: selectedFile ? '#fff' : '#52525b' }}>
                                                            {selectedFile ? selectedFile.name : 'Choose a file to analyze...'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const { ipcRenderer } = window.require('electron');
                                                        setIsPickingFile(true);
                                                        const result = await ipcRenderer.invoke('dialog:openFile');
                                                        setIsPickingFile(false);
                                                        if (!result.canceled && result.filePaths.length > 0) {
                                                            const filePath = result.filePaths[0];
                                                            const fileName = filePath.split(/[\\/]/).pop();
                                                            setSelectedFile({ path: filePath, name: fileName });
                                                        }
                                                    }}
                                                    disabled={isPickingFile}
                                                    className="shrink-0 px-2 py-1 rounded border border-white/10 text-[9px] uppercase font-bold text-[#a1a1aa] hover:border-white/20 hover:text-white transition-all bg-white/5"
                                                >
                                                    {isPickingFile ? '...' : selectedFile ? 'Change' : 'Pick'}
                                                </button>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5"
                                            >
                                                <Globe size={13} style={{ color: '#22c55e' }} />
                                                <div>
                                                    <div className="text-[10px] uppercase tracking-widest mb-0.5 text-[#71717a]">
                                                        Context Mode
                                                    </div>
                                                    <div className="text-xs font-bold text-[#22c55e]">
                                                        Full Project Mapping
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </div>

                                    {/* ── DEFAULT: Routing badge ──────────────────────────────
                                    This is the only provider-related UI visible at first.
                                    Clicking Advanced reveals the full dropdowns. */}
                                    <RoutingBadge
                                        provider={selectedProvider}
                                        model={selectedModel}
                                        agentColor={agentMeta.color}
                                        textDim={textDim}
                                    />

                                    {/* ── ADVANCED OPTIONS ACCORDION ─────────────────────────
                                    A single boolean toggle controls visibility.
                                    AnimatePresence handles the height animation cleanly
                                    without needing to measure the DOM element. */}
                                    <div>
                                        <button
                                            onClick={() => setShowAdvanced(v => !v)}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-widest transition-all w-full"
                                            style={{
                                                background: showAdvanced
                                                    ? 'rgba(255,255,255,0.06)'
                                                    : 'transparent',
                                                border: `1px solid ${showAdvanced ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)'}`,
                                                color: textDim,
                                            }}
                                        >
                                            <Settings2 size={11} />
                                            <span className="flex-1 text-left">Advanced Options</span>
                                            <motion.div
                                                animate={{ rotate: showAdvanced ? 180 : 0 }}
                                                transition={{ duration: 0.2 }}
                                            >
                                                <ChevronDown size={11} />
                                            </motion.div>
                                        </button>

                                        <AnimatePresence initial={false}>
                                            {showAdvanced && (
                                                <motion.div
                                                    key="advanced-panel"
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="pt-3 space-y-3">

                                                        {/* Missing key banner (shown when key absent) */}
                                                        <AnimatePresence>
                                                            {isMissingKey && (
                                                                <MissingKeyBanner
                                                                    provider={selectedProvider}
                                                                    textDim={textDim}
                                                                />
                                                            )}
                                                        </AnimatePresence>

                                                        {/* Provider selector + usage bars */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <label
                                                                    className="text-[10px] uppercase tracking-widest"
                                                                    style={{ color: textDim }}
                                                                >
                                                                    Provider
                                                                </label>
                                                                {/* Compact usage readout inline with label */}
                                                                <div className="flex items-center gap-3">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Zap size={9} style={{ color: PROVIDER_META.groq.color }} />
                                                                        <UsageBar
                                                                            used={usageStats.groq?.requests || 0}
                                                                            limit={PROVIDER_LIMITS.groq}
                                                                            color={PROVIDER_META.groq.color}
                                                                        />
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Cloud size={9} style={{ color: PROVIDER_META.github.color }} />
                                                                        <UsageBar
                                                                            used={usageStats.github?.requests || 0}
                                                                            limit={PROVIDER_LIMITS.github}
                                                                            color={PROVIDER_META.github.color}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <SelectDropdown
                                                                value={selectedProvider}
                                                                onChange={handleProviderChange}
                                                                options={[
                                                                    { value: 'groq', label: '⚡ Groq   — 14,400 RPD / day' },
                                                                    { value: 'github', label: '☁  GitHub — 50 RPD / day' },
                                                                    { value: 'ollama', label: '⬡  Local  — Unlimited / offline' },
                                                                ]}
                                                                accentBorder={provMeta.border}
                                                                selectedColor={provMeta.color}
                                                                textPrimary={textPrimary}
                                                                textDim={textDim}
                                                            />
                                                        </div>

                                                        {/* Model selector */}
                                                        <div className="space-y-1.5">
                                                            <label
                                                                className="text-[10px] uppercase tracking-widest"
                                                                style={{ color: textDim }}
                                                            >
                                                                Model
                                                            </label>
                                                            <SelectDropdown
                                                                value={selectedModel}
                                                                onChange={setSelectedModel}
                                                                options={(PROVIDER_MODELS[selectedProvider] || []).map(m => ({
                                                                    value: m,
                                                                    label: m,
                                                                }))}
                                                                accentBorder={borderColor}
                                                                selectedColor={textPrimary}
                                                                textPrimary={textPrimary}
                                                                textDim={textDim}
                                                            />
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* High-usage warning (shown outside Advanced so it's always visible) */}
                                    <AnimatePresence>
                                        {showGithubQuotaWarn && (
                                            <HighUsageWarning pct={githubPct} />
                                        )}
                                    </AnimatePresence>

                                    {/* ════ EXECUTE BUTTON ════
                                    Three visual states:
                                      1. Normal  — agent accent color, glow
                                      2. Missing key — red, disabled, warning text
                                    The disabled prop prevents all click events;
                                    the cursor style reinforces this visually. */}
                                    <motion.button
                                        onClick={handleExecute}
                                        disabled={isMissingKey}
                                        whileHover={!isMissingKey ? { scale: 1.02 } : {}}
                                        whileTap={!isMissingKey ? { scale: 0.97 } : {}}
                                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-bold text-sm tracking-widest uppercase transition-all"
                                        style={execButtonStyle}
                                    >
                                        {isMissingKey ? (
                                            <>
                                                <AlertTriangle size={14} />
                                                Missing API Key in Settings
                                            </>
                                        ) : (
                                            <>
                                                <Rocket size={14} />
                                                Execute
                                                <span className="text-[10px] font-mono opacity-50 ml-1">
                                                    {/* navigator.platform is deprecated but still
                                                    the most reliable sync check in Electron */}
                                                    {typeof navigator !== 'undefined' &&
                                                        navigator.platform?.includes('Mac')
                                                        ? '⌘↵' : 'Ctrl+↵'}
                                                </span>
                                            </>
                                        )}
                                    </motion.button>

                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}