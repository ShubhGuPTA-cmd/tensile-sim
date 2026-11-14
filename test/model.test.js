'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TM = require('../public/js/model.js');

const preset = (id) => TM.PRESETS.find((p) => p.id === id).v;
const run = (id, over) => TM.compute(Object.assign({}, preset(id), over || {}));
const between = (x, lo, hi, label) => assert.ok(x >= lo && x <= hi, `${label}: ${x.toFixed(3)} not in [${lo}, ${hi}]`);

test('A series agrees with the planning ranges in the project plan (section 2.2)', () => {
  const a1 = run('A1'), a2 = run('A2'), a3 = run('A3');
  between(a1.Echord, 115, 130, 'carbon E'); between(a1.sigU, 1800, 2400, 'carbon strength'); between(a1.epsU * 100, 1.4, 1.8, 'carbon strain');
  between(a2.Echord, 36, 42, 'glass E'); between(a2.sigU, 900, 1200, 'glass strength'); between(a2.epsU * 100, 2.3, 3.0, 'glass strain');
  between(a3.Echord, 60, 70, 'aramid E'); between(a3.sigU, 1200, 1400, 'aramid strength'); between(a3.epsU * 100, 1.7, 2.1, 'aramid strain');
});

test('rule-of-mixtures reference for carbon/epoxy matches the plan table (128 GPa at 55 %)', () => {
  between(run('A1').lamina.E1rom, 127, 129, 'E1rom');
  for (const [vf, e] of [[35, 83], [45, 105], [55, 128], [65, 151]]) between(run('A1', { vf }).lamina.E1rom, e - 1, e + 1, 'E1rom ' + vf);
});

test('modulus and strength rise with Vf for carbon/epoxy (series B)', () => {
  const e = [35, 45, 55, 65].map((vf) => run('A1', { vf }).Echord);
  const s = [35, 45, 55, 65].map((vf) => run('A1', { vf, process: 'prepreg', voids: 1 }).sigU);
  for (let i = 1; i < 4; i++) { assert.ok(e[i] > e[i - 1]); assert.ok(s[i] > s[i - 1]); }
});

test('transverse (90 deg) strength is a small fraction of the 0 deg strength and the curve is brittle', () => {
  const f1 = run('F1'), a1 = run('A1');
  between(f1.sigU, 20, 90, 'transverse strength');
  assert.ok(f1.sigU < 0.05 * a1.sigU);
  between(f1.Echord, 5, 14, 'transverse modulus');
  assert.equal(f1.modeKey, 'clean');
});

test('off-axis modulus and strength fall monotonically with angle up to 60 deg', () => {
  let pe = Infinity, ps = Infinity;
  for (const a of [0, 5, 10, 20, 30, 45, 60]) {
    const r = run('A1', { angle: a });
    assert.ok(r.Ex <= pe + 1e-9 && r.sigU <= ps + 1e-9, `angle ${a}`);
    pe = r.Ex; ps = r.sigU;
  }
  assert.ok(run('A1', { angle: 90 }).sigU < run('A1', { angle: 45 }).sigU);
});

test('environment: cold stiffens, hot-wet softens the matrix and lowers 0 deg strength', () => {
  const rtd = run('A1'), cold = run('E1'), hot = run('E2'), hw = run('E3');
  assert.ok(cold.mat.E > rtd.mat.E);
  assert.ok(hw.mat.E < rtd.mat.E);
  assert.ok(hw.sigU < rtd.sigU);
  assert.ok(hw.mat.TgWet < rtd.mat.TgWet);
  assert.ok(hot.sigU <= rtd.sigU + 1e-9);
  // 0 deg properties are fibre dominated: hot-wet loses well under 25 %
  assert.ok(hw.sigU > 0.75 * rtd.sigU);
});

test('neat resins return roughly datasheet values', () => {
  between(run('D1').Echord, 2.8, 3.3, 'epoxy E'); between(run('D1').sigU, 55, 80, 'epoxy strength');
  between(run('D3').Echord, 0.8, 1.6, 'PP E'); between(run('D3').sigU, 20, 40, 'PP strength');
  assert.equal(run('D3').modeKey, 'ductile');
});

test('glass/polyester shows a matrix-cracking knee; carbon/epoxy is linear', () => {
  const gp = run('C2'); assert.ok(gp.lamina.matrixCracks);
  const a1 = run('A1'); assert.ok(!a1.lamina.matrixCracks);
  const c = a1.curve.points; const mid = c[Math.floor(c.length / 2)];
  assert.ok(Math.abs(mid.sig / mid.eps / 1000 - a1.Ex) / a1.Ex < 1e-6);
});

test('hot press polymer, machine kinematics and load checks', () => {
  const r = run('A1');
  between(r.Fmax, 20, 45, 'peak load kN');
  between(r.duration, 60, 600, 'duration s');
  const k = TM.strainAtCrosshead(r, r.dCross + 1);
  assert.ok(k.failed);
  const mid = TM.strainAtCrosshead(r, 0.5 * r.dCross);
  assert.ok(!mid.failed && mid.eps > 0 && mid.eps < r.epsU);
  const small = run('A1', { capacity: 10 });
  assert.ok(small.warnings.some((w) => w.level === 'bad' && /load cell/.test(w.text)));
});

test('Monte Carlo is reproducible and statistically sane', () => {
  const r = run('A1');
  const a = TM.simulate(r), b = TM.simulate(r);
  assert.deepStrictEqual(a.rows, b.rows);
  assert.equal(a.rows.length, 6);
  const big = TM.simulate(TM.compute(Object.assign({}, preset('A1'), { nspec: 30, seed: 3 })));
  between(big.stats.sigma.mean / r.sigU, 0.9, 1.1, 'mean strength ratio');
  between(big.stats.E.mean / r.Echord, 0.95, 1.05, 'mean modulus ratio');
  assert.ok(Math.abs(TM.tCrit(5) - 2.571) < 1e-9);
});

test('inputs are clamped and never produce NaN', () => {
  const r = TM.compute({ vf: 500, angle: -3, thickness: 0, width: 'x', temp: 1e6, rh: 1e3, speed: 0, matrix: 'nope', fibre: 'nope' });
  for (const k of ['Echord', 'sigU', 'epsU', 'Fmax', 'duration', 'rhoC']) assert.ok(Number.isFinite(r[k]), k);
});
