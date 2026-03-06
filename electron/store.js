// electron/store.js — Persistent JSON file storage for ShadowDeck
// ═══════════════════════════════════════════════════════════════════════════
//  v6: Two-Path API Engine + Token-Level Usage Tracking
//
//  CHANGES FROM v5:
//    - PURGED: legacy apiKeys (gemini, openai) from defaults and schema
//    - ADDED:  apiMode ('streamlined' | 'power') — controls routing in useChatEngine
//    - UPDATED: usage schema now tracks tokens (inTokens, outTokens) per provider
//    - UPDATED: incrementUsage now accepts (provider, inputTokens, outputTokens)
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD (local time). */
function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Schema Defaults ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    mode: 'hybrid',
    activeProfile: 'beast',

    // ── API Mode (Two-Path Toggle) ────────────────────────────────
    // 'streamlined' — single OpenRouter key routes all cloud agents
    // 'power'       — individual Groq, GitHub Models, Ollama keys
    apiMode: 'streamlined',

    // ── Multi-Provider BYOK Keys ─────────────────────────────────
    providers: {
        openrouterApiKey: '',                    // Streamlined — OpenRouter free tier
        groqApiKey: '',                          // Power — Groq 14,400 RPD free
        githubModelsApiKey: '',                  // Power — GitHub Models 50-150 RPD
        ollamaUrl: 'http://localhost:11434',     // Power — Local Ollama instance
    },

    // ── UI Preferences ───────────────────────────────────────────
    ui: {
        accentColor: '#14b8a6',
        background: 'pulse',
        glareShield: false,
    },

    // ── Privacy ──────────────────────────────────────────────────
    incognito: false,

    // ── Token-Level Usage (auto-reset at midnight) ────────────────
    usage: {
        groq: { requests: 0, inTokens: 0, outTokens: 0 },
        github: { requests: 0, inTokens: 0, outTokens: 0 },
        openrouter: { requests: 0, inTokens: 0, outTokens: 0 },
        usageResetDate: '',
    },
};

// ── Module State ──────────────────────────────────────────────────────────────

let userDataPath = '';
let configCache = null;
let historyCache = null;

function configPath() { return path.join(userDataPath, 'config.json'); }
function historyPath() { return path.join(userDataPath, 'history.json'); }

// ── JSON I/O ──────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (err) {
        console.error(`[STORE] Failed to read ${filePath}:`, err.message);
    }
    return fallback;
}

function writeJSON(filePath, data) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error(`[STORE] Failed to write ${filePath}:`, err.message);
    }
}

// ── Daily Usage Reset ─────────────────────────────────────────────────────────

function buildResetUsage(today) {
    return {
        groq: { requests: 0, inTokens: 0, outTokens: 0 },
        github: { requests: 0, inTokens: 0, outTokens: 0 },
        openrouter: { requests: 0, inTokens: 0, outTokens: 0 },
        usageResetDate: today,
    };
}

function applyUsageReset(config) {
    const today = getTodayDateStr();
    const storedDate = config.usage?.usageResetDate || '';
    if (storedDate === today) return config;

    console.log(`[STORE] 🔄 Daily usage reset: ${storedDate} → ${today}`);
    const updated = { ...config, usage: buildResetUsage(today) };
    writeJSON(configPath(), updated);
    configCache = updated;
    return updated;
}

// ── Deep Merge ────────────────────────────────────────────────────────────────

function deepMergeUsage(base, incoming) {
    const providers = ['groq', 'github', 'openrouter'];
    const merged = {};
    for (const p of providers) {
        merged[p] = {
            requests: (incoming?.[p]?.requests ?? base?.[p]?.requests ?? 0),
            inTokens: (incoming?.[p]?.inTokens ?? base?.[p]?.inTokens ?? 0),
            outTokens: (incoming?.[p]?.outTokens ?? base?.[p]?.outTokens ?? 0),
        };
    }
    merged.usageResetDate = incoming?.usageResetDate ?? base?.usageResetDate ?? '';
    return merged;
}

function deepMergeConfig(base, incoming) {
    return {
        ...base,
        ...incoming,
        // Strip any legacy apiKeys — they are intentionally absent
        apiKeys: undefined,
        providers: { ...base.providers, ...(incoming?.providers || {}) },
        ui: { ...base.ui, ...(incoming?.ui || {}) },
        usage: deepMergeUsage(
            base.usage || DEFAULT_CONFIG.usage,
            incoming?.usage || {}
        ),
    };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function initStore(dataPath) {
    userDataPath = dataPath;
    console.log(`[STORE] Data directory: ${userDataPath}`);
    configCache = readJSON(configPath(), { ...DEFAULT_CONFIG });
    historyCache = readJSON(historyPath(), []);
}

export function getConfig() {
    if (!configCache) configCache = readJSON(configPath(), { ...DEFAULT_CONFIG });
    let merged = deepMergeConfig(DEFAULT_CONFIG, configCache || {});
    merged = applyUsageReset(merged);
    return merged;
}

export function setConfig(patch) {
    const current = getConfig();
    const updated = deepMergeConfig(current, patch);
    configCache = updated;
    writeJSON(configPath(), configCache);
    return configCache;
}

// ── Usage Counter API ──────────────────────────────────────────────────────────
//
//  incrementUsage(provider, inputTokens, outputTokens)
//    provider     — 'groq' | 'github' | 'openrouter'
//    inputTokens  — prompt tokens from SSE usage chunk
//    outputTokens — completion tokens from SSE usage chunk
//
//  Called from useChatEngine after the final SSE chunk containing usage data.

export function incrementUsage(provider, inputTokens = 0, outputTokens = 0) {
    const config = getConfig();
    const usage = {
        groq: { ...config.usage.groq },
        github: { ...config.usage.github },
        openrouter: { ...config.usage.openrouter },
        usageResetDate: config.usage.usageResetDate,
    };

    const today = getTodayDateStr();
    if (usage.usageResetDate !== today) {
        Object.assign(usage, buildResetUsage(today));
    }

    if (['groq', 'github', 'openrouter'].includes(provider)) {
        usage[provider].requests = (usage[provider].requests || 0) + 1;
        usage[provider].inTokens = (usage[provider].inTokens || 0) + inputTokens;
        usage[provider].outTokens = (usage[provider].outTokens || 0) + outputTokens;
    }

    console.log(
        `[STORE] 📊 ${provider.toUpperCase()} — ` +
        `req: ${usage[provider]?.requests} | ` +
        `in: ${usage[provider]?.inTokens}t | ` +
        `out: ${usage[provider]?.outTokens}t`
    );

    return setConfig({ usage });
}

export function getUsage() {
    const config = getConfig();
    return config.usage || DEFAULT_CONFIG.usage;
}

// ── History API ────────────────────────────────────────────────────────────────

export function getHistory() {
    if (!historyCache) historyCache = readJSON(historyPath(), []);
    return historyCache || [];
}

export function saveSession(sessionData) {
    if (!historyCache) historyCache = readJSON(historyPath(), []);
    if (!historyCache) historyCache = [];

    const existingIndex = historyCache.findIndex(s => s.id === sessionData.id);
    const record = {
        ...sessionData,
        timestamp: sessionData.timestamp || new Date().toISOString(),
    };

    if (existingIndex >= 0) {
        historyCache[existingIndex] = record;
    } else {
        historyCache.unshift(record);
    }

    if (historyCache.length > 50) historyCache = historyCache.slice(0, 50);
    writeJSON(historyPath(), historyCache);
    return record;
}

// Legacy alias kept for bridge.js compatibility
export function appendHistory(entry) {
    return saveSession(entry);
}

export function clearHistory() {
    historyCache = [];
    try { writeJSON(historyPath(), historyCache); } catch (err) { console.error(err); }
}