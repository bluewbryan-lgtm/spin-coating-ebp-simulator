# Spin Coating EBP Thin-Film Uniformity Simulator

This Vite + React web simulator was prepared for the Fluid Mechanics Term Project, Subject 1: **Spin Coating Thin-Film Uniformity: Reconstructing the Emslie-Bonner-Peck Theory**.

The simulator implements a thin-film Emslie-Bonner-Peck model with evaporation-driven viscosity growth. It provides:

1. **Core interactive view**: sliders for spin speed, viscosity, initial thickness, evaporation rate, wafer radius, viscosity growth, and edge-bead parameters.
2. **Validation view**: analytical EBP comparison, zero-spin limit, infinite-viscosity limit, and numerical error display.
3. **Design-exploration mode**: process-window heatmap for final radial uniformity specification such as ±2%.

## Model summary

The uniform average-thickness model is

```text
dh/dt = -2 rho omega^2 h^3 / (3 eta(t)) - E
eta(t) = eta0 exp(k_eta t)
omega = 2 pi N / 60
```

The radial finite-volume model uses the EBP flux

```text
q(r,t) = rho omega^2 r h^3 / (3 eta(t))
```

and the axisymmetric conservation law

```text
partial h / partial t = -(1/r) partial(r q)/partial r - E
```

The uniformity metric is area-weighted because a wafer has more area near the rim:

```text
U = max_i |h_i - h_bar| / h_bar * 100%
```

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Build

```bash
npm run build
```

The production build is created in the `dist/` folder.

## Deploy to Vercel

Recommended settings:

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

## Files

```text
index.html
package.json
vite.config.js
src/main.jsx
src/styles.css
README.md
SUBMISSION_GUIDE.md
submission_comment.txt
```

## Notes

The numerical values are illustrative and should be calibrated against experimental photoresist data for real process use. The simulator is intended to demonstrate the fluid-mechanics model, analytical validation, and process-window reasoning required by the term project.
