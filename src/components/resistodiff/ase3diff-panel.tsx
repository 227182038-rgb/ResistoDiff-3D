'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  ZAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import {
  FlaskConical,
  Loader2,
  Atom,
  Target,
  Circle,
  ArrowRight,
  Timer,
  Volume2,
  SortAsc,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Activity,
  Box,
  Eye,
  Info,
  Zap,
  Waves,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  type DiffusionCandidate,
  PROTEIN_TARGETS,
  DEMO_POCKETS,
  simulateDiffusionGeneration,
} from '@/lib/resistodiff-data';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ==========================================================================
// Noise Visualization Component (animated SVG dots denoising)
// ==========================================================================
function NoiseVisualization({ progress }: { progress: number }) {
  const dotsRef = useRef<(SVGCircleElement | null)[]>([]);
  const [dots] = useState(() => {
    const arr: { x: number; y: number; tx: number; ty: number; delay: number }[] = [];
    // Target positions: a hexagonal molecule-like shape
    const targetPositions = [
      { x: 50, y: 30 }, { x: 35, y: 42 }, { x: 65, y: 42 },
      { x: 25, y: 55 }, { x: 50, y: 50 }, { x: 75, y: 55 },
      { x: 35, y: 68 }, { x: 65, y: 68 }, { x: 50, y: 80 },
      { x: 20, y: 42 }, { x: 80, y: 42 }, { x: 50, y: 18 },
      { x: 30, y: 30 }, { x: 70, y: 30 }, { x: 15, y: 55 },
      { x: 85, y: 55 }, { x: 35, y: 82 }, { x: 65, y: 82 },
      { x: 50, y: 65 }, { x: 42, y: 38 }, { x: 58, y: 38 },
      { x: 42, y: 62 }, { x: 58, y: 62 }, { x: 30, y: 50 },
    ];
    for (let i = 0; i < 24; i++) {
      arr.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        tx: targetPositions[i % targetPositions.length].x,
        ty: targetPositions[i % targetPositions.length].y,
        delay: Math.random() * 0.3,
      });
    }
    return arr;
  });

  const t = Math.min(1, progress);
  const noiseOpacity = 1 - t;
  const structureOpacity = t;

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-label="Denoising visualization">
      {/* Background grid */}
      <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.3" opacity="0.1" />
      </pattern>
      <rect width="100" height="100" fill="url(#grid)" />

      {/* Noise connections (fade out with progress) */}
      {t < 0.8 &&
        dots.slice(0, 12).map((_, i) => {
          const j = (i + 3) % dots.length;
          const x1 = dots[i].x + (dots[i].tx - dots[i].x) * t;
          const y1 = dots[i].y + (dots[i].ty - dots[i].y) * t;
          const x2 = dots[j].x + (dots[j].tx - dots[j].x) * t;
          const y2 = dots[j].y + (dots[j].ty - dots[j].y) * t;
          return (
            <line
              key={`noise-line-${i}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="currentColor"
              strokeWidth="0.4"
              opacity={noiseOpacity * 0.2}
              strokeDasharray="1 2"
            />
          );
        })}

      {/* Structure bonds (fade in with progress) */}
      {t > 0.3 &&
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
          const next = i < 5 ? i + 1 : (i === 5 ? 7 : (i === 6 ? 8 : (i === 7 ? 5 : 6)));
          const x1 = dots[i].tx;
          const y1 = dots[i].ty;
          const x2 = dots[next].tx;
          const y2 = dots[next].ty;
          return (
            <line
              key={`bond-${i}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="currentColor"
              strokeWidth="1.2"
              opacity={structureOpacity * 0.6}
              className="text-teal-500"
            />
          );
        })}

      {/* Dots */}
      {dots.map((dot, i) => {
        const x = dot.x + (dot.tx - dot.x) * t;
        const y = dot.y + (dot.ty - dot.y) * t;
        const color = t > 0.5
          ? (i < 9 ? 'fill-emerald-500' : 'fill-teal-400')
          : 'fill-slate-400';
        const r = 1.5 + t * 1.0;
        return (
          <circle
            key={i}
            ref={(el) => { dotsRef.current[i] = el; }}
            cx={x}
            cy={y}
            r={r}
            className={cn(
              'transition-all duration-100',
              color,
            )}
            opacity={0.6 + t * 0.4}
          >
            <animate
              attributeName="cx"
              values={`${x - 0.3};${x + 0.3};${x - 0.3}`}
              dur={`${1.5 + i * 0.05}s`}
              repeatCount="indefinite"
              begin={`${dot.delay}s`}
            />
            <animate
              attributeName="cy"
              values={`${y - 0.2};${y + 0.2};${y - 0.2}`}
              dur={`${1.8 + i * 0.04}s`}
              repeatCount="indefinite"
              begin={`${dot.delay + 0.2}s`}
            />
          </circle>
        );
      })}
    </svg>
  );
}

// ==========================================================================
// SDE Process Visualization
// ==========================================================================
function SDEVisualization({ isGenerating, progress }: { isGenerating: boolean; progress: number }) {
  const stages = [
    { label: 'Pure Noise', sublabel: 'x_T ~ N(0, I)', t: 0 },
    { label: 'Intermediate', sublabel: 'Partially denoised', t: 0.5 },
    { label: 'Structure', sublabel: 'x_0 ~ p(x|pocket)', t: 1 },
  ];

  const [stageDots] = useState(() => {
    return stages.map((stage) => {
      const dots: { x: number; y: number; tx: number; ty: number }[] = [];
      const count = 18;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const targetR = stage.t === 0 ? 0 : 28;
        const targetX = 50 + Math.cos(angle) * targetR + (stage.t > 0.5 ? Math.sin(angle * 3) * 8 : 0);
        const targetY = 50 + Math.sin(angle) * targetR + (stage.t > 0.5 ? Math.cos(angle * 2) * 6 : 0);
        dots.push({
          x: 50 + (Math.random() - 0.5) * 80,
          y: 50 + (Math.random() - 0.5) * 80,
          tx: targetX,
          ty: targetY,
        });
      }
      return { ...stage, dots };
    });
  });

  const animProgress = isGenerating ? Math.min(1, progress * 1.5) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Waves className="size-4 text-teal-500" />
        <span className="text-sm font-medium">Reverse SDE Process</span>
        <span className="text-xs text-muted-foreground font-mono ml-auto">
          dx<sub className="text-[10px] align-sub">t</sub> = f(x<sub className="text-[10px] align-sub">t</sub>, t)dt + g(t)dw<sub className="text-[10px] align-sub">t</sub>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stageDots.map((stage, si) => {
          const isComplete = si === 0 ? animProgress > 0.15 : si === 1 ? animProgress > 0.55 : animProgress > 0.9;
          const stageT = isGenerating
            ? si === 0
              ? Math.min(1, animProgress / 0.4)
              : si === 1
                ? Math.max(0, Math.min(1, (animProgress - 0.3) / 0.4))
                : Math.max(0, Math.min(1, (animProgress - 0.6) / 0.4))
            : 0;

          return (
            <div key={si} className="text-center">
              <div className={cn(
                'rounded-lg border p-2 transition-all duration-500',
                isComplete ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-muted/30'
              )}>
                <svg viewBox="0 0 100 100" className="w-full aspect-square max-w-[120px] mx-auto">
                  {stage.dots.map((dot, di) => {
                    const x = dot.x + (dot.tx - dot.x) * stageT;
                    const y = dot.y + (dot.ty - dot.y) * stageT;
                    const isCore = di < 6;
                    return (
                      <circle
                        key={di}
                        cx={x}
                        cy={y}
                        r={isCore ? 3 : 2}
                        className={cn(
                          'transition-all',
                          isComplete
                            ? isCore ? 'fill-emerald-500' : 'fill-teal-400'
                            : 'fill-slate-400'
                        )}
                        opacity={0.5 + stageT * 0.5}
                      >
                        {isGenerating && (
                          <animate
                            attributeName="cx"
                            values={`${x - 1};${x + 1};${x - 1}`}
                            dur={`${2 + di * 0.1}s`}
                            repeatCount="indefinite"
                          />
                        )}
                      </circle>
                    );
                  })}
                  {/* Bonds for structure stage */}
                  {si === 2 && stageT > 0.5 && stage.dots.slice(0, 6).map((dot, di) => {
                    const next = (di + 1) % 6;
                    return (
                      <line
                        key={`sde-bond-${di}`}
                        x1={dot.tx} y1={dot.ty}
                        x2={stage.dots[next].tx} y2={stage.dots[next].ty}
                        className="stroke-emerald-500"
                        strokeWidth="0.8"
                        opacity={(stageT - 0.5) * 2 * 0.5}
                      />
                    );
                  })}
                </svg>
              </div>
              <p className="text-xs font-medium mt-2">{stage.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{stage.sublabel}</p>
            </div>
          );
        })}
      </div>

      {/* Arrow flow */}
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <span className="text-[10px] font-mono">t = T</span>
        <ArrowRight className="size-3" />
        <span className="text-[10px] font-mono">t = T/2</span>
        <ArrowRight className="size-3" />
        <span className="text-[10px] font-mono">t = 0</span>
      </div>
    </div>
  );
}

// ==========================================================================
// Property color helpers
// ==========================================================================
function qedColor(score: number): string {
  if (score >= 0.7) return 'text-emerald-600';
  if (score >= 0.5) return 'text-amber-600';
  return 'text-rose-600';
}

function qedBg(score: number): string {
  if (score >= 0.7) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  if (score >= 0.5) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
}

function saColor(score: number): string {
  if (score <= 4) return 'text-emerald-600';
  if (score <= 6) return 'text-amber-600';
  return 'text-rose-600';
}

function saBg(score: number): string {
  if (score <= 4) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  if (score <= 6) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
}

function affinityColor(affinity: number): string {
  if (affinity <= -8) return 'text-emerald-600';
  if (affinity <= -6.5) return 'text-amber-600';
  return 'text-rose-600';
}

function pocketTypeColor(type: string): string {
  switch (type) {
    case 'active-site': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
    case 'allosteric': return 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300';
    case 'cryptic': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

function pocketTypeIcon(type: string) {
  switch (type) {
    case 'active-site': return <Target className="size-3.5" />;
    case 'allosteric': return <Zap className="size-3.5" />;
    case 'cryptic': return <Eye className="size-3.5" />;
    default: return <Box className="size-3.5" />;
  }
}

// ==========================================================================
// Main A-SE3Diff Panel
// ==========================================================================
type SortMode = 'qed' | 'affinity' | 'pocketFit';

export default function ASE3DiffPanel() {
  // Target & pocket selection
  const [selectedTarget, setSelectedTarget] = useState('tem1');
  const [selectedPocketId, setSelectedPocketId] = useState<string>('1');

  // Diffusion parameters
  const [numCandidates, setNumCandidates] = useState(6);
  const [denoisingSteps, setDenoisingSteps] = useState(200);
  const [temperature, setTemperature] = useState(1.0);
  const [guidanceScale, setGuidanceScale] = useState(5.0);
  const [conditionPocketGeo, setConditionPocketGeo] = useState(true);
  const [conditionDruglikeness, setConditionDruglikeness] = useState(true);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState(0);
  const [noiseLevel, setNoiseLevel] = useState(1.0);
  const [estimatedTime, setEstimatedTime] = useState('');
  const [candidates, setCandidates] = useState<DiffusionCandidate[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  // UI state
  const [sortMode, setSortMode] = useState<SortMode>('qed');
  const [selectedMol, setSelectedMol] = useState<DiffusionCandidate | null>(null);
  const [showPocketInfo, setShowPocketInfo] = useState(true);

  // Computed values
  const currentPockets = useMemo(
    () => DEMO_POCKETS[selectedTarget] ?? [],
    [selectedTarget]
  );

  const selectedPocket = useMemo(
    () => currentPockets.find((p) => p.pocketId === parseInt(selectedPocketId)),
    [currentPockets, selectedPocketId]
  );

  const sortedCandidates = useMemo(() => {
    const sorted = [...candidates];
    switch (sortMode) {
      case 'qed':
        sorted.sort((a, b) => b.qedScore - a.qedScore);
        break;
      case 'affinity':
        sorted.sort((a, b) => a.bindingAffinity - b.bindingAffinity);
        break;
      case 'pocketFit':
        sorted.sort((a, b) => b.pocketFit - a.pocketFit);
        break;
    }
    return sorted;
  }, [candidates, sortMode]);

  // Chart data
  const scatterData = useMemo(
    () =>
      sortedCandidates.map((c) => ({
        id: c.id,
        qed: c.qedScore,
        affinity: c.bindingAffinity,
        pocketFit: c.pocketFit,
        violations: c.lipinskiViolations,
        smiles: c.smiles,
      })),
    [sortedCandidates]
  );

  const mwBins = useMemo(() => {
    if (candidates.length === 0) return [];
    const bins = [
      { range: '<250', min: 0, max: 250, count: 0 },
      { range: '250-300', min: 250, max: 300, count: 0 },
      { range: '300-350', min: 300, max: 350, count: 0 },
      { range: '350-400', min: 350, max: 400, count: 0 },
      { range: '400-450', min: 400, max: 450, count: 0 },
      { range: '450-500', min: 450, max: 500, count: 0 },
      { range: '>500', min: 500, max: Infinity, count: 0 },
    ];
    candidates.forEach((c) => {
      const bin = bins.find((b) => c.mw >= b.min && c.mw < b.max);
      if (bin) bin.count++;
    });
    return bins;
  }, [candidates]);

  const logPBins = useMemo(() => {
    if (candidates.length === 0) return [];
    const bins = [
      { range: '<0', min: -Infinity, max: 0, count: 0 },
      { range: '0-1', min: 0, max: 1, count: 0 },
      { range: '1-2', min: 1, max: 2, count: 0 },
      { range: '2-3', min: 2, max: 3, count: 0 },
      { range: '3-4', min: 3, max: 4, count: 0 },
      { range: '4-5', min: 4, max: 5, count: 0 },
      { range: '>5', min: 5, max: Infinity, count: 0 },
    ];
    candidates.forEach((c) => {
      const bin = bins.find((b) => c.logP >= b.min && c.logP < b.max);
      if (bin) bin.count++;
    });
    return bins;
  }, [candidates]);

  // Generation simulation
  const generateRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const handleGenerate = useCallback(() => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenProgress(0);
    setGenStep(0);
    setNoiseLevel(1.0);
    setCandidates([]);
    setHasGenerated(false);
    startTimeRef.current = Date.now();

    const totalSteps = denoisingSteps;
    let currentStep = 0;
    const stepInterval = 20; // ms per visual step

    const tick = () => {
      currentStep++;
      const progress = currentStep / totalSteps;
      setGenStep(currentStep);
      setGenProgress(progress * 100);
      setNoiseLevel(parseFloat((1.0 - progress).toFixed(3)));

      // Estimate remaining time
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = (elapsed / progress) * (1 - progress);
      if (remaining > 60000) {
        setEstimatedTime(`${(remaining / 60000).toFixed(1)} min`);
      } else {
        setEstimatedTime(`${Math.ceil(remaining / 1000)}s`);
      }

      if (currentStep >= totalSteps) {
        setIsGenerating(false);
        setGenProgress(100);
        setNoiseLevel(0);
        setEstimatedTime('Done');
        const results = simulateDiffusionGeneration(numCandidates, parseInt(selectedPocketId));
        setCandidates(results);
        setHasGenerated(true);
        return;
      }

      generateRef.current = setTimeout(tick, stepInterval);
    };

    generateRef.current = setTimeout(tick, stepInterval);
  }, [isGenerating, denoisingSteps, numCandidates, selectedPocketId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (generateRef.current) clearTimeout(generateRef.current);
    };
  }, []);

  // Target change handler with pocket sync
  const handleTargetChange = useCallback((target: string) => {
    setSelectedTarget(target);
    const pockets = DEMO_POCKETS[target];
    if (pockets && pockets.length > 0) {
      setSelectedPocketId(String(pockets[0].pocketId));
    }
  }, []);

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-emerald-100 p-2.5 dark:bg-emerald-950">
            <FlaskConical className="size-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">A-SE3Diff</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Allosteric SE(3)-Equivariant Counter-Inhibitor Diffuser — generates novel molecules conditioned on pocket geometry
            </p>
          </div>
        </div>

        {/* Section 1: Pocket & Target Selection */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-teal-500" />
                <CardTitle className="text-base">Pocket &amp; Target Selection</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 h-7"
                onClick={() => setShowPocketInfo(!showPocketInfo)}
              >
                {showPocketInfo ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                Pocket Info
              </Button>
            </div>
            <CardDescription>Select the protein target and binding pocket for counter-inhibitor design</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Protein Target</Label>
                <Select value={selectedTarget} onValueChange={handleTargetChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROTEIN_TARGETS.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs">({t.uniprotId})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {PROTEIN_TARGETS.find((t) => t.id === selectedTarget) && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {PROTEIN_TARGETS.find((t) => t.id === selectedTarget)?.description}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Binding Pocket</Label>
                <Select value={selectedPocketId} onValueChange={setSelectedPocketId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentPockets.map((p) => (
                      <SelectItem key={p.pocketId} value={String(p.pocketId)}>
                        <div className="flex items-center gap-2">
                          {pocketTypeIcon(p.pocketType)}
                          <span>Pocket {p.pocketId}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {p.pocketType}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pocket Info Panel */}
            <AnimatePresence>
              {showPocketInfo && selectedPocket && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border bg-muted/20 p-4 space-y-3 mt-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cn('gap-1', pocketTypeColor(selectedPocket.pocketType))}>
                        {pocketTypeIcon(selectedPocket.pocketType)}
                        {selectedPocket.pocketType.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Druggability:
                        <span className={cn('font-semibold ml-1', selectedPocket.druggability >= 0.75 ? 'text-emerald-600' : selectedPocket.druggability >= 0.65 ? 'text-amber-600' : 'text-rose-600')}>
                          {selectedPocket.druggability.toFixed(2)}
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Volume</p>
                        <p className="text-sm font-semibold">{selectedPocket.volume.toFixed(1)} Å³</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Surface Area</p>
                        <p className="text-sm font-semibold">{selectedPocket.surfaceArea.toFixed(1)} Å²</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Depth</p>
                        <p className="text-sm font-semibold">{selectedPocket.depth.toFixed(1)} Å</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Conservation</p>
                        <p className="text-sm font-semibold">{(selectedPocket.conservation * 100).toFixed(0)}%</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Key Residues</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedPocket.residues.map((r) => (
                          <Badge key={r} variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground font-mono">
                      Center: ({selectedPocket.centerX.toFixed(1)}, {selectedPocket.centerY.toFixed(1)}, {selectedPocket.centerZ.toFixed(1)})
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Section 2: Diffusion Generation Controls */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              <CardTitle className="text-base">Diffusion Generation Controls</CardTitle>
            </div>
            <CardDescription>Configure the A-SE3Diff denoising pipeline parameters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Sliders grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              {/* Number of candidates */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Number of Candidates</Label>
                  <span className="text-xs font-mono font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
                    {numCandidates}
                  </span>
                </div>
                <Slider
                  value={[numCandidates]}
                  onValueChange={([v]) => setNumCandidates(v)}
                  min={3}
                  max={20}
                  step={1}
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>3</span><span>20</span>
                </div>
              </div>

              {/* Denoising steps */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Denoising Steps</Label>
                  <span className="text-xs font-mono font-semibold text-teal-600 bg-teal-50 dark:bg-teal-950 px-1.5 py-0.5 rounded">
                    {denoisingSteps}
                  </span>
                </div>
                <Slider
                  value={[denoisingSteps]}
                  onValueChange={([v]) => setDenoisingSteps(v)}
                  min={50}
                  max={1000}
                  step={50}
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>50</span><span>1000</span>
                </div>
              </div>

              {/* Temperature */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Temperature</Label>
                  <span className="text-xs font-mono font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded">
                    {temperature.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[temperature]}
                  onValueChange={([v]) => setTemperature(parseFloat(v.toFixed(1)))}
                  min={0.1}
                  max={2.0}
                  step={0.1}
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0.1</span><span>2.0</span>
                </div>
              </div>

              {/* Guidance Scale */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Guidance Scale</Label>
                  <span className="text-xs font-mono font-semibold text-cyan-600 bg-cyan-50 dark:bg-cyan-950 px-1.5 py-0.5 rounded">
                    {guidanceScale.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[guidanceScale]}
                  onValueChange={([v]) => setGuidanceScale(parseFloat(v.toFixed(1)))}
                  min={1.0}
                  max={15.0}
                  step={0.5}
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1.0</span><span>15.0</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Conditioning checkboxes */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cond-pocket"
                  checked={conditionPocketGeo}
                  onCheckedChange={(v) => setConditionPocketGeo(v === true)}
                  disabled={isGenerating}
                />
                <Label htmlFor="cond-pocket" className="text-xs cursor-pointer select-none">
                  <Box className="size-3.5 inline mr-1 text-teal-500" />
                  Pocket Geometry
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cond-drug"
                  checked={conditionDruglikeness}
                  onCheckedChange={(v) => setConditionDruglikeness(v === true)}
                  disabled={isGenerating}
                />
                <Label htmlFor="cond-drug" className="text-xs cursor-pointer select-none">
                  <Activity className="size-3.5 inline mr-1 text-emerald-500" />
                  Drug-likeness
                </Label>
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedPocket}
              className={cn(
                'w-full h-11 text-sm font-semibold gap-2 transition-all',
                isGenerating
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              )}
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FlaskConical className="size-4" />
                  Generate Counter-Inhibitors
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Section 3: Generation Progress */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 text-emerald-600 animate-spin" />
                    <CardTitle className="text-base">Diffusion in Progress</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Step</p>
                      <p className="text-lg font-bold font-mono text-emerald-600">
                        {genStep}<span className="text-xs font-normal text-muted-foreground">/{denoisingSteps}</span>
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Progress</p>
                      <p className="text-lg font-bold font-mono text-teal-600">
                        {genProgress.toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">ETA</p>
                      <p className="text-lg font-bold font-mono text-amber-600 flex items-center justify-center gap-1">
                        <Timer className="size-3.5" />
                        {estimatedTime}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Noise Level</p>
                      <p className="text-lg font-bold font-mono text-slate-600">
                        <Volume2 className="size-3.5 inline" />
                        {noiseLevel.toFixed(3)}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <Progress value={genProgress} className="h-2.5" />
                  </div>

                  {/* Noise visualization */}
                  <div className="rounded-lg border bg-background/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Denoising Visualization
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        σ = {noiseLevel.toFixed(3)}
                      </span>
                    </div>
                    <div className="h-36 sm:h-44">
                      <NoiseVisualization progress={genProgress / 100} />
                    </div>
                  </div>

                  {/* SDE Visualization */}
                  <SDEVisualization isGenerating={isGenerating} progress={genProgress / 100} />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 4: Generated Molecules Results */}
        <AnimatePresence>
          {hasGenerated && !isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="space-y-4"
            >
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Atom className="size-4 text-emerald-500" />
                      <CardTitle className="text-base">
                        Generated Molecules
                      </CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {candidates.length} candidates
                      </Badge>
                    </div>
                    {/* Sort controls */}
                    <div className="flex items-center gap-1.5">
                      <SortAsc className="size-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground mr-1">Sort:</span>
                      {([
                        { key: 'qed' as SortMode, label: 'QED' },
                         { key: 'affinity' as SortMode, label: 'Binding' },
                         { key: 'pocketFit' as SortMode, label: 'Fit' },
                      ]).map((s) => (
                        <Button
                          key={s.key}
                          variant={sortMode === s.key ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-[11px] px-2.5"
                          onClick={() => setSortMode(s.key)}
                        >
                          {s.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    Click any molecule card for detailed properties
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
                    {sortedCandidates.map((mol, idx) => (
                      <motion.div
                        key={mol.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.25, delay: idx * 0.05 }}
                      >
                        <Card
                          className="cursor-pointer hover:border-emerald-500/40 hover:shadow-md transition-all group"
                          onClick={() => setSelectedMol(mol)}
                        >
                          <CardHeader className="p-3 pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                                {mol.id}
                              </CardTitle>
                              <div className="flex items-center gap-1">
                                {mol.lipinskiViolations === 0 ? (
                                  <Badge className="bg-emerald-100 text-emerald-700 text-[9px] dark:bg-emerald-950 dark:text-emerald-300 border-0">
                                    Lipinski ✓
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-[9px]">
                                    {mol.lipinskiViolations} violation{mol.lipinskiViolations > 1 ? 's' : ''}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 space-y-2.5">
                            {/* SMILES */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-[10px] font-mono text-muted-foreground truncate bg-muted/50 rounded px-2 py-1 group-hover:text-foreground transition-colors">
                                  {mol.smiles}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-[10px] font-mono break-all">{mol.smiles}</p>
                              </TooltipContent>
                            </Tooltip>

                            {/* Key scores */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="text-center">
                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">QED</p>
                                <p className={cn('text-sm font-bold font-mono', qedColor(mol.qedScore))}>
                                  {mol.qedScore.toFixed(2)}
                                </p>
                              </div>
                              <div className="text-center">
                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">SA</p>
                                <p className={cn('text-sm font-bold font-mono', saColor(mol.saScore))}>
                                  {mol.saScore.toFixed(1)}
                                </p>
                              </div>
                              <div className="text-center">
                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">ΔG</p>
                                <p className={cn('text-sm font-bold font-mono', affinityColor(mol.bindingAffinity))}>
                                  {mol.bindingAffinity.toFixed(1)}
                                </p>
                              </div>
                            </div>

                            {/* Properties row */}
                            <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                              <span className="font-mono">MW {mol.mw.toFixed(0)}</span>
                              <span className="text-border">|</span>
                              <span className="font-mono">LogP {mol.logP.toFixed(1)}</span>
                              <span className="text-border">|</span>
                              <span className="font-mono">TPSA {mol.tpsa.toFixed(0)}</span>
                            </div>

                            {/* Pocket Fit bar */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-muted-foreground">Pocket Fit</span>
                                <span className="text-[10px] font-mono font-semibold text-teal-600">
                                  {mol.pocketFit.toFixed(2)}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <motion.div
                                  className={cn(
                                    'h-full rounded-full',
                                    mol.pocketFit >= 0.8 ? 'bg-emerald-500' :
                                    mol.pocketFit >= 0.65 ? 'bg-teal-500' : 'bg-amber-500'
                                  )}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${mol.pocketFit * 100}%` }}
                                  transition={{ duration: 0.6, delay: idx * 0.05 + 0.2 }}
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Section 5: Molecule Comparison Chart */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-teal-500" />
                    <CardTitle className="text-base">Molecule Comparison</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    QED Score vs. Binding Affinity — bubble size represents Pocket Fit
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 sm:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis
                          type="number"
                          dataKey="qed"
                          name="QED"
                          domain={[0.3, 1]}
                          tick={{ fontSize: 11 }}
                          label={{ value: 'QED Score', position: 'insideBottom', offset: -10, fontSize: 11 }}
                        />
                        <YAxis
                          type="number"
                          dataKey="affinity"
                          name="Binding Affinity"
                          domain={[-12, -4]}
                          tick={{ fontSize: 11 }}
                          label={{ value: 'ΔG (kcal/mol)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }}
                        />
                        <ZAxis type="number" dataKey="pocketFit" range={[80, 400]} />
                        <RechartsTooltip
                          content={({ payload }) => {
                            if (!payload || payload.length === 0) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="rounded-lg border bg-background p-2.5 shadow-lg text-xs space-y-1">
                                <p className="font-mono font-semibold">{d.id}</p>
                                <p className="text-muted-foreground">QED: <span className="text-foreground font-mono">{d.qed}</span></p>
                                <p className="text-muted-foreground">ΔG: <span className="text-foreground font-mono">{d.affinity} kcal/mol</span></p>
                                <p className="text-muted-foreground">Fit: <span className="text-foreground font-mono">{d.pocketFit}</span></p>
                                <p className="text-muted-foreground">Violations: <span className="text-foreground font-mono">{d.violations}</span></p>
                              </div>
                            );
                          }}
                        />
                        <Scatter data={scatterData}>
                          {scatterData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.violations === 0 ? '#10b981' : '#f59e0b'}
                              fillOpacity={0.7}
                              stroke={entry.violations === 0 ? '#059669' : '#d97706'}
                              strokeWidth={1}
                            />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Circle className="size-2.5 fill-emerald-500 text-emerald-500" />
                      <span>0 Lipinski violations</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Circle className="size-2.5 fill-amber-500 text-amber-500" />
                      <span>≥1 Lipinski violations</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px]">○</span>
                      <span>Bubble size = Pocket Fit</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 6: Property Distribution Charts */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Box className="size-4 text-amber-500" />
                    <CardTitle className="text-base">Property Distributions</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Molecular weight and LogP distributions of generated candidates
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* MW Distribution */}
                    <div>
                      <p className="text-xs font-medium text-center mb-2">Molecular Weight (Da)</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={mwBins} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                              dataKey="range"
                              tick={{ fontSize: 9 }}
                              tickLine={false}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 10 }}
                              width={20}
                            />
                            <RechartsTooltip
                              content={({ payload }) => {
                                if (!payload || payload.length === 0) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="rounded-lg border bg-background p-2 shadow-lg text-xs">
                                    <p className="font-mono">MW: {d.range} Da</p>
                                    <p>Count: <span className="font-semibold">{d.count}</span></p>
                                  </div>
                                );
                              }}
                            />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                              {mwBins.map((entry, index) => (
                                <Cell
                                  key={`mw-${index}`}
                                  fill={entry.count > 0 ? '#14b8a6' : '#e2e8f0'}
                                  fillOpacity={entry.count > 0 ? 0.7 : 0.3}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* LogP Distribution */}
                    <div>
                      <p className="text-xs font-medium text-center mb-2">LogP</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={logPBins} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis
                              dataKey="range"
                              tick={{ fontSize: 9 }}
                              tickLine={false}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 10 }}
                              width={20}
                            />
                            <RechartsTooltip
                              content={({ payload }) => {
                                if (!payload || payload.length === 0) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="rounded-lg border bg-background p-2 shadow-lg text-xs">
                                    <p className="font-mono">LogP: {d.range}</p>
                                    <p>Count: <span className="font-semibold">{d.count}</span></p>
                                  </div>
                                );
                              }}
                            />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                              {logPBins.map((entry, index) => (
                                <Cell
                                  key={`logp-${index}`}
                                  fill={entry.count > 0 ? '#f59e0b' : '#e2e8f0'}
                                  fillOpacity={entry.count > 0 ? 0.7 : 0.3}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 7: SDE Visualization (final state) */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Waves className="size-4 text-cyan-500" />
                    <CardTitle className="text-base">Reverse SDE Process Summary</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Visualization of the stochastic denoising trajectory from pure noise to structured molecule
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SDEVisualization isGenerating={false} progress={1} />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 8: Initial SDE visualization (before generation) */}
        {!isGenerating && !hasGenerated && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Waves className="size-4 text-cyan-500" />
                <CardTitle className="text-base">Reverse SDE Process</CardTitle>
              </div>
              <CardDescription className="text-xs">
                The diffusion model learns to reverse a stochastic differential equation, denoising random configurations into valid molecular structures
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SDEVisualization isGenerating={false} progress={0} />
            </CardContent>
          </Card>
        )}

        {/* Molecule Detail Dialog */}
        <Dialog open={!!selectedMol} onOpenChange={(open) => !open && setSelectedMol(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            {selectedMol && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Atom className="size-4 text-emerald-500" />
                    <span className="font-mono">{selectedMol.id}</span>
                    {selectedMol.lipinskiViolations === 0 ? (
                      <Badge className="bg-emerald-100 text-emerald-700 text-[10px] dark:bg-emerald-950 dark:text-emerald-300 border-0">
                        Lipinski Compliant
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        {selectedMol.lipinskiViolations} Lipinski violation{selectedMol.lipinskiViolations > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription>Generated counter-inhibitor molecular properties</DialogDescription>
                </DialogHeader>

                {/* SMILES */}
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">SMILES</p>
                  <p className="text-xs font-mono break-all leading-relaxed">
                    {selectedMol.smiles}
                  </p>
                </div>

                {/* Key Scores */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className={cn('rounded-lg p-3 text-center', qedBg(selectedMol.qedScore))}>
                    <p className="text-[10px] uppercase tracking-wider opacity-70">QED Score</p>
                    <p className="text-xl font-bold font-mono mt-0.5">
                      {selectedMol.qedScore.toFixed(2)}
                    </p>
                    <p className="text-[9px] opacity-60 mt-0.5">/ 1.00</p>
                  </div>
                  <div className={cn('rounded-lg p-3 text-center', saBg(selectedMol.saScore))}>
                    <p className="text-[10px] uppercase tracking-wider opacity-70">SA Score</p>
                    <p className="text-xl font-bold font-mono mt-0.5">
                      {selectedMol.saScore.toFixed(1)}
                    </p>
                    <p className="text-[9px] opacity-60 mt-0.5">/ 10 (easy)</p>
                  </div>
                  <div className={cn('rounded-lg p-3 text-center',
                    selectedMol.bindingAffinity <= -8
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : selectedMol.bindingAffinity <= -6.5
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  )}>
                    <p className="text-[10px] uppercase tracking-wider opacity-70">Binding Affinity</p>
                    <p className="text-xl font-bold font-mono mt-0.5">
                      {selectedMol.bindingAffinity.toFixed(1)}
                    </p>
                    <p className="text-[9px] opacity-60 mt-0.5">kcal/mol</p>
                  </div>
                  <div className={cn('rounded-lg p-3 text-center',
                    selectedMol.pocketFit >= 0.8
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : selectedMol.pocketFit >= 0.65
                        ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  )}>
                    <p className="text-[10px] uppercase tracking-wider opacity-70">Pocket Fit</p>
                    <p className="text-xl font-bold font-mono mt-0.5">
                      {selectedMol.pocketFit.toFixed(2)}
                    </p>
                    <p className="text-[9px] opacity-60 mt-0.5">/ 1.00</p>
                  </div>
                </div>

                {/* Full properties table */}
                <Separator />
                <div>
                  <p className="text-xs font-medium mb-2">Physicochemical Properties</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] h-8">Property</TableHead>
                        <TableHead className="text-[10px] h-8">Value</TableHead>
                        <TableHead className="text-[10px] h-8">Range</TableHead>
                        <TableHead className="text-[10px] h-8">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { name: 'Molecular Weight', value: `${selectedMol.mw.toFixed(1)} Da`, range: '< 500 Da', ok: selectedMol.mw < 500 },
                        { name: 'LogP', value: selectedMol.logP.toFixed(1), range: '-0.4 to 5.6', ok: selectedMol.logP >= -0.4 && selectedMol.logP <= 5.6 },
                        { name: 'H-Bond Donors', value: String(selectedMol.hbd), range: '≤ 5', ok: selectedMol.hbd <= 5 },
                        { name: 'H-Bond Acceptors', value: String(selectedMol.hba), range: '≤ 10', ok: selectedMol.hba <= 10 },
                        { name: 'TPSA', value: `${selectedMol.tpsa.toFixed(1)} Å²`, range: '≤ 140 Å²', ok: selectedMol.tpsa <= 140 },
                      ].map((row) => (
                        <TableRow key={row.name}>
                          <TableCell className="text-xs py-2 font-medium">{row.name}</TableCell>
                          <TableCell className="text-xs py-2 font-mono">{row.value}</TableCell>
                          <TableCell className="text-[10px] py-2 text-muted-foreground">{row.range}</TableCell>
                          <TableCell className="text-xs py-2">
                            <Badge
                              variant={row.ok ? 'secondary' : 'destructive'}
                              className={cn(
                                'text-[9px]',
                                row.ok && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              )}
                            >
                              {row.ok ? '✓ Pass' : '✗ Fail'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
