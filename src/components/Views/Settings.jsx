// src/components/Views/Settings.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
    Shield, Key, Eye, EyeOff, Cpu, Cloud,
    Zap, Gauge, Trash2, Download,
} from 'lucide-react';

// ── Profiles ─────────────────────────────────────────────────
const PROFILES = [
    {
        id: 'beast',
        label: 'The Beast',
        sub: 'Local — Largest models, deepest analysis',
        icon: Zap,
        mode: 'local',
    },
    {
        id: 'operative',
        label: 'The Operative',
        sub: 'Local — Fastest models, quick results',
        icon: Gauge,
        mode: 'local',
    },
    {
        id: 'cloud',
        label: 'The Cloud',
        sub: 'API-only — Gemini / OpenAI backends',
        icon: Cloud,
        mode: 'cloud',
    },
];

// ── Backgrounds ──────────────────────────────────────────────
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
    const [showGemini, setShowGemini] = useState(false);
    const [showOpenAI, setShowOpenAI] = useState(false);
    const [geminiKey, setGeminiKey] = useState(config?.apiKeys?.gemini || '');
    const [openaiKey, setOpenAIKey] = useState(config?.apiKeys?.openai || '');

    const activeProfile = config?.activeProfile || 'beast';

    // Glare-aware styling
    const panelBg = glare ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.45)';
    const textPrimary = glare ? '#ffffff' : '#e4e4e7';
    const textSub = glare ? '#a1a1aa' : '#71717a';
    const textDim = glare ? '#71717a' : '#52525b';
    const borderColor = glare ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
    const accentDim = `color-mix(in srgb, ${accentColor} 15%, transparent)`;
    const accentBorder = `color-mix(in srgb, ${accentColor} 30%, transparent)`;

    const saveKey = (provider, key) => {
        onConfigChange({ apiKeys: { [provider]: key } });
    };

    const setProfile = (profileId) => {
        const profile = PROFILES.find(p => p.id === profileId);
        if (profile) {
            onConfigChange({ activeProfile: profileId, mode: profile.mode });
        }
    };

    return (
        <div
            className="w-full h-full overflow-y-auto"
            style={{ background: panelBg, backdropFilter: 'blur(24px)' }}
        >
            <div className="max-w-lg mx-auto px-8 py-8 space-y-10">

                {/* ── Profiles ── */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-4 flex items-center gap-2" style={{ color: textSub }}>
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
                                        <span className="text-xs tracking-wider uppercase font-semibold" style={{ color: active ? textPrimary : textSub }}>
                                            {label}
                                        </span>
                                        <span className="text-xs" style={{ color: textDim }}>{sub}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* ── API Key Vault ── */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-4 flex items-center gap-2" style={{ color: textSub }}>
                        <Key size={12} /> API Key Vault
                    </h3>
                    <p className="text-xs mb-4 leading-relaxed" style={{ color: textDim }}>
                        Keys are stored locally in <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.08)', color: textSub }}>%APPDATA%</code> — never sent externally.
                    </p>

                    {/* Gemini Key */}
                    <div className="space-y-1.5 mb-4">
                        <label className="text-xs tracking-wider uppercase" style={{ color: textSub }}>Google Gemini</label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type={showGemini ? 'text' : 'password'}
                                    value={geminiKey}
                                    onChange={e => setGeminiKey(e.target.value)}
                                    placeholder="AIza..."
                                    className="w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none"
                                    style={{ background: 'rgba(0,0,0,0.5)', border: `1px solid ${borderColor}`, color: textPrimary }}
                                />
                                <button
                                    onClick={() => setShowGemini(!showGemini)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2"
                                    style={{ color: textDim }}
                                >
                                    {showGemini ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <button
                                onClick={() => saveKey('gemini', geminiKey)}
                                className="px-3 py-2 rounded-lg text-xs tracking-wider uppercase font-semibold transition-all"
                                style={{ background: accentDim, border: `1px solid ${accentBorder}`, color: accentColor }}
                            >
                                <Download size={12} />
                            </button>
                        </div>
                    </div>

                    {/* OpenAI Key */}
                    <div className="space-y-1.5">
                        <label className="text-xs tracking-wider uppercase" style={{ color: textSub }}>OpenAI</label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type={showOpenAI ? 'text' : 'password'}
                                    value={openaiKey}
                                    onChange={e => setOpenAIKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none"
                                    style={{ background: 'rgba(0,0,0,0.5)', border: `1px solid ${borderColor}`, color: textPrimary }}
                                />
                                <button
                                    onClick={() => setShowOpenAI(!showOpenAI)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2"
                                    style={{ color: textDim }}
                                >
                                    {showOpenAI ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <button
                                onClick={() => saveKey('openai', openaiKey)}
                                className="px-3 py-2 rounded-lg text-xs tracking-wider uppercase font-semibold transition-all"
                                style={{ background: accentDim, border: `1px solid ${accentBorder}`, color: accentColor }}
                            >
                                <Download size={12} />
                            </button>
                        </div>
                    </div>
                </section>

                {/* ── Privacy ── */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-4 flex items-center gap-2" style={{ color: textSub }}>
                        <Shield size={12} /> Privacy
                    </h3>

                    {/* Incognito Toggle */}
                    <div className="flex items-center justify-between px-4 py-3 rounded-lg border" style={{ borderColor, background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex flex-col">
                            <span className="text-xs tracking-wider uppercase font-semibold" style={{ color: textPrimary }}>
                                Incognito Mode
                            </span>
                            <span className="text-xs" style={{ color: textDim }}>
                                {incognito ? 'Logs only live in memory — nothing saved to disk.' : 'Analysis history is persisted to disk.'}
                            </span>
                        </div>
                        <button
                            onClick={() => onIncognitoChange(!incognito)}
                            className="relative w-10 h-5 rounded-full transition-colors"
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

                    {/* Clear History */}
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

                {/* ── Accent Color ── */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-3" style={{ color: textSub }}>Accent Color</h3>
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

                {/* ── Background ── */}
                <section>
                    <h3 className="text-xs tracking-[0.3em] uppercase mb-3" style={{ color: textSub }}>Background</h3>
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
