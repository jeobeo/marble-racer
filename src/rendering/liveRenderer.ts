import { BufferGeometry, Clock, Group, Material, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMarbleMeshes, type MarbleMesh } from "./marbleMeshes";
import { createScene, resizeScene, type SceneBundle } from "./scene";
import {
  PREVIEW_TRACK_SEED,
  createTrackMeshes,
  setCollectedPowerupsVisible,
  setDestroyedObstaclesVisible,
  startCameraFrame,
  startingMarblePosition,
  updateDynamicTrackMeshes,
} from "./trackMeshes";
import type { FinishPlacement, PickerOption, RaceBall, RaceFrame, RaceResult } from "../simulation/types";
import { type TrackDefinition, generateTrack, progressForPosition } from "../shared/trackGenerator";

export type LiveRenderState = "idle" | "live" | "paused" | "finished";

const CAMERA_FOLLOW_SECONDS = 0.75;
const FINISHED_CAMERA_GRACE_SECONDS = 1.3;
const LEADER_SWITCH_PROGRESS_MARGIN = 0.35;
const LABEL_WORLD_Y_OFFSET = 0.82;

/**
 * Rotation smoothing reduces visible Rapier angular jitter.
 * This only affects rendering, not the actual simulation result.
 */
const ROTATION_SMOOTHING_SECONDS = 0.055;

type LiveTickCallback = (deltaSeconds: number) => void;

export class LiveRenderer {
  private readonly bundle: SceneBundle;
  private readonly raceGroup = new Group();
  private readonly clock = new Clock();
  private readonly controls: OrbitControls;
  private readonly labelOverlay: HTMLElement;

  private track = generateTrack(PREVIEW_TRACK_SEED);
  private trackRenderSignature = trackRenderSignature(this.track);
  private trackGroup = createTrackMeshes(this.track);
  private marbles = new Map<string, MarbleMesh>();
  private labelElements = new Map<string, HTMLElement>();
  private labelBaseTexts = new Map<string, string>();
  private labelRenderedTexts = new Map<string, string>();
  private options: Array<PickerOption | RaceBall> = [];
  private placements: FinishPlacement[] = [];
  private state: LiveRenderState = "idle";
  private animationId = 0;
  private desiredFollowTarget = new Vector3();
  private currentFollowTarget = new Vector3();
  private hasLiveFollowTarget = false;
  private followedBallId = "";
  private manualFollowBallId = "";
  private liveTick: LiveTickCallback | null = null;
  private readonly labelWorldPosition = new Vector3();
  private readonly labelScreenPosition = new Vector3();
  private readonly targetRotation = new Quaternion();
  private readonly cameraTargetDelta = new Vector3();
  private lastCollectedPowerupKey = "";
  private lastDestroyedObstacleKey = "";

  constructor(canvas: HTMLCanvasElement) {
    this.bundle = createScene(canvas);
    this.controls = new OrbitControls(this.bundle.camera, this.bundle.renderer.domElement);
    this.labelOverlay = createLabelOverlay(canvas);

    this.controls.enableDamping = false;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 4.2;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    const initialFrame = startCameraFrame(this.track);
    this.bundle.camera.position.copy(initialFrame.position);
    this.controls.target.copy(initialFrame.target);
    this.desiredFollowTarget.copy(initialFrame.target);
    this.currentFollowTarget.copy(initialFrame.target);

    this.bundle.scene.add(this.trackGroup, this.raceGroup);
    this.animate = this.animate.bind(this);
    this.observeResize(canvas);
    this.animate();
  }

  getState(): LiveRenderState {
    return this.state;
  }

  setLiveTick(callback: LiveTickCallback | null): void {
    this.liveTick = callback;
  }

  setFocusedBall(ballId: string): void {
    this.manualFollowBallId = ballId;
    this.followedBallId = ballId;
    this.hasLiveFollowTarget = false;
  }

  clearFocusedBall(): void {
    this.manualFollowBallId = "";
    this.followedBallId = "";
    this.hasLiveFollowTarget = false;
  }

  loadTrackOptions(
    options: Array<PickerOption | RaceBall>,
    track: TrackDefinition,
    resetCamera = true,
  ): void {
    const cameraOffset = this.bundle.camera.position.clone().sub(this.controls.target);
    const previousStartYaw = this.track.start.yaw;
    this.setTrack(track);
    this.state = "idle";
    this.placements = [];
    this.lastCollectedPowerupKey = "";
    this.lastDestroyedObstacleKey = "";
    this.hasLiveFollowTarget = false;
    this.followedBallId = "";
    this.manualFollowBallId = "";
    this.options = options.map((option) => ({ ...option }));
    this.clearRaceGroup();

    this.marbles = createMarbleMeshes(
      options,
      this.bundle.renderer.capabilities.getMaxAnisotropy(),
    );

    this.createOverlayLabels(options);

    const orderedOptions = [...options].sort((a, b) => a.id.localeCompare(b.id));

    for (const [index, option] of orderedOptions.entries()) {
      const marble = this.marbles.get(option.id);

      if (!marble) {
        continue;
      }

      marble.group.position.copy(startingMarblePosition(index, orderedOptions.length, this.track));
      marble.sphere.quaternion.identity();
      this.raceGroup.add(marble.group);
    }

    updateDynamicTrackMeshes(this.trackGroup, 0);

    if (resetCamera) {
      this.resetCamera();
    } else {
      this.retargetCameraToStart(cameraOffset, previousStartYaw);
    }

    this.updateOverlayLabels();
  }

  loadOptions(
    options: Array<PickerOption | RaceBall>,
    trackSeed = PREVIEW_TRACK_SEED,
    resetCamera = true,
  ): void {
    this.loadTrackOptions(options, generateTrack(trackSeed), resetCamera);
  }

  showLiveFrame(result: RaceResult, frame: RaceFrame): void {
    this.placements = result.placements;
    this.setTrack(result.track);
    this.state = "live";
    this.applyFrame(result, frame);
  }

  pauseLive(): void {
    if (this.state === "live") {
      this.state = "paused";
    }
  }

  resumeLive(): void {
    if (this.state === "paused") {
      this.state = "live";
    }
  }

  finishLive(result: RaceResult, frame: RaceFrame): void {
    this.placements = result.placements;
    this.state = "finished";
    this.applyFrame(result, frame);
  }

  reset(): void {
    this.state = "idle";
    this.placements = [];
    updateDynamicTrackMeshes(this.trackGroup, 0);
    this.resetMarblesToStart();
    this.resetCamera();
    this.updateOverlayLabels();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.bundle.renderer.dispose();
    this.labelOverlay.remove();
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(this.animate);
    const deltaSeconds = Math.min(this.clock.getDelta(), 0.06);

    this.liveTick?.(deltaSeconds);
    this.updateFollowCamera(deltaSeconds);
    this.controls.update();
    this.updateOverlayLabels();
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
  }

  private applyFrame(result: RaceResult, frame: RaceFrame): void {
    updateDynamicTrackMeshes(this.trackGroup, frame.time);

    const collectedPowerupKey = (frame.collectedPowerupIds ?? []).join("|");
    if (collectedPowerupKey !== this.lastCollectedPowerupKey) {
      this.lastCollectedPowerupKey = collectedPowerupKey;
      setCollectedPowerupsVisible(this.trackGroup, frame.collectedPowerupIds ?? []);
    }

    const destroyedObstacleKey = (frame.destroyedObstacleIds ?? []).join("|");
    if (destroyedObstacleKey !== this.lastDestroyedObstacleKey) {
      this.lastDestroyedObstacleKey = destroyedObstacleKey;
      setDestroyedObstaclesVisible(this.trackGroup, frame.destroyedObstacleIds ?? []);
    }

    const finishedAt = new Map(result.placements.map((placement) => [placement.ballId, placement.time]));
    const disqualifiedIds = new Set(result.disqualifications.map((disqualification) => disqualification.ballId));
    const rotationAlpha = 1 - Math.exp(-frame.time / ROTATION_SMOOTHING_SECONDS);

    let leaderPosition: Vector3 | null = null;
    let leaderProgress = Number.NEGATIVE_INFINITY;
    let leaderId = "";
    let followedPosition: Vector3 | null = null;
    let followedProgress = Number.NEGATIVE_INFINITY;
    let manualPosition: Vector3 | null = null;

    for (const ball of frame.balls) {
      const marble = this.marbles.get(ball.id);

      if (!marble) {
        continue;
      }

      marble.group.position.set(ball.position.x, ball.position.y, ball.position.z);
      this.applyPowerupVisuals(marble, ball.activePowerups ?? []);
      this.updateMarbleLabelText(ball.id, ball.activePowerups ?? []);

      this.targetRotation.set(ball.rotation.x, ball.rotation.y, ball.rotation.z, ball.rotation.w);

      if (frame.time <= 0) {
        marble.sphere.quaternion.copy(this.targetRotation);
      } else {
        marble.sphere.quaternion.slerp(this.targetRotation, Math.max(0.08, Math.min(1, rotationAlpha)));
      }

      const progress = ball.displayProgress ?? ball.physicalProgress ?? progressForPosition(this.track, marble.group.position);
      const finishTime = finishedAt.get(ball.id);
      const isDisqualified = disqualifiedIds.has(ball.id);
      const shouldLeaveCamera = finishTime !== undefined && frame.time > finishTime + FINISHED_CAMERA_GRACE_SECONDS;
      const isOffscreenFall = ball.position.y < -18;
      const progressIsCredible = ball.isRaceProgressCredible ?? true;
      const eligible = progressIsCredible && !isDisqualified && !shouldLeaveCamera && !isOffscreenFall;

      if (
        eligible &&
        (progress > leaderProgress ||
          (progress === leaderProgress && ball.id.localeCompare(leaderId) < 0))
      ) {
        leaderProgress = progress;
        leaderId = ball.id;
        leaderPosition = marble.group.position;
      }

      if (eligible && ball.id === this.followedBallId) {
        followedProgress = progress;
        followedPosition = marble.group.position;
      }

      if (ball.id === this.manualFollowBallId) {
        manualPosition = marble.group.position;
      }
    }

    if (manualPosition || leaderPosition) {
      const shouldSwitchLeader =
        !this.manualFollowBallId &&
        Boolean(leaderPosition) &&
        (!followedPosition ||
          !this.followedBallId ||
          leaderProgress > followedProgress + LEADER_SWITCH_PROGRESS_MARGIN);

      const target = manualPosition ?? (shouldSwitchLeader || !followedPosition ? leaderPosition : followedPosition);

      if (!target) {
        return;
      }

      if (manualPosition) {
        this.followedBallId = this.manualFollowBallId;
      } else if (shouldSwitchLeader) {
        this.followedBallId = leaderId;
      }

      if (!this.hasLiveFollowTarget) {
        this.currentFollowTarget.copy(this.controls.target);
      }

      this.desiredFollowTarget.set(target.x, target.y + 0.75, target.z);
      this.hasLiveFollowTarget = true;
    }

  }

  private updateFollowCamera(deltaSeconds: number): void {
    if (this.state !== "live" || !this.hasLiveFollowTarget) {
      return;
    }

    this.cameraTargetDelta.copy(this.controls.target);
    const alpha = 1 - Math.exp(-deltaSeconds / CAMERA_FOLLOW_SECONDS);

    this.currentFollowTarget.lerp(this.desiredFollowTarget, alpha);
    this.controls.target.copy(this.currentFollowTarget);
    this.cameraTargetDelta.sub(this.controls.target).multiplyScalar(-1);
    this.bundle.camera.position.add(this.cameraTargetDelta);
  }

  private applyPowerupVisuals(marble: MarbleMesh, activePowerups: string[]): void {
    const effects = new Set(activePowerups);
    const scale = effects.has("giant") ? 1.55 : effects.has("tiny") ? 0.58 : 1;

    marble.group.scale.setScalar(scale);

    const material = Array.isArray(marble.sphere.material) ? marble.sphere.material[0] : marble.sphere.material;
    if ("opacity" in material) {
      material.transparent = effects.has("ghost");
      material.opacity = effects.has("ghost") ? 0.38 : 1;
    }

    if (material instanceof MeshStandardMaterial) {
      material.emissive.set(0x000000);
      material.emissiveIntensity = 0;
    }
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      resizeScene(this.bundle, rect?.width ?? canvas.clientWidth, rect?.height ?? canvas.clientHeight);
      this.updateOverlayLabels();
    };

    resize();
    new ResizeObserver(resize).observe(canvas.parentElement ?? canvas);
  }

  private resetMarblesToStart(): void {
    const orderedOptions = [...this.options].sort((a, b) => a.id.localeCompare(b.id));

    for (const [index, option] of orderedOptions.entries()) {
      const marble = this.marbles.get(option.id);

      if (!marble) {
        continue;
      }

      marble.group.position.copy(startingMarblePosition(index, orderedOptions.length, this.track));
      marble.sphere.quaternion.identity();
    }
  }

  private resetCamera(): void {
    const frame = startCameraFrame(this.track);

    this.bundle.camera.position.copy(frame.position);
    this.controls.target.copy(frame.target);
    this.desiredFollowTarget.copy(frame.target);
    this.currentFollowTarget.copy(frame.target);
    this.hasLiveFollowTarget = false;
    this.followedBallId = "";
    this.manualFollowBallId = "";
    this.controls.update();
  }

  private clearRaceGroup(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();

    this.raceGroup.traverse((object) => {
      const mesh = object as { geometry?: BufferGeometry; material?: Material | Material[] };

      if (mesh.geometry) {
        geometries.add(mesh.geometry);
      }

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => materials.add(material));
      } else if (mesh.material) {
        materials.add(mesh.material);
      }
    });

    this.raceGroup.clear();
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
  }

  private retargetCameraToStart(cameraOffset: Vector3, previousStartYaw: number): void {
    const frame = startCameraFrame(this.track);
    const yawDelta = this.track.start.yaw - previousStartYaw;
    const rotatedOffset = cameraOffset.clone().applyAxisAngle(new Vector3(0, 1, 0), yawDelta);

    this.controls.target.copy(frame.target);
    this.bundle.camera.position.copy(frame.target).add(rotatedOffset);
    this.desiredFollowTarget.copy(frame.target);
    this.currentFollowTarget.copy(frame.target);
    this.hasLiveFollowTarget = false;
    this.followedBallId = "";
    this.manualFollowBallId = "";
    this.controls.update();
  }

  private setTrack(track?: TrackDefinition): void {
    if (!track) {
      return;
    }

    if (track === this.track) {
      return;
    }

    const nextSignature = trackRenderSignature(track);

    if (nextSignature === this.trackRenderSignature) {
      return;
    }

    this.bundle.scene.remove(this.trackGroup);
    this.track = track;
    this.trackRenderSignature = nextSignature;
    this.trackGroup = createTrackMeshes(track);
    this.bundle.scene.add(this.trackGroup);
  }

  private createOverlayLabels(options: Array<PickerOption | RaceBall>): void {
    this.labelOverlay.replaceChildren();
    this.labelElements.clear();
    this.labelBaseTexts.clear();
    this.labelRenderedTexts.clear();

    for (const option of options) {
      const labelText = option.label.trim();

      if (!labelText) {
        continue;
      }

      const label = document.createElement("div");
      label.textContent = labelText;
      label.dataset.ballLabel = option.id;

      label.style.position = "absolute";
      label.style.left = "0";
      label.style.top = "0";
      label.style.maxWidth = "190px";
      label.style.padding = "3px 7px";
      label.style.border = `1px solid ${option.color ?? "#8fa1b2"}`;
      label.style.borderRadius = "999px";
      label.style.background = "rgba(12, 17, 23, 0.82)";
      label.style.color = "#f8fbff";
      label.style.font = "700 12px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      label.style.lineHeight = "17px";
      label.style.whiteSpace = "nowrap";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.textShadow = "0 1px 2px rgba(0, 0, 0, 0.85)";
      label.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.24)";
      label.style.pointerEvents = "none";
      label.style.userSelect = "none";
      label.style.willChange = "transform";
      label.style.backfaceVisibility = "hidden";
      label.style.transform = "translate(-9999px, -9999px)";

      this.labelOverlay.append(label);
      this.labelElements.set(option.id, label);
      this.labelBaseTexts.set(option.id, labelText);
      this.labelRenderedTexts.set(option.id, labelText);
    }
  }

  private updateMarbleLabelText(id: string, activePowerups: string[]): void {
    const element = this.labelElements.get(id);
    const baseText = this.labelBaseTexts.get(id);

    if (!element || !baseText) {
      return;
    }

    const effects = activePowerups.filter(Boolean);
    const nextText = effects.length > 0
      ? `${baseText} [${effects.map(formatPowerupName).join(", ")}]`
      : baseText;

    if (this.labelRenderedTexts.get(id) === nextText) {
      return;
    }

    element.textContent = nextText;
    this.labelRenderedTexts.set(id, nextText);
  }

  private updateOverlayLabels(): void {
    if (this.labelElements.size === 0) {
      return;
    }

    const canvas = this.bundle.renderer.domElement;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;

    for (const [id, element] of this.labelElements) {
      const marble = this.marbles.get(id);

      if (!marble) {
        element.style.display = "none";
        continue;
      }

      this.labelWorldPosition.copy(marble.group.position);
      this.labelWorldPosition.y += LABEL_WORLD_Y_OFFSET;

      if (this.labelWorldPosition.y < -18) {
        element.style.display = "none";
        continue;
      }

      this.labelScreenPosition.copy(this.labelWorldPosition).project(this.bundle.camera);

      const isOutsideClipSpace =
        this.labelScreenPosition.z < -1 ||
        this.labelScreenPosition.z > 1 ||
        this.labelScreenPosition.x < -1.18 ||
        this.labelScreenPosition.x > 1.18 ||
        this.labelScreenPosition.y < -1.18 ||
        this.labelScreenPosition.y > 1.18;

      if (isOutsideClipSpace) {
        element.style.display = "none";
        continue;
      }

      const x = Math.round((this.labelScreenPosition.x * 0.5 + 0.5) * width);
      const y = Math.round((-this.labelScreenPosition.y * 0.5 + 0.5) * height);

      element.style.display = "block";
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -112%)`;
    }
  }
}

function createLabelOverlay(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement ?? document.body;
  const computedPosition = globalThis.getComputedStyle(parent).position;

  if (computedPosition === "static") {
    parent.style.position = "relative";
  }

  const overlay = document.createElement("div");
  overlay.dataset.raceLabelOverlay = "true";

  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.overflow = "hidden";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "5";
  overlay.style.contain = "layout style paint";

  parent.append(overlay);

  return overlay;
}

function trackRenderSignature(track: TrackDefinition): string {
  const featureSignature = (feature: {
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
  }) => ({
    distance: roundSignatureNumber(feature.distance),
    offset: roundSignatureNumber(feature.offset ?? 0),
    routeId: feature.routeId ?? "main",
    routeOffset: roundSignatureNumber(feature.routeOffset ?? feature.offset ?? 0),
    mainOffset: roundSignatureNumber(feature.mainOffset ?? 0),
    x: roundSignatureNumber(feature.x ?? 0),
    y: roundSignatureNumber(feature.y ?? 0),
    z: roundSignatureNumber(feature.z ?? 0),
    yaw: roundSignatureNumber(feature.yaw ?? 0),
    width: roundSignatureNumber(feature.width ?? 0),
  });

  return JSON.stringify({
    seed: track.seed,
    totalLength: roundSignatureNumber(track.totalLength),
    finishDistance: roundSignatureNumber(track.finishDistance),
    splitSurfaces: track.splitSurfaces.map((surface) => ({
      startDistance: roundSignatureNumber(surface.startDistance),
      endDistance: roundSignatureNumber(surface.endDistance),
      vertices: surface.road.vertices.length,
      indices: surface.road.indices.length,
    })),
    pegs: track.features.pegs.map((peg) => ({
      ...featureSignature(peg),
      radius: roundSignatureNumber(peg.radius),
      phase: roundSignatureNumber(peg.phase),
    })),
    greenBumpers: track.features.greenBumpers.map((bumper) => ({
      ...featureSignature(bumper),
      radius: roundSignatureNumber(bumper.radius),
      phase: roundSignatureNumber((bumper as typeof bumper & { phase?: number }).phase ?? -1),
    })),
    gates: track.features.gates.map((gate) => ({
      ...featureSignature(gate),
      phase: roundSignatureNumber(gate.phase),
    })),
    trappers: track.features.trappers.map((trapper) => ({
      ...featureSignature(trapper),
      radius: roundSignatureNumber(trapper.radius),
      phase: roundSignatureNumber(trapper.phase),
    })),
    spinners: track.features.spinners.map((spinner) => ({
      ...featureSignature(spinner),
      phase: roundSignatureNumber(spinner.phase),
      speed: roundSignatureNumber(spinner.speed),
    })),
    hammers: track.features.hammers.map((hammer) => ({
      ...featureSignature(hammer),
      phase: roundSignatureNumber(hammer.phase),
      side: hammer.side,
    })),
    turnstiles: track.features.turnstiles.map((turnstile) => ({
      ...featureSignature(turnstile),
      phase: roundSignatureNumber(turnstile.phase),
      speed: roundSignatureNumber(turnstile.speed),
    })),
    powerups: track.features.powerups.map((powerup) => ({
      ...featureSignature(powerup),
      id: powerup.id,
      kind: powerup.kind,
    })),
  });
}

function formatPowerupName(powerup: string): string {
  if (powerup === "slow-source") {
    return "Slow";
  }

  if (powerup === "slow") {
    return "Slowed";
  }

  return powerup.charAt(0).toUpperCase() + powerup.slice(1);
}

function roundSignatureNumber(value: number): number {
  return Math.round(value * 100000) / 100000;
}


