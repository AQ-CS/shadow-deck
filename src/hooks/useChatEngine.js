// src/hooks/useChatEngine.js
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — Explicit Payload Router  (v4: Surgical Strike Edition)
//
//  ARCHITECTURE: Zero chat history. Zero swarm. Zero intent routing.
//  This hook is a deterministic dispatch table:
//
//    dispatch(INQUISITOR, { filePath, content }) → streams JSON bug report
//    dispatch(HERALD,     { projectRoot })        → fetches diff, streams commit
//    dispatch(LAWYER,     { projectRoot })        → fetches pkg.json, streams risks
//
//  Each dispatch is fully stateless — a fresh [system, user] pair per call.
//  Context from the previous call is DROPPED before the next begins.
//  This guarantees we never blow out local VRAM or the Ollama context window.
//
//  Log format piped to TerminalLog:
//    [INQUISITOR] Scanning auth.js... DIRTY — 2 issue(s) found
//    [LAWYER] package.json... WARNING: GPL-3.0 detected in 'some-dep'
//    [HERALD] Generating commit message...
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from 'react';
import { constructPrompt, AGENT_TYPES } from '../agents/prompts';
import { sanitizeContext } from '../utils/ContextManager';

const BRIDGE = 'http://localhost:9090';

// ── Think-tag stripper ────────────────────────────────────────────────────────
// DeepSeek-R1 wraps its chain-of-thought in <think> tags. We strip them before
// delivering the final payload to the caller; they are reasoning internals, not output.
function stripThinkTags(raw) {
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

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

    let end = Math.max(lastBrace, lastBracket);

    if (start === -1 || end === -1 || start > end) return text;
    return text.substring(start, end + 1);
}

// ── Bridge helpers ────────────────────────────────────────────────────────────

/**
 * Fetch the content of a single project file via the bridge.
 * Returns the file content string, or null on failure.
 *
 * @param {string} relativePath  — e.g. "package.json" or "src/auth.js"
 * @returns {Promise<string|null>}
 */
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

/**
 * Fetch the current git diff for the active project.
 * Returns { diff, diagnostics, truncated } or null on failure.
 *
 * @param {string} projectRoot
 * @returns {Promise<{diff: string, diagnostics: object, truncated: boolean}|null>}
 */
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

/**
 * Stream a single stateless generation request to Ollama via the bridge.
 * Calls onChunk for every token chunk received.
 * Returns the full raw response string.
 *
 * @param {{ system: string, user: string, model: string }} promptPayload
 * @param {Function} onChunk   — (text: string) => void
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function streamGenerate(promptPayload, onChunk, signal) {
    const { system, user, model } = promptPayload;

    let res;
    try {
        res = await fetch(`${BRIDGE}/ai/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                stream: true,
                options: {
                    num_ctx: 8192,
                    temperature: 0.1,
                    repeat_penalty: 1.05,
                },
            }),
            signal,
        });
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }

    if (!res.ok) throw new Error(`Bridge responded ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('Bridge returned an empty response body');

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
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const chunk = JSON.parse(line);
                const token = chunk.message?.content || chunk.response || '';
                if (token) {
                    full += token;
                    onChunk(token);
                }
            } catch { /* skip malformed JSON chunk */ }
        }
    }

    return full;
}


// ═══════════════════════════════════════════════════════════════════════════
//  Hook: useChatEngine  (Explicit Payload Router)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {Object}   opts
 * @param {string}   opts.projectRoot    — Absolute path to the active project
 * @param {Function} [opts.onBridgeError] — (err: Error) => void
 */
export function useChatEngine({
    projectRoot = null,
    onBridgeError = null,
} = {}) {

    // ── State ──────────────────────────────────────────────────────────────────
    /** Array of { id, time, type, message } entries consumed by <TerminalLog /> */
    const [logs, setLogs] = useState([]);
    /** The current task being executed, or null */
    const [activeTask, setActiveTask] = useState(null);
    /** True while any dispatch is in-flight */
    const [isRunning, setIsRunning] = useState(false);
    /** Partial streamed text for the active task (flushed ~60fps) */
    const [streamBuffer, setStreamBuffer] = useState('');

    // ── Refs ───────────────────────────────────────────────────────────────────
    const abortRef = useRef(null);
    const rafRef = useRef(null);
    const streamRef = useRef('');  // accumulates raw streaming text
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

    // ── Core Dispatch ──────────────────────────────────────────────────────────
    /**
     * Execute a single stateless agent task.
     *
     * For INQUISITOR: pass { filePath, content } — content is the raw file source.
     * For HERALD:     pass { } — diff is auto-fetched from the bridge.
     * For LAWYER:     pass { } — package.json is auto-fetched from the bridge.
     *
     * @param {'INQUISITOR'|'HERALD'|'LAWYER'} agentType
     * @param {Object} payload
     * @param {string}  [payload.filePath]   — INQUISITOR only
     * @param {string}  [payload.content]    — INQUISITOR only (raw file source)
     * @returns {Promise<string>}  The raw model output string
     */
    const dispatch = useCallback(async (agentType, payload = {}) => {
        // ── Guard ────────────────────────────────────────────────────────────────
        if (!Object.values(AGENT_TYPES).includes(agentType)) {
            pushLog('ERROR', `Unknown agent type: "${agentType}"`);
            return '';
        }

        // Abort any in-flight request before starting a new one
        abortRef.current?.abort();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        const controller = new AbortController();
        abortRef.current = controller;
        streamRef.current = '';

        setIsRunning(true);
        setActiveTask(agentType);
        setStreamBuffer('');

        try {
            // ════════════════════════════════════════════════════════════════
            //  STAGE 1: Fetch / validate the raw payload for this agent
            // ════════════════════════════════════════════════════════════════
            let rawContent = '';
            let filename = 'unknown';

            switch (agentType) {

                // ── INQUISITOR: content comes from the TaskQueueEngine ───────
                case AGENT_TYPES.INQUISITOR: {
                    if (!payload.content) {
                        pushLog('ERROR', `[INQUISITOR] No content provided for dispatch.`);
                        return '';
                    }
                    rawContent = payload.content;
                    filename = payload.filePath || 'unknown';
                    pushLog('INFO', `[INQUISITOR] Scanning ${filename}...`);
                    break;
                }

                // ── HERALD: fetch git diff from bridge ───────────────────────
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
                    pushLog('INFO', `[HERALD] Diff ready — ${lineCount} lines. Generating commit message...`);

                    if (diffResult.diff.length > 20000) {
                        const staged = diffResult.diagnostics?.stagedFiles || [];
                        const unstaged = diffResult.diagnostics?.unstagedFiles || [];
                        const files = [...staged, ...unstaged].map(f => `- ${f}`).join('\n');
                        rawContent = `CHANGED FILES:\n${files}\n\n${diffResult.diff.substring(0, 20000)}\n\n... [DIFF TRUNCATED TO PROTECT CONTEXT WINDOW] ....`;
                    } else {
                        rawContent = diffResult.diff;
                    }

                    filename = 'git-diff';
                    break;
                }

                // ── LAWYER: fetch package.json from bridge ───────────────────
                case AGENT_TYPES.LAWYER: {
                    if (!projectRoot) {
                        pushLog('ERROR', `[LAWYER] No project root set. Connect a project first.`);
                        return '';
                    }
                    pushLog('INFO', `[LAWYER] Fetching package.json...`);
                    const pkgContent = await bridgeFetchFile('package.json');

                    if (!pkgContent) {
                        pushLog('ERROR', `[LAWYER] package.json not found in project root.`);
                        return '';
                    }
                    pushLog('INFO', `[LAWYER] package.json loaded — scanning licenses...`);
                    rawContent = pkgContent;
                    filename = 'package.json';
                    break;
                }
            }

            // ════════════════════════════════════════════════════════════════
            //  STAGE 2: Sanitize via ContextManager
            //  This is the "butcher" pass — strips comments, SVG paths,
            //  base64 blobs, and noise before the payload hits the model.
            // ════════════════════════════════════════════════════════════════
            let sanitized;
            try {
                sanitized = sanitizeContext(rawContent, filename, agentType);
            } catch (sanitizeErr) {
                pushLog('ERROR', `[${agentType}] Context rejected: ${sanitizeErr.message}`);
                return '';
            }

            // ════════════════════════════════════════════════════════════════
            //  STAGE 3: Build the stateless prompt
            //  CRITICAL: No history. No repo index. No rolling context.
            //  Just system + user. Every call starts from zero.
            // ════════════════════════════════════════════════════════════════
            const promptPayload = constructPrompt(agentType, sanitized, {
                filename,
                projectRoot: projectRoot || undefined,
            });

            const estimatedTokens = Math.round(
                (promptPayload.system.length + promptPayload.user.length) / 4
            );
            pushLog('INFO', `[${agentType}] Payload: ~${estimatedTokens.toLocaleString()} tokens → ${promptPayload.model}`);

            // ════════════════════════════════════════════════════════════════
            //  STAGE 4: Stream the response
            // ════════════════════════════════════════════════════════════════
            const rawResult = await streamGenerate(
                promptPayload,
                (token) => {
                    streamRef.current += token;
                    scheduleStreamFlush();
                },
                controller.signal,
            );

            // ════════════════════════════════════════════════════════════════
            //  STAGE 5: Parse and surface the result as CI/CD log lines
            // ════════════════════════════════════════════════════════════════
            const clean = stripThinkTags(rawResult);

            switch (agentType) {

                case AGENT_TYPES.INQUISITOR: {
                    try {
                        const report = JSON.parse(extractJSON(clean));
                        if (report.status === 'CLEAN') {
                            pushLog('SUCCESS', `[INQUISITOR] ${filename} → CLEAN`);
                        } else {
                            const issues = report.issues || [];
                            pushLog('WARNING', `[INQUISITOR] ${filename} → DIRTY — ${issues.length} issue(s) found`);
                            for (const issue of issues) {
                                const severity = issue.severity === 'CRITICAL' ? 'ERROR' : 'WARNING';
                                pushLog(severity, `[INQUISITOR]   L${issue.line} [${issue.type}] ${issue.issue}`);
                            }
                        }
                    } catch {
                        // Model produced non-JSON — surface raw output for debugging
                        pushLog('WARNING', `[INQUISITOR] ${filename} — response was not valid JSON. Raw output streamed above.`);
                    }
                    break;
                }

                case AGENT_TYPES.HERALD: {
                    // Output is a single commit string — log it directly
                    const commitMsg = clean.split('\n')[0] || clean;
                    pushLog('SUCCESS', `[HERALD] Commit message ready:`);
                    pushLog('INFO', `[HERALD]   ${commitMsg}`);
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
                                const level = dep.risk === 'HIGH_RISK' ? 'ERROR' : 'WARNING';
                                pushLog(level, `[LAWYER]   ${dep.risk}: ${dep.license} detected in '${dep.name}' — ${dep.note}`);
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
            if (err.name === 'AbortError') {
                return '';
            }
            const msg = `[${agentType}] Bridge error: ${err.message}`;
            pushLog('ERROR', msg);
            onBridgeError?.(err);
            return '';

        } finally {
            // ── CRITICAL: Drop all context before the next task ──────────────
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
        // State
        logs,
        isRunning,
        activeTask,
        streamBuffer,

        // Actions
        dispatch,
        clearLogs,
        abort,
        pushLog,

        // Convenience: expose bridge helpers for external use (e.g. TaskQueueEngine)
        bridgeFetchFile,
        bridgeFetchDiff,
    };
}