# Marble Race Picker

A browser-based 3D marble race app built with TypeScript, Vite, Three.js, and Rapier 3D.

Users configure options and weights. Each option can create one or more marbles, so higher-weight options have more chances in the live physics race. The race now runs as a real-time Rapier simulation instead of precomputing and replaying frames.

## Features

- Live Three.js rendering with Rapier 3D physics.
- Randomized map generation from a Map seed.
- Randomized objects, obstacles, and powerup placement from an Objects seed.
- Weighted options represented by multiple marbles.
- Pause, resume, reset, and live race standings.
- Collapsible side panel.
- Local storage for options, seeds, saved setups, and music volume.
- Music playback from files in `public/music`.
- Powerups including Speed, Giant, Tiny, Ghost, Slow, Barrier, and Smash.

## Requirements

- Node.js 18 or newer.
- npm.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Run On Local Network

Use the included Windows launcher:

```powershell
.\start.bat
```

Or run Vite manually:

```powershell
.\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173
```

Then open the shown local IP URL from another device on the same network.

## Build

```bash
npm run build
```

The production files are written to:

```text
dist
```

## Preview Production Build

```bash
npm run preview
```

## Music

Put music files in:

```text
public/music
```

The app randomly selects tracks from the configured music list and plays music only while the race is running. Pausing pauses the music; resetting restarts it.

## Deploy To Render

Use Render as a Static Site to avoid paying for a running server.

Render settings:

```text
Service type: Static Site
Build Command: npm ci && npm run build
Publish Directory: dist
Root Directory: leave blank
```

Do not deploy this as a Web Service. The app is browser-only and does not need a backend process.

## Push To GitHub

Create an empty GitHub repository, then run:

```bash
git status
git add .
git commit -m "Prepare marble race app for deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

If `origin` already exists:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

## Notes

- `node_modules`, `dist`, local logs, and local helper files are ignored by Git.
- Files under `public` are deployed as static assets.
- Large music files increase repository size and deploy upload time.
