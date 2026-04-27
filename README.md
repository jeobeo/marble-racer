# Deterministic Marble Race Picker

A browser-first TypeScript/Vite app that uses weighted deterministic selection, then visualizes the selected result as a Three.js marble race replay generated from a fixed-step Rapier 3D simulation.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Build

```bash
npm run build
```

## Model

The app intentionally separates decision logic from presentation:

```text
seed + options + weights -> deterministic weighted winner -> deterministic race simulation -> recorded replay
```

Game decisions do not use `Math.random()`. The picker and race setup use `createSeededRng(seed)`, and Rapier is stepped with a fixed `1 / 60` timestep. The renderer only replays recorded transforms.
