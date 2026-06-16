import { createSeededRng } from "../simulation/rng";

export const TRACK_WIDTH = 4.4;
export const TRACK_LENGTH = 420;
export const START_HEIGHT = 42;
export const MIN_SLOPE = 0.095;
export const ROAD_SAMPLES = 850;

const MIN_MAIN_TRACK_WIDTH = TRACK_WIDTH * 0.92;
const MIN_SPLIT_LANE_WIDTH = TRACK_WIDTH * 0.96;
const MIN_FEATURE_ROUTE_WIDTH = TRACK_WIDTH * 0.94;

const MIN_CENTERLINE_CLEARANCE = TRACK_WIDTH + 4.6;
const MIN_VERTICAL_CROSSING_CLEARANCE = 8.2;
const MAX_LOCAL_YAW_DELTA = 0.52;
const MAX_WINDOW_YAW_DELTA = 1.05;
const MAX_NOISY_WINDOW_YAW = 1.72;
const MIN_SAME_LEVEL_NEAR_MISS_CLEARANCE = TRACK_WIDTH + 5.8;
const MIN_HAIRPIN_CHORD_RATIO = 0.42;
const MAX_LOCAL_PITCH_DELTA = 0.24;
const MAX_SAMPLE_PITCH = 0.42;

export const PEG_UP_CENTER_OFFSET = 0.28;
export const PEG_DOWN_CENTER_OFFSET = -0.25;
export const PEG_MOTION_PERIOD = 14;
export const PEG_HOLD_UP_SECONDS = 5;
export const PEG_LOWER_SECONDS = 3;
export const PEG_HOLD_DOWN_SECONDS = 3;
export const PEG_RAISE_SECONDS = 3;

export function obstacleCycleValue(
  time: number,
  phase = 0,
  period = PEG_MOTION_PERIOD,
): number {
  return (((time + phase) % period) + period) % period;
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

  const raiseStart =
    PEG_HOLD_UP_SECONDS + PEG_LOWER_SECONDS + PEG_HOLD_DOWN_SECONDS;
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

export type BoundaryPoint = {
  x: number;
  y: number;
  z: number;
};

export type SplitSurface = {
  road: TrackMeshData;
  outerBoundaries: BoundaryPoint[][];
  innerBoundary: BoundaryPoint[];
  startDistance: number;
  endDistance: number;
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
  splitSurfaces: SplitSurface[];
  totalLength: number;
  finishDistance: number;
  catchDistance: number;
  finish: TrackSample;
  start: TrackSample;
  catchCenter: { x: number; y: number; z: number };
  features: TrackFeatures;
};

export type TrackFeatures = {
  wideZones: Array<{
    startDistance: number;
    endDistance: number;
    extraWidth: number;
    kind: "funnel" | "bowl" | "split";
  }>;
  pegs: Array<{
    distance: number;
    offset: number;
    radius: number;
    phase: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  greenBumpers: Array<{
    distance: number;
    offset: number;
    radius: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  gates: Array<{
    distance: number;
    phase: number;
    offset?: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  trappers: Array<{
    distance: number;
    phase: number;
    radius: number;
    offset?: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  spinners: Array<{
    distance: number;
    phase: number;
    speed: number;
    offset?: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  hammers: Array<{
    distance: number;
    phase: number;
    side: -1 | 1;
    offset?: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  turnstiles: Array<{
    distance: number;
    phase: number;
    speed: number;
    offset?: number;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  powerups: Array<{
    id: string;
    distance: number;
    offset: number;
    kind: PowerupKind;
    routeId?: string;
    routeOffset?: number;
    mainOffset?: number;
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    width?: number;
  }>;
  splitModules: Array<{
    startDistance: number;
    endDistance: number;
    laneStartDistance: number;
    laneEndDistance: number;
    laneWidth: number;
    laneSeparation: number;
    waveAmplitude: number;
    waveCycles: number;
    wavePhase: number;
    widthScale: number;
    widthWaveAmplitude: number;
    bankAmplitude: number;
    heightAmplitude: number;
    widthBoost: number;
    side: -1 | 1;
    leftProfile: SplitLaneProfile;
    rightProfile: SplitLaneProfile;
  }>;
};

export type PowerupKind =
  | "speed"
  | "giant"
  | "tiny"
  | "ghost"
  | "slow"
  | "barrier"
  | "smash";

const ROUTE_BUCKET_SIZE = 12;
const ROUTE_BUCKET_RADIUS = 1;

type RouteSampleCache = {
  samples: TrackSample[];
  buckets: Map<string, TrackSample[]>;
};

const routeSamplesByTrack = new WeakMap<TrackDefinition, RouteSampleCache>();

type SplitLaneProfile = {
  startEase: number;
  endEase: number;
  separationScale: number;
  curveAmplitude: number;
  curveCycles: number;
  curvePhase: number;
  tangentAmplitude: number;
  tangentPhase: number;
  widthScale: number;
  widthWaveAmplitude: number;
  bankAmplitude: number;
  heightAmplitude: number;
};

type PlanPoint = {
  x: number;
  z: number;
};

type StraightSection = {
  start: number;
  end: number;
  heading: number;
};

type PlannedRoutePoint = PlanPoint & {
  heading: number;
  routeDistance: number;
};

type RouteCandidate = {
  points: PlannedRoutePoint[];
  endHeading: number;
  length: number;
};

export function generateTrack(
  seed: string,
  obstacleSeed = seed,
): TrackDefinition {
  let bestValid: TrackDefinition | null = null;
  let bestValidSplitCount = -1;

  for (let attempt = 0; attempt < 28; attempt += 1) {
    const rng = createSeededRng(`${seed}:track:${attempt}`);
    const featureRng = createSeededRng(`${obstacleSeed}:features:${attempt}`);
    const metrics = createTrackMetrics(rng);
    const points = generateOrganicPoints(
      rng,
      metrics.totalLength,
      metrics.startHeight,
      metrics,
    );
    const baseSamples = sampleTrack(
      points,
      ROAD_SAMPLES,
      metrics.totalLength,
      metrics.startHeight,
    );

    if (hasBadTrackGeometry(baseSamples, metrics.totalLength)) {
      continue;
    }

    const candidate = createTrackDefinition(
      seed,
      points,
      baseSamples,
      rng,
      featureRng,
      metrics,
    );

    const splitCount = candidate.splitSurfaces.length;
    const preferredSplitCount = preferredRenderedSplitCount(candidate.finishDistance);

    if (splitCount > bestValidSplitCount) {
      bestValid = candidate;
      bestValidSplitCount = splitCount;
    }

    // Prefer tracks that naturally produced rendered split surfaces, but do not
    // loosen the split geometry criteria. This avoids the previous failure mode
    // where forcing extra split modules made fork/merge slopes and geometry odd.
    if (splitCount >= preferredSplitCount) {
      return candidate;
    }

    // Keep seed generation bounded. Split surfaces are preferred, but a safe
    // generated course should not keep searching long enough to stall the UI.
    if (attempt >= 2 && splitCount > 0) {
      return candidate;
    }

    if (attempt >= 3) {
      return candidate;
    }
  }

  if (bestValid) {
    return bestValid;
  }

  const fallbackRng = createSeededRng(`${seed}:track:fallback`);
  const fallbackFeatureRng = createSeededRng(
    `${obstacleSeed}:features:fallback`,
  );
  const metrics = createTrackMetrics(fallbackRng);
  const points = generateFallbackPoints(
    fallbackRng,
    metrics.totalLength,
    metrics.startHeight,
  );
  const baseSamples = sampleTrack(
    points,
    ROAD_SAMPLES,
    metrics.totalLength,
    metrics.startHeight,
  );

  return createTrackDefinition(
    seed,
    points,
    baseSamples,
    fallbackRng,
    fallbackFeatureRng,
    metrics,
  );
}

function preferredRenderedSplitCount(finishDistance: number): number {
  if (finishDistance > 760) {
    return 2;
  }

  if (finishDistance > 300) {
    return 1;
  }

  return 0;
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
  const features = createFeatures(
    baseSamples,
    mapRng,
    obstacleRng,
    finishDistance,
  );
  const samples = applyFeatureModifiers(baseSamples, features);
  const branches = createBranches(samples, mapRng, features);
  const splitSurfaces = createSplitSurfaces(samples, branches, features);
  populateCourseFeatures(
    features,
    samples,
    branches,
    splitSurfaces,
    obstacleRng,
    finishDistance,
  );
  removeTrapRiskFeatures(features, samples, splitSurfaces);
  const splitRoadGaps = splitSurfaces.map(({ startDistance, endDistance }) => ({
    startDistance,
    endDistance,
  }));

  return {
    seed,
    points,
    samples,
    road: createRibbon(samples, TRACK_WIDTH, 0.02, splitRoadGaps),
    leftWall: createWall(samples, -1),
    rightWall: createWall(samples, 1),
    branches,
    splitSurfaces,
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
  routeStyle: number;
  segmentScale: number;
  turnScale: number;
  straightBias: number;
  crossingBias: number;
  slopeFloor: number;
  slopeCeiling: number;
  verticalWaveScale: number;
};

function createTrackMetrics(rng: () => number): TrackMetrics {
  // Bias the overall course shape toward split-friendly tracks rather than
  // relaxing the split validators themselves. Longer, smoother, less cramped
  // tracks naturally create more valid fork/merge regions without making the
  // accepted split geometry steeper or stranger.
  const routeStyle = Math.floor(rng() * 7);
  const totalLength = 420 + Math.pow(rng(), 0.9) * 1780;
  const slopeBase = 0.045 + rng() * 0.075;
  const slopePulseScale = 0.2 + rng() * 1.35;
  const estimatedDrop = totalLength * (slopeBase + slopePulseScale * 0.018);
  const startHeight = clamp(estimatedDrop * (0.9 + rng() * 0.62), 46, 360);
  const splitFriendlyStyle = rng() < 0.58;
  const shapeStyle = splitFriendlyStyle
    ? 8 + Math.floor(rng() * 4)
    : Math.floor(rng() * 12);

  return {
    totalLength,
    startHeight,
    finishRunout: 14 + rng() * 28,
    catchRunout: 14 + rng() * 24,
    shapeStyle,
    pointCount: 28 + Math.floor(rng() * 44),
    envelope: 54 + rng() * 132,
    curveScale: 0.34 + rng() * 0.82,
    stepVariance: 0.24 + rng() * 0.54,
    relaxIterations: 3 + Math.floor(rng() * 4),
    slopeBase,
    slopePulseScale,
    slopeWaveScale: 0.008 + rng() * 0.034,
    routeStyle,
    segmentScale: 0.48 + rng() * 1.12,
    turnScale: 0.92 + rng() * 1.95,
    straightBias: routeStyle === 0 ? 0.1 : routeStyle === 4 ? 0.025 : 0.025 + rng() * 0.09,
    crossingBias: routeStyle === 2 || routeStyle === 5 ? 0.58 + rng() * 0.34 : 0.22 + rng() * 0.28,
    slopeFloor: 0.048 + rng() * 0.04,
    slopeCeiling: 0.18 + rng() * 0.2,
    verticalWaveScale: rng() * 0.035,
  };
}

function generateOrganicPoints(
  rng: () => number,
  totalLength: number,
  startHeight: number,
  metrics: TrackMetrics,
): TrackPoint[] {
  const plan = generateOrganicPlan(rng, totalLength, metrics);
  const points: TrackPoint[] = [];
  let y = startHeight;

  for (let index = 0; index < plan.length; index += 1) {
    const distance = (index / (plan.length - 1)) * totalLength;
    const current = plan[index];

    if (index > 0) {
      const previous = plan[index - 1];
      const flatDistance = Math.hypot(
        current.x - previous.x,
        current.z - previous.z,
      );
      const t = index / (plan.length - 1);
      const slope = plannedSlopeAt(t, rng, metrics);
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

function plannedSlopeAt(
  t: number,
  rng: () => number,
  metrics: TrackMetrics,
): number {
  const pulses =
    gaussianPulse(t, 0.12 + rng() * 0.18, 0.035 + rng() * 0.07) *
      0.11 *
      metrics.slopePulseScale +
    gaussianPulse(t, 0.34 + rng() * 0.2, 0.05 + rng() * 0.1) *
      0.08 *
      metrics.slopePulseScale +
    gaussianPulse(t, 0.62 + rng() * 0.22, 0.04 + rng() * 0.085) *
      0.1 *
      metrics.slopePulseScale +
    gaussianPulse(t, 0.86 + rng() * 0.08, 0.028 + rng() * 0.045) *
      0.08;
  const waves =
    Math.sin(t * Math.PI * (4 + metrics.routeStyle * 0.9)) *
      metrics.verticalWaveScale +
    Math.sin(t * Math.PI * (9 + rng() * 8) + rng() * Math.PI * 2) *
      metrics.slopeWaveScale;
  const styleBoost =
    metrics.routeStyle === 3 || metrics.routeStyle === 5
      ? Math.sin(t * Math.PI) * 0.035
      : 0;

  return clamp(
    metrics.slopeBase + pulses + waves + styleBoost,
    metrics.slopeFloor,
    metrics.slopeCeiling,
  );
}

function generateOrganicPlan(
  rng: () => number,
  totalLength: number,
  metrics: TrackMetrics,
): PlanPoint[] {
  const planned = generatePlannedRoute(rng, totalLength, metrics);
  const controlCount = Math.max(72, metrics.pointCount * 3);
  const points: PlanPoint[] = [];

  for (let index = 0; index < controlCount; index += 1) {
    const distance = (index / (controlCount - 1)) * planned.totalDistance;
    points.push(planPointAtDistance(planned.points, distance));
  }

  return relaxPlan(points, metrics.routeStyle === 0 ? 1 : 0);
}

function generatePlannedRoute(
  rng: () => number,
  totalLength: number,
  metrics: TrackMetrics,
): { points: PlannedRoutePoint[]; totalDistance: number } {
  const points: PlannedRoutePoint[] = [
    {
      x: (rng() - 0.5) * 5,
      z: 0,
      heading: rng() * Math.PI * 2,
      routeDistance: 0,
    },
  ];
  const minClearance = TRACK_WIDTH + 2.4 + metrics.curveScale * 1.35;
  const targetDistance = totalLength * (0.88 + metrics.segmentScale * 0.12);
  let distance = 0;

  while (distance < targetDistance && points.length < 260) {
    const start = points[points.length - 1];
    let accepted: RouteCandidate | null = null;

    for (let attempt = 0; attempt < 28 && !accepted; attempt += 1) {
      const candidate = createRouteCandidateByStyle(
        rng,
        start,
        targetDistance - distance,
        metrics,
        distance / targetDistance,
      );

      if (isRouteCandidateClean(points, candidate, minClearance, metrics)) {
        accepted = candidate;
      }
    }

    if (!accepted) {
      const fallbackArc = distance / Math.max(targetDistance, 1) < 0.24
        ? createOrbitRouteCandidate(rng, start, targetDistance - distance, metrics, true)
        : createArcRouteCandidate(
          rng,
          start,
          targetDistance - distance,
          metrics,
          1.35,
        );
      accepted = isRouteCandidateClean(points, fallbackArc, minClearance, metrics)
        ? fallbackArc
        : createArcRouteCandidate(rng, start, targetDistance - distance, metrics, 0.62);
    }

    accepted = addSegmentDrift(accepted, start, rng, metrics, distance / targetDistance);

    for (const point of accepted.points) {
      points.push({
        ...point,
        routeDistance: distance + point.routeDistance,
      });
    }

    distance += accepted.length;
  }

  return {
    points: resamplePlannedRoute(points, Math.max(64, metrics.pointCount * 2)),
    totalDistance: distance,
  };
}

function addSegmentDrift(
  candidate: RouteCandidate,
  start: PlannedRoutePoint,
  rng: () => number,
  metrics: TrackMetrics,
  progress: number,
): RouteCandidate {
  if (candidate.length < 40 || metrics.routeStyle === 1) {
    return candidate;
  }

  const driftHeading =
    start.heading +
    Math.sin(progress * Math.PI * 2 + metrics.routeStyle) * 0.75 +
    (rng() - 0.5) * 0.35;
  const driftDistance = candidate.length * (0.1 + metrics.segmentScale * 0.055);
  const dx = Math.cos(driftHeading) * driftDistance;
  const dz = Math.sin(driftHeading) * driftDistance;

  return {
    ...candidate,
    points: candidate.points.map((point) => {
      const alpha = point.routeDistance / Math.max(candidate.length, 0.0001);

      return {
        ...point,
        x: point.x + dx * alpha,
        z: point.z + dz * alpha,
      };
    }),
  };
}

function createRouteCandidateByStyle(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
  progress: number,
): RouteCandidate {
  const roll = rng();
  const earlyCourse = progress < 0.22;
  const finishStraight = progress > 0.97 && rng() < 0.14;

  if (earlyCourse) {
    if (roll < 0.52) {
      return createOrbitRouteCandidate(rng, start, remainingDistance, metrics, true);
    }

    if (roll < 0.78) {
      return createHairpinRouteCandidate(rng, start, remainingDistance, metrics);
    }

    return createSRouteCandidate(rng, start, remainingDistance, metrics);
  }

  if (finishStraight || roll < metrics.straightBias) {
    return createStraightRouteCandidate(rng, start, remainingDistance, false, metrics);
  }

  const orbitChance = remainingDistance < 760 ? 0.52 : 0.4;
  const hairpinChance = 0.24 + metrics.crossingBias * 0.28;
  const orbitLimit = metrics.straightBias + orbitChance;
  const hairpinLimit = orbitLimit + hairpinChance;

  if (roll < orbitLimit) {
    return createOrbitRouteCandidate(rng, start, remainingDistance, metrics, false);
  }

  if (roll < hairpinLimit) {
    return createHairpinRouteCandidate(rng, start, remainingDistance, metrics);
  }

  if (metrics.routeStyle === 1 && roll < 0.82) {
    return createArcRouteCandidate(rng, start, remainingDistance, metrics, 1.65);
  }

  if (metrics.routeStyle === 3 && roll < 0.75) {
    return createSwitchbackRouteCandidate(rng, start, remainingDistance, metrics);
  }

  if (metrics.routeStyle === 4 && roll < 0.72) {
    return createSRouteCandidate(rng, start, remainingDistance, metrics);
  }

  return createArcRouteCandidate(rng, start, remainingDistance, metrics);
}

function createStraightRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  fallback = false,
  metrics?: TrackMetrics,
): RouteCandidate {
  const scale = metrics?.segmentScale ?? 1;
  const length = clamp(
    fallback ? Math.min(remainingDistance, 30) : (8 + rng() * 26) * scale,
    8,
    Math.max(32, remainingDistance),
  );
  const step = 8;
  const count = Math.max(3, Math.ceil(length / step));
  const points: PlannedRoutePoint[] = [];
  const heading = fallback ? start.heading : start.heading + (rng() - 0.5) * 0.28;

  for (let index = 1; index <= count; index += 1) {
    const d = (length * index) / count;
    points.push({
      x: start.x + Math.cos(heading) * d,
      z: start.z + Math.sin(heading) * d,
      heading,
      routeDistance: d,
    });
  }

  return { points, endHeading: heading, length };
}

function createArcRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
  angleScale = 1,
): RouteCandidate {
  const radius =
    (metrics.routeStyle === 1 ? 18 : 24) +
    rng() * (78 + metrics.curveScale * 76) * metrics.turnScale;
  const maxAngle = clamp(remainingDistance / radius, 0.32, Math.PI * 1.72);
  const angle =
    (0.68 + rng() * Math.min(2.45 * angleScale, maxAngle)) *
    (rng() < 0.5 ? -1 : 1);
  const length = clamp(Math.abs(angle) * radius, 28, Math.max(32, remainingDistance));
  const direction = Math.sign(angle) || 1;
  const step = 6.5;
  const count = Math.max(5, Math.ceil(length / step));
  const centerAngle = start.heading + direction * Math.PI / 2;
  const center = {
    x: start.x + Math.cos(centerAngle) * radius,
    z: start.z + Math.sin(centerAngle) * radius,
  };
  const startRadial = Math.atan2(start.z - center.z, start.x - center.x);
  const points: PlannedRoutePoint[] = [];

  for (let index = 1; index <= count; index += 1) {
    const alpha = index / count;
    const radial = startRadial + angle * alpha;
    const heading = start.heading + angle * alpha;

    points.push({
      x: center.x + Math.cos(radial) * radius,
      z: center.z + Math.sin(radial) * radius,
      heading,
      routeDistance: length * alpha,
    });
  }

  return { points, endHeading: start.heading + angle, length };
}

function createHairpinRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
): RouteCandidate {
  return createArcRouteCandidate(rng, start, remainingDistance, metrics, 2.35);
}

function createOrbitRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
  forceWrap = false,
): RouteCandidate {
  const radius = 16 + rng() * (58 + metrics.turnScale * 54);
  const maxAngle = clamp(remainingDistance / radius, 0.95, Math.PI * 2.18);
  const angle =
    (Math.PI * ((forceWrap ? 1.05 : 0.8) + rng() * (forceWrap ? 1.08 : 1.18))) *
    (rng() < 0.5 ? -1 : 1);
  const clampedAngle =
    Math.sign(angle) * Math.min(Math.abs(angle), Math.max(0.8, maxAngle));
  const length = Math.abs(clampedAngle) * radius;

  return createFixedArcCandidate(start, radius, clampedAngle, length);
}

function createSwitchbackRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
): RouteCandidate {
  const first = createArcRouteCandidate(rng, start, remainingDistance * 0.55, metrics, 1.25);
  const pivot = first.points[first.points.length - 1];
  const second = createArcRouteCandidate(
    rng,
    { ...pivot, routeDistance: 0 },
    remainingDistance - first.length,
    metrics,
    1.25,
  );
  const points = [
    ...first.points,
    ...second.points.map((point) => ({
      ...point,
      routeDistance: first.length + point.routeDistance,
    })),
  ];

  return {
    points,
    endHeading: second.endHeading,
    length: first.length + second.length,
  };
}

function createSRouteCandidate(
  rng: () => number,
  start: PlannedRoutePoint,
  remainingDistance: number,
  metrics: TrackMetrics,
): RouteCandidate {
  const radius = 56 + rng() * 110 * metrics.turnScale;
  const angle = (0.36 + rng() * 0.58) * (rng() < 0.5 ? -1 : 1);
  const halfLength = Math.abs(angle) * radius;
  const totalLength = Math.min(remainingDistance, halfLength * 2);
  const first = createFixedArcCandidate(start, radius, angle, totalLength / 2);
  const pivot = first.points[first.points.length - 1];
  const second = createFixedArcCandidate(
    { ...pivot, routeDistance: 0 },
    radius,
    -angle,
    totalLength / 2,
  );
  const points = [
    ...first.points,
    ...second.points.map((point) => ({
      ...point,
      routeDistance: first.length + point.routeDistance,
    })),
  ];

  return {
    points,
    endHeading: second.endHeading,
    length: first.length + second.length,
  };
}

function createFixedArcCandidate(
  start: PlannedRoutePoint,
  radius: number,
  angle: number,
  length: number,
): RouteCandidate {
  const direction = Math.sign(angle) || 1;
  const actualAngle = direction * Math.min(Math.abs(angle), length / radius);
  const count = Math.max(5, Math.ceil(length / 6.5));
  const centerAngle = start.heading + direction * Math.PI / 2;
  const center = {
    x: start.x + Math.cos(centerAngle) * radius,
    z: start.z + Math.sin(centerAngle) * radius,
  };
  const startRadial = Math.atan2(start.z - center.z, start.x - center.x);
  const points: PlannedRoutePoint[] = [];

  for (let index = 1; index <= count; index += 1) {
    const alpha = index / count;
    const radial = startRadial + actualAngle * alpha;
    const heading = start.heading + actualAngle * alpha;

    points.push({
      x: center.x + Math.cos(radial) * radius,
      z: center.z + Math.sin(radial) * radius,
      heading,
      routeDistance: length * alpha,
    });
  }

  return { points, endHeading: start.heading + actualAngle, length };
}

function isRouteCandidateClean(
  existing: PlannedRoutePoint[],
  candidate: RouteCandidate,
  minClearance: number,
  metrics: TrackMetrics,
): boolean {
  const ignoreTail = 16;
  const crossingClearance = Math.max(TRACK_WIDTH + 4.8, minClearance * 0.34);
  const currentBaseDistance = existing[existing.length - 1].routeDistance;

  for (const point of candidate.points) {
    for (let index = 0; index < existing.length - ignoreTail; index += 2) {
      const previous = existing[index];
      const absolutePointDistance = currentBaseDistance + point.routeDistance;
      const distanceGap = Math.abs(absolutePointDistance - previous.routeDistance);
      const requiredClearance =
        metrics.crossingBias > 0.18 && distanceGap > metrics.totalLength * 0.13
          ? crossingClearance
          : minClearance;

      if (Math.hypot(point.x - previous.x, point.z - previous.z) < requiredClearance) {
        return false;
      }
    }
  }

  return true;
}

function resamplePlannedRoute(
  points: PlannedRoutePoint[],
  count: number,
): PlannedRoutePoint[] {
  const last = points[points.length - 1];
  const result: PlannedRoutePoint[] = [];

  for (let index = 0; index < count; index += 1) {
    const distance = (index / (count - 1)) * last.routeDistance;
    const point = planPointAtDistance(points, distance);
    result.push({
      ...point,
      heading: point.heading ?? 0,
      routeDistance: distance,
    });
  }

  return result;
}

function planPointAtDistance(
  points: PlannedRoutePoint[],
  distance: number,
): PlannedRoutePoint {
  if (distance <= 0) {
    return points[0];
  }

  const last = points[points.length - 1];

  if (distance >= last.routeDistance) {
    return last;
  }

  let low = 0;
  let high = points.length - 1;

  while (high - low > 1) {
    const middle = (low + high) >> 1;

    if (points[middle].routeDistance < distance) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const a = points[low];
  const b = points[high];
  const alpha = clamp(
    (distance - a.routeDistance) / Math.max(b.routeDistance - a.routeDistance, 0.0001),
    0,
    1,
  );

  return {
    x: lerp(a.x, b.x, alpha),
    z: lerp(a.z, b.z, alpha),
    heading: blendAngle(a.heading, b.heading, alpha),
    routeDistance: distance,
  };
}

function createStraightSections(
  rng: () => number,
  shapeStyle: number,
  startHeading: number,
): StraightSection[] {
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

function organicSlopeAt(
  t: number,
  rng: () => number,
  metrics: TrackMetrics,
): number {
  const steepDrop =
    gaussianPulse(t, 0.12 + rng() * 0.16, 0.05 + rng() * 0.06) *
      0.08 *
      metrics.slopePulseScale +
    gaussianPulse(t, 0.38 + rng() * 0.24, 0.06 + rng() * 0.08) *
      0.07 *
      metrics.slopePulseScale +
    gaussianPulse(t, 0.68 + rng() * 0.18, 0.05 + rng() * 0.07) *
      0.075 *
      metrics.slopePulseScale;

  const rollingVariation =
    Math.sin(t * Math.PI * (3.5 + rng() * 10.5) + rng() * 2.5) *
    metrics.slopeWaveScale;
  const randomVariation = (rng() - 0.5) * metrics.slopeWaveScale;

  return clamp(
    metrics.slopeBase + steepDrop + rollingVariation + randomVariation,
    0.052,
    0.32,
  );
}

function generateFallbackPoints(
  rng: () => number,
  totalLength: number,
  startHeight: number,
): TrackPoint[] {
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

function createBranches(
  samples: TrackSample[],
  rng: () => number,
  features: TrackFeatures,
): TrackDefinition["branches"] {
  return features.splitModules.flatMap((module) =>
    ([-1, 1] as const).map((side) => {
      const branchSamples = createSplitLaneSamples(samples, module, side, rng);
      const wallSamples = splitBranchWallSamples(branchSamples, module);

      return {
        road: createRibbon(branchSamples, TRACK_WIDTH, 0.02),
        leftWall: createWall(wallSamples, -1),
        rightWall: createWall(wallSamples, 1),
        samples: branchSamples,
        startDistance: module.startDistance,
        endDistance: module.endDistance,
        side,
      };
    }),
  );
}

const SPLIT_ISLAND_ACTIVE_THRESHOLD = 0.48;
const MIN_SPLIT_BOUNDARY_CLEARANCE = TRACK_WIDTH * 0.58;

type SplitSection = {
  outerLeft: BoundaryPoint;
  innerLeft: BoundaryPoint;
  innerRight: BoundaryPoint;
  outerRight: BoundaryPoint;
  active: number;
  distance: number;
};

function createSplitSurfaces(
  mainSamples: TrackSample[],
  branches: TrackDefinition["branches"],
  features: TrackFeatures,
): SplitSurface[] {
  void branches;

  return features.splitModules.flatMap((module) => {
    const surface = createNaturalSplitSurface(mainSamples, module);
    return surface ? [surface] : [];
  });
}

function createNaturalSplitSurface(
  mainSamples: TrackSample[],
  module: TrackFeatures["splitModules"][number],
): SplitSurface | null {
  const moduleSamples = splitModuleSamples(mainSamples, module);

  if (moduleSamples.length < 8) {
    return null;
  }

  const sections = moduleSamples.map((sample, index) =>
    createSplitSection(
      sample,
      module,
      index === 0 || index === moduleSamples.length - 1,
    ),
  );
  const road = createNaturalSplitRoadMesh(sections);

  if (
    road.indices.length === 0 ||
    !hasEnoughNaturalSplitClearance(sections, module)
  ) {
    return null;
  }

  // Keep split wall boundary points tied to the exact road section edges.
  // Do not smooth these independently: independent smoothing makes the visual wall drift
  // away from the split road mesh and creates the misaligned walls seen at forks.
  const outerBoundaries = [
    dedupeBoundaryPoints(sections.map((section) => section.outerLeft)),
    dedupeBoundaryPoints(sections.map((section) => section.outerRight)),
  ].filter((boundary) => boundary.length >= 2);

  const innerBoundary = createRoundedSplitIslandBoundary(sections);

  if (
    outerBoundaries.length !== 2 ||
    innerBoundary.length < 10
  ) {
    return null;
  }

  return {
    road,
    outerBoundaries,
    innerBoundary,
    // Use the actual mesh boundary rows as the rendered replacement range.
    // These rows are aligned to original main-track samples and are forced closed,
    // so the replacement joins the normal road at identical edge vertices instead
    // of leaving occasional cross-track seams.
    startDistance: sections[0].distance,
    endDistance: sections[sections.length - 1].distance,
  };
}

function splitModuleSamples(
  samples: TrackSample[],
  module: TrackFeatures["splitModules"][number],
): TrackSample[] {
  // Split replacement meshes must start and end on exact main-track sample rows.
  // If they start at arbitrary interpolated distances, the main thick-ribbon mesh
  // and the split mesh terminate on different cross-sections, which creates the
  // occasional visible seams at fork/merge boundaries. Interior rows remain dense
  // and interpolated so the split floor still grades smoothly.
  const startIndex = Math.max(
    1,
    firstSampleIndexAtOrAfter(samples, module.startDistance),
  );
  const endIndex = Math.min(
    samples.length - 2,
    lastSampleIndexAtOrBefore(samples, module.endDistance),
  );

  if (endIndex <= startIndex + 3) {
    return [];
  }

  const startDistance = samples[startIndex].distance;
  const endDistance = samples[endIndex].distance;
  const span = Math.max(0.001, endDistance - startDistance);
  const targetStep = 0.42;
  const rowCount = Math.max(24, Math.ceil(span / targetStep));
  const result: TrackSample[] = [samples[startIndex]];

  for (let index = 1; index < rowCount; index += 1) {
    const distance = startDistance + (span * index) / rowCount;
    result.push(interpolatedSampleAtDistance(samples, distance));
  }

  result.push(samples[endIndex]);
  return result;
}

function firstSampleIndexAtOrAfter(
  samples: TrackSample[],
  distance: number,
): number {
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].distance >= distance) {
      return index;
    }
  }

  return samples.length - 1;
}

function lastSampleIndexAtOrBefore(
  samples: TrackSample[],
  distance: number,
): number {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].distance <= distance) {
      return index;
    }
  }

  return 0;
}

function interpolatedSampleAtDistance(
  samples: TrackSample[],
  distance: number,
): TrackSample {
  if (samples.length === 0) {
    throw new Error("Cannot sample an empty track");
  }

  if (distance <= samples[0].distance) {
    return samples[0];
  }

  const last = samples[samples.length - 1];
  if (distance >= last.distance) {
    return last;
  }

  let low = 0;
  let high = samples.length - 1;

  while (high - low > 1) {
    const middle = (low + high) >> 1;

    if (samples[middle].distance < distance) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const a = samples[low];
  const b = samples[high];
  const span = Math.max(0.0001, b.distance - a.distance);
  const alpha = clamp((distance - a.distance) / span, 0, 1);
  const tangent = normalize3({
    x: lerp(a.tangent.x, b.tangent.x, alpha),
    y: lerp(a.tangent.y, b.tangent.y, alpha),
    z: lerp(a.tangent.z, b.tangent.z, alpha),
  });
  const normal = normalizeXZ({
    x: lerp(a.normal.x, b.normal.x, alpha),
    z: lerp(a.normal.z, b.normal.z, alpha),
  });

  return {
    x: lerp(a.x, b.x, alpha),
    y: lerp(a.y, b.y, alpha),
    z: lerp(a.z, b.z, alpha),
    distance,
    tangent,
    normal,
    yaw: blendAngle(a.yaw, b.yaw, alpha),
    width: lerp(a.width, b.width, alpha),
    bank: lerp(a.bank, b.bank, alpha),
    surfaceFriction: lerp(a.surfaceFriction, b.surfaceFriction, alpha),
  };
}

function normalizeXZ(value: { x: number; z: number }): {
  x: number;
  z: number;
} {
  const length = Math.hypot(value.x, value.z) || 1;
  return { x: value.x / length, z: value.z / length };
}

function createSplitSection(
  sample: TrackSample,
  module: TrackFeatures["splitModules"][number],
  forceClosed = false,
): SplitSection {
  const active = forceClosed
    ? 0
    : naturalSplitOpenAmount(sample.distance, module);
  const t = clamp(
    (sample.distance - module.startDistance) /
      Math.max(module.endDistance - module.startDistance, 0.0001),
    0,
    1,
  );
  const baseHalfWidth = (sample.width ?? TRACK_WIDTH) / 2;
  const leftWave =
    Math.sin(
      t * Math.PI * 2 * module.leftProfile.curveCycles +
        module.leftProfile.curvePhase,
    ) * active;
  const rightWave =
    Math.sin(
      t * Math.PI * 2 * module.rightProfile.curveCycles +
        module.rightProfile.curvePhase,
    ) * active;
  const leftLaneWidth =
    module.laneWidth *
    lerp(
      1,
      clamp(
        module.leftProfile.widthScale +
          leftWave * module.leftProfile.widthWaveAmplitude * 0.14,
        0.94,
        1.55,
      ),
      active,
    );
  const rightLaneWidth =
    module.laneWidth *
    lerp(
      1,
      clamp(
        module.rightProfile.widthScale +
          rightWave * module.rightProfile.widthWaveAmplitude * 0.14,
        0.94,
        1.55,
      ),
      active,
    );
  const leftGap =
    module.laneSeparation *
    active *
    0.5 *
    lerp(1, clamp(module.leftProfile.separationScale, 0.75, 1.8), active);
  const rightGap =
    module.laneSeparation *
    active *
    0.5 *
    lerp(1, clamp(module.rightProfile.separationScale, 0.75, 1.8), active);
  const centerSway =
    Math.sin(t * Math.PI * 2 + module.wavePhase) *
    module.laneSeparation *
    module.widthWaveAmplitude *
    active *
    0.12;
  const leftRouteOffset = leftWave * module.leftProfile.curveAmplitude * active;
  const rightRouteOffset =
    rightWave * module.rightProfile.curveAmplitude * active;
  const leftLongitudinal =
    Math.sin(
      t * Math.PI * 2 * module.leftProfile.curveCycles +
        module.leftProfile.tangentPhase,
    ) *
    module.leftProfile.tangentAmplitude *
    active;
  const rightLongitudinal =
    Math.sin(
      t * Math.PI * 2 * module.rightProfile.curveCycles +
        module.rightProfile.tangentPhase,
    ) *
    module.rightProfile.tangentAmplitude *
    active;
  const outerLeftOffset = lerp(
    -baseHalfWidth,
    centerSway - leftGap - leftLaneWidth + leftRouteOffset,
    active,
  );
  const innerLeftOffset = centerSway - leftGap + leftRouteOffset;
  const innerRightOffset = centerSway + rightGap + rightRouteOffset;
  const outerRightOffset = lerp(
    baseHalfWidth,
    centerSway + rightGap + rightLaneWidth + rightRouteOffset,
    active,
  );

  return {
    outerLeft: pointAtSampleOffset(
      sample,
      outerLeftOffset,
      0.02,
      leftLongitudinal,
    ),
    innerLeft: pointAtSampleOffset(
      sample,
      innerLeftOffset,
      0.02,
      leftLongitudinal,
    ),
    innerRight: pointAtSampleOffset(
      sample,
      innerRightOffset,
      0.02,
      rightLongitudinal,
    ),
    outerRight: pointAtSampleOffset(
      sample,
      outerRightOffset,
      0.02,
      rightLongitudinal,
    ),
    active,
    distance: sample.distance,
  };
}

function naturalSplitOpenAmount(
  distance: number,
  module: TrackFeatures["splitModules"][number],
): number {
  const open = smootherstep(
    module.startDistance,
    module.laneStartDistance,
    distance,
  );
  const close =
    1 - smootherstep(module.laneEndDistance, module.endDistance, distance);
  return clamp(Math.min(open, close), 0, 1);
}

function pointAtSampleOffset(
  sample: TrackSample,
  offset: number,
  lift: number,
  longitudinalOffset = 0,
): BoundaryPoint {
  return {
    x:
      sample.x +
      sample.normal.x * offset +
      sample.tangent.x * longitudinalOffset,
    y: sample.y + lift + Math.sin(sample.bank ?? 0) * offset,
    z:
      sample.z +
      sample.normal.z * offset +
      sample.tangent.z * longitudinalOffset,
  };
}

function createNaturalSplitRoadMesh(sections: SplitSection[]): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const section of sections) {
    const closedRows = splitRoadClosedRow(section);
    for (const point of section.active < SPLIT_ISLAND_ACTIVE_THRESHOLD
      ? closedRows
      : splitRoadOpenRow(section)) {
      pushBoundaryPoint(positions, point);
    }
  }

  const rowSize = 8;

  for (let index = 0; index < sections.length - 1; index += 1) {
    const start = index * rowSize;
    const next = start + rowSize;
    const active = Math.max(sections[index].active, sections[index + 1].active);

    if (active < SPLIT_ISLAND_ACTIVE_THRESHOLD) {
      for (let column = 0; column < rowSize - 1; column += 1) {
        addQuad(
          indices,
          start + column,
          next + column,
          start + column + 1,
          next + column + 1,
        );
      }
    } else {
      for (let column = 0; column < 3; column += 1) {
        addQuad(
          indices,
          start + column,
          next + column,
          start + column + 1,
          next + column + 1,
        );
      }

      for (let column = 4; column < 7; column += 1) {
        addQuad(
          indices,
          start + column,
          next + column,
          start + column + 1,
          next + column + 1,
        );
      }
    }
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function splitRoadClosedRow(section: SplitSection): BoundaryPoint[] {
  return [
    section.outerLeft,
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 1 / 7),
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 2 / 7),
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 3 / 7),
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 4 / 7),
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 5 / 7),
    lerpBoundaryPoint(section.outerLeft, section.outerRight, 6 / 7),
    section.outerRight,
  ];
}

function splitRoadOpenRow(section: SplitSection): BoundaryPoint[] {
  return [
    section.outerLeft,
    lerpBoundaryPoint(section.outerLeft, section.innerLeft, 1 / 3),
    lerpBoundaryPoint(section.outerLeft, section.innerLeft, 2 / 3),
    section.innerLeft,
    section.innerRight,
    lerpBoundaryPoint(section.innerRight, section.outerRight, 1 / 3),
    lerpBoundaryPoint(section.innerRight, section.outerRight, 2 / 3),
    section.outerRight,
  ];
}

function pushBoundaryPoint(positions: number[], point: BoundaryPoint): void {
  positions.push(point.x, point.y, point.z);
}

function addQuad(
  indices: number[],
  a0: number,
  b0: number,
  a1: number,
  b1: number,
): void {
  indices.push(a0, b0, a1, a1, b0, b1);
}

function hasEnoughNaturalSplitClearance(
  sections: SplitSection[],
  module: TrackFeatures["splitModules"][number],
): boolean {
  const matureSections = sections.filter((section) => section.active > 0.94);

  if (matureSections.length < 4) {
    return false;
  }

  const minLaneWidth = Math.max(MIN_SPLIT_LANE_WIDTH, module.laneWidth * 0.86);
  const minIslandWidth = 0.95;

  for (const section of matureSections) {
    const leftLaneWidth = horizontalDistance(
      section.outerLeft,
      section.innerLeft,
    );
    const rightLaneWidth = horizontalDistance(
      section.innerRight,
      section.outerRight,
    );
    const islandWidth = horizontalDistance(
      section.innerLeft,
      section.innerRight,
    );

    if (
      leftLaneWidth < minLaneWidth ||
      rightLaneWidth < minLaneWidth ||
      islandWidth < minIslandWidth
    ) {
      return false;
    }
  }

  return true;
}

function createRoundedSplitIslandBoundary(
  sections: SplitSection[],
): BoundaryPoint[] {
  // Match the road split threshold so the island wall starts exactly where the
  // split road mesh first opens into two lanes. Keep this threshold high enough
  // to avoid needle-thin island caps that create tiny triangles and protruding
  // wall pieces at fork/merge transitions.
  const activeSections = sections.filter(
    (section) => section.active >= SPLIT_ISLAND_ACTIVE_THRESHOLD,
  );

  if (activeSections.length < 4) {
    return [];
  }

  const left = activeSections.map((section) => section.innerLeft);
  const right = activeSections.map((section) => section.innerRight);
  const startLeft = left[0];
  const startRight = right[0];
  const endLeft = left[left.length - 1];
  const endRight = right[right.length - 1];
  const startMid = midpointBoundary(startLeft, startRight);
  const endMid = midpointBoundary(endLeft, endRight);
  const startNextMid = midpointBoundary(
    left[Math.min(2, left.length - 1)],
    right[Math.min(2, right.length - 1)],
  );
  const endPreviousMid = midpointBoundary(
    left[Math.max(0, left.length - 3)],
    right[Math.max(0, right.length - 3)],
  );
  const startTangent = normalizeBoundaryDirection(startMid, startNextMid);
  const endTangent = normalizeBoundaryDirection(endPreviousMid, endMid);
  const startGap = horizontalDistance(startLeft, startRight);
  const endGap = horizontalDistance(endLeft, endRight);
  // Keep cap control points inside the island footprint. A large fixed bulge on
  // a barely-open island was the main source of occasional spike/triangle
  // artifacts near split entry/exit.
  const startBulge = clamp(startGap * 0.42, 0.12, 0.5);
  const endBulge = clamp(endGap * 0.42, 0.12, 0.5);

  const endCap = quadraticBoundaryArc(
    endLeft,
    offsetBoundary(endMid, endTangent.x * endBulge, endTangent.z * endBulge),
    endRight,
    9,
  ).slice(1);
  const startCap = quadraticBoundaryArc(
    startRight,
    offsetBoundary(
      startMid,
      -startTangent.x * startBulge,
      -startTangent.z * startBulge,
    ),
    startLeft,
    9,
  ).slice(1);

  // Keep the island wall loop edge-anchored to the actual split road inner edges.
  // The cap arcs are rounded, but the longitudinal sides are not independently
  // smoothed; smoothing here causes wall/road mismatch.
  return dedupeBoundaryPoints([
    ...left,
    ...endCap,
    ...right.reverse(),
    ...startCap,
  ]);
}

function isCleanSplitSurfaceGeometry(
  sections: SplitSection[],
  outerBoundaries: BoundaryPoint[][],
  innerBoundary: BoundaryPoint[],
): boolean {
  if (
    hasSharpBoundaryTurns(innerBoundary, true) ||
    hasBoundarySelfNearMiss(innerBoundary, true, 0.35)
  ) {
    return false;
  }

  for (const boundary of outerBoundaries) {
    if (
      hasSharpBoundaryTurns(boundary, false) ||
      hasBoundarySelfNearMiss(boundary, false, 0.35)
    ) {
      return false;
    }
  }

  for (let index = 4; index < sections.length - 4; index += 4) {
    const previous = sections[index - 4];
    const current = sections[index];
    const next = sections[index + 4];

    if (current.active < 0.72) {
      continue;
    }

    const leftWidth = horizontalDistance(current.outerLeft, current.innerLeft);
    const rightWidth = horizontalDistance(current.innerRight, current.outerRight);
    const islandWidth = horizontalDistance(current.innerLeft, current.innerRight);
    const leftTurn = boundaryTurnAmount(previous.innerLeft, current.innerLeft, next.innerLeft);
    const rightTurn = boundaryTurnAmount(previous.innerRight, current.innerRight, next.innerRight);

    if (
      leftWidth < MIN_SPLIT_LANE_WIDTH ||
      rightWidth < MIN_SPLIT_LANE_WIDTH ||
      islandWidth < MIN_SPLIT_BOUNDARY_CLEARANCE ||
      leftTurn > 0.95 ||
      rightTurn > 0.95
    ) {
      return false;
    }
  }

  return true;
}

function hasSharpBoundaryTurns(points: BoundaryPoint[], closed: boolean): boolean {
  const count = points.length;
  const start = closed ? 0 : 1;
  const end = closed ? count : count - 1;

  if (count < 4) {
    return true;
  }

  for (let index = start; index < end; index += 1) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index % count];
    const next = points[(index + 1) % count];

    if (boundaryTurnAmount(previous, current, next) > 1.25) {
      return true;
    }
  }

  return false;
}

function hasBoundarySelfNearMiss(
  points: BoundaryPoint[],
  closed: boolean,
  clearance: number,
): boolean {
  const segmentCount = closed ? points.length : points.length - 1;

  for (let a = 0; a < segmentCount; a += 1) {
    const a1 = points[a];
    const a2 = points[(a + 1) % points.length];

    for (let b = a + 2; b < segmentCount; b += 1) {
      if (closed && (a === 0 && b === segmentCount - 1)) {
        continue;
      }

      const b1 = points[b];
      const b2 = points[(b + 1) % points.length];

      if (
        boundarySegmentsIntersect(a1, a2, b1, b2) ||
        boundarySegmentDistance2d(a1, a2, b1, b2) < clearance
      ) {
        return true;
      }
    }
  }

  return false;
}

function boundaryTurnAmount(
  previous: BoundaryPoint,
  current: BoundaryPoint,
  next: BoundaryPoint,
): number {
  const a = Math.atan2(current.z - previous.z, current.x - previous.x);
  const b = Math.atan2(next.z - current.z, next.x - current.x);
  return Math.abs(wrapAngle(b - a));
}

function boundarySegmentsIntersect(
  a1: BoundaryPoint,
  a2: BoundaryPoint,
  b1: BoundaryPoint,
  b2: BoundaryPoint,
): boolean {
  const d1 = boundaryDirection(a1, a2, b1);
  const d2 = boundaryDirection(a1, a2, b2);
  const d3 = boundaryDirection(b1, b2, a1);
  const d4 = boundaryDirection(b1, b2, a2);

  return d1 * d2 < 0 && d3 * d4 < 0;
}

function boundaryDirection(
  a: BoundaryPoint,
  b: BoundaryPoint,
  c: BoundaryPoint,
): number {
  return (c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x);
}

function boundarySegmentDistance2d(
  a1: BoundaryPoint,
  a2: BoundaryPoint,
  b1: BoundaryPoint,
  b2: BoundaryPoint,
): number {
  if (boundarySegmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }

  return Math.min(
    boundaryPointSegmentDistance2d(a1, b1, b2),
    boundaryPointSegmentDistance2d(a2, b1, b2),
    boundaryPointSegmentDistance2d(b1, a1, a2),
    boundaryPointSegmentDistance2d(b2, a1, a2),
  );
}

function boundaryPointSegmentDistance2d(
  point: BoundaryPoint,
  a: BoundaryPoint,
  b: BoundaryPoint,
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz || 1;
  const t = clamp(
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq,
    0,
    1,
  );
  const x = a.x + dx * t;
  const z = a.z + dz * t;

  return Math.hypot(point.x - x, point.z - z);
}

function midpointBoundary(a: BoundaryPoint, b: BoundaryPoint): BoundaryPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function normalizeBoundaryDirection(
  a: BoundaryPoint,
  b: BoundaryPoint,
): { x: number; z: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

function offsetBoundary(
  point: BoundaryPoint,
  dx: number,
  dz: number,
): BoundaryPoint {
  return { x: point.x + dx, y: point.y, z: point.z + dz };
}

function quadraticBoundaryArc(
  start: BoundaryPoint,
  control: BoundaryPoint,
  end: BoundaryPoint,
  steps: number,
): BoundaryPoint[] {
  const points: BoundaryPoint[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const omt = 1 - t;
    points.push({
      x: omt * omt * start.x + 2 * omt * t * control.x + t * t * end.x,
      y: omt * omt * start.y + 2 * omt * t * control.y + t * t * end.y,
      z: omt * omt * start.z + 2 * omt * t * control.z + t * t * end.z,
    });
  }

  return points;
}

function smoothBoundaryPath(
  points: BoundaryPoint[],
  closed: boolean,
  iterations: number,
): BoundaryPoint[] {
  let smoothed = dedupeBoundaryPoints(points);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (smoothed.length < 3) {
      return smoothed;
    }

    const next: BoundaryPoint[] = [];
    const count = smoothed.length;
    const segmentCount = closed ? count : count - 1;

    if (!closed) {
      next.push(smoothed[0]);
    }

    for (let index = 0; index < segmentCount; index += 1) {
      const a = smoothed[index];
      const b = smoothed[(index + 1) % count];

      next.push(lerpBoundaryPoint(a, b, 0.25), lerpBoundaryPoint(a, b, 0.75));
    }

    if (!closed) {
      next.push(smoothed[count - 1]);
    }

    smoothed = dedupeBoundaryPoints(next);
  }

  return smoothed;
}

function lerpBoundaryPoint(
  a: BoundaryPoint,
  b: BoundaryPoint,
  alpha: number,
): BoundaryPoint {
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

function dedupeBoundaryPoints(points: BoundaryPoint[]): BoundaryPoint[] {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    return (
      Math.hypot(
        point.x - points[index - 1].x,
        point.y - points[index - 1].y,
        point.z - points[index - 1].z,
      ) > 0.04
    );
  });
}

function horizontalDistance(a: BoundaryPoint, b: BoundaryPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function createSplitLaneSamples(
  samples: TrackSample[],
  module: TrackFeatures["splitModules"][number],
  side: -1 | 1,
  rng: () => number,
): TrackSample[] {
  void rng;
  const profile = side < 0 ? module.leftProfile : module.rightProfile;
  const length = module.endDistance - module.startDistance;
  const connectorFraction = clamp(
    (module.laneStartDistance - module.startDistance) /
      Math.max(length, 0.0001),
    0.26,
    0.42,
  );
  const laneSamples = [
    sampleAtDistance(samples, module.startDistance),
    sampleAtDistance(samples, module.laneStartDistance),
    ...samples.filter(
      (sample) =>
        sample.distance > module.startDistance &&
        sample.distance < module.endDistance,
    ),
    sampleAtDistance(samples, module.laneEndDistance),
    sampleAtDistance(samples, module.endDistance),
  ]
    .sort((a, b) => a.distance - b.distance)
    .filter(
      (sample, index, sorted) =>
        index === 0 ||
        Math.abs(sample.distance - sorted[index - 1].distance) > 0.001,
    )
    .map((sample) => ({ ...sample }));

  const positionedSamples = laneSamples.map((sample) => {
    const t = clamp(
      (sample.distance - module.startDistance) / Math.max(length, 0.0001),
      0,
      1,
    );
    const peelOut = smootherstep(0, connectorFraction * profile.startEase, t);
    const peelIn =
      1 - smootherstep(1 - connectorFraction * profile.endEase, 1, t);
    const envelope = peelOut * peelIn;
    const routeEnvelope = envelope;
    const separation =
      module.laneSeparation * profile.separationScale * routeEnvelope;
    const routeCurve =
      Math.sin(t * Math.PI * profile.curveCycles + profile.curvePhase) *
      profile.curveAmplitude *
      envelope;
    const tangentDrift =
      Math.sin(t * Math.PI * 2 + profile.tangentPhase) *
      profile.tangentAmplitude *
      envelope *
      Math.sin(t * Math.PI);
    const contour = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + profile.curvePhase);
    const width =
      module.laneWidth * profile.widthScale +
      profile.widthWaveAmplitude * contour * envelope;
    const blendedWidth = lerp(
      sample.width ?? TRACK_WIDTH,
      clamp(width, MIN_SPLIT_LANE_WIDTH, TRACK_WIDTH * 1.7),
      envelope,
    );

    return {
      ...sample,
      x:
        sample.x +
        sample.normal.x * side * (separation + routeCurve) +
        sample.tangent.x * tangentDrift,
      y:
        sample.y -
        Math.sin(t * Math.PI) * length * 0.0025 +
        Math.sin(t * Math.PI * 2 + profile.curvePhase * 0.7) *
          profile.heightAmplitude *
          envelope,
      z:
        sample.z +
        sample.normal.z * side * (separation + routeCurve) +
        sample.tangent.z * tangentDrift,
      width: blendedWidth,
      bank: clamp(
        side * envelope * 0.08 +
          Math.sin(t * Math.PI * 2 + profile.curvePhase) *
            profile.bankAmplitude *
            envelope,
        -0.24,
        0.24,
      ),
    };
  });

  return recalculateSampleFrames(positionedSamples);
}

function splitBranchWallSamples(
  branchSamples: TrackSample[],
  module: TrackFeatures["splitModules"][number],
): TrackSample[] {
  return branchSamples.filter(
    (sample) =>
      sample.distance >= module.laneStartDistance &&
      sample.distance <= module.laneEndDistance,
  );
}

function recalculateSampleFrames(samples: TrackSample[]): TrackSample[] {
  return samples.map((sample, index) => {
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const tangent = normalize3({
      x: after.x - before.x,
      y: after.y - before.y,
      z: after.z - before.z,
    });
    const flatLength = Math.hypot(tangent.x, tangent.z) || 1;
    const flatTangent = {
      x: tangent.x / flatLength,
      z: tangent.z / flatLength,
    };

    return {
      ...sample,
      tangent,
      normal: { x: flatTangent.z, z: -flatTangent.x },
      yaw: Math.atan2(flatTangent.x, flatTangent.z),
    };
  });
}

function createSplitModules(
  rng: () => number,
  finishDistance: number,
  samples: TrackSample[],
): TrackFeatures["splitModules"] {
  const maxSplits =
    finishDistance > 1800
      ? 5
      : finishDistance > 1300
        ? 4
        : finishDistance > 850
          ? 3
          : 2;
  const count = 1 + Math.floor(rng() * maxSplits);
  const modules: TrackFeatures["splitModules"] = [];

  for (
    let attempt = 0;
    attempt < count * 80 && modules.length < count;
    attempt += 1
  ) {
    const length = clamp(randomSplitLength(rng, finishDistance), 86, 190);
    const startDistance = finishDistance * (0.12 + rng() * 0.68);
    const endDistance = startDistance + length;

    if (endDistance > finishDistance - 34) {
      continue;
    }

    const startSample = sampleAtDistance(samples, startDistance);
    const middleSample = sampleAtDistance(
      samples,
      (startDistance + endDistance) / 2,
    );
    const endSample = sampleAtDistance(samples, endDistance);
    const hasEnoughSpace =
      (startSample.width ?? TRACK_WIDTH) >= MIN_MAIN_TRACK_WIDTH &&
      (middleSample.width ?? TRACK_WIDTH) >= MIN_MAIN_TRACK_WIDTH &&
      (endSample.width ?? TRACK_WIDTH) >= MIN_MAIN_TRACK_WIDTH;
    const splitIsStraightEnough = isBranchSectionSafe(
      samples,
      startDistance,
      endDistance,
    );
    const separated = modules.every(
      (module) =>
        endDistance < module.startDistance - 48 ||
        startDistance > module.endDistance + 48,
    );

    if (!hasEnoughSpace || !splitIsStraightEnough || !separated) {
      continue;
    }

    const laneWidth = TRACK_WIDTH * (1.04 + rng() * 0.14);
    const endpointOverlap = clamp(length * 0.28, 24, 48);
    const laneSeparation = laneWidth + 2.4 + rng() * 1.8;
    const module = {
      startDistance,
      endDistance,
      laneStartDistance: startDistance + endpointOverlap,
      laneEndDistance: endDistance - endpointOverlap,
      laneWidth,
      laneSeparation,
      waveAmplitude: 0,
      waveCycles: 1,
      wavePhase: rng() * Math.PI * 2,
      widthScale: 1,
      widthWaveAmplitude: 0,
      bankAmplitude: 0,
      heightAmplitude: 0,
      widthBoost: 0,
      side: (rng() < 0.5 ? -1 : 1) as -1 | 1,
      leftProfile: createSplitLaneProfile(rng, -1),
      rightProfile: createSplitLaneProfile(rng, 1),
    };
    const leftBranch = createSplitLaneSamples(samples, module, -1, rng);
    const rightBranch = createSplitLaneSamples(samples, module, 1, rng);

    if (!isSplitRoutePairSafe(samples, leftBranch, rightBranch, module)) {
      continue;
    }

    modules.push(module);
  }

  return modules.sort((a, b) => a.startDistance - b.startDistance);
}

function randomSplitLength(rng: () => number, finishDistance: number): number {
  const range = Math.pow(rng(), 1.08) * 0.24;
  const longTail = Math.pow(rng(), 4) * 0.14;
  return clamp(finishDistance * (0.055 + range + longTail), 44, 300);
}

function createSplitLaneProfile(
  rng: () => number,
  side: -1 | 1,
): SplitLaneProfile {
  void rng;

  return {
    startEase: 1,
    endEase: 1,
    separationScale: 1,
    curveAmplitude: 0,
    curveCycles: 1,
    curvePhase: side * 0.01,
    tangentAmplitude: 0,
    tangentPhase: 0,
    widthScale: 1,
    widthWaveAmplitude: 0,
    bankAmplitude: 0.012,
    heightAmplitude: 0,
  };
}

function isBranchSectionSafe(
  samples: TrackSample[],
  startDistance: number,
  endDistance: number,
): boolean {
  const sampleCount = 8;
  let previous = sampleAtDistance(samples, startDistance);
  let yawDrift = 0;
  let pitchDrift = 0;

  for (let index = 1; index <= sampleCount; index += 1) {
    const distance =
      startDistance + ((endDistance - startDistance) * index) / sampleCount;
    const current = sampleAtDistance(samples, distance);
    yawDrift += Math.abs(wrapAngle(current.yaw - previous.yaw));
    pitchDrift += Math.abs(current.tangent.y - previous.tangent.y);
    previous = current;
  }

  return yawDrift < 1.15 && pitchDrift < 0.55;
}

function isBranchSectionSafeRelaxed(
  samples: TrackSample[],
  startDistance: number,
  endDistance: number,
): boolean {
  const sampleCount = 8;
  let previous = sampleAtDistance(samples, startDistance);
  let yawDrift = 0;
  let pitchDrift = 0;

  for (let index = 1; index <= sampleCount; index += 1) {
    const distance =
      startDistance + ((endDistance - startDistance) * index) / sampleCount;
    const current = sampleAtDistance(samples, distance);
    yawDrift += Math.abs(wrapAngle(current.yaw - previous.yaw));
    pitchDrift += Math.abs(current.tangent.y - previous.tangent.y);
    previous = current;
  }

  return yawDrift < 2.45 && pitchDrift < 0.95;
}

function isSplitRoutePairSafe(
  mainSamples: TrackSample[],
  leftBranch: TrackSample[],
  rightBranch: TrackSample[],
  module: TrackFeatures["splitModules"][number],
): boolean {
  void mainSamples;
  const length = module.endDistance - module.startDistance;

  if (
    hasBadTrackGeometry(leftBranch, length) ||
    hasBadTrackGeometry(rightBranch, length) ||
    hasTrapRiskRoute(leftBranch) ||
    hasTrapRiskRoute(rightBranch)
  ) {
    return false;
  }

  for (let index = 3; index < leftBranch.length - 3; index += 6) {
    const left = leftBranch[index];
    const right = rightBranch[index];
    const t = clamp(
      (left.distance - module.startDistance) / Math.max(length, 0.0001),
      0,
      1,
    );
    const expectedGap =
      ((left.width ?? TRACK_WIDTH) + (right.width ?? TRACK_WIDTH)) / 2 + 1.4;

    if (
      Math.hypot(left.x - right.x, left.z - right.z) < expectedGap &&
      t > 0.12 &&
      t < 0.88
    ) {
      return false;
    }
  }

  return true;
}

function createFeatures(
  samples: TrackSample[],
  mapRng: () => number,
  rng: () => number,
  finishDistance: number,
): TrackFeatures {
  void rng;
  const wideZones: TrackFeatures["wideZones"] = [
    {
      startDistance: finishDistance * (0.08 + mapRng() * 0.06),
      endDistance: finishDistance * (0.2 + mapRng() * 0.08),
      extraWidth: 0.4 + mapRng() * 2.5,
      kind: "funnel",
    },
    {
      startDistance: finishDistance * (0.32 + mapRng() * 0.12),
      endDistance: finishDistance * (0.48 + mapRng() * 0.12),
      extraWidth: -0.35 + mapRng() * 3.2,
      kind: "bowl",
    },
    {
      startDistance: finishDistance * (0.62 + mapRng() * 0.1),
      endDistance: finishDistance * (0.78 + mapRng() * 0.08),
      extraWidth: 1.2 + mapRng() * 4.4,
      kind: "split",
    },
  ];
  const extraWidthZones = 4 + Math.floor(mapRng() * 7);

  for (let index = 0; index < extraWidthZones; index += 1) {
    const start = finishDistance * (0.08 + mapRng() * 0.78);
    const length = finishDistance * (0.035 + mapRng() * 0.14);
    const splitBiased = mapRng() < 0.55;

    wideZones.push({
      startDistance: start,
      endDistance: Math.min(finishDistance * 0.96, start + length),
      extraWidth: splitBiased ? 1.0 + mapRng() * 4.2 : -0.45 + mapRng() * 3.4,
      kind: splitBiased ? "split" : mapRng() < 0.5 ? "funnel" : "bowl",
    });
  }

  const splitModules = createSplitModules(mapRng, finishDistance, samples);
  for (const module of splitModules) {
    wideZones.push({
      startDistance: Math.max(0, module.startDistance - 10),
      endDistance: Math.min(finishDistance * 0.97, module.endDistance + 10),
      extraWidth: 1.1 + mapRng() * 3.2,
      kind: "split",
    });
  }

  return {
    wideZones,
    pegs: [],
    greenBumpers: [],
    gates: [],
    trappers: [],
    spinners: [],
    hammers: [],
    turnstiles: [],
    powerups: [],
    splitModules,
  };
}

type CourseFeatureRoute = {
  id: string;
  samples: TrackSample[];
  startDistance: number;
  endDistance: number;
  weight: number;
};

type FeatureReservation = {
  routeId: string;
  distance: number;
  radius: number;
  x: number;
  y: number;
  z: number;
};

type FeaturePlacement = {
  route: CourseFeatureRoute;
  distance: number;
  offset: number;
  routeOffset: number;
  mainOffset: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
};

function featurePlacementFields(placement: FeaturePlacement): {
  distance: number;
  offset: number;
  routeId: string;
  routeOffset: number;
  mainOffset: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
} {
  return {
    distance: placement.distance,
    offset: placement.routeOffset,
    routeId: placement.route.id,
    routeOffset: placement.routeOffset,
    mainOffset: placement.mainOffset,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    yaw: placement.yaw,
    width: placement.width,
  };
}

function populateCourseFeatures(
  features: TrackFeatures,
  samples: TrackSample[],
  branches: TrackDefinition["branches"],
  splitSurfaces: SplitSurface[],
  rng: () => number,
  finishDistance: number,
): void {
  const routes = createFeatureRoutes(
    samples,
    branches,
    splitSurfaces,
    finishDistance,
  );
  const reserved: FeatureReservation[] = [];
  const mix = chooseObstacleMix(rng);
  const lengthScale = clamp(finishDistance / 650, 0.85, 1.75);
  const densityScale = 0.48 + rng() * 1.08;
  const obstacleDensityScale = clamp(lengthScale * densityScale, 0.72, 2.05);
  const powerupKinds: PowerupKind[] = [
    "speed",
    "giant",
    "tiny",
    "ghost",
    "slow",
    "barrier",
    "smash",
  ];

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    mix.gates
      ? Math.round((1 + Math.floor(rng() * 4)) * obstacleDensityScale)
      : 0,
    4.9,
    samples,
    centerOffset,
  )) {
    features.gates.push({
      ...featurePlacementFields(placement),
      phase: rng() * 20,
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    rng() < 0.72
      ? Math.round((1 + Math.floor(rng() * 3)) * obstacleDensityScale)
      : 0,
    5.4,
    samples,
    centerOffset,
  )) {
    features.trappers.push({
      ...featurePlacementFields(placement),
      phase: rng() * 18,
      radius: 0.95 + rng() * 0.45,
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    mix.spinners
      ? Math.round((1 + Math.floor(rng() * 6)) * obstacleDensityScale)
      : 0,
    4.4,
    samples,
    centerOffset,
  )) {
    features.spinners.push({
      ...featurePlacementFields(placement),
      phase: rng() * Math.PI * 2,
      speed: (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.9),
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    mix.hammers
      ? Math.round((1 + Math.floor(rng() * 4)) * obstacleDensityScale)
      : 0,
    4.8,
    samples,
    laneSideOffset(rng, 0.35, 0.9),
  )) {
    features.hammers.push({
      ...featurePlacementFields(placement),
      phase: rng() * Math.PI * 2,
      side: (rng() < 0.5 ? -1 : 1) as -1 | 1,
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    mix.turnstiles
      ? Math.round((1 + Math.floor(rng() * 4)) * obstacleDensityScale)
      : 0,
    4.8,
    samples,
    centerOffset,
  )) {
    features.turnstiles.push({
      ...featurePlacementFields(placement),
      phase: rng() * Math.PI * 2,
      speed: (rng() < 0.5 ? -1 : 1) * (0.28 + rng() * 0.22),
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    Math.round((5 + Math.floor(rng() * 22)) * lengthScale * densityScale),
    1.8,
    samples,
    laneSideOffset(rng, 0.35, 1.15),
  )) {
    features.greenBumpers.push({
      ...featurePlacementFields(placement),
      radius: 0.28 + rng() * 0.08,
    });
  }

  for (const placement of placeCourseFeatures(
    rng,
    routes,
    reserved,
    Math.round((6 + Math.floor(rng() * 21)) * lengthScale * densityScale),
    1.55,
    samples,
    alternatingLaneOffset(0.45, 1.2),
  )) {
    features.pegs.push({
      ...featurePlacementFields(placement),
      radius: 0.17 + rng() * 0.045,
      phase: rng() * PEG_MOTION_PERIOD,
    });
  }

  for (const [index, placement] of placeCourseFeatures(
    rng,
    routes,
    reserved,
    5 + Math.floor(rng() * 7),
    3.4,
    samples,
    randomPowerupOffset(rng),
  ).entries()) {
    const kind = powerupKinds[Math.floor(rng() * powerupKinds.length)] ?? "speed";
    const laneExtent = Math.max(0.7, placement.width * 0.5 - 1.05);
    const laneOffsets = [-laneExtent, 0, laneExtent];

    for (const [laneIndex, laneOffset] of laneOffsets.entries()) {
      const lanePlacement = createFeaturePlacement(
        placement.route,
        placement.distance,
        laneOffset,
        samples,
      );

      features.powerups.push({
        id: `powerup-${index + 1}-${laneIndex + 1}`,
        ...featurePlacementFields(lanePlacement),
        kind,
      });
    }
  }

  sortFeaturesByDistance(features);
}

function createFeatureRoutes(
  samples: TrackSample[],
  branches: TrackDefinition["branches"],
  splitSurfaces: SplitSurface[],
  finishDistance: number,
): CourseFeatureRoute[] {
  void branches;
  const routes: CourseFeatureRoute[] = [];
  const splitRanges = splitSurfaces
    .map((surface) => ({
      start: Math.max(12, surface.startDistance + 8),
      end: Math.min(finishDistance - 18, surface.endDistance - 8),
    }))
    .filter((range) => range.end - range.start > 22)
    .sort((a, b) => a.start - b.start);
  let mainStart = 12;
  let mainIndex = 0;

  for (const range of splitRanges) {
    addFeatureRoute(
      routes,
      `main-${mainIndex}`,
      samples,
      mainStart,
      Math.min(range.start, finishDistance - 18),
      1,
    );
    mainStart = Math.max(mainStart, range.end);
    mainIndex += 1;
  }

  addFeatureRoute(
    routes,
    `main-${mainIndex}`,
    samples,
    mainStart,
    finishDistance - 18,
    1,
  );

  for (const [index, surface] of splitSurfaces.entries()) {
    const length = surface.endDistance - surface.startDistance;
    const margin = clamp(Math.max(12, length * 0.18), 12, 34);
    const start = Math.max(12, surface.startDistance + margin);
    const end = Math.min(finishDistance - 18, surface.endDistance - margin);

    if (end - start <= 22) {
      continue;
    }

    addFeatureRoute(
      routes,
      `split-${index}-left`,
      splitSurfaceLaneSamples(surface, -1),
      start,
      end,
      0.72,
    );
    addFeatureRoute(
      routes,
      `split-${index}-right`,
      splitSurfaceLaneSamples(surface, 1),
      start,
      end,
      0.72,
    );
  }

  return routes.filter((route) => route.endDistance - route.startDistance > 18);
}

function splitSurfaceLaneSamples(
  surface: SplitSurface,
  side: -1 | 1,
): TrackSample[] {
  const rowSize = 8;
  const vertices = surface.road.vertices;
  const rowCount = Math.floor(vertices.length / (rowSize * 3));
  const samples: TrackSample[] = [];

  if (rowCount <= 0) {
    return samples;
  }

  const leftColumn = side < 0 ? 0 : 4;
  const rightColumn = side < 0 ? 3 : 7;

  for (let row = 0; row < rowCount; row += 1) {
    const distance = lerp(
      surface.startDistance,
      surface.endDistance,
      rowCount <= 1 ? 0 : row / (rowCount - 1),
    );
    const previousRow = Math.max(0, row - 1);
    const nextRow = Math.min(rowCount - 1, row + 1);
    const left = splitSurfaceVertex(vertices, row, leftColumn, rowSize);
    const right = splitSurfaceVertex(vertices, row, rightColumn, rowSize);
    const previousCenter = midpointBoundary(
      splitSurfaceVertex(vertices, previousRow, leftColumn, rowSize),
      splitSurfaceVertex(vertices, previousRow, rightColumn, rowSize),
    );
    const nextCenter = midpointBoundary(
      splitSurfaceVertex(vertices, nextRow, leftColumn, rowSize),
      splitSurfaceVertex(vertices, nextRow, rightColumn, rowSize),
    );
    const center = midpointBoundary(left, right);
    const tangent = normalize3({
      x: nextCenter.x - previousCenter.x,
      y: nextCenter.y - previousCenter.y,
      z: nextCenter.z - previousCenter.z,
    });
    const normal = normalizeXZ({ x: right.x - left.x, z: right.z - left.z });
    const width = Math.max(0.1, Math.hypot(right.x - left.x, right.z - left.z));

    samples.push({
      x: center.x,
      y: center.y,
      z: center.z,
      distance,
      tangent,
      normal,
      yaw: Math.atan2(tangent.x, tangent.z),
      width,
      bank: Math.asin(clamp((right.y - left.y) / width, -0.35, 0.35)),
      surfaceFriction: 0.18,
    });
  }

  return samples;
}

function splitSurfaceVertex(
  vertices: Float32Array,
  row: number,
  column: number,
  rowSize: number,
): BoundaryPoint {
  const offset = (row * rowSize + column) * 3;
  return {
    x: vertices[offset],
    y: vertices[offset + 1],
    z: vertices[offset + 2],
  };
}

function addFeatureRoute(
  routes: CourseFeatureRoute[],
  id: string,
  sourceSamples: TrackSample[],
  startDistance: number,
  endDistance: number,
  weightScale: number,
): void {
  if (endDistance - startDistance <= 18 || sourceSamples.length < 2) {
    return;
  }

  const clipped = clipRouteSamples(sourceSamples, startDistance, endDistance);
  const safeSamples = clipped.filter(
    (sample) =>
      (sample.width ?? TRACK_WIDTH) >= MIN_FEATURE_ROUTE_WIDTH &&
      !isTrapRiskSample(clipped, sample.distance),
  );

  if (safeSamples.length < 2) {
    return;
  }

  const safeStart = Math.max(startDistance, safeSamples[0].distance + 2);
  const safeEnd = Math.min(
    endDistance,
    safeSamples[safeSamples.length - 1].distance - 2,
  );

  if (safeEnd - safeStart <= 18) {
    return;
  }

  routes.push({
    id,
    samples: clipRouteSamples(sourceSamples, safeStart, safeEnd),
    startDistance: safeStart,
    endDistance: safeEnd,
    weight: Math.max(1, safeEnd - safeStart) * weightScale,
  });
}

function clipRouteSamples(
  samples: TrackSample[],
  startDistance: number,
  endDistance: number,
): TrackSample[] {
  return [
    sampleAtDistance(samples, startDistance),
    ...samples.filter(
      (sample) =>
        sample.distance > startDistance && sample.distance < endDistance,
    ),
    sampleAtDistance(samples, endDistance),
  ];
}

function placeCourseFeatures(
  rng: () => number,
  routes: CourseFeatureRoute[],
  reserved: FeatureReservation[],
  count: number,
  radius: number,
  mainSamples: TrackSample[],
  localOffsetForSample: (sample: TrackSample, index: number) => number,
): FeaturePlacement[] {
  if (count <= 0 || routes.length === 0) {
    return [];
  }

  const placements: FeaturePlacement[] = [];
  const slots = shuffleStrings(
    Array.from({ length: count }, (_, index) => index),
    rng,
  );
  const maxAttempts = Math.max(80, count * 95);
  const totalRouteWeight = routes.reduce((sum, route) => sum + route.weight, 0);

  for (
    let attempt = 0;
    attempt < maxAttempts && placements.length < count;
    attempt += 1
  ) {
    const slot = slots[placements.length % slots.length] ?? placements.length;
    const progress = (slot + 0.12 + rng() * 0.76) / count;
    const route = routeAtWeightedProgress(
      routes,
      (progress + attempt * 0.38196601125) % 1,
      totalRouteWeight,
    );
    const distance = lerp(route.startDistance, route.endDistance, rng());
    const routeSample = sampleAtDistance(route.samples, distance);

    if (!isRouteFeatureSafe(route.samples, distance)) {
      continue;
    }

    if (isTrapRiskSample(route.samples, distance)) {
      continue;
    }

    const localOffset = clamp(
      localOffsetForSample(routeSample, placements.length),
      -maxFeatureOffset(routeSample, radius),
      maxFeatureOffset(routeSample, radius),
    );
    const placement = createFeaturePlacement(
      route,
      distance,
      localOffset,
      mainSamples,
    );

    if (!hasFeatureClearance(placement, radius, reserved)) {
      continue;
    }

    placements.push(placement);
    reserved.push({
      routeId: route.id,
      distance,
      radius,
      x: placement.x,
      y: placement.y,
      z: placement.z,
    });
  }

  return placements.sort((a, b) => a.distance - b.distance);
}

function removeTrapRiskFeatures(
  features: TrackFeatures,
  samples: TrackSample[],
  splitSurfaces: SplitSurface[],
): void {
  const routes = new Map<string, TrackSample[]>();
  routes.set("", samples);

  for (const [index, surface] of splitSurfaces.entries()) {
    routes.set(`split-${index}-left`, splitSurfaceLaneSamples(surface, -1));
    routes.set(`split-${index}-right`, splitSurfaceLaneSamples(surface, 1));
  }

  const keepSafe = <T extends { distance: number; routeId?: string }>(
    feature: T,
  ): boolean => {
    const route = routes.get(feature.routeId ?? "") ?? samples;
    return !isTrapRiskSample(route, feature.distance);
  };

  features.pegs = features.pegs.filter(keepSafe);
  features.greenBumpers = features.greenBumpers.filter(keepSafe);
  features.gates = features.gates.filter(keepSafe);
  features.trappers = features.trappers.filter(keepSafe);
  features.spinners = features.spinners.filter(keepSafe);
  features.hammers = features.hammers.filter(keepSafe);
  features.turnstiles = features.turnstiles.filter(keepSafe);
  features.powerups = features.powerups.filter(keepSafe);
}

function hasTrapRiskRoute(samples: TrackSample[]): boolean {
  for (let index = 4; index < samples.length - 4; index += 4) {
    if (isTrapRiskSample(samples, samples[index].distance)) {
      return true;
    }
  }

  return false;
}

function isTrapRiskSample(samples: TrackSample[], distance: number): boolean {
  if (samples.length < 3) {
    return true;
  }

  const before = sampleAtDistance(samples, Math.max(0, distance - 5));
  const current = sampleAtDistance(samples, distance);
  const after = sampleAtDistance(
    samples,
    Math.min(samples[samples.length - 1].distance, distance + 5),
  );
  const forwardRun = Math.hypot(after.x - before.x, after.z - before.z) || 1;
  const forwardDrop = before.y - after.y;
  const forwardSlope = forwardDrop / forwardRun;
  const bank = Math.abs(current.bank ?? 0);
  const width = current.width ?? TRACK_WIDTH;
  const longitudinalFlow = current.tangent.y < -0.035 || forwardSlope > 0.045;
  const wallCaptureRisk =
    bank > 0.18 && forwardSlope < 0.07 && width < TRACK_WIDTH * 1.14;

  return !longitudinalFlow || wallCaptureRisk;
}

function routeAtWeightedProgress(
  routes: CourseFeatureRoute[],
  progress: number,
  totalWeight: number,
): CourseFeatureRoute {
  let cursor = clamp(progress, 0, 0.999999) * totalWeight;

  for (const route of routes) {
    cursor -= route.weight;
    if (cursor <= 0) {
      return route;
    }
  }

  return routes[routes.length - 1];
}

function createFeaturePlacement(
  route: CourseFeatureRoute,
  distance: number,
  localOffset: number,
  mainSamples: TrackSample[],
): FeaturePlacement {
  const routeSample = sampleAtDistance(route.samples, distance);
  const mainSample = sampleAtDistance(mainSamples, distance);
  const dx = routeSample.x - mainSample.x;
  const dz = routeSample.z - mainSample.z;
  const routeCenterOffset = dx * mainSample.normal.x + dz * mainSample.normal.z;
  const mainOffset = routeCenterOffset + localOffset;
  const point = pointAtSampleOffset(routeSample, localOffset, 0.02);

  return {
    route,
    distance,
    offset: localOffset,
    routeOffset: localOffset,
    mainOffset,
    x: point.x,
    y: point.y,
    z: point.z,
    yaw: routeSample.yaw,
    width: routeSample.width ?? TRACK_WIDTH,
  };
}

function hasFeatureClearance(
  placement: FeaturePlacement,
  radius: number,
  reserved: FeatureReservation[],
): boolean {
  for (const item of reserved) {
    const sameRoute = item.routeId === placement.route.id;
    const distanceGap = Math.abs(item.distance - placement.distance);
    const horizontalGap = Math.hypot(
      item.x - placement.x,
      item.z - placement.z,
    );
    const verticalGap = Math.abs(item.y - placement.y);
    const required = item.radius + radius;

    if (sameRoute && distanceGap <= required * 1.25) {
      return false;
    }

    if (verticalGap < 4.5 && horizontalGap <= Math.max(3.2, required * 0.95)) {
      return false;
    }

    if (
      distanceGap <= required * 1.6 &&
      verticalGap < 5.4 &&
      horizontalGap <= Math.max(4.2, required * 1.15)
    ) {
      return false;
    }
  }

  return true;
}

function isRouteFeatureSafe(samples: TrackSample[], distance: number): boolean {
  const sample = sampleAtDistance(samples, distance);
  const before = sampleAtDistance(
    samples,
    Math.max(samples[0].distance, distance - 3.2),
  );
  const after = sampleAtDistance(
    samples,
    Math.min(samples[samples.length - 1].distance, distance + 3.2),
  );
  const yawDelta = Math.abs(wrapAngle(after.yaw - before.yaw));
  const pitchDelta = Math.abs(after.tangent.y - before.tangent.y);

  return (
    yawDelta < 0.58 &&
    pitchDelta < 0.36 &&
    Math.abs(sample.tangent.y) < 0.38 &&
    (sample.width ?? TRACK_WIDTH) >= MIN_FEATURE_ROUTE_WIDTH &&
    sample.distance > samples[0].distance + 3 &&
    sample.distance < samples[samples.length - 1].distance - 3
  );
}

function maxFeatureOffset(sample: TrackSample, radius: number): number {
  return Math.max(
    0,
    (sample.width ?? TRACK_WIDTH) / 2 - Math.max(0.62, radius * 0.5),
  );
}

function centerOffset(): number {
  return 0;
}

function laneSideOffset(
  rng: () => number,
  min: number,
  max: number,
): (sample: TrackSample) => number {
  return (sample) => {
    const sign = rng() < 0.5 ? -1 : 1;
    const limit = maxFeatureOffset(sample, 1.2);
    return sign * clamp(min + rng() * (max - min), 0, limit);
  };
}

function alternatingLaneOffset(
  min: number,
  max: number,
): (sample: TrackSample, index: number) => number {
  return (sample, index) => {
    const sign = index % 2 === 0 ? -1 : 1;
    const limit = maxFeatureOffset(sample, 1.0);
    return (
      sign * clamp(min + ((index * 0.61803398875) % 1) * (max - min), 0, limit)
    );
  };
}

function randomPowerupOffset(
  rng: () => number,
): (sample: TrackSample) => number {
  return (sample) => {
    const limit = Math.max(0.35, (sample.width ?? TRACK_WIDTH) / 2 - 0.9);
    return (rng() < 0.5 ? -1 : 1) * rng() * limit;
  };
}

function sortFeaturesByDistance(features: TrackFeatures): void {
  features.gates.sort((a, b) => a.distance - b.distance);
  features.trappers.sort((a, b) => a.distance - b.distance);
  features.spinners.sort((a, b) => a.distance - b.distance);
  features.hammers.sort((a, b) => a.distance - b.distance);
  features.turnstiles.sort((a, b) => a.distance - b.distance);
  features.greenBumpers.sort((a, b) => a.distance - b.distance);
  features.pegs.sort((a, b) => a.distance - b.distance);
  features.powerups.sort((a, b) => a.distance - b.distance);
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

function createPegDistances(
  rng: () => number,
  finishDistance: number,
): number[] {
  const distances: number[] = [];

  for (
    let distance = 12;
    distance < finishDistance - 8;
    distance += 2.3 + rng() * 4.8
  ) {
    distances.push(distance + (rng() - 0.5) * 1.9);
  }

  const endStart = finishDistance * 0.9;
  for (
    let distance = endStart;
    distance < finishDistance - 4;
    distance += 1.8 + rng() * 2.6
  ) {
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
  const kinds: PowerupKind[] = [
    "speed",
    "giant",
    "tiny",
    "ghost",
    "slow",
    "barrier",
    "smash",
  ];
  const count = 5 + Math.floor(rng() * 7);

  return pickFeatureDistances(
    rng,
    finishDistance,
    count,
    2.0,
    reserved,
    samples,
    false,
    0,
  ).map((distance, index) => {
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
  const candidates = shuffleStrings(
    createPegDistances(rng, finishDistance),
    rng,
  );
  const distances: number[] = [];

  for (const distance of candidates) {
    if (distances.length >= count) {
      break;
    }

    const ok =
      isFeatureSafe(samples, distance) &&
      reserved.every(
        (item) => Math.abs(item.distance - distance) > item.radius + 0.68,
      );

    if (!ok) {
      continue;
    }

    reserved.push({ distance, radius: 0.68 });
    distances.push(distance);
  }

  return distances.sort((a, b) => a - b);
}

function applyFeatureModifiers(
  samples: TrackSample[],
  features: TrackFeatures,
): TrackSample[] {
  return samples.map((sample, index) => {
    const narrowPulse =
      gaussianPulse(
        sample.distance / samples[samples.length - 1].distance,
        0.24,
        0.045,
      ) *
        0.5 +
      gaussianPulse(
        sample.distance / samples[samples.length - 1].distance,
        0.54,
        0.055,
      ) *
        0.62 +
      gaussianPulse(
        sample.distance / samples[samples.length - 1].distance,
        0.86,
        0.04,
      ) *
        0.42;
    const wideExtra = features.wideZones.reduce(
      (total, zone) =>
        total +
        zone.extraWidth *
          smoothRange(sample.distance, zone.startDistance, zone.endDistance),
      0,
    );
    const widthWave =
      Math.sin(sample.distance * 0.035) * 0.24 +
      Math.sin(sample.distance * 0.011 + 1.7) * 0.34;
    const width = clamp(
      TRACK_WIDTH + wideExtra + widthWave - narrowPulse,
      MIN_MAIN_TRACK_WIDTH,
      TRACK_WIDTH + 4.8,
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
  const before = samples[Math.max(0, index - 5)];
  const after = samples[Math.min(samples.length - 1, index + 5)];
  const yawDelta = wrapAngle(after.yaw - before.yaw);

  return clamp(-yawDelta * 0.92, -0.22, 0.22);
}

function isFeatureSafe(samples: TrackSample[], distance: number): boolean {
  const sample = sampleAtDistance(samples, distance);
  const before = sampleAtDistance(samples, Math.max(0, distance - 2));
  const after = sampleAtDistance(
    samples,
    Math.min(samples[samples.length - 1].distance, distance + 2),
  );

  return (
    Math.abs(wrapAngle(after.yaw - before.yaw)) < 0.5 &&
    sample.distance > 9 &&
    sample.distance < samples[samples.length - 1].distance - 18
  );
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

  for (
    let attempt = 0;
    attempt < count * 42 && distances.length < count;
    attempt += 1
  ) {
    const distance = randomFeatureDistance(rng, finishDistance, endZoneBias);
    const ok =
      isFeatureSafe(samples, distance) &&
      reserved.every(
        (item) => Math.abs(item.distance - distance) > item.radius + radius,
      );

    if (!ok) {
      continue;
    }

    reserved.push({ distance, radius });
    distances.push(distance);
  }

  if (required && distances.length < count) {
    for (
      let attempt = 0;
      attempt < count * 70 && distances.length < count;
      attempt += 1
    ) {
      const distance = randomFeatureDistance(rng, finishDistance, endZoneBias);
      const relaxedRadius = radius * 0.55;
      const ok =
        isFeatureSafe(samples, distance) &&
        distances.every((item) => Math.abs(item - distance) > radius * 2.4) &&
        reserved.every(
          (item) =>
            Math.abs(item.distance - distance) >
            Math.max(item.radius, relaxedRadius),
        );

      if (!ok) {
        continue;
      }

      reserved.push({ distance, radius: relaxedRadius });
      distances.push(distance);
    }
  }

  return distances.sort((a, b) => a - b);
}

function randomFeatureDistance(
  rng: () => number,
  finishDistance: number,
  endZoneBias: number,
): number {
  if (rng() < endZoneBias) {
    return finishDistance * (0.9 + rng() * 0.08);
  }

  if (rng() < 0.18) {
    return finishDistance * (0.12 + rng() * 0.76);
  }

  return 24 + rng() * (finishDistance - 54);
}

function hasBadTrackGeometry(
  samples: TrackSample[],
  totalLength: number,
): boolean {
  return (
    hasBadSelfIntersection(samples, totalLength) ||
    hasBadLocalGeometry(samples) ||
    hasNoisyBendGeometry(samples, totalLength)
  );
}

function hasBadSelfIntersection(
  samples: TrackSample[],
  totalLength: number,
): boolean {
  const stride = 10;
  const minDistanceGap = Math.max(18, totalLength * 0.038);

  for (let a = 0; a < samples.length - stride; a += stride) {
    const a1 = samples[a];
    const a2 = samples[a + stride];
    const aWidth = ((a1.width ?? TRACK_WIDTH) + (a2.width ?? TRACK_WIDTH)) / 2;

    for (let b = a + stride * 4; b < samples.length - stride; b += stride) {
      const b1 = samples[b];
      const b2 = samples[b + stride];
      const bWidth =
        ((b1.width ?? TRACK_WIDTH) + (b2.width ?? TRACK_WIDTH)) / 2;

      if (Math.abs(a1.distance - b1.distance) < minDistanceGap) {
        continue;
      }

      const flatDistance = segmentDistance2d(a1, a2, b1, b2);
      const verticalClearance = Math.abs((a1.y + a2.y) / 2 - (b1.y + b2.y) / 2);
      const requiredClearance = Math.max(
        MIN_CENTERLINE_CLEARANCE,
        (aWidth + bWidth) / 2 + 3.8,
      );
      const sameLevelNearMiss =
        verticalClearance < MIN_VERTICAL_CROSSING_CLEARANCE * 1.45 &&
        flatDistance < MIN_SAME_LEVEL_NEAR_MISS_CLEARANCE;

      if (
        (flatDistance < requiredClearance &&
          verticalClearance < MIN_VERTICAL_CROSSING_CLEARANCE) ||
        sameLevelNearMiss
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasNoisyBendGeometry(
  samples: TrackSample[],
  totalLength: number,
): boolean {
  const shortWindow = Math.max(8, Math.floor(samples.length * 0.018));
  const longWindow = Math.max(shortWindow + 4, Math.floor(samples.length * 0.04));
  const minDistanceSpan = Math.max(18, totalLength * 0.018);

  for (let index = longWindow; index < samples.length - longWindow; index += 2) {
    const shortBefore = samples[index - shortWindow];
    const shortAfter = samples[index + shortWindow];
    const longBefore = samples[index - longWindow];
    const longAfter = samples[index + longWindow];
    const localTurn = Math.abs(wrapAngle(shortAfter.yaw - shortBefore.yaw));
    const windowTurn = Math.abs(wrapAngle(longAfter.yaw - longBefore.yaw));
    const distanceSpan = longAfter.distance - longBefore.distance;
    const chord = Math.hypot(longAfter.x - longBefore.x, longAfter.z - longBefore.z);
    const chordRatio = chord / Math.max(distanceSpan, 0.0001);

    if (localTurn > MAX_LOCAL_YAW_DELTA * 1.18 && windowTurn > MAX_NOISY_WINDOW_YAW) {
      return true;
    }

    if (distanceSpan >= minDistanceSpan && chordRatio < MIN_HAIRPIN_CHORD_RATIO) {
      return true;
    }
  }

  return false;
}

function hasBadLocalGeometry(samples: TrackSample[]): boolean {
  for (let index = 4; index < samples.length - 4; index += 3) {
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
    const tooSteep =
      Math.abs(previousPitch) > MAX_SAMPLE_PITCH ||
      Math.abs(nextPitch) > MAX_SAMPLE_PITCH;

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

function segmentDistance2d(
  a1: TrackPoint,
  a2: TrackPoint,
  b1: TrackPoint,
  b2: TrackPoint,
): number {
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

function pointSegmentDistance2d(
  point: TrackPoint,
  a: TrackPoint,
  b: TrackPoint,
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz || 1;
  const t = clamp(
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq,
    0,
    1,
  );
  const x = a.x + dx * t;
  const z = a.z + dz * t;

  return Math.hypot(point.x - x, point.z - z);
}

function segmentsIntersect(
  a1: TrackPoint,
  a2: TrackPoint,
  b1: TrackPoint,
  b2: TrackPoint,
): boolean {
  const d1 = direction(a1, a2, b1);
  const d2 = direction(a1, a2, b2);
  const d3 = direction(b1, b2, a1);
  const d4 = direction(b1, b2, a2);

  return d1 * d2 < 0 && d3 * d4 < 0;
}

function direction(a: TrackPoint, b: TrackPoint, c: TrackPoint): number {
  return (c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x);
}

export function sampleAtDistance(
  samples: TrackSample[],
  distance: number,
): TrackSample {
  if (distance <= samples[0].distance) {
    return samples[0];
  }

  const last = samples[samples.length - 1];
  if (distance >= last.distance) {
    return last;
  }

  let low = 0;
  let high = samples.length - 1;

  while (high - low > 1) {
    const middle = (low + high) >> 1;

    if (samples[middle].distance < distance) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return distance - samples[low].distance <= samples[high].distance - distance
    ? samples[low]
    : samples[high];
}

export function progressForPosition(
  track: TrackDefinition,
  position: { x: number; y?: number; z: number },
): number {
  return nearestRaceRouteSample(track, position).distance;
}

export function trackDistanceForPosition(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
): {
  distance: number;
  lateralDistance: number;
  verticalDistance: number;
  onCourse: boolean;
  sample: TrackSample;
} {
  const closest = nearestRaceRouteSample(track, position);

  const lateralDistance = Math.hypot(
    closest.x - position.x,
    closest.z - position.z,
  );
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
    sample: closest,
  };
}

export function nearestRaceRouteSample(
  track: TrackDefinition,
  position: { x: number; y?: number; z: number },
): TrackSample {
  const cache = raceRouteCache(track);
  let closest = track.samples[0];
  let closestScore = Number.POSITIVE_INFINITY;
  const bucketX = Math.floor(position.x / ROUTE_BUCKET_SIZE);
  const bucketZ = Math.floor(position.z / ROUTE_BUCKET_SIZE);

  for (let radius = 0; radius <= ROUTE_BUCKET_RADIUS; radius += 1) {
    for (let x = bucketX - radius; x <= bucketX + radius; x += 1) {
      for (let z = bucketZ - radius; z <= bucketZ + radius; z += 1) {
        const bucket = cache.buckets.get(routeBucketKey(x, z));

        if (!bucket) {
          continue;
        }

        for (const sample of bucket) {
          const dx = sample.x - position.x;
          const dz = sample.z - position.z;
          const dy = position.y === undefined ? 0 : sample.y - position.y;
          const score = dx * dx + dz * dz + dy * dy * 0.38;

          if (score < closestScore) {
            closest = sample;
            closestScore = score;
          }
        }
      }
    }

    if (Number.isFinite(closestScore)) {
      return closest;
    }
  }

  for (const sample of cache.samples) {
    const dx = sample.x - position.x;
    const dz = sample.z - position.z;
    const dy = position.y === undefined ? 0 : sample.y - position.y;
    const score = dx * dx + dz * dz + dy * dy * 0.38;

    if (score < closestScore) {
      closest = sample;
      closestScore = score;
    }
  }

  return closest;
}

export function raceRouteSamples(track: TrackDefinition): TrackSample[] {
  return raceRouteCache(track).samples;
}

function raceRouteCache(track: TrackDefinition): RouteSampleCache {
  const cached = routeSamplesByTrack.get(track);

  if (cached) {
    return cached;
  }

  const routeSamples: TrackSample[][] = [track.samples];

  if (track.splitSurfaces.length > 0) {
    for (const surface of track.splitSurfaces) {
      const leftLane = splitSurfaceLaneSamples(surface, -1);
      const rightLane = splitSurfaceLaneSamples(surface, 1);

      if (leftLane.length >= 2) {
        routeSamples.push(leftLane);
      }

      if (rightLane.length >= 2) {
        routeSamples.push(rightLane);
      }
    }
  } else {
    routeSamples.push(...track.branches.map((branch) => branch.samples));
  }

  const samples = routeSamples.flat();
  const buckets = new Map<string, TrackSample[]>();

  for (const sample of samples) {
    const key = routeBucketKey(
      Math.floor(sample.x / ROUTE_BUCKET_SIZE),
      Math.floor(sample.z / ROUTE_BUCKET_SIZE),
    );
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(sample);
    } else {
      buckets.set(key, [sample]);
    }
  }

  const cache: RouteSampleCache = { samples, buckets };
  routeSamplesByTrack.set(track, cache);

  return cache;
}

function routeBucketKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function sampleTrack(
  points: TrackPoint[],
  count: number,
  totalLength = TRACK_LENGTH,
  startHeight = START_HEIGHT,
): TrackSample[] {
  const positions: TrackPoint[] = [];

  for (let index = 0; index <= count; index += 1) {
    const distance = (index / count) * totalLength;
    const current = catmullPoint(points, distance, totalLength);
    positions.push(current);
  }

  enforceMinimumDownhillProfile(positions, totalLength, startHeight);

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
    const flatTangent = {
      x: tangent.x / flatLength,
      z: tangent.z / flatLength,
    };
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

function enforceMinimumDownhillProfile(
  points: TrackPoint[],
  totalLength: number,
  startHeight: number,
): void {
  if (points.length === 0) {
    return;
  }

  points[0].y = startHeight;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const flatDistance = Math.hypot(
      current.x - previous.x,
      current.z - previous.z,
    );
    const minDrop = flatDistance * MIN_SLOPE * 0.72;
    const maxDrop = flatDistance * 0.36;
    const plannedDrop = previous.y - current.y;

    current.y = previous.y - clamp(plannedDrop, minDrop, maxDrop);
  }
}

export function createRibbon(
  samples: TrackSample[],
  width: number,
  yOffset: number,
  gaps: Array<{ startDistance: number; endDistance: number }> = [],
): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];

    for (const side of [-1, 1]) {
      const sampleWidth = sample.width ?? width;

      positions.push(
        sample.x + sample.normal.x * side * (sampleWidth / 2),
        sample.y +
          yOffset +
          Math.sin(sample.bank ?? 0) * side * (sampleWidth / 2),
        sample.z + sample.normal.z * side * (sampleWidth / 2),
      );
    }

    if (index < samples.length - 1) {
      const segmentDistance =
        (sample.distance + samples[index + 1].distance) / 2;

      if (isDistanceInGap(segmentDistance, gaps)) {
        continue;
      }

      const start = index * 2;
      indices.push(
        start,
        start + 2,
        start + 1,
        start + 1,
        start + 2,
        start + 3,
      );
    }
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function isDistanceInGap(
  distance: number,
  gaps: Array<{ startDistance: number; endDistance: number }>,
): boolean {
  return gaps.some(
    (gap) => distance > gap.startDistance && distance < gap.endDistance,
  );
}

export function createWall(
  samples: TrackSample[],
  side: -1 | 1,
): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const offset = (sample.width ?? TRACK_WIDTH) / 2 - 0.02;
    const x = sample.x + sample.normal.x * side * offset;
    const z = sample.z + sample.normal.z * side * offset;
    const bankY = Math.sin(sample.bank ?? 0) * side * offset;

    positions.push(
      x,
      sample.y + bankY - 0.16,
      z,
      x,
      sample.y + bankY + 1.02,
      z,
    );

    if (index < samples.length - 1) {
      const start = index * 2;

      if (side < 0) {
        indices.push(
          start,
          start + 1,
          start + 2,
          start + 1,
          start + 3,
          start + 2,
        );
      } else {
        indices.push(
          start,
          start + 2,
          start + 1,
          start + 1,
          start + 2,
          start + 3,
        );
      }
    }
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function createCatchCenter(samples: TrackSample[]): {
  x: number;
  y: number;
  z: number;
} {
  const end = samples[samples.length - 1];

  return {
    x: end.x + end.tangent.x * 9,
    y: end.y - 3.6,
    z: end.z + end.tangent.z * 9,
  };
}

function catmullPoint(
  points: TrackPoint[],
  distance: number,
  totalLength: number,
): TrackPoint {
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

function catmull(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
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

function normalize3(value: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
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

  return (
    smoothstep(start, start + fade, distance) *
    (1 - smoothstep(end - fade, end, distance))
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * (3 - 2 * t);
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
