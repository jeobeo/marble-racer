import { ReplayRenderer } from "../rendering/replayRenderer";
import { createSeededRng, createSeed } from "../simulation/rng";
import { prepareRapier, simulateRace } from "../simulation/raceSimulator";
import type { PickerOption, RaceResult } from "../simulation/types";
import { weightedPick } from "../simulation/weightedPick";
import { ControlsUi, type ControlsState, type SimulationProgress } from "../ui/controls";

const DEFAULT_OPTIONS: PickerOption[] = [
  { id: "red", label: "Option A", weight: 1, color: "#e84c4f" },
  { id: "blue", label: "Option B", weight: 1, color: "#4094f7" },
  { id: "green", label: "Option C", weight: 1, color: "#38b36b" },
];
const MAX_ATTEMPTS = 150;

type RaceControllerConfig = {
  controlsRoot: HTMLElement;
  canvas: HTMLCanvasElement;
  winnerBanner: HTMLElement;
};

export class RaceController {
  private readonly ui: ControlsUi;
  private readonly renderer: ReplayRenderer;
  private readonly winnerBanner: HTMLElement;
  private options = DEFAULT_OPTIONS;
  private seed = createSeed();
  private history: RaceResult[] = [];
  private rapierReady: Promise<void> | null = null;
  private generationAbort: AbortController | null = null;
  private preparedRace: RaceResult | null = null;

  constructor(config: RaceControllerConfig) {
    this.ui = new ControlsUi(config.controlsRoot, {
      onChange: (state) => this.applyState(state),
      onStart: () => void this.startRace(),
      onCancel: () => this.cancelGeneration(),
      onReset: () => this.resetRace(),
      onNewSeed: () => this.generateSeed(),
      onReplay: () => this.replayLastRace(),
    });
    this.renderer = new ReplayRenderer(config.canvas);
    this.winnerBanner = config.winnerBanner;
  }

  init(): void {
    this.ui.render({
      options: this.options,
      seed: this.seed,
      speed: 1,
      busy: false,
      hasPreparedRace: false,
      progress: null,
      history: this.history,
    });
    this.renderer.loadOptions(this.options, this.seed);
    this.setBanner("Configure options, then start a deterministic race.");
  }

  private applyState(state: ControlsState): void {
    this.preparedRace = null;
    this.options = state.options;
    this.seed = state.seed;
    this.renderer.loadOptions(this.options, this.seed);
    this.setBanner("Ready.");
  }

  private generateSeed(): void {
    this.preparedRace = null;
    this.seed = createSeed();
    this.ui.setSeed(this.seed);
    this.renderer.loadOptions(this.options, this.seed);
    this.setBanner("New seed ready.");
  }

  private resetRace(): void {
    this.renderer.reset();
    this.setBanner("Ready.");
  }

  private replayLastRace(): void {
    this.preparedRace = null;
    const result = this.history[0];
    const state = this.ui.getState();

    if (!result) {
      return;
    }

    this.renderer.loadOptions(this.options, this.seed);
    this.setBanner("Replaying the same recorded race.");
    this.renderer.play(
      result,
      state.speed,
      () => this.showPlacements(result, result.placements),
      (_time, placements) => this.showPlacements(result, placements),
    );
  }

  private async startRace(): Promise<void> {
    const state = this.ui.getState();

    if (this.preparedRace) {
      this.playPreparedRace(this.preparedRace, state.speed);
      return;
    }

    const options = sanitizeOptions(state.options);

    if (options.length < 2) {
      this.setBanner("Add at least two options.");
      return;
    }

    if (!options.some((option) => option.weight > 0)) {
      this.setBanner("At least one option needs a positive weight.");
      return;
    }

    this.preparedRace = null;
    this.options = options;
    this.seed = state.seed.trim() || createSeed();
    this.generationAbort?.abort();
    this.generationAbort = new AbortController();
    const signal = this.generationAbort.signal;
    this.ui.setBusy(true, this.progress("Preparing", "Loading physics engine...", 0, MAX_ATTEMPTS, 0));
    this.setBanner("Selecting weighted winner and pre-simulating race...");

    try {
      if (!this.rapierReady) {
        this.rapierReady = prepareRapier();
      }
      await this.rapierReady;

      const pickerRng = createSeededRng(`${this.seed}:picker`);
      const intendedWinner = weightedPick(options, pickerRng);
      const result = await this.findCompletingRace(intendedWinner.id, options, this.seed, signal);
      const winner = options.find((option) => option.id === result.actualWinnerId);

      if (signal.aborted) {
        return;
      }

      this.preparedRace = result;
      this.ui.render({
        options,
        seed: this.seed,
        speed: state.speed,
        busy: false,
        hasPreparedRace: true,
        progress: null,
        history: this.history,
      });
      this.renderer.loadOptions(options, this.seed);
      this.renderer.cue(result);
      this.setBanner(`Race found: ${winner?.label ?? result.actualWinnerId} is ready. Click Start Race.`);
    } catch (error) {
      this.ui.setBusy(false);
      this.setBanner(isAbortError(error) ? "Simulation cancelled." : error instanceof Error ? error.message : "Race generation failed.");
    } finally {
      if (this.generationAbort?.signal === signal) {
        this.generationAbort = null;
      }
    }
  }

  private async findCompletingRace(
    intendedWinnerId: string,
    options: PickerOption[],
    seed: string,
    signal: AbortSignal,
  ): Promise<RaceResult> {
    let bestResult: RaceResult | null = null;
    const physicalOptions = createPhysicalOptions(options.length);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      this.ui.setProgress(
        this.progress(
          "Searching replay",
          `Trying deterministic variant ${attempt + 1}. Best so far: ${bestResult?.placements.length ?? 0}/${physicalOptions.length} finishers.`,
          attempt + 1,
          MAX_ATTEMPTS,
          (attempt / MAX_ATTEMPTS) * 92,
        ),
      );

      const result = await simulateRace(
        {
          seed: `${seed}:race:${attempt}`,
          options: physicalOptions,
          intendedWinnerId,
          attempt,
          recordFrames: false,
        },
        {
          signal,
          yieldEverySteps: 24,
          onProgress: (elapsedSeconds) => {
            if (signal.aborted) {
              return;
            }
            this.ui.setProgress(
              this.progress(
                "Searching replay",
                `Variant ${attempt + 1}: simulated ${elapsedSeconds.toFixed(1)}s. Best so far: ${bestResult?.placements.length ?? 0}/${physicalOptions.length} finishers.`,
                attempt + 1,
                MAX_ATTEMPTS,
                ((attempt + Math.min(elapsedSeconds / 135, 1)) / MAX_ATTEMPTS) * 92,
              ),
            );
          },
        },
      );

      if (!bestResult || result.placements.length > bestResult.placements.length) {
        bestResult = result;
      }

      if (result.placements.length === physicalOptions.length) {
        this.ui.setProgress(
          this.progress("Recording replay", `Found a complete race on attempt ${attempt + 1}. Assigning the weighted winner and recording frames...`, attempt + 1, MAX_ATTEMPTS, 96),
        );
        const recordedResult = await simulateRace(
          {
            seed: `${seed}:race:${attempt}`,
            options: physicalOptions,
            intendedWinnerId,
            attempt,
            recordFrames: true,
          },
          {
            signal,
            yieldEverySteps: 24,
            onProgress: (elapsedSeconds) => {
              if (signal.aborted) {
                return;
              }
              this.ui.setProgress(
                this.progress("Recording replay", `Recording ${elapsedSeconds.toFixed(1)}s of marble motion...`, attempt + 1, MAX_ATTEMPTS, 96),
              );
            },
          },
        );
        return remapPhysicalRace(recordedResult, options, intendedWinnerId, `${seed}:mapping:${attempt}`);
      }

      await yieldToBrowser();
    }

    throw new Error("Could not complete the deterministic replay. Try fewer marbles or reduce option count.");
  }

  private cancelGeneration(): void {
    const controller = this.generationAbort;
    if (!controller || controller.signal.aborted) {
      return;
    }

    controller.abort();
    this.ui.setProgress(this.progress("Cancelling", "Stopping the active physics search...", 0, MAX_ATTEMPTS, 100));
    this.setBanner("Cancelling simulation...");
  }

  private progress(phase: string, detail: string, attempt: number, maxAttempts: number, percent: number): SimulationProgress {
    return { phase, detail, attempt, maxAttempts, percent };
  }

  private playPreparedRace(result: RaceResult, speed: number): void {
    this.preparedRace = null;
    this.history = [result, ...this.history].slice(0, 6);
    this.ui.render({
      options: this.options,
      seed: this.seed,
      speed,
      busy: false,
      hasPreparedRace: false,
      progress: null,
      history: this.history,
    });
    this.setBanner("Starting recorded race.");
    this.renderer.play(
      result,
      speed,
      () => this.showPlacements(result, result.placements),
      (_time, placements) => this.showPlacements(result, placements),
    );
  }

  private showPlacements(result: RaceResult, placements: RaceResult["placements"]): void {
    if (placements.length === 0) {
      return;
    }

    const lines = placements.map((placement) => {
      const option = this.options.find((candidate) => candidate.id === placement.id);
      const label = option?.label ?? placement.id;
      return placement.place === 1 ? `Winner: ${label}` : `${placement.place}: ${label}`;
    });

    if (placements.length < result.placements.length) {
      lines.push("...");
    }

    this.setBanner(lines.join("\n"));
  }

  private setBanner(message: string): void {
    this.winnerBanner.textContent = message;
  }
}

function sanitizeOptions(options: PickerOption[]): PickerOption[] {
  return options.map((option, index) => ({
    id: option.id || `option-${index + 1}`,
    label: option.label.trim() || `Option ${index + 1}`,
    weight: Number.isFinite(option.weight) ? Math.max(0, option.weight) : 0,
    color: option.color,
  }));
}

function createPhysicalOptions(count: number): PickerOption[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `physical-${index + 1}`,
    label: `Marble ${index + 1}`,
    weight: 1,
  }));
}

function remapPhysicalRace(result: RaceResult, options: PickerOption[], intendedWinnerId: string, seed: string): RaceResult {
  const winningPhysicalId = result.placements[0]?.id;
  if (!winningPhysicalId) {
    return result;
  }

  const idMap = createPhysicalIdMap(result, options, intendedWinnerId, winningPhysicalId, seed);

  return {
    ...result,
    intendedWinnerId,
    actualWinnerId: intendedWinnerId,
    placements: result.placements.map((placement) => ({
      ...placement,
      id: idMap.get(placement.id) ?? placement.id,
    })),
    frames: result.frames.map((frame) => ({
      ...frame,
      balls: frame.balls.map((ball) => ({
        ...ball,
        id: idMap.get(ball.id) ?? ball.id,
      })),
    })),
  };
}

function createPhysicalIdMap(
  result: RaceResult,
  options: PickerOption[],
  intendedWinnerId: string,
  winningPhysicalId: string,
  seed: string,
): Map<string, string> {
  const rng = createSeededRng(seed);
  const physicalIds = uniqueIds([
    ...result.placements.map((placement) => placement.id),
    ...result.frames.flatMap((frame) => frame.balls.map((ball) => ball.id)),
  ]);
  const remainingPhysicalIds = deterministicShuffle(
    physicalIds.filter((id) => id !== winningPhysicalId),
    rng,
  );
  const remainingOptionIds = deterministicShuffle(
    options.map((option) => option.id).filter((id) => id !== intendedWinnerId),
    rng,
  );
  const idMap = new Map<string, string>([[winningPhysicalId, intendedWinnerId]]);

  for (let index = 0; index < remainingPhysicalIds.length; index += 1) {
    const optionId = remainingOptionIds[index];
    if (optionId) {
      idMap.set(remainingPhysicalIds[index], optionId);
    }
  }

  return idMap;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function deterministicShuffle<T>(items: T[], rng: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Simulation cancelled.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
