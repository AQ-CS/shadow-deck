// src/components/Views/Settings.jsx
// ═══════════════════════════════════════════════════════════════════════════
//  v6: Two-Path API Toggle (Streamlined / Power User) + Legacy Key Purge
//
//  CHANGES FROM v5.1:
//    - PURGED: All gemini/openai legacy key state and UI
//    - ADDED:  apiMode toggle ('streamlined' | 'power') at top of API Key Vault
//    - Streamlined: single openrouterApiKey input with helper link
//    - Power: groqApiKey + githubModelsApiKey + ollamaUrl inputs
//    - apiMode persisted to store via onConfigChange({ apiMode })
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    Shield, Key, Eye, EyeOff, Cpu, Cloud,
    Zap, Gauge, Trash2, Download, Server,
    ExternalLink, Layers, Wrench,
} from 'lucide-react';

// ── Electron shell (safe import) ──────────────────────────────────────────────

let _shell = null;
try { _shell = window.require('electron').shell; } catch { /* non-Electron env */ }

function openExternal(url) {
    if (_shell) {
        _shell.openExternal(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

const PROFILES = [
    {
        id: 'beast',
        label: 'The Beast',
        sub: 'Hybrid — Groq for speed, GitHub for depth, Local for privacy',
        icon: Zap,
        mode: 'hybrid',
    },
    {
        id: 'operative',
        label: 'The Operative',
        sub: 'Local-first — All agents routed through Ollama',
        icon: Gauge,
        mode: 'local',
    },
    {
        id: 'cloud',
        label: 'The Cloud',
        sub: 'Cloud-only — Groq + GitHub Models, no local models required',
        icon: Cloud,
        mode: 'cloud',
    },
];

const BACKGROUNDS = [
    { id: 'pulse', label: 'Pulse' },
    { id: 'interstellar', label: 'Interstellar' },
    { id: 'neon', label: 'Neon' },
    { id: 'sky', label: 'Sky' },
];

const COLOR_PRESETS = [
    '#14b8a6', '#22d3ee', '#34d399',
    '#8b5cf6', '#f43f5e', '#f59e0b', '#3b82f6',
];

// ── HelperLink ────────────────────────────────────────────────────────────────

function HelperLink({ helperText, helperUrl, textDim }) {
    if (!helperText || !helperUrl) return null;
    const displayUrl = helperUrl.replace(/^https?:\/\//, '');

    return (
        <div className="flex items-start gap-1.5 mt-2">
            <ExternalLink
                size={9}
                style={{ color: textDim, flexShrink: 0, marginTop: '2px' }}
            />
            <p className="text-[10px] leading-snug" style={{ color: textDim }}>
                {helperText}{' '}
                <button
                    onClick={() => openExternal(helperUrl)}
                    className="font-mono transition-colors"
                    style={{ color: textDim, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#a1a1aa'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = textDim; }}
                    title={`Open ${helperUrl}`}
                >
                    {displayUrl}
                </button>
            </p>
        </div>
    );
}

// ── KeyField ──────────────────────────────────────────────────────────────────

function KeyField({
    label,
    value,
    onChange,
    onSave,
    placeholder = '',
    type = 'password',
    helperText,
    helperUrl,
    accentColor,
    borderColor,
    textPrimary,
    textSub,
    textDim,
    accentDim,
    accentBorder,
}) {
    const [visible, setVisible] = useState(false);

    return (
        <div>
            <label
                className="block text-xs tracking-wider uppercase mb-1.5"
                style={{ color: textSub }}
            >
                {label}
            </label>

            <div className="flex gap-2">
                <div className="flex-1 relative">
                    <input
                        type={type === 'password' ? (visible ? 'text' : 'password') : 'text'}
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
                        placeholder={placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none"
                        style={{
                            background: 'rgba(0,0,0,0.75)',
                            border: `1px solid ${borderColor}`,
                            color: textPrimary,
                            caretColor: accentColor,
                            transition: 'border-color 0.15s',
                        }}
                        onFocus={e => {
                            e.currentTarget.style.borderColor =
                                `color-mix(in srgb, ${accentColor} 45%, transparent)`;
                        }}
                        onBlur={e => { e.currentTarget.style.borderColor = borderColor; }}
                    />
                    {type === 'password' && (
                        <button
                            onClick={() => setVisible(v => !v)}
                            tabIndex={-1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-80"
                            style={{ color: textDim }}
                            title={visible ? 'Hide' : 'Reveal'}
                        >
                            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                    )}
                </div>

                <button
                    onClick={onSave}
                    className="px-3 py-2 rounded-lg text-xs tracking-wider uppercase font-semibold transition-all hover:opacity-90 active:scale-95"
                    style={{ background: accentDim, border: `1px solid ${accentBorder}`, color: accentColor }}
                    title="Save"
                >
                    <Download size={12} />
                </button>
            </div>

            <HelperLink helperText={helperText} helperUrl={helperUrl} textDim={textDim} />
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Settings Component
// ═══════════════════════════════════════════════════════════════════════════

export function Settings({
    accentColor,
    onAccentChange,
    activeBg,
    onBgChange,
    glare = false,
    config = {},
    onConfigChange,
    incognito = false,
    onIncognitoChange,
    onClearHistory,
}) {
    // ── API Mode toggle ───────────────────────────────────────────────────────
    const [apiMode, setApiMode] = useState(config?.apiMode || 'streamlined');

    const handleApiModeChange = useCallback((mode) => {
        setApiMode(mode);
        onConfigChange({ apiMode: mode });
    }, [onConfigChange]);

    // ── Streamlined key state ─────────────────────────────────────────────────
    const [openrouterKey, setOpenrouterKey] = useState(config?.providers?.openrouterApiKey || '');

    // ── Power key state ───────────────────────────────────────────────────────
    const [groqKey, setGroqKey] = useState(config?.providers?.groqApiKey || '');
    const [githubKey, setGithubKey] = useState(config?.providers?.githubModelsApiKey || '');
    const [ollamaUrl, setOllamaUrl] = useState(config?.providers?.ollamaUrl || 'http://localhost:11434');

    const activeProfile = config?.activeProfile || 'beast';

    // ── Colour tokens ─────────────────────────────────────────────────────────
    const panelBg = glare ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.85)';
    const textPrimary = glare ? '#ffffff' : '#e4e4e7';
    const textSub = glare ? '#a1a1aa' : '#71717a';
    const textDim = glare ? '#71717a' : '#52525b';
    const borderColor = glare ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.10)';
    const accentDim = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
    const accentBorder = `color-mix(in srgb, ${accentColor} 30%, transparent)`;

    const sharedFieldProps = {
        accentColor, borderColor, textPrimary, textSub, textDim, accentDim, accentBorder,
    };

    const saveProviderKey = useCallback((key, value) => {
        onConfigChange({ providers: { [key]: value } });
    }, [onConfigChange]);

    const setProfile = useCallback((profileId) => {
        const profile = PROFILES.find(p => p.id === profileId);
        if (profile) onConfigChange({ activeProfile: profileId, mode: profile.mode });
    }, [onConfigChange]);

    return (
        <div
            className="w-full h-full overflow-y-auto"
            style={{ background: panelBg, backdropFilter: 'blur(24px)' }}
        >
            <div className="max-w-lg mx-auto px-8 py-8 space-y-10">

                {/* ══ ENGINE PROFILE ══════════════════════════════════════ */}
                <section>
                    <h3
                        className="text-xs tracking-[0.3em] uppercase mb-4 flex items-center gap-2"
                        style={{ color: textSub }}
                    >
                        <Cpu size={12} /> Engine Profile
                    </h3>
                    <div className="flex flex-col gap-2">
                        {PROFILES.map(({ id, label, sub, icon: Icon }) => {
                            const active = activeProfile === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => setProfile(id)}
                                    className="flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all"
                                    style={{
                                        borderColor: active ? accentBorder : borderColor,
                                        background: active ? accentDim : 'rgba(255,255,255,0.03)',
                                    }}
                                >
                                    {active && (
                                        <motion.div
                                            layoutId="profile-dot"
                                            className="w-1.5 h-1.5 rounded-full shrink-0"
                                            style={{ backgroundColor: accentColor }}
                                        />
                                    )}
                                    <Icon size={14} style={{ color: active ? accentColor : textDim }} />
                                    <div className="flex flex-col">
                                        <span
                                            className="text-xs tracking-wider uppercase font-semibold"
                                            style={{ color: active ? textPrimary : textSub }}
                                        >
                                            {label}
                                        </span>
                                        <span className="text-xs" style={{ color: textDim }}>{sub}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* ══ API KEY VAULT ════════════════════════════════════════ */}
                <section>
                    <h3
                        className="text-xs tracking-[0.3em] uppercase mb-2 flex items-center gap-2"
                        style={{ color: textSub }}
                    >
                        <Key size={12} /> API Key Vault
                    </h3>
                    <p className="text-xs mb-5 leading-relaxed" style={{ color: textDim }}>
                        Keys are stored in{' '}
                        <code
                            className="text-xs px-1 py-0.5 rounded"
                            style={{ background: 'rgba(255,255,255,0.08)', color: textSub }}
                        >
                            %APPDATA%/shadow-deck
                        </code>
                        {' '}— never transmitted externally. Strictly BYOK.
                    </p>

                    {/* ── API Mode Toggle Tabs ──────────────────────────────── */}
                    <div
                        className="flex rounded-xl overflow-hidden border mb-6"
                        style={{ borderColor, background: 'rgba(0,0,0,0.4)' }}
                    >
                        {/* Streamlined Tab */}
                        <button
                            onClick={() => handleApiModeChange('streamlined')}
                            className="flex-1 flex items-center justify-center gap-2.5 px-4 py-3.5 transition-all"
                            style={{
                                background: apiMode === 'streamlined' ? accentDim : 'transparent',
                                borderRight: `1px solid ${borderColor}`,
                            }}
                        >
                            <Layers
                                size={14}
                                style={{ color: apiMode === 'streamlined' ? accentColor : textDim }}
                            />
                            <div className="text-left">
                                <div
                                    className="text-xs font-bold tracking-wider uppercase"
                                    style={{ color: apiMode === 'streamlined' ? accentColor : textSub }}
                                >
                                    Streamlined
                                </div>
                                <div className="text-[10px] mt-0.5" style={{ color: textDim }}>
                                    One key · OpenRouter
                                </div>
                            </div>
                            {apiMode === 'streamlined' && (
                                <motion.div
                                    layoutId="api-mode-dot"
                                    className="w-1.5 h-1.5 rounded-full ml-auto shrink-0"
                                    style={{ backgroundColor: accentColor }}
                                />
                            )}
                        </button>

                        {/* Power User Tab */}
                        <button
                            onClick={() => handleApiModeChange('power')}
                            className="flex-1 flex items-center justify-center gap-2.5 px-4 py-3.5 transition-all"
                            style={{
                                background: apiMode === 'power' ? 'rgba(249,115,22,0.08)' : 'transparent',
                            }}
                        >
                            <Wrench
                                size={14}
                                style={{ color: apiMode === 'power' ? '#f97316' : textDim }}
                            />
                            <div className="text-left">
                                <div
                                    className="text-xs font-bold tracking-wider uppercase"
                                    style={{ color: apiMode === 'power' ? '#f97316' : textSub }}
                                >
                                    Power User
                                </div>
                                <div className="text-[10px] mt-0.5" style={{ color: textDim }}>
                                    Groq · GitHub · Ollama
                                </div>
                            </div>
                            {apiMode === 'power' && (
                                <motion.div
                                    layoutId="api-mode-dot"
                                    className="w-1.5 h-1.5 rounded-full ml-auto shrink-0"
                                    style={{ backgroundColor: '#f97316' }}
                                />
                            )}
                        </button>
                    </div>

                    {/* ── Streamlined Panel ─────────────────────────────────── */}
                    {apiMode === 'streamlined' && (
                        <motion.div
                            key="streamlined"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.18 }}
                        >
                            <div
                                className="p-4 rounded-xl border"
                                style={{ borderColor: `color-mix(in srgb, ${accentColor} 25%, transparent)`, background: `color-mix(in srgb, ${accentColor} 5%, rgba(0,0,0,0.4))` }}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Layers size={12} style={{ color: accentColor }} />
                                    <span className="text-xs font-bold tracking-wider uppercase" style={{ color: accentColor }}>
                                        OpenRouter
                                    </span>
                                    <span className="text-[10px] font-mono ml-auto" style={{ color: textDim }}>
                                        Free tier · all models
                                    </span>
                                </div>
                                <KeyField
                                    label="API Key"
                                    value={openrouterKey}
                                    onChange={setOpenrouterKey}
                                    onSave={() => saveProviderKey('openrouterApiKey', openrouterKey)}
                                    placeholder="sk-or-..."
                                    type="password"
                                    helperText="Get your free key at:"
                                    helperUrl="https://openrouter.ai/keys"
                                    {...sharedFieldProps}
                                />
                            </div>
                        </motion.div>
                    )}

                    {/* ── Power User Panel ──────────────────────────────────── */}
                    {apiMode === 'power' && (
                        <motion.div
                            key="power"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.18 }}
                            className="space-y-4"
                        >
                            {/* Groq */}
                            <div
                                className="p-4 rounded-xl border"
                                style={{ borderColor, background: 'rgba(34,197,94,0.04)' }}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap size={12} style={{ color: '#22c55e' }} />
                                    <span className="text-xs font-bold tracking-wider uppercase" style={{ color: '#22c55e' }}>
                                        Groq
                                    </span>
                                    <span className="text-[10px] font-mono ml-auto" style={{ color: textDim }}>
                                        14,400 RPD free
                                    </span>
                                </div>
                                <KeyField
                                    label="API Key"
                                    value={groqKey}
                                    onChange={setGroqKey}
                                    onSave={() => saveProviderKey('groqApiKey', groqKey)}
                                    placeholder="gsk_..."
                                    type="password"
                                    helperText="Get your free 14,400 RPD key at:"
                                    helperUrl="https://console.groq.com/keys"
                                    {...sharedFieldProps}
                                />
                            </div>

                            {/* GitHub Models */}
                            <div
                                className="p-4 rounded-xl border"
                                style={{ borderColor, background: 'rgba(167,139,250,0.04)' }}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Cloud size={12} style={{ color: '#a78bfa' }} />
                                    <span className="text-xs font-bold tracking-wider uppercase" style={{ color: '#a78bfa' }}>
                                        GitHub Models
                                    </span>
                                    <span className="text-[10px] font-mono ml-auto" style={{ color: textDim }}>
                                        50–150 RPD free
                                    </span>
                                </div>
                                <KeyField
                                    label="Personal Access Token"
                                    value={githubKey}
                                    onChange={setGithubKey}
                                    onSave={() => saveProviderKey('githubModelsApiKey', githubKey)}
                                    placeholder="ghp_..."
                                    type="password"
                                    helperText="Generate a classic Personal Access Token at:"
                                    helperUrl="https://github.com/settings/tokens"
                                    {...sharedFieldProps}
                                />
                            </div>

                            {/* Ollama */}
                            <div
                                className="p-4 rounded-xl border"
                                style={{ borderColor, background: 'rgba(249,115,22,0.04)' }}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Server size={12} style={{ color: '#f97316' }} />
                                    <span className="text-xs font-bold tracking-wider uppercase" style={{ color: '#f97316' }}>
                                        Local Ollama
                                    </span>
                                    <span className="text-[10px] font-mono ml-auto" style={{ color: textDim }}>
                                        Unlimited · offline
                                    </span>
                                </div>
                                <KeyField
                                    label="Server URL"
                                    value={ollamaUrl}
                                    onChange={setOllamaUrl}
                                    onSave={() => saveProviderKey('ollamaUrl', ollamaUrl)}
                                    placeholder="http://localhost:11434"
                                    type="url"
                                    helperText="Download the local engine at:"
                                    helperUrl="https://ollama.com/download"
                                    {...sharedFieldProps}
                                />
                            </div>
                        </motion.div>
                    )}
                </section>

                {/* ══ PRIVACY ══════════════════════════════════════════════ */}
                <section>
                    <h3
                        className="text-xs tracking-[0.3em] uppercase mb-4 flex items-center gap-2"
                        style={{ color: textSub }}
                    >
                        <Shield size={12} /> Privacy
                    </h3>

                    <div
                        className="flex items-center justify-between px-4 py-3 rounded-lg border"
                        style={{ borderColor, background: 'rgba(255,255,255,0.03)' }}
                    >
                        <div className="flex flex-col">
                            <span
                                className="text-xs tracking-wider uppercase font-semibold"
                                style={{ color: textPrimary }}
                            >
                                Incognito Mode
                            </span>
                            <span className="text-xs" style={{ color: textDim }}>
                                {incognito
                                    ? 'Logs only live in memory — nothing saved to disk.'
                                    : 'Analysis history is persisted to disk.'}
                            </span>
                        </div>
                        <button
                            onClick={() => onIncognitoChange(!incognito)}
                            className="relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4"
                            style={{
                                backgroundColor: incognito ? accentColor : 'rgba(255,255,255,0.12)',
                                boxShadow: incognito ? `0 0 10px ${accentColor}50` : 'none',
                            }}
                        >
                            <motion.div
                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
                                animate={{ left: incognito ? 22 : 2 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                    <button
                        onClick={onClearHistory}
                        className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-lg border text-left transition-all hover:border-red-500/40 hover:bg-red-500/10 group"
                        style={{ borderColor, background: 'rgba(255,255,255,0.03)' }}
                    >
                        <Trash2 size={12} className="text-zinc-300 group-hover:text-red-400 transition-colors" />
                        <span className="text-xs tracking-wider uppercase text-zinc-300 group-hover:text-red-400 transition-colors">
                            Clear All History
                        </span>
                    </button>
                </section>

                {/* ══ ACCENT COLOR ══════════════════════════════════════════ */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-3" style={{ color: textSub }}>
                        Accent Color
                    </h3>
                    <div className="flex flex-wrap gap-3">
                        {COLOR_PRESETS.map((hex) => (
                            <button
                                key={hex}
                                onClick={() => onAccentChange(hex)}
                                className="w-8 h-8 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                    backgroundColor: hex,
                                    borderColor: accentColor === hex ? '#fff' : 'transparent',
                                    boxShadow: accentColor === hex ? `0 0 14px ${hex}` : `0 0 6px ${hex}50`,
                                }}
                            />
                        ))}
                    </div>
                </section>

                {/* ══ BACKGROUND ════════════════════════════════════════════ */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-3" style={{ color: textSub }}>
                        Background
                    </h3>
                    <div className="flex flex-col gap-2">
                        {BACKGROUNDS.map(({ id, label }) => (
                            <button
                                key={id}
                                onClick={() => onBgChange(id)}
                                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-all"
                                style={{
                                    borderColor: activeBg === id ? accentBorder : borderColor,
                                    background: activeBg === id ? accentDim : 'rgba(255,255,255,0.03)',
                                }}
                            >
                                {activeBg === id && (
                                    <motion.div
                                        layoutId="settings-bg-dot"
                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{ backgroundColor: accentColor }}
                                    />
                                )}
                                <span
                                    className="text-xs tracking-widest uppercase"
                                    style={{ color: activeBg === id ? textPrimary : textSub }}
                                >
                                    {label}
                                </span>
                            </button>
                        ))}
                    </div>
                </section>

            </div>
        </div>
    );
}