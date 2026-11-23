# Composite Tensile and Compression Test Simulator

A browser-based virtual universal testing machine for fibre-reinforced polymer composites. Pick a matrix,
a reinforcement and the test conditions, choose **Tension** or **Compression**, run the animated machine,
and read off modulus, strength, strain at failure, the failure mechanism and the full stress-strain curve.

Project: *Virtual Tensile and Compression Testing of Fibre-Reinforced Composites: Design and Development of a
Web-Based Test Simulator*, Department of Computer Science and Engineering, SRM Institute of Science and Technology.

> **Educational model, not design data.** Results are physics-based predictions tuned to typical literature
> ranges. Validate against physical ASTM D3039 and D6641 tests before using any number for design.

---

## Quick start

Requires Node.js 18 or newer. There is nothing to install: the server and the front end have no dependencies.

```bash
git clone https://github.com/ShubhGuPTA-cmd/tensile-sim.git
cd tensile-sim
node server.js            # open http://localhost:3000
node server.js 8080       # use another port
```

Other ways to run it:

| Method | Command |
|---|---|
| npm script | `npm start` |
| Without Node | `cd public && python3 -m http.server 3000` |
| No server | open `public/index.html` directly in a browser |
| Unit tests | `npm test` (19 tests, all should pass) |

A preset can be opened directly from a link, for example `http://localhost:3000/?preset=A1` (tension) or
`http://localhost:3000/?preset=C-A1` (compression).

## Using the simulator

1. Choose **Tension** or **Compression** with the switch at the top right. The preset list changes with it.
2. Pick a preset, or set the **matrix**, **fibre**, **fibre volume fraction (Vf)**, **fibre angle**,
   **manufacturing process** and **void content**.
3. Enter the **specimen** (gauge length, width, thickness, tab length) and the **test conditions**
   (temperature, relative humidity, load-cell capacity, crosshead speed, number of specimens).
4. Press **Run** to watch the test, or **Instant** to jump to the result. Use **Reset** to repeat.
5. Read the cards and tables, switch chart tabs (stress-strain, load-crosshead, sweeps), and export the curve
   or the specimen table as CSV.

In compression mode the gauge length means the *unsupported* gauge and the tab length is not used.

## Features

- **Inputs:** 5 matrices (epoxy, polyester, vinyl ester, polypropylene, polyamide 6), 6 fibres (standard and high
  modulus carbon, E-glass, aramid, basalt, flax), Vf 0-80 % (0 = neat polymer), angle 0-90 deg, 5 processes
  (hand lay-up, infusion, prepreg/autoclave, compression moulding, film stacking), voids, geometry,
  temperature -100 to 300 C, humidity, load cell, speed, specimen count. Inputs are clamped to safe ranges.
- **Animated machine:** crosshead, grips or platens, tabs, strain gauges, environmental chamber, and a failure
  drawing that follows the mechanism. The load cell trips if the peak load exceeds its capacity.
- **Outputs:** chord modulus (ASTM D3039, 1000-3000 microstrain), strength, strain at failure, Poisson's ratio,
  peak load, elongation or shortening, test duration, tab shear (tension), specific modulus and strength, ply
  properties, rule-of-mixtures efficiency, failure mode, and warnings.
- **Statistics:** n simulated specimens with Weibull strength scatter, mean, standard deviation, CV and a
  Student-t 95 % confidence interval.
- **Charts:** stress-strain, load-crosshead, and parameter sweeps (Vf, fibre angle, temperature, humidity, voids).

## Test modes

| | Tension | Compression |
|---|---|---|
| Standard | ASTM D3039 (composites), ASTM D638 (neat polymer), ISO 527-5 | ASTM D6641 CLC fixture (composites), ASTM D695 (neat polymer block) |
| Default specimen | 138 mm gauge, 15 x 0.91 mm, 56 mm tabs | 13 mm gauge, 13 x 2.0 mm, no tabs |
| Default speed | 2 mm/min | 1.3 mm/min |
| Limits modelled | fibre-dominated failure, matrix cracking, tab shear | kink-band micro-buckling, fibre crushing, Euler buckling |
| Failure drawings | brush-like fibre failure, clean break, longitudinal splitting, angled fracture, ductile necking | kink band, brooming, 45-53 deg shear, barrelling, column buckling |

## Presets

**Tension (16):** A1-A3 carbon, E-glass and aramid / epoxy at Vf 55 %; B1-B3 carbon / epoxy at Vf 35, 45, 65 %;
C1-C3 E-glass at Vf 45 % in epoxy, polyester and PP; D1-D3 neat epoxy, polyester and PP; E1-E3 carbon / epoxy at
-40 C, 80 C and 70 C / 85 % RH; F1 carbon / epoxy at 90 deg.

**Compression (9):** C-A1 to C-A3 carbon, E-glass and aramid / epoxy; C-B1 carbon Vf 65 % prepreg; C-C1 E-glass /
polyester; C-D1 neat epoxy block; C-E1 hot-wet carbon / epoxy; C-F1 carbon at 90 deg; C-G1 slender coupon (80 mm
gauge) that fails by column buckling.

## Example predictions

| Case | Modulus (GPa) | Strength (MPa) | Failure strain (%) | Mechanism |
|---|---|---|---|---|
| Carbon / epoxy, tension (A1) | 122.2 | 2151 | 1.76 | Fibre-dominated brittle |
| E-glass / epoxy, tension (A2) | 39.2 | 962 | 2.45 | Fibre-dominated |
| Aramid / epoxy, tension (A3) | 65.7 | 1290 | 1.96 | Fibre-dominated |
| Carbon / epoxy, compression (C-A1) | 118.9 | 996 | 0.84 | Kink band |
| E-glass / epoxy, compression (C-A2) | 39.2 | 815 | 2.08 | Fibre crush |
| Aramid / epoxy, compression (C-A3) | 60.3 | 215 | 0.36 | Fibre crush |
| Neat epoxy block, compression (C-D1) | 3.22 | 92 | 4.85 | Yielding |

Values are model output and can change if the property tables are edited.

## Model

All physics is in `public/js/model.js`, with no DOM code, so it can be unit tested and reused.

- **Stiffness:** rule of mixtures for E1 and nu12; Halpin-Tsai for E2 and G12; off-axis modulus from
  transformed compliance.
- **Tension strength:** rule-of-mixtures fibre limit, Chamis-type transverse and shear strengths, Tsai-Hill
  off-axis strength, matrix-cracking knee for matrix-dominated cases.
- **Compression strength:** the lower of the Budiansky-Fleck kink-band limit
  `sigma = G12 / (1 + phi0 / gamma_y)` (`gamma_y = S / G12`, `phi0` set by the process) and a fibre-crush limit;
  transverse `Yc = min(3.5 Y, 2.2 sigma_m)`; neat polymer yield about 1.25 x tensile. An Euler buckling check,
  `sigma_cr = pi^2 E t^2 / (3 L^2)`, caps the result and flags an invalid test for slender coupons.
- **Process and environment:** process efficiency, voids, temperature (glass-transition sigmoid), moisture
  (wet Tg drop), strain rate and cold embrittlement. Hot-wet conditions lower compression more than tension.
- **Statistics:** Weibull strength scatter, normal modulus scatter, Student-t confidence intervals.

To use your own data, edit the fibre, matrix and process tables at the top of `model.js`.

## Project structure

```
tensile-sim/
├── server.js            Dependency-free static Node server
├── package.json         Scripts: start, test
├── public/
│   ├── index.html       Page layout and SVG machine
│   ├── css/style.css    Styling
│   └── js/
│       ├── model.js     Physics engine (browser and Node, UMD)
│       └── app.js       UI, machine animation, charts, CSV export
└── test/
    └── model.test.js    19 unit tests (node:test)
```

## Tests

`npm test` runs 19 tests with Node's built-in runner. They check the A-series results against expected ranges,
the rule-of-mixtures value, Vf and angle trends, brittle 90 deg failure, environment effects, neat resins,
load-cell overload, Monte Carlo statistics, input clamping, and the compression behaviour: Xc below Xt for carbon,
crush-limited aramid and glass, hot-wet loss, column buckling of slender coupons, neat polymer 1.1-1.5 x tensile,
and finite outputs for sweeps and extreme inputs.

## Limitations

- Single-ply or unidirectional-lamina behaviour; no multi-ply stacking sequences, fatigue, flexure or 3D effects.
- Empirical knock-down factors and misalignment angles are not calibrated to a specific material system.
- Predicted carbon / epoxy compressive strength is at the low end of typical measured values (about 1100-1300 MPa).

## Standards and references

ASTM D3039, ASTM D638, ASTM D6641, ASTM D695, ASTM D3171, ASTM D5229, ISO 527-5; Budiansky and Fleck (1993),
Argon (1972), Fleck (1997), Schultheisz and Waas (1996), Adams and Welsh (1997). The full reference list of 39
sources is in the project report.

## Team

Batch 22, B.Tech CSE (AIML), SRM Institute of Science and Technology: Anvi Gautam, Avni Gautam, Shubh Gupta.
Guide: Dr. Sampath Kumar S, Assistant Professor. Head of Department: Dr. Annie Uthra.

## Publishing to GitHub

```bash
git init
git add .
git commit -m "Composite tensile and compression test simulator"
git branch -M main
git remote add origin https://github.com/ShubhGuPTA-cmd/tensile-sim.git
git push -u origin main
```

## License

No licence has been chosen. Add a `LICENSE` file (for example MIT) before sharing the code publicly.
