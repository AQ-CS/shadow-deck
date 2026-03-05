// electron/store.js — Persistent JSON file storage for ShadowDeck
// Stores config (settings, API keys, profiles) and analysis history.
// Files live in Electron's userData directory (%APPDATA%/shadow-deck).

import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG = {
    mode: 'local',          // 'local' | 'cloud'
    activeProfile: 'beast', // 'beast' | 'operative' | 'cloud'
    apiKeys: {
        gemini: '',
        openai: '',
    },
    ui: {
        accentColor: '#14b8a6',
        background: 'pulse',
        glareShield: false,
    },
    incognito: false,
};

let userDataPath = '';
let configCache = null;
let historyCache = null;

function configPath() { return path.join(userDataPath, 'config.json'); }
function historyPath() { return path.join(userDataPath, 'history.json'); }

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

// ── Public API ────────────────────────────────────────────────

export function initStore(dataPath) {
    userDataPath = dataPath;
    console.log(`[STORE] Data directory: ${userDataPath}`);
    configCache = readJSON(configPath(), { ...DEFAULT_CONFIG });
    historyCache = readJSON(historyPath(), []);
}

export function getConfig() {
    if (!configCache) configCache = readJSON(configPath(), { ...DEFAULT_CONFIG });
    const localCache = configCache || {};
    // Merge with defaults to fill any missing keys from older configs
    return { ...DEFAULT_CONFIG, ...localCache, apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(localCache?.apiKeys || {}) }, ui: { ...DEFAULT_CONFIG.ui, ...(localCache?.ui || {}) } };
}

export function setConfig(patch) {
    const current = getConfig();
    // Deep merge for nested objects
    if (patch.apiKeys) patch.apiKeys = { ...current.apiKeys, ...patch.apiKeys };
    if (patch.ui) patch.ui = { ...current.ui, ...patch.ui };
    configCache = { ...current, ...patch };
    writeJSON(configPath(), configCache);
    return configCache;
}

export function getHistory() {
    if (!historyCache) historyCache = readJSON(historyPath(), []);
    return historyCache || [];
}

export function saveSession(sessionData) {
    if (!historyCache) historyCache = readJSON(historyPath(), []);
    if (!historyCache) historyCache = [];

    // Find if session already exists
    const existingIndex = historyCache.findIndex(s => s.id === sessionData.id);

    const record = {
        ...sessionData,
        timestamp: sessionData.timestamp || new Date().toISOString(),
    };

    if (existingIndex >= 0) {
        historyCache[existingIndex] = record;
    } else {
        historyCache.unshift(record); // Add to beginning (newest first)
    }

    // Keep max 50 sessions to prevent unbounded growth
    if (historyCache.length > 50) historyCache = historyCache.slice(0, 50);
    writeJSON(historyPath(), historyCache);
    return record;
}

export function clearHistory() {
    historyCache = [];
    // Ensure synchronous write to prevent data loss on crash
    try { writeJSON(historyPath(), historyCache); } catch (err) { console.error(err); }
}