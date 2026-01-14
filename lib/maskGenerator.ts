/**
 * Mask Generation Engine
 * 
 * Uses edge maps to detect region boundaries and flood fill to create masks.
 * Designed for build-time execution with Node.js.
 */

import { generateDistinctColor } from './colorUtils';
import type { BoundingBox, SerializedMask, MaskData, RGB } from './types';

// Threshold for edge detection (0-255)
// Pixels darker than this are considered edges
const EDGE_THRESHOLD = 200;

// Minimum mask size in pixels (filters out noise)
const MIN_MASK_SIZE = 100;

// Maximum stack size for iterative flood fill (prevents stack overflow)
const MAX_FLOOD_FILL_STACK = 5000000;

/**
 * ImageData-like interface for Node.js compatibility
 */
interface ImageDataLike {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

/**
 * Check if a pixel is an edge based on grayscale value
 */
function isEdgePixel(imageData: ImageDataLike, x: number, y: number): boolean {
    const idx = (y * imageData.width + x) * 4;
    // Convert to grayscale (edge maps are black lines on white background)
    const gray = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
    // Dark pixels (below threshold) are edges
    return gray < EDGE_THRESHOLD;
}

/**
 * Get RGB value at a pixel position
 */
function getPixelRGB(imageData: ImageDataLike, x: number, y: number): RGB {
    const idx = (y * imageData.width + x) * 4;
    return [
        imageData.data[idx],
        imageData.data[idx + 1],
        imageData.data[idx + 2],
    ];
}

/**
 * Iterative flood fill algorithm to find connected regions
 * Uses a stack instead of recursion to handle large regions
 */
function floodFill(
    edgeData: ImageDataLike,
    visited: Uint8Array,
    startX: number,
    startY: number,
): number[] {
    const width = edgeData.width;
    const height = edgeData.height;
    const pixels: number[] = [];

    // Stack of [x, y] coordinates to process
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0 && pixels.length < MAX_FLOOD_FILL_STACK) {
        const [x, y] = stack.pop()!;

        // Check bounds
        if (x < 0 || x >= width || y < 0 || y >= height) {
            continue;
        }

        const idx = y * width + x;

        // Skip if already visited
        if (visited[idx]) {
            continue;
        }

        // Skip if this is an edge pixel
        if (isEdgePixel(edgeData, x, y)) {
            continue;
        }

        // Mark as visited and add to mask
        visited[idx] = 1;
        pixels.push(idx);

        // Add 4-connected neighbors to stack
        stack.push([x + 1, y]);
        stack.push([x - 1, y]);
        stack.push([x, y + 1]);
        stack.push([x, y - 1]);
    }

    return pixels;
}

/**
 * Compute bounding box for a set of pixel indices
 */
function computeBoundingBox(pixels: number[], width: number): BoundingBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const idx of pixels) {
        const x = idx % width;
        const y = Math.floor(idx / width);

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Compute average normal vector for a mask region
 */
function computeAverageNormal(
    pixels: number[],
    normalData: ImageDataLike,
    width: number
): RGB {
    let r = 0, g = 0, b = 0;

    for (const idx of pixels) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const [pr, pg, pb] = getPixelRGB(normalData, x, y);
        r += pr;
        g += pg;
        b += pb;
    }

    const count = pixels.length;
    return [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
    ];
}

/**
 * Generate masks from edge map using flood fill
 */
export function generateMasks(
    edgeData: ImageDataLike,
    normalData: ImageDataLike
): SerializedMask[] {
    const width = edgeData.width;
    const height = edgeData.height;
    const totalPixels = width * height;

    console.log(`Generating masks for ${width}x${height} image...`);

    // Track visited pixels
    const visited = new Uint8Array(totalPixels);

    // Mark all edge pixels as visited (they won't be part of any mask)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isEdgePixel(edgeData, x, y)) {
                visited[y * width + x] = 1;
            }
        }
    }

    const masks: SerializedMask[] = [];
    let maskId = 0;

    // Scan for unvisited pixels and flood fill
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;

            if (visited[idx]) {
                continue;
            }

            // Start flood fill from this seed point
            const pixels = floodFill(edgeData, visited, x, y);

            // Filter out small regions (noise)
            if (pixels.length < MIN_MASK_SIZE) {
                continue;
            }

            // Compute mask properties
            const bounds = computeBoundingBox(pixels, width);
            const avgNormal = computeAverageNormal(pixels, normalData, width);
            const displayColor = generateDistinctColor(maskId);

            masks.push({
                id: maskId,
                pixelIndices: pixels,
                bounds,
                avgNormal,
                pixelCount: pixels.length,
                displayColor,
            });

            maskId++;

            if (maskId % 50 === 0) {
                console.log(`  Generated ${maskId} masks...`);
            }
        }
    }

    console.log(`✓ Generated ${masks.length} masks`);
    return masks;
}

/**
 * Create complete MaskData object for an image set
 */
export function createMaskData(
    imageSetId: string,
    edgeData: ImageDataLike,
    normalData: ImageDataLike
): MaskData {
    const masks = generateMasks(edgeData, normalData);

    return {
        imageSetId,
        width: edgeData.width,
        height: edgeData.height,
        masks,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Find which mask contains a given pixel coordinate
 * Uses bounding box for quick filtering, then checks pixel membership
 */
export function findMaskAtPoint(
    masks: SerializedMask[],
    x: number,
    y: number,
    imageWidth: number
): SerializedMask | null {
    const targetIdx = y * imageWidth + x;

    for (const mask of masks) {
        // Quick bounding box check
        if (
            x < mask.bounds.minX || x > mask.bounds.maxX ||
            y < mask.bounds.minY || y > mask.bounds.maxY
        ) {
            continue;
        }

        // Check if pixel is in mask
        // Note: For performance, this should use a Set in runtime code
        if (mask.pixelIndices.includes(targetIdx)) {
            return mask;
        }
    }

    return null;
}

/**
 * Group masks by similar normal vectors (for smart grouping feature)
 * Returns groups of mask IDs that have similar surface orientations
 */
export function groupMasksByNormal(
    masks: SerializedMask[],
    angleTolerance: number = 30
): Map<number, number[]> {
    // Convert angle tolerance to cosine threshold
    const cosThreshold = Math.cos((angleTolerance * Math.PI) / 180);

    // Groups: leaderId -> [memberId, memberId, ...]
    const groups = new Map<number, number[]>();
    const assigned = new Set<number>();

    for (let i = 0; i < masks.length; i++) {
        if (assigned.has(masks[i].id)) continue;

        const group = [masks[i].id];
        assigned.add(masks[i].id);

        // Normal vector for mask i (convert from RGB to normalized vector)
        const n1 = normalizeVector(masks[i].avgNormal);

        for (let j = i + 1; j < masks.length; j++) {
            if (assigned.has(masks[j].id)) continue;

            const n2 = normalizeVector(masks[j].avgNormal);

            // Check angle similarity via dot product
            const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];

            if (dot >= cosThreshold) {
                group.push(masks[j].id);
                assigned.add(masks[j].id);
            }
        }

        groups.set(masks[i].id, group);
    }

    return groups;
}

/**
 * Convert RGB normal map value to normalized vector
 */
function normalizeVector(rgb: RGB): [number, number, number] {
    // Normal maps encode XYZ as RGB (0-255 → -1 to 1)
    const x = (rgb[0] / 255) * 2 - 1;
    const y = (rgb[1] / 255) * 2 - 1;
    const z = (rgb[2] / 255) * 2 - 1;

    const length = Math.sqrt(x * x + y * y + z * z);
    if (length === 0) return [0, 0, 1];

    return [x / length, y / length, z / length];
}
