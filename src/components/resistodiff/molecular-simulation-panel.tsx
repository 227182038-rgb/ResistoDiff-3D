'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Activity,
  Thermometer,
  Atom,
  Zap,
  Clock,
  Target,
  BarChart3,
  Grid3X3,
  TrendingUp,
  CircleDot,
  Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { type ProteinTarget, PROTEIN_TARGETS, DEMO_POCKETS } from '@/lib/resistodiff-data';
import { runMolecularSimulation, pollTask } from '@/lib/backend-client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

// ==========================================================================
// Types
// ==========================================================================

interface SimAtom {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx: number;
  fy: number;
  fz: number;
  mass: number;
  residueIndex: number;
  isBackbone: boolean;
  radius: number;
}

interface SimBond {
  i: number;
  j: number;
  restLength: number;
}

interface PocketSphere {
  x: number;
  y: number;
  z: number;
  radius: number;
  druggability: number;
  pocketType: string;
}

interface EnergyRecord {
  step: number;
  kinetic: number;
  potential: number;
  total: number;
}

interface SimulationStats {
  currentStep: number;
  totalSteps: number;
  elapsedTime: number;
  currentTemperature: number;
  totalEnergy: number;
  radiusOfGyration: number;
}

interface ResultData {
  rmsfPerResidue: { residue: number; value: number }[];
  bFactors: { residue: number; value: number }[];
  contactCount: number;
  avgContactsPerAtom: number;
  finalRg: number;
  avgEnergy: number;
  energyStdDev: number;
  minDistance: number;
  maxDistance: number;
}

// ==========================================================================
// Simulation Engine — simple Verlet integration with LJ + harmonic bonds
// ==========================================================================

function createHelicalProtein(numResidues: number, seed: number = 42): { atoms: SimAtom[]; bonds: SimBond[] } {
  const atoms: SimAtom[] = [];
  const bonds: SimBond[] = [];
  const rng = seededRng(seed);

  const helixRadius = 2.3;
  const risePerResidue = 1.5;
  const anglePerResidue = (100 * Math.PI) / 180;

  let atomIdx = 0;
  for (let r = 0; r < numResidues; r++) {
    const theta = r * anglePerResidue;
    const zBase = r * risePerResidue;
    const cx = helixRadius * Math.cos(theta);
    const cy = helixRadius * Math.sin(theta);

    // N (backbone)
    atoms.push(makeAtom(cx - 0.5, cy, zBase, 14.0, r, true, 1.55, rng));
    bonds.push({ i: atomIdx, j: atomIdx + 1, restLength: 1.33 });
    atomIdx++;

    // C-alpha (backbone)
    atoms.push(makeAtom(cx, cy, zBase + 0.5, 12.0, r, true, 1.7, rng));
    if (r > 0) {
      bonds.push({ i: atomIdx - 2, j: atomIdx, restLength: 2.45 });
    }
    atomIdx++;

    // C (backbone)
    atoms.push(makeAtom(cx + 0.7, cy + 0.3, zBase + 1.0, 12.0, r, true, 1.52, rng));
    bonds.push({ i: atomIdx - 1, j: atomIdx, restLength: 1.53 });
    atomIdx++;

    // Side chain atom
    const scLen = 1.0 + rng() * 1.5;
    const scAngle = theta + rng() * 0.8;
    const sx = cx + scLen * Math.cos(scAngle) * 0.7;
    const sy = cy + scLen * Math.sin(scAngle) * 0.7;
    atoms.push(makeAtom(sx, sy, zBase + 0.5 + rng() * 0.5, 15.0, r, false, 1.4 + rng() * 0.4, rng));
    bonds.push({ i: atomIdx - 2, j: atomIdx, restLength: 1.5 + rng() * 0.3 });
    atomIdx++;
  }

  return { atoms, bonds };
}

function makeAtom(
  x: number, y: number, z: number,
  mass: number, residueIndex: number,
  isBackbone: boolean, radius: number, rng: () => number
): SimAtom {
  return {
    x, y, z,
    vx: (rng() - 0.5) * 0.5,
    vy: (rng() - 0.5) * 0.5,
    vz: (rng() - 0.5) * 0.5,
    fx: 0, fy: 0, fz: 0,
    mass,
    residueIndex,
    isBackbone,
    radius,
  };
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function computeForces(atoms: SimAtom[], bonds: SimBond[]): number {
  let potentialEnergy = 0;
  const eps = 0.5;
  const sigma = 2.5;
  const sigma6 = sigma ** 6;
  const sigma12 = sigma6 * sigma6;
  const cutoff = sigma * 2.5;
  const cutoffSq = cutoff * cutoff;
  const bondK = 50.0;

  // Reset forces
  for (const a of atoms) {
    a.fx = 0;
    a.fy = 0;
    a.fz = 0;
  }

  // LJ pairwise
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const dx = atoms[j].x - atoms[i].x;
      const dy = atoms[j].y - atoms[i].y;
      const dz = atoms[j].z - atoms[i].z;
      const rSq = dx * dx + dy * dy + dz * dz;
      if (rSq > cutoffSq || rSq < 0.01) continue;
      const r2inv = 1.0 / rSq;
      const r6inv = r2inv * r2inv * r2inv;
      const r12inv = r6inv * r6inv;
      const fOverR = 24.0 * eps * (2.0 * sigma12 * r12inv - sigma6 * r6inv) * r2inv;
      const fx = fOverR * dx;
      const fy = fOverR * dy;
      const fz = fOverR * dz;
      atoms[i].fx -= fx;
      atoms[i].fy -= fy;
      atoms[i].fz -= fz;
      atoms[j].fx += fx;
      atoms[j].fy += fy;
      atoms[j].fz += fz;
      potentialEnergy += 4.0 * eps * (sigma12 * r12inv - sigma6 * r6inv);
    }
  }

  // Harmonic bonds
  for (const b of bonds) {
    const ai = atoms[b.i];
    const aj = atoms[b.j];
    const dx = aj.x - ai.x;
    const dy = aj.y - ai.y;
    const dz = aj.z - ai.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.001) continue;
    const dr = dist - b.restLength;
    const f = bondK * dr / dist;
    const fx = f * dx;
    const fy = f * dy;
    const fz = f * dz;
    ai.fx += fx;
    ai.fy += fy;
    ai.fz += fz;
    aj.fx -= fx;
    aj.fy -= fy;
    aj.fz -= fz;
    potentialEnergy += 0.5 * bondK * dr * dr;
  }

  return potentialEnergy;
}

function velocityVerletStep(
  atoms: SimAtom[], bonds: SimBond[], dt: number
): { kineticEnergy: number; potentialEnergy: number; temperature: number } {
  // Half-step velocity
  for (const a of atoms) {
    const halfDt = dt * 0.5 / a.mass;
    a.vx += a.fx * halfDt;
    a.vy += a.fy * halfDt;
    a.vz += a.fz * halfDt;
  }

  // Full-step position
  for (const a of atoms) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.z += a.vz * dt;
  }

  // Compute new forces
  const potentialEnergy = computeForces(atoms, bonds);

  // Complete velocity step
  let kineticEnergy = 0;
  for (const a of atoms) {
    const halfDt = dt * 0.5 / a.mass;
    a.vx += a.fx * halfDt;
    a.vy += a.fy * halfDt;
    a.vz += a.fz * halfDt;
    kineticEnergy += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
  }

  const dof = 3 * atoms.length - 6;
  const temperature = dof > 0 ? (2.0 * kineticEnergy) / dof : 0;

  return { kineticEnergy, potentialEnergy, temperature };
}

function computeRadiusOfGyration(atoms: SimAtom[]): number {
  let cx = 0, cy = 0, cz = 0;
  const n = atoms.length;
  for (const a of atoms) {
    cx += a.x; cy += a.y; cz += a.z;
  }
  cx /= n; cy /= n; cz /= n;
  let rg2 = 0;
  for (const a of atoms) {
    rg2 += (a.x - cx) ** 2 + (a.y - cy) ** 2 + (a.z - cz) ** 2;
  }
  return Math.sqrt(rg2 / n);
}

// ==========================================================================
// 3D Projection helpers
// ==========================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function project(
  v: Vec3, fov: number, distance: number, cx: number, cy: number
): { sx: number; sy: number; scale: number } {
  const denom = v.z + distance;
  const safeDenom = denom < 0.1 ? 0.1 : denom;
  const scale = fov / safeDenom;
  return { sx: v.x * scale + cx, sy: v.y * scale + cy, scale };
}

// ==========================================================================
// Color utilities
// ==========================================================================

function bfactorToColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(clamped * 255);
  const b = Math.round((1 - clamped) * 255);
  const g = Math.round(Math.min(clamped, 1 - clamped) * 2 * 128);
  return `rgb(${r},${g},${b})`;
}

// ==========================================================================
// Component
// ==========================================================================

const NUM_RESIDUES = 20;
const ATOMS_PER_RESIDUE = 4;
const TOTAL_ATOMS = NUM_RESIDUES * ATOMS_PER_RESIDUE;
const STEPS_PER_FRAME = 3;

export default function MolecularSimulationPanel() {
  // --- State ---
  const [selectedTarget, setSelectedTarget] = useState<string>('tem1');
  const [temperature, setTemperature] = useState<number>(300);
  const [numSteps, setNumSteps] = useState<number>(500);
  const [timeStep, setTimeStep] = useState<number>(0.002);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);

  const [stats, setStats] = useState<SimulationStats>({
    currentStep: 0, totalSteps: 0, elapsedTime: 0,
    currentTemperature: 300, totalEnergy: 0, radiusOfGyration: 0,
  });

  const [energyHistory, setEnergyHistory] = useState<EnergyRecord[]>([]);
  const [rmsfData, setRmsfData] = useState<{ residue: number; value: number }[]>([]);
  const [bFactorData, setBFactorData] = useState<{ residue: number; value: number }[]>([]);
  const [contactCount, setContactCount] = useState(0);
  const [avgContacts, setAvgContacts] = useState(0);
  const [avgEnergy, setAvgEnergy] = useState(0);
  const [energyStdDev, setEnergyStdDev] = useState(0);
  const [minDist, setMinDist] = useState(0);
  const [maxDist, setMaxDist] = useState(0);

  const [rotY, setRotY] = useState(0.4);
  const [rotX, setRotX] = useState(0.3);
  const [rmsfPerAtom, setRmsfPerAtom] = useState<number[]>([]);
  const [contactMapAtoms, setContactMapAtoms] = useState<SimAtom[]>([]);

  // Refs for simulation state
  const atomsRef = useRef<SimAtom[]>([]);
  const bondsRef = useRef<SimBond[]>([]);
  const stepRef = useRef(0);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const pauseStartRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const rmsfAccumRef = useRef<number[]>([]);
  const rmsfCountRef = useRef(0);
  const initialPositionsRef = useRef<Vec3[]>([]);
  const simLoopRef = useRef<() => void>(() => {});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // --- Derived ---
  const target: ProteinTarget | undefined = PROTEIN_TARGETS.find(t => t.id === selectedTarget);
  const pockets: PocketSphere[] = useMemo(() => {
    const demoPockets = DEMO_POCKETS[selectedTarget];
    if (!demoPockets) return [];
    return demoPockets.map(p => ({
      x: p.centerX, y: p.centerY, z: p.centerZ,
      radius: Math.max(3, p.volume / 50),
      druggability: p.druggability,
      pocketType: p.pocketType,
    }));
  }, [selectedTarget]);

  const contactMapCells = useMemo(() => {
    if (contactMapAtoms.length === 0) return null;
    const cellSize = 160 / NUM_RESIDUES;
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < NUM_RESIDUES; i++) {
      for (let j = i; j < NUM_RESIDUES; j++) {
        const riAtoms = contactMapAtoms.filter(a => a.residueIndex === i);
        const rjAtoms = contactMapAtoms.filter(a => a.residueIndex === j);
        if (riAtoms.length === 0 || rjAtoms.length === 0) continue;
        const ci = riAtoms.reduce((s, a) => ({ x: s.x + a.x, y: s.y + a.y, z: s.z + a.z }), { x: 0, y: 0, z: 0 });
        ci.x /= riAtoms.length; ci.y /= riAtoms.length; ci.z /= riAtoms.length;
        const cj = rjAtoms.reduce((s, a) => ({ x: s.x + a.x, y: s.y + a.y, z: s.z + a.z }), { x: 0, y: 0, z: 0 });
        cj.x /= rjAtoms.length; cj.y /= rjAtoms.length; cj.z /= rjAtoms.length;
        const dist = Math.sqrt((ci.x - cj.x) ** 2 + (ci.y - cj.y) ** 2 + (ci.z - cj.z) ** 2);
        const inContact = dist < 6.0;
        const opacity = inContact ? Math.max(0.2, 1 - dist / 10) : 0.05;
        const color = inContact ? `rgba(34,197,94,${opacity})` : 'rgba(39,39,42,0.3)';
        cells.push(
          <rect key={`${i}-${j}`} x={i * cellSize} y={j * cellSize} width={cellSize - 0.5} height={cellSize - 0.5} fill={color} />
        );
        if (i !== j) {
          cells.push(
            <rect key={`${j}-${i}`} x={j * cellSize} y={i * cellSize} width={cellSize - 0.5} height={cellSize - 0.5} fill={color} />
          );
        }
      }
    }
    return cells;
  }, [contactMapAtoms]);

  // --- Initialize protein ---
  const initSimulation = useCallback(() => {
    const { atoms, bonds } = createHelicalProtein(NUM_RESIDUES, 42);
    atomsRef.current = atoms;
    bondsRef.current = bonds;
    stepRef.current = 0;
    setEnergyHistory([]);
    setIsComplete(false);
    setIsPaused(false);
    setRmsfData([]);
    setBFactorData([]);
    setContactCount(0);
    setAvgContacts(0);
    setAvgEnergy(0);
    setEnergyStdDev(0);
    setMinDist(0);
    setMaxDist(0);
    setRmsfPerAtom(new Array(atoms.length).fill(0));
    rmsfAccumRef.current = new Array(atoms.length).fill(0);
    rmsfCountRef.current = 0;
    initialPositionsRef.current = atoms.map(a => ({ x: a.x, y: a.y, z: a.z }));
    setContactMapAtoms([...atoms]);
    setStats({
      currentStep: 0, totalSteps: numSteps, elapsedTime: 0,
      currentTemperature: 0, totalEnergy: 0, radiusOfGyration: 0,
    });
  }, [numSteps]);

  // --- Thermostat (Berendsen) ---
  const applyThermostat = useCallback((atoms: SimAtom[], targetTemp: number, currentTemp: number, dt: number) => {
    if (currentTemp < 0.001) return;
    const tau = 0.1;
    const lambda = Math.sqrt(1 + (dt / tau) * (targetTemp / currentTemp - 1));
    const clampedLambda = Math.max(0.8, Math.min(1.2, lambda));
    for (const a of atoms) {
      a.vx *= clampedLambda;
      a.vy *= clampedLambda;
      a.vz *= clampedLambda;
    }
  }, []);

  // --- Simulation loop ---
  const simLoop = useCallback(() => {
    if (!isRunning || isPaused) return;

    const atoms = atomsRef.current;
    const bonds = bondsRef.current;
    if (atoms.length === 0) return;

    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      stepRef.current++;
      const { kineticEnergy, potentialEnergy, temperature: currentTemp } = velocityVerletStep(atoms, bonds, timeStep);

      // Apply thermostat
      applyThermostat(atoms, temperature, currentTemp, timeStep);

      // Compute RG
      const rg = computeRadiusOfGyration(atoms);
      const totalE = kineticEnergy + potentialEnergy;

      // Accumulate RMSF
      const initial = initialPositionsRef.current;
      for (let i = 0; i < atoms.length; i++) {
        rmsfAccumRef.current[i] += (atoms[i].x - initial[i].x) ** 2 + (atoms[i].y - initial[i].y) ** 2 + (atoms[i].z - initial[i].z) ** 2;
      }
      rmsfCountRef.current++;

      // Record energy every few steps
      if (stepRef.current % 3 === 0) {
        setEnergyHistory(prev => {
          const next = [...prev, { step: stepRef.current, kinetic: kineticEnergy, potential: potentialEnergy, total: totalE }];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }

      // Update stats
      const elapsed = (Date.now() - startTimeRef.current - pauseOffsetRef.current) / 1000;
      setStats({
        currentStep: stepRef.current,
        totalSteps: numSteps,
        elapsedTime: elapsed,
        currentTemperature: currentTemp,
        totalEnergy: totalE,
        radiusOfGyration: rg,
      });

      if (stepRef.current >= numSteps) {
        setIsRunning(false);
        setIsComplete(true);
        setContactMapAtoms([...atoms]);
        break;
      }
    }

    // Update per-atom RMSF display
    const count = rmsfCountRef.current;
    if (count > 0) {
      setRmsfPerAtom(rmsfAccumRef.current.map(v => Math.sqrt(v / count)));
    }

    animFrameRef.current = requestAnimationFrame(() => simLoopRef.current());
  }, [temperature, timeStep, numSteps, applyThermostat]);

  useEffect(() => {
    simLoopRef.current = simLoop;
  }, [simLoop]);

  // --- Run/stop simulation ---
  const handlePlay = useCallback(() => {
    if (isComplete) {
      initSimulation();
    }
    if (stepRef.current === 0) {
      initSimulation();
    }
    if (isPaused) {
      pauseOffsetRef.current += Date.now() - pauseStartRef.current;
    }
    setIsRunning(true);
    setIsPaused(false);
    setIsComplete(false);
    startTimeRef.current = startTimeRef.current || Date.now();
  }, [isComplete, isPaused, initSimulation]);

  const handlePause = useCallback(() => {
    if (!isRunning || isPaused) return;
    setIsPaused(true);
    pauseStartRef.current = Date.now();
  }, [isRunning, isPaused]);

  const handleReset = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setIsRunning(false);
    setIsPaused(false);
    setIsComplete(false);
    stepRef.current = 0;
    startTimeRef.current = 0;
    pauseOffsetRef.current = 0;
    initSimulation();
  }, [initSimulation]);

  // --- Compute results on complete ---
  useEffect(() => {
    if (!isComplete) return;
    const atoms = atomsRef.current;
    const count = rmsfCountRef.current;
    if (count === 0) return;

    // RMSF per residue (average over backbone atoms per residue)
    const residueRmsf: { residue: number; value: number }[] = [];
    const residueBfactor: { residue: number; value: number }[] = [];
    for (let r = 0; r < NUM_RESIDUES; r++) {
      let sum = 0;
      let n = 0;
      for (const a of atoms) {
        if (a.residueIndex === r) {
          sum += rmsfAccumRef.current[atoms.indexOf(a)] / count;
          n++;
        }
      }
      const rmsfVal = n > 0 ? Math.sqrt(sum / n) : 0;
      residueRmsf.push({ residue: r + 1, value: parseFloat(rmsfVal.toFixed(3)) });
      residueBfactor.push({ residue: r + 1, value: parseFloat((8 * Math.PI * Math.PI / 3 * rmsfVal * rmsfVal).toFixed(3)) });
    }
    setRmsfData(residueRmsf);
    setBFactorData(residueBfactor);

    // Contact map summary
    let contacts = 0;
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const dx = atoms[j].x - atoms[i].x;
        const dy = atoms[j].y - atoms[i].y;
        const dz = atoms[j].z - atoms[i].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 4.5) contacts++;
      }
    }
    setContactCount(contacts);
    setAvgContacts(parseFloat((contacts / atoms.length).toFixed(1)));

    // Energy stats
    const energies = energyHistory.map(e => e.total);
    if (energies.length > 0) {
      const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
      const variance = energies.reduce((a, b) => a + (b - mean) ** 2, 0) / energies.length;
      setAvgEnergy(parseFloat(mean.toFixed(1)));
      setEnergyStdDev(parseFloat(Math.sqrt(variance).toFixed(1)));
    }

    // Distance stats
    let minD = Infinity, maxD = 0;
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const dx = atoms[j].x - atoms[i].x;
        const dy = atoms[j].y - atoms[i].y;
        const dz = atoms[j].z - atoms[i].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
    }
    setMinDist(parseFloat(minD.toFixed(2)));
    setMaxDist(parseFloat(maxD.toFixed(2)));
  }, [isComplete, energyHistory]);

  // --- Animation frame for simulation loop ---
  useEffect(() => {
    if (isRunning && !isPaused) {
      animFrameRef.current = requestAnimationFrame(simLoop);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isRunning, isPaused, simLoop]);

  // --- Canvas rendering ---
  const drawMolecule = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const fov = Math.min(w, h) * 0.8;
    const distance = 30;

    // Clear
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(63,63,70,0.3)';
    ctx.lineWidth = 0.5;
    const gridSize = 40;
    for (let gx = 0; gx < w; gx += gridSize) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    const atoms = atomsRef.current;
    const bonds = bondsRef.current;
    if (atoms.length === 0) {
      // Draw placeholder text
      ctx.fillStyle = 'rgba(161,161,170,0.5)';
      ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Press Play to start the simulation', cx, cy);
      return;
    }

    // RMSF range for coloring
    const rmsfArr = rmsfPerAtom;
    let rmsfMin = Infinity, rmsfMax = -Infinity;
    for (const v of rmsfArr) {
      if (v < rmsfMin) rmsfMin = v;
      if (v > rmsfMax) rmsfMax = v;
    }
    if (rmsfMin === rmsfMax) { rmsfMin = 0; rmsfMax = 1; }

    // Transform atoms
    const projected = atoms.map((a, idx) => {
      let v: Vec3 = { x: a.x, y: a.y, z: a.z };
      v = rotateY(v, rotY);
      v = rotateX(v, rotX);
      const p = project(v, fov, distance, cx, cy);
      return { ...p, atom: a, idx, vz: v.z };
    });

    // Sort by z for painter's algorithm (far first)
    const sorted = [...projected].sort((a, b) => a.vz - b.vz);

    // Draw pocket spheres
    for (const pocket of pockets) {
      let pv: Vec3 = { x: pocket.x, y: pocket.y, z: pocket.z };
      pv = rotateY(pv, rotY);
      pv = rotateX(pv, rotX);
      const pp = project(pv, fov, distance, cx, cy);
      const r = Math.max(1, pocket.radius * pp.scale * 0.5);
      const alpha = 0.12;
      ctx.beginPath();
      ctx.arc(pp.sx, pp.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = pocket.pocketType === 'active-site'
        ? `rgba(239,68,68,${alpha})`
        : pocket.pocketType === 'cryptic'
          ? `rgba(234,179,8,${alpha})`
          : `rgba(34,197,94,${alpha})`;
      ctx.fill();
      ctx.strokeStyle = pocket.pocketType === 'active-site'
        ? 'rgba(239,68,68,0.4)'
        : pocket.pocketType === 'cryptic'
          ? 'rgba(234,179,8,0.4)'
          : 'rgba(34,197,94,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw bonds
    for (const b of bonds) {
      const pi = projected[b.i];
      const pj = projected[b.j];
      const avgZ = (pi.vz + pj.vz) / 2;
      const depthFade = Math.max(0.15, Math.min(1, (avgZ + distance) / (distance * 2)));
      ctx.beginPath();
      ctx.moveTo(pi.sx, pi.sy);
      ctx.lineTo(pj.sx, pj.sy);
      ctx.strokeStyle = `rgba(113,113,122,${0.5 * depthFade})`;
      ctx.lineWidth = Math.max(0.5, 1.5 * depthFade);
      ctx.stroke();
    }

    // Draw atoms (sorted)
    for (const p of sorted) {
      const a = p.atom;
      const depthFade = Math.max(0.2, Math.min(1, (p.vz + distance) / (distance * 2)));
      const baseRadius = a.isBackbone ? 4 : 3;
      const r = Math.max(1, baseRadius * p.scale * 0.15);

      let fillColor: string;
      if (a.isBackbone) {
        // Color by RMSF
        const rmsfVal = rmsfArr[p.idx] ?? 0;
        fillColor = bfactorToColor(rmsfVal, rmsfMin, rmsfMax);
      } else {
        fillColor = `rgba(161,161,170,${depthFade * 0.7})`;
      }

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Highlight backbone
      if (a.isBackbone) {
        ctx.strokeStyle = `rgba(255,255,255,${depthFade * 0.2})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Legend
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    const lx = 12;
    const ly = h - 50;

    // B-factor gradient bar
    const gradW = 100;
    const gradH = 10;
    const grad = ctx.createLinearGradient(lx, ly, lx + gradW, ly);
    grad.addColorStop(0, 'rgb(0,0,255)');
    grad.addColorStop(0.5, 'rgb(0,128,0)');
    grad.addColorStop(1, 'rgb(255,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(lx, ly, gradW, gradH);
    ctx.strokeStyle = 'rgba(113,113,122,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly, gradW, gradH);
    ctx.fillStyle = 'rgba(161,161,170,0.7)';
    ctx.fillText('Stable', lx, ly + gradH + 14);
    ctx.fillText('Flexible', lx + gradW - 42, ly + gradH + 14);
    ctx.fillText('B-factor / RMSF', lx, ly - 4);
  }, [rotX, rotY, pockets, rmsfPerAtom]);

  // --- Energy plot ---
  const drawEnergyPlot = useCallback(() => {
    const canvas = energyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 24, right: 12, bottom: 24, left: 44 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Axes
    ctx.strokeStyle = 'rgba(63,63,70,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    if (energyHistory.length < 2) {
      ctx.fillStyle = 'rgba(161,161,170,0.4)';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Energy data will appear here', w / 2, h / 2);
      return;
    }

    const data = energyHistory;
    const maxStep = data[data.length - 1].step;
    const minStep = data[0].step;
    const stepRange = maxStep - minStep || 1;

    let eMin = Infinity, eMax = -Infinity;
    for (const e of data) {
      if (e.kinetic < eMin) eMin = e.kinetic;
      if (e.potential < eMin) eMin = e.potential;
      if (e.total < eMin) eMin = e.total;
      if (e.kinetic > eMax) eMax = e.kinetic;
      if (e.potential > eMax) eMax = e.potential;
      if (e.total > eMax) eMax = e.total;
    }
    const ePad = (eMax - eMin) * 0.1 || 1;
    eMin -= ePad;
    eMax += ePad;
    const eRange = eMax - eMin;

    const toX = (step: number) => pad.left + ((step - minStep) / stepRange) * plotW;
    const toY = (val: number) => pad.top + (1 - (val - eMin) / eRange) * plotH;

    // Grid lines
    ctx.strokeStyle = 'rgba(63,63,70,0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      const val = eMax - (i / 4) * eRange;
      ctx.fillStyle = 'rgba(161,161,170,0.5)';
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(0), pad.left - 4, y + 3);
    }

    // Plot lines
    const drawLine = (key: 'kinetic' | 'potential' | 'total', color: string) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < data.length; i++) {
        const x = toX(data[i].step);
        const y = toY(data[i][key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine('potential', '#3b82f6');
    drawLine('kinetic', '#22c55e');
    drawLine('total', '#f59e0b');

    // Legend
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    const legX = w - pad.right - 120;
    const legY = pad.top + 6;
    const legItems = [
      { color: '#3b82f6', label: 'Potential' },
      { color: '#22c55e', label: 'Kinetic' },
      { color: '#f59e0b', label: 'Total' },
    ];
    legItems.forEach((item, i) => {
      const y = legY + i * 14;
      ctx.fillStyle = item.color;
      ctx.fillRect(legX, y, 12, 8);
      ctx.fillStyle = 'rgba(161,161,170,0.8)';
      ctx.fillText(item.label, legX + 16, y + 8);
    });

    // X-axis label
    ctx.fillStyle = 'rgba(161,161,170,0.5)';
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Step', w / 2, h - 4);
  }, [energyHistory]);

  // --- Render loop for canvas ---
  useEffect(() => {
    const render = () => {
      drawMolecule();
      drawEnergyPlot();
      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawMolecule, drawEnergyPlot]);

  // --- Mouse rotation handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setRotY(prev => prev + dx * 0.008);
    setRotX(prev => prev + dy * 0.008);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // --- Touch handlers ---
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - lastMouse.current.x;
    const dy = e.touches[0].clientY - lastMouse.current.y;
    setRotY(prev => prev + dx * 0.008);
    setRotX(prev => prev + dy * 0.008);
    lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // --- Backend check ---
  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_BACKEND_URL ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/health` : '', { signal: AbortSignal.timeout(2000) })
      .then(r => { if (r.ok) setBackendAvailable(true); })
      .catch(() => setBackendAvailable(false));
  }, []);

  // --- Format time ---
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  };

  // --- Temperature gauge color ---
  const tempColor = (t: number) => {
    if (t < 300) return '#3b82f6';
    if (t < 400) return '#f59e0b';
    return '#ef4444';
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Atom className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Molecular Dynamics Simulation</h2>
              <p className="text-sm text-zinc-400">Real-time protein dynamics with Lennard-Jones potential</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={backendAvailable ? 'default' : 'secondary'} className={cn(backendAvailable ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700')}>
              {backendAvailable ? 'Backend Connected' : 'Browser Fallback'}
            </Badge>
            {isRunning && !isPaused && (
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse">
                <Activity className="h-3 w-3 mr-1" /> Running
              </Badge>
            )}
            {isPaused && (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                Paused
              </Badge>
            )}
            {isComplete && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                Complete
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left: Controls + Status */}
          <div className="lg:col-span-1 space-y-4">
            {/* Controls Card */}
            <Card className="bg-zinc-950 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                  <Target className="h-4 w-4 text-zinc-400" /> Simulation Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Target selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Target Protein</Label>
                  <Select value={selectedTarget} onValueChange={(v) => { setSelectedTarget(v); handleReset(); }} disabled={isRunning}>
                    <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200 h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {PROTEIN_TARGETS.map(t => (
                        <SelectItem key={t.id} value={t.id} className="text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100">
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Temperature */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400 flex items-center gap-1">
                      <Thermometer className="h-3 w-3" /> Temperature
                    </Label>
                    <span className="text-xs font-mono text-zinc-300">{temperature}K</span>
                  </div>
                  <Slider
                    value={[temperature]}
                    onValueChange={([v]) => setTemperature(v)}
                    min={200}
                    max={500}
                    step={10}
                    disabled={isRunning}
                    className="py-1"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>200K</span><span>500K</span>
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Number of Steps</Label>
                    <span className="text-xs font-mono text-zinc-300">{numSteps}</span>
                  </div>
                  <Slider
                    value={[numSteps]}
                    onValueChange={([v]) => setNumSteps(v)}
                    min={100}
                    max={2000}
                    step={50}
                    disabled={isRunning}
                    className="py-1"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>100</span><span>2000</span>
                  </div>
                </div>

                {/* Time step */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-400">Time Step</Label>
                    <span className="text-xs font-mono text-zinc-300">{timeStep.toFixed(3)}</span>
                  </div>
                  <Slider
                    value={[timeStep * 1000]}
                    onValueChange={([v]) => setTimeStep(v / 1000)}
                    min={1}
                    max={5}
                    step={0.5}
                    disabled={isRunning}
                    className="py-1"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>0.001</span><span>0.005</span>
                  </div>
                </div>

                <Separator className="bg-zinc-800" />

                {/* Play / Pause / Reset */}
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'flex-1 bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100',
                          isRunning && !isPaused && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        )}
                        onClick={isRunning && !isPaused ? handlePause : handlePlay}
                      >
                        {isRunning && !isPaused ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                        {isRunning && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Start'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-zinc-800 text-zinc-200 border-zinc-700">
                      {isRunning && !isPaused ? 'Pause simulation' : 'Start simulation'}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
                        onClick={handleReset}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-zinc-800 text-zinc-200 border-zinc-700">Reset simulation</TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>

            {/* Status Card */}
            <Card className="bg-zinc-950 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-zinc-400" /> Simulation Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Progress</span>
                    <span className="text-zinc-300 font-mono">{stats.totalSteps > 0 ? Math.round((stats.currentStep / stats.totalSteps) * 100) : 0}%</span>
                  </div>
                  <Progress
                    value={stats.totalSteps > 0 ? (stats.currentStep / stats.totalSteps) * 100 : 0}
                    className="h-1.5 bg-zinc-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <StatItem icon={<Zap className="h-3 w-3" />} label="Step" value={`${stats.currentStep} / ${stats.totalSteps}`} />
                  <StatItem icon={<Clock className="h-3 w-3" />} label="Elapsed" value={formatTime(stats.elapsedTime)} />
                  <StatItem icon={<Thermometer className="h-3 w-3" />} label="Temp" value={`${stats.currentTemperature.toFixed(1)}K`} valueColor={tempColor(stats.currentTemperature)} />
                  <StatItem icon={<Activity className="h-3 w-3" />} label="Energy" value={stats.totalEnergy.toFixed(1)} />
                  <StatItem icon={<CircleDot className="h-3 w-3" />} label="R_g" value={`${stats.radiusOfGyration.toFixed(2)} Å`} />
                  <StatItem icon={<Atom className="h-3 w-3" />} label="Atoms" value={`${TOTAL_ATOMS}`} />
                </div>

                {/* Temperature gauge */}
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Temperature Gauge</Label>
                  <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, ((stats.currentTemperature - 200) / 300) * 100)}%`,
                        backgroundColor: tempColor(stats.currentTemperature),
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-zinc-600">
                    <span>200K</span><span>350K</span><span>500K</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Visualization + Energy */}
          <div className="lg:col-span-3 space-y-4">
            {/* 3D Molecule Canvas */}
            <Card className="bg-zinc-950 border-zinc-800">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                    <Atom className="h-4 w-4 text-zinc-400" />
                    {target ? `${target.name} — C-alpha Trace` : 'Protein Visualization'}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <span>Drag to rotate</span>
                    {pockets.length > 0 && (
                      <>
                        <span className="text-zinc-700">|</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500/40" /> Active</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-500/40" /> Cryptic</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500/40" /> Allosteric</span>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-2">
                <canvas
                  ref={canvasRef}
                  className="w-full rounded-md cursor-grab active:cursor-grabbing"
                  style={{ height: '420px' }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                />
              </CardContent>
            </Card>

            {/* Energy Plot */}
            <Card className="bg-zinc-950 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-zinc-400" /> Energy Over Time
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <canvas
                  ref={energyCanvasRef}
                  className="w-full rounded-md"
                  style={{ height: '180px' }}
                />
              </CardContent>
            </Card>

            {/* Results section (shown after completion) */}
            {isComplete && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* RMSF Bar Chart */}
                <Card className="bg-zinc-950 border-zinc-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-zinc-400" /> RMSF per Residue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {rmsfData.length > 0 ? (
                      <svg viewBox="0 0 400 160" className="w-full" role="img" aria-label="RMSF per residue bar chart">
                        {(() => {
                          const maxVal = Math.max(...rmsfData.map(d => d.value), 0.1);
                          const barW = 400 / rmsfData.length - 2;
                          return rmsfData.map((d, i) => {
                            const barH = (d.value / maxVal) * 130;
                            const x = i * (barW + 2) + 1;
                            const y = 150 - barH;
                            const t = d.value / maxVal;
                            const r = Math.round(t * 239);
                            const g = Math.round(Math.min(t, 1 - t) * 2 * 120);
                            const b = Math.round((1 - t) * 239);
                            return (
                              <g key={d.residue}>
                                <rect x={x} y={y} width={barW} height={barH} fill={`rgb(${r},${g},${b})`} rx={1} />
                                {rmsfData.length <= 20 && (
                                  <text x={x + barW / 2} y={158} textAnchor="middle" fill="#71717a" fontSize="6" fontFamily="monospace">
                                    {d.residue}
                                  </text>
                                )}
                              </g>
                            );
                          });
                        })()}
                        {/* Axes */}
                        <line x1="0" y1="150" x2="400" y2="150" stroke="#3f3f46" strokeWidth="0.5" />
                        <line x1="0" y1="0" x2="0" y2="150" stroke="#3f3f46" strokeWidth="0.5" />
                      </svg>
                    ) : (
                      <Skeleton className="h-40 w-full bg-zinc-900" />
                    )}
                  </CardContent>
                </Card>

                {/* B-factors Plot */}
                <Card className="bg-zinc-950 border-zinc-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-zinc-400" /> B-factors Plot
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {bFactorData.length > 0 ? (
                      <svg viewBox="0 0 400 160" className="w-full" role="img" aria-label="B-factors per residue plot">
                        {(() => {
                          const maxVal = Math.max(...bFactorData.map(d => d.value), 0.1);
                          const stepX = 400 / (bFactorData.length - 1 || 1);
                          const points = bFactorData.map((d, i) => `${i * stepX},${150 - (d.value / maxVal) * 130}`).join(' ');
                          return (
                            <>
                              {/* Fill area */}
                              <polygon
                                points={`0,150 ${points} ${(bFactorData.length - 1) * stepX},150`}
                                fill="url(#bfGrad)" opacity="0.3"
                              />
                              <defs>
                                <linearGradient id="bfGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#f59e0b" />
                                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                                </linearGradient>
                              </defs>
                              {/* Line */}
                              <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
                              {/* Dots */}
                              {bFactorData.map((d, i) => (
                                <circle
                                  key={d.residue}
                                  cx={i * stepX}
                                  cy={150 - (d.value / maxVal) * 130}
                                  r="2"
                                  fill="#f59e0b"
                                />
                              ))}
                              {/* Axes */}
                              <line x1="0" y1="150" x2="400" y2="150" stroke="#3f3f46" strokeWidth="0.5" />
                              <line x1="0" y1="0" x2="0" y2="150" stroke="#3f3f46" strokeWidth="0.5" />
                            </>
                          );
                        })()}
                      </svg>
                    ) : (
                      <Skeleton className="h-40 w-full bg-zinc-900" />
                    )}
                  </CardContent>
                </Card>

                {/* Contact Map Summary */}
                <Card className="bg-zinc-950 border-zinc-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                      <Grid3X3 className="h-4 w-4 text-zinc-400" /> Contact Map Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Mini contact map heatmap */}
                    <svg viewBox="0 0 160 160" className="w-full max-w-[200px] mx-auto" role="img" aria-label="Contact map heatmap">
                      <rect width="160" height="160" fill="#09090b" rx="4" />
                      {/* Render memoized contact map based on structure */}
                      {contactMapCells}
                      <rect width="160" height="160" fill="none" stroke="#3f3f46" strokeWidth="1" rx="4" />
                    </svg>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-md bg-zinc-900 p-2">
                        <div className="text-lg font-semibold text-zinc-100">{contactCount}</div>
                        <div className="text-[10px] text-zinc-500">Total Contacts (&lt;4.5Å)</div>
                      </div>
                      <div className="rounded-md bg-zinc-900 p-2">
                        <div className="text-lg font-semibold text-zinc-100">{avgContacts}</div>
                        <div className="text-[10px] text-zinc-500">Avg Contacts / Atom</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Final Structure Statistics */}
                <Card className="bg-zinc-950 border-zinc-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-zinc-400" /> Final Structure Statistics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <StatBlock label="Avg Energy" value={`${avgEnergy}`} unit="kJ/mol" />
                        <StatBlock label="Energy Std Dev" value={`${energyStdDev}`} unit="kJ/mol" />
                        <StatBlock label="Min Distance" value={`${minDist}`} unit="Å" />
                        <StatBlock label="Max Distance" value={`${maxDist}`} unit="Å" />
                        <StatBlock label="Final R_g" value={`${stats.radiusOfGyration.toFixed(2)}`} unit="Å" />
                        <StatBlock label="Total Steps" value={`${stats.totalSteps}`} unit="steps" />
                        <StatBlock label="Temperature" value={`${temperature}K`} unit="" />
                        <StatBlock label="Time Step" value={`${timeStep}`} unit="ps" />
                      </div>
                      <Separator className="bg-zinc-800" />
                      <div className="rounded-md bg-zinc-900 p-3 text-xs text-zinc-400 space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Target</span>
                          <span className="text-zinc-200 font-medium">{target?.name ?? '—'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Residues</span>
                          <span className="text-zinc-200 font-medium">{NUM_RESIDUES}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Total Atoms</span>
                          <span className="text-zinc-200 font-medium">{TOTAL_ATOMS}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Integration</span>
                          <span className="text-zinc-200 font-medium">Velocity Verlet</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Thermostat</span>
                          <span className="text-zinc-200 font-medium">Berendsen (τ=0.1)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Wall Time</span>
                          <span className="text-zinc-200 font-medium">{formatTime(stats.elapsedTime)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ==========================================================================
// Sub-components
// ==========================================================================

function StatItem({ icon, label, value, valueColor }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-md bg-zinc-900 p-2 space-y-0.5">
      <div className="flex items-center gap-1 text-zinc-500">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-xs font-mono font-medium truncate" style={valueColor ? { color: valueColor } : { color: '#e4e4e7' }}>
        {value}
      </div>
    </div>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-md bg-zinc-900 p-2 space-y-0.5">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="text-sm font-mono font-medium text-zinc-100">
        {value}{unit ? <span className="text-[10px] text-zinc-500 ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}
