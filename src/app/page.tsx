'use client';

import { useState, useEffect, useSyncExternalStore, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Dna,
  ScanSearch,
  FlaskConical,
  Github,
  BookOpen,
  Cpu,
  Menu,
  X,
  Atom,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';

const DashboardPanel = dynamic(
  () => import('@/components/resistodiff/dashboard-panel'),
  { loading: () => <PanelSkeleton /> }
);
const SefePanel = dynamic(
  () => import('@/components/resistodiff/sefe-panel'),
  { loading: () => <PanelSkeleton /> }
);
const DapmPanel = dynamic(
  () => import('@/components/resistodiff/dapm-panel'),
  { loading: () => <PanelSkeleton /> }
);
const Ase3diffPanel = dynamic(
  () => import('@/components/resistodiff/ase3diff-panel'),
  { loading: () => <PanelSkeleton /> }
);
const MolecularSimPanel = dynamic(
  () => import('@/components/resistodiff/molecular-simulation-panel'),
  { loading: () => <PanelSkeleton /> }
);

function PanelSkeleton() {
  return (
    <div className="flex-1 p-4 md:p-6 space-y-4">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="h-4 w-96 bg-muted rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-xl animate-pulse" />
    </div>
  );
}

const NAV_ITEMS = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-emerald-500', desc: 'Overview & Targets' },
  { value: 'sefe', label: 'SEFE', icon: Dna, color: 'text-emerald-500', desc: 'Mutation Analysis' },
  { value: 'dapm', label: 'DAPM', icon: ScanSearch, color: 'text-amber-500', desc: 'Pocket Detection' },
  { value: 'ase3diff', label: 'A-SE3Diff', icon: FlaskConical, color: 'text-cyan-500', desc: 'Inhibitor Design' },
  { value: 'simulation', label: 'MD Simulation', icon: Atom, color: 'text-violet-500', desc: 'Molecular Dynamics' },
] as const;

type TabValue = (typeof NAV_ITEMS)[number]['value'];

export default function ResistoDiffPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    fetch('/api/seed', { method: 'POST' }).catch(() => {});
  }, []);

  const handleTabChange = useCallback((v: string) => {
    setActiveTab(v as TabValue);
  }, []);

  const activeItem = NAV_ITEMS.find(n => n.value === activeTab)!;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center h-14 px-4 md:px-6 gap-3">
          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {/* Logo & Title */}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Cpu className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight leading-none">
                ResistoDiff-3D
              </span>
              <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                AMR Mutational Escape Platform
              </span>
            </div>
          </div>

          {/* Desktop Nav Tabs */}
          <nav className="hidden md:flex items-center ml-6">
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className="bg-muted/50 h-9 p-0.5">
                {NAV_ITEMS.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className={cn(
                      'h-8 px-3 text-xs font-medium gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md',
                    )}
                  >
                    <item.icon className={cn('h-3.5 w-3.5', activeTab === item.value && item.color)} />
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:flex text-[10px] font-mono">
              RD3D-2026-SPEC-V1
            </Badge>
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Nav Overlay */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileNavOpen(false)}>
          <div
            className="absolute top-14 left-0 w-64 bg-background border-r border-border shadow-xl p-3 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_ITEMS.map((item) => (
              <button
                key={item.value}
                onClick={() => { setActiveTab(item.value); setMobileNavOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  activeTab === item.value
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                <div className="text-left">
                  <div>{item.label}</div>
                  {item.desc && (
                    <div className="text-[10px] opacity-70">{item.desc}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Module Title Bar */}
      <div className="border-b border-border bg-background px-4 md:px-6 py-3">
        <div className="flex items-center gap-2">
          <activeItem.icon className={cn('h-5 w-5', activeItem.color)} />
          <h1 className="text-lg font-semibold">{activeItem.label}</h1>
          {activeItem.desc && (
            <span className="text-sm text-muted-foreground hidden sm:inline">
              &mdash; {activeItem.desc}
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1">
        {mounted && (
          <div className={cn(activeTab !== 'dashboard' && 'hidden')}>
            <DashboardPanel />
          </div>
        )}
        {mounted && (
          <div className={cn(activeTab !== 'sefe' && 'hidden')}>
            <SefePanel />
          </div>
        )}
        {mounted && (
          <div className={cn(activeTab !== 'dapm' && 'hidden')}>
            <DapmPanel />
          </div>
        )}
        {mounted && (
          <div className={cn(activeTab !== 'ase3diff' && 'hidden')}>
            <Ase3diffPanel />
          </div>
        )}
        {mounted && (
          <div className={cn(activeTab !== 'simulation' && 'hidden')}>
            <MolecularSimPanel />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-background px-4 md:px-6 py-3 mt-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>ResistoDiff-3D Research Platform</span>
            <span className="hidden sm:inline">|</span>
            <span className="hidden sm:flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              SE(3)-Equivariant Graph Diffusion Framework
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-[10px] font-mono h-5">
              PyTorch + PyG
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono h-5">
              Next.js 16
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono h-5">
              Laptop-Optimized
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono h-5">
              FastAPI Backend
            </Badge>
          </div>
        </div>
      </footer>
    </div>
  );
}
