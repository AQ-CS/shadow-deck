import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

/**
 * Convert a hex color string to normalized RGB floats [0..1].
 * Accepts "#RRGGBB" or "RRGGBB".
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return [0, 0, 0];
    const h = hex.replace('#', '');
    const cleanHex = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return [
        (isNaN(r) ? 0 : r) / 255,
        (isNaN(g) ? 0 : g) / 255,
        (isNaN(b) ? 0 : b) / 255,
    ];
}
