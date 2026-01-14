/**
 * Core type definitions for ColorCraft Paint Visualizer
 */

// Bounding box for efficient hit testing
export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

// Single selectable region mask
export interface Mask {
    id: number;
    // Pixel indices stored as flat array for memory efficiency
    // Each pixel is stored as: y * imageWidth + x
    pixelIndices: Uint32Array;
    // Bounding box for quick hit testing
    bounds: BoundingBox;
    // Average normal vector for smart grouping (RGB from normal map)
    avgNormal: [number, number, number];
    // Pixel count for stats display
    pixelCount: number;
    // Assigned display color for "show all masks" mode
    displayColor: string;
}

// Serializable mask data for JSON storage (build-time generation)
export interface SerializedMask {
    id: number;
    pixelIndices: number[];
    bounds: BoundingBox;
    avgNormal: [number, number, number];
    pixelCount: number;
    displayColor: string;
}

// Complete mask data for an image set
export interface MaskData {
    imageSetId: string;
    width: number;
    height: number;
    masks: SerializedMask[];
    generatedAt: string;
}

// Image set containing all 4 source images
export interface ImageSet {
    id: string;
    name: string;
    basePath: string;
}

// Available image sets
export const IMAGE_SETS: ImageSet[] = [
    { id: '1', name: 'Building 1', basePath: '/assignment_testing_images/1' },
    { id: '2', name: 'Building 2', basePath: '/assignment_testing_images/2' },
    { id: '3', name: 'Building 3', basePath: '/assignment_testing_images/3' },
    { id: '4', name: 'Building 4', basePath: '/assignment_testing_images/4' },
    { id: '5', name: 'Building 5', basePath: '/assignment_testing_images/5' },
    { id: '6', name: 'Building 6', basePath: '/assignment_testing_images/6' },
];

// Selection state
export interface SelectionState {
    selectedMaskIds: Set<number>;
    // Map of maskId -> applied color (hex string)
    appliedColors: Map<number, string>;
}

// Paint colors for the palette
export interface PaintColor {
    id: string;
    name: string;
    hex: string;
}

// Default paint color palette
export const PAINT_PALETTE: PaintColor[] = [
    { id: 'terracotta', name: 'Terracotta', hex: '#E07A5F' },
    { id: 'sage', name: 'Sage Green', hex: '#81B29A' },
    { id: 'mustard', name: 'Mustard Yellow', hex: '#F2CC8F' },
    { id: 'ocean', name: 'Ocean Blue', hex: '#3D5A80' },
    { id: 'lavender', name: 'Lavender', hex: '#9B8AA3' },
    { id: 'cream', name: 'Cream White', hex: '#F4F1DE' },
];

// View modes
export type ViewMode = 'normal' | 'all-masks';

// Application state
export interface AppState {
    currentImageSetId: string;
    selection: SelectionState;
    viewMode: ViewMode;
    isProcessing: boolean;
    activePaintColor: string | null;
}

// RGB pixel data
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

// HSL color representation
export interface HSL {
    h: number; // 0-360
    s: number; // 0-1
    l: number; // 0-1
}
