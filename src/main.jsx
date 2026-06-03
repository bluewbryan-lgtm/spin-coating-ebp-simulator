import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const RHO = 1000; // kg/m^3, representative PR solution density
const EPS = 1e-12;

function rpmToRadPerSec(rpm) {
  return (2 * Math.PI * rpm) / 60;
}

function spinRateConstant(rpm, eta) {
  const omega = rpmToRadPerSec(rpm);
  return (2 * RHO * omega * omega) / (3 * Math.max(eta, EPS));
}

function hAnalyticalEBP(t, h0Meters, rpm, eta0) {
  const k = spinRateConstant(rpm, eta0);
  return h0Meters / Math.sqrt(1 + 2 * k * h0Meters * h0Meters * t);
}

function runOde(params, forceConstantEta = false, forceNoEvaporation = false) {
  const {
    rpm,
    eta0,
    h0Micron,
    evapMicronPerSec,
    kEta,
    totalTime,
    steps,
  } = params;

  let h = h0Micron * 1e-6;
  const dt = totalTime / steps;
  const data = [];

  for (let n = 0; n <= steps; n += 1) {
    const t = n * dt;
    const eta = forceConstantEta ? eta0 : eta0 * Math.exp(kEta * t);
    const k = spinRateConstant(rpm, eta);
    const e = forceNoEvaporation ? 0 : evapMicronPerSec * 1e-6;
    const spinLoss = k * Math.pow(Math.max(h, 0), 3);
    data.push({
      t,
      hMicron: Math.max(h, 0) * 1e6,
      eta,
      spinLossMicronPerSec: spinLoss * 1e6,
      evapLossMicronPerSec: e * 1e6,
    });
    h = Math.max(h - (spinLoss + e) * dt, 0);
  }
  return data;
}

function initialRadialProfile(params, N) {
  const R = params.radiusMm / 1000;
  const h0 = params.h0Micron * 1e-6;
  const amp = params.edgeAmpPercent / 100;
  const width = Math.max(params.edgeWidthMm / 1000, 1e-6);
  const dr = R / N;

  return Array.from({ length: N }, (_, i) => {
    const r = (i + 0.5) * dr;
    const bead = amp * Math.exp(-Math.pow((R - r) / width, 2));
    return h0 * (1 + bead);
  });
}

function runRadial(params, profileSteps = 360) {
  const N = params.gridCells;
  const R = params.radiusMm / 1000;
  const dr = R / N;
  const dt = params.totalTime / profileSteps;
  let h = initialRadialProfile(params, N);
  const snapshots = [];

  for (let n = 0; n <= profileSteps; n += 1) {
    const t = n * dt;
    if (n % Math.max(1, Math.floor(profileSteps / 60)) === 0 || n === profileSteps) {
      snapshots.push({
        t,
        profile: h.map((value, i) => ({
          rNorm: ((i + 0.5) * dr) / R,
          hMicron: value * 1e6,
        })),
      });
    }

    if (n === profileSteps) break;

    const eta = params.eta0 * Math.exp(params.kEta * t);
    const omega = rpmToRadPerSec(params.rpm);
    const evap = params.evapMicronPerSec * 1e-6;
    const flux = new Array(N + 1).fill(0);

    for (let j = 1; j <= N; j += 1) {
      const rFace = j * dr;
      const hFace = j === N ? h[N - 1] : 0.5 * (h[j - 1] + h[j]);
      flux[j] = (RHO * omega * omega * rFace * Math.pow(Math.max(hFace, 0), 3)) / (3 * Math.max(eta, EPS));
    }
    flux[0] = 0;

    h = h.map((value, i) => {
      const rW = i * dr;
      const rE = (i + 1) * dr;
      const areaWeight = 0.5 * (rE * rE - rW * rW);
      const divergence = (rE * flux[i + 1] - rW * flux[i]) / Math.max(areaWeight, EPS);
      return Math.max(value - (divergence + evap) * dt, 0);
    });
  }

  const finalProfile = h.map((value, i) => ({
    rNorm: ((i + 0.5) * dr) / R,
    hMicron: value * 1e6,
  }));
  const mean = areaWeightedMean(finalProfile);
  const uniformity = maxDeviationPercent(finalProfile, mean);
  return { snapshots, finalProfile, mean, uniformity };
}

function areaWeightedMean(profile) {
  let weighted = 0;
  let weights = 0;
  for (const point of profile) {
    const w = Math.max(point.rNorm, EPS);
    weighted += point.hMicron * w;
    weights += w;
  }
  return weighted / weights;
}

function maxDeviationPercent(profile, mean) {
  return Math.max(...profile.map((p) => Math.abs((p.hMicron - mean) / Math.max(mean, EPS)))) * 100;
}

function estimateGelTime(params) {
  if (params.kEta <= 0) return Infinity;
  return Math.log(params.etaGel / params.eta0) / params.kEta;
}

function computeValidation(params) {
  const validationParams = {
    ...params,
    evapMicronPerSec: 0,
    kEta: 0,
    totalTime: Math.min(params.totalTime, 60),
    steps: 500,
  };
  const numerical = runOde(validationParams, true, true);
  const h0 = params.h0Micron * 1e-6;
  const compared = numerical.map((p) => {
    const exact = hAnalyticalEBP(p.t, h0, params.rpm, params.eta0) * 1e6;
    const error = Math.abs((p.hMicron - exact) / Math.max(exact, EPS)) * 100;
    return { ...p, exactMicron: exact, error };
  });
  const maxError = Math.max(...compared.map((p) => p.error));
  return { compared, maxError };
}

function createDesignMap(params) {
  const rpms = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
  const etas = [0.04, 0.06, 0.08, 0.10, 0.125, 0.15, 0.175, 0.20, 0.225, 0.25];
  const rows = etas.slice().reverse().map((eta0) => {
    return rpms.map((rpm) => {
      const result = runRadial({ ...params, rpm, eta0, gridCells: 36 }, 180);
      return {
        rpm,
        eta0,
        uniformity: result.uniformity,
        pass: result.uniformity <= params.uniformitySpecPercent,
      };
    });
  });
  return { rpms, etas: etas.slice().reverse(), rows };
}

function linePath(data, xKey, yKey, width, height, padding, yMin = null, yMax = null) {
  if (!data.length) return '';
  const xMin = Math.min(...data.map((d) => d[xKey]));
  const xMax = Math.max(...data.map((d) => d[xKey]));
  const computedYMin = yMin ?? Math.min(...data.map((d) => d[yKey]));
  const computedYMax = yMax ?? Math.max(...data.map((d) => d[yKey]));
  return data
    .map((d, i) => {
      const x = padding + ((d[xKey] - xMin) / Math.max(xMax - xMin, EPS)) * (width - 2 * padding);
      const y = height - padding - ((d[yKey] - computedYMin) / Math.max(computedYMax - computedYMin, EPS)) * (height - 2 * padding);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function AxisLabels({ xLabel, yLabel }) {
  return (
    <>
      <text x="50%" y="288" textAnchor="middle" className="axis-label">{xLabel}</text>
      <text x="16" y="145" textAnchor="middle" transform="rotate(-90 16 145)" className="axis-label">{yLabel}</text>
    </>
  );
}

function ChartFrame({ children, xLabel, yLabel }) {
  return (
    <svg className="chart" viewBox="0 0 520 310" role="img">
      <rect x="0" y="0" width="520" height="310" rx="18" className="chart-bg" />
      <line x1="52" y1="252" x2="492" y2="252" className="axis" />
      <line x1="52" y1="32" x2="52" y2="252" className="axis" />
      <line x1="52" y1="197" x2="492" y2="197" className="grid" />
      <line x1="52" y1="142" x2="492" y2="142" className="grid" />
      <line x1="52" y1="87" x2="492" y2="87" className="grid" />
      {children}
      <AxisLabels xLabel={xLabel} yLabel={yLabel} />
    </svg>
  );
}

function ThicknessChart({ odeData }) {
  const yMax = Math.max(...odeData.map((d) => d.hMicron)) * 1.05;
  const path = linePath(odeData, 't', 'hMicron', 520, 310, 52, 0, yMax);
  const last = odeData[odeData.length - 1];
  return (
    <div>
      <ChartFrame xLabel="Time (s)" yLabel="Thickness (µm)">
        <path d={path} className="line primary" />
        <text x="390" y="48" className="chart-note">Final: {last.hMicron.toFixed(2)} µm</text>
      </ChartFrame>
    </div>
  );
}

function RateChart({ odeData }) {
  const merged = odeData.map((d) => ({ ...d, total: d.spinLossMicronPerSec + d.evapLossMicronPerSec }));
  const yMax = Math.max(...merged.map((d) => d.total)) * 1.05;
  const pathSpin = linePath(merged, 't', 'spinLossMicronPerSec', 520, 310, 52, 0, yMax);
  const pathEvap = linePath(merged, 't', 'evapLossMicronPerSec', 520, 310, 52, 0, yMax);
  return (
    <ChartFrame xLabel="Time (s)" yLabel="Thinning rate (µm/s)">
      <path d={pathSpin} className="line primary" />
      <path d={pathEvap} className="line secondary" />
      <text x="360" y="48" className="chart-note">spin</text>
      <text x="410" y="70" className="chart-note secondary-text">evap.</text>
    </ChartFrame>
  );
}

function ProfileChart({ profile, mean, uniformity }) {
  const yMin = Math.min(...profile.map((d) => d.hMicron)) * 0.995;
  const yMax = Math.max(...profile.map((d) => d.hMicron)) * 1.005;
  const path = linePath(profile, 'rNorm', 'hMicron', 520, 310, 52, yMin, yMax);
  const meanData = [{ rNorm: 0, hMicron: mean }, { rNorm: 1, hMicron: mean }];
  const meanPath = linePath(meanData, 'rNorm', 'hMicron', 520, 310, 52, yMin, yMax);
  return (
    <ChartFrame xLabel="Normalized radius, r/R" yLabel="Thickness (µm)">
      <path d={path} className="line primary" />
      <path d={meanPath} className="line dashed" />
      <text x="318" y="48" className="chart-note">U = {uniformity.toFixed(2)}%</text>
    </ChartFrame>
  );
}

function ValidationChart({ validation }) {
  const data = validation.compared.filter((_, i) => i % 5 === 0);
  const yMax = Math.max(...data.map((d) => d.hMicron)) * 1.05;
  const pathNumerical = linePath(data, 't', 'hMicron', 520, 310, 52, 0, yMax);
  const pathExact = linePath(data, 't', 'exactMicron', 520, 310, 52, 0, yMax);
  return (
    <ChartFrame xLabel="Time (s)" yLabel="Thickness (µm)">
      <path d={pathExact} className="line primary" />
      <path d={pathNumerical} className="line secondary dashed" />
      <text x="286" y="48" className="chart-note">Max relative error: {validation.maxError.toExponential(2)}%</text>
    </ChartFrame>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{value}{unit ? ` ${unit}` : ''}</strong>
    </label>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function CoreView({ params, setParams, odeData, radial, gelTime }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setFrame((previous) => (previous + 1) % radial.snapshots.length);
    }, 180);
    return () => clearInterval(timer);
  }, [playing, radial.snapshots.length]);

  const snapshot = radial.snapshots[frame] ?? radial.snapshots[0];
  const final = odeData[odeData.length - 1];
  const spinAtEnd = final.spinLossMicronPerSec;
  const evapAtEnd = final.evapLossMicronPerSec;

  return (
    <div className="grid-two">
      <section className="card controls">
        <h2>Core interactive view</h2>
        <p className="muted">Adjust recipe variables and observe mean thickness, radial profile, gel time, and regime transition.</p>
        <Slider label="Spin speed" value={params.rpm} min={1000} max={5000} step={100} unit="rpm" onChange={(v) => setParams({ ...params, rpm: v })} />
        <Slider label="Initial viscosity" value={params.eta0} min={0.04} max={0.25} step={0.005} unit="Pa·s" onChange={(v) => setParams({ ...params, eta0: v })} />
        <Slider label="Initial thickness" value={params.h0Micron} min={20} max={100} step={1} unit="µm" onChange={(v) => setParams({ ...params, h0Micron: v })} />
        <Slider label="Evaporation rate" value={params.evapMicronPerSec} min={0} max={0.15} step={0.005} unit="µm/s" onChange={(v) => setParams({ ...params, evapMicronPerSec: v })} />
        <Slider label="Wafer radius" value={params.radiusMm} min={75} max={150} step={5} unit="mm" onChange={(v) => setParams({ ...params, radiusMm: v })} />
        <Slider label="Viscosity growth" value={params.kEta} min={0} max={0.12} step={0.005} unit="s⁻¹" onChange={(v) => setParams({ ...params, kEta: v })} />
        <Slider label="Edge bead amplitude" value={params.edgeAmpPercent} min={0} max={12} step={0.5} unit="%" onChange={(v) => setParams({ ...params, edgeAmpPercent: v })} />
        <Slider label="Edge bead width" value={params.edgeWidthMm} min={2} max={25} step={1} unit="mm" onChange={(v) => setParams({ ...params, edgeWidthMm: v })} />
      </section>

      <section className="card">
        <h2>Outputs</h2>
        <div className="metric-grid">
          <Metric label="Final mean thickness" value={`${final.hMicron.toFixed(2)} µm`} />
          <Metric label="Final radial uniformity" value={`${radial.uniformity.toFixed(2)}%`} detail={`Spec: ±${params.uniformitySpecPercent}%`} />
          <Metric label="Gel time" value={Number.isFinite(gelTime) ? `${gelTime.toFixed(1)} s` : 'Not reached'} detail={`ηgel = ${params.etaGel} Pa·s`} />
          <Metric label="End-regime ratio" value={(spinAtEnd / Math.max(evapAtEnd, EPS)).toFixed(2)} detail="Rspin / Revap" />
        </div>
        <ThicknessChart odeData={odeData} />
      </section>

      <section className="card">
        <h2>Real-time radial animation</h2>
        <p className="muted">Current animation time: {snapshot.t.toFixed(1)} s</p>
        <div className="toolbar">
          <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
          <input type="range" min="0" max={radial.snapshots.length - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} />
        </div>
        <ProfileChart profile={snapshot.profile} mean={areaWeightedMean(snapshot.profile)} uniformity={maxDeviationPercent(snapshot.profile, areaWeightedMean(snapshot.profile))} />
      </section>

      <section className="card">
        <h2>Regime transition</h2>
        <p className="muted">The spin-driven rate decays as h decreases and η(t) increases, while the evaporation term is prescribed as a direct thickness-loss rate.</p>
        <RateChart odeData={odeData} />
      </section>
    </div>
  );
}

function ValidationView({ params, validation }) {
  const zeroSpin = runOde({ ...params, rpm: 0, steps: 200 });
  const zeroSpinFinal = zeroSpin[zeroSpin.length - 1].hMicron;
  const expectedZeroSpin = Math.max(params.h0Micron - params.evapMicronPerSec * params.totalTime, 0);
  const highViscosity = runOde({ ...params, eta0: 1e8, kEta: 0, steps: 200 });
  const highViscFinal = highViscosity[highViscosity.length - 1].hMicron;

  return (
    <div className="grid-two">
      <section className="card wide">
        <h2>Validation view: analytical EBP limit</h2>
        <p className="muted">With constant viscosity and zero evaporation, the numerical ODE should reproduce the closed-form EBP thinning law.</p>
        <ValidationChart validation={validation} />
      </section>
      <section className="card">
        <h2>Limit checks</h2>
        <div className="metric-grid single">
          <Metric label="EBP analytical max error" value={`${validation.maxError.toExponential(2)}%`} detail="constant η, E = 0" />
          <Metric label="Zero-spin final thickness" value={`${zeroSpinFinal.toFixed(2)} µm`} detail={`expected ${expectedZeroSpin.toFixed(2)} µm`} />
          <Metric label="Infinite-viscosity final thickness" value={`${highViscFinal.toFixed(2)} µm`} detail="spin term suppressed" />
        </div>
        <p className="muted">These checks catch common errors such as using rpm directly instead of rad/s, omitting the cylindrical area factor, or using an unweighted uniformity metric.</p>
      </section>
    </div>
  );
}

function DesignView({ params, setParams, map }) {
  const maxU = Math.max(...map.rows.flat().map((cell) => cell.uniformity));
  return (
    <div className="grid-two">
      <section className="card controls">
        <h2>Design-exploration mode</h2>
        <p className="muted">Sweep spin speed and initial viscosity to find recipes that satisfy the final radial-uniformity specification.</p>
        <Slider label="Uniformity spec" value={params.uniformitySpecPercent} min={0.5} max={5} step={0.1} unit="%" onChange={(v) => setParams({ ...params, uniformitySpecPercent: v })} />
        <Slider label="Wafer radius" value={params.radiusMm} min={75} max={150} step={5} unit="mm" onChange={(v) => setParams({ ...params, radiusMm: v })} />
        <Slider label="Radial grid cells" value={params.gridCells} min={24} max={80} step={4} unit="cells" onChange={(v) => setParams({ ...params, gridCells: v })} />
        <Slider label="Edge bead amplitude" value={params.edgeAmpPercent} min={0} max={12} step={0.5} unit="%" onChange={(v) => setParams({ ...params, edgeAmpPercent: v })} />
        <Slider label="Edge bead width" value={params.edgeWidthMm} min={2} max={25} step={1} unit="mm" onChange={(v) => setParams({ ...params, edgeWidthMm: v })} />
      </section>
      <section className="card wide">
        <h2>Process-window heatmap</h2>
        <p className="muted">Green cells pass the ±{params.uniformitySpecPercent}% uniformity target; darker cells represent lower final non-uniformity.</p>
        <div className="heatmap" style={{ gridTemplateColumns: `70px repeat(${map.rpms.length}, 1fr)` }}>
          <div className="heat-label">η₀ \ rpm</div>
          {map.rpms.map((rpm) => <div key={rpm} className="heat-label">{rpm}</div>)}
          {map.rows.map((row, i) => (
            <React.Fragment key={map.etas[i]}>
              <div className="heat-label">{map.etas[i].toFixed(3)}</div>
              {row.map((cell) => {
                const intensity = Math.max(0.12, 1 - cell.uniformity / Math.max(maxU, EPS));
                return (
                  <div
                    key={`${cell.rpm}-${cell.eta0}`}
                    className={`heat-cell ${cell.pass ? 'pass' : 'fail'}`}
                    style={{ opacity: 0.45 + 0.55 * intensity }}
                    title={`${cell.rpm} rpm, η0=${cell.eta0} Pa·s, U=${cell.uniformity.toFixed(2)}%`}
                  >
                    {cell.uniformity.toFixed(1)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}

function EquationsPanel() {
  return (
    <section className="card equations">
      <h2>Model equations used in the simulator</h2>
      <div className="eq-grid">
        <div><strong>Uniform EBP ODE</strong><code>dh/dt = -2ρω²h³/(3η) - E</code></div>
        <div><strong>Viscosity growth</strong><code>η(t) = η₀ exp(kηt)</code></div>
        <div><strong>Radial flux</strong><code>q = ρω²rh³/(3η)</code></div>
        <div><strong>Uniformity metric</strong><code>U = max|hᵢ - h̄| / h̄ × 100%</code></div>
      </div>
    </section>
  );
}

function App() {
  const [view, setView] = useState('core');
  const [params, setParams] = useState({
    rpm: 3000,
    eta0: 0.1,
    h0Micron: 50,
    evapMicronPerSec: 0.05,
    radiusMm: 150,
    kEta: 0.055,
    etaGel: 1.0,
    totalTime: 30,
    steps: 600,
    gridCells: 48,
    edgeAmpPercent: 6,
    edgeWidthMm: 10,
    uniformitySpecPercent: 2,
  });

  const odeData = useMemo(() => runOde(params), [params]);
  const radial = useMemo(() => runRadial(params), [params]);
  const validation = useMemo(() => computeValidation(params), [params]);
  const designMap = useMemo(() => createDesignMap(params), [params]);
  const gelTime = useMemo(() => estimateGelTime(params), [params]);

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Fluid Mechanics Term Project · Subject 1</p>
        <h1>Spin Coating Thin-Film Uniformity Simulator</h1>
        <p>
          Emslie-Bonner-Peck thin-film model with evaporation-driven viscosity growth,
          radial finite-volume uniformity prediction, validation checks, and process-window search.
        </p>
        <nav>
          <button className={view === 'core' ? 'active' : ''} onClick={() => setView('core')}>Core interactive</button>
          <button className={view === 'validation' ? 'active' : ''} onClick={() => setView('validation')}>Validation</button>
          <button className={view === 'design' ? 'active' : ''} onClick={() => setView('design')}>Design exploration</button>
        </nav>
      </header>

      {view === 'core' && <CoreView params={params} setParams={setParams} odeData={odeData} radial={radial} gelTime={gelTime} />}
      {view === 'validation' && <ValidationView params={params} validation={validation} />}
      {view === 'design' && <DesignView params={params} setParams={setParams} map={designMap} />}
      <EquationsPanel />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
