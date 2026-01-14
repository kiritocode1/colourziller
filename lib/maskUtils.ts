/**
 * Runtime mask utilities for the Paint Visualizer
 * Handles loading pre-generated masks and efficient pixel lookup
 */

import type { MaskData, SerializedMask } from './types';

// Cache for loaded mask data
const maskCache = new Map<string, MaskData>();

// Cache for pixel-to-mask lookup maps (for fast click detection)
const lookupCache = new Map<string, Int32Array>();

/**
 * Load mask data for an image set
 */
export async function loadMaskData(imageSetId: string): Promise<MaskData> {
    // Check cache first
    if (maskCache.has(imageSetId)) {
        return maskCache.get(imageSetId)!;
    }

    // Fetch from public directory
    const response = await fetch(`/masks/masks-${imageSetId}.json`);

    if (!response.ok) {
        throw new Error(`Failed to load masks for set ${imageSetId}: ${response.statusText}`);
    }

    const data: MaskData = await response.json();

    // Cache the data
    maskCache.set(imageSetId, data);

    return data;
}

/**
 * Build a pixel->maskId lookup array for fast hit testing
 * Returns Int32Array where value at index i is the maskId, or -1 if no mask
 */
export function buildPixelLookup(maskData: MaskData): Int32Array {
    const cacheKey = maskData.imageSetId;

    if (lookupCache.has(cacheKey)) {
        return lookupCache.get(cacheKey)!;
    }

    const totalPixels = maskData.width * maskData.height;
    const lookup = new Int32Array(totalPixels).fill(-1);

    // Fill lookup with mask IDs
    for (const mask of maskData.masks) {
        for (const pixelIdx of mask.pixelIndices) {
            lookup[pixelIdx] = mask.id;
        }
    }

    lookupCache.set(cacheKey, lookup);
    return lookup;
}

/**
 * Find which mask contains a given coordinate
 */
export function findMaskAtPoint(
    x: number,
    y: number,
    maskData: MaskData,
    lookup: Int32Array
): SerializedMask | null {
    // Bounds check
    if (x < 0 || x >= maskData.width || y < 0 || y >= maskData.height) {
        return null;
    }

    const pixelIdx = y * maskData.width + x;
    const maskId = lookup[pixelIdx];

    if (maskId === -1) {
        return null;
    }

    return maskData.masks.find(m => m.id === maskId) ?? null;
}

/**
 * Get all masks that belong to the same "group" as the given mask
 * Based on similar normal vectors (for smart select feature)
 */
export function findSimilarMasks(
    mask: SerializedMask,
    allMasks: SerializedMask[],
    angleTolerance: number = 25
): SerializedMask[] {
    const cosThreshold = Math.cos((angleTolerance * Math.PI) / 180);

    const n1 = normalizeVector(mask.avgNormal);

    return allMasks.filter(other => {
        const n2 = normalizeVector(other.avgNormal);
        const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
        return dot >= cosThreshold;
    });
}

/**
 * Normalize RGB normal map value to unit vector
 */
function normalizeVector(rgb: [number, number, number]): [number, number, number] {
    const x = (rgb[0] / 255) * 2 - 1;
    const y = (rgb[1] / 255) * 2 - 1;
    const z = (rgb[2] / 255) * 2 - 1;

    const length = Math.sqrt(x * x + y * y + z * z);
    if (length === 0) return [0, 0, 1];

    return [x / length, y / length, z / length];
}

/**
 * Calculate total pixels for a set of mask IDs
 */
export function calculateSelectionStats(
    selectedIds: Set<number>,
    masks: SerializedMask[]
): { maskCount: number; pixelCount: number } {
    let pixelCount = 0;

    for (const mask of masks) {
        if (selectedIds.has(mask.id)) {
            pixelCount += mask.pixelCount;
        }
    }

    return {
        maskCount: selectedIds.size,
        pixelCount,
    };
}
