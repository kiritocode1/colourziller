/**
 * Color utility functions for realistic paint application
 */

import type { RGB, HSL } from './types';

/**
 * Convert RGB to HSL color space
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }

    return { h: h * 360, s, l };
}

/**
 * Convert HSL to RGB color space
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
    h /= 360;

    let r: number, g: number, b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): RGB {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return [0, 0, 0];
    }
    return [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
    ];
}

/**
 * Convert RGB to hex string
 */
export function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Apply paint color to a pixel while preserving luminance (shadows/highlights)
 * This creates a realistic paint effect that maintains the surface texture
 */
export function applyPaintColor(
    basePixel: RGB,
    paintColor: RGB,
    normalPixel?: RGB
): RGB {
    // Convert base pixel to HSL to extract luminance
    const baseHsl = rgbToHsl(basePixel[0], basePixel[1], basePixel[2]);

    // Convert paint color to HSL
    const paintHsl = rgbToHsl(paintColor[0], paintColor[1], paintColor[2]);

    // Blend saturation slightly with original for more realism
    const blendedSaturation = paintHsl.s * 0.85 + baseHsl.s * 0.15;

    // Use paint's hue, blended saturation, and ORIGINAL luminance
    // This preserves shadows, highlights, and texture
    let resultL = baseHsl.l;

    // Optional: use normal map for additional lighting adjustment
    if (normalPixel) {
        // Normal map encodes surface orientation
        // Blue channel (Z) indicates how much the surface faces the camera
        // Higher Z = more direct = brighter
        const normalZ = normalPixel[2] / 255;

        // Subtle lighting adjustment based on surface orientation
        const lightingFactor = 0.9 + normalZ * 0.2;
        resultL = Math.min(1, Math.max(0, resultL * lightingFactor));
    }

    // Convert back to RGB
    return hslToRgb(paintHsl.h, blendedSaturation, resultL);
}

/**
 * Generate a distinct color for mask visualization
 * Uses golden ratio for even distribution across hue spectrum
 */
export function generateDistinctColor(index: number): string {
    const goldenRatio = 0.618033988749895;
    const hue = (index * goldenRatio * 360) % 360;
    const saturation = 0.7 + (index % 3) * 0.1; // Vary saturation slightly
    const lightness = 0.5 + (index % 2) * 0.15; // Vary lightness slightly

    const rgb = hslToRgb(hue, saturation, lightness);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

/**
 * Blend two colors with alpha
 */
export function blendColors(
    baseColor: RGB,
    overlayColor: RGB,
    alpha: number
): RGB {
    return [
        Math.round(baseColor[0] * (1 - alpha) + overlayColor[0] * alpha),
        Math.round(baseColor[1] * (1 - alpha) + overlayColor[1] * alpha),
        Math.round(baseColor[2] * (1 - alpha) + overlayColor[2] * alpha),
    ];
}
