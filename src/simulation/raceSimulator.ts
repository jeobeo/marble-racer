import RAPIER from "@dimforge/rapier3d";
import { createSeededRng } from "./rng";
import { recordFrame, type SimBall } from "./raceRecorder";
import type { FinishPlacement, PickerOption, RaceConfig, RaceResult } from "./types";
import { DEFAULT_BALL_RADIUS, createStartLayout } from "../shared/marbleLayout";
import {
  FINISH_DISTANCE,
  TRACK_WIDTH,
  type TrackDefinition,
  type TrackMeshData,
  generateTrack,
  progressForPosition,
  sampleAtDistance,
} from "../shared/trackGenerator";

const FIXED_TIMESTEP = 1 / 60;
const PHYSICS_SUBSTEPS = 3;
const MAX_STEPS = 60 * 135;
const RECORD_EVERY_STEPS = 1;
const STOP_SPEED = 0.1;
const STOP_STILL_STEPS = 60 * 1.6;

export type SimulationRuntime = {
  signal?: AbortSignal;
  yieldEverySteps?: number;
  onProgress?: (elapsedSeconds: number) => void;
};

export async function prepareRapier(): Promise<void> {
  await Promise.resolve();
}

export async function simulateRace(config: RaceConfig, runtime: SimulationRuntime = {}): Promise<RaceResult> {
  const rng = createSeededRng(`${config.seed}:sim`);
  const track = generateTrack(config.seed);
  const world = new RAPIER.World({ x: 0, y: -13.0, z: 0 });
  world.timestep = FIXED_TIMESTEP / PHYSICS_SUBSTEPS;
  world.numSolverIterations = 10;
  world.integrationParameters.numInternalPgsIterations = 2;
  world.integrationParameters.normalizedAllowedLinearError = 0.0004;

  createTrack(world, track);
  const balls = createMarbles(world, config.options, rng, track);
  const frames = [];
  const shouldRecord = config.recordFrames !== false;
  let actualWinnerId = "";
  const placements: FinishPlacement[] = [];
  const finishedIds = new Set<string>();
  let stillSteps = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      throwIfAborted(runtime.signal);

      for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
        world.step();
      }

      if (shouldRecord && step % RECORD_EVERY_STEPS === 0) {
        frames.push(recordFrame(balls, step * FIXED_TIMESTEP));
      }

      const newFinishers = getNewFinishers(balls, finishedIds, track);
      for (const finisher of newFinishers) {
        finishedIds.add(finisher.id);
        placements.push({
          id: finisher.id,
          place: placements.length + 1,
          time: (step + 1) * FIXED_TIMESTEP,
        });

        // Do not alter velocity at the finish; marbles should carry their momentum
        // into the runout and catch container naturally.
      }

      if (!actualWinnerId && placements.length > 0) {
        actualWinnerId = placements[0].id;
      }

      if (placements.length === balls.length && allBallsStopped(balls, track)) {
        stillSteps += 1;
      } else {
        stillSteps = 0;
      }

      if (stillSteps >= STOP_STILL_STEPS) {
        if (shouldRecord) {
          frames.push(recordFrame(balls, (step + 1) * FIXED_TIMESTEP));
        }
        break;
      }

      if (runtime.yieldEverySteps && step > 0 && step % runtime.yieldEverySteps === 0) {
        runtime.onProgress?.((step + 1) * FIXED_TIMESTEP);
        await yieldToBrowser();
        throwIfAborted(runtime.signal);
      }
    }
  } finally {
    world.free();
  }

  return {
    seed: config.seed,
    intendedWinnerId: config.intendedWinnerId,
    actualWinnerId,
    placements,
    track,
    frames,
    attempt: config.attempt,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Simulation cancelled.", "AbortError");
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function createTrack(world: RAPIER.World, track: TrackDefinition): void {
  createRoadCollider(world, track.road);
  createSegmentedWalls(world, track, track.samples, 1);
  for (const branch of track.branches) {
    createRoadCollider(world, branch.road);
    createSegmentedWalls(world, track, branch.samples, 0.82);
  }
  createFeatureColliders(world, track);
  createCatchContainer(world, track);
}

function createRoadCollider(world: RAPIER.World, mesh: TrackMeshData): void {
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.16)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
  );
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
      if (isBarrierGap(track, sample.distance, side)) {
        continue;
      }

      const normal = sample.normal;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.14, 0.58, length / 2 + 0.2)
          .setTranslation(
            (sample.x + next.x) / 2 + normal.x * side * (width / 2 + 0.08),
            (sample.y + next.y) / 2 + 0.45,
            (sample.z + next.z) / 2 + normal.z * side * (width / 2 + 0.08),
          )
          .setRotation(trackRotation(yaw, pitch))
          .setFriction(0.08)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
          .setRestitution(0.288)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
      );
    }
  }
}

function createFeatureColliders(world: RAPIER.World, track: TrackDefinition): void {
  for (const peg of track.features.pegs) {
    const sample = sampleAtDistance(track.samples, peg.distance);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(peg.offset, -maxOffset, maxOffset);
    const transform = featureTransform(sample, offset, 0.28);
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.28, peg.radius)
        .setTranslation(transform.x, transform.y, transform.z)
        .setFriction(0.06)
        .setRestitution(0.192)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
    );
  }
}

function featureTransform(sample: TrackDefinition["samples"][number], offset: number, yOffset: number): { x: number; y: number; z: number } {
  return {
    x: sample.x + sample.normal.x * offset,
    y: sample.y + Math.sin(sample.bank ?? 0) * offset + yOffset,
    z: sample.z + sample.normal.z * offset,
  };
}

function isBarrierGap(track: TrackDefinition, distance: number, side: -1 | 1): boolean {
  return track.branches.some(
    (branch) =>
      branch.side === side &&
      (Math.abs(distance - branch.startDistance) < 3.5 || Math.abs(distance - branch.endDistance) < 3.5),
  );
}

function createMarbles(
  world: RAPIER.World,
  options: PickerOption[],
  rng: () => number,
  track: TrackDefinition,
): SimBall[] {
  const ordered = shuffle([...options].sort((a, b) => a.id.localeCompare(b.id)), rng);
  const layout = createStartLayout(ordered.length);

  return ordered.map((option, index) => {
    const laneOffset = layout.laneOffsets[index] ?? 0;
    const start = track.start;
    const x = start.x + start.normal.x * laneOffset;
    const z = start.z + start.normal.z * laneOffset;
    const y = start.y + layout.radius + 0.05;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setCanSleep(false)
      .setLinearDamping(0.006 + rng() * 0.008)
      .setAngularDamping(0.02)
      .setAdditionalSolverIterations(8);
    const body = world.createRigidBody(bodyDesc);
    const densityScale = (DEFAULT_BALL_RADIUS / layout.radius) ** 3;
    const collider = RAPIER.ColliderDesc.ball(layout.radius)
      .setDensity(4.0 * densityScale)
      .setFriction(0.08 + rng() * 0.02)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitution(0.12)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average);

    world.createCollider(collider, body);

    const releaseSpeed = 0.82 + rng() * 0.4;
    const lateral = (rng() - 0.5) * 0.08;
    body.setLinvel(
      {
        x: start.tangent.x * releaseSpeed + start.normal.x * lateral,
        y: 0,
        z: start.tangent.z * releaseSpeed + start.normal.z * lateral,
      },
      true,
    );
    body.applyTorqueImpulse({ x: (rng() - 0.5) * 0.006, y: (rng() - 0.5) * 0.004, z: (rng() - 0.5) * 0.006 }, true);

    return { id: option.id, body };
  });
}

function getNewFinishers(
  balls: SimBall[],
  finishedIds: Set<string>,
  track: TrackDefinition,
): Array<{ id: string; body: RAPIER.RigidBody; z: number }> {
  return balls
    .map((ball) => ({ id: ball.id, body: ball.body, z: progressForPosition(track, ball.body.translation()) }))
    .filter((ball) => ball.z >= FINISH_DISTANCE && !finishedIds.has(ball.id))
    .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
}

function createCatchContainer(world: RAPIER.World, track: TrackDefinition): void {
  const center = track.catchCenter;
  const width = TRACK_WIDTH + 14;
  const length = 18;
  const wallHeight = 2.8;

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, 0.16, length / 2)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(0.95)
      .setRestitution(0.01),
  );

  for (const side of [-1, 1]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.22, wallHeight / 2, length / 2)
        .setTranslation(center.x + side * width / 2, center.y + wallHeight / 2, center.z)
        .setFriction(0.8)
        .setRestitution(0.01),
    );
  }

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, wallHeight / 2, 0.22)
      .setTranslation(center.x, center.y + wallHeight / 2, center.z + length / 2)
      .setFriction(0.8)
      .setRestitution(0.01),
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, 0.28, 0.16)
      .setTranslation(center.x, center.y + 0.28, center.z - length / 2)
      .setFriction(0.8)
      .setRestitution(0.01),
  );
}

function allBallsStopped(balls: SimBall[], track: TrackDefinition): boolean {
  return balls.every((ball) => {
    const position = ball.body.translation();
    const velocity = ball.body.linvel();
    const spin = ball.body.angvel();
    const linearSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const angularSpeed = Math.hypot(spin.x, spin.y, spin.z);
    const progress = progressForPosition(track, position);
    return (progress > FINISH_DISTANCE && linearSpeed < STOP_SPEED && angularSpeed < STOP_SPEED * 2.5) || position.y < -25;
  });
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function trackRotation(yaw: number, pitch: number): RAPIER.Quaternion {
  return multiplyQuat(quatFromAxisAngle("y", yaw), quatFromAxisAngle("x", pitch));
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
