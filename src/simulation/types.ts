import type { TrackDefinition } from "../shared/trackGenerator";

export type PickerOption = {
  id: string;
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
};

export type RaceFrame = {
  time: number;
  balls: BallFrame[];
};

export type FinishPlacement = {
  id: string;
  place: number;
  time: number;
};

export type RaceResult = {
  seed: string;
  intendedWinnerId: string;
  actualWinnerId: string;
  placements: FinishPlacement[];
  track: TrackDefinition;
  frames: RaceFrame[];
  attempt: number;
};

export type RaceConfig = {
  seed: string;
  options: PickerOption[];
  intendedWinnerId: string;
  attempt: number;
  recordFrames?: boolean;
};

export type PreparedRace = {
  pickerSeed: string;
  raceSeed: string;
  intendedWinnerId: string;
  result: RaceResult;
};
