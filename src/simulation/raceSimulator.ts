import RAPIER from "@dimforge/rapier3d";
import { recordFrame, type BallFrameState, type SimBall } from "./raceRecorder";
import type { FinishPlacement, RaceBall, RaceConfig, RaceDisqualification, RaceFrame, RaceResult } from "./types";
import type { PowerupKind } from "../shared/trackGenerator";
import { DEFAULT_BALL_RADIUS, createStartLayout } from "../shared/marbleLayout";
import {
  TRACK_WIDTH,
  type BoundaryPoint,
  type TrackDefinition,
  type TrackMeshData,
  generateTrack,
  obstacleCycleValue,
  progressForPosition,
  sampleAtDistance,
  trackDistanceForPosition,
} from "../shared/trackGenerator";

const FIXED_TIMESTEP = 1 / 120;
const PHYSICS_SUBSTEPS = 2;
const MAX_STEPS = 60 * 620;
const STOP_SPEED = 0.025;
const STOP_ANGULAR_SPEED = 0.07;
const TERMINAL_STILL_SECONDS = 4.0;
const FINISH_VIEW_BUFFER_SECONDS = 10;
const STUCK_NO_PROGRESS_SECONDS = 300;
const STUCK_PROGRESS_EPSILON = 0.75;

const SURFACE_CLEARANCE = 0.012;

const PEG_HEIGHT = 0.56;
const BUMPER_HEIGHT = 0.62;
const GATE_HEIGHT = 0.56;
const TRAPPER_HEIGHT = 0.74;
const SPINNER_HEIGHT = 0.24;
const SPINNER_TRACK_LIFT = 0.18;
const HAMMER_HEIGHT = 0.48;
const TURNSTILE_HEIGHT = 0.24;
const TURNSTILE_TRACK_LIFT = 0.2;

const PEG_RETRACT_DEPTH = 0.38;

const DISQUALIFY_NO_CONTACT_SECONDS = 1.35;
const FALL_RESPAWN_DELAY_SECONDS = 5;
const FALL_DISQUALIFY_DROP = 8.0;
const FALL_LATERAL_DISTANCE_SCALE = 1.8;
const FALL_LATERAL_DISTANCE_EXTRA = 1.2;
const HARD_FALL_Y = -35;
const SAFE_CHECKPOINT_MAX_ADVANCE_PER_UPDATE = 7.5;

const PEG_MOTION_PERIOD = 8;
const PEG_HOLD_UP_SECONDS = 2;
const PEG_LOWER_SECONDS = 2;
const PEG_HOLD_DOWN_SECONDS = 2;
const PEG_RAISE_SECONDS = 2;

const GATE_MOTION_PERIOD = 20;
const SPINNER_PHASE_PERIOD = Math.PI * 2;
const HAMMER_PHASE_PERIOD = Math.PI * 2;
const TURNSTILE_PHASE_PERIOD = Math.PI * 2;

const AIRBORNE_DISPLAY_MAX_VERTICAL_DISTANCE = 8.5;
const AIRBORNE_DISPLAY_MAX_LATERAL_DISTANCE = TRACK_WIDTH * 1.35;
const AIRBORNE_DISPLAY_MAX_BELOW_COURSE = 2.2;
const AIRBORNE_DISPLAY_MAX_PROGRESS_ADVANCE_PER_STEP = 2.75;
const AIRBORNE_DISPLAY_MAX_PROGRESS_BACKTRACK_PER_STEP = 5.0;

// Prevent true lower-track shortcuts without treating ordinary airtime as a cheat.
// A reset is only queued when the ball had a real airborne gap, then lands much
// lower and much farther ahead than its last confirmed safe contact checkpoint.
// Display progress can temporarily freeze during uncertain airtime, but landing
// alone is not enough to trigger a respawn.
const GROUNDED_DISPLAY_MAX_PROGRESS_ADVANCE_PER_STEP = 5.2;
const GROUNDED_DISPLAY_MAX_PROGRESS_BACKTRACK_PER_STEP = 7.5;
const ILLEGAL_SHORTCUT_MIN_AIRTIME_SECONDS = 0.62;
const ILLEGAL_SHORTCUT_MIN_PROGRESS_GAIN = 28.0;
const ILLEGAL_SHORTCUT_MIN_VERTICAL_DROP = 5.4;
const ILLEGAL_SHORTCUT_MIN_HORIZONTAL_SEPARATION = 9.0;

const GRAVITY_Y = -11.5;

const ROAD_FRICTION = 0.36;
const ROAD_RESTITUTION = 0.015;

const SAFETY_SLAB_FRICTION = 0.36;
const SAFETY_SLAB_RESTITUTION = 0.015;

const WALL_FRICTION = 0.34;
const WALL_RESTITUTION = 0.08;
const WALL_HALF_THICKNESS = 0.26;
const WALL_HALF_HEIGHT = 1.02;
const WALL_LENGTH_OVERLAP = 0.08;
const WALL_ROAD_EDGE_OVERLAP = 0.0;

// Extra invisible guard rails are intentionally thicker than the visual wall.
// They are a physics-only containment layer used to close edge/trimesh seams,
// especially on narrowed sections and fork/merge boundaries where the ball can
// otherwise squeeze through a tiny gap between wall mesh triangles.
const GUARD_RAIL_HALF_THICKNESS = 0.48;
const GUARD_RAIL_HALF_HEIGHT = 1.55;
const GUARD_RAIL_LENGTH_OVERLAP = 0.86;
const GUARD_RAIL_CENTER_LIFT = 0.9;
const GUARD_RAIL_EDGE_OVERLAP = 0.12;

// Keep physics wall dimensions in lockstep with src/rendering/trackMeshes.ts.
// Wall colliders below are now generated from the same edge-anchored mesh logic
// used by rendering instead of separate cuboids, so what is visible is what collides.
const WALL_VISUAL_THICKNESS = 0.52;
const WALL_EXTENSION_BELOW = 2.85;
const WALL_HEIGHT_ABOVE = 1.18;

const BALL_DENSITY = 5.2;
const BALL_FRICTION_MIN = 0.38;
const BALL_FRICTION_VARIATION = 0.08;
const BALL_RESTITUTION = 0.08;
const BALL_LINEAR_DAMPING = 0.004;
const BALL_ANGULAR_DAMPING = 0.032;

const START_LATERAL_JITTER = 0.11;
const START_FORWARD_JITTER = 0.11;
const START_BASE_RELEASE_SPEED_MIN = 1.14;
const START_BASE_RELEASE_SPEED_MAX = 1.46;
const START_PER_BALL_RELEASE_SPEED_JITTER = 0.12;
const START_LATERAL_RELEASE_SPEED_JITTER = 0.09;
const START_TORQUE_JITTER_XZ = 0.004;
const START_TORQUE_JITTER_Y = 0.0025;

const PEG_FRICTION = 0.2;
const PEG_RESTITUTION = 0.16;

const BUMPER_FRICTION = 0.16;
const BUMPER_RESTITUTION = 0.52;

const GATE_FRICTION = 0.28;
const GATE_RESTITUTION = 0.08;

const SPINNER_FRICTION = 0.24;
const SPINNER_RESTITUTION = 0.18;

const HAMMER_FRICTION = 0.2;
const HAMMER_RESTITUTION = 0.22;

const TURNSTILE_FRICTION = 0.35;
const TURNSTILE_RESTITUTION = 0.08;
const POWERUP_DURATION = 10;
const POWERUP_RESPAWN_SECONDS = 10;
const POWERUP_PICKUP_RADIUS = 0.72;
const POWERUP_KINDS: PowerupKind[] = ["speed", "giant", "tiny", "ghost", "slow", "barrier", "smash"];
const BARRIER_RADIUS = 2.45;
const BARRIER_FORCE = 0.095;

const CATCH_FLOOR_FRICTION = 0.95;
const CATCH_WALL_FRICTION = 0.8;

const BALL_SOLID_GROUP = 0x0001;
const BALL_GHOST_GROUP = 0x0002;
const TRACK_GROUP = 0x0004;
const OBSTACLE_GROUP = 0x0008;
const SOLID_BALL_COLLISION_GROUPS = interactionGroups(BALL_SOLID_GROUP, BALL_SOLID_GROUP | TRACK_GROUP | OBSTACLE_GROUP);
const GHOST_BALL_COLLISION_GROUPS = interactionGroups(BALL_GHOST_GROUP, TRACK_GROUP);
const TRACK_COLLISION_GROUPS = interactionGroups(TRACK_GROUP, BALL_SOLID_GROUP | BALL_GHOST_GROUP);
const OBSTACLE_COLLISION_GROUPS = interactionGroups(OBSTACLE_GROUP, BALL_SOLID_GROUP);

type RuntimeGreenBumper = TrackDefinition["features"]["greenBumpers"][number] & {
  phase?: number;
};

type ActivePowerup = {
  kind: PowerupKind | "slow-source";
  endsAt: number;
};

type SafeBallState = {
  position: { x: number; y: number; z: number };
  progress: number;
  yaw: number;
  tangent: { x: number; y: number; z: number };
};

type PendingRespawn = {
  respawnAt: number;
  safeState: SafeBallState;
};

export type LiveRaceSimulation = {
  result: RaceResult;
  getFrame: () => RaceFrame;
  step: (deltaSeconds: number) => RaceFrame;
  dispose: () => void;
  finished: boolean;
};

type MovingVerticalObstacle = {
  id: string;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  x: number;
  z: number;
  trackY: number;
  phase: number;
  fullHeight: number;
};

type DynamicBody = {
  id: string;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  kind: "gate" | "trapper" | "spinner" | "hammer" | "turnstile";
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
  speed: number;
};

const routeSamplesByTrack = new WeakMap<TrackDefinition, TrackDefinition["samples"]>();

export async function prepareRapier(): Promise<void> {
  await Promise.resolve();
}

export function createLiveRace(config: RaceConfig): LiveRaceSimulation {
  const track = config.track ?? generateTrack(config.seed);
  const world = createWorld();
  const dynamic = createTrack(world, track);
  const balls = createMarbles(world, config.options, track);
  const displayProgressByBall = new Map<string, number>();
  const frameStateByBall = new Map<string, BallFrameState>();
  const noContactSecondsByBall = new Map<string, number>();
  const safeStateByBall = new Map<string, SafeBallState>();
  const pendingRespawnsByBall = new Map<string, PendingRespawn>();
  const terminalStillSecondsByBall = new Map<string, number>();
  const lastMovingProgressByBall = new Map<string, number>();
  const noProgressSecondsByBall = new Map<string, number>();
  const hiddenPowerupsUntil = new Map<string, number>();
  const activePowerupsByBall = new Map<string, ActivePowerup[]>();
  const smashedObstacleBodies = new Set<number>();
  const destroyedObstacleIds = new Set<string>();
  const obstacleBodyByCollider = createObstacleColliderMap(dynamic);

  for (const ball of balls) {
    safeStateByBall.set(ball.id, safeStateForProgress(track, 0.4, ball.radius));
  }

  updateBallFrameStates(world, balls, track, displayProgressByBall, frameStateByBall, activePowerupsByBall, 0);

  let currentFrame = recordFrame(balls, 0, frameStateByBall, hiddenPowerupIds(hiddenPowerupsUntil, 0), Array.from(destroyedObstacleIds));
  const placements: FinishPlacement[] = [];
  const disqualifications: RaceDisqualification[] = [];
  const finishedIds = new Set<string>();
  const disqualifiedIds = new Set<string>();
  let allFinishedAt: number | null = null;
  let actualWinnerId = "";
  let elapsed = 0;
  let accumulator = 0;
  let disposed = false;

  const result: RaceResult = {
    seed: config.seed,
    actualWinnerId,
    placements,
    disqualifications,
    track,
    balls: config.options.map((option) => ({ ...option })),
    attempt: config.attempt,
  };

  const simulation: LiveRaceSimulation = {
    result,
    finished: false,
    getFrame(): RaceFrame {
      return currentFrame;
    },
    step(deltaSeconds: number): RaceFrame {
      if (simulation.finished || disposed) {
        return currentFrame;
      }

      accumulator += Math.min(deltaSeconds, 0.055);
      let fixedSteps = 0;

      while (accumulator >= FIXED_TIMESTEP && fixedSteps < 5) {
        for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
          const time = elapsed + (substep / PHYSICS_SUBSTEPS) * FIXED_TIMESTEP;
          updateDynamicObstacles(dynamic, time, smashedObstacleBodies);
          world.step();
        }

        elapsed += FIXED_TIMESTEP;
        accumulator -= FIXED_TIMESTEP;
        fixedSteps += 1;

        updatePowerups(world, balls, track, hiddenPowerupsUntil, activePowerupsByBall, elapsed);
        applyActivePowerups(world, balls, activePowerupsByBall, obstacleBodyByCollider, smashedObstacleBodies, destroyedObstacleIds, elapsed);

        updateBallFrameStates(world, balls, track, displayProgressByBall, frameStateByBall, activePowerupsByBall, elapsed);

        updateFallRespawns(
          world,
          balls,
          finishedIds,
          noContactSecondsByBall,
          safeStateByBall,
          pendingRespawnsByBall,
          track,
          frameStateByBall,
          displayProgressByBall,
          elapsed,
          FIXED_TIMESTEP,
        );

        currentFrame = recordFrame(balls, elapsed, frameStateByBall, hiddenPowerupIds(hiddenPowerupsUntil, elapsed), Array.from(destroyedObstacleIds));
        updatePlacements(balls, finishedIds, disqualifiedIds, track, frameStateByBall, placements, elapsed);

        if (!actualWinnerId && placements.length > 0) {
          actualWinnerId = placements[0].optionId;
          result.actualWinnerId = actualWinnerId;
        }

        const allTerminalSettled = updateTerminalStillness(
          balls,
          finishedIds,
          disqualifiedIds,
          terminalStillSecondsByBall,
          track,
          FIXED_TIMESTEP,
        );
        const allRemainingStuck = updateRemainingStuckState(
          balls,
          finishedIds,
          disqualifiedIds,
          frameStateByBall,
          lastMovingProgressByBall,
          noProgressSecondsByBall,
          FIXED_TIMESTEP,
        );
        const allFinished = balls.every((ball) => finishedIds.has(ball.id));
        const allFinishedOrDisqualified = balls.every((ball) => finishedIds.has(ball.id) || disqualifiedIds.has(ball.id));

        if (allFinished && allFinishedAt === null) {
          allFinishedAt = elapsed;
        }

        const finishViewBufferElapsed = allFinishedAt !== null && elapsed >= allFinishedAt + FINISH_VIEW_BUFFER_SECONDS;
        const canEndBeforeFinishBuffer = allFinishedAt === null && (allTerminalSettled || allFinishedOrDisqualified || allRemainingStuck);

        if (finishViewBufferElapsed || canEndBeforeFinishBuffer || elapsed >= MAX_STEPS / 60) {
          simulation.finished = true;
          break;
        }
      }

      if (fixedSteps >= 5) {
        accumulator = 0;
      }

      return currentFrame;
    },
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      world.free();
    },
  };

  return simulation;
}

function randomizeObstacleRuntimeState(track: TrackDefinition): TrackDefinition {
  track.features.pegs = track.features.pegs.map((peg) => ({
    ...peg,
    phase: trueRandom() * PEG_MOTION_PERIOD,
  }));

  track.features.greenBumpers = track.features.greenBumpers.map((bumper) => ({
    ...bumper,
    phase: trueRandom() * PEG_MOTION_PERIOD,
  }));

  track.features.gates = track.features.gates.map((gate) => ({
    ...gate,
    phase: trueRandom() * GATE_MOTION_PERIOD,
  }));

  track.features.spinners = track.features.spinners.map((spinner) => ({
    ...spinner,
    phase: trueRandom() * SPINNER_PHASE_PERIOD,
  }));

  track.features.hammers = track.features.hammers.map((hammer) => ({
    ...hammer,
    phase: trueRandom() * HAMMER_PHASE_PERIOD,
  }));

  track.features.turnstiles = track.features.turnstiles.map((turnstile) => ({
    ...turnstile,
    phase: trueRandom() * TURNSTILE_PHASE_PERIOD,
  }));

  return track;
}

function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });

  world.timestep = FIXED_TIMESTEP / PHYSICS_SUBSTEPS;
  world.numSolverIterations = 16;
  world.integrationParameters.numInternalPgsIterations = 5;
  world.integrationParameters.normalizedAllowedLinearError = 0.0004;

  return world;
}

function createTrack(world: RAPIER.World, track: TrackDefinition): Array<MovingVerticalObstacle | DynamicBody> {
  const splitRoadGaps = track.splitSurfaces.map(({ startDistance, endDistance }) => ({ startDistance, endDistance }));

  createRoadCollider(world, track.road);
  createRoadSafetySlabs(world, track.samples, splitRoadGaps);

  for (const surface of track.splitSurfaces) {
    createRoadCollider(world, surface.road);

    // Rapier trimesh colliders can have edge/backface tunneling on the very thin
    // split-road replacement mesh. Add route-local slab colliders under each
    // rendered split lane so physics support matches the visible road surface.
    createRoadSafetySlabs(world, splitSurfaceLaneSamples(surface, -1));
    createRoadSafetySlabs(world, splitSurfaceLaneSamples(surface, 1));
  }

  createVisualWallColliders(world, track);

  const dynamicBodies = createFeatureColliders(world, track);
  createCatchContainer(world, track);

  return dynamicBodies;
}

function createRoadCollider(world: RAPIER.World, mesh: TrackMeshData): void {
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(ROAD_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(ROAD_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(TRACK_COLLISION_GROUPS),
  );
}

function createRoadSafetySlabs(
  world: RAPIER.World,
  samples: TrackDefinition["samples"],
  gaps: Array<{ startDistance: number; endDistance: number }> = [],
): void {
  const step = 3;

  for (let index = 0; index < samples.length - step; index += step) {
    const sample = samples[index];
    const next = samples[index + step];
    const segmentDistance = (sample.distance + next.distance) / 2;

    if (isRoadSegmentGap(segmentDistance, gaps)) {
      continue;
    }

    const width = ((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2;
    const length = Math.hypot(next.x - sample.x, next.y - sample.y, next.z - sample.z);
    const yaw = Math.atan2(next.x - sample.x, next.z - sample.z);
    const pitch = Math.atan2(sample.y - next.y, Math.hypot(next.x - sample.x, next.z - sample.z));

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(0.1, width / 2 - 0.06), 0.1, length / 2 + 0.06)
        .setTranslation(
          (sample.x + next.x) / 2,
          (sample.y + next.y) / 2 - 0.2,
          (sample.z + next.z) / 2,
        )
        .setRotation(trackRotation(yaw, pitch))
        .setFriction(SAFETY_SLAB_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(SAFETY_SLAB_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(TRACK_COLLISION_GROUPS),
    );
  }
}

function isRoadSegmentGap(distance: number, gaps: Array<{ startDistance: number; endDistance: number }>): boolean {
  return gaps.some((gap) => distance > gap.startDistance && distance < gap.endDistance);
}

type WallPoint = { x: number; y: number; z: number };
type BoundaryWall = { points: WallPoint[]; closed: boolean };

function createBoundaryWallColliders(world: RAPIER.World, points: WallPoint[], closed: boolean): void {
  const segmentCount = closed ? points.length : points.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const dz = next.z - current.z;
    const length = Math.hypot(dx, dy, dz);

    if (length < 0.08) {
      continue;
    }

    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(current.y - next.y, Math.hypot(dx, dz));

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, length / 2 + WALL_LENGTH_OVERLAP)
        .setTranslation(
          (current.x + next.x) / 2,
          (current.y + next.y) / 2 + 0.62,
          (current.z + next.z) / 2,
        )
        .setRotation(trackRotation(yaw, pitch))
        .setFriction(WALL_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(WALL_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(TRACK_COLLISION_GROUPS),
    );
  }
}

function createSplitBoundaryWallColliders(world: RAPIER.World, track: TrackDefinition): void {
  for (const boundary of createSplitBoundaryWalls(track)) {
    const segmentCount = boundary.closed ? boundary.points.length : boundary.points.length - 1;

    for (let index = 0; index < segmentCount; index += 1) {
      const current = boundary.points[index];
      const next = boundary.points[(index + 1) % boundary.points.length];
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const dz = next.z - current.z;
      const length = Math.hypot(dx, dy, dz);

      if (length < 0.08) {
        continue;
      }

      const yaw = Math.atan2(dx, dz);
      const pitch = Math.atan2(current.y - next.y, Math.hypot(dx, dz));

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, length / 2 + WALL_LENGTH_OVERLAP)
          .setTranslation(
            (current.x + next.x) / 2,
            (current.y + next.y) / 2 + 0.62,
            (current.z + next.z) / 2,
          )
          .setRotation(trackRotation(yaw, pitch))
          .setFriction(WALL_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(WALL_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(TRACK_COLLISION_GROUPS),
      );
    }
  }
}

function createSplitBoundaryWalls(track: TrackDefinition): BoundaryWall[] {
  return track.features.splitModules.flatMap((module) => {
    const leftBranch = track.branches.find(
      (branch) =>
        branch.side === -1 &&
        Math.abs(branch.startDistance - module.startDistance) < 0.01 &&
        Math.abs(branch.endDistance - module.endDistance) < 0.01,
    );
    const rightBranch = track.branches.find(
      (branch) =>
        branch.side === 1 &&
        Math.abs(branch.startDistance - module.startDistance) < 0.01 &&
        Math.abs(branch.endDistance - module.endDistance) < 0.01,
    );

    if (!leftBranch || !rightBranch) {
      return [];
    }

    const leftExterior = splitEdgePoints(track, module, leftBranch.samples, -1);
    const rightExterior = splitEdgePoints(track, module, rightBranch.samples, 1);
    const distances = leftBranch.samples.map((sample) => sample.distance);
    const usableDistances = distances.filter((distance) => {
      const left = wallEdgePoint(sampleAtDistance(leftBranch.samples, distance), 1);
      const right = wallEdgePoint(sampleAtDistance(rightBranch.samples, distance), -1);

      return Math.hypot(left.x - right.x, left.z - right.z) > WALL_HALF_THICKNESS * 7.6;
    });
    const walls: BoundaryWall[] = [
      { points: smoothWallPath(leftExterior, false, 1), closed: false },
      { points: smoothWallPath(rightExterior, false, 1), closed: false },
    ].filter((wall) => wall.points.length >= 2);

    if (usableDistances.length < 5) {
      return walls;
    }

    const trim = Math.max(2, Math.floor(usableDistances.length * 0.025));
    const stableDistances = usableDistances.slice(trim, usableDistances.length - trim);

    if (stableDistances.length < 4) {
      return walls;
    }

    const leftInner = stableDistances.map((distance) => wallEdgePoint(sampleAtDistance(leftBranch.samples, distance), 1));
    const rightInnerForward = stableDistances.map((distance) => wallEdgePoint(sampleAtDistance(rightBranch.samples, distance), -1));
    const startCap = capCurve(rightInnerForward[0], leftInner[0]);
    const endCap = capCurve(leftInner[leftInner.length - 1], rightInnerForward[rightInnerForward.length - 1]);
    const island = [
      ...leftInner,
      ...endCap.slice(1),
      ...rightInnerForward.reverse().slice(1),
      ...startCap.slice(1),
    ];

    return [...walls, { points: smoothWallPath(dedupeWallPoints(island), true, 1), closed: true }];
  });
}

function splitEdgePoints(
  track: TrackDefinition,
  module: TrackDefinition["features"]["splitModules"][number],
  samples: TrackDefinition["samples"],
  side: -1 | 1,
): WallPoint[] {
  void track;
  const points = samples
    .filter((sample) => sample.distance >= module.startDistance && sample.distance <= module.endDistance)
    .map((sample) => wallEdgePoint(sample, side));

  return dedupeWallPoints(points);
}

function capCurve(from: WallPoint, to: WallPoint): WallPoint[] {
  const mid = midpoint(from, to);

  return Array.from({ length: 6 }, (_, index) => quadraticPoint(from, mid, to, index / 5));
}

function quadraticPoint(from: WallPoint, control: WallPoint, to: WallPoint, t: number): WallPoint {
  const inv = 1 - t;

  return {
    x: from.x * inv * inv + control.x * 2 * inv * t + to.x * t * t,
    y: from.y * inv * inv + control.y * 2 * inv * t + to.y * t * t,
    z: from.z * inv * inv + control.z * 2 * inv * t + to.z * t * t,
  };
}

function midpoint(a: WallPoint, b: WallPoint): WallPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function dedupeWallPoints(points: WallPoint[]): WallPoint[] {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) > 0.05;
  });
}

function smoothWallPath(points: WallPoint[], closed: boolean, iterations: number): WallPoint[] {
  let smoothed = dedupeWallPoints(points);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (smoothed.length < 3) {
      return smoothed;
    }

    const next: WallPoint[] = [];
    const count = smoothed.length;
    const segmentCount = closed ? count : count - 1;

    if (!closed) {
      next.push(smoothed[0]);
    }

    for (let index = 0; index < segmentCount; index += 1) {
      const a = smoothed[index];
      const b = smoothed[(index + 1) % count];

      next.push(lerpPoint(a, b, 0.25), lerpPoint(a, b, 0.75));
    }

    if (!closed) {
      next.push(smoothed[count - 1]);
    }

    smoothed = dedupeWallPoints(next);
  }

  return smoothed;
}

function lerpPoint(a: WallPoint, b: WallPoint, alpha: number): WallPoint {
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

function wallEdgePoint(sample: TrackDefinition["samples"][number], side: -1 | 1): WallPoint {
  const offset = side * ((sample.width ?? TRACK_WIDTH) / 2 - 0.02);

  return {
    x: sample.x + sample.normal.x * offset,
    y: sample.y + Math.sin(sample.bank ?? 0) * offset,
    z: sample.z + sample.normal.z * offset,
  };
}

function createSegmentedWalls(
  world: RAPIER.World,
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  widthScale: number,
  onlySide?: -1 | 1,
  applyTrackGaps = true,
  suppressCoveredEdges = false,
): void {
  const step = 1;

  for (let index = 0; index < samples.length - step; index += step) {
    const sample = samples[index];
    const next = samples[index + step];
    const width = (((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2) * widthScale;
    const length = Math.hypot(next.x - sample.x, next.y - sample.y, next.z - sample.z);
    const yaw = Math.atan2(next.x - sample.x, next.z - sample.z);
    const pitch = Math.atan2(sample.y - next.y, Math.hypot(next.x - sample.x, next.z - sample.z));

    for (const side of [-1, 1] as const) {
      if (onlySide !== undefined && side !== onlySide) {
        continue;
      }

      const segmentDistance = (sample.distance + next.distance) / 2;

      if (
        (applyTrackGaps && isSplitWallJunctionGap(track, segmentDistance, side)) ||
        (suppressCoveredEdges && isWallEdgeCoveredByRoad(track, samples, sample, next, side, widthScale))
      ) {
        continue;
      }

      const normal = sample.normal;

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, length / 2 + WALL_LENGTH_OVERLAP)
          .setTranslation(
            (sample.x + next.x) / 2 + normal.x * side * (width / 2 - WALL_ROAD_EDGE_OVERLAP),
            (sample.y + next.y) / 2 + 0.62,
            (sample.z + next.z) / 2 + normal.z * side * (width / 2 - WALL_ROAD_EDGE_OVERLAP),
          )
          .setRotation(trackRotation(yaw, pitch))
          .setFriction(WALL_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(WALL_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(TRACK_COLLISION_GROUPS),
      );
    }
  }
}


type VisualBoundaryWall = { points: WallPoint[]; closed: boolean; outwardSign: 1 | -1 };
type OffsetNormal = { x: number; z: number };

function createVisualWallColliders(world: RAPIER.World, track: TrackDefinition): void {
  // Wall collision should match the rendered wall, not a wider invisible guard rail.
  // The previous cuboid rail layers made wall collision feel too large, and the
  // old physics mesh also skipped some wall segments when another road was nearby.
  // Use the exact edge-anchored visual wall meshes here and only omit main-wall
  // segments inside rendered split replacement gaps.
  for (const side of [-1, 1] as const) {
    createWallMeshCollider(world, createPhysicsThickWall(track.samples, side, 1, track));
  }

  for (const boundary of splitWallBoundaries(track)) {
    createWallMeshCollider(world, createPhysicsWallAlongBoundary(boundary.points, boundary.closed, boundary.outwardSign));
  }
}


function createGuardRailColliders(world: RAPIER.World, track: TrackDefinition): void {
  const splitRoadGaps = track.splitSurfaces.map(({ startDistance, endDistance }) => ({ startDistance, endDistance }));

  // Main-route rails: unlike the visual wall mesh, these are simple overlapping
  // cuboids at the actual road edge and are not suppressed by nearby route-cover
  // heuristics. They only skip rendered split replacement gaps.
  createGuardRailsForSamples(world, track.samples, splitRoadGaps);

  // Split-route rails: use the exact split-surface wall boundaries that the
  // renderer uses. These close seams at the outer split walls and island wall.
  for (const boundary of splitWallBoundaries(track)) {
    createBoundaryGuardRailColliders(world, boundary.points, boundary.closed);
  }
}

function createGuardRailsForSamples(
  world: RAPIER.World,
  samples: TrackDefinition["samples"],
  gaps: Array<{ startDistance: number; endDistance: number }> = [],
): void {
  const step = 1;

  for (let index = 0; index < samples.length - step; index += step) {
    const sample = samples[index];
    const next = samples[index + step];
    const segmentDistance = (sample.distance + next.distance) / 2;

    if (isRoadSegmentGap(segmentDistance, gaps)) {
      continue;
    }

    const width = ((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2;
    const dx = next.x - sample.x;
    const dy = next.y - sample.y;
    const dz = next.z - sample.z;
    const length = Math.hypot(dx, dy, dz);

    if (length < 0.035) {
      continue;
    }

    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(sample.y - next.y, Math.hypot(dx, dz));
    const normal = normalizeXZ({
      x: sample.normal.x + next.normal.x,
      z: sample.normal.z + next.normal.z,
    });

    for (const side of [-1, 1] as const) {
      const edgeOffset = side * (width / 2 - GUARD_RAIL_EDGE_OVERLAP);
      const centerX = (sample.x + next.x) / 2 + normal.x * edgeOffset;
      const centerY = (sample.y + next.y) / 2 + GUARD_RAIL_CENTER_LIFT;
      const centerZ = (sample.z + next.z) / 2 + normal.z * edgeOffset;

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          GUARD_RAIL_HALF_THICKNESS,
          GUARD_RAIL_HALF_HEIGHT,
          length / 2 + GUARD_RAIL_LENGTH_OVERLAP,
        )
          .setTranslation(centerX, centerY, centerZ)
          .setRotation(trackRotation(yaw, pitch))
          .setFriction(WALL_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(WALL_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(TRACK_COLLISION_GROUPS),
      );
    }
  }
}

function createBoundaryGuardRailColliders(world: RAPIER.World, points: WallPoint[], closed: boolean): void {
  const cleanPoints = dedupePhysicsWallPoints(points);
  const segmentCount = closed ? cleanPoints.length : cleanPoints.length - 1;

  if (segmentCount < 1) {
    return;
  }

  for (let index = 0; index < segmentCount; index += 1) {
    const current = cleanPoints[index];
    const next = cleanPoints[(index + 1) % cleanPoints.length];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const dz = next.z - current.z;
    const length = Math.hypot(dx, dy, dz);

    if (length < 0.035) {
      continue;
    }

    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(current.y - next.y, Math.hypot(dx, dz));

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        GUARD_RAIL_HALF_THICKNESS,
        GUARD_RAIL_HALF_HEIGHT,
        length / 2 + GUARD_RAIL_LENGTH_OVERLAP,
      )
        .setTranslation(
          (current.x + next.x) / 2,
          (current.y + next.y) / 2 + GUARD_RAIL_CENTER_LIFT,
          (current.z + next.z) / 2,
        )
        .setRotation(trackRotation(yaw, pitch))
        .setFriction(WALL_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(WALL_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(TRACK_COLLISION_GROUPS),
    );
  }
}

function createWallMeshCollider(world: RAPIER.World, mesh: TrackMeshData): void {
  if (mesh.vertices.length === 0 || mesh.indices.length === 0) {
    return;
  }

  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(WALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(TRACK_COLLISION_GROUPS),
  );
}

function createPhysicsThickWall(
  samples: TrackDefinition["samples"],
  side: -1 | 1,
  widthScale: number,
  track: TrackDefinition,
): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const width = (sample.width ?? TRACK_WIDTH) * widthScale;
    const innerOffset = side * (width / 2 - 0.02);
    const outerOffset = innerOffset + side * WALL_VISUAL_THICKNESS;
    const bankY = Math.sin(sample.bank ?? 0) * innerOffset;
    const bottomY = sample.y + bankY - WALL_EXTENSION_BELOW;
    const topY = sample.y + bankY + WALL_HEIGHT_ABOVE;

    positions.push(
      sample.x + sample.normal.x * innerOffset,
      bottomY,
      sample.z + sample.normal.z * innerOffset,

      sample.x + sample.normal.x * innerOffset,
      topY,
      sample.z + sample.normal.z * innerOffset,

      sample.x + sample.normal.x * outerOffset,
      bottomY,
      sample.z + sample.normal.z * outerOffset,

      sample.x + sample.normal.x * outerOffset,
      topY,
      sample.z + sample.normal.z * outerOffset,
    );

    if (index < samples.length - 1) {
      const start = index * 4;
      const next = start + 4;
      const skipReason = wallSegmentSkipReason(track, samples, index, side, widthScale);

      if (skipReason !== "none") {
        continue;
      }

      if (side < 0) {
        indices.push(
          start, start + 1, next,
          start + 1, next + 1, next,
          start + 2, next + 2, start + 3,
          start + 3, next + 2, next + 3,
          start + 1, start + 3, next + 1,
          start + 3, next + 3, next + 1,
          start, next, start + 2,
          start + 2, next, next + 2,
        );
      } else {
        indices.push(
          start, next, start + 1,
          start + 1, next, next + 1,
          start + 2, start + 3, next + 2,
          start + 3, next + 3, next + 2,
          start + 1, next + 1, start + 3,
          start + 3, next + 1, next + 3,
          start, start + 2, next,
          start + 2, next + 2, next,
        );
      }
    }
  }

  return { vertices: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function wallSegmentSkipReason(
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  index: number,
  side: -1 | 1,
  widthScale: number,
): "none" | "splitGap" {
  void samples;
  void widthScale;
  const sample = samples[index];
  const next = samples[index + 1];
  const segmentDistance = (sample.distance + next.distance) / 2;

  if (isSplitWallJunctionGap(track, segmentDistance, side)) {
    return "splitGap";
  }

  return "none";
}

function addPhysicsWallEndCap(indices: number[], offset: number): void {
  indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
}

function splitWallBoundaries(track: TrackDefinition): VisualBoundaryWall[] {
  const walls: VisualBoundaryWall[] = [];

  for (const surface of track.splitSurfaces) {
    const [leftOuter, rightOuter] = surface.outerBoundaries;

    if (leftOuter?.length >= 2) {
      walls.push({ points: dedupePhysicsWallPoints(leftOuter), closed: false, outwardSign: -1 });
    }

    if (rightOuter?.length >= 2) {
      walls.push({ points: dedupePhysicsWallPoints(rightOuter), closed: false, outwardSign: 1 });
    }

    if (surface.innerBoundary.length >= 3) {
      const inner = dedupePhysicsWallPoints(surface.innerBoundary);
      walls.push({
        points: inner,
        closed: true,
        outwardSign: closedLoopRoadOutwardSign(inner),
      });
    }
  }

  return walls;
}

function closedLoopRoadOutwardSign(points: WallPoint[]): 1 | -1 {
  return signedAreaXZ(points) < 0 ? 1 : -1;
}

function signedAreaXZ(points: WallPoint[]): number {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }

  return area / 2;
}

function createPhysicsWallAlongBoundary(points: WallPoint[], closed: boolean, outwardSign: 1 | -1): TrackMeshData {
  const cleanPoints = dedupePhysicsWallPoints(points);
  const count = cleanPoints.length;

  if (count < (closed ? 3 : 2)) {
    return { vertices: new Float32Array(), indices: new Uint32Array() };
  }

  const offsetNormals = computePhysicsOffsetNormals(cleanPoints, closed, outwardSign);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const point = cleanPoints[index];
    const normal = offsetNormals[index];
    const bottomY = point.y - WALL_EXTENSION_BELOW;
    const topY = point.y + WALL_HEIGHT_ABOVE;
    const outerX = point.x + normal.x * WALL_VISUAL_THICKNESS;
    const outerZ = point.z + normal.z * WALL_VISUAL_THICKNESS;

    positions.push(
      point.x, bottomY, point.z,
      point.x, topY, point.z,
      outerX, bottomY, outerZ,
      outerX, topY, outerZ,
    );
  }

  const segmentCount = closed ? count : count - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % count;

    if (horizontalDistanceXZ(cleanPoints[index], cleanPoints[nextIndex]) < 0.035) {
      continue;
    }

    const start = index * 4;
    const next = nextIndex * 4;

    if (outwardSign < 0) {
      indices.push(
        start, start + 1, next,
        start + 1, next + 1, next,
        start + 2, next + 2, start + 3,
        start + 3, next + 2, next + 3,
        start + 1, start + 3, next + 1,
        start + 3, next + 3, next + 1,
        start, next, start + 2,
        start + 2, next, next + 2,
      );
    } else {
      indices.push(
        start, next, start + 1,
        start + 1, next, next + 1,
        start + 2, start + 3, next + 2,
        start + 3, next + 3, next + 2,
        start + 1, next + 1, start + 3,
        start + 3, next + 1, next + 3,
        start, start + 2, next,
        start + 2, next + 2, next,
      );
    }
  }

  return { vertices: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function horizontalDistanceXZ(a: WallPoint, b: WallPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function computePhysicsOffsetNormals(points: WallPoint[], closed: boolean, outwardSign: 1 | -1): OffsetNormal[] {
  const normals: OffsetNormal[] = [];
  const count = points.length;

  for (let index = 0; index < count; index += 1) {
    if (!closed && index === 0) {
      normals.push(segmentPhysicsOffsetNormal(points[index], points[index + 1], outwardSign));
      continue;
    }

    if (!closed && index === count - 1) {
      normals.push(segmentPhysicsOffsetNormal(points[index - 1], points[index], outwardSign));
      continue;
    }

    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const beforeNormal = segmentPhysicsOffsetNormal(previous, current, outwardSign);
    const afterNormal = segmentPhysicsOffsetNormal(current, next, outwardSign);
    let mx = beforeNormal.x + afterNormal.x;
    let mz = beforeNormal.z + afterNormal.z;
    const length = Math.hypot(mx, mz);

    if (length < 0.0001) {
      normals.push(afterNormal);
      continue;
    }

    mx /= length;
    mz /= length;

    const dot = Math.max(0.58, mx * afterNormal.x + mz * afterNormal.z);
    const scale = Math.min(1.22, 1 / dot);

    normals.push({ x: mx * scale, z: mz * scale });
  }

  return normals;
}

function segmentPhysicsOffsetNormal(a: WallPoint, b: WallPoint, outwardSign: 1 | -1): OffsetNormal {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;

  return {
    x: outwardSign * (dz / length),
    z: outwardSign * (-dx / length),
  };
}

function dedupePhysicsWallPoints(points: WallPoint[]): WallPoint[] {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) > 0.05;
  });
}

function createFeatureColliders(world: RAPIER.World, track: TrackDefinition): Array<MovingVerticalObstacle | DynamicBody> {
  const dynamicBodies: Array<MovingVerticalObstacle | DynamicBody> = [];

  for (const [index, peg] of track.features.pegs.entries()) {
    const sample = featureSampleForFeature(track, peg);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(featureRenderOffset(peg), -maxOffset, maxOffset);
    const transform = surfaceTransform(sample, offset, PEG_HEIGHT, pegExtensionAtTime(0, peg.phase));

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(transform.x, transform.y, transform.z),
    );

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(PEG_HEIGHT / 2, peg.radius)
        .setFriction(PEG_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(PEG_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `peg-${index}`,
      colliders: [collider],
      x: transform.x,
      z: transform.z,
      trackY: transform.trackY,
      phase: peg.phase,
      fullHeight: PEG_HEIGHT,
    });
  }

  for (const [index, bumper] of track.features.greenBumpers.entries()) {
    const sample = featureSampleForFeature(track, bumper);
    const phase = greenBumperRuntimePhase(bumper, index);
    const transform = surfaceTransform(sample, featureRenderOffset(bumper), BUMPER_HEIGHT, pegExtensionAtTime(0, phase));

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(transform.x, transform.y, transform.z),
    );

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(BUMPER_HEIGHT / 2, bumper.radius)
        .setFriction(BUMPER_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(BUMPER_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `green-bumper-${index}`,
      colliders: [collider],
      x: transform.x,
      z: transform.z,
      trackY: transform.trackY,
      phase,
      fullHeight: BUMPER_HEIGHT,
    });
  }

  for (const [index, gate] of track.features.gates.entries()) {
    const sample = featureSampleForFeature(track, gate);
    const transform = surfaceTransform(sample, featureRenderOffset(gate), GATE_HEIGHT, 1);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(transform.x, transform.y, transform.z)
        .setRotation(yawRotation(sample.yaw)),
    );
    const width = sample.width ?? TRACK_WIDTH;

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2 + 0.08, GATE_HEIGHT / 2, 0.16)
        .setFriction(GATE_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(GATE_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `gate-${index}`,
      kind: "gate",
      colliders: [collider],
      x: transform.x,
      y: transform.y,
      z: transform.z,
      yaw: sample.yaw,
      phase: gate.phase,
      speed: 1,
    });
  }

  for (const [trapperIndex, trapper] of track.features.trappers.entries()) {
    const sample = featureSampleForFeature(track, trapper);
    const transform = surfaceTransform(sample, featureRenderOffset(trapper), TRAPPER_HEIGHT, 1);
    const segmentCount = 10;
    const ringRadius = Math.min(trapper.radius, Math.max(0.65, (sample.width ?? TRACK_WIDTH) / 2 - 0.55));

    for (let index = 0; index < segmentCount; index += 1) {
      const angle = (index / segmentCount) * Math.PI * 2;
      const x = transform.x + Math.cos(angle) * ringRadius;
      const z = transform.z + Math.sin(angle) * ringRadius;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(x, transform.y, z)
          .setRotation(yawRotation(sample.yaw - angle)),
      );

      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.09, TRAPPER_HEIGHT / 2, 0.26)
          .setFriction(GATE_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setRestitution(GATE_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
        body,
      );

      dynamicBodies.push({
        body,
        id: `trapper-${trapperIndex}-${index}`,
        kind: "trapper",
        colliders: [collider],
        x,
        y: transform.y,
        z,
        yaw: sample.yaw - angle,
        phase: trapper.phase,
        speed: 1,
      });
    }
  }

  for (const [index, spinner] of track.features.spinners.entries()) {
    const sample = featureSampleForFeature(track, spinner);
    const transform = surfaceTransform(sample, featureRenderOffset(spinner), SPINNER_HEIGHT, 1);
    transform.y += SPINNER_TRACK_LIFT;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(transform.x, transform.y, transform.z)
        .setRotation(yawRotation(sample.yaw + spinner.phase)),
    );
    const width = (sample.width ?? TRACK_WIDTH) * 0.9;

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, SPINNER_HEIGHT / 2, 0.12)
        .setFriction(SPINNER_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(SPINNER_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `spinner-${index}`,
      kind: "spinner",
      colliders: [collider],
      x: transform.x,
      y: transform.y,
      z: transform.z,
      yaw: sample.yaw,
      phase: spinner.phase,
      speed: spinner.speed,
    });
  }

  for (const [index, hammer] of track.features.hammers.entries()) {
    const sample = featureSampleForFeature(track, hammer);
    const transform = surfaceTransform(sample, featureRenderOffset(hammer), HAMMER_HEIGHT, 1);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(transform.x, transform.y, transform.z)
        .setRotation(yawRotation(sample.yaw + Math.PI / 2)),
    );

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.32, HAMMER_HEIGHT / 2, 1.55)
        .setFriction(HAMMER_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(HAMMER_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `hammer-${index}`,
      kind: "hammer",
      colliders: [collider],
      x: transform.x,
      y: transform.y,
      z: transform.z,
      yaw: sample.yaw + Math.PI / 2,
      phase: hammer.phase,
      speed: hammer.side,
    });
  }

  for (const [index, turnstile] of track.features.turnstiles.entries()) {
    const sample = featureSampleForFeature(track, turnstile);
    const transform = surfaceTransform(sample, featureRenderOffset(turnstile), TURNSTILE_HEIGHT, 1);
    transform.y += TURNSTILE_TRACK_LIFT;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(transform.x, transform.y, transform.z)
        .setRotation(yawRotation(sample.yaw + turnstile.phase)),
    );
    const width = (sample.width ?? TRACK_WIDTH) * 0.58;

    const colliderA = world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, TURNSTILE_HEIGHT / 2, 0.13)
        .setFriction(TURNSTILE_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(TURNSTILE_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    const colliderB = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.13, TURNSTILE_HEIGHT / 2, width / 2)
        .setFriction(TURNSTILE_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(TURNSTILE_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(OBSTACLE_COLLISION_GROUPS),
      body,
    );

    dynamicBodies.push({
      body,
      id: `turnstile-${index}`,
      kind: "turnstile",
      colliders: [colliderA, colliderB],
      x: transform.x,
      y: transform.y,
      z: transform.z,
      yaw: sample.yaw,
      phase: turnstile.phase,
      speed: turnstile.speed,
    });
  }

  return dynamicBodies;
}

function updateDynamicObstacles(
  obstacles: Array<MovingVerticalObstacle | DynamicBody>,
  time: number,
  inactiveBodyHandles: Set<number>,
): void {
  for (const obstacle of obstacles) {
    if (inactiveBodyHandles.has(obstacle.body.handle)) {
      continue;
    }

    if ("kind" in obstacle) {
      updateDynamicBody(obstacle, time);
      continue;
    }

    const extension = pegExtensionAtTime(time, obstacle.phase);

    obstacle.body.setNextKinematicTranslation({
      x: obstacle.x,
      y: verticalObstacleCenterY(obstacle.trackY, obstacle.fullHeight, extension),
      z: obstacle.z,
    });
  }
}

function createObstacleColliderMap(obstacles: Array<MovingVerticalObstacle | DynamicBody>): Map<number, { body: RAPIER.RigidBody; id: string }> {
  const colliders = new Map<number, { body: RAPIER.RigidBody; id: string }>();

  for (const obstacle of obstacles) {
    for (const collider of obstacle.colliders) {
      colliders.set(collider.handle, { body: obstacle.body, id: obstacle.id });
    }
  }

  return colliders;
}

function updateBallFrameStates(
  world: RAPIER.World,
  balls: SimBall[],
  track: TrackDefinition,
  displayProgressByBall: Map<string, number>,
  frameStateByBall: Map<string, BallFrameState>,
  activePowerupsByBall: Map<string, ActivePowerup[]>,
  time: number,
): void {
  frameStateByBall.clear();

  for (const ball of balls) {
    const position = ball.body.translation();
    const physicalProgress = progressForPosition(track, position);
    const trackStatus = trackDistanceForPosition(track, position);
    const hasContact = ballHasAnyContact(world, ball);
    const previousDisplayProgress = displayProgressByBall.get(ball.id);

    const progressStepIsPlausible = hasContact
      ? isGroundedProgressStepPlausible(physicalProgress, previousDisplayProgress)
      : isAirborneProgressStepPlausible(physicalProgress, previousDisplayProgress);
    const isRaceProgressCredible =
      progressStepIsPlausible &&
      (hasContact ||
        isPlausibleAirborneRacePosition(
          track,
          position,
          physicalProgress,
          trackStatus,
          previousDisplayProgress,
        ));

    const displayProgress = isRaceProgressCredible
      ? physicalProgress
      : previousDisplayProgress ?? physicalProgress;

    if (isRaceProgressCredible) {
      displayProgressByBall.set(ball.id, displayProgress);
    } else if (previousDisplayProgress === undefined) {
      displayProgressByBall.set(ball.id, displayProgress);
    }

    const activePowerups = activePowerupsByBall.get(ball.id)?.filter((powerup) => powerup.endsAt > time).map((powerup) => powerup.kind) ?? [];

    frameStateByBall.set(ball.id, {
      physicalProgress,
      displayProgress,
      hasContact,
      isRaceProgressCredible,
      activePowerups,
    });
  }
}

function updatePowerups(
  world: RAPIER.World,
  balls: SimBall[],
  track: TrackDefinition,
  hiddenPowerupsUntil: Map<string, number>,
  activePowerupsByBall: Map<string, ActivePowerup[]>,
  time: number,
): void {
  for (const [powerupIndex, powerup] of track.features.powerups.entries()) {
    if ((hiddenPowerupsUntil.get(powerup.id) ?? 0) > time) {
      continue;
    }

    const sample = featureSampleForFeature(track, powerup);
    const powerupPosition = {
      x: sample.x + sample.normal.x * featureRenderOffset(powerup),
      y: surfaceYAtOffset(sample, featureRenderOffset(powerup)) + 0.46,
      z: sample.z + sample.normal.z * featureRenderOffset(powerup),
    };
    const collector = balls.find((ball) => {
      const position = ball.body.translation();
      const pickupDistance = POWERUP_PICKUP_RADIUS + ball.radius;
      const dx = position.x - powerupPosition.x;
      const dy = position.y - powerupPosition.y;
      const dz = position.z - powerupPosition.z;
      return dx * dx + dy * dy + dz * dz < pickupDistance * pickupDistance;
    });

    if (!collector) {
      continue;
    }

    hiddenPowerupsUntil.set(powerup.id, time + POWERUP_RESPAWN_SECONDS);
    // Runtime powerups are intentionally non-deterministic: the pickup grants a
    // fresh random effect every time this pickup is collected, including after
    // respawn. The generated powerup.kind is only a legacy/default field.
    addActivePowerup(world, balls, collector, randomPowerupKind(), activePowerupsByBall, time);
  }
}

function addActivePowerup(
  world: RAPIER.World,
  balls: SimBall[],
  ball: SimBall,
  kind: PowerupKind,
  activePowerupsByBall: Map<string, ActivePowerup[]>,
  time: number,
): void {
  if (kind === "slow") {
    const sourceActive = (activePowerupsByBall.get(ball.id) ?? []).filter(
      (powerup) => powerup.endsAt > time && powerup.kind !== "slow-source",
    );
    sourceActive.push({ kind: "slow-source", endsAt: time + POWERUP_DURATION });
    activePowerupsByBall.set(ball.id, sourceActive);
  }

  const targetBalls = kind === "slow" ? balls.filter((other) => other.id !== ball.id) : [ball];

  for (const target of targetBalls) {
    const active = (activePowerupsByBall.get(target.id) ?? []).filter((powerup) => powerup.endsAt > time && powerup.kind !== kind);
    active.push({ kind, endsAt: time + POWERUP_DURATION });
    activePowerupsByBall.set(target.id, active);

    if (kind === "giant") {
      resizeBallCollider(world, target, DEFAULT_BALL_RADIUS * 1.55);
    } else if (kind === "tiny") {
      resizeBallCollider(world, target, DEFAULT_BALL_RADIUS * 0.58);
    } else if (kind === "slow") {
      const velocity = target.body.linvel();
      const spin = target.body.angvel();
      target.body.setLinvel({ x: velocity.x * 0.2, y: velocity.y * 0.2, z: velocity.z * 0.2 }, true);
      target.body.setAngvel({ x: spin.x * 0.2, y: spin.y * 0.2, z: spin.z * 0.2 }, true);
    }

    setBallGhostMode(target, active.some((powerup) => powerup.kind === "ghost" && powerup.endsAt > time));
  }
}

function applyActivePowerups(
  world: RAPIER.World,
  balls: SimBall[],
  activePowerupsByBall: Map<string, ActivePowerup[]>,
  obstacleBodyByCollider: Map<number, { body: RAPIER.RigidBody; id: string }>,
  smashedObstacleBodies: Set<number>,
  destroyedObstacleIds: Set<string>,
  time: number,
): void {
  for (const ball of balls) {
    const active = (activePowerupsByBall.get(ball.id) ?? []).filter((powerup) => powerup.endsAt > time);
    activePowerupsByBall.set(ball.id, active);
    const kinds = new Set(active.map((powerup) => powerup.kind));

    if (!kinds.has("giant") && !kinds.has("tiny") && Math.abs(ball.radius - DEFAULT_BALL_RADIUS) > 0.001) {
      resizeBallCollider(world, ball, DEFAULT_BALL_RADIUS);
    }

    setBallGhostMode(ball, kinds.has("ghost"));

    if (kinds.has("slow")) {
      applySlow(ball);
    }

    if (kinds.has("speed")) {
      const velocity = ball.body.linvel();
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
      if (horizontalSpeed > 0.04 && horizontalSpeed < 7.4) {
        ball.body.setLinvel({ x: velocity.x * 1.026, y: velocity.y, z: velocity.z * 1.026 }, true);
      }
    }

    if (kinds.has("giant")) {
      knockAwayNearbyBalls(ball, balls);
    }

    if (kinds.has("barrier")) {
      repelNearbyBalls(ball, balls);
    }

    if (kinds.has("smash")) {
      smashTouchedObstacles(world, ball, obstacleBodyByCollider, smashedObstacleBodies, destroyedObstacleIds);
    }
  }
}

function randomPowerupKind(): PowerupKind {
  return POWERUP_KINDS[Math.floor(trueRandom() * POWERUP_KINDS.length)] ?? "speed";
}

function applySlow(ball: SimBall): void {
  const velocity = ball.body.linvel();
  const spin = ball.body.angvel();
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);

  if (speed > 1.1) {
    const scale = 1.1 / speed;
    ball.body.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
  }

  ball.body.setAngvel({ x: spin.x * 0.985, y: spin.y * 0.985, z: spin.z * 0.985 }, true);
}

function repelNearbyBalls(source: SimBall, balls: SimBall[]): void {
  const sourcePosition = source.body.translation();

  for (const other of balls) {
    if (other.id === source.id) {
      continue;
    }

    const position = other.body.translation();
    const dx = position.x - sourcePosition.x;
    const dy = (position.y - sourcePosition.y) * 0.35;
    const dz = position.z - sourcePosition.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance <= 0.001 || distance > BARRIER_RADIUS) {
      continue;
    }

    const falloff = 1 - distance / BARRIER_RADIUS;
    const strength = BARRIER_FORCE * falloff * falloff;
    const pushX = (dx / distance) * strength;
    const pushZ = (dz / distance) * strength;
    const sourceVelocity = source.body.linvel();
    const otherVelocity = other.body.linvel();
    const closingSpeed = (sourceVelocity.x - otherVelocity.x) * (dx / distance) + (sourceVelocity.z - otherVelocity.z) * (dz / distance);
    const closingBoost = Math.max(0, closingSpeed) * 0.018 * falloff;

    other.body.applyImpulse({ x: pushX + (dx / distance) * closingBoost, y: 0.004, z: pushZ + (dz / distance) * closingBoost }, true);
  }
}

function smashTouchedObstacles(
  world: RAPIER.World,
  ball: SimBall,
  obstacleBodyByCollider: Map<number, { body: RAPIER.RigidBody; id: string }>,
  smashedObstacleBodies: Set<number>,
  destroyedObstacleIds: Set<string>,
): void {
  const bodiesToRemove: Array<{ body: RAPIER.RigidBody; id: string }> = [];

  world.contactPairsWith(ball.collider, (collider) => {
    const obstacle = obstacleBodyByCollider.get(collider.handle);

    if (obstacle && !smashedObstacleBodies.has(obstacle.body.handle)) {
      smashedObstacleBodies.add(obstacle.body.handle);
      bodiesToRemove.push(obstacle);
    }
  });

  for (const obstacle of bodiesToRemove) {
    destroyedObstacleIds.add(obstacle.id);
    world.removeRigidBody(obstacle.body);
  }
}

function hiddenPowerupIds(hiddenPowerupsUntil: Map<string, number>, time: number): string[] {
  const ids: string[] = [];

  for (const [id, respawnAt] of hiddenPowerupsUntil) {
    if (respawnAt > time) {
      ids.push(id);
    } else {
      hiddenPowerupsUntil.delete(id);
    }
  }

  return ids;
}

function resizeBallCollider(world: RAPIER.World, ball: SimBall, radius: number): void {
  if (Math.abs(ball.radius - radius) < 0.001) {
    return;
  }

  world.removeCollider(ball.collider, true);
  ball.collider = world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      .setDensity(BALL_DENSITY * (DEFAULT_BALL_RADIUS / radius) ** 3)
      .setFriction(BALL_FRICTION_MIN)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(BALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(SOLID_BALL_COLLISION_GROUPS),
    ball.body,
  );
  ball.radius = radius;
}

function setBallGhostMode(ball: SimBall, enabled: boolean): void {
  ball.collider.setCollisionGroups(enabled ? GHOST_BALL_COLLISION_GROUPS : SOLID_BALL_COLLISION_GROUPS);
}

function knockAwayNearbyBalls(source: SimBall, balls: SimBall[]): void {
  const sourcePosition = source.body.translation();

  for (const other of balls) {
    if (other.id === source.id) {
      continue;
    }

    const position = other.body.translation();
    const dx = position.x - sourcePosition.x;
    const dz = position.z - sourcePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= 0.001 || distance > 1.35) {
      continue;
    }

    other.body.applyImpulse({ x: (dx / distance) * 0.018, y: 0.006, z: (dz / distance) * 0.018 }, true);
  }
}

function isPlausibleAirborneRacePosition(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
  progress: number,
  trackStatus: ReturnType<typeof trackDistanceForPosition>,
  previousDisplayProgress?: number,
): boolean {
  if (!isAirborneProgressStepPlausible(progress, previousDisplayProgress)) {
    return false;
  }

  if (trackStatus.onCourse) {
    return true;
  }

  const nearestCourse = sampleAtDistance(track.samples, progress);
  const tooFarSideways = trackStatus.lateralDistance > AIRBORNE_DISPLAY_MAX_LATERAL_DISTANCE;
  const tooFarAboveCourse = trackStatus.verticalDistance > AIRBORNE_DISPLAY_MAX_VERTICAL_DISTANCE;
  const clearlyBelowCourse = position.y < nearestCourse.y - AIRBORNE_DISPLAY_MAX_BELOW_COURSE;

  return !tooFarSideways && !tooFarAboveCourse && !clearlyBelowCourse;
}

function isAirborneProgressStepPlausible(progress: number, previousDisplayProgress?: number): boolean {
  if (previousDisplayProgress === undefined) {
    return true;
  }

  const delta = progress - previousDisplayProgress;

  return (
    delta <= AIRBORNE_DISPLAY_MAX_PROGRESS_ADVANCE_PER_STEP &&
    delta >= -AIRBORNE_DISPLAY_MAX_PROGRESS_BACKTRACK_PER_STEP
  );
}

function isGroundedProgressStepPlausible(progress: number, previousDisplayProgress?: number): boolean {
  if (previousDisplayProgress === undefined) {
    return true;
  }

  const delta = progress - previousDisplayProgress;

  return (
    delta <= GROUNDED_DISPLAY_MAX_PROGRESS_ADVANCE_PER_STEP &&
    delta >= -GROUNDED_DISPLAY_MAX_PROGRESS_BACKTRACK_PER_STEP
  );
}

function isValidFinishCrossing(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
  progress: number,
): boolean {
  const finish = track.finish;
  const dx = position.x - finish.x;
  const dy = position.y - finish.y;
  const dz = position.z - finish.z;
  const signedForwardDistance = dx * finish.tangent.x + dz * finish.tangent.z;
  const lateralDistance = Math.abs(dx * finish.normal.x + dz * finish.normal.z);
  const finishWidth = finish.width ?? TRACK_WIDTH;

  if (
    signedForwardDistance < -0.08 ||
    signedForwardDistance > 5.5 ||
    lateralDistance > finishWidth / 2 + DEFAULT_BALL_RADIUS * 1.9 ||
    dy < -DEFAULT_BALL_RADIUS * 2.2 ||
    dy > 4.2
  ) {
    return false;
  }

  const trackStatus = trackDistanceForPosition(track, position);

  return progress >= track.finishDistance && isPlausibleAirborneRacePosition(track, position, progress, trackStatus);
}

function updateFallRespawns(
  world: RAPIER.World,
  balls: SimBall[],
  finishedIds: Set<string>,
  noContactSecondsByBall: Map<string, number>,
  safeStateByBall: Map<string, SafeBallState>,
  pendingRespawnsByBall: Map<string, PendingRespawn>,
  track: TrackDefinition,
  frameStateByBall: Map<string, BallFrameState>,
  displayProgressByBall: Map<string, number>,
  time: number,
  deltaSeconds: number,
): void {
  for (const ball of balls) {
    if (finishedIds.has(ball.id)) {
      noContactSecondsByBall.delete(ball.id);
      continue;
    }

    const position = ball.body.translation();
    const frameState = frameStateByBall.get(ball.id);
    const hasContact = frameState?.hasContact ?? false;
    const trackStatus = trackDistanceForPosition(track, position);
    const pendingRespawn = pendingRespawnsByBall.get(ball.id);

    if (pendingRespawn) {
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

      if (time >= pendingRespawn.respawnAt) {
        respawnBallAtSafeState(ball, pendingRespawn.safeState, track);
        pendingRespawnsByBall.delete(ball.id);
        noContactSecondsByBall.set(ball.id, 0);
      }

      continue;
    }

    const airborneSecondsBeforeContact = noContactSecondsByBall.get(ball.id) ?? 0;

    if (
      hasContact &&
      frameState &&
      isIllegalShortcutLanding(
        frameState,
        safeStateByBall.get(ball.id),
        position,
        trackStatus,
        airborneSecondsBeforeContact,
      )
    ) {
      queueBallRespawn(ball, safeStateByBall, pendingRespawnsByBall, track, time);
      noContactSecondsByBall.set(ball.id, 0);
      continue;
    }

    // If a ball simply got airtime and landed back on a plausible course surface,
    // reconcile display progress to the landing point instead of freezing it forever.
    // True lower-track shortcuts are filtered above using the last safe contact
    // checkpoint, drop height, airtime, and progress gain together.
    if (
      hasContact &&
      frameState &&
      !frameState.isRaceProgressCredible &&
      trackStatus.onCourse &&
      isSafeCheckpointContact(trackStatus, position)
    ) {
      frameState.displayProgress = frameState.physicalProgress;
      frameState.isRaceProgressCredible = true;
      displayProgressByBall.set(ball.id, frameState.displayProgress);
    }

    if (hasContact) {
      noContactSecondsByBall.set(ball.id, 0);
      if (frameState?.isRaceProgressCredible && isSafeCheckpointContact(trackStatus, position)) {
        const nextSafeState = safeStateFromGroundedPosition(track, position, ball.radius);
        const previousSafeState = safeStateByBall.get(ball.id);

        if (isSafeCheckpointProgressUpdate(nextSafeState, previousSafeState)) {
          safeStateByBall.set(ball.id, nextSafeState);
        }
      }
    } else {
      noContactSecondsByBall.set(ball.id, (noContactSecondsByBall.get(ball.id) ?? 0) + deltaSeconds);
    }

    const noContactSeconds = noContactSecondsByBall.get(ball.id) ?? 0;
    const hardFallen = position.y < HARD_FALL_Y;

    if (hardFallen) {
      queueBallRespawn(ball, safeStateByBall, pendingRespawnsByBall, track, time);
      continue;
    }

    if (hasContact || noContactSeconds < DISQUALIFY_NO_CONTACT_SECONDS) {
      continue;
    }

    if (isClearlyFallingOffCourse(track, position, frameState)) {
      queueBallRespawn(ball, safeStateByBall, pendingRespawnsByBall, track, time);
    }
  }
}

function isClearlyFallingOffCourse(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
  frameState?: BallFrameState,
): boolean {
  const referenceProgress = frameState?.displayProgress ?? progressForPosition(track, position);
  const referenceCourse = sampleAtDistance(track.samples, referenceProgress);
  const referenceWidth = referenceCourse.width ?? TRACK_WIDTH;

  const dx = position.x - referenceCourse.x;
  const dz = position.z - referenceCourse.z;
  const horizontalDistanceFromReference = Math.hypot(dx, dz);
  const belowReferenceCourse = position.y < referenceCourse.y - FALL_DISQUALIFY_DROP;
  const farFromReferenceCourse =
    horizontalDistanceFromReference > referenceWidth * FALL_LATERAL_DISTANCE_SCALE + FALL_LATERAL_DISTANCE_EXTRA;

  const rawNearestStatus = trackDistanceForPosition(track, position);
  const notPlausiblyRacing =
    !frameState?.isRaceProgressCredible &&
    !isPlausibleAirborneRacePosition(
      track,
      position,
      frameState?.physicalProgress ?? referenceProgress,
      rawNearestStatus,
      frameState?.displayProgress,
    );

  return notPlausiblyRacing && belowReferenceCourse && farFromReferenceCourse;
}

function isIllegalShortcutLanding(
  frameState: BallFrameState,
  safeState: SafeBallState | undefined,
  position: { x: number; y: number; z: number },
  trackStatus: ReturnType<typeof trackDistanceForPosition>,
  airborneSeconds: number,
): boolean {
  if (!safeState || frameState.isRaceProgressCredible || !trackStatus.onCourse) {
    return false;
  }

  if (airborneSeconds < ILLEGAL_SHORTCUT_MIN_AIRTIME_SECONDS) {
    return false;
  }

  const progressGain = frameState.physicalProgress - safeState.progress;
  const verticalDrop = safeState.position.y - position.y;
  const horizontalSeparation = Math.hypot(
    safeState.position.x - position.x,
    safeState.position.z - position.z,
  );

  return (
    progressGain >= ILLEGAL_SHORTCUT_MIN_PROGRESS_GAIN &&
    verticalDrop >= ILLEGAL_SHORTCUT_MIN_VERTICAL_DROP &&
    horizontalSeparation >= ILLEGAL_SHORTCUT_MIN_HORIZONTAL_SEPARATION
  );
}

function queueBallRespawn(
  ball: SimBall,
  safeStateByBall: Map<string, SafeBallState>,
  pendingRespawnsByBall: Map<string, PendingRespawn>,
  track: TrackDefinition,
  time: number,
): void {
  if (pendingRespawnsByBall.has(ball.id)) {
    return;
  }

  pendingRespawnsByBall.set(ball.id, {
    respawnAt: time + FALL_RESPAWN_DELAY_SECONDS,
    safeState: safeStateByBall.get(ball.id) ?? safeStateForProgress(track, 0.4, ball.radius),
  });
}

function safeStateForProgress(track: TrackDefinition, progress: number, radius: number): SafeBallState {
  const sample = sampleAtDistance(track.samples, clamp(progress - 1.2, 0, track.finishDistance));

  return {
    progress: sample.distance,
    position: {
      x: sample.x,
      y: surfaceYAtOffset(sample, 0) + radius + 0.36,
      z: sample.z,
    },
    yaw: sample.yaw,
    tangent: sample.tangent,
  };
}

function safeStateFromGroundedPosition(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
  radius: number,
): SafeBallState {
  const sample = nearestRaceRouteSample(track, position);

  return {
    progress: sample.distance,
    position: {
      x: sample.x,
      y: surfaceYAtOffset(sample, 0) + radius + 0.36,
      z: sample.z,
    },
    yaw: sample.yaw,
    tangent: sample.tangent,
  };
}

function isSafeCheckpointContact(
  trackStatus: ReturnType<typeof trackDistanceForPosition>,
  position: { x: number; y: number; z: number },
): boolean {
  return trackStatus.onCourse && trackStatus.verticalDistance <= 1.35 && position.y > -30;
}

function isSafeCheckpointProgressUpdate(next: SafeBallState, previous?: SafeBallState): boolean {
  if (!previous) {
    return true;
  }

  return next.progress <= previous.progress + SAFE_CHECKPOINT_MAX_ADVANCE_PER_UPDATE;
}

function nearestRaceRouteSample(
  track: TrackDefinition,
  position: { x: number; y: number; z: number },
): TrackDefinition["samples"][number] {
  let closest = track.samples[0];
  let closestScore = Number.POSITIVE_INFINITY;

  for (const sample of raceRouteSamples(track)) {
    const dx = sample.x - position.x;
    const dz = sample.z - position.z;
    const dy = sample.y - position.y;
    const score = dx * dx + dz * dz + dy * dy * 0.38;

    if (score < closestScore) {
      closest = sample;
      closestScore = score;
    }
  }

  return closest;
}

function raceRouteSamples(track: TrackDefinition): TrackDefinition["samples"] {
  const cached = routeSamplesByTrack.get(track);

  if (cached) {
    return cached;
  }

  const routeSamples: TrackDefinition["samples"][] = [track.samples];

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
  routeSamplesByTrack.set(track, samples);

  return samples;
}

function respawnBallAtSafeState(
  ball: SimBall,
  safeState: SafeBallState,
  track: TrackDefinition,
): void {
  const corrected = correctedSafeRespawnState(track, safeState, ball.radius);

  ball.body.setTranslation(corrected.position, true);
  ball.body.setRotation(trackRotation(corrected.yaw, 0, 0), true);
  ball.body.setLinvel({ x: corrected.tangent.x * 0.45, y: 0.02, z: corrected.tangent.z * 0.45 }, true);
  ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function correctedSafeRespawnState(
  track: TrackDefinition,
  safeState: SafeBallState,
  radius: number,
): SafeBallState {
  const sample = nearestRaceRouteSample(track, safeState.position);
  const horizontalDistance = Math.hypot(
    sample.x - safeState.position.x,
    sample.z - safeState.position.z,
  );
  const verticalDistance = Math.abs(sample.y - safeState.position.y);
  const progressGap = Math.abs(sample.distance - safeState.progress);
  const useNearestRouteSample = horizontalDistance <= TRACK_WIDTH * 1.4 && verticalDistance <= 5.0 && progressGap <= 10.0;
  const respawnSample = useNearestRouteSample
    ? sample
    : nearestRaceRouteSample(track, {
        x: sampleAtDistance(track.samples, clamp(safeState.progress, 0, track.finishDistance)).x,
        y: sampleAtDistance(track.samples, clamp(safeState.progress, 0, track.finishDistance)).y,
        z: sampleAtDistance(track.samples, clamp(safeState.progress, 0, track.finishDistance)).z,
      });

  return {
    progress: respawnSample.distance,
    position: {
      x: respawnSample.x,
      y: surfaceYAtOffset(respawnSample, 0) + radius + 0.42,
      z: respawnSample.z,
    },
    yaw: respawnSample.yaw,
    tangent: respawnSample.tangent,
  };
}

function ballHasAnyContact(world: RAPIER.World, ball: SimBall): boolean {
  let hasContact = false;

  world.contactPairsWith(ball.collider, () => {
    hasContact = true;
  });

  return hasContact;
}

function updateDynamicBody(obstacle: DynamicBody, time: number): void {
  if (obstacle.kind === "gate") {
    const extension = gateExtensionAtTime(time, obstacle.phase);
    obstacle.body.setNextKinematicTranslation({
      x: obstacle.x,
      y: obstacle.y - (1 - extension) * 0.92,
      z: obstacle.z,
    });
    obstacle.body.setNextKinematicRotation(yawRotation(obstacle.yaw));
    return;
  }

  if (obstacle.kind === "trapper") {
    const extension = trapperExtensionAtTime(time, obstacle.phase);
    obstacle.body.setNextKinematicTranslation({
      x: obstacle.x,
      y: obstacle.y - (1 - extension) * 1.24,
      z: obstacle.z,
    });
    obstacle.body.setNextKinematicRotation(yawRotation(obstacle.yaw));
    return;
  }

  if (obstacle.kind === "spinner" || obstacle.kind === "turnstile") {
    obstacle.body.setNextKinematicTranslation({ x: obstacle.x, y: obstacle.y, z: obstacle.z });
    obstacle.body.setNextKinematicRotation(yawRotation(obstacle.yaw + obstacle.phase + time * obstacle.speed));
    return;
  }

  const swing = Math.sin(time * 0.75 + obstacle.phase) * 1.15 * obstacle.speed;
  obstacle.body.setNextKinematicTranslation({ x: obstacle.x, y: obstacle.y, z: obstacle.z });
  obstacle.body.setNextKinematicRotation(yawRotation(obstacle.yaw + swing));
}

function trapperExtensionAtTime(time: number, phase: number): number {
  const t = obstacleCycleValue(time, phase, 18);

  if (t < 6) {
    return 1;
  }

  if (t < 8) {
    return 1 - smoothstep(0, 1, (t - 6) / 2);
  }

  if (t < 14) {
    return 0;
  }

  return smoothstep(0, 1, (t - 14) / 4);
}

function pegExtensionAtTime(time: number, phase = 0): number {
  const t = obstacleCycleValue(time, phase, PEG_MOTION_PERIOD);

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

function greenBumperRuntimePhase(bumper: TrackDefinition["features"]["greenBumpers"][number], index: number): number {
  const runtimePhase = (bumper as RuntimeGreenBumper).phase;

  if (runtimePhase !== undefined) {
    return runtimePhase;
  }

  return greenBumperPhase(index, bumper.distance);
}

function greenBumperPhase(index: number, distance: number): number {
  return obstacleCycleValue(index * 3.7 + distance * 0.13, 0);
}

function surfaceYAtOffset(sample: TrackDefinition["samples"][number], offset: number): number {
  return sample.y + Math.sin(sample.bank ?? 0) * offset;
}

type RouteAwareFeature = {
  distance: number;
  offset?: number;
  routeId?: string;
  routeOffset?: number;
  mainOffset?: number;
};

function featureSampleForFeature(
  track: TrackDefinition,
  feature: RouteAwareFeature,
): TrackDefinition["samples"][number] {
  const routeId = feature.routeId ?? "";

  if (routeId.startsWith("split-")) {
    const match = /^split-(\d+)-(left|right)$/.exec(routeId);

    if (match) {
      const splitIndex = Number(match[1]);
      const side = match[2] === "left" ? -1 : 1;
      const surface = track.splitSurfaces[splitIndex];

      if (surface) {
        return splitSurfaceSampleAtDistance(surface, feature.distance, side);
      }

      const branch = track.branches.find(
        (candidate, index) =>
          Math.floor(index / 2) === splitIndex && candidate.side === side,
      );

      if (branch) {
        return sampleAtDistance(branch.samples, feature.distance);
      }
    }
  }

  return sampleAtDistance(track.samples, feature.distance);
}

function featureRenderOffset(feature: RouteAwareFeature): number {
  return feature.routeOffset ?? feature.offset ?? 0;
}

function splitSurfaceLaneSamples(
  surface: TrackDefinition["splitSurfaces"][number],
  side: -1 | 1,
): TrackDefinition["samples"] {
  const rowSize = 8;
  const vertices = surface.road.vertices;
  const rowCount = Math.floor(vertices.length / (rowSize * 3));
  const samples: TrackDefinition["samples"] = [];

  if (rowCount <= 0) {
    return samples;
  }

  const leftColumn = side < 0 ? 0 : 4;
  const rightColumn = side < 0 ? 3 : 7;

  for (let row = 0; row < rowCount; row += 1) {
    const alpha = rowCount <= 1 ? 0 : row / (rowCount - 1);
    const distance = surface.startDistance + (surface.endDistance - surface.startDistance) * alpha;
    const previousRow = Math.max(0, row - 1);
    const nextRow = Math.min(rowCount - 1, row + 1);
    const left = splitSurfaceVertex(vertices, row, leftColumn, rowSize);
    const right = splitSurfaceVertex(vertices, row, rightColumn, rowSize);
    const previousCenter = splitSurfaceLaneCenter(vertices, previousRow, leftColumn, rightColumn, rowSize);
    const nextCenter = splitSurfaceLaneCenter(vertices, nextRow, leftColumn, rightColumn, rowSize);
    const center = midpoint3(left, right);
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

function splitSurfaceSampleAtDistance(
  surface: TrackDefinition["splitSurfaces"][number],
  distance: number,
  side: -1 | 1,
): TrackDefinition["samples"][number] {
  const rowSize = 8;
  const vertices = surface.road.vertices;
  const rowCount = Math.floor(vertices.length / (rowSize * 3));

  if (rowCount <= 0) {
    throw new Error("Cannot sample an empty split surface");
  }

  const alpha = clamp((distance - surface.startDistance) / Math.max(surface.endDistance - surface.startDistance, 0.0001), 0, 1);
  const row = clamp(Math.round(alpha * (rowCount - 1)), 0, rowCount - 1);
  const previousRow = Math.max(0, row - 1);
  const nextRow = Math.min(rowCount - 1, row + 1);
  const leftColumn = side < 0 ? 0 : 4;
  const rightColumn = side < 0 ? 3 : 7;
  const left = splitSurfaceVertex(vertices, row, leftColumn, rowSize);
  const right = splitSurfaceVertex(vertices, row, rightColumn, rowSize);
  const previousCenter = splitSurfaceLaneCenter(vertices, previousRow, leftColumn, rightColumn, rowSize);
  const nextCenter = splitSurfaceLaneCenter(vertices, nextRow, leftColumn, rightColumn, rowSize);
  const center = midpoint3(left, right);
  const tangent = normalize3({
    x: nextCenter.x - previousCenter.x,
    y: nextCenter.y - previousCenter.y,
    z: nextCenter.z - previousCenter.z,
  });
  const normal = normalizeXZ({ x: right.x - left.x, z: right.z - left.z });
  const width = Math.max(0.1, Math.hypot(right.x - left.x, right.z - left.z));

  return {
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
  };
}

function splitSurfaceVertex(vertices: Float32Array, row: number, column: number, rowSize: number): { x: number; y: number; z: number } {
  const offset = (row * rowSize + column) * 3;
  return { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
}

function splitSurfaceLaneCenter(vertices: Float32Array, row: number, leftColumn: number, rightColumn: number, rowSize: number): { x: number; y: number; z: number } {
  return midpoint3(splitSurfaceVertex(vertices, row, leftColumn, rowSize), splitSurfaceVertex(vertices, row, rightColumn, rowSize));
}

function midpoint3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function normalize3(value: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function normalizeXZ(value: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(value.x, value.z) || 1;
  return { x: value.x / length, z: value.z / length };
}

function verticalObstacleCenterY(trackY: number, fullHeight: number, extension: number): number {
  const clampedExtension = Math.max(0.04, extension);
  const visibleCenter = trackY + SURFACE_CLEARANCE + fullHeight / 2;
  const hiddenCenter = trackY - fullHeight / 2 - PEG_RETRACT_DEPTH;

  return hiddenCenter + (visibleCenter - hiddenCenter) * clampedExtension;
}

function surfaceTransform(
  sample: TrackDefinition["samples"][number],
  offset: number,
  fullHeight: number,
  extension: number,
): { x: number; y: number; z: number; trackY: number } {
  const trackY = surfaceYAtOffset(sample, offset);

  return {
    x: sample.x + sample.normal.x * offset,
    y: verticalObstacleCenterY(trackY, fullHeight, extension),
    z: sample.z + sample.normal.z * offset,
    trackY,
  };
}

function isSplitWallJunctionGap(track: TrackDefinition, distance: number, side: -1 | 1): boolean {
  void side;

  return track.splitSurfaces.some(
    (surface) => distance >= surface.startDistance && distance <= surface.endDistance,
  );
}

function isWallEdgeCoveredByRoad(
  track: TrackDefinition,
  ownSamples: TrackDefinition["samples"],
  sample: TrackDefinition["samples"][number],
  next: TrackDefinition["samples"][number],
  side: -1 | 1,
  widthScale: number,
): boolean {
  const distance = (sample.distance + next.distance) / 2;
  const width = (((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2) * widthScale;
  const edgeOffset = side * (width / 2 - 0.02);
  const bank = ((sample.bank ?? 0) + (next.bank ?? 0)) / 2;
  const midpoint = {
    x: (sample.x + next.x) / 2 + ((sample.normal.x + next.normal.x) / 2) * edgeOffset,
    y: (sample.y + next.y) / 2 + Math.sin(bank) * edgeOffset,
    z: (sample.z + next.z) / 2 + ((sample.normal.z + next.normal.z) / 2) * edgeOffset,
  };

  for (const routeSamples of roadSurfaceRoutes(track)) {
    if (routeSamples === ownSamples || !isRoadSurfaceActive(track, routeSamples, distance)) {
      continue;
    }

    const roadSample = sampleAtDistance(routeSamples, distance);
    const dx = midpoint.x - roadSample.x;
    const dz = midpoint.z - roadSample.z;
    const lateral = Math.abs(dx * roadSample.normal.x + dz * roadSample.normal.z);
    const horizontal = Math.hypot(dx, dz);
    const vertical = Math.abs(midpoint.y - (roadSample.y + Math.sin(roadSample.bank ?? 0) * lateral));
    const roadHalfWidth = (roadSample.width ?? TRACK_WIDTH) / 2;

    if (lateral <= roadHalfWidth - 0.08 && horizontal <= roadHalfWidth + 0.75 && vertical <= 0.9) {
      return true;
    }
  }

  return false;
}

function roadSurfaceRoutes(track: TrackDefinition): Array<TrackDefinition["samples"]> {
  return [track.samples, ...track.branches.map((branch) => branch.samples)];
}

function isRoadSurfaceActive(
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  distance: number,
): boolean {
  if (samples === track.samples) {
    return !track.splitSurfaces.some(
      (surface) => distance > surface.startDistance && distance < surface.endDistance,
    );
  }

  return track.branches.some(
    (branch) => branch.samples === samples && distance >= branch.startDistance && distance <= branch.endDistance,
  );
}

function createMarbles(
  world: RAPIER.World,
  options: RaceBall[],
  track: TrackDefinition,
): SimBall[] {
  const ordered = shuffleTrueRandom([...options]);
  const layout = createStartLayout(ordered.length);
  const runBaseReleaseSpeed =
    START_BASE_RELEASE_SPEED_MIN +
    trueRandom() * (START_BASE_RELEASE_SPEED_MAX - START_BASE_RELEASE_SPEED_MIN);

  return ordered.map((option, index) => {
    const laneOffset = layout.laneOffsets[index] ?? 0;
    const forwardOffset = layout.forwardOffsets[index] ?? 0;
    const start = track.start;

    const lateralJitter = (trueRandom() - 0.5) * START_LATERAL_JITTER;
    const forwardJitter = (trueRandom() - 0.5) * START_FORWARD_JITTER;
    const finalLaneOffset = laneOffset + lateralJitter;
    const finalForwardOffset = forwardOffset + forwardJitter;

    const x =
      start.x +
      start.normal.x * finalLaneOffset +
      start.tangent.x * finalForwardOffset;

    const z =
      start.z +
      start.normal.z * finalLaneOffset +
      start.tangent.z * finalForwardOffset;

    const y = start.y + layout.radius + 0.05;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(BALL_LINEAR_DAMPING)
      .setAngularDamping(BALL_ANGULAR_DAMPING)
      .setAdditionalSolverIterations(8);

    const body = world.createRigidBody(bodyDesc);
    const densityScale = (DEFAULT_BALL_RADIUS / layout.radius) ** 3;

    const colliderDesc = RAPIER.ColliderDesc.ball(layout.radius)
      .setDensity(BALL_DENSITY * densityScale)
      .setFriction(BALL_FRICTION_MIN + trueRandom() * BALL_FRICTION_VARIATION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(BALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(SOLID_BALL_COLLISION_GROUPS);

    const collider = world.createCollider(colliderDesc, body);

    const releaseSpeed = runBaseReleaseSpeed + (trueRandom() - 0.5) * START_PER_BALL_RELEASE_SPEED_JITTER;
    const lateral = (trueRandom() - 0.5) * START_LATERAL_RELEASE_SPEED_JITTER;

    body.setLinvel(
      {
        x: start.tangent.x * releaseSpeed + start.normal.x * lateral,
        y: 0,
        z: start.tangent.z * releaseSpeed + start.normal.z * lateral,
      },
      true,
    );

    body.applyTorqueImpulse(
      {
        x: (trueRandom() - 0.5) * START_TORQUE_JITTER_XZ,
        y: (trueRandom() - 0.5) * START_TORQUE_JITTER_Y,
        z: (trueRandom() - 0.5) * START_TORQUE_JITTER_XZ,
      },
      true,
    );

    return {
      id: option.id,
      optionId: option.optionId,
      body,
      collider,
      radius: layout.radius,
    };
  });
}

function getNewFinishers(
  balls: SimBall[],
  finishedIds: Set<string>,
  disqualifiedIds: Set<string>,
  track: TrackDefinition,
  frameStateByBall: Map<string, BallFrameState>,
): Array<{ id: string; optionId: string; body: RAPIER.RigidBody; position: { x: number; y: number; z: number }; z: number; progressCredible: boolean }> {
  return balls
    .filter((ball) => !disqualifiedIds.has(ball.id))
    .map((ball) => {
      const position = ball.body.translation();
      const frameState = frameStateByBall.get(ball.id);
      const progress = frameState?.displayProgress ?? progressForPosition(track, position);

      return {
        id: ball.id,
        optionId: ball.optionId,
        body: ball.body,
        position,
        z: progress,
        progressCredible: frameState?.isRaceProgressCredible ?? true,
      };
    })
    .filter((ball) =>
      ball.progressCredible &&
      ball.z >= track.finishDistance &&
      !finishedIds.has(ball.id) &&
      isValidFinishCrossing(track, ball.position, ball.z),
    )
    .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
}

function updatePlacements(
  balls: SimBall[],
  finishedIds: Set<string>,
  disqualifiedIds: Set<string>,
  track: TrackDefinition,
  frameStateByBall: Map<string, BallFrameState>,
  placements: FinishPlacement[],
  time: number,
): void {
  appendPlacements(
    getNewFinishers(balls, finishedIds, disqualifiedIds, track, frameStateByBall),
    finishedIds,
    placements,
    time,
  );
}

function appendPlacements(
  finishers: Array<{ id: string; optionId: string }>,
  finishedIds: Set<string>,
  placements: FinishPlacement[],
  time?: number,
): void {
  for (const finisher of finishers) {
    finishedIds.add(finisher.id);

    placements.push({
      id: finisher.optionId,
      optionId: finisher.optionId,
      ballId: finisher.id,
      place: placements.length + 1,
      time: time ?? placements.length * FIXED_TIMESTEP,
    });
  }
}

function createCatchContainer(world: RAPIER.World, track: TrackDefinition): void {
  const center = track.catchCenter;
  const width = TRACK_WIDTH + 14;
  const length = 22;
  const wallHeight = 2.8;

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, 0.16, length / 2)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(CATCH_FLOOR_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.01)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(TRACK_COLLISION_GROUPS),
  );

  for (const side of [-1, 1]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.22, wallHeight / 2, length / 2)
        .setTranslation(center.x + side * width / 2, center.y + wallHeight / 2, center.z)
        .setFriction(CATCH_WALL_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(0.01)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(TRACK_COLLISION_GROUPS),
    );
  }

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, wallHeight / 2, 0.22)
      .setTranslation(center.x, center.y + wallHeight / 2, center.z + length / 2)
      .setFriction(CATCH_WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.01)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(TRACK_COLLISION_GROUPS),
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, 0.28, 0.16)
      .setTranslation(center.x, center.y + 0.28, center.z - length / 2)
      .setFriction(CATCH_WALL_FRICTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.01)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(TRACK_COLLISION_GROUPS),
  );
}

function updateTerminalStillness(
  balls: SimBall[],
  finishedIds: Set<string>,
  disqualifiedIds: Set<string>,
  terminalStillSecondsByBall: Map<string, number>,
  track: TrackDefinition,
  deltaSeconds: number,
): boolean {
  for (const ball of balls) {
    if (isBallTerminal(ball, finishedIds, disqualifiedIds, track)) {
      terminalStillSecondsByBall.set(ball.id, (terminalStillSecondsByBall.get(ball.id) ?? 0) + deltaSeconds);
    } else {
      terminalStillSecondsByBall.set(ball.id, 0);
    }
  }

  return balls.every((ball) => (terminalStillSecondsByBall.get(ball.id) ?? 0) >= TERMINAL_STILL_SECONDS);
}

function updateRemainingStuckState(
  balls: SimBall[],
  finishedIds: Set<string>,
  disqualifiedIds: Set<string>,
  frameStateByBall: Map<string, BallFrameState>,
  lastMovingProgressByBall: Map<string, number>,
  noProgressSecondsByBall: Map<string, number>,
  deltaSeconds: number,
): boolean {
  const remaining = balls.filter((ball) => !finishedIds.has(ball.id) && !disqualifiedIds.has(ball.id));

  if (remaining.length === 0) {
    return false;
  }

  for (const ball of remaining) {
    const progress = frameStateByBall.get(ball.id)?.displayProgress ?? 0;
    const lastProgress = lastMovingProgressByBall.get(ball.id);

    if (lastProgress === undefined || Math.abs(progress - lastProgress) >= STUCK_PROGRESS_EPSILON) {
      lastMovingProgressByBall.set(ball.id, progress);
      noProgressSecondsByBall.set(ball.id, 0);
      continue;
    }

    noProgressSecondsByBall.set(ball.id, (noProgressSecondsByBall.get(ball.id) ?? 0) + deltaSeconds);
  }

  for (const ball of balls) {
    if (finishedIds.has(ball.id) || disqualifiedIds.has(ball.id)) {
      lastMovingProgressByBall.delete(ball.id);
      noProgressSecondsByBall.delete(ball.id);
    }
  }

  return remaining.every((ball) => (noProgressSecondsByBall.get(ball.id) ?? 0) >= STUCK_NO_PROGRESS_SECONDS);
}

function isBallTerminal(
  ball: SimBall,
  finishedIds: Set<string>,
  disqualifiedIds: Set<string>,
  track: TrackDefinition,
): boolean {
  if (disqualifiedIds.has(ball.id)) {
    return true;
  }

  if (!finishedIds.has(ball.id)) {
    return false;
  }

  const position = ball.body.translation();
  const velocity = ball.body.linvel();
  const spin = ball.body.angvel();
  const linearSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const angularSpeed = Math.hypot(spin.x, spin.y, spin.z);
  const progress = progressForPosition(track, position);

  return progress >= track.finishDistance && linearSpeed < STOP_SPEED && angularSpeed < STOP_ANGULAR_SPEED;
}

function trueRandom(): number {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi) {
    const bytes = new Uint32Array(1);
    cryptoApi.getRandomValues(bytes);
    return bytes[0] / 4294967296;
  }

  return Math.random();
}

function shuffleTrueRandom<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(trueRandom() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function gateExtensionAtTime(time: number, phase: number): number {
  const t = obstacleCycleValue(time, phase, GATE_MOTION_PERIOD);

  if (t < 5) {
    return 1;
  }

  if (t < 7) {
    return 1 - smoothstep(0, 1, (t - 5) / 2);
  }

  if (t < 17) {
    return 0;
  }

  return smoothstep(0, 1, (t - 17) / 3);
}

function trackRotation(yaw: number, pitch: number, bank = 0): RAPIER.Quaternion {
  return multiplyQuat(
    multiplyQuat(quatFromAxisAngle("y", yaw), quatFromAxisAngle("x", pitch)),
    quatFromAxisAngle("z", -bank),
  );
}

function yawRotation(yaw: number): RAPIER.Quaternion {
  return quatFromAxisAngle("y", yaw);
}

function multiplyQuat(a: RAPIER.Quaternion, b: RAPIER.Quaternion): RAPIER.Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatFromAxisAngle(axis: "x" | "y" | "z", angle: number): RAPIER.Quaternion {
  const half = angle / 2;
  const sin = Math.sin(half);

  return {
    x: axis === "x" ? sin : 0,
    y: axis === "y" ? sin : 0,
    z: axis === "z" ? sin : 0,
    w: Math.cos(half),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * (3 - 2 * t);
}

function interactionGroups(memberships: number, filters: number): number {
  return ((memberships & 0xffff) << 16) | (filters & 0xffff);
}


