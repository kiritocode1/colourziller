'use client';

/**
 * PaintVisualizer - Main component for the ColorCraft Paint Visualizer
 * 
 * Handles:
 * - Loading and displaying building images
 * - Mask-based region selection (click/shift+click)
 * - Color application with realistic blending
 * - View mode toggling (normal vs all-masks)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { MaskData, ViewMode } from '@/lib/types';
import { IMAGE_SETS, PAINT_PALETTE } from '@/lib/types';
import { loadMaskData, buildPixelLookup, findMaskAtPoint, calculateSelectionStats, findSimilarMasks } from '@/lib/maskUtils';
import { hexToRgb, applyPaintColor } from '@/lib/colorUtils';

interface PaintVisualizerProps {
    className?: string;
}

export default function PaintVisualizer({ className }: PaintVisualizerProps) {
    // State
    const [currentSetId, setCurrentSetId] = useState('1');
    const [maskData, setMaskData] = useState<MaskData | null>(null);
    const [pixelLookup, setPixelLookup] = useState<Int32Array | null>(null);
    const [selectedMaskIds, setSelectedMaskIds] = useState<Set<number>>(new Set());
    const [appliedColors, setAppliedColors] = useState<Map<number, string>>(new Map());
    const [viewMode, setViewMode] = useState<ViewMode>('normal');
    const [activePaintColor, setActivePaintColor] = useState<string>(PAINT_PALETTE[0].hex);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Image refs
    const [cleanedImage, setCleanedImage] = useState<HTMLImageElement | null>(null);
    const [normalImage, setNormalImage] = useState<HTMLImageElement | null>(null);

    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

    // Current image set
    const currentSet = IMAGE_SETS.find(s => s.id === currentSetId)!;

    // Load mask data and images when set changes
    useEffect(() => {
        async function loadData() {
            setIsLoading(true);
            setError(null);

            try {
                // Load mask data
                const data = await loadMaskData(currentSetId);
                setMaskData(data);

                // Build pixel lookup
                const lookup = buildPixelLookup(data);
                setPixelLookup(lookup);

                // Load images
                const cleanedImg = new Image();
                cleanedImg.crossOrigin = 'anonymous';
                cleanedImg.src = `${currentSet.basePath}/cleaned.png`;

                const normalImg = new Image();
                normalImg.crossOrigin = 'anonymous';
                normalImg.src = `${currentSet.basePath}/normals.png`;

                await Promise.all([
                    new Promise((resolve, reject) => {
                        cleanedImg.onload = resolve;
                        cleanedImg.onerror = reject;
                    }),
                    new Promise((resolve, reject) => {
                        normalImg.onload = resolve;
                        normalImg.onerror = reject;
                    }),
                ]);

                setCleanedImage(cleanedImg);
                setNormalImage(normalImg);

                // Clear selections when switching sets
                setSelectedMaskIds(new Set());
                setAppliedColors(new Map());

                setIsLoading(false);
            } catch (err) {
                console.error('Failed to load data:', err);
                const errorMessage = err instanceof Error ? err.message :
                    (typeof err === 'object' ? JSON.stringify(err) : 'Failed to load image data');
                setError(errorMessage);
                setIsLoading(false);
            }
        }

        loadData();
    }, [currentSetId, currentSet.basePath]);

    // Render canvas when data changes
    useEffect(() => {
        if (!cleanedImage || !maskData || !canvasRef.current || !overlayCanvasRef.current) {
            return;
        }

        const canvas = canvasRef.current;
        const overlay = overlayCanvasRef.current;
        const ctx = canvas.getContext('2d')!;
        const overlayCtx = overlay.getContext('2d')!;

        // Set canvas dimensions
        canvas.width = maskData.width;
        canvas.height = maskData.height;
        overlay.width = maskData.width;
        overlay.height = maskData.height;

        // Draw base image
        ctx.drawImage(cleanedImage, 0, 0);

        // Apply colors to masks
        if (appliedColors.size > 0 && normalImage) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const normalCanvas = document.createElement('canvas');
            normalCanvas.width = maskData.width;
            normalCanvas.height = maskData.height;
            const normalCtx = normalCanvas.getContext('2d')!;
            normalCtx.drawImage(normalImage, 0, 0);
            const normalData = normalCtx.getImageData(0, 0, maskData.width, maskData.height);

            for (const mask of maskData.masks) {
                const colorHex = appliedColors.get(mask.id);
                if (!colorHex) continue;

                const paintRgb = hexToRgb(colorHex);

                for (const pixelIdx of mask.pixelIndices) {
                    const dataIdx = pixelIdx * 4;

                    const baseRgb: [number, number, number] = [
                        imageData.data[dataIdx],
                        imageData.data[dataIdx + 1],
                        imageData.data[dataIdx + 2],
                    ];

                    const normalRgb: [number, number, number] = [
                        normalData.data[dataIdx],
                        normalData.data[dataIdx + 1],
                        normalData.data[dataIdx + 2],
                    ];

                    const resultRgb = applyPaintColor(baseRgb, paintRgb, normalRgb);

                    imageData.data[dataIdx] = resultRgb[0];
                    imageData.data[dataIdx + 1] = resultRgb[1];
                    imageData.data[dataIdx + 2] = resultRgb[2];
                }
            }

            ctx.putImageData(imageData, 0, 0);
        }

        // Clear overlay
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

        // Draw overlay based on view mode
        if (viewMode === 'all-masks') {
            // Show all masks with distinct colors
            const overlayData = overlayCtx.getImageData(0, 0, overlay.width, overlay.height);

            for (const mask of maskData.masks) {
                const color = hexToRgb(mask.displayColor);

                for (const pixelIdx of mask.pixelIndices) {
                    const dataIdx = pixelIdx * 4;
                    overlayData.data[dataIdx] = color[0];
                    overlayData.data[dataIdx + 1] = color[1];
                    overlayData.data[dataIdx + 2] = color[2];
                    overlayData.data[dataIdx + 3] = 180; // Semi-transparent
                }
            }

            overlayCtx.putImageData(overlayData, 0, 0);
        } else if (selectedMaskIds.size > 0) {
            // Highlight selected masks
            const overlayData = overlayCtx.getImageData(0, 0, overlay.width, overlay.height);

            for (const mask of maskData.masks) {
                if (!selectedMaskIds.has(mask.id)) continue;

                // Draw selection highlight (cyan with transparency)
                for (const pixelIdx of mask.pixelIndices) {
                    const dataIdx = pixelIdx * 4;
                    overlayData.data[dataIdx] = 0;
                    overlayData.data[dataIdx + 1] = 200;
                    overlayData.data[dataIdx + 2] = 255;
                    overlayData.data[dataIdx + 3] = 100;
                }
            }

            overlayCtx.putImageData(overlayData, 0, 0);
        }
    }, [cleanedImage, normalImage, maskData, appliedColors, selectedMaskIds, viewMode]);

    // Handle canvas click
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!maskData || !pixelLookup || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Calculate click position relative to image
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);

        // Find mask at click position
        const mask = findMaskAtPoint(x, y, maskData, pixelLookup);

        if (!mask) return;

        if (e.shiftKey) {
            // SHIFT+click: Auto apply current color
            if (activePaintColor) {
                setAppliedColors(prev => {
                    const newMap = new Map(prev);
                    newMap.set(mask.id, activePaintColor);
                    return newMap;
                });
            }
            return;
        }

        setSelectedMaskIds(prev => {
            const newSet = new Set(prev);

            if (e.altKey || e.metaKey) {
                // ALT/CMD+click: Smart select similar masks
                const similarMasks = findSimilarMasks(mask, maskData.masks);
                for (const similar of similarMasks) {
                    newSet.add(similar.id);
                }
            } else {
                // Normal click: Select only this mask
                newSet.clear();
                newSet.add(mask.id);
            }

            return newSet;
        });
    }, [maskData, pixelLookup, activePaintColor]);

    // Apply color to selected masks
    const applyColorToSelection = useCallback(() => {
        if (selectedMaskIds.size === 0 || !activePaintColor) return;

        setAppliedColors(prev => {
            const newMap = new Map(prev);
            for (const maskId of selectedMaskIds) {
                newMap.set(maskId, activePaintColor);
            }
            return newMap;
        });

        // Clear selection after applying
        setSelectedMaskIds(new Set());
    }, [selectedMaskIds, activePaintColor]);

    // Clear all applied colors
    const clearColors = useCallback(() => {
        setAppliedColors(new Map());
        setSelectedMaskIds(new Set());
    }, []);

    // Calculate selection stats
    const stats = maskData
        ? calculateSelectionStats(selectedMaskIds, maskData.masks)
        : { maskCount: 0, pixelCount: 0 };

    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans selection:bg-white/20">
            {/* Navbar */}
            <nav className="flex items-center justify-between px-8 py-6 sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-orange-400 to-purple-500" />
                    <span className="text-xl font-medium tracking-tight">ColorCraft</span>
                </div>

                <div className="flex items-center gap-8 text-sm font-medium text-gray-400">
                    <button className="hover:text-white transition-colors">Gallery</button>
                    <button className="hover:text-white transition-colors">Features</button>
                    <button className="hover:text-white transition-colors">Pricing</button>
                </div>

                <div className="flex items-center gap-4">
                    {/* Image Set Selector (Minimal) */}
                    <div className="flex items-center gap-3 bg-white/5 rounded-full px-4 py-1.5 border border-white/10 hover:bg-white/10 transition-colors">
                        <span className="text-xs text-gray-400 uppercase tracking-wider">Project</span>
                        <select
                            value={currentSetId}
                            onChange={(e) => setCurrentSetId(e.target.value)}
                            className="bg-transparent text-sm font-medium focus:outline-none appearance-none cursor-pointer text-white"
                        >
                            {IMAGE_SETS.map(set => (
                                <option key={set.id} value={set.id} className="bg-gray-900 text-white">
                                    {set.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button className="px-5 py-2 bg-white text-black text-sm font-medium rounded-full hover:bg-gray-200 transition-colors">
                        Share
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 flex overflow-hidden p-6 gap-6">
                {/* Canvas Area - The "Hero" Card */}
                <div className="flex-1 relative bg-gray-900/50 rounded-[2rem] border border-white/10 overflow-hidden flex flex-col group">
                    {/* Hover instructions overlay */}
                    <div className="absolute top-6 left-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                        <div className="bg-black/80 backdrop-blur rounded-lg px-4 py-2 border border-white/10">
                            <p className="text-xs text-gray-300 font-medium">Click to select • Shift+Click to paint</p>
                        </div>
                    </div>

                    <div className={`flex-1 relative flex items-center justify-center transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="relative shadow-2xl shadow-black/50">
                            <canvas
                                ref={canvasRef}
                                className="max-w-full max-h-[80vh] object-contain rounded-lg"
                                style={{ cursor: 'crosshair' }}
                            />
                            <canvas
                                ref={overlayCanvasRef}
                                onClick={handleCanvasClick}
                                className="absolute top-0 left-0 max-w-full max-h-[80vh] object-contain rounded-lg transition-transform duration-200"
                                style={{ cursor: 'crosshair' }}
                            />
                        </div>
                    </div>

                    {/* Loading State */}
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-20">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span className="text-sm font-medium text-gray-400">Loading scene...</span>
                            </div>
                        </div>
                    )}
                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-20">
                            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm hover:bg-red-500/20 transition-colors">{error} - Retry</button>
                        </div>
                    )}
                </div>

                {/* Sidebar Controls - "Floating Panel" style */}
                <aside className="w-80 flex flex-col h-full bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl transition-all duration-300">

                    {/* Sidebar Header: Stats */}
                    <div className="p-6 border-b border-white/5 bg-white/[0.02]">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-medium text-white tracking-tight">Properties</h2>
                            <div className="px-2 py-1 rounded-full bg-white/5 border border-white/10">
                                <span className="text-[10px] font-mono text-gray-400">ID: {maskData?.imageSetId}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 flex flex-col items-center justify-center group hover:border-white/10 transition-colors">
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 group-hover:text-gray-400 transition-colors">Regions</div>
                                <div className="text-xl font-semibold text-white">{stats.maskCount}</div>
                            </div>
                            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 flex flex-col items-center justify-center group hover:border-white/10 transition-colors">
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 group-hover:text-gray-400 transition-colors">Pixels</div>
                                <div className="text-xl font-semibold text-white">{(stats.pixelCount / 1000).toFixed(1)}k</div>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Content: Tools & Palette */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-8">

                        {/* View Mode Toggle */}
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block opacity-80">View Mode</label>
                            <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5">
                                <button
                                    onClick={() => setViewMode('normal')}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${viewMode === 'normal'
                                        ? 'bg-white/10 text-white shadow-lg shadow-black/20'
                                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                        }`}
                                >
                                    REALISTIC
                                </button>
                                <button
                                    onClick={() => setViewMode('all-masks')}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${viewMode === 'all-masks'
                                        ? 'bg-white/10 text-white shadow-lg shadow-black/20'
                                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                        }`}
                                >
                                    X-RAY
                                </button>
                            </div>
                        </div>

                        {/* Palette */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest opacity-80">Materials</label>
                                <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{PAINT_PALETTE.length} Colors</span>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                {PAINT_PALETTE.map(color => (
                                    <button
                                        key={color.id}
                                        onClick={() => setActivePaintColor(color.hex)}
                                        className={`group relative aspect-square rounded-2xl transition-all duration-300 ${activePaintColor === color.hex
                                            ? 'scale-105 shadow-xl shadow-black/50 z-10 ring-2 ring-white/50 ring-offset-2 ring-offset-black'
                                            : 'scale-100 hover:scale-105 opacity-80 hover:opacity-100 hover:ring-2 hover:ring-white/20 hover:ring-offset-2 hover:ring-offset-black/50'
                                            }`}
                                    >
                                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                                        <div className="absolute inset-0 rounded-2xl border border-black/10 pointer-events-none" />
                                        <div className="absolute inset-0 rounded-2xl" style={{ backgroundColor: color.hex }} />

                                        {/* Tooltip */}
                                        <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-medium px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap pointer-events-none translate-y-1 group-hover:translate-y-0 border border-white/10 shadow-xl z-20">
                                            {color.name}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* Sidebar Footer: Actions */}
                    <div className="p-6 border-t border-white/5 bg-black/40 backdrop-blur-md space-y-3 z-10 relative">
                        {/* Gradient shade at the top of footer to show scroll */}
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                        <button
                            onClick={applyColorToSelection}
                            disabled={selectedMaskIds.size === 0}
                            className="w-full py-4 relative overflow-hidden group rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
                        >
                            <div className={`absolute inset-0 transition-opacity duration-300 ${selectedMaskIds.size > 0 ? 'opacity-100' : 'opacity-0'}`}>
                                <div className="absolute inset-0 bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 animate-gradient-x" />
                                <div className="absolute inset-0 bg-white/20 group-hover:bg-white/30 transition-colors" />
                            </div>
                            <div className={`absolute inset-0 bg-gray-800 transition-opacity duration-300 ${selectedMaskIds.size > 0 ? 'opacity-0' : 'opacity-100'}`} />

                            <span className={`relative font-bold tracking-wide transition-colors ${selectedMaskIds.size > 0 ? 'text-white' : 'text-gray-500'}`}>
                                {selectedMaskIds.size > 0 ? 'APPLY MATERIAL' : 'SELECT REGION'}
                            </span>
                        </button>

                        <button
                            onClick={clearColors}
                            className="w-full py-3 text-xs font-medium text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                        >
                            Reset Canvas
                        </button>
                    </div>

                </aside>
            </main>
        </div>
    );
}
