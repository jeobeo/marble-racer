import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Vector3,
} from "three";
import { createStartLayout } from "../shared/marbleLayout";
import {
  TRACK_WIDTH,
  type TrackDefinition,
  type TrackMeshData,
  generateTrack,
  obstacleCycleValue,
  sampleAtDistance,
} from "../shared/trackGenerator";

export const PREVIEW_TRACK_SEED = "preview-track";

const ROAD_THICKNESS = 2.75;
const ROAD_SURFACE_OFFSET = 0.02;
const WALL_THICKNESS = 0.52;
const WALL_EXTENSION_BELOW = 2.85;
const WALL_HEIGHT_ABOVE = 1.18;

const PEG_HEIGHT = 0.56;
const BUMPER_HEIGHT = 0.62;
const GATE_HEIGHT = 0.56;
const TRAPPER_HEIGHT = 0.74;
const SPINNER_HEIGHT = 0.24;
const SPINNER_TRACK_LIFT = 0.18;
const HAMMER_HEIGHT = 0.48;
const TURNSTILE_HEIGHT = 0.24;
const TURNSTILE_TRACK_LIFT = 0.2;

const SURFACE_CLEARANCE = 0.012;
const PEG_RETRACT_DEPTH = 0.38;
const PEG_MOTION_PERIOD = 8;
const PEG_HOLD_UP_SECONDS = 2;
const PEG_LOWER_SECONDS = 2;
const PEG_HOLD_DOWN_SECONDS = 2;
const PEG_RAISE_SECONDS = 2;

type DynamicVerticalObstacleRenderData = {
  trackY: number;
  phase: number;
  fullHeight: number;
};

type DynamicGateRenderData = {
  closedY: number;
  phase: number;
  period?: number;
  trapper?: boolean;
};

type DynamicSpinnerRenderData = {
  yaw: number;
  phase: number;
  speed: number;
};

type DynamicHammerRenderData = {
  yaw: number;
  phase: number;
  side: number;
};

export function createTrackMeshes(track: TrackDefinition): Group {
  const group = new Group();
  const roadMaterial = new MeshStandardMaterial({
    color: 0x24282d,
    roughness: 0.58,
    metalness: 0.05,
    side: DoubleSide,
  });
  const sideMaterial = new MeshStandardMaterial({
    color: 0x242f3a,
    roughness: 0.65,
    side: DoubleSide,
  });

  const road = new Mesh(toGeometry(createThickRibbon(track.samples, ROAD_THICKNESS)), roadMaterial);
  road.receiveShadow = true;
  group.add(road);

  for (const branch of track.branches) {
    const branchRoad = new Mesh(toGeometry(createThickRibbon(branch.samples, ROAD_THICKNESS)), roadMaterial);
    branchRoad.receiveShadow = true;
    group.add(branchRoad);
  }

  for (const side of [-1, 1] as const) {
    const wall = new Mesh(toGeometry(createThickWall(track.samples, side, 1, track)), sideMaterial);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  for (const branch of track.branches) {
    for (const side of [-1, 1] as const) {
      const wall = new Mesh(toGeometry(createThickWall(branch.samples, side, 0.82, track)), sideMaterial);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }
  }

  addFeatureMeshes(group, track);
  addFinishLine(group, track);
  addCatchContainer(group, track);

  return group;
}

export function updateDynamicTrackMeshes(group: Group, time: number): void {
  group.traverse((object) => {
    const peg = object.userData.dynamicPeg as DynamicVerticalObstacleRenderData | undefined;
    if (peg) {
      const extension = pegExtensionAtTime(time, peg.phase);
      object.scale.y = Math.max(0.04, extension);
      object.position.y = verticalObstacleCenterY(peg.trackY, peg.fullHeight, object.scale.y);
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const greenBumper = object.userData.dynamicGreenBumper as DynamicVerticalObstacleRenderData | undefined;
    if (greenBumper) {
      const extension = pegExtensionAtTime(time, greenBumper.phase);
      object.scale.y = Math.max(0.04, extension);
      object.position.y = verticalObstacleCenterY(greenBumper.trackY, greenBumper.fullHeight, object.scale.y);
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const gate = object.userData.dynamicGate as DynamicGateRenderData | undefined;
    if (gate) {
      const extension = gate.trapper ? trapperExtensionAtTime(time, gate.phase) : gateExtensionAtTime(time, gate.phase);
      object.scale.y = Math.max(0.035, extension);
      object.position.y = gate.closedY - (1 - extension) * (gate.trapper ? 1.24 : 0.92);
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const spinner = object.userData.dynamicSpinner as DynamicSpinnerRenderData | undefined;
    if (spinner) {
      object.rotation.y = spinner.yaw + spinner.phase + time * spinner.speed;
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const hammer = object.userData.dynamicHammer as DynamicHammerRenderData | undefined;
    if (hammer) {
      object.rotation.y = hammer.yaw + Math.sin(time * 0.75 + hammer.phase) * 1.15 * hammer.side;
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    if (object.userData.powerupId) {
      object.rotation.y += 0.035;
      object.rotation.x += 0.022;
      object.position.y += Math.sin(time * 4 + object.position.x) * 0.0015;
    }
  });
}

export function setCollectedPowerupsVisible(group: Group, collectedIds: string[]): void {
  const collected = new Set(collectedIds);

  group.traverse((object) => {
    const id = object.userData.powerupId as string | undefined;
    if (id) {
      object.visible = !collected.has(id);
    }
  });
}

export function setDestroyedObstaclesVisible(group: Group, destroyedIds: string[]): void {
  const destroyed = new Set(destroyedIds);

  group.traverse((object) => {
    const id = object.userData.obstacleId as string | undefined;
    if (id) {
      object.visible = !destroyed.has(id);
    }
  });
}

export function startCameraFrame(track: TrackDefinition): { position: Vector3; target: Vector3 } {
  const start = track.start;
  const bounds = track.samples.reduce(
    (current, sample) => ({
      minX: Math.min(current.minX, sample.x),
      maxX: Math.max(current.maxX, sample.x),
      minY: Math.min(current.minY, sample.y),
      maxY: Math.max(current.maxY, sample.y),
      minZ: Math.min(current.minZ, sample.z),
      maxZ: Math.max(current.maxZ, sample.z),
    }),
    {
      minX: start.x,
      maxX: start.x,
      minY: start.y,
      maxY: start.y,
      minZ: start.z,
      maxZ: start.z,
    },
  );

  const horizontalSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, TRACK_WIDTH * 6);
  const height = clamp(horizontalSpan * 0.34, 22, 92);
  const pullBack = clamp(horizontalSpan * 0.22, 16, 68);
  const sideOffset = clamp(horizontalSpan * 0.08, 4, 18);

  const target = new Vector3(start.x, start.y + 0.8, start.z);

  const position = new Vector3(
    start.x - start.tangent.x * pullBack + start.normal.x * sideOffset,
    start.y + height,
    start.z - start.tangent.z * pullBack + start.normal.z * sideOffset,
  );

  return { position, target };
}

export function startingMarblePosition(index: number, total: number, track = generateTrack(PREVIEW_TRACK_SEED)): Vector3 {
  const layout = createStartLayout(total);
  const laneOffset = layout.laneOffsets[index] ?? 0;
  const forwardOffset = layout.forwardOffsets[index] ?? 0;
  const start = track.start;

  return new Vector3(
    start.x + start.normal.x * laneOffset + start.tangent.x * forwardOffset,
    start.y + layout.radius + 0.08,
    start.z + start.normal.z * laneOffset + start.tangent.z * forwardOffset,
  );
}
function addFinishLine(group: Group, track: TrackDefinition): void {
  const black = new MeshStandardMaterial({ color: 0x07090c, roughness: 0.36 });
  const white = new MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.32 });
  const tileCount = 12;
  const finishWidth = track.finish.width ?? TRACK_WIDTH;
  const tileWidth = (finishWidth - 0.55) / tileCount;

  for (let index = 0; index < tileCount; index += 1) {
    const offset = -((finishWidth - 0.55) / 2) + tileWidth * (index + 0.5);
    const tile = new Mesh(new BoxGeometry(tileWidth * 0.95, 0.035, 0.2), index % 2 === 0 ? white : black);

    setTrackTransform(
      tile,
      track.finish.x + track.finish.normal.x * offset,
      surfaceYAtOffset(track.finish, offset) + 0.035 / 2 + SURFACE_CLEARANCE,
      track.finish.z + track.finish.normal.z * offset,
      track.finish.yaw,
      track.finish.bank,
    );

    group.add(tile);
  }

}

function addCatchContainer(group: Group, track: TrackDefinition): void {
  const width = TRACK_WIDTH + 14;
  const length = 22;
  const wallHeight = 2.8;
  const trayMaterial = new MeshStandardMaterial({ color: 0x171d24, roughness: 0.72, metalness: 0.04 });
  const wallMaterial = new MeshStandardMaterial({ color: 0x303a44, roughness: 0.62, metalness: 0.05 });
  const center = track.catchCenter;

  const floor = new Mesh(new BoxGeometry(width, 0.32, length), trayMaterial);
  floor.position.set(center.x, center.y, center.z);
  floor.receiveShadow = true;
  group.add(floor);

  for (const side of [-1, 1]) {
    const sideWall = new Mesh(new BoxGeometry(0.44, wallHeight, length), wallMaterial);
    sideWall.position.set(center.x + side * width / 2, center.y + wallHeight / 2, center.z);
    sideWall.castShadow = true;
    sideWall.receiveShadow = true;
    group.add(sideWall);
  }

  const backWall = new Mesh(new BoxGeometry(width, wallHeight, 0.44), wallMaterial);
  backWall.position.set(center.x, center.y + wallHeight / 2, center.z + length / 2);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  group.add(backWall);

  const entryLip = new Mesh(new BoxGeometry(width, 0.56, 0.32), wallMaterial);
  entryLip.position.set(center.x, center.y + 0.28, center.z - length / 2);
  entryLip.castShadow = true;
  entryLip.receiveShadow = true;
  group.add(entryLip);
}

function addFeatureMeshes(group: Group, track: TrackDefinition): void {
  const pegMaterial = new MeshStandardMaterial({ color: 0xd7463f, roughness: 0.5 });
  const bumperMaterial = new MeshStandardMaterial({ color: 0x36c96d, roughness: 0.38, metalness: 0.05 });
  const gateMaterial = new MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.5 });
  const trapperMaterial = new MeshStandardMaterial({ color: 0xff6f3c, roughness: 0.45, metalness: 0.04 });
  const spinnerMaterial = new MeshStandardMaterial({ color: 0xf2b84b, roughness: 0.42 });
  const hammerMaterial = new MeshStandardMaterial({ color: 0xa35df2, roughness: 0.45 });
  const powerupGeometry = new OctahedronGeometry(0.38, 0);

  for (const [index, peg] of track.features.pegs.entries()) {
    const sample = sampleAtDistance(track.samples, peg.distance);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(peg.offset, -maxOffset, maxOffset);
    const extension = pegExtensionAtTime(0, peg.phase);
    const mesh = new Mesh(new CylinderGeometry(peg.radius, peg.radius, PEG_HEIGHT, 18), pegMaterial);
    const trackY = setUprightObstacleTransform(mesh, sample, offset, PEG_HEIGHT, extension, 0);

    mesh.scale.y = Math.max(0.04, extension);
    mesh.userData.dynamicPeg = { trackY, phase: peg.phase, fullHeight: PEG_HEIGHT } satisfies DynamicVerticalObstacleRenderData;
    mesh.userData.obstacleId = `peg-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, bumper] of track.features.greenBumpers.entries()) {
    const sample = sampleAtDistance(track.samples, bumper.distance);
    const runtimePhase = (bumper as typeof bumper & { phase?: number }).phase;
    const phase = runtimePhase ?? greenBumperPhase(index, bumper.distance);
    const extension = pegExtensionAtTime(0, phase);
    const mesh = new Mesh(new CylinderGeometry(bumper.radius, bumper.radius, BUMPER_HEIGHT, 24), bumperMaterial);
    const trackY = setUprightObstacleTransform(mesh, sample, bumper.offset, BUMPER_HEIGHT, extension, 0);

    mesh.scale.y = Math.max(0.04, extension);
    mesh.userData.dynamicGreenBumper = { trackY, phase, fullHeight: BUMPER_HEIGHT } satisfies DynamicVerticalObstacleRenderData;
    mesh.userData.obstacleId = `green-bumper-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, gate] of track.features.gates.entries()) {
    const sample = sampleAtDistance(track.samples, gate.distance);
    const width = sample.width ?? TRACK_WIDTH;
    const mesh = new Mesh(new BoxGeometry(width + 0.24, GATE_HEIGHT, 0.32), gateMaterial);
    const trackY = setUprightObstacleTransform(mesh, sample, 0, GATE_HEIGHT, 1, 0);

    mesh.userData.dynamicGate = {
      closedY: trackY + SURFACE_CLEARANCE + GATE_HEIGHT / 2,
      phase: gate.phase,
    } satisfies DynamicGateRenderData;
    mesh.userData.obstacleId = `gate-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [trapperIndex, trapper] of track.features.trappers.entries()) {
    const sample = sampleAtDistance(track.samples, trapper.distance);
    const ring = new Group();
    const segmentCount = 10;
    const ringRadius = Math.min(trapper.radius, Math.max(0.65, (sample.width ?? TRACK_WIDTH) / 2 - 0.55));

    for (let index = 0; index < segmentCount; index += 1) {
      const angle = (index / segmentCount) * Math.PI * 2;
      const segment = new Mesh(new BoxGeometry(0.18, TRAPPER_HEIGHT, 0.52), trapperMaterial);
      segment.userData.obstacleId = `trapper-${trapperIndex}-${index}`;
      segment.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      segment.rotation.y = -angle;
      disableShadows(segment);
      ring.add(segment);
    }

    const trackY = setUprightObstacleTransform(ring, sample, 0, TRAPPER_HEIGHT, 1, 0);
    ring.userData.dynamicGate = {
      closedY: trackY + SURFACE_CLEARANCE + TRAPPER_HEIGHT / 2,
      phase: trapper.phase,
      period: 18,
      trapper: true,
    } satisfies DynamicGateRenderData;
    group.add(ring);
  }

  for (const [index, spinner] of track.features.spinners.entries()) {
    const sample = sampleAtDistance(track.samples, spinner.distance);
    const width = (sample.width ?? TRACK_WIDTH) * 0.9;
    const mesh = new Mesh(new BoxGeometry(width, SPINNER_HEIGHT, 0.24), spinnerMaterial);

    setUprightObstacleTransform(mesh, sample, 0, SPINNER_HEIGHT, 1, spinner.phase);
    mesh.position.y += SPINNER_TRACK_LIFT;
    mesh.userData.dynamicSpinner = {
      yaw: sample.yaw,
      phase: spinner.phase,
      speed: spinner.speed,
    } satisfies DynamicSpinnerRenderData;
    mesh.userData.obstacleId = `spinner-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, hammer] of track.features.hammers.entries()) {
    const sample = sampleAtDistance(track.samples, hammer.distance);
    const mesh = new Mesh(new BoxGeometry(0.64, HAMMER_HEIGHT, 3.1), hammerMaterial);

    setUprightObstacleTransform(mesh, sample, 0, HAMMER_HEIGHT, 1, Math.PI / 2);
    mesh.userData.dynamicHammer = {
      yaw: sample.yaw + Math.PI / 2,
      phase: hammer.phase,
      side: hammer.side,
    } satisfies DynamicHammerRenderData;
    mesh.userData.obstacleId = `hammer-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, turnstile] of track.features.turnstiles.entries()) {
    const sample = sampleAtDistance(track.samples, turnstile.distance);
    const width = (sample.width ?? TRACK_WIDTH) * 0.58;
    const hub = new Group();
    const a = new Mesh(new BoxGeometry(width, TURNSTILE_HEIGHT, 0.26), spinnerMaterial);
    const b = new Mesh(new BoxGeometry(0.26, TURNSTILE_HEIGHT, width), spinnerMaterial);

    disableShadows(a);
    disableShadows(b);

    hub.add(a, b);
    hub.position.set(
      sample.x,
      sample.y + SURFACE_CLEARANCE + TURNSTILE_HEIGHT / 2 + TURNSTILE_TRACK_LIFT,
      sample.z,
    );
    hub.rotation.order = "YXZ";
    hub.rotation.y = sample.yaw + turnstile.phase;
    hub.rotation.x = 0;
    hub.rotation.z = 0;
    hub.userData.dynamicSpinner = {
      yaw: sample.yaw,
      phase: turnstile.phase,
      speed: turnstile.speed,
    } satisfies DynamicSpinnerRenderData;
    hub.userData.obstacleId = `turnstile-${index}`;

    group.add(hub);
  }

  for (const powerup of track.features.powerups) {
    const sample = sampleAtDistance(track.samples, powerup.distance);
    const color = new Color(0xdff8ff);
    const mesh = new Mesh(
      powerupGeometry,
      new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.72,
        roughness: 0.22,
        metalness: 0.18,
      }),
    );

    mesh.position.set(
      sample.x + sample.normal.x * powerup.offset,
      surfaceYAtOffset(sample, powerup.offset) + 0.55,
      sample.z + sample.normal.z * powerup.offset,
    );
    mesh.userData.powerupId = powerup.id;
    disableShadows(mesh);
    group.add(mesh);
  }
}

function createThickRibbon(samples: TrackDefinition["samples"], thickness: number): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const width = sample.width ?? TRACK_WIDTH;
    const leftOffset = -width / 2;
    const rightOffset = width / 2;
    const leftY = sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * leftOffset;
    const rightY = sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * rightOffset;

    positions.push(
      sample.x + sample.normal.x * leftOffset,
      leftY,
      sample.z + sample.normal.z * leftOffset,

      sample.x + sample.normal.x * rightOffset,
      rightY,
      sample.z + sample.normal.z * rightOffset,

      sample.x + sample.normal.x * leftOffset,
      leftY - thickness,
      sample.z + sample.normal.z * leftOffset,

      sample.x + sample.normal.x * rightOffset,
      rightY - thickness,
      sample.z + sample.normal.z * rightOffset,
    );

    if (index < samples.length - 1) {
      const start = index * 4;
      const next = start + 4;

      indices.push(
        // top
        start, next, start + 1,
        start + 1, next, next + 1,

        // bottom
        start + 2, start + 3, next + 2,
        start + 3, next + 3, next + 2,

        // left side
        start, start + 2, next,
        start + 2, next + 2, next,

        // right side
        start + 1, next + 1, start + 3,
        start + 3, next + 1, next + 3,
      );
    }
  }

  if (samples.length > 0) {
    const first = 0;
    const last = (samples.length - 1) * 4;

    indices.push(
      // start cap
      first, first + 1, first + 2,
      first + 1, first + 3, first + 2,

      // end cap
      last, last + 2, last + 1,
      last + 1, last + 2, last + 3,
    );
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function createThickWall(samples: TrackDefinition["samples"], side: -1 | 1, widthScale: number, track: TrackDefinition): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const width = (sample.width ?? TRACK_WIDTH) * widthScale;
    const innerOffset = side * (width / 2 - 0.02);
    const outerOffset = innerOffset + side * WALL_THICKNESS;
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

      if (side < 0) {
        indices.push(
          // inner face
          start, start + 1, next,
          start + 1, next + 1, next,

          // outer face
          start + 2, next + 2, start + 3,
          start + 3, next + 2, next + 3,

          // top
          start + 1, start + 3, next + 1,
          start + 3, next + 3, next + 1,

          // bottom
          start, next, start + 2,
          start + 2, next, next + 2,
        );
      } else {
        indices.push(
          // inner face
          start, next, start + 1,
          start + 1, next, next + 1,

          // outer face
          start + 2, start + 3, next + 2,
          start + 3, next + 3, next + 2,

          // top
          start + 1, next + 1, start + 3,
          start + 3, next + 1, next + 3,

          // bottom
          start, start + 2, next,
          start + 2, next + 2, next,
        );
      }
    }
  }

  if (samples.length > 0) {
    const first = 0;
    const last = (samples.length - 1) * 4;

    indices.push(
      // start cap
      first, first + 2, first + 1,
      first + 1, first + 2, first + 3,

      // end cap
      last, last + 1, last + 2,
      last + 1, last + 3, last + 2,
    );
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function disableShadows(object: Object3D): void {
  object.castShadow = false;
  object.receiveShadow = false;
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

function greenBumperPhase(index: number, distance: number): number {
  return obstacleCycleValue(index * 3.7 + distance * 0.13, 0);
}

function surfaceYAtOffset(sample: TrackDefinition["samples"][number], offset: number): number {
  return sample.y + Math.sin(sample.bank ?? 0) * offset;
}

function verticalObstacleCenterY(trackY: number, fullHeight: number, extension: number): number {
  const clampedExtension = Math.max(0.04, extension);
  const visibleCenter = trackY + SURFACE_CLEARANCE + (fullHeight * clampedExtension) / 2;
  const hiddenCenter = trackY - PEG_RETRACT_DEPTH;

  return hiddenCenter + (visibleCenter - hiddenCenter) * clampedExtension;
}

function setUprightObstacleTransform(
  mesh: Object3D,
  sample: TrackDefinition["samples"][number],
  offset: number,
  height: number,
  extension: number,
  yawOffset: number,
): number {
  const trackY = surfaceYAtOffset(sample, offset);
  const clampedExtension = Math.max(0.04, extension);

  mesh.position.set(
    sample.x + sample.normal.x * offset,
    verticalObstacleCenterY(trackY, height, clampedExtension),
    sample.z + sample.normal.z * offset,
  );

  mesh.rotation.order = "YXZ";
  mesh.rotation.y = sample.yaw + yawOffset;
  mesh.rotation.x = 0;
  mesh.rotation.z = 0;

  return trackY;
}

function toGeometry(data: TrackMeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(data.vertices, 3));
  geometry.setIndex(Array.from(data.indices));
  geometry.computeVertexNormals();

  return geometry;
}

function setTrackTransform(mesh: Mesh, x: number, y: number, z: number, yaw: number, bank = 0): void {
  mesh.position.set(x, y, z);
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = yaw;
  mesh.rotation.x = 0;
  mesh.rotation.z = -bank;
}

function gateExtensionAtTime(time: number, phase: number): number {
  const t = obstacleCycleValue(time, phase, 20);

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * (3 - 2 * t);
}
