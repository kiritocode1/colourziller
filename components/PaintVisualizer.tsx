'use client';

/**
 * PaintVisualizer - Main component for the ColorCraft Paint Visualizer
 *
 * Optimized Code Structure:
 * 1. Constants & Helpers: Defined outside component to prevent recreation.
 * 2. Hooks: `usePaintData` manages async loading of masks and images.
 * 3. Component: 
 *    - State management for selections and colors.
 *    - Split rendering effects (Paint Layer vs Overlay Layer) for performance.
 *    - Memoized handlers for interactions.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { MaskData, ViewMode } from '@/lib/types';
import { IMAGE_SETS, PAINT_PALETTE } from '@/lib/types';
import { loadMaskData, buildPixelLookup, findMaskAtPoint, calculateSelectionStats, findSimilarMasks } from '@/lib/maskUtils';
import { hexToRgb, rgbToHsl, applyPaintColor } from '@/lib/colorUtils';

// --- Constants & Pre-calculations ---

/**
 * Pre-calcuating palette details (RGB, HSL, Strings) to avoid 
 * doing this per-render for every color swatch.
 */
const PALETTE_WITH_DETAILS = PAINT_PALETTE.map(color => {
    const rgb = hexToRgb(color.hex);
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return {
        ...color,
        rgb,
        hsl,
        oklchString: `oklch(${color.oklch})`,
        hslString: `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%)`,
        oklchVal: color.oklch.split('/')[0], // Extract just the value part if needed
    };
});

// --- Custom Hooks ---

interface PaintDataState {
    maskData: MaskData | null;
    pixelLookup: Int32Array | null;
    cleanedImage: HTMLImageElement | null;
    normalImage: HTMLImageElement | null;
    isLoading: boolean;
    error: string | null;
}

/**
 * Hook to manage loading of heavy image and mask data.
 * Returns memoized data objects.
 */
function usePaintData(setId: string) {
    const [state, setState] = useState<PaintDataState>({
        maskData: null,
        pixelLookup: null,
        cleanedImage: null,
        normalImage: null,
        isLoading: true,
        error: null,
    });

    useEffect(() => {
        let isMounted = true;

        async function load() {
            setState(prev => ({ ...prev, isLoading: true, error: null }));

            try {
                const currentSet = IMAGE_SETS.find(s => s.id === setId);
                if (!currentSet) throw new Error(`Image set ${setId} not found`);

                // parallel loading
                const [data, cleanedImg, normalImg] = await Promise.all([
                    loadMaskData(setId),
                    loadImage(`${currentSet.basePath}/cleaned.png`),
                    loadImage(`${currentSet.basePath}/normals.png`)
                ]);

                if (!isMounted) return;

                // Heavy computation (pixel lookup) should ideally be in a worker, 
                // but for now we do it here.
                const lookup = buildPixelLookup(data);

                setState({
                    maskData: data,
                    pixelLookup: lookup,
                    cleanedImage: cleanedImg,
                    normalImage: normalImg,
                    isLoading: false,
                    error: null,
                });
            } catch (err: any) {
                if (isMounted) {
                    setState(prev => ({
                        ...prev,
                        isLoading: false,
                        error: err.message || 'Failed to load data'
                    }));
                }
            }
        }

        load();

        return () => { isMounted = false; };
    }, [setId]);

    return state;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error(`Failed to load image: ${src}`));
    });
}

// --- Main Component ---

interface PaintVisualizerProps {
    className?: string;
}

export default function PaintVisualizer({ className }: PaintVisualizerProps) {
    // --- State ---
    const [currentSetId, setCurrentSetId] = useState(IMAGE_SETS[0].id);
    const [selectedMaskIds, setSelectedMaskIds] = useState<Set<number>>(new Set());
    const [appliedColors, setAppliedColors] = useState<Map<number, string>>(new Map());
    const [viewMode, setViewMode] = useState<ViewMode>('normal');
    const [activePaintColor, setActivePaintColor] = useState<string>(PAINT_PALETTE[0].hex);

    // UI State
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [isShareOpen, setIsShareOpen] = useState(false);

    // Data Load
    const { maskData, pixelLookup, cleanedImage, normalImage, isLoading, error } = usePaintData(currentSetId);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

    // Reset interaction state on dataset change
    useEffect(() => {
        setSelectedMaskIds(new Set());
        setAppliedColors(new Map());
    }, [currentSetId]);

    // --- Rendering Effects ---

    // 1. Paint Layer: Renders background + applied colors. 
    // This is "heavy" and should only run when images load or colors are applied.
    useEffect(() => {
        if (!cleanedImage || !maskData || !canvasRef.current || !normalImage) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        // sync dimensions
        if (canvas.width !== maskData.width) {
            canvas.width = maskData.width;
            canvas.height = maskData.height;
        }

        // Draw base
        ctx.drawImage(cleanedImage, 0, 0);

        // Apply Paint
        if (appliedColors.size > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Create temp canvas for normals to read pixel data easily
            // Optimization: Keep a persistent offscreen canvas for normals if memory allows, 
            // but creating one here is acceptable for this frequency.
            const normalCanvas = document.createElement('canvas');
            normalCanvas.width = maskData.width;
            normalCanvas.height = maskData.height;
            const normalCtx = normalCanvas.getContext('2d', { willReadFrequently: true });

            if (normalCtx) {
                normalCtx.drawImage(normalImage, 0, 0);
                const normalData = normalCtx.getImageData(0, 0, maskData.width, maskData.height);

                // Pixel processing loop
                const pixels = imageData.data;
                const normals = normalData.data;

                for (const mask of maskData.masks) {
                    const colorHex = appliedColors.get(mask.id);
                    if (!colorHex) continue;

                    const paintRgb = hexToRgb(colorHex);

                    for (let i = 0; i < mask.pixelIndices.length; i++) {
                        const pIdx = mask.pixelIndices[i];
                        const idx = pIdx * 4;

                        // Inline pixel access for speed
                        const baseR = pixels[idx];
                        const baseG = pixels[idx + 1];
                        const baseB = pixels[idx + 2];

                        const normR = normals[idx];
                        const normG = normals[idx + 1];
                        const normB = normals[idx + 2];

                        const [r, g, b] = applyPaintColor(
                            [baseR, baseG, baseB],
                            paintRgb,
                            [normR, normG, normB]
                        );

                        pixels[idx] = r;
                        pixels[idx + 1] = g;
                        pixels[idx + 2] = b;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
            }
        }
    }, [cleanedImage, normalImage, maskData, appliedColors]);

    // 2. Overlay Layer: Renders selection highlights.
    // This is "fast" and runs on interactions (hover/select).
    useEffect(() => {
        if (!maskData || !overlayCanvasRef.current) return;

        const canvas = overlayCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== maskData.width) {
            canvas.width = maskData.width;
            canvas.height = maskData.height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // X-Ray Mode
        if (viewMode === 'all-masks') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            for (const mask of maskData.masks) {
                const [r, g, b] = hexToRgb(mask.displayColor);
                for (let i = 0; i < mask.pixelIndices.length; i++) {
                    const idx = mask.pixelIndices[i] * 4;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 180;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        // Selection Highlight
        else if (selectedMaskIds.size > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            for (const mask of maskData.masks) {
                if (!selectedMaskIds.has(mask.id)) continue;

                for (let i = 0; i < mask.pixelIndices.length; i++) {
                    const idx = mask.pixelIndices[i] * 4;
                    data[idx] = 0;   // R
                    data[idx + 1] = 200; // G
                    data[idx + 2] = 255; // B
                    data[idx + 3] = 100; // A
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
    }, [maskData, selectedMaskIds, viewMode]);


    // --- Interaction Handlers ---

    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!maskData || !pixelLookup || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Map client coords to canvas coords
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);

        const mask = findMaskAtPoint(x, y, maskData, pixelLookup);
        if (!mask) return;

        if (e.shiftKey) {
            // Instant Paint
            if (activePaintColor) {
                setAppliedColors(prev => new Map(prev).set(mask.id, activePaintColor));
            }
            return;
        }

        setSelectedMaskIds(prev => {
            const newSet = new Set(prev);
            if (e.altKey || e.metaKey) {
                // Smart select
                const similar = findSimilarMasks(mask, maskData.masks);
                similar.forEach(m => newSet.add(m.id));
            } else {
                newSet.clear();
                newSet.add(mask.id);
            }
            return newSet;
        });
    }, [maskData, pixelLookup, activePaintColor]);

    const applyColorToSelection = useCallback(() => {
        if (selectedMaskIds.size === 0 || !activePaintColor) return;
        setAppliedColors(prev => {
            const next = new Map(prev);
            selectedMaskIds.forEach(id => next.set(id, activePaintColor));
            return next;
        });
        setSelectedMaskIds(new Set());
    }, [selectedMaskIds, activePaintColor]);

    const clearColors = useCallback(() => {
        setAppliedColors(new Map());
        setSelectedMaskIds(new Set());
    }, []);

    const handleExport = useCallback((format: 'png' | 'jpeg') => {
        if (!canvasRef.current || !maskData) return;
        try {
            const dataUrl = canvasRef.current.toDataURL(`image/${format}`, 0.9);
            const link = document.createElement('a');
            link.download = `colorcraft-project-${maskData.imageSetId}.${format}`;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setIsShareOpen(false);
        } catch (err) {
            console.error('Export failed', err);
        }
    }, [maskData]);

    const copyToClipboard = useCallback((text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    }, []);


    // --- Computed Values ---

    const stats = useMemo(() => maskData
        ? calculateSelectionStats(selectedMaskIds, maskData.masks)
        : { maskCount: 0, pixelCount: 0 },
        [maskData, selectedMaskIds]);

    const activeColorDetails = useMemo(() =>
        PALETTE_WITH_DETAILS.find(c => c.hex === activePaintColor),
        [activePaintColor]);


    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans selection:bg-white/20">
            {/* Navbar */}
            <nav className="flex items-center justify-between px-6 py-4 sticky top-0 z-50 bg-black border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-white" />
                    <span className="text-sm font-semibold tracking-wide">ColorCraft</span>
                    <span className="text-gray-600">/</span>
                    <span className="text-sm text-gray-400">Project {maskData?.imageSetId ?? '...'}</span>
                </div>

                <div className="flex items-center gap-4">
                    <select
                        value={currentSetId}
                        onChange={(e) => setCurrentSetId(e.target.value)}
                        className="bg-black text-xs font-medium border border-white/10 rounded-md px-3 py-1.5 focus:outline-none focus:border-white/30 transition-colors text-white hover:border-white/20 cursor-pointer"
                    >
                        {IMAGE_SETS.map(set => (
                            <option key={set.id} value={set.id}>{set.name}</option>
                        ))}
                    </select>

                    <div className="relative">
                        <button
                            onClick={() => setIsShareOpen(!isShareOpen)}
                            className="px-4 py-1.5 bg-white text-black text-xs font-semibold rounded-md hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                            Export
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className={`transition-transform duration-200 ${isShareOpen ? 'rotate-180' : ''}`}>
                                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        {isShareOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsShareOpen(false)} />
                                <div className="absolute top-full right-0 mt-2 w-32 bg-[#0A0A0A] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 flex flex-col py-1">
                                    <button
                                        onClick={() => handleExport('png')}
                                        className="px-4 py-2 text-left text-[10px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                                    >
                                        PNG Image
                                    </button>
                                    <button
                                        onClick={() => handleExport('jpeg')}
                                        className="px-4 py-2 text-left text-[10px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                                    >
                                        JPG Image
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </nav>

            <main className="flex-1 overflow-hidden grid grid-cols-[1fr_320px]">
                {/* Canvas Area */}
                <div className="relative bg-black flex flex-col items-center justify-center p-8 group">
                    <div className="absolute top-6 left-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                        <div className="bg-black border border-white/10 rounded px-3 py-1.5 shadow-xl">
                            <p className="text-[10px] text-gray-400 font-mono">SHIFT + CLICK TO PAINT</p>
                        </div>
                    </div>

                    <div className={`relative transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
                        <canvas
                            ref={canvasRef}
                            className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl shadow-black"
                            style={{ cursor: 'crosshair' }}
                        />
                        <canvas
                            ref={overlayCanvasRef}
                            onClick={handleCanvasClick}
                            className="absolute top-0 left-0 max-w-full max-h-[85vh] object-contain rounded-md transition-transform duration-200"
                            style={{ cursor: 'crosshair' }}
                        />
                    </div>

                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        </div>
                    )}
                    {error && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <span className="text-red-500 text-sm font-mono">{error} - Check Console</span>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <aside className="border-l border-white/10 bg-black flex flex-col h-full">

                    {/* Header */}
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Properties</span>
                        <div className="flex gap-3 text-[10px] font-mono text-gray-500">
                            <span>{stats.maskCount} REGIONS</span>
                            <span>{(stats.pixelCount / 1000).toFixed(1)}K PX</span>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 custom-scrollbar">

                        {/* View Controls */}
                        <div>
                            <div className="flex p-0.5 rounded-lg border border-white/10 bg-gray-900/50">
                                <button
                                    onClick={() => setViewMode('normal')}
                                    className={`flex-1 py-1.5 rounded-md text-[10px] font-semibold tracking-wide transition-all ${viewMode === 'normal'
                                        ? 'bg-gray-800 text-white shadow-sm'
                                        : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    REALISTIC
                                </button>
                                <button
                                    onClick={() => setViewMode('all-masks')}
                                    className={`flex-1 py-1.5 rounded-md text-[10px] font-semibold tracking-wide transition-all ${viewMode === 'all-masks'
                                        ? 'bg-gray-800 text-white shadow-sm'
                                        : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    X-RAY
                                </button>
                            </div>
                        </div>

                        {/* Palette Grid & Details */}
                        <div className="flex-1 flex flex-col min-h-0 gap-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-white">Materials</span>
                                <span className="text-[10px] text-gray-500 font-mono">{PAINT_PALETTE.length}</span>
                            </div>

                            <div className="grid grid-cols-5 gap-2 content-start">
                                {PALETTE_WITH_DETAILS.map(color => (
                                    <button
                                        key={color.id}
                                        onClick={() => setActivePaintColor(color.hex)}
                                        className={`aspect-square rounded-md transition-all duration-200 relative group ${activePaintColor === color.hex
                                            ? 'ring-2 ring-white ring-offset-2 ring-offset-black z-10'
                                            : 'hover:scale-110 hover:z-10 hover:ring-1 hover:ring-white/50 opacity-80 hover:opacity-100'
                                            }`}
                                        style={{ backgroundColor: color.hex }}
                                        title={color.name}
                                    />
                                ))}
                            </div>

                            {/* Details Panel */}
                            <div className="mt-auto flex flex-col gap-3">
                                {activeColorDetails && (
                                    <div className="bg-[#0A0A0A] border border-white/10 rounded-xl overflow-hidden shadow-inner">
                                        {/* Header */}
                                        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                            <div className="flex items-center gap-3">
                                                <div className="w-4 h-4 rounded-full ring-1 ring-white/20" style={{ backgroundColor: activeColorDetails.hex }} />
                                                <span className="text-sm font-bold text-gray-200">{activeColorDetails.name}</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">CSS Variables</span>
                                        </div>

                                        {/* Code Block */}
                                        <div className="p-4 space-y-3 font-mono text-[10px] leading-relaxed">
                                            {/* OKLCH */}
                                            <button
                                                className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                onClick={() => copyToClipboard(activeColorDetails.oklchString, 'oklch')}
                                            >
                                                <div className="flex items-center gap-3 text-gray-400">
                                                    <span className="w-8 text-rose-400">oklch</span>
                                                    <span className="text-gray-300">({activeColorDetails.oklchVal})</span>
                                                </div>
                                                <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'oklch' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                    {copiedField === 'oklch' ? 'COPIED' : 'COPY'}
                                                </span>
                                            </button>

                                            {/* HSL */}
                                            <button
                                                className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                onClick={() => copyToClipboard(activeColorDetails.hslString, 'hsl')}
                                            >
                                                <div className="flex items-center gap-3 text-gray-400">
                                                    <span className="w-8 text-blue-400">hsl</span>
                                                    <span className="text-gray-300">({Math.round(activeColorDetails.hsl.h)} {Math.round(activeColorDetails.hsl.s * 100)}% {Math.round(activeColorDetails.hsl.l * 100)}%)</span>
                                                </div>
                                                <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'hsl' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                    {copiedField === 'hsl' ? 'COPIED' : 'COPY'}
                                                </span>
                                            </button>

                                            {/* HEX */}
                                            <button
                                                className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                onClick={() => copyToClipboard(activeColorDetails.hex, 'hex')}
                                            >
                                                <div className="flex items-center gap-3 text-gray-400">
                                                    <span className="w-8 text-emerald-400">hex</span>
                                                    <span className="text-gray-300">{activeColorDetails.hex.toLowerCase()}</span>
                                                </div>
                                                <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'hex' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                    {copiedField === 'hex' ? 'COPIED' : 'COPY'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Actions Footer */}
                    <div className="p-4 border-t border-white/10 bg-black space-y-2">
                        <button
                            onClick={applyColorToSelection}
                            disabled={selectedMaskIds.size === 0}
                            className="w-full py-2.5 bg-white text-black text-xs font-semibold rounded-md 
                                disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
                        >
                            {selectedMaskIds.size > 0 ? 'Apply Paint' : 'Select Region'}
                        </button>
                        <button
                            onClick={clearColors}
                            className="w-full py-2 text-[10px] font-medium text-gray-500 hover:text-white transition-colors"
                        >
                            Reset Canvas
                        </button>
                    </div>

                </aside>
            </main>
        </div>
    );
}
