import { createSeededRng } from "../simulation/rng";

export const TRACK_WIDTH = 4.4;
export const TRACK_LENGTH = 420;
export const START_HEIGHT = 42;
export const MIN_SLOPE = 0.095;
export const ROAD_SAMPLES = 1500;

const MIN_CENTERLINE_CLEARANCE = TRACK_WIDTH + 5.6;
const MIN_VERTICAL_CROSSING_CLEARANCE = 10.0;
const MAX_LOCAL_YAW_DELTA = 0.68;
const MAX_WINDOW_YAW_DELTA = 1.28;
const MAX_LOCAL_PITCH_DELTA = 0.24;
const MAX_SAMPLE_PITCH = 0.42;

export const PEG_UP_CENTER_OFFSET = 0.28;
export const PEG_DOWN_CENTER_OFFSET = -0.25;
export const PEG_MOTION_PERIOD = 14;
export const PEG_HOLD_UP_SECONDS = 5;
export const PEG_LOWER_SECONDS = 3;
export const PEG_HOLD_DOWN_SECONDS = 3;
export const PEG_RAISE_SECONDS = 3;

export function obstacleCycleValue(time: number, phase = 0, period = PEG_MOTION_PERIOD): number {
  return ((time + phase) % period + period) % period;
}

export function pegExtensionAtTime(time: number, phase = 0): number {
  const t = obstacleCycleValue(time, phase);

  if (t < PEG_HOLD_UP_SECONDS) {
    return 1;
  }

  if (t < PEG_HOLD_UP_SECONDS + PEG_LOWER_SECONDS) {
    return 1 - smoothstep(0, 1, (t - PEG_HOLD_UP_SECONDS) / PEG_LOWER_SECONDS);
  }

  if (t < PEG_HOLD_UP_SECONDS + PEG_LOWER_SECONDS + PEG_HOLD_DOWN_SECONDS) {
    return 0;
  }

  const raiseStart = PEG_HOLD_UP_SECONDS + PEG_LOWER_SECONDS + PEG_HOLD_DOWN_SECONDS;
  return smoothstep(0, 1, (t - raiseStart) / PEG_RAISE_SECONDS);
}

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
  totalLength: number;
  finishDistance: number;
  catchDistance: number;
  finish: TrackSample;
  start: TrackSample;
  catchCenter: { x: number; y: number; z: number };
  features: TrackFeatures;
};

export type TrackFeatures = {
  wideZones: Array<{ startDistance: number; endDistance: number; extraWidth: number; kind: "funnel" | "bowl" | "split" }>;
  pegs: Array<{ distance: number; offset: number; radius: number; phase: number }>;
  greenBumpers: Array<{ distance: number; offset: number; radius: number }>;
  gates: Array<{ distance: number; phase: number }>;
  trappers: Array<{ distance: number; phase: number; radius: number }>;
  spinners: Array<{ distance: number; phase: number; speed: number }>;
  hammers: Array<{ distance: number; phase: number; side: -1 | 1 }>;
  turnstiles: Array<{ distance: number; phase: number; speed: number }>;
  powerups: Array<{ id: string; distance: number; offset: number; kind: PowerupKind }>;
  splitModules: Array<{ startDistance: number; endDistance: number }>;
};

export type PowerupKind = "speed" | "giant" | "tiny" | "ghost" | "slow" | "barrier" | "smash";

type PlanPoint = {
  x: number;
  z: number;
};

type StraightSection = {
  start: number;
  end: number;
  heading: number;
};

export function generateTrack(seed: string, obstacleSeed = seed): TrackDefinition {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const rng = createSeededRng(`${seed}:track:${attempt}`);
    const featureRng = createSeededRng(`${obstacleSeed}:features:${attempt}`);
    const metrics = createTrackMetrics(rng);
    const points = generateOrganicPoints(rng, metrics.totalLength, metrics.startHeight, metrics);
    const baseSamples = sampleTrack(points, ROAD_SAMPLES, metrics.totalLength, metrics.startHeight);

    const candidate = createTrackDefinition(seed, points, baseSamples, rng, featureRng, metrics);

    if (!hasBadTrackGeometry(candidate.samples, metrics.totalLength)) {
      return candidate;
    }
  }

  const fallbackRng = createSeededRng(`${seed}:track:fallback`);
  const fallbackFeatureRng = createSeededRng(`${obstacleSeed}:features:fallback`);
  const metrics = createTrackMetrics(fallbackRng);
  const points = generateFallbackPoints(fallbackRng, metrics.totalLength, metrics.startHeight);
  const baseSamples = sampleTrack(points, ROAD_SAMPLES, metrics.totalLength, metrics.startHeight);

  return createTrackDefinition(seed, points, baseSamples, fallbackRng, fallbackFeatureRng, metrics);
}

function createTrackDefinition(
  seed: string,
  points: TrackPoint[],
  baseSamples: TrackSample[],
  mapRng: () => number,
  obstacleRng: () => number,
  metrics: TrackMetrics,
): TrackDefinition {
  const finishDistance = metrics.totalLength - metrics.finishRunout;
  const catchDistance = metrics.totalLength + metrics.catchRunout;
  const features = createFeatures(baseSamples, mapRng, obstacleRng, finishDistance);
  const samples = applyFeatureModifiers(baseSamples, features);
  const branches = createBranches(samples, mapRng);

  return {
    seed,
    points,
    samples,
    road: createRibbon(samples, TRACK_WIDTH, 0.02),
    leftWall: createWall(samples, -1),
    rightWall: createWall(samples, 1),
    branches,
    totalLength: metrics.totalLength,
    finishDistance,
    catchDistance,
    finish: sampleAtDistance(samples, finishDistance),
    start: sampleAtDistance(samples, 0.4),
    catchCenter: createCatchCenter(samples),
    features,
  };
}

type TrackMetrics = {
  totalLength: number;
  startHeight: number;
  finishRunout: number;
  catchRunout: number;
  shapeStyle: number;
  pointCount: number;
  envelope: number;
  curveScale: number;
  stepVariance: number;
  relaxIterations: number;
  slopeBase: number;
  slopePulseScale: number;
  slopeWaveScale: number;
};

function createTrackMetrics(rng: () => number): TrackMetrics {
  const totalLength = 220 + rng() * 1780;
  const slopeBase = 0.07 + rng() * 0.065;
  const slopePulseScale = 0.45 + rng() * 1.45;
  const estimatedDrop = totalLength * (slopeBase + slopePulseScale * 0.025);
  const startHeight = clamp(estimatedDrop * (0.82 + rng() * 0.45), 32, 260);

  return {
    totalLength,
    startHeight,
    finishRunout: 12 + rng() * 30,
    catchRunout: 14 + rng() * 24,
    shapeStyle: Math.floor(rng() * 12),
    pointCount: 18 + Math.floor(rng() * 42),
    envelope: 26 + rng() * 92,
    curveScale: 0.45 + rng() * 1.05,
    stepVariance: 0.32 + rng() * 0.68,
    relaxIterations: 2 + Math.floor(rng() * 4),
    slopeBase,
    slopePulseScale,
    slopeWaveScale: 0.012 + rng() * 0.05,
  };
}

function generateOrganicPoints(rng: () => number, totalLength: number, startHeight: number, metrics: TrackMetrics): TrackPoint[] {
  const plan = generateOrganicPlan(rng, totalLength, metrics);
  const points: TrackPoint[] = [];
  let y = startHeight;

  for (let index = 0; index < plan.length; index += 1) {
    const distance = (index / (plan.length - 1)) * totalLength;
    const current = plan[index];

    if (index > 0) {
      const previous = plan[index - 1];
      const flatDistance = Math.hypot(current.x - previous.x, current.z - previous.z);
      const t = index / (plan.length - 1);
      const slope = organicSlopeAt(t, rng, metrics);
      y -= flatDistance * slope;
    }

    points.push({
      x: current.x,
      y,
      z: current.z,
      distance,
    });
  }

  return points;
}

function generateOrganicPlan(rng: () => number, totalLength: number, metrics: TrackMetrics): PlanPoint[] {
  const pointCount = metrics.pointCount;
  const points: PlanPoint[] = [];
  const shapeStyle = metrics.shapeStyle;
  const envelope = metrics.envelope;

  let x = (rng() - 0.5) * 5;
  let z = 0;
  let heading = rng() * Math.PI * 2;
  let turnVelocity = (rng() - 0.5) * metrics.curveScale;
  let orbitSign = rng() < 0.5 ? -1 : 1;
  const switchbackEvery = 4 + Math.floor(rng() * 9);
  const waveA = 1.8 + rng() * 7.2;
  const waveB = 1.4 + rng() * 5.8;
  const startHeading = heading;
  const straightSections = createStraightSections(rng, shapeStyle, startHeading);

  points.push({ x, z });

  for (let index = 1; index < pointCount; index += 1) {
    const t = index / (pointCount - 1);
    const step = (totalLength / pointCount) * (0.48 + rng() * metrics.stepVariance);
    const wandering = Math.sin(t * Math.PI * waveA + rng() * Math.PI * 2);
    const wanderingB = Math.sin(t * Math.PI * waveB + rng() * Math.PI * 2);
    const curveImpulse = (rng() - 0.5) * (0.22 + metrics.curveScale * 0.64);
    const straightSection = straightSections.find((section) => t >= section.start && t <= section.end);

    if (straightSection) {
      turnVelocity *= 0.18;
      heading = blendAngle(heading, straightSection.heading + wandering * 0.08, 0.62);
    } else if (shapeStyle === 0) {
      turnVelocity = clamp(turnVelocity * 0.56 + curveImpulse, -1.35, 1.35);
      heading += turnVelocity + wandering * 0.42 * metrics.curveScale;
    } else if (shapeStyle === 1) {
      const desired = Math.atan2(-z * 0.35 + Math.sin(t * Math.PI * (2 + waveA)) * envelope * 0.46, -x);
      turnVelocity = clamp(turnVelocity + orbitSign * (0.11 + rng() * 0.24) * metrics.curveScale, -1.55, 1.55);
      heading = blendAngle(heading + turnVelocity * 0.58, desired + orbitSign * Math.PI / 2, 0.12 + rng() * 0.24);
    } else if (shapeStyle === 2) {
      if (index % switchbackEvery === 0) {
        orbitSign *= -1;
      }
      turnVelocity = clamp(turnVelocity * 0.68 + orbitSign * (0.18 + rng() * 0.42) * metrics.curveScale, -1.5, 1.5);
      heading += turnVelocity + wandering * 0.25;
    } else if (shapeStyle === 3) {
      const returnBias = Math.atan2(-x + Math.sin(t * Math.PI * waveA) * envelope * 0.28, 18 + Math.cos(t * Math.PI * waveB) * envelope * 0.38);
      turnVelocity = clamp(turnVelocity * 0.74 + curveImpulse, -1.32, 1.32);
      heading = blendAngle(heading + turnVelocity, returnBias, 0.08 + rng() * 0.26);
    } else if (shapeStyle === 4) {
      const spiralRadius = envelope * (0.18 + Math.sin(t * Math.PI) * 0.7);
      const desiredPoint = {
        x: Math.cos(t * Math.PI * (1.6 + rng() * 4.8)) * spiralRadius,
        z: Math.sin(t * Math.PI * (1.4 + rng() * 4.2)) * spiralRadius,
      };
      heading = blendAngle(heading + curveImpulse, Math.atan2(desiredPoint.z - z, desiredPoint.x - x), 0.18 + rng() * 0.24);
    } else if (shapeStyle === 5) {
      const targetHeading = startHeading + Math.sin(t * Math.PI * waveA) * Math.PI * 0.88 + wanderingB * 0.6;
      turnVelocity = clamp(turnVelocity * 0.5 + curveImpulse, -1.45, 1.45);
      heading = blendAngle(heading + turnVelocity, targetHeading, 0.16 + rng() * 0.2);
    } else if (shapeStyle === 6) {
      const boxHeading = Math.floor(t * (5 + rng() * 5)) % 2 === 0 ? startHeading + Math.PI / 2 : startHeading - Math.PI / 2;
      turnVelocity = clamp(turnVelocity * 0.58 + curveImpulse, -1.4, 1.4);
      heading = blendAngle(heading + turnVelocity, boxHeading + wandering * 0.55, 0.1 + rng() * 0.22);
    } else if (shapeStyle === 7) {
      if (index % switchbackEvery === 0 || rng() < 0.08) {
        heading += (rng() < 0.5 ? -1 : 1) * (Math.PI * (0.55 + rng() * 0.5));
      }
      turnVelocity = clamp(turnVelocity * 0.42 + curveImpulse, -1.6, 1.6);
      heading += turnVelocity;
    } else if (shapeStyle === 8) {
      const corridorHeading = startHeading + Math.sin(t * Math.PI * 2.2) * 0.58;
      turnVelocity = clamp(turnVelocity * 0.38 + curveImpulse * 0.22, -0.55, 0.55);
      heading = blendAngle(heading + turnVelocity, corridorHeading, 0.34);
    } else if (shapeStyle === 9) {
      const bendCenter = Math.sin(t * Math.PI * (2.0 + rng() * 1.6)) > 0 ? 1 : -1;
      const desired = startHeading + bendCenter * (0.22 + rng() * 0.5) + wandering * 0.18;
      turnVelocity = clamp(turnVelocity * 0.52 + curveImpulse * 0.28, -0.72, 0.72);
      heading = blendAngle(heading + turnVelocity, desired, 0.26);
    } else if (shapeStyle === 10) {
      const phase = Math.floor(t * (4 + rng() * 5));
      const desired = startHeading + (phase % 2 === 0 ? 0 : (rng() < 0.5 ? -1 : 1) * (Math.PI * 0.42 + rng() * 0.38));
      turnVelocity = clamp(turnVelocity * 0.35 + curveImpulse * 0.16, -0.62, 0.62);
      heading = blendAngle(heading + turnVelocity, desired, 0.38);
    } else {
      const chicane = Math.sin(t * Math.PI * (3 + rng() * 4)) * (0.34 + rng() * 0.42);
      const longStraightBias = Math.sin(t * Math.PI * 2) > -0.15 ? 0 : chicane;
      turnVelocity = clamp(turnVelocity * 0.48 + curveImpulse * 0.24, -0.82, 0.82);
      heading = blendAngle(heading + turnVelocity, startHeading + longStraightBias, 0.22);
    }

    x += Math.cos(heading) * step;
    z += Math.sin(heading) * step;

    const lateralLimit = envelope * (0.45 + 0.78 * Math.sin(t * Math.PI));
    const forwardLimit = envelope * (0.78 + rng() * 1.05);

    x = clamp(x, -lateralLimit, lateralLimit);
    z = clamp(z, -forwardLimit, forwardLimit);

    points.push({ x, z });
  }

  return relaxPlan(points, metrics.relaxIterations);
}

function createStraightSections(rng: () => number, shapeStyle: number, startHeading: number): StraightSection[] {
  const sections: StraightSection[] = [];
  const count =
    shapeStyle >= 8
      ? 3 + Math.floor(rng() * 4)
      : rng() < 0.55
        ? 1 + Math.floor(rng() * 3)
        : 0;

  for (let index = 0; index < count; index += 1) {
    const start = 0.08 + rng() * 0.78;
    const length = shapeStyle >= 8 ? 0.08 + rng() * 0.16 : 0.05 + rng() * 0.1;
    const headingOffset =
      shapeStyle >= 8
        ? (rng() - 0.5) * 1.15
        : (rng() < 0.5 ? -1 : 1) * (0.18 + rng() * 0.9);

    sections.push({
      start,
      end: Math.min(0.94, start + length),
      heading: startHeading + headingOffset,
    });
  }

  return sections.sort((a, b) => a.start - b.start);
}

function relaxPlan(points: PlanPoint[], iterations: number): PlanPoint[] {
  const result = points.map((point) => ({ ...point }));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 1; index < result.length - 1; index += 1) {
      const previous = result[index - 1];
      const current = result[index];
      const next = result[index + 1];

      current.x = current.x * 0.64 + (previous.x + next.x) * 0.18;
      current.z = current.z * 0.76 + (previous.z + next.z) * 0.12;
    }
  }

  return result;
}

function organicSlopeAt(t: number, rng: () => number, metrics: TrackMetrics): number {
  const steepDrop =
    gaussianPulse(t, 0.12 + rng() * 0.16, 0.05 + rng() * 0.06) * 0.08 * metrics.slopePulseScale +
    gaussianPulse(t, 0.38 + rng() * 0.24, 0.06 + rng() * 0.08) * 0.07 * metrics.slopePulseScale +
    gaussianPulse(t, 0.68 + rng() * 0.18, 0.05 + rng() * 0.07) * 0.075 * metrics.slopePulseScale;

  const rollingVariation = Math.sin(t * Math.PI * (3.5 + rng() * 10.5) + rng() * 2.5) * metrics.slopeWaveScale;
  const randomVariation = (rng() - 0.5) * metrics.slopeWaveScale;

  return clamp(metrics.slopeBase + steepDrop + rollingVariation + randomVariation, 0.052, 0.32);
}

function generateFallbackPoints(rng: () => number, totalLength: number, startHeight: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  const controlCount = 36;
  let y = startHeight;

  for (let index = 0; index < controlCount; index += 1) {
    const t = index / (controlCount - 1);
    const distance = t * totalLength;
    const radius = 14 + Math.sin(t * Math.PI) * 36;
    const angle = t * Math.PI * 4.1 + Math.sin(t * Math.PI * 5) * 0.9;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.78 + Math.sin(t * Math.PI * 2) * 30;

    if (index > 0) {
      y -= (totalLength / (controlCount - 1)) * (MIN_SLOPE + rng() * 0.09);
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

function createFeatures(samples: TrackSample[], mapRng: () => number, rng: () => number, finishDistance: number): TrackFeatures {
  const reserved: Array<{ distance: number; radius: number }> = [];

  const wideZones: TrackFeatures["wideZones"] = [
    { startDistance: finishDistance * (0.08 + mapRng() * 0.06), endDistance: finishDistance * (0.2 + mapRng() * 0.08), extraWidth: 0.4 + mapRng() * 2.5, kind: "funnel" },
    { startDistance: finishDistance * (0.32 + mapRng() * 0.12), endDistance: finishDistance * (0.48 + mapRng() * 0.12), extraWidth: -1.1 + mapRng() * 4.4, kind: "bowl" },
    { startDistance: finishDistance * (0.62 + mapRng() * 0.1), endDistance: finishDistance * (0.78 + mapRng() * 0.08), extraWidth: -1.35 + mapRng() * 4.1, kind: "split" },
  ];
  const extraWidthZones = 2 + Math.floor(mapRng() * 5);

  for (let index = 0; index < extraWidthZones; index += 1) {
    const start = finishDistance * (0.08 + mapRng() * 0.78);
    const length = finishDistance * (0.035 + mapRng() * 0.14);

    wideZones.push({
      startDistance: start,
      endDistance: Math.min(finishDistance * 0.96, start + length),
      extraWidth: -1.75 + mapRng() * 4.6,
      kind: mapRng() < 0.34 ? "funnel" : mapRng() < 0.67 ? "bowl" : "split",
    });
  }

  const split = wideZones.find((zone) => zone.kind === "split");
  const splitModules = split ? [{ startDistance: split.startDistance + 1.6, endDistance: split.endDistance - 1.6 }] : [];

  const mix = chooseObstacleMix(rng);
  const lengthScale = clamp(finishDistance / 650, 0.85, 1.35);
  const densityScale = 0.42 + rng() * 1.18;
  const endZoneBias = 0;

  const gates = pickFeatureDistances(
    rng,
    finishDistance,
    mix.gates ? Math.round((1 + Math.floor(rng() * 4)) * densityScale) : 0,
    2.25,
    reserved,
    samples,
    true,
    endZoneBias,
  ).map((distance) => ({
    distance,
    phase: rng() * 20,
  }));
  const trappers = pickFeatureDistances(
    rng,
    finishDistance,
    rng() < 0.72 ? Math.round((1 + Math.floor(rng() * 3)) * densityScale) : 0,
    3.1,
    reserved,
    samples,
    true,
    0,
  ).map((distance) => ({
    distance,
    phase: rng() * 18,
    radius: 0.95 + rng() * 0.45,
  }));
  const spinners = pickFeatureDistances(
    rng,
    finishDistance,
    mix.spinners ? Math.round((1 + Math.floor(rng() * 6)) * densityScale) : 0,
    2.0,
    reserved,
    samples,
    true,
    endZoneBias,
  ).map((distance) => ({
    distance,
    phase: rng() * Math.PI * 2,
    speed: (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.9),
  }));
  const hammers = pickFeatureDistances(
    rng,
    finishDistance,
    mix.hammers ? Math.round((1 + Math.floor(rng() * 4)) * densityScale) : 0,
    2.45,
    reserved,
    samples,
    true,
    endZoneBias,
  ).map((distance) => ({
    distance,
    phase: rng() * Math.PI * 2,
    side: (rng() < 0.5 ? -1 : 1) as -1 | 1,
  }));
  const turnstiles = pickFeatureDistances(
    rng,
    finishDistance,
    mix.turnstiles ? Math.round((1 + Math.floor(rng() * 4)) * densityScale) : 0,
    2.25,
    reserved,
    samples,
    true,
    endZoneBias,
  ).map((distance) => ({
    distance,
    phase: rng() * Math.PI * 2,
    speed: (rng() < 0.5 ? -1 : 1) * (0.28 + rng() * 0.22),
  }));
  const greenBumpers = pickFeatureDistances(
    rng,
    finishDistance,
    Math.round((5 + Math.floor(rng() * 22)) * lengthScale * densityScale),
    0.82,
    reserved,
    samples,
    false,
    0,
  ).map((distance) => ({
    distance,
    offset: (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 1.15),
    radius: 0.28 + rng() * 0.08,
  }));
  const pegCount = Math.round((6 + Math.floor(rng() * 21)) * lengthScale * densityScale);
  const pegs: TrackFeatures["pegs"] = pickPegDistances(rng, finishDistance, pegCount, reserved, samples).map((distance, index) => {
    const side = index % 2 === 0 ? -1 : 1;

    return {
      distance,
      offset: side * (0.45 + rng() * 1.2),
      radius: 0.17 + rng() * 0.045,
      phase: rng() * PEG_MOTION_PERIOD,
    };
  });
  const powerups = createPowerups(rng, finishDistance, reserved, samples);

  return {
    wideZones,
    pegs,
    greenBumpers,
    gates,
    trappers,
    spinners,
    hammers,
    turnstiles,
    powerups,
    splitModules,
  };
}

type ObstacleMix = {
  gates: boolean;
  spinners: boolean;
  hammers: boolean;
  turnstiles: boolean;
};

function chooseObstacleMix(rng: () => number): ObstacleMix {
  const entries: Array<keyof ObstacleMix> = [
    "gates",
    "spinners",
    "hammers",
    "turnstiles",
  ];
  const shuffled = shuffleStrings(entries, rng);
  const targetCount = 1 + Math.floor(rng() * entries.length);
  const selected = new Set<keyof ObstacleMix>(shuffled.slice(0, targetCount));

  return {
    gates: selected.has("gates"),
    spinners: selected.has("spinners"),
    hammers: selected.has("hammers"),
    turnstiles: selected.has("turnstiles"),
  };
}

function shuffleStrings<T>(items: T[], rng: () => number): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function createPegDistances(rng: () => number, finishDistance: number): number[] {
  const distances: number[] = [];

  for (let distance = 12; distance < finishDistance - 8; distance += 2.3 + rng() * 4.8) {
    distances.push(distance + (rng() - 0.5) * 1.9);
  }

  const endStart = finishDistance * 0.9;
  for (let distance = endStart; distance < finishDistance - 4; distance += 1.8 + rng() * 2.6) {
    distances.push(distance + (rng() - 0.5) * 1.4);
  }

  return distances;
}

function createPowerups(
  rng: () => number,
  finishDistance: number,
  reserved: Array<{ distance: number; radius: number }>,
  samples: TrackSample[],
): TrackFeatures["powerups"] {
  const kinds: PowerupKind[] = ["speed", "giant", "tiny", "ghost", "slow", "barrier", "smash"];
  const count = 5 + Math.floor(rng() * 7);

  return pickFeatureDistances(rng, finishDistance, count, 2.0, reserved, samples, false, 0).map((distance, index) => {
    const sample = sampleAtDistance(samples, distance);
    const maxOffset = Math.max(0.35, (sample.width ?? TRACK_WIDTH) / 2 - 0.9);

    return {
      id: `powerup-${index + 1}`,
      distance,
      offset: (rng() < 0.5 ? -1 : 1) * rng() * maxOffset,
      kind: kinds[Math.floor(rng() * kinds.length)] ?? "speed",
    };
  });
}

function pickPegDistances(
  rng: () => number,
  finishDistance: number,
  count: number,
  reserved: Array<{ distance: number; radius: number }>,
  samples: TrackSample[],
): number[] {
  const candidates = shuffleStrings(createPegDistances(rng, finishDistance), rng);
  const distances: number[] = [];

  for (const distance of candidates) {
    if (distances.length >= count) {
      break;
    }

    const ok =
      isFeatureSafe(samples, distance) &&
      reserved.every((item) => Math.abs(item.distance - distance) > item.radius + 0.68);

    if (!ok) {
      continue;
    }

    reserved.push({ distance, radius: 0.68 });
    distances.push(distance);
  }

  return distances.sort((a, b) => a - b);
}

function applyFeatureModifiers(samples: TrackSample[], features: TrackFeatures): TrackSample[] {
  return samples.map((sample, index) => {
    const narrowPulse =
      gaussianPulse(sample.distance / samples[samples.length - 1].distance, 0.24, 0.045) * 0.5 +
      gaussianPulse(sample.distance / samples[samples.length - 1].distance, 0.54, 0.055) * 0.62 +
      gaussianPulse(sample.distance / samples[samples.length - 1].distance, 0.86, 0.04) * 0.42;
    const wideExtra = features.wideZones.reduce(
      (total, zone) => total + zone.extraWidth * smoothRange(sample.distance, zone.startDistance, zone.endDistance),
      0,
    );
    const widthWave =
      Math.sin(sample.distance * 0.035) * 0.24 +
      Math.sin(sample.distance * 0.011 + 1.7) * 0.34;
    const width = clamp(TRACK_WIDTH + wideExtra + widthWave - narrowPulse, TRACK_WIDTH * 0.6, TRACK_WIDTH + 4.8);

    return {
      ...sample,
      width,
      bank: computeBank(samples, index),
      surfaceFriction: 0.18,
    };
  });
}

function computeBank(samples: TrackSample[], index: number): number {
  const before = samples[Math.max(0, index - 5)];
  const after = samples[Math.min(samples.length - 1, index + 5)];
  const yawDelta = wrapAngle(after.yaw - before.yaw);

  return clamp(-yawDelta * 0.92, -0.22, 0.22);
}

function isFeatureSafe(samples: TrackSample[], distance: number): boolean {
  const sample = sampleAtDistance(samples, distance);
  const before = sampleAtDistance(samples, Math.max(0, distance - 2));
  const after = sampleAtDistance(samples, Math.min(samples[samples.length - 1].distance, distance + 2));

  return Math.abs(wrapAngle(after.yaw - before.yaw)) < 0.5 && sample.distance > 9 && sample.distance < samples[samples.length - 1].distance - 18;
}

function pickFeatureDistances(
  rng: () => number,
  finishDistance: number,
  count: number,
  radius: number,
  reserved: Array<{ distance: number; radius: number }>,
  samples: TrackSample[],
  required = false,
  endZoneBias = 0.25,
): number[] {
  const distances: number[] = [];

  for (let attempt = 0; attempt < count * 42 && distances.length < count; attempt += 1) {
    const distance = randomFeatureDistance(rng, finishDistance, endZoneBias);
    const ok =
      isFeatureSafe(samples, distance) &&
      reserved.every((item) => Math.abs(item.distance - distance) > item.radius + radius);

    if (!ok) {
      continue;
    }

    reserved.push({ distance, radius });
    distances.push(distance);
  }

  if (required && distances.length < count) {
    for (let attempt = 0; attempt < count * 70 && distances.length < count; attempt += 1) {
      const distance = randomFeatureDistance(rng, finishDistance, endZoneBias);
      const relaxedRadius = radius * 0.55;
      const ok =
        isFeatureSafe(samples, distance) &&
        distances.every((item) => Math.abs(item - distance) > radius * 2.4) &&
        reserved.every((item) => Math.abs(item.distance - distance) > Math.max(item.radius, relaxedRadius));

      if (!ok) {
        continue;
      }

      reserved.push({ distance, radius: relaxedRadius });
      distances.push(distance);
    }
  }

  return distances.sort((a, b) => a - b);
}

function randomFeatureDistance(rng: () => number, finishDistance: number, endZoneBias: number): number {
  if (rng() < endZoneBias) {
    return finishDistance * (0.9 + rng() * 0.08);
  }

  if (rng() < 0.18) {
    return finishDistance * (0.12 + rng() * 0.76);
  }

  return 24 + rng() * (finishDistance - 54);
}

function hasBadTrackGeometry(samples: TrackSample[], totalLength: number): boolean {
  return hasBadSelfIntersection(samples, totalLength) || hasBadLocalGeometry(samples);
}

function hasBadSelfIntersection(samples: TrackSample[], totalLength: number): boolean {
  const stride = 4;
  const minDistanceGap = Math.max(18, totalLength * 0.038);

  for (let a = 0; a < samples.length - stride; a += stride) {
    const a1 = samples[a];
    const a2 = samples[a + stride];
    const aWidth = ((a1.width ?? TRACK_WIDTH) + (a2.width ?? TRACK_WIDTH)) / 2;

    for (let b = a + stride * 4; b < samples.length - stride; b += stride) {
      const b1 = samples[b];
      const b2 = samples[b + stride];
      const bWidth = ((b1.width ?? TRACK_WIDTH) + (b2.width ?? TRACK_WIDTH)) / 2;

      if (Math.abs(a1.distance - b1.distance) < minDistanceGap) {
        continue;
      }

      const flatDistance = segmentDistance2d(a1, a2, b1, b2);
      const verticalClearance = Math.abs(((a1.y + a2.y) / 2) - ((b1.y + b2.y) / 2));
      const requiredClearance = Math.max(MIN_CENTERLINE_CLEARANCE, (aWidth + bWidth) / 2 + 3.8);

      if (flatDistance < requiredClearance && verticalClearance < MIN_VERTICAL_CROSSING_CLEARANCE) {
        return true;
      }
    }
  }

  return false;
}

function hasBadLocalGeometry(samples: TrackSample[]): boolean {
  for (let index = 4; index < samples.length - 4; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];
    const before = samples[index - 4];
    const after = samples[index + 4];
    const localYawDelta = Math.abs(wrapAngle(next.yaw - previous.yaw));
    const windowYawDelta = Math.abs(wrapAngle(after.yaw - before.yaw));
    const previousPitch = pitchBetween(previous, current);
    const nextPitch = pitchBetween(current, next);
    const localPitchDelta = Math.abs(nextPitch - previousPitch);
    const tooSteep = Math.abs(previousPitch) > MAX_SAMPLE_PITCH || Math.abs(nextPitch) > MAX_SAMPLE_PITCH;

    if (
      localYawDelta > MAX_LOCAL_YAW_DELTA ||
      windowYawDelta > MAX_WINDOW_YAW_DELTA ||
      localPitchDelta > MAX_LOCAL_PITCH_DELTA ||
      tooSteep
    ) {
      return true;
    }
  }

  return false;
}

function pitchBetween(a: TrackPoint, b: TrackPoint): number {
  return Math.atan2(a.y - b.y, Math.hypot(b.x - a.x, b.z - a.z));
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

export function progressForPosition(track: TrackDefinition, position: { x: number; y?: number; z: number }): number {
  let closest = track.samples[0];
  let closestScore = Number.POSITIVE_INFINITY;

  for (const sample of track.samples) {
    const dx = sample.x - position.x;
    const dz = sample.z - position.z;
    const dy = position.y === undefined ? 0 : (sample.y - position.y) * 0.42;
    const score = dx * dx + dz * dz + dy * dy;

    if (score < closestScore) {
      closest = sample;
      closestScore = score;
    }
  }

  return closest.distance;
}

export function trackDistanceForPosition(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
): { distance: number; lateralDistance: number; verticalDistance: number; onCourse: boolean } {
  let closest = track.samples[0];
  let closestScore = Number.POSITIVE_INFINITY;

  for (const sample of track.samples) {
    const dx = sample.x - position.x;
    const dz = sample.z - position.z;
    const dy = sample.y - position.y;

    // Weighted 3D score. Y matters, but not as heavily as X/Z.
    const score = dx * dx + dz * dz + dy * dy * 0.38;

    if (score < closestScore) {
      closest = sample;
      closestScore = score;
    }
  }

  const lateralDistance = Math.hypot(closest.x - position.x, closest.z - position.z);
  const verticalDistance = Math.abs(closest.y - position.y);
  const width = closest.width ?? TRACK_WIDTH;

  return {
    distance: closest.distance,
    lateralDistance,
    verticalDistance,
    onCourse:
      lateralDistance <= width * 0.95 &&
      verticalDistance <= 3.2 &&
      position.y > closest.y - 2.2,
  };
}

export function sampleTrack(points: TrackPoint[], count: number, totalLength = TRACK_LENGTH, startHeight = START_HEIGHT): TrackSample[] {
  const positions: TrackPoint[] = [];

  for (let index = 0; index <= count; index += 1) {
    const distance = (index / count) * totalLength;
    const current = catmullPoint(points, distance, totalLength);
    positions.push(current);
  }

  enforceDownhillProfile(positions, totalLength, startHeight);

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

function enforceDownhillProfile(points: TrackPoint[], totalLength: number, startHeight: number): void {
  if (points.length === 0) {
    return;
  }

  points[0].y = startHeight;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const flatDistance = Math.hypot(current.x - previous.x, current.z - previous.z);
    const courseT = current.distance / totalLength;
    const startBoost = courseT < 0.14 ? 0.075 * (1 - courseT / 0.14) : 0;
    const steepSection =
      gaussianPulse(courseT, 0.18, 0.055) * 0.1 +
      gaussianPulse(courseT, 0.43, 0.075) * 0.09 +
      gaussianPulse(courseT, 0.7, 0.06) * 0.08 +
      gaussianPulse(courseT, 0.9, 0.035) * 0.055;
    const rolling = 0.032 * Math.sin(courseT * Math.PI * 9.5);
    const slope = MIN_SLOPE + startBoost + steepSection + rolling;

    current.y = previous.y - flatDistance * clamp(slope, 0.065, 0.3);
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
    const offset = (sample.width ?? TRACK_WIDTH) / 2 - 0.02;
    const x = sample.x + sample.normal.x * side * offset;
    const z = sample.z + sample.normal.z * side * offset;
    const bankY = Math.sin(sample.bank ?? 0) * side * offset;

    positions.push(x, sample.y + bankY - 0.16, z, x, sample.y + bankY + 1.02, z);

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
    x: end.x + end.tangent.x * 9,
    y: end.y - 3.6,
    z: end.z + end.tangent.z * 9,
  };
}

function catmullPoint(points: TrackPoint[], distance: number, totalLength: number): TrackPoint {
  const step = totalLength / (points.length - 1);
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
  const tension = 0.38;
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

function blendAngle(from: number, to: number, alpha: number): number {
  return from + wrapAngle(to - from) * alpha;
}

function gaussianPulse(value: number, center: number, width: number): number {
  const x = (value - center) / Math.max(width, 0.0001);

  return Math.exp(-x * x);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothRange(distance: number, start: number, end: number): number {
  const fade = Math.min(5.5, Math.max(1, (end - start) / 3));

  return smoothstep(start, start + fade, distance) * (1 - smoothstep(end - fade, end, distance));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * (3 - 2 * t);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
