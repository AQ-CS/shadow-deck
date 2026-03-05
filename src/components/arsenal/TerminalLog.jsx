import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Radio } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Severity Color Map ───────────────────────────
const SEVERITY_CONFIG = {
    INFO: { color: 'text-blue-400', glow: false, prefix: 'INF' },
    SUCCESS: { color: 'text-emerald-400', glow: true, prefix: 'ACK' },
    ERROR: { color: 'text-red-500', glow: false, prefix: 'ERR', glitch: true },
    WARNING: { color: 'text-yellow-400', glow: false, prefix: 'WRN' },
};

const DEFAULT_SEVERITY = { color: 'text-zinc-400', glow: false, prefix: '---' };

/**
 * Normalize a log entry into { id, time, type, message }.
 * Accepts strings or objects with { type, message } shape.
 */
function normalizeLog(entry, index) {
    if (typeof entry === 'string') {
        return {
            id: `log-${index}-${Date.now()}`,
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            type: 'INFO',
            message: entry,
        };
    }
    return {
        id: entry.id || `log-${index}-${Date.now()}`,
        time: entry.time || new Date().toLocaleTimeString('en-US', { hour12: false }),
        type: (entry.type || 'INFO').toUpperCase(),
        message: entry.message || entry.type || '',
    };
}

// ── Log Line Component ───────────────────────────
function LogLine({ log }) {
    const config = SEVERITY_CONFIG[log.type] || DEFAULT_SEVERITY;

    return (
        <motion.div
            initial={{ opacity: 0, x: -16, filter: 'blur(4px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className={cn(
                'flex items-start gap-3 py-[3px] px-2 rounded group transition-colors',
                'hover:bg-white/[0.015]',
                config.glitch && 'animate-glitch'
            )}
        >
            {/* Timestamp */}
            <span className="text-xs text-zinc-400 tabular-nums w-[56px] shrink-0 pt-px">
                {log.time}
            </span>

            {/* Severity Badge */}
            <span
                className={cn(
                    'text-xs font-bold tracking-wider w-8 shrink-0 pt-px',
                    config.color
                )}
                style={config.glow ? { textShadow: '0 0 8px rgba(52,211,153,0.5), 0 0 20px rgba(52,211,153,0.2)' } : undefined}
            >
                {config.prefix}
            </span>

            {/* Separator */}
            <span className={cn('text-xs shrink-0 pt-px', config.color)} style={{ opacity: 0.5 }}>
                {'▸'}
            </span>

            {/* Message */}
            <span
                className={cn(
                    'text-sm leading-relaxed break-all',
                    config.color,
                    'group-hover:brightness-125 transition-all'
                )}
                style={config.glow ? { textShadow: '0 0 6px rgba(52,211,153,0.4)' } : undefined}
            >
                {log.message}
            </span>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  TERMINAL LOG — The Hyper-Speed Feed
// ═══════════════════════════════════════════════════════════════
export function TerminalLog({ logs = [], className }) {
    const scrollRef = useRef(null);

    // Auto-scroll to bottom on new logs
    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [logs]);

    const normalized = logs.map(normalizeLog);

    return (
        <div
            className={cn(
                'relative h-full w-full flex flex-col overflow-hidden rounded-lg',
                'bg-black/50 border border-white/[0.08]',
                className
            )}
        >
            {/* ── CRT Scanline Overlay (component-local) ── */}
            <div
                className="absolute inset-0 pointer-events-none z-30 rounded-lg"
                style={{
                    background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 255, 200, 0.008) 2px,
            rgba(0, 255, 200, 0.008) 4px
          )`,
                }}
            />

            {/* ── Sticky Header ── */}
            <div className="relative z-20 flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-black/30 backdrop-blur-sm">
                <div className="flex items-center gap-2.5">
                    <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        <Terminal size={12} className="text-teal-500" />
                    </motion.div>
                    <span className="text-xs font-bold tracking-[0.25em] text-zinc-400 uppercase">
                        {'/// SYSTEM_LOGS // LIVE_FEED'}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-300 tabular-nums">
                        {normalized.length} events
                    </span>
                    <motion.div
                        animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-teal-500"
                        style={{ boxShadow: '0 0 4px rgba(20,184,166,0.6)' }}
                    />
                </div>
            </div>

            {/* ── Log Body ── */}
            <div
                ref={scrollRef}
                className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden p-3 min-h-0"
            >
                <AnimatePresence mode="popLayout">
                    {normalized.length === 0 ? (
                        <motion.div
                            key="empty-state"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center h-full gap-3"
                        >
                            <motion.div
                                animate={{ opacity: [0.15, 0.35, 0.15] }}
                                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                                className="text-zinc-800"
                            >
                                <Radio size={28} strokeWidth={1} />
                            </motion.div>
                            <span className="text-sm text-zinc-300 tracking-[0.2em] uppercase">
                                ...awaiting signal
                            </span>
                        </motion.div>
                    ) : (
                        normalized.map((log) => (
                            <LogLine key={log.id} log={log} />
                        ))
                    )}
                </AnimatePresence>
            </div>

            {/* ── Bottom Edge Glow ── */}
            <div
                className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none z-20"
                style={{
                    background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
                }}
            />
        </div>
    );
}

export default TerminalLog;
