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

// ============================================
// SMART GROUPING - Multi-factor similarity
// ============================================

interface MaskFeatures {
    id: number;
    centerX: number;
    centerY: number;
    avgColor: [number, number, number];
    normalVector: [number, number, number];
    area: number;
    aspectRatio: number;
}

/**
 * Extract features from a mask for similarity comparison
 */
function extractMaskFeatures(
    mask: SerializedMask,
    imageWidth: number,
    imageData?: Uint8ClampedArray
): MaskFeatures {
    // Calculate center from bounds
    const centerX = (mask.bounds.minX + mask.bounds.maxX) / 2;
    const centerY = (mask.bounds.minY + mask.bounds.maxY) / 2;

    // Calculate aspect ratio
    const width = mask.bounds.maxX - mask.bounds.minX;
    const height = mask.bounds.maxY - mask.bounds.minY;
    const aspectRatio = height > 0 ? width / height : 1;

    // Calculate average color if image data provided
    let avgColor: [number, number, number] = [128, 128, 128];
    if (imageData && mask.pixelIndices.length > 0) {
        let r = 0, g = 0, b = 0;
        const sampleRate = Math.max(1, Math.floor(mask.pixelIndices.length / 100)); // Sample up to 100 pixels
        let samples = 0;

        for (let i = 0; i < mask.pixelIndices.length; i += sampleRate) {
            const idx = mask.pixelIndices[i] * 4;
            r += imageData[idx];
            g += imageData[idx + 1];
            b += imageData[idx + 2];
            samples++;
        }

        avgColor = [
            Math.round(r / samples),
            Math.round(g / samples),
            Math.round(b / samples)
        ];
    }

    return {
        id: mask.id,
        centerX,
        centerY,
        avgColor,
        normalVector: normalizeVector(mask.avgNormal),
        area: mask.pixelCount,
        aspectRatio
    };
}

/**
 * Calculate similarity score between two masks (0-1, higher = more similar)
 */
function calculateSimilarity(
    a: MaskFeatures,
    b: MaskFeatures,
    imageWidth: number,
    imageHeight: number,
    weights: {
        color: number;
        normal: number;
        size: number;
        proximity: number;
    } = { color: 0.35, normal: 0.30, size: 0.15, proximity: 0.20 }
): number {
    // Color similarity (using Euclidean distance in RGB space)
    const colorDist = Math.sqrt(
        Math.pow(a.avgColor[0] - b.avgColor[0], 2) +
        Math.pow(a.avgColor[1] - b.avgColor[1], 2) +
        Math.pow(a.avgColor[2] - b.avgColor[2], 2)
    );
    const maxColorDist = Math.sqrt(3 * 255 * 255);
    const colorSim = 1 - (colorDist / maxColorDist);

    // Normal vector similarity (dot product)
    const normalDot =
        a.normalVector[0] * b.normalVector[0] +
        a.normalVector[1] * b.normalVector[1] +
        a.normalVector[2] * b.normalVector[2];
    const normalSim = (normalDot + 1) / 2; // Normalize from [-1,1] to [0,1]

    // Size similarity (using log ratio to handle wide range of sizes)
    const sizeRatio = Math.max(a.area, b.area) / Math.max(1, Math.min(a.area, b.area));
    const sizeSim = 1 / (1 + Math.log10(sizeRatio));

    // Spatial proximity (inverse distance, normalized by image diagonal)
    const dx = a.centerX - b.centerX;
    const dy = a.centerY - b.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const diagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
    const proximitySim = 1 - Math.min(1, dist / (diagonal * 0.3)); // Masks within 30% of diagonal are considered close

    // Weighted combination
    return (
        weights.color * colorSim +
        weights.normal * normalSim +
        weights.size * sizeSim +
        weights.proximity * proximitySim
    );
}

/**
 * Find a smart group of similar masks based on multiple features
 * Uses clustering to find semantically related regions
 * Optimized to be more selective and avoid selecting too many regions
 */
export function findSmartGroup(
    seedMask: SerializedMask,
    allMasks: SerializedMask[],
    maskData: MaskData,
    imageData?: Uint8ClampedArray,
    similarityThreshold: number = 0.75 // Raised from 0.55 for stricter matching
): SerializedMask[] {
    const { width, height } = maskData;

    // Extract features for all masks
    const seedFeatures = extractMaskFeatures(seedMask, width, imageData);
    const allFeatures = allMasks.map(m => extractMaskFeatures(m, width, imageData));

    // Calculate similarity to seed mask with stricter weights
    // Color is most important for semantic grouping
    const strictWeights = { color: 0.45, normal: 0.25, size: 0.15, proximity: 0.15 };

    const similarityScores: { mask: SerializedMask; score: number; colorSim: number }[] = [];

    for (let i = 0; i < allMasks.length; i++) {
        const features = allFeatures[i];

        // Calculate individual similarities
        const colorDist = Math.sqrt(
            Math.pow(seedFeatures.avgColor[0] - features.avgColor[0], 2) +
            Math.pow(seedFeatures.avgColor[1] - features.avgColor[1], 2) +
            Math.pow(seedFeatures.avgColor[2] - features.avgColor[2], 2)
        );
        const maxColorDist = Math.sqrt(3 * 255 * 255);
        const colorSim = 1 - (colorDist / maxColorDist);

        const score = calculateSimilarity(
            seedFeatures,
            features,
            width,
            height,
            strictWeights
        );

        similarityScores.push({ mask: allMasks[i], score, colorSim });
    }

    // Sort by similarity
    similarityScores.sort((a, b) => b.score - a.score);

    // STRICT FILTERING:
    // 1. Must have high color similarity (>0.85) to be considered same semantic group
    // 2. Must have overall score above threshold
    // 3. Apply adaptive threshold to find natural grouping boundary

    const colorThreshold = 0.88; // Very strict color matching
    const scores = similarityScores
        .filter(s => s.colorSim >= colorThreshold)
        .map(s => s.score);

    const adaptiveThreshold = findAdaptiveThreshold(scores, similarityThreshold);

    // Return masks that pass both color and overall similarity thresholds
    // Cap at maximum 15 selections to prevent over-selection
    const maxSelections = 15;
    const result = similarityScores
        .filter(s => s.score >= adaptiveThreshold && s.colorSim >= colorThreshold)
        .slice(0, maxSelections)
        .map(s => s.mask);

    // Always include the seed mask
    if (!result.find(m => m.id === seedMask.id)) {
        result.unshift(seedMask);
    }

    return result;
}

/**
 * Find an adaptive threshold based on the distribution of scores
 * Looks for a natural "elbow" in the sorted scores - improved version
 */
function findAdaptiveThreshold(
    sortedScores: number[],
    minThreshold: number
): number {
    if (sortedScores.length <= 1) return minThreshold;
    if (sortedScores.length === 2) {
        // Only 2 items - use min threshold if both are high enough
        return Math.max(minThreshold, sortedScores[1]);
    }

    // Look for significant drops in scores (elbow detection)
    // Use PERCENTAGE drop, not absolute, for better detection
    let maxPercentDrop = 0;
    let elbowIdx = 0;

    for (let i = 1; i < Math.min(sortedScores.length, 12); i++) {
        const prev = sortedScores[i - 1];
        const curr = sortedScores[i];

        // Calculate percentage drop
        const percentDrop = prev > 0 ? (prev - curr) / prev : 0;

        // Also consider absolute drop
        const absDrop = prev - curr;

        // Look for either a significant percentage drop (>8%) or absolute drop (>0.05)
        const isSignificantDrop = percentDrop > 0.08 || absDrop > 0.05;

        if (isSignificantDrop && percentDrop > maxPercentDrop && prev > minThreshold) {
            maxPercentDrop = percentDrop;
            elbowIdx = i;
        }
    }

    // Use the score at the elbow, ensuring we're above minimum threshold
    if (elbowIdx > 0 && maxPercentDrop > 0.05) {
        // Use the score BEFORE the drop as the threshold (more selective)
        return Math.max(minThreshold, sortedScores[elbowIdx - 1] * 0.98);
    }

    // No clear elbow found - use a higher threshold to be safe
    return Math.max(minThreshold, sortedScores[0] * 0.92);
}

/**
 * Find masks with very similar colors (for selecting all same-colored regions)
 */
export function findColorSimilarMasks(
    seedMask: SerializedMask,
    allMasks: SerializedMask[],
    imageWidth: number,
    imageData?: Uint8ClampedArray,
    colorThreshold: number = 0.85
): SerializedMask[] {
    const seedFeatures = extractMaskFeatures(seedMask, imageWidth, imageData);

    return allMasks.filter(mask => {
        const features = extractMaskFeatures(mask, imageWidth, imageData);

        // Calculate color similarity only
        const colorDist = Math.sqrt(
            Math.pow(seedFeatures.avgColor[0] - features.avgColor[0], 2) +
            Math.pow(seedFeatures.avgColor[1] - features.avgColor[1], 2) +
            Math.pow(seedFeatures.avgColor[2] - features.avgColor[2], 2)
        );
        const maxColorDist = Math.sqrt(3 * 255 * 255);
        const colorSim = 1 - (colorDist / maxColorDist);

        return colorSim >= colorThreshold;
    });
}

