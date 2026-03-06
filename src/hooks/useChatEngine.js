// src/hooks/useChatEngine.js
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — Multi-Provider Explicit Payload Router  (v6: Two-Path + Token Tracking)
//
//  PROVIDER ROUTING:
//    apiMode === 'streamlined':
//      All cloud agents → OpenRouter (https://openrouter.ai/api/v1/chat/completions)
//      Forced model: "openrouter/auto" (OpenRouter free routing)
//    apiMode === 'power':
//      'groq'   → Direct fetch to api.groq.com (OpenAI-compatible SSE)
//      'github' → Direct fetch to models.inference.ai.azure.com (OpenAI SSE)
//      'ollama' → Proxied through local bridge at /ai/generate (NDJSON)
//
//  TOKEN TRACKING:
//    stream_options: { include_usage: true } is injected into all OpenAI-compat
//    requests. The final SSE chunk containing chunk.usage is captured and passed
//    to persistIncrementUsage(provider, inputTokens, outputTokens).
//
//  API keys are ALWAYS read from the store via the bridge immediately before
//  each dispatch — never cached in module scope.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from 'react';
import { constructPrompt, AGENT_TYPES, AGENT_PROVIDER, AGENT_MODELS } from '../agents/prompts';
import { sanitizeContext } from '../utils/ContextManager';

const BRIDGE = 'http://localhost:9090';

// ── Provider Endpoints ────────────────────────────────────────────────────────

const PROVIDER_URLS = {
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    github: 'https://models.inference.ai.azure.com/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

// OpenRouter forces this model for all free-tier streamlined routing
const OPENROUTER_FREE_MODEL = 'openrouter/auto';

// ── Text Utilities ─────────────────────────────────────────────────────────────

/** Strip DeepSeek-R1 chain-of-thought tags before surfacing the output. */
function stripThinkTags(raw) {
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** Extract the outermost JSON object or array from a noisy string. */
function extractJSON(text) {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    const lastBrace = text.lastIndexOf('}');
    const lastBracket = text.lastIndexOf(']');

    let start = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
        start = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
        start = firstBrace;
    } else {
        start = firstBracket;
    }

    const end = Math.max(lastBrace, lastBracket);
    if (start === -1 || end === -1 || start > end) return text;
    return text.substring(start, end + 1);
}

// ── Bridge Helpers ─────────────────────────────────────────────────────────────

async function bridgeFetchFile(relativePath) {
    try {
        const res = await fetch(
            `${BRIDGE}/project/file?rel=${encodeURIComponent(relativePath)}`,
            { cache: 'no-store' }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data?.content ?? null;
    } catch {
        return null;
    }
}

async function bridgeFetchDiff(projectRoot) {
    try {
        const res = await fetch(`${BRIDGE}/git/diff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectPath: projectRoot }),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
            diff: (data.diff || '').trim(),
            diagnostics: data.diagnostics || {},
            truncated: data.truncated || false,
        };
    } catch (err) {
        return { diff: '', diagnostics: { error: err.message }, truncated: false };
    }
}

// ── Provider Config Loader ─────────────────────────────────────────────────────
// Always re-reads from the bridge immediately before dispatch.

async function fetchProviderConfig() {
    try {
        const res = await fetch(`${BRIDGE}/store/config`, { cache: 'no-store' });
        const config = await res.json();
        return {
            apiMode: config.apiMode || 'streamlined',
            openrouterApiKey: config.providers?.openrouterApiKey || '',
            groqApiKey: config.providers?.groqApiKey || '',
            githubModelsApiKey: config.providers?.githubModelsApiKey || '',
            ollamaUrl: config.providers?.ollamaUrl || 'http://localhost:11434',
            usage: config.usage || {},
        };
    } catch {
        return {
            apiMode: 'streamlined',
            openrouterApiKey: '', groqApiKey: '', githubModelsApiKey: '',
            ollamaUrl: 'http://localhost:11434',
            usage: {},
        };
    }
}

// ── Usage Counter — Token-Level ────────────────────────────────────────────────
// Called AFTER the SSE stream ends with the final usage chunk.
// provider     — 'groq' | 'github' | 'openrouter'
// inputTokens  — from chunk.usage.prompt_tokens
// outputTokens — from chunk.usage.completion_tokens

async function persistIncrementUsage(provider, inputTokens = 0, outputTokens = 0) {
    try {
        await fetch(`${BRIDGE}/store/usage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, inputTokens, outputTokens }),
        });
        // Re-fetch the updated config so we can surface fresh stats
        const res = await fetch(`${BRIDGE}/store/config`, { cache: 'no-store' });
        const config = await res.json();
        return config.usage || null;
    } catch {
        return null;
    }
}

// ── Streaming — Ollama (NDJSON via local bridge proxy) ────────────────────────

async function streamOllama({ system, user, model }, onChunk, signal, ollamaUrl) {
    const useProxy = !ollamaUrl || ollamaUrl === 'http://localhost:11434';
    const fetchUrl = useProxy ? `${BRIDGE}/ai/generate` : `${ollamaUrl}/api/chat`;

    const res = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            stream: true,
            options: { num_ctx: 8192, temperature: 0.1, repeat_penalty: 1.05 },
        }),
        signal,
    });

    if (!res.ok) throw new Error(`Ollama bridge responded ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('Ollama bridge returned empty response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const chunk = JSON.parse(line);
                const token = chunk.message?.content || chunk.response || '';
                if (token) { full += token; onChunk(token); }
            } catch { /* skip malformed NDJSON */ }
        }
    }

    return { text: full, inputTokens: 0, outputTokens: 0 };
}

// ── Streaming — OpenAI-compatible SSE (Groq / GitHub / OpenRouter) ─────────────
//
// stream_options.include_usage = true is mandatory.
// The final non-[DONE] chunk will carry chunk.usage — we capture it.

async function streamOpenAICompat({ baseURL, apiKey, model, messages, temperature = 0.1 }, onChunk, signal) {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let res;

    while (attempt <= MAX_RETRIES) {
        try {
            res = await fetch(baseURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: true,
                    temperature,
                    max_tokens: 4096,
                    stream_options: { include_usage: true },   // ← TOKEN TRACKING REQUIREMENT
                }),
                signal,
            });

            if (res.ok) break;

            if (res.status === 429) {
                if (attempt === MAX_RETRIES) throw new Error('Rate limit exceeded (429) - Max retries reached');
                const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
                onChunk(`\n[Rate limited. Retrying in ${(delay/1000).toFixed(1)}s...]`);
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
                continue;
            }

            const errText = await res.text();
            const hostname = new URL(baseURL).hostname;
            throw new Error(`${hostname} error ${res.status}: ${errText.slice(0, 300)}`);
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            if (attempt === MAX_RETRIES) throw err;
            if (!err.message.includes('Rate limit')) throw err;
            attempt++;
        }
    }

    if (!res || !res.ok) {
        throw new Error('Failed to fetch after retries');
    }
    if (!res.body) throw new Error('Provider returned empty response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
                const chunk = JSON.parse(data);

                // ── Token capture from final usage chunk ──────────────────
                if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens || 0;
                    outputTokens = chunk.usage.completion_tokens || 0;
                }

                const token = chunk.choices?.[0]?.delta?.content || '';
                if (token) { full += token; onChunk(token); }
            } catch { /* skip malformed SSE chunk */ }
        }
    }

    return { text: full, inputTokens, outputTokens };
}

// ── Unified Stream Router ──────────────────────────────────────────────────────
//
// In 'streamlined' mode, ALL cloud agents (groq, github) are redirected to
// OpenRouter with the free model. Ollama is always routed locally.

async function streamToProvider(
    { provider, model, system, user },
    providerConfig,
    onChunk,
    signal
) {
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];

    const { apiMode } = providerConfig;

    // ── Streamlined path: everything cloud → OpenRouter ────────────────────
    if (apiMode === 'streamlined' && provider !== 'ollama') {
        if (!providerConfig.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured. Go to Settings → API Key Vault → Streamlined.');
        }
        return streamOpenAICompat({
            baseURL: PROVIDER_URLS.openrouter,
            apiKey: providerConfig.openrouterApiKey,
            model: OPENROUTER_FREE_MODEL,
            messages,
        }, onChunk, signal).then(result => ({ ...result, resolvedProvider: 'openrouter' }));
    }

    // ── Power path: per-provider routing ──────────────────────────────────
    switch (provider) {
        case 'groq': {
            if (!providerConfig.groqApiKey) {
                throw new Error('Groq API key not configured. Go to Settings → API Key Vault.');
            }
            return streamOpenAICompat({
                baseURL: PROVIDER_URLS.groq,
                apiKey: providerConfig.groqApiKey,
                model, messages,
            }, onChunk, signal).then(result => ({ ...result, resolvedProvider: 'groq' }));
        }
        case 'github': {
            if (!providerConfig.githubModelsApiKey) {
                throw new Error('GitHub Models API key not configured. Go to Settings → API Key Vault.');
            }
            return streamOpenAICompat({
                baseURL: PROVIDER_URLS.github,
                apiKey: providerConfig.githubModelsApiKey,
                model, messages,
            }, onChunk, signal).then(result => ({ ...result, resolvedProvider: 'github' }));
        }
        case 'ollama':
        default: {
            return streamOllama(
                { system, user, model },
                onChunk, signal,
                providerConfig.ollamaUrl
            ).then(result => ({ ...result, resolvedProvider: 'ollama' }));
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//  Hook: useChatEngine  (Multi-Provider Explicit Payload Router)
// ═══════════════════════════════════════════════════════════════════════════

export function useChatEngine({ projectRoot = null, onBridgeError = null } = {}) {

    // ── State ──────────────────────────────────────────────────────────────────
    const [logs, setLogs] = useState([]);
    const [activeTask, setActiveTask] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [streamBuffer, setStreamBuffer] = useState('');
    const [usageStats, setUsageStats] = useState({
        groq: { requests: 0, inTokens: 0, outTokens: 0 },
        github: { requests: 0, inTokens: 0, outTokens: 0 },
        openrouter: { requests: 0, inTokens: 0, outTokens: 0 },
    });

    // ── Refs ───────────────────────────────────────────────────────────────────
    const abortRef = useRef(null);
    const rafRef = useRef(null);
    const streamRef = useRef('');
    let rafDirty = false;

    // ── Helpers ────────────────────────────────────────────────────────────────

    const pushLog = useCallback((type, message) => {
        setLogs(prev => [...prev, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            type: type.toUpperCase(),
            message,
        }]);
    }, []);

    const scheduleStreamFlush = useCallback(() => {
        if (rafDirty) return;
        rafDirty = true;
        rafRef.current = requestAnimationFrame(() => {
            rafDirty = false;
            setStreamBuffer(streamRef.current);
            rafRef.current = null;
        });
    }, []);

    // ── Abort ──────────────────────────────────────────────────────────────────
    const abort = useCallback(() => {
        abortRef.current?.abort();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setIsRunning(false);
        setActiveTask(null);
        setStreamBuffer('');
        streamRef.current = '';
        pushLog('WARNING', 'Task aborted by user.');
    }, [pushLog]);

    // ── Clear ──────────────────────────────────────────────────────────────────
    const clearLogs = useCallback(() => {
        abortRef.current?.abort();
        setLogs([]);
        setActiveTask(null);
        setIsRunning(false);
        setStreamBuffer('');
        streamRef.current = '';
    }, []);

    // ── Load Usage ─────────────────────────────────────────────────────────────
    const refreshUsage = useCallback(async () => {
        try {
            const pc = await fetchProviderConfig();
            if (pc.usage) setUsageStats(pc.usage);
        } catch { /* non-critical */ }
    }, []);

    // ══════════════════════════════════════════════════════════════════════════
    //  Core Dispatch
    // ══════════════════════════════════════════════════════════════════════════
    const dispatch = useCallback(async (agentType, payload = {}, overrides = {}) => {

        if (!Object.values(AGENT_TYPES).includes(agentType)) {
            pushLog('ERROR', `Unknown agent type: "${agentType}"`);
            return '';
        }

        abortRef.current?.abort();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        const controller = new AbortController();
        abortRef.current = controller;
        streamRef.current = '';

        setIsRunning(true);
        setActiveTask(agentType);
        setStreamBuffer('');

        const provider = overrides.provider || AGENT_PROVIDER[agentType];
        const model = overrides.model || AGENT_MODELS[agentType];

        try {
            // ── STAGE 0: Read live provider config ──────────────────────────
            const providerConfig = await fetchProviderConfig();

            // ── STAGE 1: Fetch / validate raw payload ───────────────────────
            let rawContent = '';
            let filename = 'unknown';

            switch (agentType) {

                case AGENT_TYPES.INQUISITOR:
                case AGENT_TYPES.FORGER:
                case AGENT_TYPES.ARCHITECT:
                case AGENT_TYPES.ORACLE:
                case AGENT_TYPES.OPTIMIZER: {
                    const scopeMode = payload.scopeMode || 'file';
                    const filePath = payload.filePath;

                    if (scopeMode === 'file') {
                        if (!filePath) {
                            pushLog('ERROR', `[${agentType}] No file selected for scope.`);
                            return '';
                        }
                        pushLog('INFO', `[${agentType}] Reading file: ${filePath}…`);
                        const fileData = await (async () => {
                            const res = await fetch(`${BRIDGE}/project/file?abs=${encodeURIComponent(filePath)}`, { cache: 'no-store' });
                            return await res.json();
                        })();

                        if (fileData.error) {
                            pushLog('ERROR', `[${agentType}] ${fileData.error}`);
                            return '';
                        }
                        rawContent = fileData.content;
                        filename = payload.fileName || filePath.split(/[\\/]/).pop();
                    } else {
                        // Project scope
                        if (!projectRoot) {
                            pushLog('ERROR', `[${agentType}] No project root set. Context restricted.`);
                            return '';
                        }
                        pushLog('INFO', `[${agentType}] Mapping project-wide context…`);
                        const treeRes = await fetch(`${BRIDGE}/project/tree`, { cache: 'no-store' });
                        const treeData = await treeRes.json();

                        // Build a concise project summary
                        const fileList = (treeData.entries || []).filter(e => e.type === 'file').map(e => e.rel).join('\n');
                        rawContent = `PROJECT REPO MAP:\n${fileList}\n\n(Note: Agent is currently operating with global project awareness but limited code depth for files not explicitly selected.)`;
                        filename = 'project-context';
                    }

                    pushLog('INFO', `[${agentType}] Processing ${filename}…`);
                    break;
                }

                case AGENT_TYPES.HERALD: {
                    if (!projectRoot) {
                        pushLog('ERROR', `[HERALD] No project root set. Connect a project first.`);
                        return '';
                    }
                    pushLog('INFO', `[HERALD] Fetching git diff for: ${projectRoot}`);
                    const diffResult = await bridgeFetchDiff(projectRoot);

                    if (!diffResult?.diff) {
                        pushLog('WARNING', `[HERALD] Working tree is clean — no changes to commit.`);
                        return '';
                    }

                    const lineCount = diffResult.diff.split('\n').length;
                    pushLog('INFO', `[HERALD] Diff ready — ${lineCount} lines. Generating commit message…`);

                    rawContent = diffResult.diff.length > 20000
                        ? `${diffResult.diff.substring(0, 20000)}\n\n... [DIFF TRUNCATED TO PROTECT CONTEXT WINDOW] ....`
                        : diffResult.diff;

                    filename = 'git-diff';
                    break;
                }

                case AGENT_TYPES.VAULT_GUARD: {
                    if (!projectRoot) {
                        pushLog('ERROR', `[VAULT_GUARD] No project root set. Connect a project first.`);
                        return '';
                    }
                    pushLog('INFO', `[VAULT_GUARD] 🔒 Running offline secret scan…`);

                    if (payload.content) {
                        rawContent = payload.content;
                        filename = payload.filePath || 'project';
                    } else {
                        const pkgContent = await bridgeFetchFile('package.json');
                        if (!pkgContent) {
                            pushLog('ERROR', `[VAULT_GUARD] No content to scan. Connect project or pass file content.`);
                            return '';
                        }
                        rawContent = pkgContent;
                        filename = 'package.json';
                    }
                    pushLog('INFO', `[VAULT_GUARD] Scanning ${filename} for secrets…`);
                    break;
                }

                case AGENT_TYPES.LAWYER: {
                    if (!projectRoot) {
                        pushLog('ERROR', `[LAWYER] No project root set. Connect a project first.`);
                        return '';
                    }
                    pushLog('INFO', `[LAWYER] Fetching package.json…`);
                    const pkgContent = await bridgeFetchFile('package.json');

                    if (!pkgContent) {
                        pushLog('ERROR', `[LAWYER] package.json not found in project root.`);
                        return '';
                    }
                    pushLog('INFO', `[LAWYER] package.json loaded — scanning licenses…`);
                    rawContent = pkgContent;
                    filename = 'package.json';
                    break;
                }

                default: {
                    pushLog('ERROR', `[${agentType}] No payload handler defined.`);
                    return '';
                }
            }

            // ── STAGE 2: Sanitize via ContextManager ────────────────────────
            let sanitized;
            try {
                sanitized = sanitizeContext(rawContent, filename, agentType);
            } catch (err) {
                pushLog('ERROR', `[${agentType}] Context rejected: ${err.message}`);
                return '';
            }

            // ── STAGE 3: Build stateless prompt ─────────────────────────────
            const promptPayload = constructPrompt(
                agentType, sanitized,
                { filename, projectRoot: projectRoot || undefined },
                { provider, model }
            );

            // Log routing info (resolves apiMode display)
            const effectiveProvider = providerConfig.apiMode === 'streamlined' && provider !== 'ollama'
                ? 'openrouter'
                : provider;
            const effectiveModel = providerConfig.apiMode === 'streamlined' && provider !== 'ollama'
                ? OPENROUTER_FREE_MODEL
                : model;

            const estimatedTokens = Math.round(
                (promptPayload.system.length + promptPayload.user.length) / 4
            );
            pushLog('INFO',
                `[${agentType}] ~${estimatedTokens.toLocaleString()} tokens → ` +
                `${effectiveProvider.toUpperCase()}/${effectiveModel}` +
                (providerConfig.apiMode === 'streamlined' ? ' [streamlined]' : '')
            );

            // ── STAGE 4: Stream from provider ────────────────────────────────
            const { text: rawResult, inputTokens, outputTokens, resolvedProvider } =
                await streamToProvider(
                    { provider, model, system: promptPayload.system, user: promptPayload.user },
                    providerConfig,
                    (token) => {
                        streamRef.current += token;
                        scheduleStreamFlush();
                    },
                    controller.signal,
                );

            // ── STAGE 4b: Increment usage counter with token counts ──────────
            if (resolvedProvider !== 'ollama') {
                const newUsage = await persistIncrementUsage(resolvedProvider, inputTokens, outputTokens);
                if (newUsage) {
                    setUsageStats(newUsage);
                }
                if (inputTokens || outputTokens) {
                    pushLog('INFO',
                        `[${agentType}] Tokens — prompt: ${inputTokens} | completion: ${outputTokens}`
                    );
                }
            }

            // ── STAGE 5: Parse and surface result ────────────────────────────
            const clean = stripThinkTags(rawResult);

            switch (agentType) {

                case AGENT_TYPES.INQUISITOR: {
                    // v6: output is now surgical patches, not JSON
                    if (clean.includes('INQUISITOR: CLEAN')) {
                        pushLog('SUCCESS', `[INQUISITOR] ${filename} → CLEAN`);
                    } else {
                        const patchCount = (clean.match(/^```\d+:\d+:/gm) || []).length;
                        pushLog('WARNING',
                            `[INQUISITOR] ${filename} → ${patchCount} patch(es) emitted. See stream above.`
                        );
                    }
                    break;
                }

                case AGENT_TYPES.FORGER: {
                    const lineCount = clean.split('\n').length;
                    pushLog('SUCCESS', `[FORGER] Test suite generated — ${lineCount} lines. Copy from stream above.`);
                    break;
                }

                case AGENT_TYPES.HERALD: {
                    const commitMsg = clean.split('\n')[0] || clean;
                    pushLog('SUCCESS', `[HERALD] Commit message ready:`);
                    pushLog('INFO', `[HERALD]   ${commitMsg}`);
                    break;
                }

                case AGENT_TYPES.ARCHITECT: {
                    const patchCount = (clean.match(/^```\d+:\d+:/gm) || []).length;
                    pushLog('SUCCESS',
                        `[ARCHITECT] Refactor complete — ${patchCount} patch(es) emitted. Copy from stream above.`
                    );
                    break;
                }

                case AGENT_TYPES.OPTIMIZER: {
                    if (clean.includes('OPTIMIZER: MAXIMUM EFFICIENCY ACHIEVED')) {
                        pushLog('SUCCESS', `[OPTIMIZER] ${filename} → MAXIMUM EFFICIENCY ACHIEVED`);
                    } else {
                        const patchCount = (clean.match(/^```\d+:\d+:/gm) || []).length;
                        pushLog('WARNING',
                            `[OPTIMIZER] ${filename} → ${patchCount} optimization patch(es) emitted. See stream above.`
                        );
                    }
                    break;
                }

                case AGENT_TYPES.VAULT_GUARD: {
                    try {
                        const findings = JSON.parse(extractJSON(clean));
                        if (!Array.isArray(findings) || findings.length === 0) {
                            pushLog('SUCCESS', `[VAULT_GUARD] ${filename} → CLEAR — no secrets detected`);
                        } else {
                            pushLog('WARNING', `[VAULT_GUARD] ${filename} → ${findings.length} finding(s) detected`);
                            for (const f of findings) {
                                pushLog(f.severity === 'CRITICAL' ? 'ERROR' : 'WARNING',
                                    `[VAULT_GUARD]   L${f.line} [${f.type}] ${f.finding}`);
                            }
                        }
                    } catch {
                        pushLog('WARNING', `[VAULT_GUARD] Response was not valid JSON. Raw output streamed above.`);
                    }
                    break;
                }

                case AGENT_TYPES.LAWYER: {
                    try {
                        if (clean.includes('"error"')) {
                            pushLog('ERROR', `[LAWYER] Invalid package.json — cannot audit.`);
                            break;
                        }
                        const risks = JSON.parse(extractJSON(clean));
                        if (!Array.isArray(risks) || risks.length === 0) {
                            pushLog('SUCCESS', `[LAWYER] package.json → CLEAR — no risky licenses detected`);
                        } else {
                            pushLog('WARNING', `[LAWYER] package.json → ${risks.length} risky license(s) detected`);
                            for (const dep of risks) {
                                pushLog(dep.risk === 'HIGH_RISK' ? 'ERROR' : 'WARNING',
                                    `[LAWYER]   ${dep.risk}: ${dep.license} in '${dep.name}' — ${dep.note}`);
                            }
                        }
                    } catch {
                        pushLog('WARNING', `[LAWYER] Response was not valid JSON. Raw output streamed above.`);
                    }
                    break;
                }
            }

            return clean;

        } catch (err) {
            if (err.name === 'AbortError') return '';
            pushLog('ERROR', `[${agentType}] ${err.message}`);
            onBridgeError?.(err);
            return '';

        } finally {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            setIsRunning(false);
            setActiveTask(null);
            setStreamBuffer('');
            streamRef.current = '';
        }

    }, [projectRoot, pushLog, onBridgeError, scheduleStreamFlush]);


    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        logs,
        isRunning,
        activeTask,
        streamBuffer,
        usageStats,

        dispatch,
        clearLogs,
        abort,
        pushLog,
        refreshUsage,

        // Bridge helpers for TaskQueueEngine
        bridgeFetchFile,
        bridgeFetchDiff,
    };
}