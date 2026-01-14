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

        setSelectedMaskIds(prev => {
            const newSet = new Set(prev);

            if (e.shiftKey) {
                // SHIFT+click: Toggle mask in selection
                if (newSet.has(mask.id)) {
                    newSet.delete(mask.id);
                } else {
                    newSet.add(mask.id);
                }
            } else if (e.altKey || e.metaKey) {
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
    }, [maskData, pixelLookup]);

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
        <div className={`flex flex-col h-screen bg-gray-900 ${className ?? ''}`}>
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
                <h1 className="text-2xl font-bold text-white">
                    🎨 ColorCraft Paint Visualizer
                </h1>

                {/* Image Set Selector */}
                <div className="flex items-center gap-4">
                    <label className="text-gray-300">Image Set:</label>
                    <select
                        value={currentSetId}
                        onChange={(e) => setCurrentSetId(e.target.value)}
                        className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {IMAGE_SETS.map(set => (
                            <option key={set.id} value={set.id}>
                                {set.name}
                            </option>
                        ))}
                    </select>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Canvas Area */}
                <div className="flex-1 relative overflow-auto bg-gray-950 flex items-center justify-center p-4">
                    {isLoading ? (
                        <div className="text-white text-xl">Loading...</div>
                    ) : error ? (
                        <div className="text-red-500 text-xl">{error}</div>
                    ) : (
                        <div className="relative inline-block">
                            <canvas
                                ref={canvasRef}
                                className="max-w-full max-h-full object-contain"
                                style={{ cursor: 'crosshair' }}
                            />
                            <canvas
                                ref={overlayCanvasRef}
                                onClick={handleCanvasClick}
                                className="absolute top-0 left-0 max-w-full max-h-full object-contain"
                                style={{ cursor: 'crosshair' }}
                            />
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <aside className="w-80 bg-gray-800 border-l border-gray-700 p-6 flex flex-col gap-6 overflow-y-auto">
                    {/* View Mode Toggle */}
                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3">View Mode</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setViewMode('normal')}
                                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${viewMode === 'normal'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                            >
                                Normal
                            </button>
                            <button
                                onClick={() => setViewMode('all-masks')}
                                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${viewMode === 'all-masks'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                            >
                                All Masks
                            </button>
                        </div>
                    </section>

                    {/* Color Palette */}
                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3">Paint Colors</h3>
                        <div className="grid grid-cols-3 gap-3">
                            {PAINT_PALETTE.map(color => (
                                <button
                                    key={color.id}
                                    onClick={() => setActivePaintColor(color.hex)}
                                    className={`aspect-square rounded-lg transition-transform hover:scale-105 ${activePaintColor === color.hex
                                        ? 'ring-4 ring-white ring-offset-2 ring-offset-gray-800'
                                        : ''
                                        }`}
                                    style={{ backgroundColor: color.hex }}
                                    title={color.name}
                                />
                            ))}
                        </div>
                    </section>

                    {/* Selection Stats */}
                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3">Selection</h3>
                        <div className="bg-gray-700 rounded-lg p-4 space-y-2">
                            <p className="text-gray-300">
                                <span className="font-semibold text-white">{stats.maskCount}</span> masks selected
                            </p>
                            <p className="text-gray-300">
                                <span className="font-semibold text-white">{stats.pixelCount.toLocaleString()}</span> pixels
                            </p>
                        </div>
                    </section>

                    {/* Actions */}
                    <section className="space-y-3">
                        <button
                            onClick={applyColorToSelection}
                            disabled={selectedMaskIds.size === 0}
                            className="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-lg 
                         hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed
                         transition-colors"
                        >
                            Apply Color
                        </button>

                        <button
                            onClick={clearColors}
                            className="w-full px-4 py-3 bg-gray-700 text-white font-semibold rounded-lg 
                         hover:bg-gray-600 transition-colors"
                        >
                            Reset All
                        </button>
                    </section>

                    {/* Instructions */}
                    <section className="mt-auto">
                        <h3 className="text-lg font-semibold text-white mb-3">Instructions</h3>
                        <ul className="text-gray-400 text-sm space-y-2">
                            <li>• <strong>Click</strong> to select a region</li>
                            <li>• <strong>Shift+Click</strong> to add/remove regions</li>
                            <li>• <strong>⌘/Alt+Click</strong> for smart select</li>
                            <li>• Pick a color and click Apply</li>
                        </ul>
                    </section>

                    {/* Stats */}
                    {maskData && (
                        <section className="text-gray-500 text-xs">
                            <p>Image: {maskData.width}×{maskData.height}</p>
                            <p>Total masks: {maskData.masks.length}</p>
                        </section>
                    )}
                </aside>
            </div>
        </div>
    );
}
