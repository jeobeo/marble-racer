import RAPIER from "@dimforge/rapier3d";
import { recordFrame, type BallFrameState, type SimBall } from "./raceRecorder";
import type { FinishPlacement, RaceBall, RaceConfig, RaceDisqualification, RaceFrame, RaceResult } from "./types";
import type { PowerupKind } from "../shared/trackGenerator";
import { DEFAULT_BALL_RADIUS, createStartLayout } from "../shared/marbleLayout";
import {
  TRACK_WIDTH,
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
const AIRBORNE_DISPLAY_MAX_PROGRESS_ADVANCE_PER_STEP = 1.35;
const AIRBORNE_DISPLAY_MAX_PROGRESS_BACKTRACK_PER_STEP = 3.5;

const GRAVITY_Y = -11.5;

const ROAD_FRICTION = 0.36;
const ROAD_RESTITUTION = 0.015;

const SAFETY_SLAB_FRICTION = 0.36;
const SAFETY_SLAB_RESTITUTION = 0.015;

const WALL_FRICTION = 0.34;
const WALL_RESTITUTION = 0.08;

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

      accumulator += Math.min(deltaSeconds, 0.08);
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
  createRoadCollider(world, track.road);
  createRoadSafetySlabs(world, track.samples);
  createSegmentedWalls(world, track, track.samples, 1);

  for (const branch of track.branches) {
    createRoadCollider(world, branch.road);
    createSegmentedWalls(world, track, branch.samples, 0.82);
  }

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

function createRoadSafetySlabs(world: RAPIER.World, samples: TrackDefinition["samples"]): void {
  const step = 3;

  for (let index = 0; index < samples.length - step; index += step) {
    const sample = samples[index];
    const next = samples[index + step];
    const width = ((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2;
    const length = Math.hypot(next.x - sample.x, next.y - sample.y, next.z - sample.z);
    const yaw = Math.atan2(next.x - sample.x, next.z - sample.z);
    const pitch = Math.atan2(sample.y - next.y, Math.hypot(next.x - sample.x, next.z - sample.z));

    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, 0.16, length / 2 + 0.22)
        .setTranslation(
          (sample.x + next.x) / 2,
          (sample.y + next.y) / 2 - 0.12,
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

function createSegmentedWalls(
  world: RAPIER.World,
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  widthScale: number,
): void {
  const step = 2;

  for (let index = 0; index < samples.length - step; index += step) {
    const sample = samples[index];
    const next = samples[index + step];
    const width = (((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2) * widthScale;
    const length = Math.hypot(next.x - sample.x, next.y - sample.y, next.z - sample.z);
    const yaw = Math.atan2(next.x - sample.x, next.z - sample.z);
    const pitch = Math.atan2(sample.y - next.y, Math.hypot(next.x - sample.x, next.z - sample.z));

    for (const side of [-1, 1] as const) {
      if (isBranchBarrierGap(track, sample.distance, side)) {
        continue;
      }

      const normal = sample.normal;

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.24, 0.82, length / 2 + 0.32)
          .setTranslation(
            (sample.x + next.x) / 2 + normal.x * side * (width / 2 + 0.01),
            (sample.y + next.y) / 2 + 0.48,
            (sample.z + next.z) / 2 + normal.z * side * (width / 2 + 0.01),
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

function createFeatureColliders(world: RAPIER.World, track: TrackDefinition): Array<MovingVerticalObstacle | DynamicBody> {
  const dynamicBodies: Array<MovingVerticalObstacle | DynamicBody> = [];

  for (const [index, peg] of track.features.pegs.entries()) {
    const sample = sampleAtDistance(track.samples, peg.distance);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(peg.offset, -maxOffset, maxOffset);
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
    const sample = sampleAtDistance(track.samples, bumper.distance);
    const phase = greenBumperRuntimePhase(bumper, index);
    const transform = surfaceTransform(sample, bumper.offset, BUMPER_HEIGHT, pegExtensionAtTime(0, phase));

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
    const sample = sampleAtDistance(track.samples, gate.distance);
    const transform = surfaceTransform(sample, 0, GATE_HEIGHT, 1);
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
    const sample = sampleAtDistance(track.samples, trapper.distance);
    const transform = surfaceTransform(sample, 0, TRAPPER_HEIGHT, 1);
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
    const sample = sampleAtDistance(track.samples, spinner.distance);
    const transform = surfaceTransform(sample, 0, SPINNER_HEIGHT, 1);
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
    const sample = sampleAtDistance(track.samples, hammer.distance);
    const transform = surfaceTransform(sample, 0, HAMMER_HEIGHT, 1);
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
    const sample = sampleAtDistance(track.samples, turnstile.distance);
    const transform = surfaceTransform(sample, 0, TURNSTILE_HEIGHT, 1);
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

    const isRaceProgressCredible =
      hasContact ||
      isPlausibleAirborneRacePosition(
        track,
        position,
        physicalProgress,
        trackStatus,
        previousDisplayProgress,
      );

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
  for (const powerup of track.features.powerups) {
    if ((hiddenPowerupsUntil.get(powerup.id) ?? 0) > time) {
      continue;
    }

    const sample = sampleAtDistance(track.samples, powerup.distance);
    const powerupPosition = {
      x: sample.x + sample.normal.x * powerup.offset,
      y: surfaceYAtOffset(sample, powerup.offset) + 0.46,
      z: sample.z + sample.normal.z * powerup.offset,
    };
    const collector = balls.find((ball) => {
      const position = ball.body.translation();
      return Math.hypot(position.x - powerupPosition.x, position.y - powerupPosition.y, position.z - powerupPosition.z) < POWERUP_PICKUP_RADIUS + ball.radius;
    });

    if (!collector) {
      continue;
    }

    hiddenPowerupsUntil.set(powerup.id, time + POWERUP_RESPAWN_SECONDS);
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

    if (hasContact) {
      noContactSecondsByBall.set(ball.id, 0);
      if (frameState?.isRaceProgressCredible) {
        safeStateByBall.set(ball.id, safeStateForProgress(track, frameState.displayProgress, ball.radius));
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

  const fallbackProgress = progressForPosition(track, ball.body.translation());
  pendingRespawnsByBall.set(ball.id, {
    respawnAt: time + FALL_RESPAWN_DELAY_SECONDS,
    safeState: safeStateByBall.get(ball.id) ?? safeStateForProgress(track, fallbackProgress, ball.radius),
  });
}

function safeStateForProgress(track: TrackDefinition, progress: number, radius: number): SafeBallState {
  const sample = sampleAtDistance(track.samples, clamp(progress - 1.2, 0, track.finishDistance));

  return {
    progress: sample.distance,
    position: {
      x: sample.x,
      y: surfaceYAtOffset(sample, 0) + radius + 0.14,
      z: sample.z,
    },
  };
}

function respawnBallAtSafeState(
  ball: SimBall,
  safeState: SafeBallState,
  track: TrackDefinition,
): void {
  const sample = sampleAtDistance(track.samples, safeState.progress);
  ball.body.setTranslation(safeState.position, true);
  ball.body.setRotation(trackRotation(sample.yaw, 0, 0), true);
  ball.body.setLinvel({ x: sample.tangent.x * 0.55, y: 0, z: sample.tangent.z * 0.55 }, true);
  ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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

function isBranchBarrierGap(track: TrackDefinition, distance: number, side: -1 | 1): boolean {
  return track.branches.some(
    (branch) =>
      branch.side === side &&
      (Math.abs(distance - branch.startDistance) < 3.5 || Math.abs(distance - branch.endDistance) < 3.5),
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
): Array<{ id: string; optionId: string; body: RAPIER.RigidBody; z: number }> {
  return balls
    .filter((ball) => !disqualifiedIds.has(ball.id))
    .map((ball) => {
      const position = ball.body.translation();
      const progress = frameStateByBall.get(ball.id)?.physicalProgress ?? progressForPosition(track, position);

      return {
        id: ball.id,
        optionId: ball.optionId,
        body: ball.body,
        position,
        z: progress,
      };
    })
    .filter((ball) =>
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
