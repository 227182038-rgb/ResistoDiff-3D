'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  Legend,
  ZAxis,
} from 'recharts';
import {
  Search,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  Atom,
  Crosshair,
  Box,
  FlaskConical,
  Eye,
  Circle,
  ChevronDown,
  Layers,
  Scan,
  Target,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  type ProteinTarget,
  type PocketResult,
  PROTEIN_TARGETS,
  DEMO_POCKETS,
} from '@/lib/resistodiff-data';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';

// --- Pocket type color mapping ---
const POCKET_TYPE_STYLES: Record<PocketResult['pocketType'], { badge: string; color: string; glow: string; fill: string }> = {
  cryptic: {
    badge: 'bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/25',
    color: '#f59e0b',
    glow: 'rgba(245,158,11,0.6)',
    fill: 'rgba(245,158,11,0.25)',
  },
  allosteric: {
    badge: 'bg-teal-500/15 text-teal-600 border-teal-500/30 hover:bg-teal-500/25',
    color: '#14b8a6',
    glow: 'rgba(20,184,166,0.6)',
    fill: 'rgba(20,184,166,0.25)',
  },
  'active-site': {
    badge: 'bg-rose-500/15 text-rose-600 border-rose-500/30 hover:bg-rose-500/25',
    color: '#f43f5e',
    glow: 'rgba(244,63,94,0.6)',
    fill: 'rgba(244,63,94,0.25)',
  },
};

// --- Radar chart colors for up to 4 pockets ---
const RADAR_COLORS = [
  { stroke: '#f43f5e', fill: 'rgba(244,63,94,0.15)', name: 'Pocket 1' },
  { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.15)', name: 'Pocket 2' },
  { stroke: '#14b8a6', fill: 'rgba(20,184,166,0.15)', name: 'Pocket 3' },
  { stroke: '#06b6d4', fill: 'rgba(6,182,212,0.15)', name: 'Pocket 4' },
];

// --- Custom recharts tooltip ---
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="mb-1 text-xs font-semibold text-slate-700">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
        </p>
      ))}
    </div>
  );
}

// --- SVG Molecular Viewer Placeholder ---
function MolecularViewer({ target, pockets, isDetecting }: { target: ProteinTarget; pockets: PocketResult[]; isDetecting: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-950">
      {/* Viewer container */}
      <div className="relative aspect-[4/3] w-full">
        <svg
          viewBox="0 0 600 450"
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Grid pattern */}
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="0.5" />
            </pattern>
            {/* Glow filters */}
            <filter id="glow-rose" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-amber" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-teal" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="soft-glow">
              <feGaussianBlur stdDeviation="2" />
            </filter>
            {/* Gradient for backbone */}
            <linearGradient id="backbone-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(6,182,212,0.3)" />
              <stop offset="50%" stopColor="rgba(16,185,129,0.4)" />
              <stop offset="100%" stopColor="rgba(6,182,212,0.3)" />
            </linearGradient>
            <linearGradient id="helix-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(16,185,129,0.7)" />
              <stop offset="50%" stopColor="rgba(6,182,212,0.9)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.7)" />
            </linearGradient>
            <linearGradient id="sheet-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(6,182,212,0.5)" />
              <stop offset="100%" stopColor="rgba(245,158,11,0.5)" />
            </linearGradient>
          </defs>

          {/* Background grid */}
          <rect width="600" height="450" fill="url(#grid)" />

          {/* Subtle radial vignette */}
          <radialGradient id="vignette" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="rgba(15,23,42,0)" />
            <stop offset="100%" stopColor="rgba(2,6,23,0.5)" />
          </radialGradient>
          <rect width="600" height="450" fill="url(#vignette)" />

          {/* ===== PROTEIN BACKBONE ===== */}

          {/* Alpha Helix 1 - Left side (wavy ribbon) */}
          <path
            d="M 80,80 C 85,95 75,110 80,125 C 85,140 75,155 80,170 C 85,185 75,200 80,215 C 85,230 75,245 80,260"
            stroke="url(#helix-grad)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            opacity="0.85"
          />
          {/* Helix 1 side bonds (alpha-helix style) */}
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={`h1-bond-${i}`}
              x1="80" y1={85 + i * 22}
              x2={i % 2 === 0 ? 65 : 95}
              y2={85 + i * 22 + 11}
              stroke="rgba(16,185,129,0.35)"
              strokeWidth="1.5"
            />
          ))}

          {/* Beta Sheet 1 - Top region (arrows) */}
          <path
            d="M 120,100 L 180,80 L 240,100 L 300,80 L 350,100"
            stroke="url(#sheet-grad)"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.7"
          />
          {/* Arrow heads for beta sheet */}
          <polygon points="180,75 185,82 175,82" fill="rgba(6,182,212,0.6)" />
          <polygon points="300,75 305,82 295,82" fill="rgba(245,158,11,0.6)" />
          <polygon points="350,95 358,100 350,105" fill="rgba(6,182,212,0.6)" />

          {/* Alpha Helix 2 - Center-right (vertical) */}
          <path
            d="M 200,140 C 195,160 205,175 200,195 C 195,215 205,230 200,250 C 195,270 205,285 200,305 C 195,325 205,340 200,355"
            stroke="url(#helix-grad)"
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
            opacity="0.9"
          />
          {/* Helix 2 side bonds */}
          {Array.from({ length: 10 }, (_, i) => (
            <line
              key={`h2-bond-${i}`}
              x1="200" y1={145 + i * 21}
              x2={i % 2 === 0 ? 183 : 217}
              y2={145 + i * 21 + 10.5}
              stroke="rgba(6,182,212,0.3)"
              strokeWidth="1.5"
            />
          ))}

          {/* Loop region connecting helices */}
          <path
            d="M 80,260 C 100,285 140,300 200,305"
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="3"
            fill="none"
            strokeDasharray="4,3"
          />

          {/* Alpha Helix 3 - Right side */}
          <path
            d="M 320,150 C 325,170 315,185 320,205 C 325,225 315,240 320,260 C 325,280 315,295 320,315"
            stroke="url(#helix-grad)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            opacity="0.85"
          />
          {/* Helix 3 side bonds */}
          {Array.from({ length: 8 }, (_, i) => (
            <line
              key={`h3-bond-${i}`}
              x1="320" y1={155 + i * 20}
              x2={i % 2 === 0 ? 303 : 337}
              y2={155 + i * 20 + 10}
              stroke="rgba(16,185,129,0.3)"
              strokeWidth="1.5"
            />
          ))}

          {/* Beta Sheet 2 - Bottom region */}
          <path
            d="M 130,320 L 190,340 L 250,320 L 310,340 L 370,320"
            stroke="url(#sheet-grad)"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.65"
          />
          <polygon points="190,345 195,338 185,338" fill="rgba(245,158,11,0.5)" />
          <polygon points="310,345 315,338 305,338" fill="rgba(245,158,11,0.5)" />

          {/* Loop from helix 2 to helix 3 */}
          <path
            d="M 200,305 C 240,330 280,290 320,260"
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="3"
            fill="none"
            strokeDasharray="4,3"
          />

          {/* Connecting loops top */}
          <path
            d="M 120,100 C 130,70 170,60 200,80"
            stroke="rgba(148,163,184,0.3)"
            strokeWidth="2.5"
            fill="none"
            strokeDasharray="4,3"
          />
          <path
            d="M 350,100 C 380,90 400,120 380,150 C 360,180 340,155 320,150"
            stroke="rgba(148,163,184,0.3)"
            strokeWidth="2.5"
            fill="none"
            strokeDasharray="4,3"
          />

          {/* ===== ATOM DOTS along backbone ===== */}
          {[
            ...Array.from({ length: 8 }, (_, i) => ({ x: 80, y: 85 + i * 22 })),
            { x: 120, y: 100 }, { x: 180, y: 80 }, { x: 240, y: 100 }, { x: 300, y: 80 }, { x: 350, y: 100 },
            ...Array.from({ length: 10 }, (_, i) => ({ x: 200, y: 145 + i * 21 })),
            ...Array.from({ length: 8 }, (_, i) => ({ x: 320, y: 155 + i * 20 })),
          ].map((pos, i) => (
            <circle
              key={`atom-${i}`}
              cx={pos.x}
              cy={pos.y}
              r="2.5"
              fill="rgba(226,232,240,0.7)"
            />
          ))}

          {/* ===== POCKET SPHERES ===== */}
          <AnimatePresence>
            {pockets.map((pocket, idx) => {
              const style = POCKET_TYPE_STYLES[pocket.pocketType];
              // Map pocket coordinates to SVG space
              const px = 150 + ((pocket.centerX + 30) / 60) * 300;
              const py = 100 + ((pocket.centerY + 40) / 80) * 280;
              const radius = 10 + (pocket.volume / 350) * 15;

              return (
                <g key={pocket.pocketId}>
                  {/* Outer glow pulse */}
                  <circle
                    cx={px}
                    cy={py}
                    r={radius + 8}
                    fill="none"
                    stroke={style.color}
                    strokeWidth="1"
                    opacity="0.3"
                  >
                    <animate
                      attributeName="r"
                      values={`${radius + 4};${radius + 14};${radius + 4}`}
                      dur={`${2.5 + idx * 0.5}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.4;0.1;0.4"
                      dur={`${2.5 + idx * 0.5}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                  {/* Main sphere */}
                  <circle
                    cx={px}
                    cy={py}
                    r={radius}
                    fill={style.fill}
                    stroke={style.color}
                    strokeWidth="2"
                    filter={`url(#glow-${pocket.pocketType === 'cryptic' ? 'amber' : pocket.pocketType === 'allosteric' ? 'teal' : 'rose'})`}
                  >
                    <animate
                      attributeName="r"
                      values={`${radius};${radius + 2};${radius}`}
                      dur={`${2 + idx * 0.3}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                  {/* Inner highlight */}
                  <circle
                    cx={px - radius * 0.25}
                    cy={py - radius * 0.25}
                    r={radius * 0.4}
                    fill="rgba(255,255,255,0.15)"
                  />
                  {/* Label */}
                  <text
                    x={px}
                    y={py + radius + 16}
                    textAnchor="middle"
                    fill={style.color}
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    P{pocket.pocketId}
                  </text>
                </g>
              );
            })}
          </AnimatePresence>

          {/* Scanning animation when detecting */}
          {isDetecting && (
            <g>
              <line x1="0" y1="0" x2="600" y2="0" stroke="rgba(6,182,212,0.4)" strokeWidth="2">
                <animate attributeName="y1" values="0;450;0" dur="2s" repeatCount="indefinite" />
                <animate attributeName="y2" values="0;450;0" dur="2s" repeatCount="indefinite" />
              </line>
              <rect x="0" y="0" width="600" height="3" fill="url(#backbone-grad)" opacity="0.6">
                <animate attributeName="y" values="0;447;0" dur="2s" repeatCount="indefinite" />
              </rect>
            </g>
          )}
        </svg>

        {/* Viewer Controls Overlay - Top Right */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Rotate</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200">
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Zoom In</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200">
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Zoom Out</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/80 text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200">
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Reset View</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Legend - Bottom Left */}
        <div className="absolute bottom-12 left-3 space-y-1.5 rounded-lg border border-slate-700/40 bg-slate-900/70 px-3 py-2 backdrop-blur-sm">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pocket Types</p>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-[10px] text-slate-400">Active Site</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-[10px] text-slate-400">Cryptic</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal-500" />
            <span className="text-[10px] text-slate-400">Allosteric</span>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/90 px-4 py-2">
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="font-mono">PDB: {target.pdbId}</span>
          <Separator orientation="vertical" className="h-3" />
          <span>{target.sequenceLength} residues</span>
          <Separator orientation="vertical" className="h-3" />
          <span>{pockets.length} pockets detected</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />
          <span>Interactive</span>
        </div>
      </div>
    </div>
  );
}

// --- Loading Skeleton ---
function DetectionSkeleton() {
  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-40 w-1/2 rounded-lg" />
        <Skeleton className="h-40 w-1/2 rounded-lg" />
      </div>
    </div>
  );
}

// --- Druggability/Conservation Progress Cell ---
function ScoreProgress({ value, colorClass }: { value: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <Progress value={value * 100} className="h-1.5 w-16 bg-slate-100" />
      <span className={cn('text-xs font-medium tabular-nums', colorClass)}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// --- Main DAPM Panel ---
export default function DAPMPanel() {
  const [selectedTargetId, setSelectedTargetId] = useState<string>(PROTEIN_TARGETS[0].id);
  const [gridSpacing, setGridSpacing] = useState<number[]>([1.0]);
  const [minVolume, setMinVolume] = useState('50');
  const [probeRadius, setProbeRadius] = useState<number[]>([1.4]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [pockets, setPockets] = useState<PocketResult[]>([]);
  const [hasDetected, setHasDetected] = useState(false);

  const selectedTarget = useMemo(
    () => PROTEIN_TARGETS.find(t => t.id === selectedTargetId) ?? PROTEIN_TARGETS[0],
    [selectedTargetId]
  );

  const handleDetect = useCallback(() => {
    setIsDetecting(true);
    setPockets([]);
    // Simulate detection with 1.5s loading
    setTimeout(() => {
      const demoPockets = DEMO_POCKETS[selectedTargetId];
      setPockets(demoPockets ?? DEMO_POCKETS.tem1);
      setIsDetecting(false);
      setHasDetected(true);
    }, 1500);
  }, [selectedTargetId]);

  // Radar chart data
  const radarData = useMemo(() => {
    if (pockets.length === 0) return [];
    // Normalize each metric to 0-100 for radar
    const maxVol = Math.max(...pockets.map(p => p.volume), 1);
    const maxDepth = Math.max(...pockets.map(p => p.depth), 1);
    const maxSA = Math.max(...pockets.map(p => p.surfaceArea), 1);
    return [
      {
        metric: 'Volume',
        ...Object.fromEntries(
          pockets.slice(0, 4).map((p, i) => [`pocket${i + 1}`, (p.volume / maxVol) * 100])
        ),
      },
      {
        metric: 'Druggability',
        ...Object.fromEntries(
          pockets.slice(0, 4).map((p, i) => [`pocket${i + 1}`, p.druggability * 100])
        ),
      },
      {
        metric: 'Conservation',
        ...Object.fromEntries(
          pockets.slice(0, 4).map((p, i) => [`pocket${i + 1}`, p.conservation * 100])
        ),
      },
      {
        metric: 'Depth',
        ...Object.fromEntries(
          pockets.slice(0, 4).map((p, i) => [`pocket${i + 1}`, (p.depth / maxDepth) * 100])
        ),
      },
      {
        metric: 'Surface Area',
        ...Object.fromEntries(
          pockets.slice(0, 4).map((p, i) => [`pocket${i + 1}`, (p.surfaceArea / maxSA) * 100])
        ),
      },
    ];
  }, [pockets]);

  // Scatter chart data
  const scatterData = useMemo(() => {
    return pockets.map(p => ({
      x: p.volume,
      y: p.druggability,
      z: p.conservation,
      pocketId: p.pocketId,
      pocketType: p.pocketType,
      color: POCKET_TYPE_STYLES[p.pocketType].color,
    }));
  }, [pockets]);

  return (
    <div className="space-y-6">
      {/* ===== Header ===== */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10">
              <Scan className="h-4 w-4 text-cyan-600" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">DAPM</h2>
            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/5 text-cyan-600">
              Dynamic Allosteric Pocket Miner
            </Badge>
          </div>
          <p className="text-sm text-slate-500">
            Detect cryptic and allosteric binding pockets from 3D protein structures using grid-based geometric algorithms.
          </p>
        </div>
      </div>

      {/* ===== Protein Target Selector + 3D Viewer Row ===== */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left: Target selector + Controls */}
        <div className="space-y-4">
          {/* Target Selector */}
          <Card className="overflow-hidden border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Target className="h-4 w-4 text-cyan-600" />
                Protein Target
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selectedTargetId} onValueChange={setSelectedTargetId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select target" />
                </SelectTrigger>
                <SelectContent>
                  {PROTEIN_TARGETS.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <Atom className="h-3 w-3 text-slate-400" />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTarget && (
                <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">PDB ID</span>
                    <span className="font-mono font-medium text-slate-700">{selectedTarget.pdbId}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">UniProt</span>
                    <span className="font-mono font-medium text-slate-700">{selectedTarget.uniprotId}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Length</span>
                    <span className="font-medium text-slate-700">{selectedTarget.sequenceLength} aa</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Class</span>
                    <span className="text-right text-[11px] font-medium text-slate-700">
                      {selectedTarget.targetClass}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detection Parameters */}
          <Card className="overflow-hidden border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <FlaskConical className="h-4 w-4 text-amber-600" />
                Detection Parameters
              </CardTitle>
              <CardDescription className="text-xs">Configure pocket detection algorithm</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Grid Spacing */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-600">Grid Spacing</Label>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {gridSpacing[0].toFixed(1)}Å
                  </span>
                </div>
                <Slider
                  value={gridSpacing}
                  onValueChange={setGridSpacing}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>0.5Å</span>
                  <span>2.0Å</span>
                </div>
              </div>

              {/* Min Volume */}
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">Min Volume (Å³)</Label>
                <Input
                  type="number"
                  value={minVolume}
                  onChange={e => setMinVolume(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="50"
                />
              </div>

              {/* Probe Radius */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-600">Probe Radius</Label>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                    {probeRadius[0].toFixed(1)}Å
                  </span>
                </div>
                <Slider
                  value={probeRadius}
                  onValueChange={setProbeRadius}
                  min={1.0}
                  max={2.0}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>1.0Å</span>
                  <span>2.0Å</span>
                </div>
              </div>

              <Button
                onClick={handleDetect}
                disabled={isDetecting}
                className="w-full bg-cyan-600 text-white hover:bg-cyan-700"
              >
                {isDetecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Detect Pockets
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: 3D Molecular Viewer */}
        <Card className="overflow-hidden border-slate-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Eye className="h-4 w-4 text-emerald-600" />
                3D Molecular Viewer
              </CardTitle>
              <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">
                {selectedTarget.name}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-3">
            <MolecularViewer target={selectedTarget} pockets={pockets} isDetecting={isDetecting} />
          </CardContent>
        </Card>
      </div>

      {/* ===== Results Section ===== */}
      <AnimatePresence mode="wait">
        {isDetecting ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <DetectionSkeleton />
          </motion.div>
        ) : hasDetected && pockets.length > 0 ? (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Summary Cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: 'Total Pockets',
                  value: pockets.length,
                  icon: Layers,
                  color: 'text-cyan-600',
                  bg: 'bg-cyan-500/10',
                },
                {
                  label: 'Avg. Volume',
                  value: `${(pockets.reduce((a, p) => a + p.volume, 0) / pockets.length).toFixed(1)} Å³`,
                  icon: Box,
                  color: 'text-amber-600',
                  bg: 'bg-amber-500/10',
                },
                {
                  label: 'Best Druggability',
                  value: Math.max(...pockets.map(p => p.druggability)).toFixed(2),
                  icon: Crosshair,
                  color: 'text-emerald-600',
                  bg: 'bg-emerald-500/10',
                },
                {
                  label: 'Avg. Conservation',
                  value: (pockets.reduce((a, p) => a + p.conservation, 0) / pockets.length).toFixed(2),
                  icon: Atom,
                  color: 'text-rose-600',
                  bg: 'bg-rose-500/10',
                },
              ].map((stat) => (
                <Card key={stat.label} className="border-slate-200">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', stat.bg)}>
                      <stat.icon className={cn('h-4 w-4', stat.color)} />
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">{stat.label}</p>
                      <p className="text-base font-bold tabular-nums text-slate-800">{stat.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pocket Results Table */}
            <Card className="overflow-hidden border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Layers className="h-4 w-4 text-teal-600" />
                  Detected Pockets
                </CardTitle>
                <CardDescription>
                  {pockets.length} pockets found in {selectedTarget.name} ({selectedTarget.pdbId})
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs">Pocket</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Volume (Å³)</TableHead>
                        <TableHead className="text-xs">Surface (Å²)</TableHead>
                        <TableHead className="text-xs">Depth (Å)</TableHead>
                        <TableHead className="text-xs">Druggability</TableHead>
                        <TableHead className="text-xs">Conservation</TableHead>
                        <TableHead className="text-xs">Key Residues</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pockets.map((pocket) => {
                        const typeStyle = POCKET_TYPE_STYLES[pocket.pocketType];
                        return (
                          <TableRow key={pocket.pocketId} className="group">
                            <TableCell className="font-mono text-xs font-semibold text-slate-700">
                              P{String(pocket.pocketId).padStart(2, '0')}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn('text-[10px] font-medium', typeStyle.badge)}
                              >
                                {pocket.pocketType === 'active-site' ? 'Active Site' :
                                  pocket.pocketType.charAt(0).toUpperCase() + pocket.pocketType.slice(1)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-slate-700">
                              {pocket.volume.toFixed(1)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-slate-700">
                              {pocket.surfaceArea.toFixed(1)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-slate-700">
                              {pocket.depth.toFixed(1)}
                            </TableCell>
                            <TableCell>
                              <ScoreProgress
                                value={pocket.druggability}
                                colorClass={
                                  pocket.druggability >= 0.75 ? 'text-emerald-600' :
                                  pocket.druggability >= 0.6 ? 'text-amber-600' :
                                  'text-slate-600'
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <ScoreProgress
                                value={pocket.conservation}
                                colorClass={
                                  pocket.conservation >= 0.8 ? 'text-rose-600' :
                                  pocket.conservation >= 0.5 ? 'text-amber-600' :
                                  'text-slate-500'
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {pocket.residues.slice(0, 3).map(r => (
                                  <Badge
                                    key={r}
                                    variant="outline"
                                    className="border-slate-200 bg-slate-50 text-[10px] text-slate-600"
                                  >
                                    {r}
                                  </Badge>
                                ))}
                                {pocket.residues.length > 3 && (
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-slate-50 text-[10px] text-slate-500"
                                  >
                                    +{pocket.residues.length - 3}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Charts Row */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Radar Chart */}
              <Card className="overflow-hidden border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Crosshair className="h-4 w-4 text-cyan-600" />
                    Pocket Comparison Radar
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Multi-metric comparison across detected pockets (normalized 0–100)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                        <PolarGrid stroke="rgba(148,163,184,0.2)" />
                        <PolarAngleAxis
                          dataKey="metric"
                          tick={{ fill: '#64748b', fontSize: 11 }}
                        />
                        <PolarRadiusAxis
                          angle={90}
                          domain={[0, 100]}
                          tick={{ fill: '#94a3b8', fontSize: 9 }}
                          axisLine={false}
                        />
                        {pockets.slice(0, 4).map((pocket, i) => {
                          const colors = RADAR_COLORS[i];
                          const typeLabel =
                            pocket.pocketType === 'active-site' ? 'Active' :
                            pocket.pocketType.charAt(0).toUpperCase() + pocket.pocketType.slice(1);
                          return (
                            <Radar
                              key={pocket.pocketId}
                              name={`P${pocket.pocketId} (${typeLabel})`}
                              dataKey={`pocket${i + 1}`}
                              stroke={colors.stroke}
                              fill={colors.fill}
                              strokeWidth={2}
                            />
                          );
                        })}
                        <RechartsTooltip content={<ChartTooltip />} />
                        <Legend
                          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Scatter Chart */}
              <Card className="overflow-hidden border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Target className="h-4 w-4 text-amber-600" />
                    Druggability vs Volume
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Point size reflects conservation · Color indicates pocket type
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          name="Volume"
                          unit=" Å³"
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          label={{
                            value: 'Volume (Å³)',
                            position: 'insideBottom',
                            offset: -15,
                            style: { fill: '#64748b', fontSize: 11, fontWeight: 500 },
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          name="Druggability"
                          domain={[0.4, 1]}
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          label={{
                            value: 'Druggability',
                            angle: -90,
                            position: 'insideLeft',
                            offset: 5,
                            style: { fill: '#64748b', fontSize: 11, fontWeight: 500 },
                          }}
                        />
                        <ZAxis
                          type="number"
                          dataKey="z"
                          range={[80, 400]}
                        />
                        <RechartsTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur-sm">
                                <p className="mb-1 text-xs font-semibold text-slate-700">
                                  Pocket {d.pocketId} ({d.pocketType})
                                </p>
                                <p className="text-xs text-slate-500">Volume: {d.x.toFixed(1)} Å³</p>
                                <p className="text-xs text-slate-500">Druggability: {d.y.toFixed(2)}</p>
                                <p className="text-xs text-slate-500">Conservation: {d.z.toFixed(2)}</p>
                              </div>
                            );
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                          formatter={(value: string) => {
                            const typeMap: Record<string, string> = {
                              'Active Site': 'Active Site',
                              'Cryptic': 'Cryptic',
                              'Allosteric': 'Allosteric',
                            };
                            return typeMap[value] ?? value;
                          }}
                        />
                        {scatterData.map((d) => (
                          <Scatter
                            key={d.pocketId}
                            name={
                              d.pocketType === 'active-site' ? 'Active Site' :
                              d.pocketType.charAt(0).toUpperCase() + d.pocketType.slice(1)
                            }
                            data={[{ x: d.x, y: d.y, z: d.z, pocketId: d.pocketId, pocketType: d.pocketType, color: d.color }]}
                            fill={d.color}
                            fillOpacity={0.75}
                            stroke={d.color}
                            strokeWidth={1.5}
                          />
                        ))}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Empty state when not yet detected */}
      {!isDetecting && !hasDetected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 mb-4">
            <Scan className="h-6 w-6 text-cyan-600" />
          </div>
          <p className="text-sm font-medium text-slate-600">No pockets detected yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Select a protein target and click &ldquo;Detect Pockets&rdquo; to begin analysis
          </p>
        </motion.div>
      )}
    </div>
  );
}
