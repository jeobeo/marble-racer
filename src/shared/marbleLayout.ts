export const DEFAULT_BALL_RADIUS = 0.34;
export const TRACK_WIDTH = 4.4;

const BALLS_PER_START_ROW = 5;
const LATERAL_GAP = 0.18;
const FORWARD_GAP = 0.28;

export type StartLayout = {
  radius: number;
  lateralSpacing: number;
  forwardSpacing: number;
  laneOffsets: number[];
  forwardOffsets: number[];
};

export function createStartLayout(count: number): StartLayout {
  const safeCount = Math.max(1, count);
  const lateralSpacing = DEFAULT_BALL_RADIUS * 2 + LATERAL_GAP;
  const forwardSpacing = DEFAULT_BALL_RADIUS * 2 + FORWARD_GAP;
  const laneOffsets: number[] = [];
  const forwardOffsets: number[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    const row = Math.floor(index / BALLS_PER_START_ROW);
    const column = index % BALLS_PER_START_ROW;
    const ballsInThisRow = Math.min(BALLS_PER_START_ROW, safeCount - row * BALLS_PER_START_ROW);
    const centerOffset = (ballsInThisRow - 1) / 2;

    laneOffsets.push((column - centerOffset) * lateralSpacing);
    forwardOffsets.push(row * forwardSpacing);
  }

  return {
    radius: DEFAULT_BALL_RADIUS,
    lateralSpacing,
    forwardSpacing,
    laneOffsets,
    forwardOffsets,
  };
}
