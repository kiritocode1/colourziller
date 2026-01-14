/**
 * Build-time Mask Generation Script
 * 
 * Reads edge.png and normals.png from each image set,
 * generates masks using flood fill, and saves as JSON.
 * 
 * Run with: pnpm run generate-masks
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { generateDistinctColor } from '../lib/colorUtils';
import type { BoundingBox, SerializedMask, MaskData, RGB } from '../lib/types';

// Configuration
const IMAGE_SETS = ['1', '2', '3', '4', '5', '6'];
const INPUT_BASE = path.join(process.cwd(), 'assignment_testing_images');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'masks');

// Mask generation parameters
const EDGE_THRESHOLD = 200;  // Pixels darker than this are edges
const MIN_MASK_SIZE = 50;    // Filter out tiny noise regions

/**
 * Load image and extract raw pixel data
 */
async function loadImageData(imagePath: string): Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
}> {
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error(`Could not read image dimensions: ${imagePath}`);
    }

    // Get raw RGBA pixel data
    const rawBuffer = await image
        .ensureAlpha()
        .raw()
        .toBuffer();

    return {
        data: new Uint8ClampedArray(rawBuffer),
        width: metadata.width,
        height: metadata.height,
    };
}

/**
 * Check if a pixel is an edge (dark pixel in edge map)
 */
function isEdgePixel(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    width: number
): boolean {
    const idx = (y * width + x) * 4;
    const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    return gray < EDGE_THRESHOLD;
}

/**
 * Get RGB color at pixel
 */
function getPixelRGB(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    width: number
): RGB {
    const idx = (y * width + x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
}

/**
 * Iterative flood fill - finds all connected non-edge pixels
 */
function floodFill(
    edgeData: Uint8ClampedArray,
    visited: Uint8Array,
    startX: number,
    startY: number,
    width: number,
    height: number
): number[] {
    const pixels: number[] = [];
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0) {
        const [x, y] = stack.pop()!;

        // Bounds check
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const idx = y * width + x;

        // Already visited
        if (visited[idx]) continue;

        // Is edge - don't include
        if (isEdgePixel(edgeData, x, y, width)) continue;

        // Mark visited and add to mask
        visited[idx] = 1;
        pixels.push(idx);

        // Add 4-connected neighbors
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return pixels;
}

/**
 * Compute bounding box for pixel set
 */
function computeBounds(pixels: number[], width: number): BoundingBox {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

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
 * Compute average normal for a region
 */
function computeAvgNormal(
    pixels: number[],
    normalData: Uint8ClampedArray,
    width: number
): RGB {
    let r = 0, g = 0, b = 0;

    for (const idx of pixels) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const [pr, pg, pb] = getPixelRGB(normalData, x, y, width);
        r += pr;
        g += pg;
        b += pb;
    }

    const n = pixels.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Generate all masks for an image set
 */
async function generateMasksForSet(setId: string): Promise<MaskData> {
    console.log(`\n📷 Processing image set ${setId}...`);

    const setPath = path.join(INPUT_BASE, setId);
    const edgePath = path.join(setPath, 'edge.png');
    const normalPath = path.join(setPath, 'normals.png');

    // Load images
    console.log('  Loading edge map...');
    const edge = await loadImageData(edgePath);

    console.log('  Loading normal map...');
    const normal = await loadImageData(normalPath);

    const { width, height } = edge;
    const totalPixels = width * height;

    console.log(`  Image size: ${width}x${height} (${totalPixels.toLocaleString()} pixels)`);

    // Track visited pixels
    const visited = new Uint8Array(totalPixels);

    // Pre-mark edge pixels as visited
    console.log('  Detecting edges...');
    let edgeCount = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isEdgePixel(edge.data, x, y, width)) {
                visited[y * width + x] = 1;
                edgeCount++;
            }
        }
    }
    console.log(`  Found ${edgeCount.toLocaleString()} edge pixels`);

    // Flood fill to find regions
    console.log('  Running flood fill...');
    const masks: SerializedMask[] = [];
    let maskId = 0;
    let processedPixels = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;

            if (visited[idx]) continue;

            // Flood fill from this seed
            const pixels = floodFill(edge.data, visited, x, y, width, height);
            processedPixels += pixels.length;

            // Skip small regions
            if (pixels.length < MIN_MASK_SIZE) continue;

            // Create mask
            masks.push({
                id: maskId,
                pixelIndices: pixels,
                bounds: computeBounds(pixels, width),
                avgNormal: computeAvgNormal(pixels, normal.data, width),
                pixelCount: pixels.length,
                displayColor: generateDistinctColor(maskId),
            });

            maskId++;
        }

        // Progress update
        if (y % 200 === 0) {
            const pct = ((y / height) * 100).toFixed(1);
            process.stdout.write(`\r  Progress: ${pct}%`);
        }
    }

    console.log(`\r  ✅ Generated ${masks.length} masks (${processedPixels.toLocaleString()} pixels covered)`);

    return {
        imageSetId: setId,
        width,
        height,
        masks,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Main entry point
 */
async function main() {
    console.log('🎨 ColorCraft Mask Generator');
    console.log('============================\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${OUTPUT_DIR}`);
    }

    // Process each image set
    const results: { setId: string; maskCount: number; time: number }[] = [];

    for (const setId of IMAGE_SETS) {
        const startTime = Date.now();

        try {
            const maskData = await generateMasksForSet(setId);

            // Save to JSON
            const outputPath = path.join(OUTPUT_DIR, `masks-${setId}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(maskData));

            const elapsed = Date.now() - startTime;
            results.push({ setId, maskCount: maskData.masks.length, time: elapsed });

            console.log(`  💾 Saved to ${outputPath}`);
        } catch (error) {
            console.error(`  ❌ Error processing set ${setId}:`, error);
        }
    }

    // Summary
    console.log('\n\n📊 Summary');
    console.log('==========');
    console.log('Set\tMasks\tTime');
    for (const r of results) {
        console.log(`${r.setId}\t${r.maskCount}\t${(r.time / 1000).toFixed(1)}s`);
    }

    const totalMasks = results.reduce((sum, r) => sum + r.maskCount, 0);
    const totalTime = results.reduce((sum, r) => sum + r.time, 0);
    console.log(`\nTotal: ${totalMasks} masks in ${(totalTime / 1000).toFixed(1)}s`);
    console.log('\n✨ Done!\n');
}

main().catch(console.error);
