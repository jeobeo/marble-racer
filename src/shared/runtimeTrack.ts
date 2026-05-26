import { createSeededRng } from "../simulation/rng";
import type { TrackDefinition } from "./trackGenerator";

const PEG_MOTION_PERIOD = 8;
const GATE_MOTION_PERIOD = 20;
const TRAPPER_MOTION_PERIOD = 18;
const FULL_ROTATION = Math.PI * 2;

export function randomizeObstacleRuntimeState(track: TrackDefinition, runtimeSeed: string): TrackDefinition {
  const rng = createSeededRng(`${runtimeSeed}:obstacle-runtime`);

  return {
    ...track,
    features: {
      ...track.features,
      pegs: track.features.pegs.map((peg) => ({
        ...peg,
        phase: rng() * PEG_MOTION_PERIOD,
      })),
      greenBumpers: track.features.greenBumpers.map((bumper) => ({
        ...bumper,
        phase: rng() * PEG_MOTION_PERIOD,
      })) as TrackDefinition["features"]["greenBumpers"],
      gates: track.features.gates.map((gate) => ({
        ...gate,
        phase: rng() * GATE_MOTION_PERIOD,
      })),
      trappers: track.features.trappers.map((trapper) => ({
        ...trapper,
        phase: rng() * TRAPPER_MOTION_PERIOD,
      })),
      spinners: track.features.spinners.map((spinner) => ({
        ...spinner,
        phase: rng() * FULL_ROTATION,
      })),
      hammers: track.features.hammers.map((hammer) => ({
        ...hammer,
        phase: rng() * FULL_ROTATION,
      })),
      turnstiles: track.features.turnstiles.map((turnstile) => ({
        ...turnstile,
        phase: rng() * FULL_ROTATION,
      })),
    },
  };
}

export function showObstacleRuntimeState(track: TrackDefinition): TrackDefinition {
  return {
    ...track,
    features: {
      ...track.features,
      pegs: track.features.pegs.map((peg) => ({
        ...peg,
        phase: 0,
      })),
      greenBumpers: track.features.greenBumpers.map((bumper) => ({
        ...bumper,
        phase: 0,
      })) as TrackDefinition["features"]["greenBumpers"],
      gates: track.features.gates.map((gate) => ({
        ...gate,
        phase: 0,
      })),
      trappers: track.features.trappers.map((trapper) => ({
        ...trapper,
        phase: 0,
      })),
      spinners: track.features.spinners.map((spinner) => ({
        ...spinner,
        phase: 0,
      })),
      hammers: track.features.hammers.map((hammer) => ({
        ...hammer,
        phase: 0,
      })),
      turnstiles: track.features.turnstiles.map((turnstile) => ({
        ...turnstile,
        phase: 0,
      })),
    },
  };
}
