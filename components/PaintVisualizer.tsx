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
import { hexToRgb, rgbToHsl, applyPaintColor } from '@/lib/colorUtils';

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
    const [copiedField, setCopiedField] = useState<string | null>(null);

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
            {/* Minimal Navbar */}
            <nav className="flex items-center justify-between px-6 py-4 sticky top-0 z-50 bg-black border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-white" />
                    <span className="text-sm font-semibold tracking-wide">ColorCraft</span>
                    <span className="text-gray-600">/</span>
                    <span className="text-sm text-gray-400">Project {maskData?.imageSetId}</span>
                </div>

                <div className="flex items-center gap-4">
                    <select
                        value={currentSetId}
                        onChange={(e) => setCurrentSetId(e.target.value)}
                        className="bg-black text-xs font-medium border border-white/10 rounded-md px-3 py-1.5 focus:outline-none focus:border-white/30 transition-colors text-white hover:border-white/20 cursor-pointer"
                    >
                        {IMAGE_SETS.map(set => (
                            <option key={set.id} value={set.id}>
                                {set.name}
                            </option>
                        ))}
                    </select>

                    <button className="px-4 py-1.5 bg-white text-black text-xs font-semibold rounded-md hover:bg-gray-200 transition-colors">
                        Share
                    </button>
                </div>
            </nav>

            {/* Main Content using Grid Layout */}
            <main className="flex-1 overflow-hidden grid grid-cols-[1fr_320px]">

                {/* Canvas Area */}
                <div className="relative bg-black flex flex-col items-center justify-center p-8 group">
                    {/* Minimal instructions */}
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

                    {/* Loading State */}
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        </div>
                    )}
                    {error && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <span className="text-red-500 text-sm font-mono">{error}</span>
                        </div>
                    )}
                </div>

                {/* Sidebar - Fixed to right, flat design */}
                <aside className="border-l border-white/10 bg-black flex flex-col h-full">

                    {/* Header with minimal stats */}
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Properties</span>
                        <div className="flex gap-3 text-[10px] font-mono text-gray-500">
                            <span>{stats.maskCount} REGIONS</span>
                            <span>{(stats.pixelCount / 1000).toFixed(1)}K PX</span>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 custom-scrollbar">

                        {/* View Mode - Segmented Control */}
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

                        {/* Palette - Compact Grid & Details */}
                        <div className="flex-1 flex flex-col min-h-0 gap-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-white">Materials</span>
                                <span className="text-[10px] text-gray-500 font-mono">{PAINT_PALETTE.length}</span>
                            </div>

                            {/* Color Grid */}
                            <div className="grid grid-cols-5 gap-2 content-start">
                                {PAINT_PALETTE.map(color => (
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

                            {/* Selected Color Details - Code Style */}
                            <div className="mt-auto flex flex-col gap-3">
                                {(() => {
                                    const activeColor = PAINT_PALETTE.find(c => c.hex === activePaintColor);
                                    if (!activeColor) return null;

                                    const rgb = hexToRgb(activeColor.hex);
                                    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
                                    const hslString = `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%)`;

                                    const copyToClipboard = (text: string, field: string) => {
                                        navigator.clipboard.writeText(text);
                                        setCopiedField(field);
                                        setTimeout(() => setCopiedField(null), 2000);
                                    };

                                    return (
                                        <div className="bg-[#0A0A0A] border border-white/10 rounded-xl overflow-hidden shadow-inner">
                                            {/* Header */}
                                            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-4 h-4 rounded-full ring-1 ring-white/20" style={{ backgroundColor: activeColor.hex }} />
                                                    <span className="text-sm font-bold text-gray-200">{activeColor.name}</span>
                                                </div>
                                                <span className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">CSS Variables</span>
                                            </div>

                                            {/* Code Block */}
                                            <div className="p-4 space-y-3 font-mono text-[10px] leading-relaxed">

                                                {/* OKLCH */}
                                                <button
                                                    className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                    onClick={() => copyToClipboard(`oklch(${activeColor.oklch})`, 'oklch')}
                                                >
                                                    <div className="flex items-center gap-3 text-gray-400">
                                                        <span className="w-8 text-rose-400">oklch</span>
                                                        <span className="text-gray-300">({activeColor.oklch.split('/')[0]})</span>
                                                    </div>
                                                    <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'oklch' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                        {copiedField === 'oklch' ? 'COPIED' : 'COPY'}
                                                    </span>
                                                </button>

                                                {/* HSL */}
                                                <button
                                                    className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                    onClick={() => copyToClipboard(hslString, 'hsl')}
                                                >
                                                    <div className="flex items-center gap-3 text-gray-400">
                                                        <span className="w-8 text-blue-400">hsl</span>
                                                        <span className="text-gray-300">({Math.round(hsl.h)} {Math.round(hsl.s * 100)}% {Math.round(hsl.l * 100)}%)</span>
                                                    </div>
                                                    <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'hsl' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                        {copiedField === 'hsl' ? 'COPIED' : 'COPY'}
                                                    </span>
                                                </button>

                                                {/* HEX */}
                                                <button
                                                    className="w-full group flex items-center justify-between hover:bg-white/5 -mx-2 px-2 py-1 rounded transition-colors cursor-pointer text-left"
                                                    onClick={() => copyToClipboard(activeColor.hex, 'hex')}
                                                >
                                                    <div className="flex items-center gap-3 text-gray-400">
                                                        <span className="w-8 text-emerald-400">hex</span>
                                                        <span className="text-gray-300">{activeColor.hex.toLowerCase()}</span>
                                                    </div>
                                                    <span className={`text-[9px] uppercase tracking-widest transition-all duration-300 ${copiedField === 'hex' ? 'opacity-100 text-green-400 font-bold' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                                        {copiedField === 'hex' ? 'COPIED' : 'COPY'}
                                                    </span>
                                                </button>

                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    {/* Footer - Minimal Actions */}
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
