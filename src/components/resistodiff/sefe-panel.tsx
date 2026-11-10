'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Dna,
  Play,
  FlaskConical,
  Activity,
  Network,
  TreePine,
  ChevronRight,
  Info,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  Loader2,
  BookmarkPlus,
  RotateCcw,
  Target,
  Atom,
  Bug,
  CircleDot,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  type MutationResult,
  type MCTSNode,
  type ProteinTarget,
  PROTEIN_TARGETS,
  KNOWN_MUTATIONS,
  EPISTATIC_PAIRS,
  DEMO_MCTS_TREE,
  simulateMutationAnalysis,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// --- Helper: Fitness color class ---
function fitnessColor(score: number): string {
  if (score > 3) return 'text-rose-500';
  if (score >= 1) return 'text-amber-500';
  return 'text-emerald-500';
}

function fitnessBg(score: number): string {
  if (score > 3) return 'bg-rose-500/10 border-rose-500/20';
  if (score >= 1) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-emerald-500/10 border-emerald-500/20';
}

function fitnessBadgeVariant(score: number, isCompensatory: boolean): {
  label: string;
  className: string;
} {
  if (isCompensatory) return { label: 'Compensatory', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/25' };
  if (Math.abs(score) < 0.5) return { label: 'Neutral', className: 'bg-slate-500/15 text-slate-500 border-slate-500/30 hover:bg-slate-500/25' };
  return { label: 'Resistance', className: 'bg-rose-500/15 text-rose-600 border-rose-500/30 hover:bg-rose-500/25' };
}

// --- MCTS Tree Node Renderer ---
function MCTSTreeNode({ node, isLast }: { node: MCTSNode; isLast: boolean }) {
  const nodeColor = node.isResistance
    ? 'border-rose-400/60 bg-rose-500/5 hover:bg-rose-500/10'
    : node.fitnessScore < 0
      ? 'border-slate-400/40 bg-slate-500/5 hover:bg-slate-500/10'
      : 'border-emerald-400/60 bg-emerald-500/5 hover:bg-emerald-500/10';

  const scoreColor = node.isResistance
    ? 'text-rose-500'
    : node.fitnessScore < 0
      ? 'text-slate-500'
      : 'text-emerald-500';

  const dotColor = node.isResistance
    ? 'bg-rose-500'
    : node.fitnessScore < 0
      ? 'bg-slate-400'
      : 'bg-emerald-500';

  return (
    <div className="flex gap-2">
      {/* Vertical connector line for parent */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            'w-px flex-1 min-h-[20px]',
            isLast ? 'bg-transparent' : 'bg-slate-300 dark:bg-slate-600'
          )}
        />
        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0 border-2 border-background', dotColor)} />
        <div className="w-px flex-1 min-h-[20px] bg-slate-300 dark:bg-slate-600" />
      </div>

      {/* Node content + children */}
      <div className="flex-1 min-w-0 pb-4">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: node.depth * 0.1 }}
          className={cn(
            'rounded-lg border px-3 py-2 transition-colors',
            nodeColor
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold text-foreground truncate">
              {node.mutation}
            </span>
            <span className={cn('text-xs font-bold tabular-nums', scoreColor)}>
              F={node.fitnessScore > 0 ? '+' : ''}{node.fitnessScore.toFixed(1)}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              n={node.visits}
            </span>
          </div>
        </motion.div>

        {node.children.length > 0 && (
          <div className="mt-1 flex flex-col">
            {node.children.map((child, idx) => (
              <MCTSTreeNode
                key={child.id}
                node={child}
                isLast={idx === node.children.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Epistasis interaction type styling ---
function epistasisStyle(type: string) {
  switch (type) {
    case 'synergistic':
      return { bg: 'bg-emerald-500/15', text: 'text-emerald-600', border: 'border-emerald-500/30', dot: 'bg-emerald-500' };
    case 'antagonistic':
      return { bg: 'bg-rose-500/15', text: 'text-rose-600', border: 'border-rose-500/30', dot: 'bg-rose-500' };
    case 'additive':
      return { bg: 'bg-cyan-500/15', text: 'text-cyan-600', border: 'border-cyan-500/30', dot: 'bg-cyan-500' };
    default:
      return { bg: 'bg-slate-500/10', text: 'text-slate-500', border: 'border-slate-500/20', dot: 'bg-slate-400' };
  }
}

// --- Target info card icon mapping ---
function targetIcon(targetClass: string) {
  if (targetClass.includes('Metallo')) return <Atom className="h-4 w-4 text-teal-500" />;
  if (targetClass.includes('Topoisomerase') || targetClass.includes('Gyrase')) return <Bug className="h-4 w-4 text-amber-500" />;
  return <Dna className="h-4 w-4 text-rose-500" />;
}

// --- Fade-in wrapper ---
const fadeVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.06, ease: 'easeOut' as const },
  }),
};

// --- Custom chart tooltip ---
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { mutation: string; fitness: number; type: string } }> }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="rounded-lg border bg-background px-3 py-2 shadow-lg text-xs">
        <p className="font-mono font-semibold text-foreground">{d.mutation}</p>
        <p className={cn('font-bold tabular-nums', fitnessColor(d.fitness))}>
          Fitness: {d.fitness > 0 ? '+' : ''}{d.fitness.toFixed(1)}
        </p>
        <p className="text-muted-foreground capitalize">{d.type}</p>
      </div>
    );
  }
  return null;
}

// ============================================================================
// Main SEFE Panel Component
// ============================================================================
export default function SefePanel() {
  // --- State ---
  const [selectedTargetId, setSelectedTargetId] = useState<string>('tem1');
  const [mutationInput, setMutationInput] = useState('');
  const [results, setResults] = useState<MutationResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState('table');

  const selectedTarget = useMemo(
    () => PROTEIN_TARGETS.find((t) => t.id === selectedTargetId)!,
    [selectedTargetId]
  );

  // --- Parse mutation input ---
  const parseMutations = useCallback((input: string): string[] => {
    return input
      .replace(/,/g, '\n')
      .split(/\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
  }, []);

  // --- Add known mutations ---
  const handleAddKnown = useCallback(() => {
    const known = KNOWN_MUTATIONS[selectedTargetId] ?? [];
    // Only add single mutations (skip combinatorial ones with colons)
    const singles = known.filter((m) => !m.mutation.includes(':')).map((m) => m.mutation);
    setMutationInput((prev) => {
      const existing = parseMutations(prev);
      const merged = [...new Set([...existing, ...singles])];
      return merged.join('\n');
    });
  }, [selectedTargetId, parseMutations]);

  // --- Run analysis ---
  const handleRunAnalysis = useCallback(async () => {
    const mutations = parseMutations(mutationInput);
    if (mutations.length === 0) return;

    setIsAnalyzing(true);
    setHasRun(false);

    // Simulate computation delay
    await new Promise((r) => setTimeout(r, 1500));

    const analysisResults = simulateMutationAnalysis(selectedTargetId, mutations);
    setResults(analysisResults);
    setIsAnalyzing(false);
    setHasRun(true);
    setActiveResultTab('table');
  }, [mutationInput, selectedTargetId, parseMutations]);

  // --- Reset ---
  const handleReset = useCallback(() => {
    setMutationInput('');
    setResults([]);
    setHasRun(false);
    setIsAnalyzing(false);
  }, []);

  // --- Chart data sorted by fitness descending ---
  const chartData = useMemo(
    () =>
      [...results]
        .sort((a, b) => b.fitnessScore - a.fitnessScore)
        .map((r) => ({
          mutation: r.mutation,
          fitness: r.fitnessScore,
          type: r.isCompensatory ? 'compensatory' : Math.abs(r.fitnessScore) < 0.5 ? 'neutral' : 'resistance',
        })),
    [results]
  );

  // --- Bar color helper for chart ---
  const barColor = (type: string) => {
    switch (type) {
      case 'compensatory': return '#10b981'; // emerald-500
      case 'resistance': return '#f43f5e';   // rose-500
      default: return '#64748b';              // slate-500
    }
  };

  // --- Custom chart tooltip ---
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { mutation: string; fitness: number; type: string } }> }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="rounded-lg border bg-background px-3 py-2 shadow-lg text-xs">
          <p className="font-mono font-semibold text-foreground">{d.mutation}</p>
          <p className={cn('font-bold tabular-nums', fitnessColor(d.fitness))}>
            Fitness: {d.fitness > 0 ? '+' : ''}{d.fitness.toFixed(1)}
          </p>
          <p className="text-muted-foreground capitalize">{d.type}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-full max-w-5xl mx-auto space-y-6 p-4 md:p-6">
        {/* ---- Header ---- */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Activity className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                SEFE Module
              </h2>
              <p className="text-xs text-muted-foreground leading-tight">
                Structural Epistatic Fitness Engine
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="w-fit text-[10px] tracking-wide border-emerald-500/30 text-emerald-600 bg-emerald-500/5"
          >
            RESISTODIFF-3D
          </Badge>
        </motion.div>

        <Separator className="opacity-50" />

        {/* ---- Section 1: Protein Target Selector ---- */}
        <motion.div variants={fadeVariants} initial="hidden" animate="visible" custom={0}>
          <Card className="border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-teal-500" />
                <CardTitle className="text-sm font-semibold">
                  Protein Target
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Select a protein target for mutational escape analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Target Protein
                  </Label>
                  <Select
                    value={selectedTargetId}
                    onValueChange={(v) => {
                      setSelectedTargetId(v);
                      setResults([]);
                      setHasRun(false);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROTEIN_TARGETS.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex items-center gap-2">
                            {targetIcon(t.targetClass)}
                            <span>{t.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Target info card */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedTargetId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/40 bg-muted/30 p-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              Class
                            </p>
                            <p className="text-xs font-semibold text-foreground">
                              {selectedTarget.targetClass}
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Protein functional classification</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              Organism
                            </p>
                            <p className="text-xs font-semibold text-foreground">
                              {selectedTarget.organism}
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Source organism</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              Sequence Length
                            </p>
                            <p className="text-xs font-semibold text-foreground tabular-nums">
                              {selectedTarget.sequenceLength} aa
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Number of amino acid residues</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              PDB / UniProt
                            </p>
                            <p className="text-xs font-semibold text-foreground">
                              {selectedTarget.pdbId} / {selectedTarget.uniprotId}
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Structure & sequence database IDs</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium self-center mr-1">
                        Key Residues:
                      </span>
                      {selectedTarget.keyResidues.map((r) => (
                        <Badge
                          key={r}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 font-mono border-teal-500/30 text-teal-600 bg-teal-500/5"
                        >
                          {r}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex items-start gap-2 rounded-md bg-slate-100/60 dark:bg-slate-800/40 p-2.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground">Resistance Mechanism: </span>
                        {selectedTarget.resistanceMechanism}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- Section 2: Mutation Input ---- */}
        <motion.div variants={fadeVariants} initial="hidden" animate="visible" custom={1}>
          <Card className="border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-sm font-semibold">
                  Mutation Input
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Enter point mutations (e.g. G238S, E104K, S83L) — one per line or comma-separated
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="mutation-input" className="sr-only">
                Mutations
              </Label>
              <textarea
                id="mutation-input"
                value={mutationInput}
                onChange={(e) => setMutationInput(e.target.value)}
                placeholder={"G238S\nE104K\nM182T\nR164S"}
                rows={4}
                className={cn(
                  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs',
                  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'resize-y min-h-[80px] max-h-[200px]'
                )}
                disabled={isAnalyzing}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddKnown}
                  disabled={isAnalyzing}
                  className="text-xs gap-1.5 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  Add Known Mutations
                </Button>

                <div className="flex-1" />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={isAnalyzing}
                  className="text-xs gap-1.5 text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>

                <Button
                  size="sm"
                  onClick={handleRunAnalysis}
                  disabled={isAnalyzing || parseMutations(mutationInput).length === 0}
                  className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Run Analysis
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- Sections 3-6: Results ---- */}
        <AnimatePresence>
          {(isAnalyzing || hasRun) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.4 }}
            >
              {isAnalyzing ? (
                /* ---- Loading State ---- */
                <Card className="border-slate-200/60 dark:border-slate-700/40">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                      <span className="text-sm font-medium text-muted-foreground">
                        Computing structural epistatic fitness landscape…
                      </span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                    </div>
                    <div className="pt-2">
                      <Skeleton className="h-48 w-full rounded-lg" />
                    </div>
                  </CardContent>
                </Card>
              ) : (
                /* ---- Results Tabs ---- */
                <Tabs
                  value={activeResultTab}
                  onValueChange={setActiveResultTab}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-4 mb-4 bg-muted/50 h-10">
                    <TabsTrigger value="table" className="text-xs gap-1.5 data-[state=active]:bg-background">
                      <Sparkles className="h-3.5 w-3.5 hidden sm:inline-block" />
                      Results
                    </TabsTrigger>
                    <TabsTrigger value="chart" className="text-xs gap-1.5 data-[state=active]:bg-background">
                      <Activity className="h-3.5 w-3.5 hidden sm:inline-block" />
                      Fitness Chart
                    </TabsTrigger>
                    <TabsTrigger value="epistasis" className="text-xs gap-1.5 data-[state=active]:bg-background">
                      <Network className="h-3.5 w-3.5 hidden sm:inline-block" />
                      Epistasis
                    </TabsTrigger>
                    <TabsTrigger value="mcts" className="text-xs gap-1.5 data-[state=active]:bg-background">
                      <TreePine className="h-3.5 w-3.5 hidden sm:inline-block" />
                      MCTS Tree
                    </TabsTrigger>
                  </TabsList>

                  {/* ---- Tab: Results Table ---- */}
                  <TabsContent value="table" className="mt-0">
                    <Card className="border-slate-200/60 dark:border-slate-700/40">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-emerald-500" />
                            <CardTitle className="text-sm font-semibold">
                              Mutation Analysis Results
                            </CardTitle>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {results.length} mutation{results.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          ΔΔG values in kcal/mol · Fitness score integrates fold stability, catalysis, binding & ESM-2 embeddings
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="max-h-[420px]">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground w-[110px]">
                                  Mutation
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center w-[60px]">
                                  Pos
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  ΔΔG Fold
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  ΔΔG Catal.
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  ΔΔG Bind
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  ESM-2
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  Coevol
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-right">
                                  Fitness
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center">
                                  Type
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {results.map((r, i) => {
                                const badge = fitnessBadgeVariant(r.fitnessScore, r.isCompensatory);
                                return (
                                  <motion.tr
                                    key={r.mutation}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: i * 0.04 }}
                                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                                  >
                                    <TableCell className="py-2.5">
                                      <span className="font-mono text-xs font-semibold text-foreground">
                                        {r.mutation}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-center">
                                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                        {r.position > 0 ? r.position : '—'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span className="font-mono text-xs tabular-nums text-foreground">
                                        {r.ddgFold > 0 ? '+' : ''}{r.ddgFold.toFixed(1)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span className="font-mono text-xs tabular-nums text-foreground">
                                        {r.ddgCatalysis > 0 ? '+' : ''}{r.ddgCatalysis.toFixed(1)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span className="font-mono text-xs tabular-nums text-foreground">
                                        {r.ddgBinding > 0 ? '+' : ''}{r.ddgBinding.toFixed(1)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span className="font-mono text-xs tabular-nums text-foreground">
                                        {r.esm2Score > 0 ? '+' : ''}{r.esm2Score.toFixed(1)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                        {r.coevolScore.toFixed(2)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                      <span
                                        className={cn(
                                          'font-mono text-xs font-bold tabular-nums',
                                          fitnessColor(r.fitnessScore)
                                        )}
                                      >
                                        {r.fitnessScore > 0 ? '+' : ''}{r.fitnessScore.toFixed(1)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-center">
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          'text-[10px] px-1.5 py-0 font-medium border',
                                          badge.className
                                        )}
                                      >
                                        {badge.label}
                                      </Badge>
                                    </TableCell>
                                  </motion.tr>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ---- Tab: Fitness Bar Chart ---- */}
                  <TabsContent value="chart" className="mt-0">
                    <Card className="border-slate-200/60 dark:border-slate-700/40">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4 text-emerald-500" />
                          <CardTitle className="text-sm font-semibold">
                            Fitness Score Landscape
                          </CardTitle>
                        </div>
                        <CardDescription className="text-xs">
                          Combined fitness scores ranked by mutational escape potential
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Legend */}
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                            <span className="text-[10px] text-muted-foreground">Resistance</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                            <span className="text-[10px] text-muted-foreground">Compensatory</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-sm bg-slate-500" />
                            <span className="text-[10px] text-muted-foreground">Neutral</span>
                          </div>
                        </div>

                        {chartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 36 + 40)}>
                            <BarChart
                              data={chartData}
                              layout="vertical"
                              margin={{ top: 0, right: 40, bottom: 0, left: 10 }}
                            >
                              <XAxis
                                type="number"
                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                axisLine={{ stroke: 'hsl(var(--border))' }}
                                tickLine={false}
                              />
                              <YAxis
                                type="category"
                                dataKey="mutation"
                                tick={{ fontSize: 11, fontFamily: 'monospace', fill: 'hsl(var(--foreground))' }}
                                axisLine={false}
                                tickLine={false}
                                width={120}
                              />
                              <RechartsTooltip content={<ChartTooltip />} />
                              <Bar
                                dataKey="fitness"
                                radius={[0, 4, 4, 0]}
                                barSize={20}
                                animationDuration={800}
                              >
                                {chartData.map((entry, index) => (
                                  <Cell
                                    key={index}
                                    fill={barColor(entry.type)}
                                    fillOpacity={0.8}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                            No results to display. Run an analysis first.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ---- Tab: Epistatic Interaction Heatmap ---- */}
                  <TabsContent value="epistasis" className="mt-0">
                    <Card className="border-slate-200/60 dark:border-slate-700/40">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4 text-amber-500" />
                          <CardTitle className="text-sm font-semibold">
                            Epistatic Interaction Map
                          </CardTitle>
                        </div>
                        <CardDescription className="text-xs">
                          Pairwise epistatic interactions between mutations · Individual vs. combined fitness effects
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Legend */}
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            <span className="text-[10px] text-muted-foreground">Synergistic</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                            <span className="text-[10px] text-muted-foreground">Antagonistic</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
                            <span className="text-[10px] text-muted-foreground">Additive</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                            <span className="text-[10px] text-muted-foreground">Neutral</span>
                          </div>
                        </div>

                        {/* Epistasis grid */}
                        <ScrollArea className="max-h-[400px]">
                          <div className="rounded-lg border border-border/50 overflow-hidden">
                            {/* Header */}
                            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] bg-muted/50 px-4 py-2.5 border-b border-border/50">
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                Mutation 1
                              </span>
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                                Mutation 2
                              </span>
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center">
                                Individual Σ
                              </span>
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center">
                                Combined
                              </span>
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center">
                                Interaction
                              </span>
                            </div>

                            {EPISTATIC_PAIRS.map((pair, i) => {
                              const style = epistasisStyle(pair.type);
                              return (
                                <motion.div
                                  key={`${pair.mut1}-${pair.mut2}`}
                                  initial={{ opacity: 0, x: -8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.06 }}
                                  className={cn(
                                    'grid grid-cols-[1fr_1fr_1fr_1fr_1fr] items-center px-4 py-3 border-b border-border/30 last:border-0',
                                    'hover:bg-muted/20 transition-colors'
                                  )}
                                >
                                  <span className="font-mono text-xs font-semibold text-foreground">
                                    {pair.mut1}
                                  </span>
                                  <span className="font-mono text-xs font-semibold text-foreground">
                                    {pair.mut2}
                                  </span>
                                  <span className="font-mono text-xs text-center tabular-nums text-muted-foreground">
                                    {pair.individual.toFixed(1)}
                                  </span>
                                  <span className="font-mono text-xs text-center tabular-nums font-semibold text-foreground">
                                    {pair.combined.toFixed(1)}
                                  </span>
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span
                                      className={cn(
                                        'font-mono text-xs tabular-nums font-bold',
                                        style.text
                                      )}
                                    >
                                      {pair.interaction > 0 ? '+' : ''}{pair.interaction.toFixed(1)}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        'text-[9px] px-1.5 py-0 border capitalize font-medium',
                                        style.bg,
                                        style.text,
                                        style.border
                                      )}
                                    >
                                      {pair.type}
                                    </Badge>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </ScrollArea>

                        {/* Interaction strength visual bar */}
                        <div className="mt-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Interaction Strength
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {EPISTATIC_PAIRS.map((pair) => {
                              const style = epistasisStyle(pair.type);
                              const absInteraction = Math.abs(pair.interaction);
                              const maxInteraction = 2.4;
                              const widthPct = (absInteraction / maxInteraction) * 100;
                              return (
                                <div
                                  key={`${pair.mut1}-${pair.mut2}-bar`}
                                  className="flex items-center gap-2"
                                >
                                  <span className="font-mono text-[10px] text-muted-foreground w-[100px] truncate shrink-0">
                                    {pair.mut1}+{pair.mut2}
                                  </span>
                                  <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${widthPct}%` }}
                                      transition={{ duration: 0.6, delay: 0.3 }}
                                      className={cn('h-full rounded-full', style.dot)}
                                    />
                                  </div>
                                  <span className={cn('font-mono text-[10px] tabular-nums w-[36px] text-right font-medium', style.text)}>
                                    {pair.interaction > 0 ? '+' : ''}{pair.interaction.toFixed(1)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ---- Tab: MCTS Tree ---- */}
                  <TabsContent value="mcts" className="mt-0">
                    <Card className="border-slate-200/60 dark:border-slate-700/40">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TreePine className="h-4 w-4 text-teal-500" />
                            <CardTitle className="text-sm font-semibold">
                              MCTS Exploration Tree
                            </CardTitle>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-normal border-teal-500/30 text-teal-600 bg-teal-500/5">
                            Monte Carlo Tree Search
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          Mutational escape trajectory exploration · Nodes ranked by visit count (n) and cumulative fitness (F)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Legend */}
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                            <span className="text-[10px] text-muted-foreground">Resistance Path</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            <span className="text-[10px] text-muted-foreground">Compensatory</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                            <span className="text-[10px] text-muted-foreground">Deleterious / Low-Fitness</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <CircleDot className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">Node size ∝ visit count</span>
                          </div>
                        </div>

                        {/* Tree visualization */}
                        <ScrollArea className="max-h-[500px] rounded-lg border border-border/30 bg-muted/10 p-4">
                          <div className="min-w-[320px]">
                            {/* Root node */}
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.4 }}
                              className="mb-1"
                            >
                              <div className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100/80 dark:bg-slate-800/60 px-4 py-2.5">
                                <div className="h-3 w-3 rounded-full bg-slate-400" />
                                <span className="font-mono text-sm font-bold text-foreground">
                                  {DEMO_MCTS_TREE.mutation}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  n={DEMO_MCTS_TREE.visits}
                                </span>
                              </div>
                            </motion.div>

                            {/* Child tree */}
                            <div className="ml-4 mt-1 border-l-2 border-slate-200 dark:border-slate-700 pl-4">
                              {DEMO_MCTS_TREE.children.map((child, idx) => (
                                <MCTSTreeNode
                                  key={child.id}
                                  node={child}
                                  isLast={idx === DEMO_MCTS_TREE.children.length - 1}
                                />
                              ))}
                            </div>
                          </div>
                        </ScrollArea>

                        {/* Summary stats */}
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                            <p className="text-lg font-bold tabular-nums text-foreground">
                              {countNodes(DEMO_MCTS_TREE)}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Total Nodes
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                            <p className="text-lg font-bold tabular-nums text-rose-500">
                              {countResistanceNodes(DEMO_MCTS_TREE)}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Resistance
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                            <p className="text-lg font-bold tabular-nums text-foreground">
                              {maxDepth(DEMO_MCTS_TREE)}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Max Depth
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                            <p className="text-lg font-bold tabular-nums text-rose-500">
                              {bestFitness(DEMO_MCTS_TREE).toFixed(1)}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Best Fitness
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- Footer hint ---- */}
        {results.length > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-[10px] text-muted-foreground pb-2"
          >
            SEFE v1.0 · Fitness scores are unitless composite metrics · ΔΔG in kcal/mol
          </motion.p>
        )}
      </div>
    </TooltipProvider>
  );
}

// --- MCTS Tree helpers ---
function countNodes(node: MCTSNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

function countResistanceNodes(node: MCTSNode): number {
  return (
    (node.isResistance ? 1 : 0) +
    node.children.reduce((sum, c) => sum + countResistanceNodes(c), 0)
  );
}

function maxDepth(node: MCTSNode): number {
  if (node.children.length === 0) return node.depth;
  return Math.max(...node.children.map(maxDepth));
}

function bestFitness(node: MCTSNode): number {
  const childBest = node.children.length > 0
    ? Math.max(...node.children.map(bestFitness))
    : -Infinity;
  return Math.max(node.fitnessScore, childBest);
}
