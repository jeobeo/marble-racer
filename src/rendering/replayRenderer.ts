import { Clock, Group, Quaternion, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMarbleMeshes, type MarbleMesh } from "./marbleMeshes";
import { createScene, resizeScene, type SceneBundle } from "./scene";
import { PREVIEW_TRACK_SEED, createTrackMeshes, startCameraFrame, startingMarblePosition, trackFocusForZ } from "./trackMeshes";
import type { FinishPlacement, PickerOption, RaceFrame, RaceResult } from "../simulation/types";
import { type TrackDefinition, generateTrack, progressForPosition } from "../shared/trackGenerator";

export type ReplayState = "idle" | "playing" | "finished";

export class ReplayRenderer {
  private readonly bundle: SceneBundle;
  private readonly raceGroup = new Group();
  private readonly clock = new Clock();
  private readonly controls: OrbitControls;
  private track = generateTrack(PREVIEW_TRACK_SEED);
  private trackGroup = createTrackMeshes(this.track);
  private marbles = new Map<string, MarbleMesh>();
  private smoothedMarblePositions = new Map<string, Vector3>();
  private options: PickerOption[] = [];
  private frames: RaceFrame[] = [];
  private placements: FinishPlacement[] = [];
  private elapsed = 0;
  private speed = 1;
  private state: ReplayState = "idle";
  private animationId = 0;
  private onFinish: (() => void) | null = null;
  private onProgress: ((time: number, placements: FinishPlacement[]) => void) | null = null;
  private userMovedCamera = false;
  private cameraLeadProgress = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.bundle = createScene(canvas);
    this.controls = new OrbitControls(this.bundle.camera, this.bundle.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    const initialFrame = startCameraFrame(this.track);
    this.bundle.camera.position.copy(initialFrame.position);
    this.controls.target.copy(initialFrame.target);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 38;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.addEventListener("start", () => {
      this.userMovedCamera = true;
    });
    this.bundle.scene.add(this.trackGroup, this.raceGroup);
    this.animate = this.animate.bind(this);
    this.observeResize(canvas);
    this.animate();
  }

  loadOptions(options: PickerOption[], previewSeed = PREVIEW_TRACK_SEED): void {
    this.setTrack(generateTrack(`${previewSeed}:preview`));
    this.state = "idle";
    this.elapsed = 0;
    this.frames = [];
    this.placements = [];
    this.onFinish = null;
    this.onProgress = null;
    this.options = options.map((option) => ({ ...option }));
    this.raceGroup.clear();
    this.smoothedMarblePositions.clear();
    this.marbles = createMarbleMeshes(options);
    const orderedOptions = [...options].sort((a, b) => a.id.localeCompare(b.id));

    for (const [index, option] of orderedOptions.entries()) {
      const marble = this.marbles.get(option.id);
      if (!marble) {
        continue;
      }
      marble.group.position.copy(startingMarblePosition(index, orderedOptions.length, this.track));
      this.smoothedMarblePositions.set(option.id, marble.group.position.clone());
      marble.sphere.quaternion.identity();
      this.raceGroup.add(marble.group);
    }
    this.userMovedCamera = false;
    this.resetCamera();
  }

  play(
    result: RaceResult,
    speed: number,
    onFinish: () => void,
    onProgress?: (time: number, placements: FinishPlacement[]) => void,
  ): void {
    this.frames = result.frames;
    this.placements = result.placements;
    this.setTrack(result.track);
    this.elapsed = 0;
    this.speed = speed;
    this.state = "playing";
    this.cameraLeadProgress = 0;
    this.smoothedMarblePositions.clear();
    this.onFinish = onFinish;
    this.onProgress = onProgress ?? null;
    this.clock.getDelta();
    this.applyFrame(this.frames[0], this.frames[0]);
    this.onProgress?.(0, result.placements.filter((placement) => placement.time <= 0));
  }

  cue(result: RaceResult): void {
    this.frames = result.frames;
    this.placements = result.placements;
    this.setTrack(result.track);
    this.elapsed = 0;
    this.state = "idle";
    this.cameraLeadProgress = 0;
    this.smoothedMarblePositions.clear();
    this.onFinish = null;
    this.onProgress = null;

    if (this.frames.length > 0) {
      this.applyFrame(this.frames[0], this.frames[0]);
    }
  }

  reset(): void {
    this.state = "idle";
    this.elapsed = 0;
    this.frames = [];
    this.placements = [];
    this.cameraLeadProgress = 0;
    this.smoothedMarblePositions.clear();
    this.onFinish = null;
    this.onProgress = null;
    this.userMovedCamera = false;
    this.resetMarblesToStart();
    this.resetCamera();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.bundle.renderer.dispose();
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(this.animate);

    if (this.state === "playing" && this.frames.length > 1) {
      this.elapsed += this.clock.getDelta() * this.speed;
      this.applyReplayTime(this.elapsed);
    } else {
      this.clock.getDelta();
    }

    this.controls.update();
    this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
  }

  private applyReplayTime(time: number): void {
    const lastFrame = this.frames[this.frames.length - 1];

    if (time >= lastFrame.time) {
      this.applyFrame(lastFrame, lastFrame);
      this.state = "finished";
      this.onProgress?.(lastFrame.time, this.getVisiblePlacements(lastFrame.time));
      this.onFinish?.();
      this.onFinish = null;
      this.onProgress = null;
      return;
    }

    let frameIndex = 0;
    while (frameIndex < this.frames.length - 2 && this.frames[frameIndex + 1].time < time) {
      frameIndex += 1;
    }

    const current = this.frames[frameIndex];
    const next = this.frames[frameIndex + 1];
    const span = Math.max(next.time - current.time, 0.0001);
    const alpha = (time - current.time) / span;
    this.applyFrame(current, next, alpha);
    this.onProgress?.(time, this.getVisiblePlacements(time));
  }

  private applyFrame(current: RaceFrame, next: RaceFrame, alpha = 0): void {
    let leadZ = 0;

    for (const ball of current.balls) {
      const nextBall = next.balls.find((candidate) => candidate.id === ball.id) ?? ball;
      const marble = this.marbles.get(ball.id);

      if (!marble) {
        continue;
      }

      const fromPosition = new Vector3(ball.position.x, ball.position.y, ball.position.z);
      const toPosition = new Vector3(nextBall.position.x, nextBall.position.y, nextBall.position.z);
      const fromRotation = new Quaternion(ball.rotation.x, ball.rotation.y, ball.rotation.z, ball.rotation.w);
      const toRotation = new Quaternion(nextBall.rotation.x, nextBall.rotation.y, nextBall.rotation.z, nextBall.rotation.w);
      const rawPosition = fromPosition.lerp(toPosition, alpha);
      const smoothedPosition = this.smoothedMarblePositions.get(ball.id);

      if (smoothedPosition && current !== next) {
        const blend = smoothedPosition.distanceTo(rawPosition) > 0.75 ? 0.9 : 0.55;
        smoothedPosition.lerp(rawPosition, blend);
        marble.group.position.copy(smoothedPosition);
      } else {
        marble.group.position.copy(rawPosition);
        this.smoothedMarblePositions.set(ball.id, rawPosition.clone());
      }

      marble.sphere.quaternion.copy(fromRotation.slerp(toRotation, alpha));
      leadZ = Math.max(leadZ, progressForPosition(this.track, marble.group.position));
    }

    this.cameraLeadProgress = Math.max(this.cameraLeadProgress, leadZ);
    const focus = trackFocusForZ(this.track, this.cameraLeadProgress);
    const previousTarget = this.controls.target.clone();
    this.controls.target.lerp(focus, 0.018);
    this.bundle.camera.position.add(this.controls.target.clone().sub(previousTarget));
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      resizeScene(this.bundle, rect?.width ?? canvas.clientWidth, rect?.height ?? canvas.clientHeight);
    };

    resize();
    new ResizeObserver(resize).observe(canvas.parentElement ?? canvas);
  }

  private getVisiblePlacements(time: number): FinishPlacement[] {
    const lastFrame = this.frames[this.frames.length - 1];
    const raceTime = Math.min(time, lastFrame?.time ?? time);
    return this.placements.filter((placement) => placement.time <= raceTime);
  }

  private resetMarblesToStart(): void {
    const orderedOptions = [...this.options].sort((a, b) => a.id.localeCompare(b.id));

    for (const [index, option] of orderedOptions.entries()) {
      const marble = this.marbles.get(option.id);
      if (!marble) {
        continue;
      }

      marble.group.position.copy(startingMarblePosition(index, orderedOptions.length, this.track));
      this.smoothedMarblePositions.set(option.id, marble.group.position.clone());
      marble.sphere.quaternion.identity();
    }
  }

  private resetCamera(): void {
    const frame = startCameraFrame(this.track);
    this.bundle.camera.position.copy(frame.position);
    this.controls.target.copy(frame.target);
    this.controls.update();
  }

  private setTrack(track?: TrackDefinition): void {
    if (!track || track.seed === this.track.seed) {
      return;
    }

    this.bundle.scene.remove(this.trackGroup);
    this.track = track;
    this.trackGroup = createTrackMeshes(track);
    this.bundle.scene.add(this.trackGroup);
  }
}
