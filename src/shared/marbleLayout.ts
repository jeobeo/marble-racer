export const DEFAULT_BALL_RADIUS = 0.34;
export const TRACK_WIDTH = 4.4;

const EDGE_CLEARANCE = 0.32;
const DESIRED_GAP = 0.18;
const MIN_GAP_RATIO = 0.25;

export type StartLayout = {
  radius: number;
  spacing: number;
  laneOffsets: number[];
};

export function createStartLayout(count: number): StartLayout {
  const safeCount = Math.max(1, count);
  const usableWidth = Math.max(0.1, TRACK_WIDTH - EDGE_CLEARANCE * 2);
  const desiredSpacing = DEFAULT_BALL_RADIUS * 2 + DESIRED_GAP;
  const desiredTotalWidth = DEFAULT_BALL_RADIUS * 2 + desiredSpacing * (safeCount - 1);

  if (desiredTotalWidth <= usableWidth) {
    return {
      radius: DEFAULT_BALL_RADIUS,
      spacing: desiredSpacing,
      laneOffsets: createOffsets(safeCount, desiredSpacing),
    };
  }

  const radius = usableWidth / (2 * safeCount + MIN_GAP_RATIO * (safeCount - 1));
  const spacing = radius * (2 + MIN_GAP_RATIO);

  return {
    radius,
    spacing,
    laneOffsets: createOffsets(safeCount, spacing),
  };
}

function createOffsets(count: number, spacing: number): number[] {
  const centerOffset = (count - 1) / 2;
  return Array.from({ length: count }, (_value, index) => (index - centerOffset) * spacing);
}
