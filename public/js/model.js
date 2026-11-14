/*
 * Tensile-test simulation model for fibre-reinforced composites.
 *
 * Educational model: micromechanics (rule of mixtures, Halpin-Tsai), Tsai-Hill off-axis
 * strength, empirical knock-down factors (process, voids, temperature, moisture, rate) and
 * Monte-Carlo scatter. Not for structural design: replace with measured data for real work.
 *
 * Units: GPa, MPa, mm, g/cm^3, degrees C, strain as a fraction unless named "pct".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TensileModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ----------------------------------------------------------------- data */

  const FIBRES = {
    carbon_std: { name: 'Carbon, standard modulus (T700-type)', short: 'Carbon', E: 230, sigma: 4900, rho: 1.80, nu: 0.20, E2: 15, G: 20, insitu: 1.0, kS: 0, kE: 0, kT: 0, Mf: 0, color: '#2b2f36' },
    carbon_hm: { name: 'Carbon, high modulus (M40-type)', short: 'Carbon HM', E: 377, sigma: 4400, rho: 1.77, nu: 0.20, E2: 10, G: 15, insitu: 1.0, kS: 0, kE: 0, kT: 0, Mf: 0, color: '#1f2329' },
    eglass: { name: 'E-glass', short: 'E-glass', E: 72, sigma: 3400, rho: 2.58, nu: 0.22, E2: 72, G: 29.5, insitu: 0.65, kS: 0.05, kE: 0, kT: 0, Mf: 0.1, color: '#b9cfc2' },
    aramid: { name: 'Aramid (Kevlar 49-type)', short: 'Aramid', E: 125, sigma: 3000, rho: 1.44, nu: 0.35, E2: 5, G: 2.9, insitu: 1.0, kS: 0.06, kE: 0.04, kT: 0.0004, Mf: 4.5, color: '#d8b640' },
    basalt: { name: 'Basalt', short: 'Basalt', E: 89, sigma: 3000, rho: 2.67, nu: 0.25, E2: 89, G: 35.6, insitu: 0.70, kS: 0.03, kE: 0, kT: 0, Mf: 0.1, color: '#7b6a58' },
    flax: { name: 'Flax (natural fibre)', short: 'Flax', E: 55, sigma: 800, rho: 1.45, nu: 0.30, E2: 6, G: 3, insitu: 0.75, kS: 0.25, kE: 0.20, kT: 0.0006, Mf: 12, color: '#c9ab7a' },
  };

  // Tg = stiffness-softening midpoint (C), w = softening width (C), Rmin = rubbery stiffness ratio,
  // Tm = melt (C, thermoplastics), Mmax = moisture at 100 % RH (%), dTg = Tg drop per % moisture,
  // kr = rate sensitivity per decade, coldK = stiffening per C below 23 C, n = curve exponent.
  const MATRICES = {
    epoxy: { name: 'Epoxy (DGEBA + amine)', short: 'Epoxy', cls: 'Thermoset', E: 3.2, nu: 0.35, sigma: 75, eps: 0.05, rho: 1.15, Tg: 120, w: 12, Rmin: 0.03, Tm: null, Mmax: 2.4, dTg: 15, kr: 0.02, coldK: 0.0015, n: 5 },
    polyester: { name: 'Unsaturated polyester (isophthalic)', short: 'Polyester', cls: 'Thermoset', E: 3.0, nu: 0.38, sigma: 60, eps: 0.025, rho: 1.20, Tg: 85, w: 12, Rmin: 0.03, Tm: null, Mmax: 1.5, dTg: 12, kr: 0.02, coldK: 0.0015, n: 6 },
    vinylester: { name: 'Vinyl ester', short: 'Vinyl ester', cls: 'Thermoset', E: 3.3, nu: 0.35, sigma: 80, eps: 0.04, rho: 1.12, Tg: 105, w: 12, Rmin: 0.03, Tm: null, Mmax: 1.2, dTg: 12, kr: 0.02, coldK: 0.0015, n: 5 },
    pp: { name: 'Polypropylene (PP)', short: 'PP', cls: 'Thermoplastic', E: 1.4, nu: 0.40, sigma: 33, eps: 0.30, rho: 0.905, Tg: 70, w: 45, Rmin: 0.08, Tm: 165, Mmax: 0.03, dTg: 0, kr: 0.08, coldK: 0, n: 3 },
    pa6: { name: 'Polyamide 6 (nylon), dry as moulded', short: 'PA6', cls: 'Thermoplastic', E: 3.0, nu: 0.39, sigma: 80, eps: 0.30, rho: 1.14, Tg: 55, w: 40, Rmin: 0.05, Tm: 220, Mmax: 9, dTg: 15, kr: 0.06, coldK: 0, n: 3 },
  };

  // etaS / etaE: alignment and fibre-damage efficiency (excluding voids). m: Weibull modulus of strength.
  const PROCESSES = {
    handlay: { name: 'Hand lay-up (wet)', voids: 3.0, etaS: 0.76, etaE: 0.95, m: 10, cvE: 0.06, maxVf: 45 },
    infusion: { name: 'Vacuum infusion (VARTM)', voids: 1.5, etaS: 0.82, etaE: 0.97, m: 14, cvE: 0.05, maxVf: 60 },
    prepreg: { name: 'Prepreg + autoclave / press', voids: 0.5, etaS: 0.90, etaE: 0.99, m: 25, cvE: 0.03, maxVf: 68 },
    compression: { name: 'Compression moulding / hot press', voids: 1.0, etaS: 0.86, etaE: 0.98, m: 18, cvE: 0.04, maxVf: 65 },
    filmstack: { name: 'Film stacking (thermoplastic)', voids: 1.5, etaS: 0.80, etaE: 0.97, m: 14, cvE: 0.05, maxVf: 55 },
  };

  const RATE_REF = 2 / 60 / 138; // strain rate of 2 mm/min on a 138 mm gauge, 1/s
  const K_FRAME = 25; // machine + grip stiffness, kN/mm (crosshead displacement = gauge elongation + F / K)
  const ADHESIVE_SHEAR = 25; // typical tab adhesive shear strength, MPa

  /* ------------------------------------------------------------ helpers */

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const rad = (d) => (d * Math.PI) / 180;
  const num = (x, d) => (Number.isFinite(+x) ? +x : d);

  function gammaFn(z) {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  const tCrit = (df) => (df < 1 ? NaN : df <= 30 ? T975[df - 1] : 1.96 + 2.4 / df);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ defaults */

  const DEFAULTS = {
    matrix: 'epoxy', fibre: 'carbon_std', vf: 55, angle: 0, process: 'infusion', voids: 1.5,
    gauge: 138, width: 15, thickness: 0.91, tab: 56,
    temp: 23, rh: 50, capacity: 100, speed: 2, nspec: 6, seed: 7,
  };

  function normalise(raw) {
    const d = DEFAULTS;
    const i = Object.assign({}, d, raw || {});
    i.matrix = MATRICES[i.matrix] ? i.matrix : d.matrix;
    i.fibre = FIBRES[i.fibre] ? i.fibre : d.fibre;
    i.process = PROCESSES[i.process] ? i.process : d.process;
    i.vf = clamp(num(i.vf, d.vf), 0, 80);
    i.angle = clamp(num(i.angle, 0), 0, 90);
    i.voids = clamp(num(i.voids, d.voids), 0, 15);
    i.gauge = clamp(num(i.gauge, d.gauge), 10, 500);
    i.width = clamp(num(i.width, d.width), 2, 60);
    i.thickness = clamp(num(i.thickness, d.thickness), 0.1, 20);
    i.tab = clamp(num(i.tab, d.tab), 0, 150);
    i.temp = clamp(num(i.temp, d.temp), -100, 300);
    i.rh = clamp(num(i.rh, d.rh), 0, 100);
    i.capacity = clamp(num(i.capacity, d.capacity), 1, 1000);
    i.speed = clamp(num(i.speed, d.speed), 0.01, 500);
    i.nspec = Math.round(clamp(num(i.nspec, d.nspec), 1, 30));
    i.seed = Math.round(num(i.seed, d.seed));
    return i;
  }

  /* -------------------------------------------------- matrix and fibre */

  function matrixState(m, T, rh, rate) {
    const moist = (m.Mmax * rh) / 100;
    const TgWet = m.Tg - m.dTg * moist;
    const R = (temp, Tg) => {
      let r = m.Rmin + (1 - m.Rmin) / (1 + Math.exp((temp - Tg) / m.w));
      if (m.Tm) r *= 1 / (1 + Math.exp((temp - (m.Tm - 10)) / 5));
      return r;
    };
    let ratio = R(T, TgWet) / R(23, m.Tg);
    if (T < 23) ratio *= 1 + m.coldK * (23 - T);
    ratio = clamp(ratio, 0.005, 1.35);
    const rf = clamp(1 + m.kr * Math.log10(rate / RATE_REF), 0.7, 1.6);
    const E = m.E * ratio * rf;
    const sigma = m.sigma * Math.pow(ratio, 0.8) * rf;
    const coldF = T < 23 ? Math.max(0.4, 1 - 0.004 * (23 - T)) : 1;
    const softF = ratio < 1 ? 1 + 0.6 * (1 - ratio) : 1;
    const eps = Math.max(m.eps * coldF * softF, sigma / (E * 1000));
    return { moist, TgWet, ratio, rf, E, sigma, eps };
  }

  /* ------------------------------------------------------------ compute */

  function compute(raw) {
    const inp = normalise(raw);
    const f = FIBRES[inp.fibre];
    const m = MATRICES[inp.matrix];
    const p = PROCESSES[inp.process];
    const Vf = inp.vf / 100;
    const Vm = 1 - Vf;
    const neat = Vf === 0;
    const theta = neat ? 0 : inp.angle;
    const th = rad(theta);
    const c = Math.cos(th), s = Math.sin(th);
    const area = inp.width * inp.thickness; // mm^2
    const rate = inp.speed / 60 / inp.gauge;
    const warnings = [];
    const notes = [];

    const mat = matrixState(m, inp.temp, inp.rh, rate);

    // fibre in the environment
    const tempF = Math.max(0.5, 1 - f.kT * Math.max(0, inp.temp - 23));
    const Ef = f.E * (1 - f.kE * (inp.rh / 100));
    const sigF = f.sigma * f.insitu * (1 - f.kS * (inp.rh / 100)) * tempF;

    // voids
    const vEff = inp.voids + Math.max(0, inp.vf - p.maxVf) * 0.2;
    const voidS = Math.max(0.3, 1 - 0.025 * vEff);
    const voidE = Math.max(0.5, 1 - 0.01 * vEff);
    const voidT = Math.max(0.2, 1 - 0.06 * vEff);

    // longitudinal
    const E1rom = Vf * Ef + Vm * mat.E;
    const epsFins = sigF / (Ef * 1000);
    const matrixCracks = !neat && mat.eps < epsFins;
    const sigMat = matrixCracks ? 0 : Math.min(mat.E * 1000 * epsFins, mat.sigma);
    const Xrom = Vf * sigF + Vm * sigMat;
    const Xmat = Vm * mat.sigma;
    const etaT = 0.85 + 0.15 * Math.min(1, mat.ratio);
    let E1, X;
    if (neat) {
      E1 = mat.E * voidE;
      X = mat.sigma * voidS;
    } else {
      E1 = E1rom * p.etaE * voidE;
      X = Math.max(Xrom * p.etaS * voidS * etaT, Xmat * voidT);
    }
    const fibreDominated = !neat && Xrom * p.etaS * voidS * etaT >= Xmat * voidT;

    // transverse and shear (Halpin-Tsai, Chamis-type strength)
    let E2 = mat.E * voidE, G12, nu12, Y, S;
    const Gm = mat.E / (2 * (1 + m.nu));
    if (neat) {
      G12 = Gm; nu12 = m.nu; Y = X; S = X * 0.6;
    } else {
      const eta2 = (f.E2 / mat.E - 1) / (f.E2 / mat.E + 2);
      E2 = (mat.E * (1 + 2 * eta2 * Vf)) / (1 - eta2 * Vf) * voidE;
      const etaG = (f.G / Gm - 1) / (f.G / Gm + 1);
      G12 = (Gm * (1 + etaG * Vf)) / (1 - etaG * Vf) * Math.sqrt(voidE);
      nu12 = Vf * f.nu + Vm * m.nu;
      const geo = Math.sqrt(Vf) - Vf;
      Y = mat.sigma * 0.8 * (1 - geo * (1 - mat.E / f.E2)) * voidT;
      S = mat.sigma * 0.9 * (1 - geo * (1 - Gm / f.G)) * voidT;
    }

    // off-axis
    let Ex = E1, nuxy = nu12, sigU = X;
    if (!neat && theta > 0) {
      const s2c2 = s * s * c * c;
      const invEx = Math.pow(c, 4) / E1 + (1 / G12 - (2 * nu12) / E1) * s2c2 + Math.pow(s, 4) / E2;
      Ex = 1 / invEx;
      nuxy = Ex * ((nu12 / E1) * (Math.pow(s, 4) + Math.pow(c, 4)) - (1 / E1 + 1 / E2 - 1 / G12) * s2c2);
      const inv = Math.pow(c, 4) / (X * X) + (1 / (S * S) - 1 / (X * X)) * s2c2 + Math.pow(s, 4) / (Y * Y);
      sigU = 1 / Math.sqrt(inv);
    }

    // curve
    const curve = buildCurve({ neat, theta, Ex, sigU, mat, m, matrixCracks, fibreDominated, Vf, Ef, p, voidE, voidT });
    const epsU = curve.epsU;

    // modulus as measured: chord, ASTM D3039 1000-3000 ue (ISO 527 0.05-0.25 % for neat polymer)
    let e1 = neat ? 0.0005 : 0.001, e2 = neat ? 0.0025 : 0.003;
    if (epsU < e2 * 1.15) { e1 = 0.1 * epsU; e2 = 0.5 * epsU; }
    const Echord = (stressAt(curve, e2) - stressAt(curve, e1)) / (e2 - e1) / 1000; // GPa
    const chord = { e1, e2 };

    // physical quantities
    const rhoC = (Vf * f.rho + Vm * m.rho) * (1 - inp.voids / 100);
    const Wf = (Vf * f.rho) / (Vf * f.rho + Vm * m.rho);
    const Mc = (1 - Wf) * mat.moist + Wf * f.Mf * (inp.rh / 100);
    const Fmax = (sigU * area) / 1000; // kN
    const dGauge = epsU * inp.gauge; // mm
    const dCross = dGauge + Fmax / K_FRAME;
    const duration = (dCross / inp.speed) * 60; // s
    const tabShear = inp.tab > 0 ? (Fmax * 1000) / (2 * inp.width * inp.tab) : 0;
    const toughness = curveArea(curve) ; // MJ/m^3 (MPa*strain)

    // failure mode
    let mode, modeKey;
    if (neat) {
      if (mat.eps > 0.1) { mode = 'Ductile yielding, necking and drawing of the polymer'; modeKey = 'ductile'; }
      else { mode = 'Brittle fracture across the section'; modeKey = 'clean'; }
    } else if (theta <= 5) {
      mode = fibreDominated ? 'Fibre-dominated: brush-like fibre fracture in the gauge section (valid, e.g. XGM / LGM)' : 'Matrix-dominated: matrix tension limits the part, fibres barely load';
      modeKey = 'brush';
    } else if (theta <= 20) { mode = 'Mixed: fibre fracture with longitudinal splitting and fibre pull-out'; modeKey = 'split'; }
    else if (theta <= 60) { mode = 'In-plane shear: angled fracture along the fibres'; modeKey = 'angled'; }
    else { mode = 'Transverse matrix / interface failure: clean break across the width'; modeKey = 'clean'; }

    // warnings and notes
    if (Fmax > inp.capacity) warnings.push({ level: 'bad', text: `Peak load ${Fmax.toFixed(1)} kN exceeds the ${inp.capacity} kN load cell: the test cannot be completed. Use a larger cell or a smaller cross-section.` });
    else if (Fmax < 0.1 * inp.capacity) warnings.push({ level: 'warn', text: `Peak load is only ${(100 * Fmax / inp.capacity).toFixed(0)} % of the ${inp.capacity} kN load cell. Load resolution will be poor; use a smaller cell (aim for 20-90 %).` });
    if (inp.tab > 0 && tabShear > ADHESIVE_SHEAR) warnings.push({ level: 'bad', text: `Tab bond shear stress ${tabShear.toFixed(0)} MPa exceeds a typical adhesive strength (about ${ADHESIVE_SHEAR} MPa): expect tab or grip failure, which ASTM D3039 treats as invalid. Lengthen the tabs or widen the specimen.` });
    else if (inp.tab > 0 && tabShear > 15) warnings.push({ level: 'warn', text: `Tab bond shear stress is ${tabShear.toFixed(0)} MPa, close to the adhesive limit. Check tab length and bond quality.` });
    if (!neat && duration < 60) warnings.push({ level: 'warn', text: `Failure occurs after ${duration.toFixed(0)} s. ASTM D3039 aims for 1-10 minutes: lower the crosshead speed.` });
    else if (!neat && duration > 600) warnings.push({ level: 'warn', text: `Failure occurs after ${(duration / 60).toFixed(1)} min. ASTM D3039 aims for 1-10 minutes: raise the crosshead speed.` });
    if (!neat && inp.vf > p.maxVf) warnings.push({ level: 'warn', text: `Fibre volume fraction ${inp.vf.toFixed(0)} % is above what ${p.name.toLowerCase()} usually achieves (about ${p.maxVf} %). Effective void content was raised to ${vEff.toFixed(1)} %.` });
    if (!neat && inp.vf > 65) warnings.push({ level: 'info', text: 'Above about 65 % the fibres struggle to be wetted out and void content rises sharply in real panels.' });
    if (inp.voids > 2) warnings.push({ level: 'warn', text: `Void content ${inp.voids.toFixed(1)} % is above the 2 % panel acceptance gate in the project plan.` });
    if (inp.temp > mat.TgWet - 28 && m.cls === 'Thermoset') warnings.push({ level: 'warn', text: `Test temperature ${inp.temp} C is within 28 C of the wet glass transition (${mat.TgWet.toFixed(0)} C). Matrix softening will reduce results.` });
    if (m.Tm && inp.temp > m.Tm - 25) warnings.push({ level: 'bad', text: `Test temperature ${inp.temp} C is close to the ${m.short} melting point (${m.Tm} C): the matrix loses load transfer.` });
    if (matrixCracks) notes.push(`The matrix fails at ${(mat.eps * 100).toFixed(1)} % strain, before the fibres (${(epsFins * 100).toFixed(1)} %). Expect matrix cracking (whitening) and a knee in the curve.`);
    if (!neat && theta > 5) notes.push(`Off-axis angle ${theta.toFixed(0)} deg: strength drops by Tsai-Hill and the failure is governed by the matrix, so 0 deg values do not apply.`);
    if (neat) notes.push('Neat polymer: no fibres, so volume fraction, angle and process efficiency do not apply.');
    if (inp.temp !== 23 || inp.rh !== 50) notes.push(`Conditions: matrix modulus is ${(100 * mat.ratio).toFixed(0)} % of its 23 C / dry value (wet Tg ${mat.TgWet.toFixed(0)} C, matrix moisture ${mat.moist.toFixed(2)} %).`);

    return {
      inp, f, m, p, Vf, neat, theta,
      area, rate, mat, Ef, sigF, epsFins, vEff, voidS, voidE, voidT,
      lamina: { E1, E2, G12, nu12, X, Y, S, E1rom, Xrom, Xmat, matrixCracks, fibreDominated },
      Ex, nuxy, sigU, epsU, Echord, chord, curve,
      Eini: Ex,
      rhoC, Wf, Mc, Fmax, dGauge, dCross, duration, tabShear, toughness,
      specE: Echord / rhoC, specS: sigU / rhoC,
      effE: neat ? 1 : E1 / E1rom, effS: neat ? 1 : X / Math.max(Xrom, Xmat),
      mode, modeKey, warnings, notes,
    };
  }

  /* -------------------------------------------------------- stress-strain */

  function buildCurve(o) {
    const pts = [];
    const N = 240;
    const { neat, theta, Ex, sigU, mat, m } = o;
    const E = Ex * 1000; // MPa
    let epsU;
    if (neat) {
      const linU = sigU / E;
      epsU = Math.max(mat.eps * o.voidT, linU * 1.02);
      for (let i = 0; i <= N; i++) {
        const sg = sigU * Math.pow(i / N, 0.85);
        pts.push({ eps: sg / E + (epsU - linU) * Math.pow(sg / sigU, m.n), sig: sg });
      }
    } else {
      const s2 = Math.pow(Math.sin(2 * rad(theta)), 2);
      const c0 = Math.min(0.10, 0.6 * mat.eps);
      const nl = c0 * s2 * Math.min(1, o.voidT + 0.2);
      const linU = sigU / E;
      epsU = linU + nl;
      let knee = null;
      if (theta <= 5 && o.matrixCracks) {
        const epsK = mat.eps;
        const sigK = E * epsK;
        const Epost = Math.max(0.2, o.Vf * o.Ef * o.p.etaE * o.voidE) * 1000;
        if (sigK < sigU * 0.97) knee = { epsK, sigK, Epost };
      }
      if (knee) {
        epsU = knee.epsK + (sigU - knee.sigK) / knee.Epost;
        for (let i = 0; i <= 60; i++) { const e = (knee.epsK * i) / 60; pts.push({ eps: e, sig: E * e }); }
        for (let i = 1; i <= 120; i++) { const sg = knee.sigK + ((sigU - knee.sigK) * i) / 120; pts.push({ eps: knee.epsK + (sg - knee.sigK) / knee.Epost, sig: sg }); }
      } else {
        for (let i = 0; i <= N; i++) {
          const sg = sigU * (i / N);
          pts.push({ eps: sg / E + nl * Math.pow(sg / sigU, m.n), sig: sg });
        }
      }
    }
    return { points: pts, epsU, sigU };
  }

  function stressAt(curve, eps) {
    const p = curve.points;
    if (eps <= 0) return 0;
    if (eps >= curve.epsU) return curve.sigU;
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].eps <= eps) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi];
    const t = b.eps === a.eps ? 0 : (eps - a.eps) / (b.eps - a.eps);
    return a.sig + t * (b.sig - a.sig);
  }

  function epsAtSigma(curve, sig) {
    const p = curve.points;
    if (sig <= 0) return 0;
    if (sig >= curve.sigU) return curve.epsU;
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].sig <= sig) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi];
    const t = b.sig === a.sig ? 0 : (sig - a.sig) / (b.sig - a.sig);
    return a.eps + t * (b.eps - a.eps);
  }

  function curveArea(curve) {
    let a = 0;
    const p = curve.points;
    for (let i = 1; i < p.length; i++) a += 0.5 * (p[i].sig + p[i - 1].sig) * (p[i].eps - p[i - 1].eps);
    return a; // MPa x strain = MJ/m^3
  }

  /* Machine kinematics: crosshead displacement u -> specimen strain (bisection). */
  function strainAtCrosshead(res, u) {
    const K = K_FRAME, A = res.area, L = res.inp.gauge, c = res.curve;
    const g = (e) => e * L + (stressAt(c, e) * A) / 1000 / K;
    if (u >= g(c.epsU)) return { eps: c.epsU, failed: true };
    let lo = 0, hi = c.epsU;
    for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (g(mid) < u) lo = mid; else hi = mid; }
    return { eps: 0.5 * (lo + hi), failed: false };
  }

  /* ---------------------------------------------------------- Monte Carlo */

  function simulate(res) {
    const inp = res.inp;
    const rnd = mulberry32(inp.seed);
    const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const matrixDom = res.neat || res.theta > 10 || !res.lamina.fibreDominated;
    const mW = res.neat ? 18 : matrixDom ? res.p.m * 0.6 : res.p.m;
    const cvE = (res.neat ? 0.03 : res.p.cvE) * (matrixDom && !res.neat ? 1.3 : 1);
    const sigma0 = res.sigU / gammaFn(1 + 1 / mW);
    const rows = [];
    for (let i = 0; i < inp.nspec; i++) {
      const sig = sigma0 * Math.pow(-Math.log(1 - rnd()), 1 / mW);
      const E = Math.max(0.2 * res.Echord, res.Echord * (1 + cvE * normal()));
      const eps = epsAtSigma(res.curve, Math.min(sig, res.sigU * 0.9999)) * (res.Echord / E) * (sig > res.sigU ? sig / res.sigU : 1);
      rows.push({ id: i + 1, sigma: sig, E, eps, Fmax: (sig * res.area) / 1000 });
    }
    const stat = (key, scale) => {
      const v = rows.map((r) => r[key] * (scale || 1));
      const n = v.length;
      const mean = v.reduce((a, b) => a + b, 0) / n;
      const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
      const ci = n > 1 ? (tCrit(n - 1) * sd) / Math.sqrt(n) : 0;
      return { mean, sd, cv: mean ? (100 * sd) / mean : 0, ci, min: Math.min(...v), max: Math.max(...v) };
    };
    return { rows, weibullM: mW, cvE, stats: { sigma: stat('sigma'), E: stat('E'), eps: stat('eps', 100), Fmax: stat('Fmax') } };
  }

  /* --------------------------------------------------------------- sweep */

  function sweep(inp, key, lo, hi, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      const r = compute(Object.assign({}, inp, { [key]: x }));
      out.push({ x, E: r.Echord, sigma: r.sigU, eps: r.epsU * 100, Erom: r.lamina.E1rom, Xrom: Math.max(r.lamina.Xrom, r.lamina.Xmat) });
    }
    return out;
  }

  /* ------------------------------------------------------------- presets */

  const G0 = { gauge: 138, width: 15, thickness: 1.0, tab: 56, angle: 0, temp: 23, rh: 50, capacity: 100 };
  const T90 = { gauge: 125, width: 25, thickness: 2.0, tab: 25, angle: 90, capacity: 10 };
  const NEAT = { gauge: 50, width: 13, thickness: 3.2, tab: 0, angle: 0, vf: 0, fibre: 'carbon_std', capacity: 5 };
  const PRESETS = [
    { id: 'A1', label: 'A1 Carbon / epoxy, Vf 55 %', v: { ...G0, thickness: 0.91, fibre: 'carbon_std', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5 } },
    { id: 'A2', label: 'A2 E-glass / epoxy, Vf 55 %', v: { ...G0, fibre: 'eglass', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5 } },
    { id: 'A3', label: 'A3 Aramid / epoxy, Vf 55 %', v: { ...G0, fibre: 'aramid', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5 } },
    { id: 'B1', label: 'B1 Carbon / epoxy, Vf 35 %', v: { ...G0, thickness: 0.95, fibre: 'carbon_std', matrix: 'epoxy', vf: 35, process: 'infusion', voids: 1.5 } },
    { id: 'B2', label: 'B2 Carbon / epoxy, Vf 45 %', v: { ...G0, thickness: 1.11, fibre: 'carbon_std', matrix: 'epoxy', vf: 45, process: 'infusion', voids: 1.5 } },
    { id: 'B3', label: 'B3 Carbon / epoxy, Vf 65 %', v: { ...G0, thickness: 1.03, fibre: 'carbon_std', matrix: 'epoxy', vf: 65, process: 'compression', voids: 1.0 } },
    { id: 'C1', label: 'C1 E-glass / epoxy, Vf 45 %', v: { ...G0, fibre: 'eglass', matrix: 'epoxy', vf: 45, process: 'infusion', voids: 1.5 } },
    { id: 'C2', label: 'C2 E-glass / polyester, Vf 45 %', v: { ...G0, fibre: 'eglass', matrix: 'polyester', vf: 45, process: 'infusion', voids: 1.5 } },
    { id: 'C3', label: 'C3 E-glass / PP, Vf 45 %', v: { ...G0, fibre: 'eglass', matrix: 'pp', vf: 45, process: 'filmstack', voids: 1.5 } },
    { id: 'D1', label: 'D1 Neat epoxy (ASTM D638)', v: { ...NEAT, matrix: 'epoxy', process: 'infusion', voids: 0.5, speed: 5 } },
    { id: 'D2', label: 'D2 Neat polyester (ASTM D638)', v: { ...NEAT, matrix: 'polyester', process: 'infusion', voids: 0.5, speed: 5 } },
    { id: 'D3', label: 'D3 Neat PP (ASTM D638)', v: { ...NEAT, matrix: 'pp', process: 'infusion', voids: 0.5, speed: 5 } },
    { id: 'E1', label: 'E1 Carbon / epoxy, cold -40 C dry', v: { ...G0, thickness: 0.91, fibre: 'carbon_std', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5, temp: -40, rh: 0 } },
    { id: 'E2', label: 'E2 Carbon / epoxy, hot 80 C dry', v: { ...G0, thickness: 0.91, fibre: 'carbon_std', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5, temp: 80, rh: 0 } },
    { id: 'E3', label: 'E3 Carbon / epoxy, hot-wet 70 C / 85 % RH', v: { ...G0, thickness: 0.91, fibre: 'carbon_std', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5, temp: 70, rh: 85 } },
    { id: 'F1', label: 'F1 Carbon / epoxy, transverse 90 deg', v: { ...T90, thickness: 2.0, fibre: 'carbon_std', matrix: 'epoxy', vf: 55, process: 'infusion', voids: 1.5, temp: 23, rh: 50 } },
  ];

  return { FIBRES, MATRICES, PROCESSES, PRESETS, DEFAULTS, K_FRAME, ADHESIVE_SHEAR, compute, normalise, stressAt, epsAtSigma, strainAtCrosshead, simulate, sweep, tCrit };
});
