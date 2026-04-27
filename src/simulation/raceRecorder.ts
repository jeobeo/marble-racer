import type RAPIER from "@dimforge/rapier3d";
import type { BallFrame, RaceFrame } from "./types";

export type SimBall = {
  id: string;
  body: RAPIER.RigidBody;
};

export function recordFrame(balls: SimBall[], time: number): RaceFrame {
  return {
    time,
    balls: balls.map<BallFrame>((ball) => {
      const position = ball.body.translation();
      const rotation = ball.body.rotation();

      return {
        id: ball.id,
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      };
    }),
  };
}
