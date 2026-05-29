import {
  BoxGeometry,
  BufferAttribute,
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
  Uint32BufferAttribute,
  Vector3,
} from "three";
import { createStartLayout } from "../shared/marbleLayout";
import {
  TRACK_WIDTH,
  type BoundaryPoint,
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

type RouteAwareFeature = {
  distance: number;
  offset?: number;
  routeId?: string;
  routeOffset?: number;
  mainOffset?: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  width?: number;
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

  // Only cut the main road where a replacement split surface was actually generated.
  // Cutting by feature intent creates missing road if the split surface is rejected.
  const splitRoadGaps = track.splitSurfaces.map(
    ({ startDistance, endDistance }) => ({
      startDistance,
      endDistance,
    }),
  );
  const road = new Mesh(
    toGeometry(
      createThickRibbon(track.samples, ROAD_THICKNESS, splitRoadGaps),
      true,
    ),
    roadMaterial,
  );
  road.receiveShadow = true;
  group.add(road);

  for (const surface of track.splitSurfaces) {
    const splitRoad = new Mesh(toSplitRoadGeometry(surface.road), roadMaterial);
    splitRoad.receiveShadow = true;
    group.add(splitRoad);
  }

  for (const side of [-1, 1] as const) {
    const wall = new Mesh(
      toGeometry(createThickWall(track.samples, side, 1, track)),
      sideMaterial,
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  for (const boundary of splitWallBoundaries(track)) {
    if (boundary.points.length < (boundary.closed ? 3 : 2)) {
      continue;
    }

    const wall = new Mesh(
      toGeometry(
        createWallAlongBoundary(
          boundary.points,
          boundary.closed,
          boundary.outwardSign,
        ),
      ),
      sideMaterial,
    );
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  addFeatureMeshes(group, track);
  addFinishLine(group, track);
  addCatchContainer(group, track);

  return group;
}

export function updateDynamicTrackMeshes(group: Group, time: number): void {
  group.traverse((object) => {
    const peg = object.userData.dynamicPeg as
      | DynamicVerticalObstacleRenderData
      | undefined;
    if (peg) {
      const extension = pegExtensionAtTime(time, peg.phase);
      object.scale.y = Math.max(0.04, extension);
      object.position.y = verticalObstacleCenterY(
        peg.trackY,
        peg.fullHeight,
        object.scale.y,
      );
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const greenBumper = object.userData.dynamicGreenBumper as
      | DynamicVerticalObstacleRenderData
      | undefined;
    if (greenBumper) {
      const extension = pegExtensionAtTime(time, greenBumper.phase);
      object.scale.y = Math.max(0.04, extension);
      object.position.y = verticalObstacleCenterY(
        greenBumper.trackY,
        greenBumper.fullHeight,
        object.scale.y,
      );
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const gate = object.userData.dynamicGate as
      | DynamicGateRenderData
      | undefined;
    if (gate) {
      const extension = gate.trapper
        ? trapperExtensionAtTime(time, gate.phase)
        : gateExtensionAtTime(time, gate.phase);
      object.scale.y = Math.max(0.035, extension);
      object.position.y =
        gate.closedY - (1 - extension) * (gate.trapper ? 1.24 : 0.92);
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const spinner = object.userData.dynamicSpinner as
      | DynamicSpinnerRenderData
      | undefined;
    if (spinner) {
      object.rotation.y = spinner.yaw + spinner.phase + time * spinner.speed;
      object.rotation.x = 0;
      object.rotation.z = 0;
      return;
    }

    const hammer = object.userData.dynamicHammer as
      | DynamicHammerRenderData
      | undefined;
    if (hammer) {
      object.rotation.y =
        hammer.yaw + Math.sin(time * 0.75 + hammer.phase) * 1.15 * hammer.side;
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

export function setCollectedPowerupsVisible(
  group: Group,
  collectedIds: string[],
): void {
  const collected = new Set(collectedIds);

  group.traverse((object) => {
    const id = object.userData.powerupId as string | undefined;
    if (id) {
      object.visible = !collected.has(id);
    }
  });
}

export function setDestroyedObstaclesVisible(
  group: Group,
  destroyedIds: string[],
): void {
  const destroyed = new Set(destroyedIds);

  group.traverse((object) => {
    const id = object.userData.obstacleId as string | undefined;
    if (id) {
      object.visible = !destroyed.has(id);
    }
  });
}

export function startCameraFrame(track: TrackDefinition): {
  position: Vector3;
  target: Vector3;
} {
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

  const horizontalSpan = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxZ - bounds.minZ,
    TRACK_WIDTH * 6,
  );
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

export function startingMarblePosition(
  index: number,
  total: number,
  track = generateTrack(PREVIEW_TRACK_SEED),
): Vector3 {
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
    const tile = new Mesh(
      new BoxGeometry(tileWidth * 0.95, 0.035, 0.2),
      index % 2 === 0 ? white : black,
    );

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
  const trayMaterial = new MeshStandardMaterial({
    color: 0x171d24,
    roughness: 0.72,
    metalness: 0.04,
  });
  const wallMaterial = new MeshStandardMaterial({
    color: 0x303a44,
    roughness: 0.62,
    metalness: 0.05,
  });
  const center = track.catchCenter;

  const floor = new Mesh(new BoxGeometry(width, 0.32, length), trayMaterial);
  floor.position.set(center.x, center.y, center.z);
  floor.receiveShadow = true;
  group.add(floor);

  for (const side of [-1, 1]) {
    const sideWall = new Mesh(
      new BoxGeometry(0.44, wallHeight, length),
      wallMaterial,
    );
    sideWall.position.set(
      center.x + (side * width) / 2,
      center.y + wallHeight / 2,
      center.z,
    );
    sideWall.castShadow = true;
    sideWall.receiveShadow = true;
    group.add(sideWall);
  }

  const backWall = new Mesh(
    new BoxGeometry(width, wallHeight, 0.44),
    wallMaterial,
  );
  backWall.position.set(
    center.x,
    center.y + wallHeight / 2,
    center.z + length / 2,
  );
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
  const pegMaterial = new MeshStandardMaterial({
    color: 0xd7463f,
    roughness: 0.5,
  });
  const bumperMaterial = new MeshStandardMaterial({
    color: 0x36c96d,
    roughness: 0.38,
    metalness: 0.05,
  });
  const gateMaterial = new MeshStandardMaterial({
    color: 0x4a90e2,
    roughness: 0.5,
  });
  const trapperMaterial = new MeshStandardMaterial({
    color: 0xff6f3c,
    roughness: 0.45,
    metalness: 0.04,
  });
  const spinnerMaterial = new MeshStandardMaterial({
    color: 0xf2b84b,
    roughness: 0.42,
  });
  const hammerMaterial = new MeshStandardMaterial({
    color: 0xa35df2,
    roughness: 0.45,
  });
  const powerupGeometry = new OctahedronGeometry(0.38, 0);

  for (const [index, peg] of track.features.pegs.entries()) {
    const sample = featureSampleForFeature(track, peg);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(featureRenderOffset(peg), -maxOffset, maxOffset);
    const extension = pegExtensionAtTime(0, peg.phase);
    const mesh = new Mesh(
      new CylinderGeometry(peg.radius, peg.radius, PEG_HEIGHT, 18),
      pegMaterial,
    );
    const trackY = setUprightObstacleTransform(
      mesh,
      sample,
      offset,
      PEG_HEIGHT,
      extension,
      0,
    );

    mesh.scale.y = Math.max(0.04, extension);
    mesh.userData.dynamicPeg = {
      trackY,
      phase: peg.phase,
      fullHeight: PEG_HEIGHT,
    } satisfies DynamicVerticalObstacleRenderData;
    mesh.userData.obstacleId = `peg-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, bumper] of track.features.greenBumpers.entries()) {
    const sample = featureSampleForFeature(track, bumper);
    const runtimePhase = (bumper as typeof bumper & { phase?: number }).phase;
    const phase = runtimePhase ?? greenBumperPhase(index, bumper.distance);
    const extension = pegExtensionAtTime(0, phase);
    const mesh = new Mesh(
      new CylinderGeometry(bumper.radius, bumper.radius, BUMPER_HEIGHT, 24),
      bumperMaterial,
    );
    const trackY = setUprightObstacleTransform(
      mesh,
      sample,
      featureRenderOffset(bumper),
      BUMPER_HEIGHT,
      extension,
      0,
    );

    mesh.scale.y = Math.max(0.04, extension);
    mesh.userData.dynamicGreenBumper = {
      trackY,
      phase,
      fullHeight: BUMPER_HEIGHT,
    } satisfies DynamicVerticalObstacleRenderData;
    mesh.userData.obstacleId = `green-bumper-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [index, gate] of track.features.gates.entries()) {
    const sample = featureSampleForFeature(track, gate);
    const width = sample.width ?? TRACK_WIDTH;
    const mesh = new Mesh(
      new BoxGeometry(width + 0.24, GATE_HEIGHT, 0.32),
      gateMaterial,
    );
    const trackY = setUprightObstacleTransform(
      mesh,
      sample,
      featureRenderOffset(gate),
      GATE_HEIGHT,
      1,
      0,
    );

    mesh.userData.dynamicGate = {
      closedY: trackY + SURFACE_CLEARANCE + GATE_HEIGHT / 2,
      phase: gate.phase,
    } satisfies DynamicGateRenderData;
    mesh.userData.obstacleId = `gate-${index}`;
    disableShadows(mesh);

    group.add(mesh);
  }

  for (const [trapperIndex, trapper] of track.features.trappers.entries()) {
    const sample = featureSampleForFeature(track, trapper);
    const ring = new Group();
    const segmentCount = 10;
    const ringRadius = Math.min(
      trapper.radius,
      Math.max(0.65, (sample.width ?? TRACK_WIDTH) / 2 - 0.55),
    );

    for (let index = 0; index < segmentCount; index += 1) {
      const angle = (index / segmentCount) * Math.PI * 2;
      const segment = new Mesh(
        new BoxGeometry(0.18, TRAPPER_HEIGHT, 0.52),
        trapperMaterial,
      );
      segment.userData.obstacleId = `trapper-${trapperIndex}-${index}`;
      segment.position.set(
        Math.cos(angle) * ringRadius,
        0,
        Math.sin(angle) * ringRadius,
      );
      segment.rotation.y = -angle;
      disableShadows(segment);
      ring.add(segment);
    }

    const trackY = setUprightObstacleTransform(
      ring,
      sample,
      featureRenderOffset(trapper),
      TRAPPER_HEIGHT,
      1,
      0,
    );
    ring.userData.dynamicGate = {
      closedY: trackY + SURFACE_CLEARANCE + TRAPPER_HEIGHT / 2,
      phase: trapper.phase,
      period: 18,
      trapper: true,
    } satisfies DynamicGateRenderData;
    group.add(ring);
  }

  for (const [index, spinner] of track.features.spinners.entries()) {
    const sample = featureSampleForFeature(track, spinner);
    const width = (sample.width ?? TRACK_WIDTH) * 0.9;
    const mesh = new Mesh(
      new BoxGeometry(width, SPINNER_HEIGHT, 0.24),
      spinnerMaterial,
    );

    setUprightObstacleTransform(
      mesh,
      sample,
      featureRenderOffset(spinner),
      SPINNER_HEIGHT,
      1,
      spinner.phase,
    );
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
    const sample = featureSampleForFeature(track, hammer);
    const mesh = new Mesh(
      new BoxGeometry(0.64, HAMMER_HEIGHT, 3.1),
      hammerMaterial,
    );

    setUprightObstacleTransform(
      mesh,
      sample,
      featureRenderOffset(hammer),
      HAMMER_HEIGHT,
      1,
      Math.PI / 2,
    );
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
    const sample = featureSampleForFeature(track, turnstile);
    const width = (sample.width ?? TRACK_WIDTH) * 0.58;
    const hub = new Group();
    const a = new Mesh(
      new BoxGeometry(width, TURNSTILE_HEIGHT, 0.26),
      spinnerMaterial,
    );
    const b = new Mesh(
      new BoxGeometry(0.26, TURNSTILE_HEIGHT, width),
      spinnerMaterial,
    );

    disableShadows(a);
    disableShadows(b);

    hub.add(a, b);
    const turnstileOffset = featureRenderOffset(turnstile);
    hub.position.set(
      sample.x + sample.normal.x * turnstileOffset,
      surfaceYAtOffset(sample, turnstileOffset) +
        SURFACE_CLEARANCE +
        TURNSTILE_HEIGHT / 2 +
        TURNSTILE_TRACK_LIFT,
      sample.z + sample.normal.z * turnstileOffset,
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

  for (const [powerupIndex, powerup] of track.features.powerups.entries()) {
    const sample = featureSampleForFeature(track, powerup);
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
      sample.x + sample.normal.x * featureRenderOffset(powerup),
      surfaceYAtOffset(sample, featureRenderOffset(powerup)) + 0.55,
      sample.z + sample.normal.z * featureRenderOffset(powerup),
    );
    mesh.userData.powerupId = powerup.id;
    disableShadows(mesh);
    group.add(mesh);
  }
}

function createThickRibbon(
  samples: TrackDefinition["samples"],
  thickness: number,
  gaps: Array<{ startDistance: number; endDistance: number }> = [],
  capEnds = true,
): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const width = sample.width ?? TRACK_WIDTH;
    const leftOffset = -width / 2;
    const rightOffset = width / 2;
    const leftY =
      sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * leftOffset;
    const rightY =
      sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * rightOffset;

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
      const segmentDistance =
        (sample.distance + samples[index + 1].distance) / 2;

      if (isRoadSegmentGap(segmentDistance, gaps)) {
        continue;
      }

      indices.push(
        // top
        start,
        next,
        start + 1,
        start + 1,
        next,
        next + 1,

        // bottom
        start + 2,
        start + 3,
        next + 2,
        start + 3,
        next + 3,
        next + 2,

        // left side
        start,
        start + 2,
        next,
        start + 2,
        next + 2,
        next,

        // right side
        start + 1,
        next + 1,
        start + 3,
        start + 3,
        next + 1,
        next + 3,
      );
    }
  }

  if (capEnds && samples.length > 0) {
    const first = 0;
    const last = (samples.length - 1) * 4;

    indices.push(
      // start cap
      first,
      first + 1,
      first + 2,
      first + 1,
      first + 3,
      first + 2,

      // end cap
      last,
      last + 2,
      last + 1,
      last + 1,
      last + 2,
      last + 3,
    );
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function createBranchRibbon(
  samples: TrackDefinition["samples"],
): TrackMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const width = sample.width ?? TRACK_WIDTH;
    const leftOffset = -width / 2;
    const rightOffset = width / 2;
    const leftY =
      sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * leftOffset;
    const rightY =
      sample.y + ROAD_SURFACE_OFFSET + Math.sin(sample.bank ?? 0) * rightOffset;

    positions.push(
      sample.x + sample.normal.x * leftOffset,
      leftY,
      sample.z + sample.normal.z * leftOffset,

      sample.x + sample.normal.x * rightOffset,
      rightY,
      sample.z + sample.normal.z * rightOffset,
    );

    if (index < samples.length - 1) {
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

function splitBranchLaneSamples(
  track: TrackDefinition,
  branch: TrackDefinition["branches"][number],
): TrackDefinition["samples"] {
  void track;
  return branch.samples;
}

function isRoadSegmentGap(
  distance: number,
  gaps: Array<{ startDistance: number; endDistance: number }>,
): boolean {
  return gaps.some(
    (gap) => distance > gap.startDistance && distance < gap.endDistance,
  );
}

type WallPoint = BoundaryPoint;
type BoundaryWall = {
  points: WallPoint[];
  closed: boolean;
  outwardSign: 1 | -1;
};

type OffsetNormal = { x: number; z: number };

function splitWallBoundaries(track: TrackDefinition): BoundaryWall[] {
  const walls: BoundaryWall[] = [];

  for (const surface of track.splitSurfaces) {
    const [leftOuter, rightOuter] = surface.outerBoundaries;

    // Split walls must be edge-anchored to the same boundary points used by the
    // split road mesh. Do not smooth them here: smoothing creates wall/road drift.
    if (leftOuter?.length >= 2) {
      walls.push({
        points: dedupeWallPoints(leftOuter),
        closed: false,
        outwardSign: -1,
      });
    }

    if (rightOuter?.length >= 2) {
      walls.push({
        points: dedupeWallPoints(rightOuter),
        closed: false,
        outwardSign: 1,
      });
    }

    if (surface.innerBoundary.length >= 3) {
      const inner = dedupeWallPoints(surface.innerBoundary);
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
  // Split island loops are walls around a hole. The wall should thicken into the island,
  // not into either lane. For a clockwise x/z loop, the polygon interior is on the right.
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

function createWallAlongBoundary(
  points: WallPoint[],
  closed: boolean,
  outwardSign: 1 | -1,
): TrackMeshData {
  const cleanPoints = dedupeWallPoints(points);
  const count = cleanPoints.length;

  if (count < (closed ? 3 : 2)) {
    return { vertices: new Float32Array(), indices: new Uint32Array() };
  }

  // Match the normal track wall topology: one shared vertex row per path point.
  // The inner wall foot remains exactly on the split road edge, while the outer
  // face is offset with clamped miter normals. Shared rows remove the per-segment
  // faceting/striped lighting that made split walls look like a different texture.
  const offsetNormals = computeOffsetNormals(cleanPoints, closed, outwardSign);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const point = cleanPoints[index];
    const normal = offsetNormals[index];
    const bottomY = point.y - WALL_EXTENSION_BELOW;
    const topY = point.y + WALL_HEIGHT_ABOVE;
    const outerX = point.x + normal.x * WALL_THICKNESS;
    const outerZ = point.z + normal.z * WALL_THICKNESS;

    positions.push(
      point.x,
      bottomY,
      point.z,
      point.x,
      topY,
      point.z,
      outerX,
      bottomY,
      outerZ,
      outerX,
      topY,
      outerZ,
    );
  }

  const segmentCount = closed ? count : count - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % count;

    if (
      horizontalDistanceXZ(cleanPoints[index], cleanPoints[nextIndex]) < 0.035
    ) {
      continue;
    }

    const start = index * 4;
    const next = nextIndex * 4;

    if (outwardSign < 0) {
      indices.push(
        // inner face, exact road edge
        start,
        start + 1,
        next,
        start + 1,
        next + 1,
        next,

        // outer face
        start + 2,
        next + 2,
        start + 3,
        start + 3,
        next + 2,
        next + 3,

        // top
        start + 1,
        start + 3,
        next + 1,
        start + 3,
        next + 3,
        next + 1,

        // bottom
        start,
        next,
        start + 2,
        start + 2,
        next,
        next + 2,
      );
    } else {
      indices.push(
        // inner face, exact road edge
        start,
        next,
        start + 1,
        start + 1,
        next,
        next + 1,

        // outer face
        start + 2,
        start + 3,
        next + 2,
        start + 3,
        next + 3,
        next + 2,

        // top
        start + 1,
        next + 1,
        start + 3,
        start + 3,
        next + 1,
        next + 3,

        // bottom
        start,
        start + 2,
        next,
        start + 2,
        next + 2,
        next,
      );
    }
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function horizontalDistanceXZ(a: WallPoint, b: WallPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function computeOffsetNormals(
  points: WallPoint[],
  closed: boolean,
  outwardSign: 1 | -1,
): OffsetNormal[] {
  const normals: OffsetNormal[] = [];
  const count = points.length;

  for (let index = 0; index < count; index += 1) {
    if (!closed && index === 0) {
      normals.push(
        segmentOffsetNormal(points[index], points[index + 1], outwardSign),
      );
      continue;
    }

    if (!closed && index === count - 1) {
      normals.push(
        segmentOffsetNormal(points[index - 1], points[index], outwardSign),
      );
      continue;
    }

    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const beforeNormal = segmentOffsetNormal(previous, current, outwardSign);
    const afterNormal = segmentOffsetNormal(current, next, outwardSign);
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

function segmentOffsetNormal(
  a: WallPoint,
  b: WallPoint,
  outwardSign: 1 | -1,
): OffsetNormal {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;

  return {
    x: outwardSign * (dz / length),
    z: outwardSign * (-dx / length),
  };
}

function dedupeWallPoints(points: WallPoint[]): WallPoint[] {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return (
      Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
        point.z - previous.z,
      ) > 0.05
    );
  });
}

function smoothWallPath(
  points: WallPoint[],
  closed: boolean,
  iterations: number,
): WallPoint[] {
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

function createThickWall(
  samples: TrackDefinition["samples"],
  side: -1 | 1,
  widthScale: number,
  track: TrackDefinition,
  applyTrackGaps = true,
  capEnds = true,
  suppressCoveredEdges = false,
): TrackMeshData {
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
      const segmentDistance =
        (sample.distance + samples[index + 1].distance) / 2;

      const skipReason = wallSegmentSkipReason(
        track,
        samples,
        index,
        side,
        widthScale,
        applyTrackGaps,
        suppressCoveredEdges,
      );

      if (skipReason !== "none") {
        continue;
      }

      if (side < 0) {
        indices.push(
          // inner face
          start,
          start + 1,
          next,
          start + 1,
          next + 1,
          next,

          // outer face
          start + 2,
          next + 2,
          start + 3,
          start + 3,
          next + 2,
          next + 3,

          // top
          start + 1,
          start + 3,
          next + 1,
          start + 3,
          next + 3,
          next + 1,

          // bottom
          start,
          next,
          start + 2,
          start + 2,
          next,
          next + 2,
        );
      } else {
        indices.push(
          // inner face
          start,
          next,
          start + 1,
          start + 1,
          next,
          next + 1,

          // outer face
          start + 2,
          start + 3,
          next + 2,
          start + 3,
          next + 3,
          next + 2,

          // top
          start + 1,
          next + 1,
          start + 3,
          start + 3,
          next + 1,
          next + 3,

          // bottom
          start,
          start + 2,
          next,
          start + 2,
          next + 2,
          next,
        );
      }
    }
  }

  if (capEnds && samples.length > 0) {
    const first = 0;
    const last = (samples.length - 1) * 4;

    indices.push(
      // start cap
      first,
      first + 2,
      first + 1,
      first + 1,
      first + 2,
      first + 3,

      // end cap
      last,
      last + 1,
      last + 2,
      last + 1,
      last + 3,
      last + 2,
    );
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function wallSegmentSkipReason(
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  index: number,
  side: -1 | 1,
  widthScale: number,
  applyTrackGaps: boolean,
  suppressCoveredEdges: boolean,
): "none" | "covered" {
  const sample = samples[index];
  const next = samples[index + 1];
  const segmentDistance = (sample.distance + next.distance) / 2;

  if (applyTrackGaps && isSplitWallJunctionGap(track, segmentDistance, side)) {
    return "covered";
  }

  if (
    suppressCoveredEdges &&
    isWallEdgeCoveredByRoad(track, samples, sample, next, side, widthScale)
  ) {
    return "covered";
  }

  return "none";
}

function addWallEndCap(indices: number[], start: number): void {
  indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
}

function isWallSegmentGap(
  track: TrackDefinition,
  distance: number,
  side: -1 | 1,
): boolean {
  return isSplitWallJunctionGap(track, distance, side);
}

function isSplitWallJunctionGap(
  track: TrackDefinition,
  distance: number,
  side: -1 | 1,
): boolean {
  void side;
  return track.splitSurfaces.some(
    (surface) =>
      distance > surface.startDistance && distance < surface.endDistance,
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
  const width =
    (((sample.width ?? TRACK_WIDTH) + (next.width ?? TRACK_WIDTH)) / 2) *
    widthScale;
  const edgeOffset = side * (width / 2 - 0.02);
  const bank = ((sample.bank ?? 0) + (next.bank ?? 0)) / 2;
  const midpoint = {
    x:
      (sample.x + next.x) / 2 +
      ((sample.normal.x + next.normal.x) / 2) * edgeOffset,
    y: (sample.y + next.y) / 2 + Math.sin(bank) * edgeOffset,
    z:
      (sample.z + next.z) / 2 +
      ((sample.normal.z + next.normal.z) / 2) * edgeOffset,
  };

  for (const routeSamples of roadSurfaceRoutes(track)) {
    if (
      routeSamples === ownSamples ||
      !isRoadSurfaceActive(track, routeSamples, distance)
    ) {
      continue;
    }

    const roadSample = sampleAtDistance(routeSamples, distance);
    const dx = midpoint.x - roadSample.x;
    const dz = midpoint.z - roadSample.z;
    const lateral = Math.abs(
      dx * roadSample.normal.x + dz * roadSample.normal.z,
    );
    const horizontal = Math.hypot(dx, dz);
    const vertical = Math.abs(
      midpoint.y - (roadSample.y + Math.sin(roadSample.bank ?? 0) * lateral),
    );
    const roadHalfWidth = (roadSample.width ?? TRACK_WIDTH) / 2;

    if (
      lateral <= roadHalfWidth - 0.08 &&
      horizontal <= roadHalfWidth + 0.75 &&
      vertical <= 0.9
    ) {
      return true;
    }
  }

  return false;
}

function roadSurfaceRoutes(
  track: TrackDefinition,
): Array<TrackDefinition["samples"]> {
  return [track.samples, ...track.branches.map((branch) => branch.samples)];
}

function isRoadSurfaceActive(
  track: TrackDefinition,
  samples: TrackDefinition["samples"],
  distance: number,
): boolean {
  if (samples === track.samples) {
    return !track.splitSurfaces.some(
      (surface) =>
        distance > surface.startDistance && distance < surface.endDistance,
    );
  }

  return track.branches.some(
    (branch) =>
      branch.samples === samples &&
      distance >= branch.startDistance &&
      distance <= branch.endDistance,
  );
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

  const raiseStart =
    PEG_HOLD_UP_SECONDS + PEG_LOWER_SECONDS + PEG_HOLD_DOWN_SECONDS;
  return smoothstep(0, 1, (t - raiseStart) / PEG_RAISE_SECONDS);
}

function greenBumperPhase(index: number, distance: number): number {
  return obstacleCycleValue(index * 3.7 + distance * 0.13, 0);
}

function surfaceYAtOffset(
  sample: TrackDefinition["samples"][number],
  offset: number,
): number {
  return sample.y + Math.sin(sample.bank ?? 0) * offset;
}

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
  if (feature.routeId?.startsWith("split-")) {
    return feature.routeOffset ?? feature.offset ?? 0;
  }

  return feature.routeOffset ?? feature.offset ?? 0;
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

  const alpha = clamp(
    (distance - surface.startDistance) /
      Math.max(surface.endDistance - surface.startDistance, 0.0001),
    0,
    1,
  );
  const row = clamp(Math.round(alpha * (rowCount - 1)), 0, rowCount - 1);
  const previousRow = Math.max(0, row - 1);
  const nextRow = Math.min(rowCount - 1, row + 1);
  const leftColumn = side < 0 ? 0 : 4;
  const rightColumn = side < 0 ? 3 : 7;
  const left = splitSurfaceVertex(vertices, row, leftColumn, rowSize);
  const right = splitSurfaceVertex(vertices, row, rightColumn, rowSize);
  const previousCenter = splitSurfaceLaneCenter(
    vertices,
    previousRow,
    leftColumn,
    rightColumn,
    rowSize,
  );
  const nextCenter = splitSurfaceLaneCenter(
    vertices,
    nextRow,
    leftColumn,
    rightColumn,
    rowSize,
  );
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

function splitSurfaceVertex(
  vertices: Float32Array,
  row: number,
  column: number,
  rowSize: number,
): { x: number; y: number; z: number } {
  const offset = (row * rowSize + column) * 3;
  return {
    x: vertices[offset],
    y: vertices[offset + 1],
    z: vertices[offset + 2],
  };
}

function splitSurfaceLaneCenter(
  vertices: Float32Array,
  row: number,
  leftColumn: number,
  rightColumn: number,
  rowSize: number,
): { x: number; y: number; z: number } {
  return midpoint3(
    splitSurfaceVertex(vertices, row, leftColumn, rowSize),
    splitSurfaceVertex(vertices, row, rightColumn, rowSize),
  );
}

function midpoint3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function normalize3(value: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function normalizeXZ(value: { x: number; z: number }): {
  x: number;
  z: number;
} {
  const length = Math.hypot(value.x, value.z) || 1;
  return { x: value.x / length, z: value.z / length };
}

function verticalObstacleCenterY(
  trackY: number,
  fullHeight: number,
  extension: number,
): number {
  const clampedExtension = Math.max(0.04, extension);
  const visibleCenter =
    trackY + SURFACE_CLEARANCE + (fullHeight * clampedExtension) / 2;
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

function toGeometry(
  data: TrackMeshData,
  smoothRoadSurface = false,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(data.vertices, 3),
  );
  geometry.setIndex(new Uint32BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();

  if (smoothRoadSurface) {
    softenRoadSurfaceNormals(geometry);
  }

  return geometry;
}

function toSplitRoadGeometry(data: TrackMeshData): BufferGeometry {
  const geometry = toGeometry(data, false);
  softenSplitRoadSurfaceNormals(geometry);
  return geometry;
}

function softenSplitRoadSurfaceNormals(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const rowSize = positions.count % 8 === 0 ? 8 : 4;

  if (positions.count < rowSize || positions.count % rowSize !== 0) {
    return;
  }

  // Use the same bank-style top normal as the default road mesh. The previous
  // split-only normal used longitudinal slope, so split floors reacted to light
  // differently and showed a visible material/color boundary at split joins.
  for (let rowStart = 0; rowStart < positions.count; rowStart += rowSize) {
    const leftTop = rowStart;
    const rightTop = rowStart + rowSize - 1;
    const dx = positions.getX(rightTop) - positions.getX(leftTop);
    const dy = positions.getY(rightTop) - positions.getY(leftTop);
    const dz = positions.getZ(rightTop) - positions.getZ(leftTop);
    const sideLength = Math.hypot(dx, dz) || 1;
    const bankNormalY = Math.max(0.6, sideLength / Math.hypot(dy, sideLength));
    const bankNormalX = (-dx * dy) / (sideLength * sideLength + dy * dy || 1);
    const bankNormalZ = (-dz * dy) / (sideLength * sideLength + dy * dy || 1);
    const normalLength = Math.hypot(bankNormalX, bankNormalY, bankNormalZ) || 1;

    for (let offset = 0; offset < rowSize; offset += 1) {
      normals.setXYZ(
        rowStart + offset,
        bankNormalX / normalLength,
        bankNormalY / normalLength,
        bankNormalZ / normalLength,
      );
    }
  }

  normals.needsUpdate = true;
}

function averageSplitRowCenter(
  positions: BufferAttribute | Float32BufferAttribute,
  rowStart: number,
): { x: number; y: number; z: number } {
  return {
    x: (positions.getX(rowStart) + positions.getX(rowStart + 3)) / 2,
    y: (positions.getY(rowStart) + positions.getY(rowStart + 3)) / 2,
    z: (positions.getZ(rowStart) + positions.getZ(rowStart + 3)) / 2,
  };
}

function crossVectors(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVector3(value: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function softenRoadSurfaceNormals(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");

  for (let index = 0; index < positions.count; index += 4) {
    const leftTop = index;
    const rightTop = index + 1;

    if (rightTop >= positions.count) {
      break;
    }

    const dx = positions.getX(rightTop) - positions.getX(leftTop);
    const dy = positions.getY(rightTop) - positions.getY(leftTop);
    const dz = positions.getZ(rightTop) - positions.getZ(leftTop);
    const sideLength = Math.hypot(dx, dz) || 1;
    const bankNormalY = Math.max(0.6, sideLength / Math.hypot(dy, sideLength));
    const bankNormalX = (-dx * dy) / (sideLength * sideLength + dy * dy || 1);
    const bankNormalZ = (-dz * dy) / (sideLength * sideLength + dy * dy || 1);
    const normalLength = Math.hypot(bankNormalX, bankNormalY, bankNormalZ) || 1;

    normals.setXYZ(
      leftTop,
      bankNormalX / normalLength,
      bankNormalY / normalLength,
      bankNormalZ / normalLength,
    );
    normals.setXYZ(
      rightTop,
      bankNormalX / normalLength,
      bankNormalY / normalLength,
      bankNormalZ / normalLength,
    );
  }

  normals.needsUpdate = true;
}

function setTrackTransform(
  mesh: Mesh,
  x: number,
  y: number,
  z: number,
  yaw: number,
  bank = 0,
): void {
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


