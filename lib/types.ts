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
    oklch: string;
    description: string;
}

// Default paint color palette - vibrant, saturated colors for exterior paint
// Default paint color palette - vibrant, saturated colors for exterior paint
export const PAINT_PALETTE: PaintColor[] = [
    // Warm Tones
    {
        id: 'coral',
        name: 'Coral Red',
        hex: '#E05040',
        oklch: '61.5% 0.19 29.2',
        description: 'A vibrant, energetic red with warm undertones, perfect for making a bold statement.'
    },
    {
        id: 'terracotta',
        name: 'Terracotta',
        hex: '#C75B39',
        oklch: '56.2% 0.16 45.3',
        description: 'Earthy and grounded, this reddish-brown hue evokes the warmth of baked clay.'
    },
    {
        id: 'burgundy',
        name: 'Burgundy',
        hex: '#8C2F39',
        oklch: '44.8% 0.14 23.5',
        description: 'A deep, rich red that adds a touch of sophistication and classic elegance.'
    },
    {
        id: 'sunflower',
        name: 'Sunflower',
        hex: '#F5C518',
        oklch: '82.3% 0.18 85.4',
        description: 'Bright and cheerful, this yellow captures the essence of a sunny summer day.'
    },
    {
        id: 'orange',
        name: 'Burnt Orange',
        hex: '#D97706',
        oklch: '65.1% 0.17 60.2',
        description: 'A warm, autumnal shade that bridges the gap between red and yellow seamlessly.'
    },

    // Cool Tones
    {
        id: 'royal',
        name: 'Royal Blue',
        hex: '#2955A8',
        oklch: '48.2% 0.18 265.1',
        description: 'A majestic and commanding blue that commands attention without being overwhelming.'
    },
    {
        id: 'navy',
        name: 'Deep Navy',
        hex: '#1E3A8A',
        oklch: '35.4% 0.14 260.5',
        description: 'Classic and authority-commanding, this dark blue is timeless and versatile.'
    },
    {
        id: 'teal',
        name: 'Deep Teal',
        hex: '#115E59',
        oklch: '45.1% 0.11 195.3',
        description: 'A sophisticated blend of blue and green, offering a sense of calm and depth.'
    },
    {
        id: 'emerald',
        name: 'Emerald',
        hex: '#059669',
        oklch: '58.7% 0.15 155.2',
        description: 'Rich and verdant, this jewel-toned green brings a lush, natural feel.'
    },
    {
        id: 'mint',
        name: 'Soft Mint',
        hex: '#34D399',
        oklch: '80.5% 0.12 165.8',
        description: 'Fresh and airy, a light green that feels clean, modern, and rejuvenating.'
    },

    // Neutrals & Others
    {
        id: 'plum',
        name: 'Plum Purple',
        hex: '#7B4B8A',
        oklch: '52.3% 0.13 315.4',
        description: 'A luxurious purple that balances warm and cool notes for a creative touch.'
    },
    {
        id: 'lavender',
        name: 'Lavender',
        hex: '#A78BFA',
        oklch: '72.1% 0.11 295.6',
        description: 'Soft and whimsical, this light purple evokes fields of flowers and gentle breezes.'
    },
    {
        id: 'ivory',
        name: 'Ivory White',
        hex: '#FFFEF0',
        oklch: '98.5% 0.01 100.2',
        description: 'A creamy off-white that offers warmth and softness compared to stark white.'
    },
    {
        id: 'slate',
        name: 'Slate Grey',
        hex: '#475569',
        oklch: '48.5% 0.04 250.1',
        description: 'A sleek, modern grey with cool undertones, perfect for contemporary designs.'
    },
    {
        id: 'charcoal',
        name: 'Charcoal',
        hex: '#1F2937',
        oklch: '28.4% 0.02 260.4',
        description: 'Dark and dramatic, a near-black grey that adds contrast and definition.'
    },
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
