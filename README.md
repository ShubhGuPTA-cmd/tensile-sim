# Composite Tensile Test Simulator

A localhost web app that simulates a tensile test on a fibre-reinforced composite.
Enter the matrix, reinforcement, fibre volume fraction, fibre angle, manufacturing process,
specimen geometry, temperature and humidity; run the animated universal testing machine; read
Young's modulus, tensile strength, strain at failure and more. Companion to the
"Tensile Testing of Fibre-Reinforced Composites: Project Plan".

## Run

    node server.js          # then open http://localhost:3000
    node server.js 8080     # custom port

No install step and no dependencies (Node 18+). Without Node: `cd public && python3 -m http.server 3000`.
You can also open `public/index.html` directly in a browser.

    npm test                # model unit tests (checks results against the plan's expected ranges)

## What it does

- **Inputs:** 5 matrices, 6 fibres, Vf 0-70 % (0 = neat polymer), fibre angle 0-90 deg, 5 processes,
  void content, gauge/width/thickness/tab length, temperature, humidity, load cell, speed, specimen count.
- **Presets:** the 16 test conditions (A1-F1) of the plan's test matrix.
- **Machine:** crosshead, grips, tabs, extensometer, environmental chamber; fracture shape follows the failure mode.
  The load cell trips if the peak load exceeds its capacity.
- **Outputs:** modulus (chord, ASTM D3039 1000-3000 microstrain), strength, strain at failure, Poisson's ratio,
  peak load, elongation, duration, tab shear, specific properties, ply properties, rule-of-mixtures efficiency,
  failure mode, warnings (tab failure, load cell range, test duration, void gate, Tg margin).
- **Statistics:** n simulated specimens (Weibull strength scatter), mean, SD, CV, 95 % CI, CSV export.
- **Charts:** stress-strain, load-crosshead, and parameter sweeps (Vf, angle, temperature, humidity, voids).

## Model (educational, not for design)

Rule of mixtures and Halpin-Tsai for E1, E2, G12; Tsai-Hill for off-axis strength; empirical factors for
process efficiency, voids, temperature and moisture (matrix softening near the wet Tg), strain rate and cold
embrittlement. Defaults are tuned to the plan's expected ranges for carbon, glass and aramid / epoxy at Vf 55 %.
Edit the property tables at the top of `public/js/model.js` to use your own data.
