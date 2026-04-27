import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
} from "three";
import { createStartLayout } from "../shared/marbleLayout";
import {
  CATCH_DISTANCE,
  FINISH_DISTANCE,
  TRACK_WIDTH,
  type TrackDefinition,
  type TrackMeshData,
  generateTrack,
  sampleAtDistance,
} from "../shared/trackGenerator";

export const PREVIEW_TRACK_SEED = "preview-track";

export function createTrackMeshes(track: TrackDefinition): Group {
  const group = new Group();
  const roadMaterial = new MeshStandardMaterial({ color: 0x24282d, roughness: 0.58, metalness: 0.05 });
  const sideMaterial = new MeshStandardMaterial({ color: 0x242f3a, roughness: 0.65, side: DoubleSide });

  const road = new Mesh(toGeometry(track.road), roadMaterial);
  road.receiveShadow = true;
  group.add(road);
  for (const branch of track.branches) {
    const branchRoad = new Mesh(toGeometry(branch.road), roadMaterial);
    branchRoad.receiveShadow = true;
    group.add(branchRoad);
  }

  for (const [side, wallData] of [
    [-1, track.leftWall],
    [1, track.rightWall],
  ] as const) {
    const wall = new Mesh(toGeometry(wallData), sideMaterial);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }
  for (const branch of track.branches) {
    for (const [side, wallData] of [
      [-1, branch.leftWall],
      [1, branch.rightWall],
    ] as const) {
      void side;
      const wall = new Mesh(toGeometry(wallData), sideMaterial);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }
  }

  addFeatureMeshes(group, track);
  addFinishLine(group, track);
  addCatchContainer(group, track);
  addSupports(group, track);

  return group;
}

export function trackFocusForZ(track: TrackDefinition, z: number): Vector3 {
  const sample = interpolatedSampleAtDistance(track, Math.max(0, Math.min(CATCH_DISTANCE, z)));
  return new Vector3(sample.x, sample.y + 0.75, sample.z + 2);
}

export function startCameraFrame(track: TrackDefinition): { position: Vector3; target: Vector3 } {
  const start = track.start;
  const target = new Vector3(start.x, start.y + 0.65, start.z + 3.4);
  const position = new Vector3(
    start.x - start.tangent.x * 8 + start.normal.x * 1.8,
    start.y + 7.8,
    start.z - start.tangent.z * 8 + start.normal.z * 1.8,
  );
  return { position, target };
}

export function startingMarblePosition(index: number, total: number, track = generateTrack(PREVIEW_TRACK_SEED)): Vector3 {
  const layout = createStartLayout(total);
  const laneOffset = layout.laneOffsets[index] ?? 0;
  const start = track.start;

  return new Vector3(
    start.x + start.normal.x * laneOffset,
    start.y + layout.radius + 0.08,
    start.z + start.normal.z * laneOffset,
  );
}

function addFinishLine(group: Group, track: TrackDefinition): void {
  const black = new MeshStandardMaterial({ color: 0x07090c, roughness: 0.36 });
  const white = new MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.32 });
  const accent = new MeshStandardMaterial({ color: 0xff2d22, roughness: 0.35 });
  const tileCount = 12;
  const finishWidth = track.finish.width ?? TRACK_WIDTH;
  const tileWidth = (finishWidth - 0.55) / tileCount;

  for (let index = 0; index < tileCount; index += 1) {
    const offset = -((finishWidth - 0.55) / 2) + tileWidth * (index + 0.5);
    const tile = new Mesh(new BoxGeometry(tileWidth * 0.95, 0.035, 0.2), index % 2 === 0 ? white : black);
    setTrackTransform(
      tile,
      track.finish.x + track.finish.normal.x * offset,
      track.finish.y + 0.15,
      track.finish.z + track.finish.normal.z * offset,
      track.finish.yaw,
    );
    group.add(tile);
  }

  for (const zOffset of [-0.18, 0.18]) {
    const stripe = new Mesh(new BoxGeometry(finishWidth - 0.45, 0.03, 0.045), accent);
    setTrackTransform(
      stripe,
      track.finish.x + track.finish.tangent.x * zOffset,
      track.finish.y + 0.17,
      track.finish.z + track.finish.tangent.z * zOffset,
      track.finish.yaw,
    );
    group.add(stripe);
  }

  const label = createFinishLabel();
  label.position.set(track.finish.x, track.finish.y + 0.78, track.finish.z + 0.18);
  group.add(label);
}

function addCatchContainer(group: Group, track: TrackDefinition): void {
  const width = TRACK_WIDTH + 14;
  const length = 18;
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

  for (const peg of track.features.pegs) {
    const sample = sampleAtDistance(track.samples, peg.distance);
    const maxOffset = Math.max(0.25, (sample.width ?? TRACK_WIDTH) / 2 - 1.05);
    const offset = clamp(peg.offset, -maxOffset, maxOffset);
    const mesh = new Mesh(new CylinderGeometry(peg.radius, peg.radius, 0.56, 18), pegMaterial);
    setFeatureTransform(mesh, sample, offset, 0.28);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function setFeatureTransform(mesh: Mesh, sample: TrackDefinition["samples"][number], offset: number, yOffset: number, yawOffset = 0): void {
  mesh.position.set(
    sample.x + sample.normal.x * offset,
    sample.y + Math.sin(sample.bank ?? 0) * offset + yOffset,
    sample.z + sample.normal.z * offset,
  );
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = sample.yaw + yawOffset;
}

function addSupports(group: Group, track: TrackDefinition): void {
  const supportMaterial = new MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.6 });
  const baseMaterial = new MeshStandardMaterial({ color: 0xaab4bf, roughness: 0.72 });

  for (let distance = 3; distance < FINISH_DISTANCE + 4; distance += 6) {
    const sample = sampleAtDistance(track.samples, distance);
    const height = sample.y - 0.22;
    if (height < 0.45) {
      continue;
    }

    const support = new Mesh(new CylinderGeometry(0.18, 0.28, height, 20), supportMaterial);
    support.position.set(sample.x, height / 2, sample.z);
    support.castShadow = true;
    support.receiveShadow = true;
    group.add(support);

    const base = new Mesh(new CylinderGeometry(0.68, 0.78, 0.18, 24), baseMaterial);
    base.position.set(sample.x, 0.02, sample.z);
    base.receiveShadow = true;
    group.add(base);
  }
}

function interpolatedSampleAtDistance(track: TrackDefinition, distance: number): { x: number; y: number; z: number } {
  const samples = track.samples;
  if (distance <= samples[0].distance) {
    return samples[0];
  }

  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index];
    if (next.distance < distance) {
      continue;
    }

    const previous = samples[index - 1];
    const span = Math.max(next.distance - previous.distance, 0.0001);
    const alpha = (distance - previous.distance) / span;
    return {
      x: previous.x + (next.x - previous.x) * alpha,
      y: previous.y + (next.y - previous.y) * alpha,
      z: previous.z + (next.z - previous.z) * alpha,
    };
  }

  return samples[samples.length - 1];
}

function toGeometry(data: TrackMeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(data.vertices, 3));
  geometry.setIndex(Array.from(data.indices));
  geometry.computeVertexNormals();
  return geometry;
}

function setTrackTransform(mesh: Mesh, x: number, y: number, z: number, yaw: number): void {
  mesh.position.set(x, y, z);
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = yaw;
  mesh.rotation.x = 0.075;
}

function createFinishLabel(): Sprite {
  const texture = textTexture("FINISH", "#111820", "#ffffff");
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

function textTexture(text: string, color: string, background: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (!context) {
    return new Texture();
  }

  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = "700 54px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
