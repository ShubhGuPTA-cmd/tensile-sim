/* UI for the composite tensile test simulator. Depends on TensileModel (model.js). */
(function () {
  'use strict';
  const TM = window.TensileModel;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ------------------------------------------------------------- state */
  let S = Object.assign({}, TM.DEFAULTS, TM.PRESETS[0].v);
  let res, sim;
  const run = { state: 'idle', u: 0, eps: 0, simT: 0, last: 0, relax: 0, relaxT: 0, raf: 0, peakF: 0, overloadEps: 0 };
  let tab = 'ss';

  const MATRIX_COLOR = { epoxy: '#d9a84a', polyester: '#cdb67f', vinylester: '#bf9468', pp: '#eceae2', pa6: '#efe3c2' };

  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const fmtE = (v) => fmt(v, v < 10 ? 2 : 1);
  const fmtS = (v) => fmt(v, v >= 100 ? 0 : 1);
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ------------------------------------------------------------ set-up */
  function fillSelect(el, obj, labelFn) {
    el.innerHTML = '';
    for (const k of Object.keys(obj)) { const o = document.createElement('option'); o.value = k; o.textContent = labelFn(obj[k]); el.appendChild(o); }
  }
  fillSelect($('matrix'), TM.MATRICES, (m) => `${m.name} (${m.cls.toLowerCase()})`);
  fillSelect($('fibre'), TM.FIBRES, (f) => f.name);
  fillSelect($('process'), TM.PROCESSES, (p) => p.name);
  (function () {
    const sel = $('preset');
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Custom'; sel.appendChild(custom);
    for (const p of TM.PRESETS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; sel.appendChild(o); }
  })();

  const inputEls = Array.from(document.querySelectorAll('[data-in]'));
  const keyOf = (el) => el.dataset.in || el.id;

  function syncInputs() {
    for (const el of inputEls) {
      const k = keyOf(el);
      if (document.activeElement === el && el.type === 'number') continue;
      el.value = S[k];
    }
    const neat = +S.vf === 0;
    for (const id of ['fibre', 'angle', 'angle_n', 'process']) $(id).disabled = neat;
    document.querySelectorAll('#envChips button').forEach((b) => {
      const [t, r] = b.dataset.env.split(',').map(Number);
      b.classList.toggle('on', +S.temp === t && +S.rh === r);
    });
  }

  inputEls.forEach((el) => {
    el.addEventListener('input', () => {
      const k = keyOf(el);
      const v = el.tagName === 'SELECT' && isNaN(parseFloat(el.value)) ? el.value : parseFloat(el.value);
      if (typeof v === 'number' && Number.isNaN(v)) return;
      S[k] = v;
      if (k === 'process') S.voids = TM.PROCESSES[S.process].voids;
      $('preset').value = 'custom';
      syncInputs();
      update();
    });
  });

  $('preset').addEventListener('change', () => {
    const p = TM.PRESETS.find((x) => x.id === $('preset').value);
    if (!p) return;
    loadPreset(p);
  });
  function loadPreset(p) {
    S = Object.assign({}, TM.DEFAULTS, p.v, { nspec: S.nspec, seed: S.seed });
    $('preset').value = p.id;
    syncInputs();
    update();
  }

  document.querySelectorAll('#envChips button').forEach((b) =>
    b.addEventListener('click', () => {
      const [t, r] = b.dataset.env.split(',').map(Number);
      S.temp = t; S.rh = r; $('preset').value = 'custom'; syncInputs(); update();
    }));

  /* lay-up calculator */
  function layVf() {
    const n = +$('lay_n').value, faw = +$('lay_faw').value;
    const rho = TM.FIBRES[S.fibre].rho, t = +S.thickness;
    return (100 * n * faw) / (rho * 1000 * t);
  }
  function refreshLay() {
    const v = layVf();
    $('layOut').textContent = Number.isFinite(v) ? `Vf = ${v.toFixed(1)} %` : '';
  }
  ['lay_n', 'lay_faw'].forEach((id) => $(id).addEventListener('input', refreshLay));
  $('layApply').addEventListener('click', () => {
    const v = layVf();
    if (!Number.isFinite(v)) return;
    S.vf = clamp(Math.round(v * 10) / 10, 0, 80); $('preset').value = 'custom'; syncInputs(); update();
  });

  /* tabs */
  function setTab(t) {
    tab = t;
    ['SS', 'LD', 'SW'].forEach((k) => { const b = $('tab' + k); const on = k.toLowerCase() === (t === 'ss' ? 'ss' : t === 'ld' ? 'ld' : 'sw'); b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('sweepCtl').hidden = t !== 'sw';
    $('scatterWrap').hidden = t === 'sw';
    drawChart();
  }
  $('tabSS').addEventListener('click', () => setTab('ss'));
  $('tabLD').addEventListener('click', () => setTab('ld'));
  $('tabSW').addEventListener('click', () => setTab('sw'));
  $('scatter').addEventListener('change', drawChart);
  $('sweepVar').addEventListener('change', drawChart);
  window.addEventListener('resize', () => { drawChart(); });

  /* ------------------------------------------------------------- update */
  function update() {
    stopLoop();
    res = TM.compute(S);
    sim = TM.simulate(res);
    resetMachine(true);
    renderStatic();
    drawChart();
  }

  function renderStatic() {
    const m = res.m, f = res.f, st = sim.stats;
    $('matrixInfo').textContent = `E ${m.E} GPa · strength ${m.sigma} MPa · failure strain ${(m.eps * 100).toFixed(m.eps < 0.1 ? 1 : 0)} % · ρ ${m.rho} g/cm³ · Tg ${m.Tg} °C${m.Tm ? ' · Tm ' + m.Tm + ' °C' : ''}`;
    $('fibreInfo').textContent = `E ${f.E} GPa · strength ${f.sigma} MPa · failure strain ${((f.sigma / f.E) / 10).toFixed(1)} % · ρ ${f.rho} g/cm³`;
    $('wfOut').textContent = res.neat ? '0 %' : `${(100 * res.Wf).toFixed(1)} %`;
    $('rhoOut').textContent = `${res.rhoC.toFixed(2)} g/cm³`;
    $('lenOut').textContent = `${(+S.gauge + 2 * +S.tab).toFixed(0)} mm`;
    $('areaOut').textContent = `${res.area.toFixed(1)} mm²`;
    refreshLay();

    // key cards
    const n = res.inp.nspec;
    const ciNote = (s, f) => (n > 1 ? `${n} specimens: ${f(s.mean)} ± ${f(s.ci)} (95 % CI)` : 'single specimen');
    $('kE').textContent = fmtE(res.Echord);
    $('kEsub').textContent = ciNote(st.E, fmtE) + ' · ' + chordLabel();
    $('kS').textContent = fmtS(res.sigU);
    $('kSsub').textContent = ciNote(st.sigma, fmtS) + ` · CV ${st.sigma.cv.toFixed(1)} %`;
    $('kEps').textContent = fmt(res.epsU * 100, res.epsU < 0.1 ? 2 : 1);
    $('kEpsSub').textContent = ciNote(st.eps, (v) => fmt(v, res.epsU < 0.1 ? 2 : 1));
    $('nOut').textContent = n;

    // table
    const L = res.lamina;
    const rows = [];
    const sec = (t) => rows.push(`<tr class="sec"><td colspan="2">${t}</td></tr>`);
    const row = (a, b, unit, note) => rows.push(`<tr><td>${a}${note ? ` <small>${note}</small>` : ''}</td><td>${b}${unit ? ' ' + unit : ''}</td></tr>`);
    sec('Tensile test results');
    row("Young's modulus (chord)", fmtE(res.Echord), 'GPa', chordLabel());
    row('Initial tangent modulus', fmtE(res.Eini), 'GPa');
    row('Maximum tensile strength', fmtS(res.sigU), 'MPa');
    row('Strain at failure', fmt(res.epsU * 100, 2), '%');
    row("Poisson's ratio", fmt(res.nuxy, 3), '', res.neat ? '' : 'νxy');
    row('Toughness (area under curve)', fmt(res.toughness, res.toughness < 10 ? 2 : 1), 'MJ/m³');
    row('Peak load', fmt(res.Fmax, 2), 'kN');
    row('Gauge elongation at failure', fmt(res.dGauge, 2), 'mm');
    row('Crosshead travel at failure', fmt(res.dCross, 2), 'mm', 'includes frame compliance');
    row('Test duration', mmss(res.duration), 'min:s');
    row('Tab bond shear stress', res.inp.tab > 0 ? fmt(res.tabShear, 1) : 'n/a', res.inp.tab > 0 ? 'MPa' : '');
    sec('Specific properties');
    row('Specific modulus E/ρ', fmt(res.specE, 1), 'MN·m/kg');
    row('Specific strength σ/ρ', fmt(res.specS, 0), 'kN·m/kg');
    if (!res.neat) {
      sec('Ply properties at these conditions (0° / 90° / shear)');
      row('E₁ (longitudinal)', fmtE(L.E1), 'GPa', `rule of mixtures ${fmtE(L.E1rom)} GPa`);
      row('E₂ (transverse)', fmtE(L.E2), 'GPa');
      row('G₁₂ (shear)', fmt(L.G12, 2), 'GPa');
      row('ν₁₂', fmt(L.nu12, 3), '');
      row('X (0° tensile strength)', fmtS(L.X), 'MPa', `ideal ${fmtS(Math.max(L.Xrom, 0))} MPa`);
      row('Y (90° tensile strength)', fmtS(L.Y), 'MPa');
      row('S (in-plane shear strength)', fmtS(L.S), 'MPa');
      row('Translation efficiency, stiffness / strength', `${(100 * res.effE).toFixed(0)} % / ${(100 * res.effS).toFixed(0)} %`, '');
    }
    sec('Material state');
    row('Composite density', fmt(res.rhoC, 3), 'g/cm³');
    row('Fibre weight fraction', res.neat ? '0' : fmt(100 * res.Wf, 1), '%');
    row('Effective void content', fmt(res.vEff, 1), '%');
    row('Matrix modulus retained vs 23 °C dry', fmt(100 * res.mat.ratio, 0), '%');
    row('Wet glass transition (stiffness softening)', fmt(res.mat.TgWet, 0), '°C');
    row('Moisture in matrix / in composite', `${fmt(res.mat.moist, 2)} / ${fmt(res.Mc, 2)}`, '%');
    $('outTable').innerHTML = rows.join('');
    $('modeBox').innerHTML = `<b>Expected failure mode:</b> ${res.mode}.`;
    $('notes').innerHTML = res.notes.map((t) => `<li>${t}</li>`).join('');

    // warnings
    const order = { bad: 0, warn: 1, info: 2 };
    $('warnings').innerHTML = res.warnings.slice().sort((a, b) => order[a.level] - order[b.level]).map((w) => `<li class="${w.level}">${w.text}</li>`).join('');

    // specimens
    const head = '<thead><tr><th>#</th><th>Strength (MPa)</th><th>Modulus (GPa)</th><th>Strain at failure (%)</th><th>Peak load (kN)</th></tr></thead>';
    const body = sim.rows.map((r) => `<tr><td>${r.id}</td><td>${fmtS(r.sigma)}</td><td>${fmtE(r.E)}</td><td>${fmt(r.eps * 100, 2)}</td><td>${fmt(r.Fmax, 2)}</td></tr>`).join('');
    const sr = (lbl, f) => `<tr class="stat"><td>${lbl}</td><td>${f(st.sigma)}</td><td>${f(st.E)}</td><td>${f(st.eps)}</td><td>${f(st.Fmax)}</td></tr>`;
    $('specTable').innerHTML = head + `<tbody>${body}</tbody><tfoot>` +
      sr('Mean', (s) => fmt(s.mean, s.mean >= 100 ? 0 : 2)) + sr('Std. dev.', (s) => fmt(s.sd, s.sd >= 100 ? 0 : 2)) +
      sr('CV (%)', (s) => fmt(s.cv, 1)) + sr('95 % CI (±)', (s) => (n > 1 ? fmt(s.ci, s.ci >= 100 ? 0 : 2) : '-')) + '</tfoot>';
    $('statNote').textContent = `Strength scatter: Weibull modulus m = ${sim.weibullM.toFixed(1)}; modulus scatter: CV ${(100 * sim.cvE).toFixed(1)} %. Confidence interval uses t(0.975, ${Math.max(1, n - 1)}) = ${n > 1 ? TM.tCrit(n - 1).toFixed(3) : '-'}. Change the seed to draw a new set of specimens.`;
  }

  function chordLabel() {
    const c = res.chord;
    return `chord ${(c.e1 * 100).toFixed(c.e1 * 100 < 0.1 ? 2 : 2)}–${(c.e2 * 100).toFixed(2)} % strain`;
  }

  /* ------------------------------------------------------- test control */
  function stopLoop() { if (run.raf) cancelAnimationFrame(run.raf); run.raf = 0; }

  function resetMachine(silent) {
    stopLoop();
    run.state = 'idle'; run.u = 0; run.eps = 0; run.simT = 0; run.relax = 0; run.peakF = 0;
    $('btnRun').disabled = false; $('btnRun').textContent = '▶ Run test';
    $('btnPause').disabled = true; $('btnPause').textContent = 'Pause';
    setStatus('Ready', '');
    readouts();
    drawMachine();
    if (!silent) drawChart();
  }

  function setStatus(t, cls) { const b = $('status'); b.textContent = t; b.className = 'badge' + (cls ? ' ' + cls : ''); }

  function stressNow() { return TM.stressAt(res.curve, run.eps); }

  function advanceTo(u) {
    const cap = res.inp.capacity;
    const k = TM.strainAtCrosshead(res, u);
    let eps = k.eps, failed = k.failed;
    const sig = TM.stressAt(res.curve, eps);
    const F = (sig * res.area) / 1000;
    if (F >= cap) {
      const sigCap = (cap * 1000) / res.area;
      eps = TM.epsAtSigma(res.curve, sigCap);
      run.eps = eps; run.u = eps * res.inp.gauge + cap / TM.K_FRAME; run.peakF = cap;
      run.state = 'overload'; run.relax = 1;
      return;
    }
    run.eps = eps; run.u = failed ? res.dCross : u; run.peakF = Math.max(run.peakF, F);
    if (failed) { run.state = 'failed'; run.relaxT = performance.now(); run.relax = 0; run.peakF = res.Fmax; }
  }

  function loop(now) {
    run.raf = 0;
    if (run.state === 'running') {
      const dt = Math.min(0.1, (now - run.last) / 1000);
      run.last = now;
      const pb = $('playback').value;
      const factor = pb === 'auto' ? Math.max(1, res.duration / 8) : +pb;
      run.simT += dt * factor;
      advanceTo((res.inp.speed / 60) * run.simT);
    }
    if (run.state === 'failed' && run.relax < 1) run.relax = clamp((now - run.relaxT) / 450, 0, 1);
    finishState();
    readouts(); drawMachine(); drawChart();
    if (run.state === 'running' || (run.state === 'failed' && run.relax < 1)) run.raf = requestAnimationFrame(loop);
  }

  function finishState() {
    if (run.state === 'failed') {
      setStatus(`Specimen failed at ${fmt(res.Fmax, 1)} kN`, 'fail');
      $('btnRun').disabled = false; $('btnRun').textContent = '↻ Run again'; $('btnPause').disabled = true;
    } else if (run.state === 'overload') {
      setStatus(`Overload: ${res.inp.capacity} kN load cell limit reached`, 'fail');
      $('btnRun').disabled = false; $('btnRun').textContent = '↻ Run again'; $('btnPause').disabled = true;
    }
  }

  $('btnRun').addEventListener('click', () => {
    if (run.state === 'failed' || run.state === 'overload') resetMachine(true);
    if (run.state === 'paused') { run.state = 'running'; }
    else if (run.state === 'idle') { run.state = 'running'; }
    run.last = performance.now();
    setStatus('Testing…', 'run');
    $('btnRun').disabled = true; $('btnPause').disabled = false; $('btnPause').textContent = 'Pause';
    stopLoop(); run.raf = requestAnimationFrame(loop);
  });
  $('btnPause').addEventListener('click', () => {
    if (run.state === 'running') {
      run.state = 'paused'; stopLoop(); setStatus('Paused', '');
      $('btnPause').textContent = 'Resume';
    } else if (run.state === 'paused') {
      run.state = 'running'; run.last = performance.now(); setStatus('Testing…', 'run');
      $('btnPause').textContent = 'Pause'; stopLoop(); run.raf = requestAnimationFrame(loop);
    }
  });
  $('btnReset').addEventListener('click', () => resetMachine(false));
  $('btnInstant').addEventListener('click', () => {
    stopLoop();
    run.state = 'running'; run.simT = 1e9; advanceTo(res.dCross + 1);
    if (run.state === 'running') run.state = 'failed';
    run.relax = 1; finishState(); readouts(); drawMachine(); drawChart();
  });

  function readouts() {
    const sig = run.state === 'failed' ? res.sigU : stressNow();
    const F = run.state === 'failed' ? res.Fmax : (sig * res.area) / 1000;
    $('roLoad').textContent = fmt(F, 2);
    $('roCross').textContent = fmt(run.u, 3);
    $('roStress').textContent = fmt(sig, 1);
    $('roStrain').textContent = fmt(run.eps * 100, 3);
    $('roTime').textContent = mmss(res.inp.speed > 0 ? (run.u / res.inp.speed) * 60 : 0);
  }

  /* ------------------------------------------------------ machine view */
  const CX = 190, YTOP = 230, TABV = 55, GV = 150, YBOT = 490;
  const hash = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

  function drawMachine() {
    const r = res, f = r.f;
    const failed = run.state === 'failed';
    const exag = clamp(26 / (r.epsU * GV), 1, 60);
    const D = Math.min(46, (failed ? r.epsU : run.eps) * GV * exag);
    $('exagNote').textContent = `Elongation is exaggerated ×${exag.toFixed(exag < 10 ? 1 : 0)} so it is visible.`;

    const neat = r.neat;
    const fill = neat ? MATRIX_COLOR[S.matrix] : f.color;
    const line = lum(fill) > 0.55 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.30)';
    const pat = $('fibrePat');
    pat.setAttribute('patternTransform', `rotate(${neat ? 0 : r.theta})`);
    pat.style.setProperty('--spec-fill', fill); pat.style.setProperty('--spec-line', line);
    pat.firstElementChild.setAttribute('fill', fill); pat.lastElementChild.setAttribute('stroke', line);

    const wv = clamp(10 + r.inp.width * 0.5, 12, 34);
    const frac = clamp(failed ? 1 : stressNow() / r.sigU, 0, 1);
    const x0 = CX - wv / 2;
    const yT = YTOP - D;
    const tabs = r.inp.tab > 0;
    const stressTint = failed ? 0 : 0.42 * Math.pow(frac, 3);
    const specFill = neat ? fill : 'url(#fibrePat)';
    let out = '';

    // chamber
    if (Math.abs(r.inp.temp - 23) > 3) {
      const hot = r.inp.temp > 23;
      const col = hot ? '#e5533d' : '#3d8fe5';
      out += `<rect x="86" y="196" width="208" height="306" rx="8" fill="${col}" fill-opacity="0.07" stroke="${col}" stroke-opacity="0.55" stroke-dasharray="5 4"/>`;
      out += `<text x="94" y="490" font-size="11" font-weight="600" fill="${col}">${hot ? '▲' : '▼'} ${r.inp.temp} °C · ${r.inp.rh} % RH</text>`;
    }

    // upper assembly (moves up by D)
    const u = -D;
    out += `<g transform="translate(0 ${u})">
      <rect x="44" y="144" width="292" height="36" rx="5" class="frame-dark"/>
      <rect x="168" y="180" width="44" height="26" rx="3" style="fill:#7a8697"/>
      <text x="190" y="197" text-anchor="middle" font-size="9" font-weight="700" fill="#10202f">${r.inp.capacity} kN</text>
      <path d="M160 206 H220 L214 250 H166 Z" class="grip-body"/>
    </g>`;
    // lower grip
    out += `<path d="M162 470 H218 L224 514 H156 Z" class="grip-body"/>`;

    // specimen
    const tabFill = 'fill="#9bb593" fill-opacity="0.92" stroke="#6e8a66" stroke-width="0.8"';
    if (!failed) {
      out += specBody(x0, wv, yT, YBOT, neat, specFill, r, frac, D);
      if (tabs) {
        out += `<rect x="${x0 - 1.5}" y="${yT}" width="${wv + 3}" height="${TABV}" ${tabFill}/>`;
        out += `<rect x="${x0 - 1.5}" y="${YBOT - TABV}" width="${wv + 3}" height="${TABV}" ${tabFill}/>`;
      }
      if (stressTint > 0) out += `<rect x="${x0}" y="${yT + TABV}" width="${wv}" height="${YBOT - TABV - yT - TABV}" fill="#e5533d" fill-opacity="${stressTint.toFixed(3)}"/>`;
    } else {
      out += fracturedSpecimen(x0, wv, yT, D, specFill, fill, line, tabs, tabFill, r);
    }

    // extensometer (removed near failure, like in a real test)
    if (!failed && run.state !== 'idle' ? frac < 0.9 : !failed) {
      const cy = (yT + TABV + (YBOT - TABV)) / 2;
      const y1 = cy - 34, y2 = cy + 34, xr = x0 + wv + 3;
      out += `<g stroke="#6b7685" stroke-width="1.2" fill="none"><rect x="${x0 - 4}" y="${y1 - 3}" width="${wv + 8}" height="6" rx="2" fill="#3b4656"/><rect x="${x0 - 4}" y="${y2 - 3}" width="${wv + 8}" height="6" rx="2" fill="#3b4656"/><path d="M${xr + 4} ${y1} H${xr + 18} V${y2} H${xr + 4}"/></g>`;
      out += `<text x="${xr + 22}" y="${cy + 3}" font-size="9.5" fill="${cssVar('--muted')}">extensometer</text>`;
    }

    // labels
    out += `<text x="${CX}" y="76" text-anchor="middle" font-size="11" fill="${cssVar('--muted')}">${neat ? 'neat ' + r.m.short : r.f.short + ' / ' + r.m.short + (r.theta > 0 ? ' · ' + r.theta + '°' : ' · 0°')}</text>`;
    if (run.state === 'overload') out += `<text x="${CX}" y="98" text-anchor="middle" font-size="13" font-weight="700" fill="#c0392b">LOAD CELL OVERLOAD</text>`;
    $('dyn').innerHTML = out;
  }

  function specBody(x0, wv, yT, yB, neat, fillAttr, r, frac, D) {
    if (!neat) return `<rect x="${x0}" y="${yT}" width="${wv}" height="${yB - yT}" fill="${fillAttr}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
    // dog-bone, with necking for ductile polymers
    const we = wv * 1.5, wg = wv * 0.78;
    const yc = (yT + 60 + yB - 60) / 2;
    const neck = r.modeKey === 'ductile' ? 0.65 * Math.pow(frac, 1.3) : 0;
    const pts = [];
    const gTop = yT + 48, gBot = yB - 48;
    const half = (y) => {
      if (y <= gTop - 14) return we / 2;
      if (y >= gBot + 14) return we / 2;
      if (y < gTop) return wg / 2 + (we / 2 - wg / 2) * ((gTop - y) / 14);
      if (y > gBot) return wg / 2 + (we / 2 - wg / 2) * ((y - gBot) / 14);
      return (wg / 2) * (1 - neck * Math.exp(-Math.pow((y - yc) / 24, 2)));
    };
    const ys = []; for (let y = yT; y <= yB; y += 4) ys.push(y); ys.push(yB);
    ys.forEach((y) => pts.push(`${(CX + half(y)).toFixed(1)},${y.toFixed(1)}`));
    ys.slice().reverse().forEach((y) => pts.push(`${(CX - half(y)).toFixed(1)},${y.toFixed(1)}`));
    return `<polygon points="${pts.join(' ')}" fill="${fillAttr}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
  }

  function fracturedSpecimen(x0, wv, yT, D, specFill, fill, line, tabs, tabFill, r) {
    const relax = run.relax;
    const mode = r.modeKey;
    const yb0 = (YTOP - D + TABV + (YBOT - TABV)) / 2;
    const endTop = yb0 - relax * (D / 2 + 10);
    const startBot = yb0 + relax * 10;
    const n = 8;
    const off = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (mode === 'angled') off.push((t - 0.5) * wv * 1.8);
      else if (mode === 'clean') off.push((hash(i) - 0.5) * 1.5);
      else if (mode === 'ductile') off.push(0);
      else off.push((hash(i + 3) - 0.5) * 9);
    }
    const xs = (i) => x0 + (wv * i) / n;
    const w2 = wv / 2;
    let top, bot;
    const neatEnds = r.neat;
    const we = wv * 1.5;
    if (mode === 'ductile') {
      const tip = 26 * relax;
      top = `M${x0} ${yT} H${x0 + wv} V${endTop - 18} L${CX + 2} ${endTop + tip} L${CX - 2} ${endTop + tip} L${x0} ${endTop - 18} Z`;
      bot = `M${x0} ${YBOT} H${x0 + wv} V${startBot + 18} L${CX + 2} ${startBot - tip} L${CX - 2} ${startBot - tip} L${x0} ${startBot + 18} Z`;
    } else {
      let tp = `M${x0} ${yT} H${x0 + wv}`;
      for (let i = n; i >= 0; i--) tp += ` L${xs(i).toFixed(1)} ${(endTop + off[i]).toFixed(1)}`;
      top = tp + ' Z';
      let bp = `M${x0} ${YBOT} H${x0 + wv}`;
      for (let i = n; i >= 0; i--) bp += ` L${xs(i).toFixed(1)} ${(startBot + off[i]).toFixed(1)}`;
      bot = bp + ' Z';
    }
    let out = `<path d="${top}" fill="${specFill}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/><path d="${bot}" fill="${specFill}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
    if (neatEnds) {
      // dog-bone halves, clipped at the break, with drawn-out tips for ductile polymers
      const body = specBody(x0, wv, YTOP - D, YBOT, true, specFill, r, 1, D);
      out = `<clipPath id="clipT"><rect x="0" y="0" width="380" height="${(endTop).toFixed(1)}"/></clipPath><clipPath id="clipB"><rect x="0" y="${startBot.toFixed(1)}" width="380" height="600"/></clipPath>` +
        `<g clip-path="url(#clipT)">${body}</g><g clip-path="url(#clipB)">${body}</g>`;
      if (mode === 'ductile') {
        const tip = 26 * relax, tw = wv * 0.14;
        out += `<polygon points="${CX - tw},${endTop} ${CX + tw},${endTop} ${CX},${endTop + tip}" fill="${specFill}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
        out += `<polygon points="${CX - tw},${startBot} ${CX + tw},${startBot} ${CX},${startBot - tip}" fill="${specFill}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
      }
    }
    if (tabs) {
      out += `<rect x="${x0 - 1.5}" y="${yT}" width="${wv + 3}" height="${TABV}" ${tabFill}/>`;
      out += `<rect x="${x0 - 1.5}" y="${YBOT - TABV}" width="${wv + 3}" height="${TABV}" ${tabFill}/>`;
    }
    if (mode === 'brush' || mode === 'split') {
      const len = mode === 'brush' ? 16 : 8;
      for (let k = 0; k < 11; k++) {
        const x = x0 + ((k + 0.5) * wv) / 11, h1 = hash(k + 20), h2 = hash(k + 40);
        const dx = (h2 - 0.5) * 16 * relax;
        out += `<line x1="${x.toFixed(1)}" y1="${(endTop + off[Math.round((k / 10) * n)]).toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(endTop + off[Math.round((k / 10) * n)] + (6 + h1 * len) * relax).toFixed(1)}" stroke="${line.includes('255') ? '#c9d1db' : '#444'}" stroke-width="1"/>`;
        out += `<line x1="${x.toFixed(1)}" y1="${(startBot + off[Math.round((k / 10) * n)]).toFixed(1)}" x2="${(x - dx).toFixed(1)}" y2="${(startBot + off[Math.round((k / 10) * n)] - (6 + h2 * len) * relax).toFixed(1)}" stroke="${line.includes('255') ? '#c9d1db' : '#444'}" stroke-width="1"/>`;
      }
    }
    if (mode === 'split') {
      out += `<line x1="${CX - 2}" y1="${(endTop - 40).toFixed(1)}" x2="${CX - 2}" y2="${endTop.toFixed(1)}" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>`;
      out += `<line x1="${CX + 3}" y1="${(startBot + 36).toFixed(1)}" x2="${CX + 3}" y2="${startBot.toFixed(1)}" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>`;
    }
    return out;
  }

  /* ------------------------------------------------------------ charts */
  function niceStep(range, count) {
    const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  function niceTicks(min, max, count) {
    const step = niceStep(max - min || 1, count);
    const t = []; for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(10));
    return { step, ticks: t };
  }
  function niceMax(v) { const s = niceStep(v, 5); return Math.ceil(v / s - 1e-9) * s; }

  function setupCanvas() {
    const c = $('chart');
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(300, Math.round(rect.width)), H = Math.round(W * 380 / 720);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  function frame(ctx, W, H, o) {
    const col = { grid: cssVar('--chart-grid'), axis: cssVar('--chart-axis'), ink: cssVar('--ink'), muted: cssVar('--muted') };
    const L = 58, R = o.y2 ? 58 : 18, T = 22, B = 44;
    const px = (x) => L + ((x - o.xmin) / (o.xmax - o.xmin)) * (W - L - R);
    const py = (y) => H - B - ((y - o.ymin) / (o.ymax - o.ymin)) * (H - T - B);
    const py2 = o.y2 ? (y) => H - B - ((y - o.y2.min) / (o.y2.max - o.y2.min)) * (H - T - B) : null;
    ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1;
    const xt = niceTicks(o.xmin, o.xmax, 7), yt = niceTicks(o.ymin, o.ymax, 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.ticks.forEach((v) => { ctx.strokeStyle = col.grid; ctx.beginPath(); ctx.moveTo(L, py(v)); ctx.lineTo(W - R, py(v)); ctx.stroke(); ctx.fillStyle = col.muted; ctx.fillText(+v.toPrecision(6), L - 6, py(v)); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.ticks.forEach((v) => { ctx.strokeStyle = col.grid; ctx.beginPath(); ctx.moveTo(px(v), T); ctx.lineTo(px(v), H - B); ctx.stroke(); ctx.fillStyle = col.muted; ctx.fillText(+v.toPrecision(6), px(v), H - B + 6); });
    if (o.y2) {
      const y2t = niceTicks(o.y2.min, o.y2.max, 6);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      y2t.ticks.forEach((v) => { ctx.fillStyle = o.y2.color; ctx.fillText(+v.toPrecision(6), W - R + 6, py2(v)); });
    }
    ctx.strokeStyle = col.axis; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H - B); ctx.lineTo(W - R, H - B); ctx.stroke();
    ctx.fillStyle = col.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(o.xlabel, (L + W - R) / 2, H - 8);
    ctx.save(); ctx.translate(14, (T + H - B) / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = o.ycolor || col.ink; ctx.fillText(o.ylabel, 0, 0); ctx.restore();
    if (o.y2) { ctx.save(); ctx.translate(W - 12, (T + H - B) / 2); ctx.rotate(Math.PI / 2); ctx.fillStyle = o.y2.color; ctx.fillText(o.y2.label, 0, 0); ctx.restore(); }
    return { px, py, py2, L, R, T, B, col };
  }

  function path(ctx, pts, px, py) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
    ctx.stroke();
  }

  // nominal curve in chart units for the SS and LD views
  const toSS = (pts) => pts.map((p) => [p.eps * 100, p.sig]);
  const toLD = (pts) => pts.map((p) => [p.eps * res.inp.gauge + (p.sig * res.area) / 1000 / TM.K_FRAME, (p.sig * res.area) / 1000]);

  function drawChart() {
    if (!res) return;
    const { ctx, W, H } = setupCanvas();
    if (tab === 'sw') return drawSweep(ctx, W, H);
    const ld = tab === 'ld';
    const c1 = cssVar('--c1'), c2 = cssVar('--c2');
    const nominal = ld ? toLD(res.curve.points) : toSS(res.curve.points);
    const showScatter = $('scatter').checked && (run.state === 'idle' || run.state === 'failed') && sim.rows.length > 1;

    // axis ranges
    let xmax = nominal[nominal.length - 1][0], ymax = nominal[nominal.length - 1][1];
    const scCurves = [];
    if (showScatter) {
      sim.rows.forEach((row) => {
        const kS = row.sigma / res.sigU, kE = res.Echord / row.E;
        const pts = res.curve.points.map((p) => ({ eps: p.eps * kS * kE, sig: p.sig * kS }));
        const cv = ld ? toLD(pts) : toSS(pts);
        scCurves.push(cv);
        xmax = Math.max(xmax, cv[cv.length - 1][0]); ymax = Math.max(ymax, cv[cv.length - 1][1]);
      });
    }
    const X = niceMax(xmax * 1.06), Y = niceMax(ymax * 1.08);
    const f = frame(ctx, W, H, ld ? { xmin: 0, xmax: X, ymin: 0, ymax: Y, xlabel: 'Crosshead displacement (mm)', ylabel: 'Load (kN)' } : { xmin: 0, xmax: X, ymin: 0, ymax: Y, xlabel: 'Strain (%)', ylabel: 'Stress (MPa)' });
    const { px, py } = f;

    if (showScatter) {
      ctx.strokeStyle = c1; ctx.globalAlpha = 0.28; ctx.lineWidth = 1.2;
      scCurves.forEach((cv) => { path(ctx, cv, px, py); const e = cv[cv.length - 1]; ctx.beginPath(); ctx.moveTo(px(e[0]), py(e[1])); ctx.lineTo(px(e[0]), py(0)); ctx.stroke(); });
      ctx.globalAlpha = 1;
    }

    // nominal (ghost when running)
    const started = run.state !== 'idle';
    ctx.lineWidth = 1.5; ctx.strokeStyle = f.col.axis; ctx.setLineDash(started ? [5, 4] : []);
    if (!started) ctx.strokeStyle = c1;
    ctx.lineWidth = started ? 1.2 : 2.2;
    path(ctx, nominal, px, py);
    ctx.setLineDash([]);

    // live portion
    if (started) {
      const live = [];
      const pts = res.curve.points;
      const lim = run.state === 'failed' ? Infinity : run.eps;
      for (const p of pts) { if (p.eps > lim) break; live.push(p); }
      if (run.state !== 'failed') live.push({ eps: run.eps, sig: TM.stressAt(res.curve, run.eps) });
      ctx.strokeStyle = c1; ctx.lineWidth = 2.6;
      path(ctx, ld ? toLD(live) : toSS(live), px, py);
      const last = (ld ? toLD(live) : toSS(live)).slice(-1)[0];
      if (last) { ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(px(last[0]), py(last[1]), 4, 0, 6.2832); ctx.fill(); }
    }

    // failure drop and UTS marker
    const end = nominal[nominal.length - 1];
    if (run.state === 'failed' || run.state === 'idle') {
      ctx.strokeStyle = c2; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px(end[0]), py(end[1])); ctx.lineTo(px(end[0]), py(0)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(px(end[0]), py(end[1]), 4.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = f.col.ink; ctx.textBaseline = 'alphabetic';
      const label = ld ? `Peak ${res.Fmax.toFixed(1)} kN` : `σu ${fmtS(res.sigU)} MPa · εf ${(res.epsU * 100).toFixed(2)} %`;
      const right = px(end[0]) > W * 0.6;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(label, px(end[0]) + (right ? -10 : 10), Math.max(py(end[1]) - 10, f.T + 12));
    }

    // chord marker (stress-strain view)
    if (!ld) {
      const { e1, e2 } = res.chord;
      const s1 = TM.stressAt(res.curve, e1), s2 = TM.stressAt(res.curve, e2);
      ctx.strokeStyle = c2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(px(e1 * 100), py(s1)); ctx.lineTo(px(e2 * 100), py(s2)); ctx.stroke();
      ctx.fillStyle = c2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`E = ${fmtE(res.Echord)} GPa (chord)`, px(e2 * 100) + 8, py(s2) + 14);
    }
  }

  const sweepCache = { key: '', data: null };
  function drawSweep(ctx, W, H) {
    const v = $('sweepVar').value;
    const cfg = {
      vf: { lo: 0, hi: 70, label: 'Fibre volume fraction (%)', key: 'vf' },
      angle: { lo: 0, hi: 90, label: 'Fibre angle to load (deg)', key: 'angle' },
      temp: { lo: -60, hi: 200, label: 'Temperature (°C)', key: 'temp' },
      rh: { lo: 0, hi: 100, label: 'Humidity conditioning (% RH)', key: 'rh' },
      voids: { lo: 0, hi: 8, label: 'Void content (%)', key: 'voids' },
    }[v];
    const ck = JSON.stringify([S, v]);
    if (sweepCache.key !== ck) { sweepCache.key = ck; sweepCache.data = TM.sweep(S, cfg.key, cfg.lo, cfg.hi, 70); }
    const d = sweepCache.data;
    const c1 = cssVar('--c1'), c2 = cssVar('--c2');
    const showRom = v === 'vf';
    const Emax = niceMax(Math.max(...d.map((p) => Math.max(p.E, showRom ? p.Erom : 0))) * 1.08);
    const Smax = niceMax(Math.max(...d.map((p) => Math.max(p.sigma, showRom ? p.Xrom : 0))) * 1.08);
    const f = frame(ctx, W, H, { xmin: cfg.lo, xmax: cfg.hi, ymin: 0, ymax: Emax, xlabel: cfg.label, ylabel: "Young's modulus (GPa)", ycolor: c1, y2: { min: 0, max: Smax, label: 'Tensile strength (MPa)', color: c2 } });
    const sx = (x) => f.px(x), sE = (y) => f.py(y), sS = (y) => H - f.B - (y / Smax) * (H - f.T - f.B);
    const draw = (key, mapY, color, dash, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath(); d.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), mapY(p[key])) : ctx.moveTo(sx(p.x), mapY(p[key])))); ctx.stroke(); ctx.setLineDash([]); };
    if (showRom) { draw('Erom', sE, c1, [5, 4], 1.2); draw('Xrom', sS, c2, [5, 4], 1.2); }
    draw('E', sE, c1, [], 2.4); draw('sigma', sS, c2, [], 2.4);
    // current marker
    const cur = +S[cfg.key];
    if (cur >= cfg.lo && cur <= cfg.hi) {
      ctx.strokeStyle = f.col.axis; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(cur), f.T); ctx.lineTo(sx(cur), H - f.B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(sx(cur), sE(res.Echord), 4.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(sx(cur), sS(res.sigU), 4.5, 0, 6.2832); ctx.fill();
    }
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = f.col.muted;
    ctx.fillText(showRom ? 'Solid: simulated. Dashed: ideal rule of mixtures. Dot: current setting.' : 'Dots mark the current setting; other inputs held constant.', f.L + 6, f.T + 12);
  }

  /* ------------------------------------------------------------- export */
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('dlSpec').addEventListener('click', () => {
    const head = 'specimen,strength_MPa,modulus_GPa,strain_at_failure_pct,peak_load_kN';
    const rows = sim.rows.map((r) => [r.id, r.sigma.toFixed(2), r.E.toFixed(3), (r.eps * 100).toFixed(4), r.Fmax.toFixed(3)].join(','));
    download('simulated_specimens.csv', [head, ...rows].join('\n') + '\n');
  });
  $('dlCurve').addEventListener('click', () => {
    const head = 'strain_pct,stress_MPa,load_kN,crosshead_mm';
    const rows = res.curve.points.map((p) => [(p.eps * 100).toFixed(5), p.sig.toFixed(3), ((p.sig * res.area) / 1000).toFixed(4), (p.eps * res.inp.gauge + (p.sig * res.area) / 1000 / TM.K_FRAME).toFixed(4)].join(','));
    download('stress_strain_curve.csv', [head, ...rows].join('\n') + '\n');
  });

  /* -------------------------------------------------------------- start */
  const q = new URLSearchParams(location.search).get('preset');
  const start = TM.PRESETS.find((p) => p.id === q) || TM.PRESETS[0];
  window.__sim = { get res() { return res; }, get run() { return run; }, setTab, loadPreset };
  loadPreset(start);
})();
