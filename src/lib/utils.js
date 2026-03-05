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
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16) / 255,
        parseInt(h.substring(2, 4), 16) / 255,
        parseInt(h.substring(4, 6), 16) / 255,
    ];
}
