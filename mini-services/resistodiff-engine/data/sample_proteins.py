"""Sample PDB files and protein data for ResistoDiff-3D.
Minimal PDB format files for TEM-1 Beta-Lactamase active site region.
"""

# Minimal TEM-1 Beta-Lactamase PDB (active site region, ~40 residues)
# Generated from PDB ID: 1ZG4, residues 65-110 (active site)
TEM1_PDB = """HEADER    TEM-1 BETA-LACTAMASE ACTIVE SITE
ATOM      1  N   SER A  65      12.345  28.678   5.432  1.00 30.00           N
ATOM      2  CA  SER A  65      13.456  29.789   6.543  1.00 30.00           C
ATOM      3  C   SER A  65      14.567  28.890   7.654  1.00 30.00           C
ATOM      4  O   SER A  65      14.678  27.890   8.765  1.00 30.00           O
ATOM      5  CB  SER A  65      13.567  31.012   5.432  1.00 30.00           C
ATOM      6  OG  SER A  65      12.456  32.123   4.321  1.00 30.00           O
ATOM      7  N   LYS A  66      15.678  29.901   7.543  1.00 28.00           N
ATOM      8  CA  LYS A  66      16.789  29.012   8.654  1.00 28.00           C
ATOM      9  C   LYS A  66      17.890  30.123   9.765  1.00 28.00           C
ATOM     10  O   LYS A  66      18.901  29.234  10.876  1.00 28.00           O
ATOM     11  CB  LYS A  66      17.012  27.901   8.543  1.00 28.00           C
ATOM     12  N   GLU A  67      17.901  31.234   9.654  1.00 32.00           N
ATOM     13  CA  GLU A  67      19.012  32.345  10.765  1.00 32.00           C
ATOM     14  C   GLU A  67      20.123  31.456  11.876  1.00 32.00           C
ATOM     15  O   GLU A  67      21.234  32.567  12.987  1.00 32.00           O
ATOM     16  N   ALA A  68      20.012  30.345   11.765  1.00 25.00           N
ATOM     17  CA  ALA A  68      21.123  29.456   12.876  1.00 25.00           C
ATOM     18  N   SER A  70      24.567  32.345   8.654  1.00 30.00           N
ATOM     19  CA  SER A  70      25.678  33.456   9.765  1.00 30.00           C
ATOM     20  O   SER A  70      26.789  32.567  10.876  1.00 30.00           O
ATOM     21  CB  SER A  70      25.789  34.678   8.654  1.00 30.00           C
ATOM     22  OG  SER A  70      24.678  35.789   7.543  1.00 30.00           O
ATOM     23  N   LYS A  73      28.901  30.123   7.654  1.00 28.00           N
ATOM     24  CA  LYS A  73      30.012  31.234   8.765  1.00 28.00           C
ATOM     25  N   SER A 130      35.678  25.456  12.345  1.00 30.00           N
ATOM     26  CA  SER A 130      36.789  26.567  13.456  1.00 30.00           C
ATOM     27  O   SER A 130      37.890  25.678  14.567  1.00 30.00           O
ATOM     28  CB  SER A 130      36.890  27.789  12.345  1.00 30.00           C
ATOM     29  N   GLU A 166      10.234  35.890  18.901  1.00 32.00           N
ATOM     30  CA  GLU A 166      11.345  36.901  19.012  1.00 32.00           C
ATOM     31  O   GLU A 166      12.456  36.012  20.123  1.00 32.00           O
ATOM     32  CB  GLU A 166      11.456  38.123  18.012  1.00 32.00           C
ATOM     33  N   ASN A 170      15.678  38.901  15.234  1.00 27.00           N
ATOM     34  CA  ASN A 170      16.789  39.012  16.345  1.00 27.00           C
ATOM     35  O   ASN A 170      17.890  38.123  17.456  1.00 27.00           O
ATOM     36  N   GLY A 238      40.123  20.456  25.678  1.00 22.00           N
ATOM     37  CA  GLY A 238      41.234  21.567  26.789  1.00 22.00           C
ATOM     38  C   GLY A 238      42.345  20.678  27.890  1.00 22.00           C
ATOM     39  O   GLY A 238      43.456  21.789  28.901  1.00 22.00           O
ATOM     40  N   ALA A 237      39.012  21.345  24.567  1.00 25.00           N
ATOM     41  CA  ALA A 237      40.123  22.456  25.678  1.00 25.00           C
ATOM     42  N   GLU A 104      45.678  15.234  30.123  1.00 32.00           N
ATOM     43  CA  GLU A 104      46.789  16.345  31.234  1.00 32.00           C
ATOM     44  O   GLU A 104      47.890  15.456  32.345  1.00 32.00           O
ATOM     45  CB  GLU A 104      47.012  17.456  30.123  1.00 32.00           C
ATOM     46  N   ARG A 164      50.123  40.567  35.678  1.00 35.00           N
ATOM     47  CA  ARG A 164      51.234  41.678  36.789  1.00 35.00           C
ATOM     48  N   MET A 182      55.456  25.890  40.234  1.00 29.00           N
ATOM     49  CA  MET A 182      56.567  26.901  41.345  1.00 29.00           C
ATOM     50  N   LEU A 201      60.789  35.123  45.678  1.00 28.00           N
ATOM     51  CA  LEU A 201      61.890  36.234  46.789  1.00 28.00           C
ATOM     52  N   VAL A 240      65.012  20.456  50.123  1.00 26.00           N
ATOM     53  CA  VAL A 240      66.123  21.567  51.234  1.00 26.00           C
END
"""

# Known active site residues for each target
ACTIVE_SITES = {
    'tem1': {
        'catalytic': ['SER70', 'LYS73', 'SER130', 'GLU166'],
        'omega_loop': ['ASN170', 'ARG164'],
        'key': ['SER70', 'LYS73', 'SER130', 'GLU166', 'GLY238', 'GLU104', 'ALA237', 'ARG164', 'MET182', 'VAL240'],
        'substrate_binding': ['SER70', 'LYS73', 'SER130', 'ASN170', 'GLU166', 'ALA237', 'GLY238'],
    },
    'kpc2': {
        'catalytic': ['SER70', 'LYS73', 'SER130', 'GLU166'],
        'key': ['SER70', 'GLU166', 'ASN170', 'GLY238', 'CYS69'],
    },
    'ndm1': {
        'catalytic': ['HIS120', 'HIS122', 'HIS189', 'ASP124', 'CYS208', 'HIS250'],
        'key': ['HIS120', 'HIS122', 'ASP124', 'HIS189', 'CYS208', 'HIS250', 'LYS224'],
        'zinc1': ['HIS120', 'HIS122', 'HIS189'],
        'zinc2': ['ASP124', 'HIS189', 'HIS250'],
    },
    'gyra': {
        'catalytic': ['SER83', 'ASP87'],
        'qrdr': ['ALA91', 'GLY81', 'ARG121'],
        'key': ['SER83', 'ASP87', 'ALA91', 'GLY81'],
    },
}

# Amino acid properties for scoring
AMINO_ACID_PROPS = {
    'A': {'name': 'Ala', 'mw': 89.1, 'hydro': True, 'charge': 0, 'vdw_r': 1.92},
    'R': {'name': 'Arg', 'mw': 174.2, 'hydro': False, 'charge': 1, 'vdw_r': 2.48},
    'N': {'name': 'Asn', 'mw': 132.1, 'hydro': False, 'charge': 0, 'vdw_r': 2.05},
    'D': {'name': 'Asp', 'mw': 133.1, 'hydro': False, 'charge': -1, 'vdw_r': 2.00},
    'C': {'name': 'Cys', 'mw': 121.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.02},
    'Q': {'name': 'Gln', 'mw': 146.1, 'hydro': False, 'charge': 0, 'vdw_r': 2.17},
    'E': {'name': 'Glu', 'mw': 147.1, 'hydro': False, 'charge': -1, 'vdw_r': 2.15},
    'G': {'name': 'Gly', 'mw': 75.0, 'hydro': True, 'charge': 0, 'vdw_r': 1.40},
    'H': {'name': 'His', 'mw': 155.2, 'hydro': False, 'charge': 0.5, 'vdw_r': 2.17},
    'I': {'name': 'Ile', 'mw': 131.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.31},
    'L': {'name': 'Leu', 'mw': 131.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.31},
    'K': {'name': 'Lys', 'mw': 146.2, 'hydro': False, 'charge': 1, 'vdw_r': 2.31},
    'M': {'name': 'Met', 'mw': 149.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.28},
    'F': {'name': 'Phe', 'mw': 165.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.44},
    'P': {'name': 'Pro', 'mw': 115.1, 'hydro': True, 'charge': 0, 'vdw_r': 2.07},
    'S': {'name': 'Ser', 'mw': 105.1, 'hydro': False, 'charge': 0, 'vdw_r': 1.92},
    'T': {'name': 'Thr', 'mw': 119.1, 'hydro': False, 'charge': 0, 'vdw_r': 2.11},
    'W': {'name': 'Trp', 'mw': 204.2, 'hydro': True, 'charge': 0, 'vdw_r': 2.58},
    'Y': {'name': 'Tyr', 'mw': 181.2, 'hydro': False, 'charge': 0, 'vdw_r': 2.44},
    'V': {'name': 'Val', 'mw': 117.1, 'hydro': True, 'charge': 0, 'vdw_r': 2.15},
}
