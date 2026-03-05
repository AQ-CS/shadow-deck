// src/utils/ContextManager.js
// ── Agent-aware context sanitizer ─────────────────────────────
// Enforces strict token hygiene based on which agent is asking.

import { AGENT_TYPES } from '../agents/prompts';

// ── HARD LIMITS ───────────────────────────────────────────────
// Conservative limits to prevent VRAM overflow on 8GB-16GB cards.
const MAX_INPUT_CHARS = 24000; // ~6k - 8k tokens
const LOCKFILE_PATTERNS = [/package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/];
const MINIFIED_PATTERNS = [/\.min\.js$/, /\.map$/, /dist\//, /build\//];

/**
 * The "Butcher" function. Trims fat based on Agent needs.
 * @param {string} content - Raw file content or git diff
 * @param {string} filename - Source filename
 * @param {string} agent - The Agent requesting access
 * @returns {string} - The optimized context
 */
export function sanitizeContext(content, filename, agent) {
    // 1. GLOBAL SAFETY CHECKS
    if (!content) return '';

    // IMMEDIATE REJECTION: Lockfiles are token black holes
    if (LOCKFILE_PATTERNS.some(p => p.test(filename))) {
        throw new Error(`[Security] ${agent} is not allowed to read lockfiles. Use package.json.`);
    }

    // IMMEDIATE REJECTION: Minified/Binary files
    if (MINIFIED_PATTERNS.some(p => p.test(filename)) || (content.length > 5000 && content.split('\n').length < 5)) {
        throw new Error(`[Security] ${agent} cannot read minified or binary assets.`);
    }

    // 2. AGENT-SPECIFIC STRATEGIES
    switch (agent) {

        // ── THE HERALD (Git Diffs) ────────────────────────────────
        // Needs: What changed.
        // Hates: Context lines, SVG paths, long lists.
        case AGENT_TYPES.HERALD:
            return optimizeDiff(content);

        // ── THE LAWYER (Dependencies) ─────────────────────────────
        // Needs: "dependencies" and "devDependencies".
        // Hates: "scripts", "eslintConfig", "browserslist".
        case AGENT_TYPES.LAWYER:
            return optimizeManifest(content);

        // ── THE INQUISITOR & ARCHITECT (Deep Logic) ───────────────
        // Needs: Structure, logic flow.
        // Hates: Comments, huge SVGs, base64 strings.
        case AGENT_TYPES.INQUISITOR:
        case AGENT_TYPES.ARCHITECT:
        case AGENT_TYPES.SENTINEL:
        case AGENT_TYPES.WRAITH:
            return optimizeCode(content, true); // Strict mode (strips comments)

        // ── THE ARTIST (UI/UX) ────────────────────────────────────
        // Needs: JSX structure, classNames, CSS.
        // Hates: Heavy logic functions, imports.
        case AGENT_TYPES.ARTIST:
            return optimizeCode(content, false); // Keep comments (might contain TODOs)

        // ── THE SCRIBE (Docs) ─────────────────────────────────────
        // Needs: Everything (to understand intent).
        // Strategy: No truncation, let Swarm handle it.
        default:
            return content;
    }
}

// ── STRATEGY: DIFF OPTIMIZER ──────────────────────────────────
function optimizeDiff(diff) {
    return diff
        .split('\n')
        // Remove "index a432..b564" lines (git noise)
        .filter(line => !line.startsWith('index '))
        // Remove massive deletions (we only care about what is added/changed mostly)
        .filter(line => !(line.startsWith('-') && line.length > 200))
        .join('\n');
}

// ── STRATEGY: MANIFEST PURIFIER (package.json) ────────────────
function optimizeManifest(jsonString) {
    try {
        const pkg = JSON.parse(jsonString);
        const leanPkg = {
            name: pkg.name,
            dependencies: pkg.dependencies || {},
            devDependencies: pkg.devDependencies || {},
            peerDependencies: pkg.peerDependencies || {}
        };
        return JSON.stringify(leanPkg, null, 2);
    } catch (e) {
        return jsonString.slice(0, 2000);
    }
}

// ── STRATEGY: CODE MINIMIZER ──────────────────────────────────
function optimizeCode(code, stripComments = false) {
    let clean = code;

    // 1. Remove SVG paths (huge token wasters)
    clean = clean.replace(/d="[a-zA-Z0-9\s.,-]{50,}"/g, 'd="..."');

    // 2. Remove base64 images
    clean = clean.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{50,}/g, '"[BASE64_IMAGE_REMOVED]"');

    // 3. (Optional) Strip Comments for strict logic agents
    if (stripComments) {
        clean = clean.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    }

    // 4. Compress multiple empty lines
    clean = clean.replace(/\n\s*\n\s*\n/g, '\n\n');

    return clean;
}
