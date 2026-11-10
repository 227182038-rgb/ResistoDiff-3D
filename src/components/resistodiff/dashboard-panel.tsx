'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Dna,
  ScanSearch,
  FlaskConical,
  TrendingUp,
  Atom,
  Layers,
  FlaskRound,
  ArrowRight,
  Clock,
  CheckCircle2,
  ChevronRight,
  Database,
  Server,
  Box,
  LayoutDashboard,
  Cuboid,
  GitBranch,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { PROTEIN_TARGETS } from '@/lib/resistodiff-data';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';

// ============================================================================
// Animation Variants
// ============================================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const scaleInVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

// ============================================================================
// Data
// ============================================================================

const METRICS = [
  {
    label: 'Total Analyses',
    value: '847',
    icon: TrendingUp,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    trend: '+12.3%',
  },
  {
    label: 'Mutations Scored',
    value: '12,453',
    icon: Dna,
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
    trend: null,
  },
  {
    label: 'Pockets Detected',
    value: '2,156',
    icon: Atom,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    trend: null,
  },
  {
    label: 'Molecules Generated',
    value: '4,892',
    icon: FlaskRound,
    color: 'text-cyan-500',
    bg: 'bg-cyan-500/10',
    trend: null,
  },
];

const MODULES = [
  {
    name: 'SEFE',
    fullName: 'Structural Epistatic Fitness Engine',
    icon: Dna,
    color: 'emerald',
    description:
      'Predicts fitness effects of mutations using ESM-2 protein language models, coevolutionary analysis, and thermodynamic ΔΔG scoring across combinatorial mutational landscapes.',
  },
  {
    name: 'DAPM',
    fullName: 'Dynamic Allosteric Pocket Miner',
    icon: ScanSearch,
    color: 'amber',
    description:
      'Detects cryptic and allosteric drug-binding pockets via molecular dynamics-enhanced geometric analysis with ensemble-based druggability scoring.',
  },
  {
    name: 'A-SE3Diff',
    fullName: 'Counter-Inhibitor Diffuser',
    icon: FlaskConical,
    color: 'cyan',
    description:
      'Generates novel 3D molecular candidates using equivariant SE(3) diffusion models conditioned on pocket geometry and pharmacophore constraints.',
  },
];

const TIMELINE_EVENTS = [
  {
    description: 'Completed SEFE analysis on TEM-1',
    time: '2 hours ago',
    module: 'SEFE',
    moduleColor: 'bg-emerald-500',
  },
  {
    description: 'Detected 4 cryptic pockets in NDM-1',
    time: '5 hours ago',
    module: 'DAPM',
    moduleColor: 'bg-amber-500',
  },
  {
    description: 'Generated 6 counter-inhibitor candidates for TEM-1 Pocket 2',
    time: '1 day ago',
    module: 'A-SE3Diff',
    moduleColor: 'bg-cyan-500',
  },
  {
    description: 'MCTS trajectory search completed (1,247 nodes)',
    time: '2 days ago',
    module: 'SEFE',
    moduleColor: 'bg-emerald-500',
  },
  {
    description: 'New protein target added: DNA Gyrase A',
    time: '3 days ago',
    module: 'System',
    moduleColor: 'bg-slate-500',
  },
];

const ROADMAP_PHASES = [
  { name: 'Phase 1', label: 'MVP — Core Pipeline', status: 'complete' as const },
  { name: 'Phase 2', label: 'Validation & Benchmarks', status: 'complete' as const },
  { name: 'Phase 3', label: 'Multi-Target Expansion', status: 'in-progress' as const },
  { name: 'Phase 4', label: 'Clinical Integration', status: 'upcoming' as const },
  { name: 'Phase 5', label: 'Platform Launch', status: 'upcoming' as const },
];

// ============================================================================
// Color Helpers
// ============================================================================

const moduleColorMap: Record<string, { border: string; bg: string; badge: string; text: string; icon: string }> = {
  emerald: {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    text: 'text-emerald-600',
    icon: 'text-emerald-500',
  },
  amber: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    badge: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    text: 'text-amber-600',
    icon: 'text-amber-500',
  },
  cyan: {
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5',
    badge: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
    text: 'text-cyan-600',
    icon: 'text-cyan-500',
  },
};

// ============================================================================
// Sub-Components
// ============================================================================

function HeroHeader() {
  return (
    <motion.section
      variants={itemVariants}
      className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-10 sm:px-10 sm:py-14"
    >
      {/* Decorative grid background */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]">
        <div
          className="h-full w-full"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>
      {/* Decorative glow orbs */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/5 blur-3xl" />

      <div className="relative z-10">
        <div className="mb-4 flex items-center gap-3">
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] tracking-wider text-emerald-400 sm:text-xs"
          >
            RD3D-2026-SPEC-V1
          </Badge>
        </div>
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
            ResistoDiff-3D
          </span>
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-400 sm:text-base">
          Multi-Scale Structural Physics &amp; Geometric Deep Learning Framework for Antimicrobial Resistance Mutational
          Escape Prediction
        </p>
      </div>
    </motion.section>
  );
}

function MetricCard({
  metric,
  index,
}: {
  metric: (typeof METRICS)[number];
  index: number;
}) {
  const Icon = metric.icon;
  return (
    <motion.div variants={itemVariants} className={cn(index === 0 && 'sm:col-span-1')}>
      <Card className="group relative overflow-hidden border-slate-200/60 bg-white transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                {metric.label}
              </p>
              <p className={cn('text-3xl font-bold tracking-tight sm:text-3xl', metric.color)}>
                {metric.value}
              </p>
            </div>
            <div className={cn('rounded-xl p-2.5', metric.bg)}>
              <Icon className={cn('h-5 w-5', metric.color)} />
            </div>
          </div>
          {metric.trend && (
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
              <TrendingUp className="h-3 w-3" />
              <span className="font-medium">{metric.trend} this week</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function KeyMetricsRow() {
  return (
    <motion.section variants={containerVariants} initial="hidden" animate="visible">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {METRICS.map((metric, i) => (
          <MetricCard key={metric.label} metric={metric} index={i} />
        ))}
      </div>
    </motion.section>
  );
}

function ModuleStatusCards() {
  return (
    <motion.section variants={itemVariants}>
      <div className="mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase sm:text-base">
          Pipeline Modules
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const colors = moduleColorMap[mod.color];
          return (
            <motion.div key={mod.name} variants={scaleInVariants}>
              <Card
                className={cn(
                  'group relative overflow-hidden border transition-all hover:shadow-md',
                  colors.border,
                  colors.bg
                )}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-lg',
                          mod.color === 'emerald' && 'bg-emerald-500/10',
                          mod.color === 'amber' && 'bg-amber-500/10',
                          mod.color === 'cyan' && 'bg-cyan-500/10'
                        )}
                      >
                        <Icon className={cn('h-5 w-5', colors.icon)} />
                      </div>
                      <div>
                        <CardTitle className="text-base font-bold">{mod.name}</CardTitle>
                        <CardDescription className="text-[11px] font-medium">
                          {mod.fullName}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'border bg-white/80 text-[10px] font-semibold uppercase tracking-wider',
                        colors.badge
                      )}
                    >
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Ready
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {mod.description}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      'w-full border text-xs font-medium transition-colors',
                      colors.border,
                      colors.text,
                      'hover:bg-white/50'
                    )}
                  >
                    Launch {mod.name}
                    <ArrowRight className="ml-1.5 h-3 w-3" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

function ArchitectureDiagram() {
  const layers = [
    {
      name: 'User Interface Layer',
      items: [
        { label: 'React / Next.js Dashboard', icon: LayoutDashboard },
        { label: 'Mol* 3D Engine', icon: Cuboid },
      ],
      color: 'emerald' as const,
    },
    {
      name: 'API & Orchestration Layer',
      items: [
        { label: 'FastAPI Gateway', icon: Server },
        { label: 'Ray Scheduler', icon: Server },
        { label: 'Redis Queue', icon: Database },
      ],
      color: 'slate' as const,
    },
    {
      name: 'Computational Core',
      items: [
        { label: 'SEFE Engine', icon: Dna },
        { label: 'DAPM Engine', icon: ScanSearch },
        { label: 'A-SE3Diff Engine', icon: FlaskConical },
      ],
      color: 'amber' as const,
      highlight: true,
    },
    {
      name: 'Data & Storage',
      items: [
        { label: 'PostgreSQL', icon: Database },
        { label: 'MinIO Object Store', icon: Box },
        { label: 'Neo4j Graph DB', icon: GitBranch },
      ],
      color: 'slate' as const,
    },
  ];

  const colorStyles: Record<string, { layerBg: string; layerBorder: string; itemBg: string; itemBorder: string; iconColor: string; itemText: string; layerLabel: string }> = {
    emerald: {
      layerBg: 'bg-emerald-500/5',
      layerBorder: 'border-emerald-500/20',
      itemBg: 'bg-emerald-500/10',
      itemBorder: 'border-emerald-500/20',
      iconColor: 'text-emerald-500',
      itemText: 'text-emerald-700',
      layerLabel: 'text-emerald-600',
    },
    slate: {
      layerBg: 'bg-slate-500/5',
      layerBorder: 'border-slate-300/30',
      itemBg: 'bg-slate-500/5',
      itemBorder: 'border-slate-300/25',
      iconColor: 'text-slate-500',
      itemText: 'text-slate-700',
      layerLabel: 'text-slate-600',
    },
    amber: {
      layerBg: 'bg-amber-500/10',
      layerBorder: 'border-amber-500/30',
      itemBg: 'bg-amber-500/10',
      itemBorder: 'border-amber-500/25',
      iconColor: 'text-amber-600',
      itemText: 'text-amber-800',
      layerLabel: 'text-amber-600',
    },
  };

  return (
    <motion.section variants={itemVariants}>
      <Card className="overflow-hidden border-slate-200/60 bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-sm font-semibold tracking-wide uppercase sm:text-base">
              System Architecture
            </CardTitle>
          </div>
          <CardDescription>4-layer microservice architecture for scalable AMR analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative flex flex-col gap-1">
            {layers.map((layer, layerIdx) => {
              const styles = colorStyles[layer.color];
              return (
                <div key={layer.name}>
                  {/* Down arrow between layers */}
                  {layerIdx > 0 && (
                    <div className="flex justify-center py-1">
                      <div className="flex flex-col items-center">
                        <div className="h-3 w-px bg-slate-300" />
                        <div className="h-0 w-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-300" />
                      </div>
                    </div>
                  )}
                  {/* Layer container */}
                  <div
                    className={cn(
                      'rounded-xl border p-3 sm:p-4',
                      styles.layerBg,
                      styles.layerBorder,
                      layer.highlight && 'ring-2 ring-amber-500/20'
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      {layer.highlight && (
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                        </span>
                      )}
                      <p className={cn('text-[11px] font-semibold tracking-wider uppercase sm:text-xs', styles.layerLabel)}>
                        {layer.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {layer.items.map((item) => {
                        const ItemIcon = item.icon;
                        return (
                          <div
                            key={item.label}
                            className={cn(
                              'flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                              styles.itemBg,
                              styles.itemBorder
                            )}
                          >
                            <ItemIcon className={cn('h-3.5 w-3.5', styles.iconColor)} />
                            <span className={cn('text-xs font-medium', styles.itemText)}>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

function ActivityTimeline() {
  return (
    <motion.section variants={itemVariants}>
      <Card className="border-slate-200/60 bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-sm font-semibold tracking-wide uppercase sm:text-base">
              Recent Activity
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-0">
            {TIMELINE_EVENTS.map((event, idx) => (
              <div key={idx} className="relative flex gap-3 pb-5 last:pb-0">
                {/* Vertical line */}
                {idx < TIMELINE_EVENTS.length - 1 && (
                  <div className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />
                )}
                {/* Dot */}
                <div className="relative z-10 mt-1 flex-shrink-0">
                  <span
                    className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full ring-4 ring-white',
                      event.moduleColor
                    )}
                  />
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700">{event.description}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">{event.time}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-4 border px-1.5 text-[9px] font-semibold uppercase tracking-wider',
                        event.module === 'SEFE' && 'border-emerald-500/20 text-emerald-600',
                        event.module === 'DAPM' && 'border-amber-500/20 text-amber-600',
                        event.module === 'A-SE3Diff' && 'border-cyan-500/20 text-cyan-600',
                        event.module === 'System' && 'border-slate-300 text-slate-500'
                      )}
                    >
                      {event.module}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

function BiologicalTargetsOverview() {
  const classColors: Record<string, string> = {
    'Class A Beta-Lactamase': 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    'Metallo-Beta-Lactamase (Class B)': 'bg-rose-500/10 text-rose-700 border-rose-500/20',
    'DNA Gyrase (Type IIA Topoisomerase)': 'bg-cyan-500/10 text-cyan-700 border-cyan-500/20',
  };

  return (
    <motion.section variants={itemVariants}>
      <Card className="border-slate-200/60 bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Dna className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-sm font-semibold tracking-wide uppercase sm:text-base">
              Biological Targets
            </CardTitle>
          </div>
          <CardDescription>
            {PROTEIN_TARGETS.length} protein targets loaded for analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {PROTEIN_TARGETS.map((target) => (
              <div
                key={target.id}
                className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200/60 bg-slate-50/50 p-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{target.name}</span>
                    <Badge
                      variant="outline"
                      className={cn('border text-[10px] font-medium', classColors[target.targetClass])}
                    >
                      {target.targetClass}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-mono">{target.uniprotId}</span>
                    <span>·</span>
                    <span className="font-mono">{target.pdbId}</span>
                    <span>·</span>
                    <span>{target.organism}</span>
                    <span>·</span>
                    <span>{target.sequenceLength} aa</span>
                  </div>
                </div>
                <button className="flex-shrink-0 text-xs font-medium text-emerald-600 opacity-0 transition-opacity hover:text-emerald-700 group-hover:opacity-100">
                  Select <ChevronRight className="ml-0.5 inline h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

function DevelopmentRoadmap() {
  const statusStyles = {
    complete: {
      dot: 'bg-emerald-500 ring-emerald-500/30',
      line: 'bg-emerald-500',
      label: 'text-emerald-700',
      phase: 'text-emerald-600',
    },
    'in-progress': {
      dot: 'bg-amber-500 ring-amber-500/30',
      line: 'bg-gradient-to-r from-amber-500 to-slate-300',
      label: 'text-amber-700',
      phase: 'text-amber-600',
    },
    upcoming: {
      dot: 'bg-slate-300 ring-slate-300/30',
      line: 'bg-slate-200',
      label: 'text-slate-400',
      phase: 'text-slate-400',
    },
  };

  const completedCount = ROADMAP_PHASES.filter((p) => p.status === 'complete').length;
  const progressPct = Math.round(((completedCount + 0.5) / ROADMAP_PHASES.length) * 100);

  return (
    <motion.section variants={itemVariants}>
      <Card className="border-slate-200/60 bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-slate-500" />
              <CardTitle className="text-sm font-semibold tracking-wide uppercase sm:text-base">
                Development Roadmap
              </CardTitle>
            </div>
            <span className="text-xs font-medium text-slate-500">{progressPct}% Complete</span>
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress bar */}
          <div className="mb-6">
            <Progress value={progressPct} className="h-2" />
          </div>

          {/* Phase timeline */}
          <div className="relative">
            {/* Horizontal connecting line (desktop) */}
            <div className="absolute left-4 right-4 top-3 hidden h-0.5 bg-slate-200 sm:block" />
            {/* Colored progress overlay on the line */}
            <div
              className="absolute left-4 top-3 hidden h-0.5 bg-emerald-500 sm:block"
              style={{ width: `${(completedCount / (ROADMAP_PHASES.length - 1)) * 100}%` }}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5 sm:gap-2">
              {ROADMAP_PHASES.map((phase, idx) => {
                const styles = statusStyles[phase.status];
                return (
                  <div key={phase.name} className="relative flex sm:flex-col sm:items-center sm:gap-2">
                    {/* Mobile: left layout, Desktop: top layout */}
                    <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2">
                      {/* Dot */}
                      <div className="relative z-10 flex-shrink-0">
                        {phase.status === 'in-progress' ? (
                          <span className="relative flex h-6 w-6 sm:h-7 sm:w-7">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-40" />
                            <span
                              className={cn(
                                'relative inline-flex h-6 w-6 items-center justify-center rounded-full sm:h-7 sm:w-7',
                                'bg-amber-500 ring-4 ring-white'
                              )}
                            >
                              <span className="h-2 w-2 rounded-full bg-white" />
                            </span>
                          </span>
                        ) : (
                          <div
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white sm:h-7 sm:w-7',
                              styles.dot,
                              phase.status === 'complete' && 'bg-emerald-500'
                            )}
                          >
                            {phase.status === 'complete' && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
                            )}
                          </div>
                        )}
                      </div>
                      {/* Text */}
                      <div className="sm:text-center">
                        <p className={cn('text-[11px] font-bold uppercase tracking-wider sm:text-xs', styles.phase)}>
                          {phase.name}
                        </p>
                        <p className={cn('mt-0.5 text-[11px] sm:text-xs', styles.label)}>{phase.label}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ============================================================================
// Backend Status Banner
// ============================================================================

function BackendStatusBanner() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/dataset');
        const data = await res.json();
        if (data.backend_offline) {
          setStatus('offline');
        } else {
          setStatus('online');
          if (data.targets) {
            setModels(data.targets.map((t: { name: string; has_pdb: boolean }) => `${t.name}${t.has_pdb ? ' [PDB]' : ''}`));
          }
        }
      } catch {
        setStatus('offline');
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div variants={itemVariants}>
      <Card className={cn(
        'border-2',
        status === 'online' ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20' :
        status === 'offline' ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20' :
        'border-muted'
      )}>
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className={cn('h-4 w-4', status === 'online' ? 'text-emerald-500' : 'text-amber-500')} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Python ML Backend</span>
                  <Badge variant={status === 'online' ? 'default' : 'secondary'} className={cn(
                    'text-[10px]',
                    status === 'online' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500/20 text-amber-700'
                  )}>
                    {status === 'checking' ? 'Checking...' : status === 'online' ? 'Connected' : 'Simulation Mode'}
                  </Badge>
                </div>
                {status === 'online' && models.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Targets loaded: {models.join(', ')}
                  </div>
                )}
                {status === 'offline' && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Running with built-in simulation. Run <code className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">./setup.sh</code> to activate real ML engines.
                  </div>
                )}
              </div>
            </div>
            {status === 'online' && (
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-600 font-medium">Live</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function DashboardPanel() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6 lg:space-y-8"
        >
          {/* 1. Hero Header */}
          <HeroHeader />

          {/* 1.5 Backend Status Banner */}
          <BackendStatusBanner />

          {/* 2. Key Metrics Row */}
          <KeyMetricsRow />

          <Separator className="opacity-50" />

          {/* 3. Module Status Cards */}
          <ModuleStatusCards />

          {/* 4. System Architecture + 5. Activity Timeline (side by side on desktop) */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ArchitectureDiagram />
            </div>
            <div className="lg:col-span-2">
              <ActivityTimeline />
            </div>
          </div>

          {/* 6. Biological Targets + 7. Roadmap (side by side on desktop) */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <BiologicalTargetsOverview />
            </div>
            <div className="lg:col-span-2">
              <DevelopmentRoadmap />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
