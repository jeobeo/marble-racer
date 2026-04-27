export function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T {
  const validItems = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  const totalWeight = validItems.reduce((total, item) => total + item.weight, 0);

  if (validItems.length === 0 || totalWeight <= 0) {
    throw new Error("At least one option needs a positive weight.");
  }

  let cursor = rng() * totalWeight;

  for (const item of validItems) {
    cursor -= item.weight;
    if (cursor < 0) {
      return item;
    }
  }

  return validItems[validItems.length - 1];
}
