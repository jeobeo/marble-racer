import type { TrackDefinition } from "../shared/trackGenerator";
export type PickerOption = {
  id: string;
  label: string;
  weight: number;
  color?: string;
};

export type RaceBall = {
  id: string;
  optionId: string;
  label: string;
  weight: number;
  color?: string;
};

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type Quat = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type BallFrame = {
  id: string;
  position: Vec3;
  rotation: Quat;

  /**
   * Raw nearest-track progress from the physical ball position.
   * This can be misleading while a ball is falling off-course.
   */
  physicalProgress?: number;

   /**
    * Progress that is safe for UI standings and camera leadership.
   * This holds display progress steady while a ball is off-course and airborne, unless it regains contact
   * or remains in a plausible airborne-over-track corridor.
   */
  displayProgress?: number;

  /**
   * True when Rapier reports at least one contact pair for the ball.
   */
  hasContact?: boolean;

  /**
   * True when the ball's current progress is considered legitimate for display/camera.
   */
  isRaceProgressCredible?: boolean;
  activePowerups?: string[];
};

export type RaceFrame = {
  time: number;
  balls: BallFrame[];
  collectedPowerupIds?: string[];
  destroyedObstacleIds?: string[];
};

export type FinishPlacement = {
  id: string;
  optionId: string;
  ballId: string;
  place: number;
  time: number;
};

export type RaceDisqualification = {
  id: string;
  optionId: string;
  ballId: string;
  time: number;
  reason: string;
};

export type RaceResult = {
  seed: string;
  actualWinnerId: string;
  placements: FinishPlacement[];
  disqualifications: RaceDisqualification[];
  track: TrackDefinition;
  balls: RaceBall[];
  attempt: number;
};

export type RaceConfig = {
  seed: string;
  options: RaceBall[];
  attempt: number;

  /**
   * Runtime track used by both renderer and physics.
   * This lets Reset/new map seed generate obstacle timings before Start,
   * avoiding a visual timing jump when the race begins.
   */
  track?: TrackDefinition;
};
