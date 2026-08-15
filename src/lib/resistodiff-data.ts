// ============================================================================
// ResistoDiff-3D: Core Types, Constants, and Demo Data
// ============================================================================

// --- Types ---
export interface ProteinTarget {
  id: string;
  name: string;
  uniprotId: string;
  pdbId: string;
  geneName: string;
  organism: string;
  targetClass: string;
  sequenceLength: number;
  description: string;
  keyResidues: string[];
  resistanceMechanism: string;
}

export interface MutationResult {
  mutation: string;
  position: number;
  wildType: string;
  mutantType: string;
  ddgFold: number;
  ddgCatalysis: number;
  ddgBinding: number;
  fitnessScore: number;
  esm2Score: number;
  coevolScore: number;
  isCompensatory: boolean;
}

export interface PocketResult {
  pocketId: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  volume: number;
  surfaceArea: number;
  depth: number;
  druggability: number;
  residues: string[];
  pocketType: 'cryptic' | 'allosteric' | 'active-site';
  conservation: number;
}

export interface MCTSNode {
  id: string;
  mutation: string;
  fitnessScore: number;
  visits: number;
  isResistance: boolean;
  children: MCTSNode[];
  depth: number;
}

export interface DiffusionCandidate {
  id: string;
  smiles: string;
  qedScore: number;
  saScore: number;
  lipinskiViolations: number;
  mw: number;
  logP: number;
  hbd: number;
  hba: number;
  tpsa: number;
 bindingAffinity: number;
  pocketFit: number;
}

export interface PipelineStatus {
  module: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: number;
  lastRun: string;
  runtime: string;
}

// --- Amino Acid Properties ---
export const AMINO_ACIDS: Record<string, { name: string; codons: string[]; hydrophobicity: number; volume: number }> = {
  A: { name: 'Alanine', codons: ['GCT', 'GCC', 'GCA', 'GCG'], hydrophobicity: 1.8, volume: 88.6 },
  R: { name: 'Arginine', codons: ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'], hydrophobicity: -4.5, volume: 173.4 },
  N: { name: 'Asparagine', codons: ['AAT', 'AAC'], hydrophobicity: -3.5, volume: 114.1 },
  D: { name: 'Aspartic Acid', codons: ['GAT', 'GAC'], hydrophobicity: -3.5, volume: 111.1 },
  C: { name: 'Cysteine', codons: ['TGT', 'TGC'], hydrophobicity: 2.5, volume: 108.5 },
  Q: { name: 'Glutamine', codons: ['CAA', 'CAG'], hydrophobicity: -3.5, volume: 143.8 },
  E: { name: 'Glutamic Acid', codons: ['GAA', 'GAG'], hydrophobicity: -3.5, volume: 138.4 },
  G: { name: 'Glycine', codons: ['GGT', 'GGC', 'GGA', 'GGG'], hydrophobicity: -0.4, volume: 60.1 },
  H: { name: 'Histidine', codons: ['CAT', 'CAC'], hydrophobicity: -3.2, volume: 153.2 },
  I: { name: 'Isoleucine', codons: ['ATT', 'ATC', 'ATA'], hydrophobicity: 4.5, volume: 166.7 },
  L: { name: 'Leucine', codons: ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG'], hydrophobicity: 3.8, volume: 166.7 },
  K: { name: 'Lysine', codons: ['AAA', 'AAG'], hydrophobicity: -3.9, volume: 168.6 },
  M: { name: 'Methionine', codons: ['ATG'], hydrophobicity: 1.9, volume: 162.9 },
  F: { name: 'Phenylalanine', codons: ['TTT', 'TTC'], hydrophobicity: 2.8, volume: 189.9 },
  P: { name: 'Proline', codons: ['CCT', 'CCC', 'CCA', 'CCG'], hydrophobicity: -1.6, volume: 112.7 },
  S: { name: 'Serine', codons: ['TCT', 'TCC', 'TCA', 'TCG', 'AGT', 'AGC'], hydrophobicity: -0.8, volume: 89.0 },
  T: { name: 'Threonine', codons: ['ACT', 'ACC', 'ACA', 'ACG'], hydrophobicity: -0.7, volume: 116.1 },
  W: { name: 'Tryptophan', codons: ['TGG'], hydrophobicity: -0.9, volume: 227.8 },
  Y: { name: 'Tyrosine', codons: ['TAT', 'TAC'], hydrophobicity: -1.3, volume: 193.6 },
  V: { name: 'Valine', codons: ['GTT', 'GTC', 'GTA', 'GTG'], hydrophobicity: 4.2, volume: 140.0 },
};

// --- Protein Targets ---
export const PROTEIN_TARGETS: ProteinTarget[] = [
  {
    id: 'tem1',
    name: 'TEM-1 Beta-Lactamase',
    uniprotId: 'P62593',
    pdbId: '1ZG4',
    geneName: 'blaTEM-1',
    organism: 'Escherichia coli',
    targetClass: 'Class A Beta-Lactamase',
    sequenceLength: 286,
    description: 'The most widespread beta-lactamase in Gram-negative bacteria. Hydrolyzes penicillins and early cephalosporins. Active-site Ser70 attacks the beta-lactam ring.',
    keyResidues: ['Ser70', 'Lys73', 'Ser130', 'Glu166', 'Gly238', 'Glu104'],
    resistanceMechanism: 'Active-site expansion via mutations at positions 104, 164, 238, and 240 that widen the active-site cavity to accommodate bulky 3rd-generation cephalosporins and carbapenems.',
  },
  {
    id: 'kpc2',
    name: 'KPC-2 Beta-Lactamase',
    uniprotId: 'A6T0E7',
    pdbId: '5UL8',
    geneName: 'blaKPC-2',
    organism: 'Klebsiella pneumoniae',
    targetClass: 'Class A Beta-Lactamase',
    sequenceLength: 293,
    description: 'Klebsiella pneumoniae carbapenemase-2. A critical clinical threat that hydrolyzes virtually all beta-lactams including carbapenems. Classified as a CPE (carbapenemase-producing Enterobacterales).',
    keyResidues: ['Ser70', 'Glu166', 'Asn170', 'Gly238', 'Cys69'],
    resistanceMechanism: 'Hybrid active-site architecture with disulfide bridge (Cys69-Cys238) providing structural rigidity. Highly efficient carbapenem hydrolysis via optimized oxyanion hole geometry.',
  },
  {
    id: 'ndm1',
    name: 'NDM-1 Metallo-Beta-Lactamase',
    uniprotId: 'C6X5M3',
    pdbId: '4EYB',
    geneName: 'blaNDM-1',
    organism: 'Klebsiella pneumoniae',
    targetClass: 'Metallo-Beta-Lactamase (Class B)',
    sequenceLength: 270,
    description: 'New Delhi metallo-beta-lactamase-1. Requires zinc ions for catalysis. Resistant to all clinically available beta-lactamase inhibitors. One of the most dangerous AMR threats globally.',
    keyResidues: ['His120', 'His122', 'His189', 'Asp124', 'Cys208', 'His250'],
    resistanceMechanism: 'Dual zinc active site (Zn1: 120/122/189, Zn2: 124/186/250) activates a water molecule for nucleophilic attack on the beta-lactam bond. No clinically useful inhibitors exist.',
  },
  {
    id: 'gyra',
    name: 'DNA Gyrase A (GyrA)',
    uniprotId: 'P0AES6',
    pdbId: '1KZN',
    geneName: 'gyrA',
    organism: 'Escherichia coli',
    targetClass: 'DNA Gyrase (Type IIA Topoisomerase)',
    sequenceLength: 875,
    description: 'Essential bacterial enzyme that introduces negative supercoils into DNA using ATP hydrolysis. Primary target of fluoroquinolone antibiotics (ciprofloxacin, levofloxacin).',
    keyResidues: ['Ser83', 'Asp87', 'Ala91', 'Gly81', 'Arg121'],
    resistanceMechanism: 'QRDR mutations (Ser83Leu/Trp, Asp87Asn/Tyr/His) disrupt water-magnesium-fluoroquinolone bridge, reducing drug binding 10-1000 fold while maintaining DNA cleavage-religation activity.',
  },
];

// --- Known Resistance Mutations ---
export const KNOWN_MUTATIONS: Record<string, MutationResult[]> = {
  tem1: [
    { mutation: 'E104K', position: 104, wildType: 'E', mutantType: 'K', ddgFold: 0.8, ddgCatalysis: -0.2, ddgBinding: 3.2, fitnessScore: 2.1, esm2Score: 1.8, coevolScore: 0.6, isCompensatory: false },
    { mutation: 'M182T', position: 182, wildType: 'M', mutantType: 'T', ddgFold: -1.2, ddgCatalysis: 0.1, ddgBinding: 0.3, fitnessScore: -0.4, esm2Score: 2.1, coevolScore: 0.8, isCompensatory: true },
    { mutation: 'G238S', position: 238, wildType: 'G', mutantType: 'S', ddgFold: 1.5, ddgCatalysis: -0.5, ddgBinding: 4.8, fitnessScore: 3.2, esm2Score: 3.5, coevolScore: 0.9, isCompensatory: false },
    { mutation: 'E104K:G238S', position: 0, wildType: 'E', mutantType: 'S', ddgFold: 2.1, ddgCatalysis: -0.7, ddgBinding: 7.5, fitnessScore: 5.8, esm2Score: 4.2, coevolScore: 0.95, isCompensatory: false },
    { mutation: 'E104K:M182T:G238S', position: 0, wildType: 'E', mutantType: 'S', ddgFold: 1.0, ddgCatalysis: -0.6, ddgBinding: 7.8, fitnessScore: 5.2, esm2Score: 4.8, coevolScore: 0.97, isCompensatory: true },
    { mutation: 'R164S', position: 164, wildType: 'R', mutantType: 'S', ddgFold: 2.3, ddgCatalysis: -1.1, ddgBinding: 5.2, fitnessScore: 3.8, esm2Score: 2.9, coevolScore: 0.7, isCompensatory: false },
    { mutation: 'A184V', position: 184, wildType: 'A', mutantType: 'V', ddgFold: 0.3, ddgCatalysis: 0.0, ddgBinding: 0.8, fitnessScore: 0.6, esm2Score: 1.2, coevolScore: 0.4, isCompensatory: true },
    { mutation: 'L201P', position: 201, wildType: 'L', mutantType: 'P', ddgFold: 3.5, ddgCatalysis: -2.0, ddgBinding: 1.5, fitnessScore: -1.5, esm2Score: -1.0, coevolScore: 0.2, isCompensatory: false },
  ],
  kpc2: [
    { mutation: 'G238S', position: 238, wildType: 'G', mutantType: 'S', ddgFold: 0.5, ddgCatalysis: -0.1, ddgBinding: 2.0, fitnessScore: 1.5, esm2Score: 1.8, coevolScore: 0.6, isCompensatory: false },
    { mutation: 'D179Y', position: 179, wildType: 'D', mutantType: 'Y', ddgFold: 1.8, ddgCatalysis: -0.3, ddgBinding: 3.5, fitnessScore: 2.8, esm2Score: 2.4, coevolScore: 0.7, isCompensatory: false },
    { mutation: 'V240G', position: 240, wildType: 'V', mutantType: 'G', ddgFold: 1.2, ddgCatalysis: 0.2, ddgBinding: 2.8, fitnessScore: 2.5, esm2Score: 2.0, coevolScore: 0.5, isCompensatory: false },
  ],
  ndm1: [
    { mutation: 'M154L', position: 154, wildType: 'M', mutantType: 'L', ddgFold: 0.3, ddgCatalysis: 0.1, ddgBinding: 1.2, fitnessScore: 0.8, esm2Score: 1.5, coevolScore: 0.5, isCompensatory: false },
    { mutation: 'N233A', position: 233, wildType: 'N', mutantType: 'A', ddgFold: 1.1, ddgCatalysis: -0.2, ddgBinding: 2.5, fitnessScore: 2.0, esm2Score: 2.2, coevolScore: 0.6, isCompensatory: false },
  ],
  gyra: [
    { mutation: 'S83L', position: 83, wildType: 'S', mutantType: 'L', ddgFold: 0.4, ddgCatalysis: 0.0, ddgBinding: 5.5, fitnessScore: 3.2, esm2Score: 3.8, coevolScore: 0.85, isCompensatory: false },
    { mutation: 'D87N', position: 87, wildType: 'D', mutantType: 'N', ddgFold: 0.6, ddgCatalysis: 0.1, ddgBinding: 4.8, fitnessScore: 2.8, esm2Score: 3.2, coevolScore: 0.78, isCompensatory: false },
    { mutation: 'S83L:D87N', position: 0, wildType: 'S', mutantType: 'N', ddgFold: 0.9, ddgCatalysis: 0.1, ddgBinding: 9.2, fitnessScore: 5.8, esm2Score: 5.5, coevolScore: 0.92, isCompensatory: false },
  ],
};

// --- Demo Pocket Data ---
export const DEMO_POCKETS: Record<string, PocketResult[]> = {
  tem1: [
    { pocketId: 1, centerX: 15.2, centerY: 28.4, centerZ: 5.8, volume: 312.5, surfaceArea: 245.8, depth: 8.3, druggability: 0.82, residues: ['Ser70', 'Lys73', 'Ser130', 'Glu166', 'Asn170', 'Gly236', 'Ala237'], pocketType: 'active-site', conservation: 0.95 },
    { pocketId: 2, centerX: -8.5, centerY: 12.3, centerZ: -15.2, volume: 185.3, surfaceArea: 142.6, depth: 10.5, druggability: 0.71, residues: ['Leu76', 'Asp179', 'Leu220', 'Ala224', 'Thr223'], pocketType: 'cryptic', conservation: 0.72 },
    { pocketId: 3, centerX: 22.1, centerY: -5.7, centerZ: 18.9, volume: 245.7, surfaceArea: 198.3, depth: 6.8, druggability: 0.68, residues: ['Met182', 'Thr184', 'Gly186', 'Val188', 'Glu190'], pocketType: 'allosteric', conservation: 0.58 },
    { pocketId: 4, centerX: -15.3, centerY: 35.8, centerZ: 22.1, volume: 156.2, surfaceArea: 128.5, depth: 7.2, druggability: 0.64, residues: ['Arg243', 'Asn245', 'Glu246', 'Thr247', 'Leu250'], pocketType: 'allosteric', conservation: 0.45 },
  ],
  ndm1: [
    { pocketId: 1, centerX: 18.5, centerY: 22.1, centerZ: 8.3, volume: 285.4, surfaceArea: 215.6, depth: 7.9, druggability: 0.78, residues: ['His120', 'His122', 'Asp124', 'His189', 'Cys208', 'His250', 'Lys224'], pocketType: 'active-site', conservation: 0.98 },
    { pocketId: 2, centerX: -12.4, centerY: 8.5, centerZ: -20.3, volume: 198.7, surfaceArea: 162.3, depth: 11.2, druggability: 0.73, residues: ['Asp130', 'Gly132', 'Lys134', 'Tyr151', 'Trp93'], pocketType: 'cryptic', conservation: 0.65 },
    { pocketId: 3, centerX: 25.8, centerY: -3.2, centerZ: 15.7, volume: 210.5, surfaceArea: 178.2, depth: 9.1, druggability: 0.69, residues: ['Loop3: Asn220', 'Gly222', 'Asn233', 'Leu235'], pocketType: 'allosteric', conservation: 0.52 },
  ],
};

// --- Demo Diffusion Candidates ---
export const DEMO_DIFFUSION_CANDIDATES: DiffusionCandidate[] = [
  { id: 'mol-001', smiles: 'CC(C)Cc1ccc(cc1)C(=O)N[C@@H](Cc2ccccc2)C(=O)N3CCC[C@H]3C(=O)N', qedScore: 0.78, saScore: 3.2, lipinskiViolations: 0, mw: 438.5, logP: 2.1, hbd: 3, hba: 5, tpsa: 89.3, bindingAffinity: -8.2, pocketFit: 0.85 },
  { id: 'mol-002', smiles: 'COc1ccc(cc1)N=C(C(=O)Nc2ccc(O)c(C)c2)C3=CN=CN3', qedScore: 0.65, saScore: 2.8, lipinskiViolations: 0, mw: 363.4, logP: 2.4, hbd: 2, hba: 6, tpsa: 78.5, bindingAffinity: -7.1, pocketFit: 0.72 },
  { id: 'mol-003', smiles: 'CC(=O)Nc1ccc(cc1)S(=O)(=O)Nc2ccc(NC(=O)C3CC3)cc2', qedScore: 0.72, saScore: 3.5, lipinskiViolations: 0, mw: 375.4, logP: 1.8, hbd: 3, hba: 6, tpsa: 102.1, bindingAffinity: -7.8, pocketFit: 0.79 },
  { id: 'mol-004', smiles: 'Fc1ccc(cc1)C(=O)N[C@@H]2CCN(C(=O)Cc3ccccc3)CC2', qedScore: 0.81, saScore: 2.5, lipinskiViolations: 0, mw: 354.4, logP: 2.9, hbd: 2, hba: 4, tpsa: 52.3, bindingAffinity: -8.5, pocketFit: 0.88 },
  { id: 'mol-005', smiles: 'COc1ccc2nc(nc(N)c2c1)N3CCN(CC3)C(=O)C4=CC=CC=C4', qedScore: 0.69, saScore: 3.0, lipinskiViolations: 0, mw: 387.4, logP: 2.6, hbd: 2, hba: 6, tpsa: 65.8, bindingAffinity: -7.4, pocketFit: 0.76 },
  { id: 'mol-006', smiles: 'Clc1ccc(cc1)C(=O)NC(C)(C)C(=O)Nc2ccc(Cl)cc2', qedScore: 0.58, saScore: 2.2, lipinskiViolations: 0, mw: 339.2, logP: 3.2, hbd: 2, hba: 4, tpsa: 58.6, bindingAffinity: -6.8, pocketFit: 0.65 },
];

// --- Demo MCTS Tree ---
export const DEMO_MCTS_TREE: MCTSNode = {
  id: 'root',
  mutation: 'WT (TEM-1)',
  fitnessScore: 0,
  visits: 1000,
  isResistance: false,
  depth: 0,
  children: [
    {
      id: 'n1', mutation: 'E104K', fitnessScore: 2.1, visits: 450, isResistance: true, depth: 1,
      children: [
        { id: 'n1-1', mutation: 'E104K:G238S', fitnessScore: 5.8, visits: 280, isResistance: true, depth: 2, children: [
          { id: 'n1-1-1', mutation: 'E104K:M182T:G238S', fitnessScore: 5.2, visits: 150, isResistance: true, depth: 3, children: [] },
          { id: 'n1-1-2', mutation: 'E104K:R164S:G238S', fitnessScore: 6.1, visits: 130, isResistance: true, depth: 3, children: [] },
        ]},
        { id: 'n1-2', mutation: 'E104K:R164S', fitnessScore: 4.2, visits: 170, isResistance: true, depth: 2, children: [] },
      ],
    },
    {
      id: 'n2', mutation: 'G238S', fitnessScore: 3.2, visits: 380, isResistance: true, depth: 1,
      children: [
        { id: 'n2-1', mutation: 'G238S:E104K', fitnessScore: 5.8, visits: 200, isResistance: true, depth: 2, children: [] },
        { id: 'n2-2', mutation: 'G238S:A184V', fitnessScore: 3.5, visits: 180, isResistance: true, depth: 2, children: [] },
      ],
    },
    {
      id: 'n3', mutation: 'R164S', fitnessScore: 3.8, visits: 320, isResistance: true, depth: 1,
      children: [
        { id: 'n3-1', mutation: 'R164S:E104K', fitnessScore: 4.2, visits: 180, isResistance: true, depth: 2, children: [] },
        { id: 'n3-2', mutation: 'R164S:G238S', fitnessScore: 5.5, visits: 140, isResistance: true, depth: 2, children: [] },
      ],
    },
    {
      id: 'n4', mutation: 'M182T', fitnessScore: -0.4, visits: 280, isResistance: false, depth: 1,
      children: [
        { id: 'n4-1', mutation: 'M182T:E104K', fitnessScore: 1.8, visits: 150, isResistance: false, depth: 2, children: [] },
      ],
    },
    {
      id: 'n5', mutation: 'L201P', fitnessScore: -1.5, visits: 120, isResistance: false, depth: 1, children: [] },
    ],
};

// --- Fitness Landscape Data (for heatmap) ---
export function generateFitnessLandscape(proteinId: string): { position: number; wt: string; scores: { aa: string; score: number }[] }[] {
  const target = PROTEIN_TARGETS.find(p => p.id === proteinId);
  if (!target) return [];
  const aaKeys = Object.keys(AMINO_ACIDS);
  // Generate landscape for key positions
  const positions = [70, 73, 104, 130, 164, 166, 182, 184, 238, 240];
  return positions.filter(p => p <= target.sequenceLength).map(pos => {
    const wt = aaKeys[Math.floor(Math.random() * 6)]; // random wild type
    const scores = aaKeys.map(aa => ({
      aa,
      score: aa === wt ? 0 : parseFloat((Math.random() * 8 - 2).toFixed(1)),
    }));
    return { position: pos, wt, scores };
  });
}

// --- Seeded random for reproducibility ---
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// --- Simulate mutation analysis (laptop-efficient) ---
export function simulateMutationAnalysis(
  proteinId: string,
  mutations: string[]
): MutationResult[] {
  const rng = seededRandom(42 + proteinId.length);
  return mutations.map(mut => {
    const match = mut.match(/^([A-Z])(\d+)([A-Z])$/);
    if (!match) return null;
    const [, wt, pos, mutType] = match;
    const position = parseInt(pos);
    const known = KNOWN_MUTATIONS[proteinId]?.find(m => m.mutation === mut);
    if (known) return known;
    // Simulate unknown mutations
    const volumeChange = (AMINO_ACIDS[mutType]?.volume ?? 120) - (AMINO_ACIDS[wt]?.volume ?? 120);
    const ddgFold = parseFloat((volumeChange * 0.01 + (rng() - 0.5) * 2).toFixed(1));
    const ddgCatalysis = parseFloat(((rng() - 0.5) * 3).toFixed(1));
    const ddgBinding = parseFloat((Math.abs(volumeChange) * 0.03 + rng() * 4).toFixed(1));
    const esm2Score = parseFloat(((rng() - 0.3) * 5).toFixed(1));
    const coevolScore = parseFloat((rng() * 0.8 + 0.1).toFixed(2));
    const fitnessScore = parseFloat((ddgFold * 0.3 + ddgCatalysis * -0.2 + ddgBinding * 0.4 + esm2Score * 0.2).toFixed(1));
    return {
      mutation: mut, position, wildType: wt, mutantType: mutType,
      ddgFold, ddgCatalysis, ddgBinding, fitnessScore, esm2Score, coevolScore,
      isCompensatory: fitnessScore < 1 && ddgFold < 0,
    };
  }).filter((m): m is MutationResult => m !== null);
}

// --- Simulate diffusion generation ---
export function simulateDiffusionGeneration(
  iterations: number,
  pocketId: number
): DiffusionCandidate[] {
  const rng = seededRandom(iterations * 100 + pocketId);
  return Array.from({ length: 6 }, (_, i) => ({
    id: `gen-${Date.now()}-${i}`,
    smiles: generateRandomSMILES(rng),
    qedScore: parseFloat((0.5 + rng() * 0.4).toFixed(2)),
    saScore: parseFloat((2.0 + rng() * 3.0).toFixed(1)),
    lipinskiViolations: rng() > 0.85 ? 1 : 0,
    mw: parseFloat((250 + rng() * 250).toFixed(1)),
    logP: parseFloat((1.0 + rng() * 4.0).toFixed(1)),
    hbd: Math.floor(rng() * 4),
    hba: Math.floor(3 + rng() * 5),
    tpsa: parseFloat((40 + rng() * 100).toFixed(1)),
    bindingAffinity: parseFloat((-5 - rng() * 5).toFixed(1)),
    pocketFit: parseFloat((0.5 + rng() * 0.45).toFixed(2)),
  }));
}

function generateRandomSMILES(rng: () => number): string {
  const fragments = ['c1ccccc1', 'CC(C)', 'C(=O)', 'NC', 'CO', 'Cl', 'F', 'CN1CCN', 'c1cc(N)cc1', 'c1ccc(O)cc1', 'C3CC3', 'S(=O)(=O)'];
  const len = 4 + Math.floor(rng() * 5);
  return Array.from({ length: len }, () => fragments[Math.floor(rng() * fragments.length)]).join('');
}

// --- Pipeline status defaults ---
export const DEFAULT_PIPELINE_STATUS: PipelineStatus[] = [
  { module: 'SEFE', status: 'idle', progress: 0, lastRun: '-', runtime: '-' },
  { module: 'DAPM', status: 'idle', progress: 0, lastRun: '-', runtime: '-' },
  { module: 'A-SE3Diff', status: 'idle', progress: 0, lastRun: '-', runtime: '-' },
];

// --- Epistatic Interaction Pairs ---
export const EPISTATIC_PAIRS = [
  { mut1: 'E104K', mut2: 'G238S', individual: 5.3, combined: 5.8, interaction: 0.5, type: 'synergistic' as const },
  { mut1: 'E104K', mut2: 'M182T', individual: 1.7, combined: 1.8, interaction: 0.1, type: 'additive' as const },
  { mut1: 'M182T', mut2: 'G238S', individual: 2.8, combined: 5.2, interaction: 2.4, type: 'synergistic' as const },
  { mut1: 'R164S', mut2: 'E104K', individual: 6.0, combined: 4.2, interaction: -1.8, type: 'antagonistic' as const },
  { mut1: 'A184V', mut2: 'G238S', individual: 3.8, combined: 3.5, interaction: -0.3, type: 'neutral' as const },
  { mut1: 'E104K', mut2: 'R164S', individual: 5.9, combined: 4.2, interaction: -1.7, type: 'antagonistic' as const },
];
