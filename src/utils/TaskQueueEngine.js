// src/utils/TaskQueueEngine.js
// ═══════════════════════════════════════════════════════════════════════════
//  ShadowDeck — File-by-File Task Queue  (v4: Surgical Strike Edition)
//
//  RESPONSIBILITY:
//    Takes an array of file paths. Iterates through them ONE BY ONE.
//    For each file:
//      1. Fetches content via the bridge.
//      2. Runs the optimizeCode filter (ContextManager sanitizer).
//      3. Dispatches to The Inquisitor via the payload router.
//      4. Waits for the JSON response.
//      5. DROPS all context before moving to the next file.
//
//  CRITICAL GUARANTEE:
//    File A's source code is never in memory when File B is being processed.
//    This prevents VRAM accumulation across files on local hardware.
//
//  USAGE (from CommandCenter.jsx):
//    const engine = new TaskQueueEngine({ projectRoot, dispatch, pushLog,
//                                         onProgress, onFileComplete, onComplete });
//    await engine.run(filePaths);
//    engine.abort();
// ═══════════════════════════════════════════════════════════════════════════

import { sanitizeContext } from './ContextManager';
import { AGENT_TYPES } from '../agents/prompts';

const BRIDGE = 'http://localhost:9090';

// Hard cap per file: 20k chars ≈ ~5k tokens.
// A single file should never need more than this for bug-hunting.
const MAX_FILE_CHARS = 20_000;

// FIX #2: Hard rejection ceiling — files over 16k tokens are monolithic
// nightmares that need human refactoring, not AI chunking. Attempting to
// split them across "operators" breaks the AST and causes hallucinations.
// 16,000 tokens × 4 chars/token = 64,000 chars.
const MAX_TOKENS_REJECTION = 16_000;
const REJECTION_CHAR_LIMIT = MAX_TOKENS_REJECTION * 4; // 64,000 chars

/**
 * Fetch a single file from the bridge.
 * Returns the content string, or null on failure.
 *
 * @param {string} relativePath
 * @returns {Promise<string|null>}
 */
async function fetchFile(relativePath) {
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


// ═══════════════════════════════════════════════════════════════════════════
//  TaskQueueEngine
// ═══════════════════════════════════════════════════════════════════════════

export class TaskQueueEngine {
    /**
     * @param {Object}   opts
     * @param {string}   opts.projectRoot      — Absolute path to the active project
     * @param {Function} opts.dispatch         — The dispatch fn from useChatEngine
     * @param {Function} opts.pushLog          — The pushLog fn from useChatEngine
     * @param {Function} [opts.onProgress]     — (current: number, total: number, filePath: string) => void
     * @param {Function} [opts.onFileComplete] — (filePath: string, status: string, issues: Array) => void
     *                                           FIX #6: Fires immediately when each file finishes so the
     *                                           UI can update that file's icon without waiting for the
     *                                           full queue to complete.
     * @param {Function} [opts.onComplete]     — (results: Array) => void
     */
    constructor({ projectRoot, dispatch, pushLog, onProgress = null, onFileComplete = null, onComplete = null }) {
        this.projectRoot = projectRoot;
        this.dispatch = dispatch;
        this.pushLog = pushLog;
        this.onProgress = onProgress;
        this.onFileComplete = onFileComplete; // FIX #6
        this.onComplete = onComplete;

        this._aborted = false;
        this._results = [];
    }

    /**
     * Abort the queue mid-run.
     * The currently-dispatched file will finish its in-flight request
     * (abort is handled at the dispatch layer), then the loop stops.
     */
    abort() {
        this._aborted = true;
        this.pushLog('WARNING', '[QUEUE] Abort signal received. Stopping after current file.');
    }

    /**
     * Run the Inquisitor over an array of file paths, one at a time.
     *
     * @param {string[]} filePaths  — Relative paths within the project
     * @returns {Promise<Array<{ filePath, status, issues }>>}
     */
    async run(filePaths) {
        if (!filePaths || filePaths.length === 0) {
            this.pushLog('WARNING', '[QUEUE] No files in queue.');
            return [];
        }

        this._aborted = false;
        this._results = [];

        const total = filePaths.length;
        this.pushLog('INFO', `[QUEUE] Starting scan — ${total} file(s) queued.`);
        this.pushLog('INFO', `[QUEUE] ${'─'.repeat(44)}`);

        for (let i = 0; i < filePaths.length; i++) {
            // ── Abort check ──────────────────────────────────────────────────────
            if (this._aborted) {
                this.pushLog('WARNING', `[QUEUE] Aborted at file ${i + 1}/${total}.`);
                break;
            }

            const filePath = filePaths[i];
            this.onProgress?.(i + 1, total, filePath);
            this.pushLog('INFO', `[QUEUE] (${i + 1}/${total}) → ${filePath}`);

            // ── STAGE 1: Fetch raw content ─────────────────────────────────────
            let rawContent = null;
            try {
                rawContent = await fetchFile(filePath);
            } catch (fetchErr) {
                this.pushLog('ERROR', `[QUEUE] Failed to fetch ${filePath}: ${fetchErr.message}`);
                const result = { filePath, status: 'FETCH_ERROR', issues: [] };
                this._results.push(result);
                this.onFileComplete?.(filePath, result.status, result.issues); // FIX #6
                continue; // skip to next file — don't stop the queue
            }

            if (!rawContent) {
                this.pushLog('WARNING', `[QUEUE] Skipping ${filePath} — file not found or empty.`);
                const result = { filePath, status: 'SKIPPED', issues: [] };
                this._results.push(result);
                this.onFileComplete?.(filePath, result.status, result.issues); // FIX #6
                continue;
            }

            // ── FIX #2: Hard rejection for monolithic files ────────────────────
            // Files over 16k tokens are a structural problem. Chopping them into
            // "operator chunks" would slice useEffect hooks and class definitions
            // mid-AST, causing the model to hallucinate syntax errors. Reject
            // gracefully and ask the developer to refactor manually.
            if (rawContent.length > REJECTION_CHAR_LIMIT) {
                const estimatedTokens = Math.round(rawContent.length / 4).toLocaleString();
                this.pushLog('WARNING',
                    `[QUEUE] REJECTED ${filePath} — ~${estimatedTokens} tokens exceeds the 16k ceiling. ` +
                    `This file is a monolith that needs human refactoring, not AI chunking.`
                );
                const result = { filePath, status: 'REJECTED', issues: [] };
                this._results.push(result);
                this.onFileComplete?.(filePath, result.status, result.issues); // FIX #6
                continue;
            }

            // ── STAGE 2: Sanitize ──────────────────────────────────────────────
            // Run the ContextManager "butcher" pass to strip comments, SVG paths,
            // base64 blobs, and noise. Enforce the hard char cap.
            let sanitized = '';
            try {
                const stripped = sanitizeContext(rawContent, filePath, AGENT_TYPES.INQUISITOR);
                // Hard cap: truncate if the file is still massive after stripping
                sanitized = stripped.length > MAX_FILE_CHARS
                    ? stripped.slice(0, MAX_FILE_CHARS) + '\n/* [FILE TRUNCATED] */\n'
                    : stripped;
            } catch (sanitizeErr) {
                // ContextManager throws for lockfiles, minified files, etc.
                this.pushLog('WARNING', `[QUEUE] Skipping ${filePath} — ${sanitizeErr.message}`);
                const result = { filePath, status: 'REJECTED', issues: [] };
                this._results.push(result);
                this.onFileComplete?.(filePath, result.status, result.issues); // FIX #6
                continue;
            }

            // ── STAGE 3: Dispatch to Inquisitor ────────────────────────────────
            // CRITICAL: Pass content directly via payload. The dispatch function
            // builds a fresh [system, user] pair — no history is ever carried over.
            let rawOutput = '';
            try {
                rawOutput = await this.dispatch(AGENT_TYPES.INQUISITOR, {
                    filePath,
                    content: sanitized,
                });
            } catch (dispatchErr) {
                this.pushLog('ERROR', `[QUEUE] Dispatch failed for ${filePath}: ${dispatchErr.message}`);
                const result = { filePath, status: 'DISPATCH_ERROR', issues: [] };
                this._results.push(result);
                this.onFileComplete?.(filePath, result.status, result.issues); // FIX #6
                // Context is dropped by the dispatch's finally block — safe to continue.
                continue;
            }

            // ── STAGE 4: Parse result ──────────────────────────────────────────
            let scanResult = { filePath, status: 'PARSE_ERROR', issues: [] };
            try {
                const parsed = JSON.parse(rawOutput);
                scanResult = {
                    filePath,
                    status: parsed.status || 'UNKNOWN',
                    issues: parsed.issues || [],
                };
            } catch {
                // dispatch() already logged the parse warning — just record the error.
                scanResult = { filePath, status: 'PARSE_ERROR', issues: [] };
            }
            this._results.push(scanResult);

            // FIX #6: Fire the per-file completion callback immediately so the
            // UI can flip this file's icon to CLEAN/DIRTY without waiting for
            // the entire queue to finish. This eliminates the psychological
            // friction of watching a spinner on a file that is already done.
            this.onFileComplete?.(scanResult.filePath, scanResult.status, scanResult.issues);

            // ── STAGE 5: CONTEXT DROP ──────────────────────────────────────────
            // Explicitly null out all references to this file's data.
            // The dispatch() finally block already cleared streamRef/buffer,
            // but we null here to signal intent and help GC.
            rawContent = null;
            sanitized = null;
            rawOutput = null;
            // ── ↑ File A is now fully evicted. File B begins on next iteration. ──
        }

        // ── Queue complete ─────────────────────────────────────────────────────
        const dirty = this._results.filter(r => r.status === 'DIRTY').length;
        const clean = this._results.filter(r => r.status === 'CLEAN').length;
        const errors = this._results.filter(r => !['DIRTY', 'CLEAN'].includes(r.status)).length;

        this.pushLog('INFO', `[QUEUE] ${'─'.repeat(44)}`);
        this.pushLog('SUCCESS', `[QUEUE] Scan complete — ${clean} CLEAN · ${dirty} DIRTY · ${errors} skipped/error`);

        this.onComplete?.(this._results);
        return this._results;
    }
}