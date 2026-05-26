import type RAPIER from "@dimforge/rapier3d";
import type { BallFrame, RaceFrame } from "./types";

export type SimBall = {
  id: string;
  optionId: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
};

export type BallFrameState = {
  physicalProgress: number;
  displayProgress: number;
  hasContact: boolean;
  isRaceProgressCredible: boolean;
  activePowerups?: BallFrame["activePowerups"];
};

export function recordFrame(
  balls: SimBall[],
  time: number,
  frameStateByBall = new Map<string, BallFrameState>(),
  collectedPowerupIds: string[] = [],
  destroyedObstacleIds: string[] = [],
): RaceFrame {
  return {
    time,
    balls: balls.map<BallFrame>((ball) => {
      const position = ball.body.translation();
      const rotation = ball.body.rotation();
      const state = frameStateByBall.get(ball.id);

      const frame: BallFrame = {
        id: ball.id,
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      };

      if (!state) {
        return frame;
      }

      return {
        ...frame,
        physicalProgress: state.physicalProgress,
        displayProgress: state.displayProgress,
        hasContact: state.hasContact,
        isRaceProgressCredible: state.isRaceProgressCredible,
        activePowerups: state.activePowerups,
      };
    }),
    collectedPowerupIds,
    destroyedObstacleIds,
  };
}
