import { Clock, Group, MeshStandardMaterial, Quaternion, Vector3 } from "three";
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
  private liveTick: LiveTickCallback | null = null;
  private readonly labelWorldPosition = new Vector3();
  private readonly labelScreenPosition = new Vector3();
  private readonly targetRotation = new Quaternion();

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
    this.hasLiveFollowTarget = false;
    this.followedBallId = "";
    this.options = options.map((option) => ({ ...option }));
    this.raceGroup.clear();

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
    const deltaSeconds = this.clock.getDelta();

    this.liveTick?.(deltaSeconds);
    this.updateFollowCamera(deltaSeconds);
    this.controls.update();
    this.updateOverlayLabels();
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
  }

  private applyFrame(result: RaceResult, frame: RaceFrame): void {
    updateDynamicTrackMeshes(this.trackGroup, frame.time);
    setCollectedPowerupsVisible(this.trackGroup, frame.collectedPowerupIds ?? []);
    setDestroyedObstaclesVisible(this.trackGroup, frame.destroyedObstacleIds ?? []);

    const finishedAt = new Map(result.placements.map((placement) => [placement.ballId, placement.time]));
    const disqualifiedIds = new Set(result.disqualifications.map((disqualification) => disqualification.ballId));
    const rotationAlpha = 1 - Math.exp(-frame.time / ROTATION_SMOOTHING_SECONDS);

    let leaderPosition: Vector3 | null = null;
    let leaderProgress = Number.NEGATIVE_INFINITY;
    let leaderId = "";
    let followedPosition: Vector3 | null = null;
    let followedProgress = Number.NEGATIVE_INFINITY;

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
    }

    if (leaderPosition) {
      const shouldSwitchLeader =
        !followedPosition ||
        !this.followedBallId ||
        leaderProgress > followedProgress + LEADER_SWITCH_PROGRESS_MARGIN;

      const target = shouldSwitchLeader || !followedPosition ? leaderPosition : followedPosition;

      if (shouldSwitchLeader) {
        this.followedBallId = leaderId;
      }

      if (!this.hasLiveFollowTarget) {
        this.currentFollowTarget.copy(this.controls.target);
      }

      this.desiredFollowTarget.set(target.x, target.y + 0.75, target.z);
      this.hasLiveFollowTarget = true;
    }

    this.updateOverlayLabels();
  }

  private updateFollowCamera(deltaSeconds: number): void {
    if (this.state !== "live" || !this.hasLiveFollowTarget) {
      return;
    }

    const previousTarget = this.controls.target.clone();
    const alpha = 1 - Math.exp(-deltaSeconds / CAMERA_FOLLOW_SECONDS);

    this.currentFollowTarget.lerp(this.desiredFollowTarget, alpha);
    this.controls.target.copy(this.currentFollowTarget);
    this.bundle.camera.position.add(this.controls.target.clone().sub(previousTarget));
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
    this.controls.update();
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
    this.controls.update();
  }

  private setTrack(track?: TrackDefinition): void {
    if (!track) {
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
  return JSON.stringify({
    seed: track.seed,
    pegs: track.features.pegs.map((peg) => ({
      distance: roundSignatureNumber(peg.distance),
      offset: roundSignatureNumber(peg.offset),
      radius: roundSignatureNumber(peg.radius),
      phase: roundSignatureNumber(peg.phase),
    })),
    greenBumpers: track.features.greenBumpers.map((bumper) => ({
      distance: roundSignatureNumber(bumper.distance),
      offset: roundSignatureNumber(bumper.offset),
      radius: roundSignatureNumber(bumper.radius),
      phase: roundSignatureNumber((bumper as typeof bumper & { phase?: number }).phase ?? -1),
    })),
    gates: track.features.gates.map((gate) => ({
      distance: roundSignatureNumber(gate.distance),
      phase: roundSignatureNumber(gate.phase),
    })),
    spinners: track.features.spinners.map((spinner) => ({
      distance: roundSignatureNumber(spinner.distance),
      phase: roundSignatureNumber(spinner.phase),
      speed: roundSignatureNumber(spinner.speed),
    })),
    hammers: track.features.hammers.map((hammer) => ({
      distance: roundSignatureNumber(hammer.distance),
      phase: roundSignatureNumber(hammer.phase),
      side: hammer.side,
    })),
    turnstiles: track.features.turnstiles.map((turnstile) => ({
      distance: roundSignatureNumber(turnstile.distance),
      phase: roundSignatureNumber(turnstile.phase),
      speed: roundSignatureNumber(turnstile.speed),
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
