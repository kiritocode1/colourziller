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
 * Soft sigmoid function for smooth transitions
 */
function softSigmoid(x: number, center: number = 0.5, steepness: number = 10): number {
    return 1 / (1 + Math.exp(-steepness * (x - center)));
}

/**
 * Smoothstep interpolation for gradual transitions
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * Hermite interpolation for even smoother curves
 */
function hermite(t: number): number {
    return t * t * (3 - 2 * t);
}

/**
 * Apply paint color to a pixel while preserving shadows/highlights
 * This creates a realistic paint effect that maintains surface texture
 * with smooth color blending and natural transitions
 */
export function applyPaintColor(
    basePixel: RGB,
    paintColor: RGB,
    normalPixel?: RGB
): RGB {
    // Convert to HSL
    const baseHsl = rgbToHsl(basePixel[0], basePixel[1], basePixel[2]);
    const paintHsl = rgbToHsl(paintColor[0], paintColor[1], paintColor[2]);

    // --- SMOOTH LUMINANCE BLENDING ---
    // Use a smooth curve to blend luminance instead of linear delta
    const baseLum = baseHsl.l;
    const paintLum = paintHsl.l;

    // Calculate normalized luminance distance from mid-gray
    const lumDelta = baseLum - 0.5;

    // Use hermite smoothing for softer shadow/highlight preservation
    // This reduces harsh contrasts while maintaining depth
    const smoothedDelta = lumDelta * hermite(Math.abs(lumDelta) * 2);

    // Blend the paint luminance with the surface texture
    // Weight the blend based on how extreme the original luminance was
    const lumWeight = 0.45; // How much of the original texture to preserve
    let resultL = paintLum + (smoothedDelta * lumWeight);

    // Soft clamp using smoothstep for gradual falloff at extremes
    if (resultL > 0.9) {
        resultL = 0.9 + smoothstep(0.9, 1.0, resultL) * 0.08;
    } else if (resultL < 0.1) {
        resultL = 0.1 - smoothstep(0.0, 0.1, 1 - resultL) * 0.08;
    }
    resultL = Math.min(0.98, Math.max(0.02, resultL));

    // --- SMOOTH SATURATION BLENDING ---
    // Instead of just boosting saturation, blend based on original
    const baseSat = baseHsl.s;

    // Preserve some of the original saturation variation for texture
    const satBlend = 0.15; // How much original saturation influences result
    let resultS = paintHsl.s * (1 - satBlend) + (paintHsl.s * (0.8 + baseSat * 0.4)) * satBlend;

    // Boost saturation slightly but with a soft cap
    resultS = Math.min(1, resultS * 1.08);

    // --- SUBTLE HUE INFLUENCE ---
    // For more natural results, allow tiny hue shifts based on surface
    let resultH = paintHsl.h;

    // Only influence hue if base has significant saturation (colored surface)
    if (baseSat > 0.1) {
        // Calculate hue difference
        let hueDiff = baseHsl.h - paintHsl.h;
        if (hueDiff > 180) hueDiff -= 360;
        if (hueDiff < -180) hueDiff += 360;

        // Very subtle hue influence (creates more organic color variation)
        const hueInfluence = 0.03 * baseSat;
        resultH = paintHsl.h + hueDiff * hueInfluence;
        if (resultH < 0) resultH += 360;
        if (resultH >= 360) resultH -= 360;
    }

    // --- ENHANCED NORMAL MAP LIGHTING ---
    if (normalPixel) {
        // Extract normal vector components
        const nx = (normalPixel[0] / 255) * 2 - 1;
        const ny = (normalPixel[1] / 255) * 2 - 1;
        const nz = normalPixel[2] / 255;

        // Compute lighting with a soft light source from top-front
        // Light direction: slight angle from above
        const lightX = 0.1;
        const lightY = -0.2;
        const lightZ = 0.97;

        // Dot product for diffuse lighting
        const dot = nx * lightX + ny * lightY + nz * lightZ;

        // Smooth the lighting factor using sigmoid for soft transitions
        const smoothDot = softSigmoid(dot, 0.5, 3);
        const lightingFactor = 0.8 + smoothDot * 0.35;

        // Apply lighting with soft clamping
        resultL = resultL * lightingFactor;
        resultL = Math.min(0.98, Math.max(0.02, resultL));

        // Slightly desaturate areas with extreme lighting
        const lightDeviation = Math.abs(lightingFactor - 1);
        resultS = resultS * (1 - lightDeviation * 0.15);
    }

    // Use paint's hue (with subtle influence), blended saturation, and smooth luminance
    return hslToRgb(resultH, resultS, resultL);
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

/**
 * Apply paint with edge-aware smooth blending
 * edgeDistance: 0.0 = on edge, 1.0 = deep inside mask
 */
export function applyPaintWithEdgeFade(
    basePixel: RGB,
    paintColor: RGB,
    edgeDistance: number,
    normalPixel?: RGB
): RGB {
    // Get the fully painted color
    const paintedColor = applyPaintColor(basePixel, paintColor, normalPixel);

    // Apply smooth edge falloff
    // Use smoothstep for natural fade at boundaries
    const fadeStart = 0.0;
    const fadeEnd = 0.4; // Feather zone thickness (in normalized edge distance)

    // Smoothstep for gradual transition
    const t = Math.max(0, Math.min(1, (edgeDistance - fadeStart) / (fadeEnd - fadeStart)));
    const alpha = t * t * (3 - 2 * t);

    // Blend between base and painted based on edge distance
    return blendColors(basePixel, paintedColor, alpha);
}

/**
 * Compute edge distance map for a mask
 * Returns a Map where each value is the normalized distance to the nearest UNPAINTED edge
 * 0.0 = on edge bordering unpainted area, 1.0 = far from unpainted edge
 * 
 * @param pixelIndices - pixels in this mask
 * @param allPaintedPixels - ALL pixels that have paint applied (across all masks)
 * @param width - image width
 * @param height - image height
 * @param maxDistance - feather radius in pixels
 */
export function computeEdgeDistances(
    pixelIndices: number[],
    width: number,
    height: number,
    maxDistance: number = 8,
    allPaintedPixels?: Set<number>
): Map<number, number> {
    const edgeMap = new Map<number, number>();

    // Use all painted pixels if provided, otherwise just this mask's pixels
    const paintedSet = allPaintedPixels ?? new Set(pixelIndices);

    // For each pixel in the mask, compute distance to nearest UNPAINTED pixel
    for (const pixelIdx of pixelIndices) {
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);

        let minDist = maxDistance;

        // Check in a circular pattern up to maxDistance
        for (let dy = -maxDistance; dy <= maxDistance; dy++) {
            for (let dx = -maxDistance; dx <= maxDistance; dx++) {
                if (dx === 0 && dy === 0) continue;

                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxDistance) continue;

                const nx = x + dx;
                const ny = y + dy;

                // Check if neighbor is outside image bounds
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                    // Image boundary - fade here
                    minDist = Math.min(minDist, dist);
                } else {
                    const neighborIdx = ny * width + nx;
                    // Only count as edge if neighbor is NOT painted
                    // This prevents gaps between adjacent painted masks
                    if (!paintedSet.has(neighborIdx)) {
                        minDist = Math.min(minDist, dist);
                    }
                }
            }
        }

        // Normalize distance (0 = edge bordering unpainted, 1 = interior/touching painted)
        const normalized = minDist / maxDistance;
        edgeMap.set(pixelIdx, normalized);
    }

    return edgeMap;
}
