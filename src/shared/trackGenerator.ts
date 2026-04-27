import { createSeededRng } from "../simulation/rng";

export const TRACK_WIDTH = 4.4;
export const TRACK_LENGTH = 105;
export const FINISH_DISTANCE = TRACK_LENGTH - 10;
export const CATCH_DISTANCE = TRACK_LENGTH + 10;
export const START_HEIGHT = 15.5;
export const MIN_SLOPE = 0.095;
export const ROAD_SAMPLES = 480;
const MIN_CENTERLINE_CLEARANCE = TRACK_WIDTH + 2.8;

export type TrackPoint = {
  x: number;
  y: number;
  z: number;
  distance: number;
};

export type TrackSample = TrackPoint & {
  tangent: { x: number; y: number; z: number };
  normal: { x: number; z: number };
  yaw: number;
  width: number;
  bank: number;
  surfaceFriction: number;
};

export type TrackMeshData = {
  vertices: Float32Array;
  indices: Uint32Array;
};

export type TrackDefinition = {
  seed: string;
  points: TrackPoint[];
  samples: TrackSample[];
  road: TrackMeshData;
  leftWall: TrackMeshData;
  rightWall: TrackMeshData;
  branches: Array<{
    road: TrackMeshData;
    leftWall: TrackMeshData;
    rightWall: TrackMeshData;
    samples: TrackSample[];
    startDistance: number;
    endDistance: number;
    side: -1 | 1;
  }>;
  finish: TrackSample;
  start: TrackSample;
  catchCenter: { x: number; y: number; z: number };
  features: TrackFeatures;
};

export type TrackFeatures = {
  wideZones: Array<{ startDistance: number; endDistance: number; extraWidth: number; kind: "funnel" | "bowl" | "split" }>;
  pegs: Array<{ distance: number; offset: number; radius: number }>;
  splitModules: Array<{ startDistance: number; endDistance: number }>;
};

export function generateTrack(seed: string): TrackDefinition {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rng = createSeededRng(`${seed}:track:${attempt}`);
    const points = generateMotifPoints(rng);
    const baseSamples = sampleTrack(points, ROAD_SAMPLES);

    if (!hasSelfIntersection(baseSamples)) {
      return createTrackDefinition(seed, points, baseSamples, rng);
    }
  }

  const fallbackRng = createSeededRng(`${seed}:track:fallback`);
  const points = generateFallbackPoints(fallbackRng);
  const baseSamples = sampleTrack(points, ROAD_SAMPLES);

  return createTrackDefinition(seed, points, baseSamples, fallbackRng);
}

function createTrackDefinition(seed: string, points: TrackPoint[], baseSamples: TrackSample[], rng: () => number): TrackDefinition {
  const features = createFeatures(baseSamples, rng);
  const samples = applyFeatureModifiers(baseSamples, features);
  const branches = createBranches(samples, rng);

  return {
    seed,
    points,
    samples,
    road: createRibbon(samples, TRACK_WIDTH, 0.02),
    leftWall: createWall(samples, -1),
    rightWall: createWall(samples, 1),
    branches,
    finish: sampleAtDistance(samples, FINISH_DISTANCE),
    start: sampleAtDistance(samples, 0.4),
    catchCenter: createCatchCenter(samples),
    features,
  };
}

function generateControlPoints(rng: () => number): TrackPoint[] {
  const points: TrackPoint[] = [];
  const controlCount = 18;
  let x = (rng() - 0.5) * 4;
  let z = 0;
  let y = START_HEIGHT;
  let distance = 0;
  let heading = Math.PI / 2 + (rng() - 0.5) * 0.8;
  let turnVelocity = (rng() - 0.5) * 0.55;

  points.push({ x, y, z, distance: 0 });

  for (let index = 1; index < controlCount; index += 1) {
    const step = TRACK_LENGTH / (controlCount - 1);
    distance += step;
    turnVelocity = clamp(turnVelocity + (rng() - 0.5) * 0.95, -1.45, 1.45);
    heading += turnVelocity;
    x = clamp(x + Math.cos(heading) * step, -18, 18);
    z = clamp(z + Math.sin(heading) * step, -10, 42);
    y -= step * (MIN_SLOPE + rng() * 0.07);
    points.push({ x, y, z, distance });
  }

  return points;
}

function generateMotifPoints(rng: () => number): TrackPoint[] {
  const motif = Math.floor(rng() * 12);
  const scaleX = 0.92 + rng() * 0.28;
  const scaleZ = 0.9 + rng() * 0.18;
  const mirror = rng() > 0.5 ? -1 : 1;
  const rotate = (rng() - 0.5) * 0.28;
  const jitter = () => (rng() - 0.5) * 1.15;
  const layouts = [
    [
      [0, 0],
      [11, 10],
      [18, 24],
      [8, 40],
      [-15, 51],
      [-21, 68],
      [-4, 86],
      [11, 103],
    ],
    [
      [0, 0],
      [13, 9],
      [23, 24],
      [14, 39],
      [-10, 47],
      [-24, 63],
      [-12, 82],
      [7, 102],
    ],
    [
      [0, 0],
      [-10, 10],
      [-20, 25],
      [-13, 43],
      [10, 55],
      [22, 73],
      [10, 91],
      [-3, 104],
    ],
    [
      [0, 0],
      [9, 9],
      [22, 21],
      [22, 39],
      [4, 55],
      [-23, 66],
      [-19, 84],
      [1, 104],
    ],
    [
      [0, 0],
      [14, 8],
      [28, 22],
      [24, 41],
      [5, 53],
      [-13, 44],
      [-28, 58],
      [-21, 78],
      [0, 101],
    ],
    [
      [0, 0],
      [-12, 10],
      [-25, 27],
      [-21, 48],
      [-3, 61],
      [17, 54],
      [28, 72],
      [16, 91],
      [-4, 104],
    ],
    [
      [0, 0],
      [8, 10],
      [20, 18],
      [28, 35],
      [20, 52],
      [4, 60],
      [-13, 54],
      [-23, 69],
      [-12, 88],
      [8, 104],
    ],
    [
      [0, 0],
      [-8, 11],
      [-22, 20],
      [-30, 38],
      [-20, 56],
      [-2, 64],
      [16, 58],
      [27, 74],
      [15, 94],
      [-5, 105],
    ],
    [
      [0, 0],
      [14, 9],
      [24, 25],
      [15, 43],
      [-6, 49],
      [-23, 38],
      [-31, 54],
      [-20, 75],
      [1, 86],
      [22, 78],
      [27, 96],
      [8, 106],
    ],
    [
      [0, 0],
      [-13, 10],
      [-26, 27],
      [-18, 47],
      [3, 55],
      [24, 45],
      [33, 62],
      [23, 82],
      [2, 91],
      [-17, 84],
      [-23, 101],
      [-4, 106],
    ],
    [
      [0, 0],
      [7, 12],
      [1, 29],
      [-16, 35],
      [-27, 23],
      [-36, 40],
      [-26, 61],
      [-7, 70],
      [13, 64],
      [28, 79],
      [19, 99],
      [0, 106],
    ],
    [
      [0, 0],
      [-7, 12],
      [-1, 30],
      [17, 36],
      [29, 24],
      [37, 42],
      [27, 63],
      [7, 72],
      [-15, 66],
      [-29, 82],
      [-18, 101],
      [2, 106],
    ],
  ][motif];

  const points: TrackPoint[] = [];
  let y = START_HEIGHT;

  for (let index = 0; index < layouts.length; index += 1) {
    const [rawX, rawZ] = layouts[index];
    const distance = (index / (layouts.length - 1)) * TRACK_LENGTH;
    if (index > 0) {
      const previous = layouts[index - 1];
      const step = Math.hypot(rawX - previous[0], rawZ - previous[1]);
      const positionFactor = index / Math.max(1, layouts.length - 1);
      const startKick = index < 3 ? 0.025 + rng() * 0.025 : 0;
      const slopeWave = Math.sin(positionFactor * Math.PI * (1.5 + rng())) * 0.018;
      y -= step * clamp(MIN_SLOPE + startKick + slopeWave + rng() * 0.055, 0.065, 0.145);
    }
    const x = rawX * scaleX * mirror;
    const z = rawZ * scaleZ;
    points.push({
      x: x * Math.cos(rotate) - z * Math.sin(rotate) + jitter(),
      z: x * Math.sin(rotate) + z * Math.cos(rotate) + jitter(),
      y,
      distance,
    });
  }

  return points;
}

function generateFallbackPoints(rng: () => number): TrackPoint[] {
  const points: TrackPoint[] = [];
  const controlCount = 20;
  let y = START_HEIGHT;

  for (let index = 0; index < controlCount; index += 1) {
    const distance = (index / (controlCount - 1)) * TRACK_LENGTH;
    const lane = index % 2 === 0 ? -1 : 1;
    const x = lane * (10 + rng() * 2.4) * Math.sin((index / (controlCount - 1)) * Math.PI);
    const z = distance * 0.86;
    if (index > 0) {
      y -= (TRACK_LENGTH / (controlCount - 1)) * (MIN_SLOPE + rng() * 0.06);
    }
    points.push({ x, y, z, distance });
  }

  return points;
}

function createBranches(samples: TrackSample[], rng: () => number): TrackDefinition["branches"] {
  void samples;
  void rng;
  return [];
}

function createFeatures(samples: TrackSample[], rng: () => number): TrackFeatures {
  const wideZones: TrackFeatures["wideZones"] = [
    { startDistance: 14 + rng() * 5, endDistance: 30 + rng() * 4, extraWidth: 1.6 + rng() * 0.5, kind: "funnel" },
    { startDistance: 43 + rng() * 6, endDistance: 62 + rng() * 5, extraWidth: 2.2 + rng() * 0.7, kind: "bowl" },
    { startDistance: 72 + rng() * 5, endDistance: 90 + rng() * 4, extraWidth: 2.0 + rng() * 0.6, kind: "split" },
  ];
  const split = wideZones.find((zone) => zone.kind === "split");
  const splitModules = split ? [{ startDistance: split.startDistance + 1.6, endDistance: split.endDistance - 1.6 }] : [];
  const pegs: TrackFeatures["pegs"] = createPegDistances(rng)
    .filter((distance) => isPegSafe(samples, distance))
    .map((distance, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        distance,
        offset: side * (0.45 + rng() * 0.9),
        radius: 0.17 + rng() * 0.04,
      };
    });

  return { wideZones, pegs, splitModules };
}

function createPegDistances(rng: () => number): number[] {
  const distances: number[] = [];
  for (let distance = 10; distance < FINISH_DISTANCE - 4; distance += 3.0 + rng() * 1.8) {
    distances.push(distance + (rng() - 0.5) * 1.6);
  }
  return distances;
}

function applyFeatureModifiers(samples: TrackSample[], features: TrackFeatures): TrackSample[] {
  return samples.map((sample, index) => {
    const width =
      TRACK_WIDTH +
      features.wideZones.reduce(
        (total, zone) => total + zone.extraWidth * smoothRange(sample.distance, zone.startDistance, zone.endDistance),
        0,
      );
    return {
      ...sample,
      width,
      bank: computeBank(samples, index),
      surfaceFriction: 0.18,
    };
  });
}

function computeBank(samples: TrackSample[], index: number): number {
  const before = samples[Math.max(0, index - 4)];
  const after = samples[Math.min(samples.length - 1, index + 4)];
  const yawDelta = wrapAngle(after.yaw - before.yaw);
  return clamp(-yawDelta * 0.8, -0.16, 0.16);
}

function isPegSafe(samples: TrackSample[], distance: number): boolean {
  const sample = sampleAtDistance(samples, distance);
  const before = sampleAtDistance(samples, Math.max(0, distance - 2));
  const after = sampleAtDistance(samples, Math.min(TRACK_LENGTH, distance + 2));
  return Math.abs(wrapAngle(after.yaw - before.yaw)) < 0.42 && sample.distance > 8 && sample.distance < FINISH_DISTANCE - 4;
}

function hasSelfIntersection(samples: TrackSample[]): boolean {
  const stride = 3;
  const minDistanceGap = TRACK_WIDTH * 2.75;

  for (let a = 0; a < samples.length - stride; a += stride) {
    const a1 = samples[a];
    const a2 = samples[a + stride];

    for (let b = a + stride; b < samples.length - stride; b += stride) {
      const b1 = samples[b];
      const b2 = samples[b + stride];
      if (Math.abs(a1.distance - b1.distance) < minDistanceGap) {
        continue;
      }

      const distance = segmentDistance2d(a1, a2, b1, b2);

      if (distance < MIN_CENTERLINE_CLEARANCE) {
        return true;
      }
    }
  }

  return false;
}

function segmentDistance2d(a1: TrackPoint, a2: TrackPoint, b1: TrackPoint, b2: TrackPoint): number {
  if (segmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }

  return Math.min(
    pointSegmentDistance2d(a1, b1, b2),
    pointSegmentDistance2d(a2, b1, b2),
    pointSegmentDistance2d(b1, a1, a2),
    pointSegmentDistance2d(b2, a1, a2),
  );
}

function pointSegmentDistance2d(point: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz || 1;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0, 1);
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return Math.hypot(point.x - x, point.z - z);
}

function segmentsIntersect(a1: TrackPoint, a2: TrackPoint, b1: TrackPoint, b2: TrackPoint): boolean {
  const d1 = direction(a1, a2, b1);
  const d2 = direction(a1, a2, b2);
  const d3 = direction(b1, b2, a1);
  const d4 = direction(b1, b2, a2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function direction(a: TrackPoint, b: TrackPoint, c: TrackPoint): number {
  return (c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x);
}

export function sampleAtDistance(samples: TrackSample[], distance: number): TrackSample {
  let closest = samples[0];
  let closestDelta = Math.abs(closest.distance - distance);

  for (const sample of samples) {
    const delta = Math.abs(sample.distance - distance);
    if (delta < closestDelta) {
      closest = sample;
      closestDelta = delta;
    }
  }

  return closest;
}

export function progressForPosition(track: TrackDefinition, position: { x: number; z: number }): number {
  let closest = track.samples[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const sample of track.samples) {
    const distance = (sample.x - position.x) ** 2 + (sample.z - position.z) ** 2;
    if (distance < closestDistance) {
      closest = sample;
      closestDistance = distance;
    }
  }

  return closest.distance;
}

export function sampleTrack(points: TrackPoint[], count: number): TrackSample[] {
  const positions: TrackPoint[] = [];

  for (let index = 0; index <= count; index += 1) {
    const distance = (index / count) * TRACK_LENGTH;
    const current = catmullPoint(points, distance);
    positions.push(current);
  }

  enforceDownhillProfile(positions);

  const samples: TrackSample[] = [];

  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const before = positions[Math.max(0, index - 1)];
    const after = positions[Math.min(positions.length - 1, index + 1)];
    const tangent = normalize3({
      x: after.x - before.x,
      y: after.y - before.y,
      z: after.z - before.z,
    });
    const flatLength = Math.hypot(tangent.x, tangent.z) || 1;
    const flatTangent = { x: tangent.x / flatLength, z: tangent.z / flatLength };
    const normal = { x: flatTangent.z, z: -flatTangent.x };

    samples.push({
      ...current,
      tangent,
      normal,
      yaw: Math.atan2(flatTangent.x, flatTangent.z),
      width: TRACK_WIDTH,
      bank: 0,
      surfaceFriction: 0.18,
    });
  }

  return samples;
}

function enforceDownhillProfile(points: TrackPoint[]): void {
  if (points.length === 0) {
    return;
  }

  points[0].y = START_HEIGHT;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const flatDistance = Math.hypot(current.x - previous.x, current.z - previous.z);
    const courseT = current.distance / TRACK_LENGTH;
    const startBoost = courseT < 0.18 ? 0.05 * (1 - courseT / 0.18) : 0;
    const slope = MIN_SLOPE + startBoost + 0.018 * Math.sin(courseT * Math.PI * 3);
    current.y = previous.y - flatDistance * clamp(slope, 0.085, 0.16);
  }
}

export function createRibbon(samples: TrackSample[], width: number, yOffset: number): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    for (const side of [-1, 1]) {
      const sampleWidth = sample.width ?? width;
      positions.push(
        sample.x + sample.normal.x * side * (sampleWidth / 2),
        sample.y + yOffset + Math.sin(sample.bank ?? 0) * side * (sampleWidth / 2),
        sample.z + sample.normal.z * side * (sampleWidth / 2),
      );
    }

    if (index < samples.length - 1) {
      const start = index * 2;
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }

  return { vertices: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function createWall(samples: TrackSample[], side: -1 | 1): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const offset = (sample.width ?? TRACK_WIDTH) / 2 + 0.08;
    const x = sample.x + sample.normal.x * side * offset;
    const z = sample.z + sample.normal.z * side * offset;
    const bankY = Math.sin(sample.bank ?? 0) * side * offset;

    positions.push(x, sample.y + bankY + 0.04, z, x, sample.y + bankY + 1.02, z);

    if (index < samples.length - 1) {
      const start = index * 2;
      if (side < 0) {
        indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
      } else {
        indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
      }
    }
  }

  return { vertices: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function createCatchCenter(samples: TrackSample[]): { x: number; y: number; z: number } {
  const end = samples[samples.length - 1];
  return {
    x: end.x + end.tangent.x * 8,
    y: end.y - 3.3,
    z: end.z + end.tangent.z * 8,
  };
}

function catmullPoint(points: TrackPoint[], distance: number): TrackPoint {
  const step = TRACK_LENGTH / (points.length - 1);
  const raw = clamp(distance / step, 0, points.length - 1);
  const index = Math.floor(raw);
  const t = raw - index;
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[Math.min(points.length - 1, index + 1)];
  const p3 = points[Math.min(points.length - 1, index + 2)];

  return {
    x: catmull(p0.x, p1.x, p2.x, p3.x, t),
    y: catmull(p0.y, p1.y, p2.y, p3.y, t),
    z: catmull(p0.z, p1.z, p2.z, p3.z, t),
    distance,
  };
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const tension = 0.35;
  const m1 = (p2 - p0) * tension;
  const m2 = (p3 - p1) * tension;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 +
    (t3 - 2 * t2 + t) * m1 +
    (-2 * t3 + 3 * t2) * p2 +
    (t3 - t2) * m2
  );
}

function normalize3(value: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothRange(distance: number, start: number, end: number): number {
  const fade = Math.min(4, Math.max(1, (end - start) / 3));
  return smoothstep(start, start + fade, distance) * (1 - smoothstep(end - fade, end, distance));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
