'use client';

/**
 * PaintVisualizer - Main component for the ColorCraft Paint Visualizer
 *
 * Optimized & Gamified:
 * - Framer Motion animations for premium feel.
 * - "Export Utilized Palette" feature.
 * - Split rendering for performance.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy, Download, X, Share2, Palette, FileJson, FileCode } from 'lucide-react';
import type { MaskData, ViewMode } from '@/lib/types';
import { IMAGE_SETS, PAINT_PALETTE } from '@/lib/types';
import { loadMaskData, buildPixelLookup, findMaskAtPoint, calculateSelectionStats, findSimilarMasks } from '@/lib/maskUtils';
import { hexToRgb, rgbToHsl, applyPaintColor } from '@/lib/colorUtils';

// --- Constants & Pre-calculations ---

const PALETTE_WITH_DETAILS = PAINT_PALETTE.map(color => {
    const rgb = hexToRgb(color.hex);
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return {
        ...color,
        rgb,
        hsl,
        oklchString: `oklch(${color.oklch})`,
        hslString: `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%)`,
        oklchVal: color.oklch.split('/')[0],
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

                const [data, cleanedImg, normalImg] = await Promise.all([
                    loadMaskData(setId),
                    loadImage(`${currentSet.basePath}/cleaned.png`),
                    loadImage(`${currentSet.basePath}/normals.png`)
                ]);

                if (!isMounted) return;

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
        img.onerror = () => {
            console.error(`Failed to load image at ${src}`);
            reject(new Error(`Failed to load image: ${src}`));
        };
    });
}

// --- Sub-Components ---

const PaletteExportModal = ({
    isOpen,
    onClose,
    usedColors
}: {
    isOpen: boolean;
    onClose: () => void;
    usedColors: typeof PALETTE_WITH_DETAILS
}) => {
    const [copiedType, setCopiedType] = useState<'json' | 'css' | null>(null);

    const handleCopy = (type: 'json' | 'css') => {
        let text = '';
        if (type === 'json') {
            text = JSON.stringify(usedColors.map(c => ({ name: c.name, hex: c.hex, okclh: c.oklch })), null, 2);
        } else {
            text = `:root {\n${usedColors.map(c => `  --color-${c.id}: ${c.hex}; /* ${c.name} */`).join('\n')}\n}`;
        }
        navigator.clipboard.writeText(text);
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 2000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
                    />
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl z-[101] overflow-hidden"
                    >
                        <div className="p-6 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Palette className="w-5 h-5 text-indigo-400" />
                                Project Palette
                            </h3>
                            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {usedColors.length === 0 ? (
                                <div className="text-center text-gray-500 py-8">
                                    No colors applied yet. Start painting!
                                </div>
                            ) : (
                                <div className="grid gap-3">
                                    {usedColors.map(color => (
                                        <div key={color.id} className="flex items-center gap-4 bg-white/5 p-3 rounded-lg border border-white/5">
                                            <div className="w-10 h-10 rounded-md shadow-sm" style={{ backgroundColor: color.hex }} />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-sm text-gray-200">{color.name}</p>
                                                <p className="text-xs text-gray-500 font-mono">{color.hex}</p>
                                            </div>
                                            <div className="text-xs text-gray-600 font-mono">
                                                {color.oklchVal}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-white/5 border-t border-white/10 flex gap-3">
                            <button
                                onClick={() => handleCopy('json')}
                                disabled={usedColors.length === 0}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {copiedType === 'json' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <FileJson className="w-3.5 h-3.5" />}
                                {copiedType === 'json' ? 'Copied JSON' : 'Copy JSON'}
                            </button>
                            <button
                                onClick={() => handleCopy('css')}
                                disabled={usedColors.length === 0}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white text-black hover:bg-gray-200 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {copiedType === 'css' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <FileCode className="w-3.5 h-3.5" />}
                                {copiedType === 'css' ? 'Copied CSS' : 'Copy CSS'}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

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
    const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);

    // Data Load
    const { maskData, pixelLookup, cleanedImage, normalImage, isLoading, error } = usePaintData(currentSetId);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const isInitialMount = useRef(true);

    // Persistence: Load state on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('colourziller-storage-v1');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.currentSetId) setCurrentSetId(data.currentSetId);
                // Note: We don't reset here because we want to keep the loaded colors
                if (data.activePaintColor) setActivePaintColor(data.activePaintColor);
                if (data.appliedColors) setAppliedColors(new Map(data.appliedColors));
            }
        } catch (e) {
            console.error('Failed to load state', e);
        }
    }, []);

    // Persistence: Save state on change
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        try {
            const state = {
                currentSetId,
                activePaintColor,
                appliedColors: Array.from(appliedColors.entries())
            };
            localStorage.setItem('colourziller-storage-v1', JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save state', e);
        }
    }, [currentSetId, activePaintColor, appliedColors]);

    // Handle Image Set Change
    const handleSetChange = (newId: string) => {
        setCurrentSetId(newId);
        // Clear state only when manually changing sets
        setSelectedMaskIds(new Set());
        setAppliedColors(new Map());
    };

    // --- Rendering Effects (Paint & Overlay) ---
    // Kept identical to optimized version for performance, just wrapped in standard useEffects

    useEffect(() => {
        if (!cleanedImage || !maskData || !canvasRef.current || !normalImage) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        if (canvas.width !== maskData.width) {
            canvas.width = maskData.width;
            canvas.height = maskData.height;
        }
        ctx.drawImage(cleanedImage, 0, 0);

        if (appliedColors.size > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const normalCanvas = document.createElement('canvas'); // Optimization: could be cached
            normalCanvas.width = maskData.width;
            normalCanvas.height = maskData.height;
            const normalCtx = normalCanvas.getContext('2d', { willReadFrequently: true });

            if (normalCtx) {
                normalCtx.drawImage(normalImage, 0, 0);
                const normalData = normalCtx.getImageData(0, 0, maskData.width, maskData.height);
                const pixels = imageData.data;
                const normals = normalData.data;

                for (const mask of maskData.masks) {
                    const colorHex = appliedColors.get(mask.id);
                    if (!colorHex) continue;
                    const paintRgb = hexToRgb(colorHex);

                    for (let i = 0; i < mask.pixelIndices.length; i++) {
                        const pIdx = mask.pixelIndices[i];
                        const idx = pIdx * 4;
                        const [r, g, b] = applyPaintColor(
                            [pixels[idx], pixels[idx + 1], pixels[idx + 2]],
                            paintRgb,
                            [normals[idx], normals[idx + 1], normals[idx + 2]]
                        );
                        pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
            }
        }
    }, [cleanedImage, normalImage, maskData, appliedColors]);

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

        if (viewMode === 'all-masks') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (const mask of maskData.masks) {
                const [r, g, b] = hexToRgb(mask.displayColor);
                for (let i = 0; i < mask.pixelIndices.length; i++) {
                    const idx = mask.pixelIndices[i] * 4;
                    data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 180;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        } else if (selectedMaskIds.size > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (const mask of maskData.masks) {
                if (!selectedMaskIds.has(mask.id)) continue;
                for (let i = 0; i < mask.pixelIndices.length; i++) {
                    const idx = mask.pixelIndices[i] * 4;
                    data[idx] = 0; data[idx + 1] = 200; data[idx + 2] = 255; data[idx + 3] = 100;
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
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);

        const mask = findMaskAtPoint(x, y, maskData, pixelLookup);
        if (!mask) return;

        if (e.shiftKey) {
            if (activePaintColor) setAppliedColors(prev => new Map(prev).set(mask.id, activePaintColor));
            return;
        }

        setSelectedMaskIds(prev => {
            const newSet = new Set(prev);
            if (e.altKey || e.metaKey) {
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

    const utilizedPalette = useMemo(() => {
        const usedHexes = Array.from(new Set(appliedColors.values()));
        return PALETTE_WITH_DETAILS.filter(c => usedHexes.includes(c.hex));
    }, [appliedColors]);


    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans selection:bg-white/20">
            {/* Navbar */}
            <nav className="flex items-center justify-between px-6 py-4 sticky top-0 z-50 bg-black border-b border-white/10">
                <div className="flex items-center gap-3">
                    <motion.img
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        src="/logo.svg"
                        alt="Colourziller"
                        className="w-8 h-8"
                    />
                    <span className="text-sm font-semibold tracking-wide">Colourziller</span>
                    <span className="text-gray-600">/</span>
                    <span className="text-sm text-gray-400">Project {maskData?.imageSetId ?? '...'}</span>
                </div>

                <div className="flex items-center gap-4">
                    <select
                        value={currentSetId}
                        onChange={(e) => handleSetChange(e.target.value)}
                        className="bg-black text-xs font-medium border border-white/10 rounded-md px-3 py-1.5 focus:outline-none focus:border-white/30 transition-colors text-white hover:border-white/20 cursor-pointer"
                    >
                        {IMAGE_SETS.map(set => (
                            <option key={set.id} value={set.id}>{set.name}</option>
                        ))}
                    </select>

                    <div className="relative">
                        <motion.button
                            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                            onClick={() => setIsShareOpen(!isShareOpen)}
                            className="px-4 py-1.5 bg-white text-black text-xs font-semibold rounded-md hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                            Export
                            <Share2 className="w-3 h-3" />
                        </motion.button>

                        <AnimatePresence>
                            {isShareOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsShareOpen(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                                        className="absolute top-full right-0 mt-2 w-32 bg-[#0A0A0A] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 flex flex-col py-1"
                                    >
                                        <button onClick={() => handleExport('png')} className="px-4 py-2 text-left text-[10px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2">
                                            <Download className="w-3 h-3" /> PNG Image
                                        </button>
                                        <button onClick={() => handleExport('jpeg')} className="px-4 py-2 text-left text-[10px] text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2">
                                            <Download className="w-3 h-3" /> JPG Image
                                        </button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </nav>

            <main className="flex-1 overflow-hidden grid grid-cols-[1fr_320px]">
                {/* Canvas Area */}
                <div className="relative bg-black flex flex-col items-center justify-center p-8 group">
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                        className="absolute top-6 left-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    >
                        <div className="bg-black border border-white/10 rounded px-3 py-1.5 shadow-xl">
                            <p className="text-[10px] text-gray-400 font-mono">SHIFT + CLICK TO PAINT</p>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: isLoading ? 0 : 1, scale: 1 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        className="relative"
                    >
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
                    </motion.div>

                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                            <motion.div
                                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full"
                            />
                        </div>
                    )}
                    {error && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <span className="text-red-500 text-sm font-mono">{error}</span>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <motion.aside
                    initial={{ x: 50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4 }}
                    className="border-l border-white/10 bg-black flex flex-col h-full"
                >

                    {/* Header */}
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Properties</span>
                        <div className="flex gap-3 text-[10px] font-mono text-gray-500">
                            <motion.span key={stats.maskCount} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                                {stats.maskCount} REGIONS
                            </motion.span>
                            <span>{(stats.pixelCount / 1000).toFixed(1)}K PX</span>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 custom-scrollbar">

                        {/* View Controls */}
                        <div>
                            <div className="flex p-0.5 rounded-lg border border-white/10 bg-gray-900/50">
                                {(['normal', 'all-masks'] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        className={`relative flex-1 py-1.5 rounded-md text-[10px] font-semibold tracking-wide transition-all z-10 ${viewMode === mode ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        {viewMode === mode && (
                                            <motion.div layoutId="viewMode" className="absolute inset-0 bg-gray-800 rounded-md shadow-sm -z-10" />
                                        )}
                                        {mode === 'normal' ? 'REALISTIC' : 'X-RAY'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Palette Grid & Details */}
                        <div className="flex-1 flex flex-col min-h-0 gap-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-white">Materials</span>
                                <span className="text-[10px] text-gray-500 font-mono">{PAINT_PALETTE.length}</span>
                            </div>

                            <motion.div
                                className="grid grid-cols-5 gap-2 content-start"
                                variants={{ show: { transition: { staggerChildren: 0.02 } } }}
                                initial="hidden" animate="show"
                            >
                                {PALETTE_WITH_DETAILS.map(color => (
                                    <motion.button
                                        key={color.id}
                                        variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}
                                        whileHover={{ scale: 1.15, zIndex: 10, transition: { duration: 0.2 } }}
                                        whileTap={{ scale: 0.9 }}
                                        onClick={() => setActivePaintColor(color.hex)}
                                        className={`aspect-square rounded-md relative group ${activePaintColor === color.hex ? 'ring-2 ring-white ring-offset-2 ring-offset-black z-10' : 'opacity-80 hover:opacity-100'}`}
                                        style={{ backgroundColor: color.hex }}
                                        title={color.name}
                                    />
                                ))}
                            </motion.div>

                            {/* Details Panel */}
                            <div className="mt-auto flex flex-col gap-3">
                                <AnimatePresence mode="wait">
                                    {activeColorDetails && (
                                        <motion.div
                                            key={activeColorDetails.id}
                                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                                            className="bg-[#0A0A0A] border border-white/10 rounded-xl overflow-hidden shadow-inner"
                                        >
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
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>

                    {/* Actions Footer */}
                    <div className="p-4 border-t border-white/10 bg-black">
                        <div className="bg-[#0A0A0A] border border-white/10 rounded-xl p-3 space-y-2">
                            <motion.button
                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                                onClick={applyColorToSelection}
                                disabled={selectedMaskIds.size === 0}
                                className="w-full py-3 bg-white text-black text-xs font-bold rounded-lg 
                                    disabled:opacity-20 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-white/5"
                            >
                                {selectedMaskIds.size > 0 ? (
                                    <>Apply Material <span className="flex items-center justify-center w-5 h-5 bg-black text-white rounded-full text-[10px] font-mono">{selectedMaskIds.size}</span></>
                                ) : 'Select Region to Paint'}
                            </motion.button>

                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <motion.button
                                    whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.05)" }} whileTap={{ scale: 0.98 }}
                                    onClick={() => setIsPaletteModalOpen(true)}
                                    className="w-full py-2.5 bg-transparent border border-white/10 text-gray-400 text-[10px] font-medium rounded-lg hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2"
                                >
                                    <Palette className="w-3.5 h-3.5" /> Used Colors
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.05)" }} whileTap={{ scale: 0.98 }}
                                    onClick={clearColors}
                                    className="w-full py-2.5 bg-transparent border border-white/10 text-gray-400 text-[10px] font-medium rounded-lg hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2"
                                >
                                    <Share2 className="w-3.5 h-3.5 rotate-180" /> Reset
                                </motion.button>
                            </div>
                        </div>
                    </div>

                </motion.aside>
            </main>

            {/* Modals */}
            <PaletteExportModal
                isOpen={isPaletteModalOpen}
                onClose={() => setIsPaletteModalOpen(false)}
                usedColors={utilizedPalette}
            />
        </div>
    );
}
