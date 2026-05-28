import { LiveRenderer } from "../rendering/liveRenderer";
import { randomizeObstacleRuntimeState, showObstacleRuntimeState } from "../shared/runtimeTrack";
import { generateTrack, type TrackDefinition } from "../shared/trackGenerator";
import { createSeed } from "../simulation/rng";
import { createLiveRace, prepareRapier, type LiveRaceSimulation } from "../simulation/raceSimulator";
import type { PickerOption, RaceBall, RaceFrame, RaceResult } from "../simulation/types";
import { ControlsUi, type ControlsState, type RaceStanding, type SavedSetupSummary } from "../ui/controls";

const DEFAULT_OPTIONS: PickerOption[] = [
  { id: "red", label: "Option A", weight: 3, color: "#e84c4f" },
  { id: "blue", label: "Option B", weight: 1, color: "#4094f7" },
];

const MAX_RACE_BALLS = 50;
const PREVIEW_BALL_COLOR = "#8d96a3";
const PREVIEW_BALL_LABEL = "";
const MUSIC_MANIFEST_URL = "/music/manifest.json";
const SESSION_STORAGE_KEY = "marble-race-picker:current";
const SAVED_SETUPS_STORAGE_KEY = "marble-race-picker:saved-setups";
const STANDINGS_UPDATE_SECONDS = 0.2;
const SESSION_SAVE_DEBOUNCE_MS = 250;
const PREVIEW_TRACK_UPDATE_DEBOUNCE_MS = 220;

type SavedSetup = SavedSetupSummary & {
  setup: ControlsState;
  updatedAt: number;
};

type RaceControllerConfig = {
  controlsRoot: HTMLElement;
  canvas: HTMLCanvasElement;
};

export class RaceController {
  private readonly ui: ControlsUi;
  private readonly renderer: LiveRenderer;
  private readonly raceAudio = new Audio();
  private readonly musicTracksReady: Promise<void>;

  private options = DEFAULT_OPTIONS;
  private mapSeed = createSeed();
  private obstacleSeed = createSeed();
  private obstacleRuntimeSeed = createSeed();
  private runtimeTrack = this.createPreviewTrack();
  private musicVolume = 0.5;
  private musicTracks: string[] = [];
  private savedSetups: SavedSetup[] = [];
  private selectedSetupId = "";
  private setupName = "";
  private rapierReady: Promise<void> | null = null;
  private liveRace: LiveRaceSimulation | null = null;
  private livePaused = false;
  private busy = false;
  private standingsUpdateAccumulator = 0;
  private saveSessionTimer = 0;
  private previewTrackTimer = 0;
  private pendingPreviewTrackKey = "";

  constructor(config: RaceControllerConfig) {
    this.raceAudio.loop = true;
    this.raceAudio.preload = "auto";
    this.musicTracksReady = this.loadMusicTracks();

    this.ui = new ControlsUi(config.controlsRoot, {
      onStateChange: (state) => this.applyState(state),
      onPrimary: () => this.handlePrimaryButton(),
      onReset: () => this.resetRace(),
      onNewMapSeed: () => this.generateMapSeed(),
      onNewObstacleSeed: () => this.generateObstacleSeed(),
      onSaveConfig: (name) => this.saveCurrentSetup(name),
      onLoadConfig: (id) => this.loadSavedSetup(id),
    });

    this.renderer = new LiveRenderer(config.canvas);
    this.savedSetups = readSavedSetups();
    this.loadStoredSession();
    this.raceAudio.volume = this.musicVolume;
  }

  init(): void {
    this.ui.render(this.renderState(false));
    this.ui.setRaceStandings([]);

    this.renderer.loadTrackOptions(
      anonymizeRaceBalls(expandOptionsToRaceBalls(this.options)),
      this.runtimeTrack,
      true,
    );
  }

  private applyState(state: ControlsState): void {
    const nextOptions = sanitizeOptions(state.options);
    const nextMapSeed = state.mapSeed.trim() || createSeed();
    const nextObstacleSeed = state.obstacleSeed.trim() || createSeed();
    const mapSeedChanged = nextMapSeed !== this.mapSeed;
    const obstacleSeedChanged = nextObstacleSeed !== this.obstacleSeed;
    const optionsChanged = JSON.stringify(nextOptions) !== JSON.stringify(this.options);
    const onlyMusicVolumeChanged = !mapSeedChanged && !obstacleSeedChanged && !optionsChanged;

    this.musicVolume = clamp(state.musicVolume, 0, 1);
    this.raceAudio.volume = this.musicVolume;

    if (onlyMusicVolumeChanged) {
      this.saveStoredSession({
        options: this.options,
        mapSeed: this.mapSeed,
        obstacleSeed: this.obstacleSeed,
        musicVolume: this.musicVolume,
      });
      return;
    }

    this.options = nextOptions;
    this.mapSeed = nextMapSeed;
    this.obstacleSeed = nextObstacleSeed;
    this.scheduleStoredSessionSave();
    this.stopLiveRace();

    if (mapSeedChanged || obstacleSeedChanged) {
      this.schedulePreviewTrackUpdate();
    }

    if (optionsChanged) {
      this.renderer.loadTrackOptions(
        anonymizeRaceBalls(expandOptionsToRaceBalls(this.options)),
        this.runtimeTrack,
        false,
      );
    }

    this.ui.setRuntimeState(this.renderState(false));
    this.ui.setRaceStandings([]);
  }

  private generateMapSeed(): void {
    this.ui.setMapSeed(createSeed());
  }

  private generateObstacleSeed(): void {
    this.ui.setObstacleSeed(createSeed());
  }

  private saveCurrentSetup(name: string): void {
    const trimmedName = name || `Setup ${this.savedSetups.length + 1}`;
    const now = Date.now();
    const existing = this.savedSetups.find((setup) => setup.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase());
    const saved: SavedSetup = {
      id: existing?.id ?? `setup-${now}`,
      name: trimmedName,
      setup: this.serializedSetup(),
      updatedAt: now,
    };

    this.savedSetups = existing
      ? this.savedSetups.map((setup) => (setup.id === existing.id ? saved : setup))
      : [...this.savedSetups, saved];
    this.savedSetups.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
    this.selectedSetupId = saved.id;
    this.setupName = saved.name;
    localStorage.setItem(SAVED_SETUPS_STORAGE_KEY, JSON.stringify(this.savedSetups));
    this.ui.setSavedSetups(this.savedSetups.map(({ id, name }) => ({ id, name })), this.selectedSetupId, this.setupName);
  }

  private loadSavedSetup(id: string): void {
    const saved = this.savedSetups.find((setup) => setup.id === id)?.setup;

    if (!saved) {
      return;
    }

    this.selectedSetupId = id;
    this.setupName = this.savedSetups.find((setup) => setup.id === id)?.name ?? this.setupName;
    this.applyStoredSetup(saved);
    this.ui.render(this.renderState(false));
    this.ui.setRaceStandings([]);
  }

  private handlePrimaryButton(): void {
    if (this.liveRace) {
      if (this.livePaused) {
        this.resumeLiveRace();
      } else {
        this.pauseLiveRace();
      }
      return;
    }

    void this.startLiveRace();
  }

  private resetRace(): void {
    this.stopLiveRace();

    this.runtimeTrack = this.createPreviewTrack();

    this.renderer.loadTrackOptions(
      anonymizeRaceBalls(expandOptionsToRaceBalls(this.options)),
      this.runtimeTrack,
      true,
    );

    this.ui.setRuntimeState(this.renderState(false));
    this.ui.setRaceStandings([]);
  }

  private async startLiveRace(): Promise<void> {
    const options = sanitizeOptions(this.options);
    const raceBalls = expandOptionsToRaceBalls(options);

    if (options.length < 2) {
      return;
    }

    if (raceBalls.length === 0) {
      return;
    }

    const seedForThisRun = this.mapSeed;
    const obstacleSeedForThisRun = this.obstacleSeed;
    this.obstacleRuntimeSeed = createSeed();
    const obstacleRuntimeSeedForThisRun = this.obstacleRuntimeSeed;
    const runtimeTrackForThisRun = this.createRuntimeTrack(obstacleRuntimeSeedForThisRun);
    this.runtimeTrack = runtimeTrackForThisRun;
    const optionsSignatureForThisRun = simulationSignature(options, seedForThisRun, obstacleSeedForThisRun, obstacleRuntimeSeedForThisRun);

    this.busy = true;
    this.ui.setRuntimeState(this.renderState(true));

    try {
      if (!this.rapierReady) {
        this.rapierReady = prepareRapier();
      }

      await this.rapierReady;

      if (optionsSignatureForThisRun !== simulationSignature(this.options, this.mapSeed, this.obstacleSeed, this.obstacleRuntimeSeed)) {
        return;
      }

      const liveRace = createLiveRace({
        seed: raceTrackSeed(seedForThisRun),
        options: raceBalls,
        attempt: 0,
        track: runtimeTrackForThisRun,
      });

      this.liveRace = liveRace;
      this.livePaused = false;
      this.standingsUpdateAccumulator = 0;

      this.renderer.loadTrackOptions(raceBalls, runtimeTrackForThisRun, false);
      this.renderer.showLiveFrame(liveRace.result, liveRace.getFrame());
      this.updateLiveStandings(liveRace.result, liveRace.getFrame());

      this.busy = false;
      this.ui.setRuntimeState(this.renderState(false));
      void this.playRaceAudioFromStart();
      this.startLiveLoop(liveRace);
    } catch (error) {
      this.busy = false;
      this.ui.setRuntimeState(this.renderState(false));
      console.error(error);
    } finally {
      this.busy = false;
      if (!this.liveRace) {
        this.ui.setRuntimeState(this.renderState(false));
      }
    }
  }

  private startLiveLoop(liveRace: LiveRaceSimulation): void {
    this.renderer.setLiveTick((deltaSeconds) => {
      if (this.liveRace !== liveRace) {
        return;
      }

      const frame = liveRace.step(deltaSeconds);
      const result = liveRace.result;
      this.renderer.showLiveFrame(result, frame);
      this.standingsUpdateAccumulator += deltaSeconds;

      if (this.standingsUpdateAccumulator >= STANDINGS_UPDATE_SECONDS) {
        this.standingsUpdateAccumulator = 0;
        this.updateLiveStandings(result, frame);
      }

      if (liveRace.finished) {
        liveRace.dispose();
        this.liveRace = null;
        this.livePaused = false;
        this.renderer.setLiveTick(null);
        this.renderer.finishLive(result, frame);
        this.stopRaceAudio(true);
        this.ui.setRuntimeState(this.renderState(false));
        this.updateLiveStandings(result, frame);
        return;
      }
    });
  }

  private pauseLiveRace(): void {
    if (!this.liveRace || this.livePaused) {
      return;
    }

    this.livePaused = true;
    this.renderer.setLiveTick(null);
    this.renderer.pauseLive();
    this.stopRaceAudio(false);
    this.ui.setRuntimeState(this.renderState(false));
  }

  private resumeLiveRace(): void {
    if (!this.liveRace || !this.livePaused) {
      return;
    }

    this.livePaused = false;
    this.renderer.resumeLive();
    this.playRaceAudio();
    this.ui.setRuntimeState(this.renderState(false));
    this.startLiveLoop(this.liveRace);
  }

  private stopLiveRace(): void {
    this.renderer.setLiveTick(null);
    this.liveRace?.dispose();
    this.liveRace = null;
    this.livePaused = false;
    this.stopRaceAudio(true);
  }

  private async playRaceAudioFromStart(): Promise<void> {
    this.stopRaceAudio(true);
    await this.musicTracksReady;

    if (!this.liveRace) {
      return;
    }

    const nextTrack = this.pickRaceAudioUrl();

    if (!nextTrack) {
      return;
    }

    this.raceAudio.src = nextTrack;
    this.playRaceAudio();
  }

  private playRaceAudio(): void {
    const playResult = this.raceAudio.play();

    if (playResult) {
      playResult.catch((error) => {
        console.warn("Race audio could not start.", error);
      });
    }
  }

  private stopRaceAudio(reset: boolean): void {
    this.raceAudio.pause();

    if (reset) {
      this.raceAudio.currentTime = 0;
    }
  }

  private updateLiveStandings(result: RaceResult, frame: RaceFrame): void {
    const finished = new Map(result.placements.map((placement) => [placement.ballId, placement]));
    const disqualified = new Map(result.disqualifications.map((disqualification) => [disqualification.ballId, disqualification]));
    const frameByBall = new Map(frame.balls.map((ball) => [ball.id, ball]));

    const standings = result.balls.map((ball) => {
      const placement = finished.get(ball.id);
      const disqualification = disqualified.get(ball.id);
      const frameBall = frameByBall.get(ball.id);
      const progress = frameBall?.displayProgress ?? frameBall?.physicalProgress ?? 0;
      const progressPercent = placement ? 100 : Math.max(0, Math.min(100, (progress / result.track.finishDistance) * 100));
      const activePowerups = frameBall?.activePowerups ?? [];

      return {
        id: ball.id,
        label: ball.label,
        activePowerups,
        color: ball.color,
        placement,
        disqualification,
        progress,
        progressPercent: disqualification ? 0 : progressPercent,
      };
    });

    standings.sort((a, b) => {
      const aFinished = a.placement !== undefined;
      const bFinished = b.placement !== undefined;
      const aDisqualified = a.disqualification !== undefined;
      const bDisqualified = b.disqualification !== undefined;

      if (aFinished || bFinished) {
        if (aFinished && bFinished) {
          return a.placement!.place - b.placement!.place;
        }

        return aFinished ? -1 : 1;
      }

      if (aDisqualified || bDisqualified) {
        if (aDisqualified && bDisqualified) {
          return a.disqualification!.time - b.disqualification!.time || a.id.localeCompare(b.id);
        }

        return aDisqualified ? 1 : -1;
      }

      return b.progress - a.progress || a.id.localeCompare(b.id);
    });

    let activePlace = result.placements.length + 1;

    this.ui.setRaceStandings(
      standings.map<RaceStanding>((standing) => {
        if (standing.placement) {
          return {
            id: standing.id,
            place: standing.placement.place,
            label: standing.label,
            activePowerups: standing.activePowerups,
            color: standing.color,
            progressPercent: 100,
            status: "finished",
            statusText: "Finished",
          };
        }

        if (standing.disqualification) {
          return {
            id: standing.id,
            place: "DQ",
            label: standing.label,
            activePowerups: standing.activePowerups,
            color: standing.color,
            progressPercent: 0,
            status: "disqualified",
            statusText: standing.disqualification.reason || "DQ",
          };
        }

        const place = activePlace;
        activePlace += 1;

        return {
          id: standing.id,
          place,
          label: standing.label,
          activePowerups: standing.activePowerups,
          color: standing.color,
          progressPercent: standing.progressPercent,
          status: "racing",
        };
      }),
    );
  }

  private createPreviewTrack(): TrackDefinition {
    return showObstacleRuntimeState(generateTrack(raceTrackSeed(this.mapSeed), obstacleTrackSeed(this.obstacleSeed)));
  }

  private createRuntimeTrack(runtimeSeed = this.obstacleRuntimeSeed): TrackDefinition {
    return randomizeObstacleRuntimeState(generateTrack(raceTrackSeed(this.mapSeed), obstacleTrackSeed(this.obstacleSeed)), runtimeSeed);
  }

  private renderState(busy: boolean) {
    return {
      options: this.options,
      mapSeed: this.mapSeed,
      obstacleSeed: this.obstacleSeed,
      musicVolume: this.musicVolume,
      busy,
      playbackState: this.renderer.getState(),
      standings: [],
      savedSetups: this.savedSetups.map(({ id, name }) => ({ id, name })),
      selectedSetupId: this.selectedSetupId,
      setupName: this.setupName,
    };
  }

  private pickRaceAudioUrl(): string {
    const tracks = this.musicTracks;
    return tracks[Math.floor(Math.random() * tracks.length)] ?? "";
  }

  private async loadMusicTracks(): Promise<void> {
    try {
      const response = await fetch(MUSIC_MANIFEST_URL, { cache: "no-store" });

      if (!response.ok) {
        return;
      }

      const manifest: unknown = await response.json();
      this.musicTracks = Array.isArray(manifest)
        ? manifest.filter((track): track is string => typeof track === "string" && /^\/music\/.+\.(mp3|wav)$/i.test(track))
        : [];
    } catch (error) {
      console.warn("Music track manifest could not be loaded.", error);
      this.musicTracks = [];
    }
  }

  private serializedSetup(): ControlsState {
    return {
      options: this.options.map((option) => ({ ...option })),
      mapSeed: this.mapSeed,
      obstacleSeed: this.obstacleSeed,
      musicVolume: this.musicVolume,
    };
  }

  private saveStoredSession(setup = this.serializedSetup()): void {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(setup));
  }

  private scheduleStoredSessionSave(): void {
    window.clearTimeout(this.saveSessionTimer);
    this.saveSessionTimer = window.setTimeout(() => {
      this.saveStoredSession();
      this.saveSessionTimer = 0;
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  private schedulePreviewTrackUpdate(): void {
    const previewKey = `${this.mapSeed}\n${this.obstacleSeed}`;
    this.pendingPreviewTrackKey = previewKey;

    window.clearTimeout(this.previewTrackTimer);
    this.previewTrackTimer = window.setTimeout(() => {
      if (this.pendingPreviewTrackKey !== previewKey || this.liveRace) {
        return;
      }

      this.runtimeTrack = this.createPreviewTrack();
      this.renderer.loadTrackOptions(
        anonymizeRaceBalls(expandOptionsToRaceBalls(this.options)),
        this.runtimeTrack,
        false,
      );
      this.previewTrackTimer = 0;
    }, PREVIEW_TRACK_UPDATE_DEBOUNCE_MS);
  }

  private loadStoredSession(): void {
    const stored = readStoredSetup(SESSION_STORAGE_KEY);

    if (stored) {
      this.applyStoredSetup(stored);
    }
  }

  private applyStoredSetup(setup: ControlsState): void {
    this.stopLiveRace();
    this.options = sanitizeOptions(setup.options.length > 0 ? setup.options : DEFAULT_OPTIONS);
    this.mapSeed = setup.mapSeed || createSeed();
    this.obstacleSeed = setup.obstacleSeed || createSeed();
    this.musicVolume = clamp(setup.musicVolume, 0, 1);
    this.raceAudio.volume = this.musicVolume;
    this.runtimeTrack = this.createPreviewTrack();
    this.renderer.loadTrackOptions(anonymizeRaceBalls(expandOptionsToRaceBalls(this.options)), this.runtimeTrack, false);
    this.saveStoredSession();
  }
}

function raceTrackSeed(seed: string): string {
  return `${seed}:race`;
}

function obstacleTrackSeed(seed: string): string {
  return `${seed}:obstacles`;
}

function sanitizeOptions(options: PickerOption[]): PickerOption[] {
  return options.map((option, index) => ({
    id: option.id || `option-${index + 1}`,
    label: option.label.trim() || `Option ${index + 1}`,
    weight: Number.isFinite(option.weight) ? Math.max(0, option.weight) : 0,
    color: option.color,
  }));
}

function expandOptionsToRaceBalls(options: PickerOption[]): RaceBall[] {
  const positiveOptions = options.filter((option) => option.weight > 0);

  if (positiveOptions.length === 0) {
    return [];
  }

  const counts = getBallCounts(positiveOptions);

  return positiveOptions.flatMap((option, optionIndex) =>
    Array.from({ length: counts[optionIndex] ?? 0 }, (_value, ballIndex) => ({
      id: `${option.id}-ball-${ballIndex + 1}`,
      optionId: option.id,
      label: counts[optionIndex] > 1 ? `${option.label} ${ballIndex + 1}` : option.label,
      weight: 1,
      color: option.color,
    })),
  );
}

function anonymizeRaceBalls(balls: RaceBall[]): RaceBall[] {
  return balls.map((ball) => ({
    ...ball,
    label: PREVIEW_BALL_LABEL,
    color: PREVIEW_BALL_COLOR,
  }));
}

function getBallCounts(options: PickerOption[]): number[] {
  const roundedWeights = options.map((option) => Math.max(0, Math.round(option.weight)));
  const allWholeNumberWeights = options.every((option, index) => Math.abs(option.weight - roundedWeights[index]) < 0.0001);
  const roundedTotal = roundedWeights.reduce((total, weight) => total + weight, 0);

  if (allWholeNumberWeights && roundedTotal > 0 && roundedTotal <= MAX_RACE_BALLS) {
    return roundedWeights;
  }

  const totalWeight = options.reduce((total, option) => total + option.weight, 0);
  const targetTotal = Math.min(MAX_RACE_BALLS, Math.max(options.length, Math.round(totalWeight)));
  const rawCounts = options.map((option) => (option.weight / totalWeight) * targetTotal);
  const counts = rawCounts.map((count) => Math.floor(count));

  for (let index = 0; index < counts.length; index += 1) {
    if (options[index].weight > 0 && counts[index] === 0) {
      counts[index] = 1;
    }
  }

  while (counts.reduce((total, count) => total + count, 0) > MAX_RACE_BALLS) {
    const largestIndex = counts.reduce(
      (bestIndex, count, index) => (count > counts[bestIndex] ? index : bestIndex),
      0,
    );

    if (counts[largestIndex] <= 1) {
      break;
    }

    counts[largestIndex] -= 1;
  }

  while (counts.reduce((total, count) => total + count, 0) < targetTotal) {
    const used = counts.reduce((total, count) => total + count, 0);
    const bestIndex = rawCounts
      .map((raw, index) => ({ index, remainder: raw - counts[index] }))
      .sort((a, b) => b.remainder - a.remainder)[0]?.index;

    if (bestIndex === undefined || used >= MAX_RACE_BALLS) {
      break;
    }

    counts[bestIndex] += 1;
  }

  return counts;
}

function simulationSignature(options: PickerOption[], seed: string, obstacleSeed: string, obstacleRuntimeSeed: string): string {
  return JSON.stringify({
    seed,
    obstacleSeed,
    obstacleRuntimeSeed,
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      weight: Math.max(0, option.weight),
      color: option.color,
    })),
  });
}

function readSavedSetups(): SavedSetup[] {
  try {
    const raw = localStorage.getItem(SAVED_SETUPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const setups = Array.isArray(parsed)
      ? parsed
          .map((entry): SavedSetup | null => {
            if (!entry || typeof entry !== "object") {
              return null;
            }

            const setup = normalizeStoredSetup((entry as Partial<SavedSetup>).setup);

            if (!setup) {
              return null;
            }

            return {
              id: typeof (entry as Partial<SavedSetup>).id === "string" ? (entry as Partial<SavedSetup>).id! : `setup-${Date.now()}`,
              name: typeof (entry as Partial<SavedSetup>).name === "string" ? (entry as Partial<SavedSetup>).name! : "Unnamed setup",
              setup,
              updatedAt: Number.isFinite((entry as Partial<SavedSetup>).updatedAt) ? Number((entry as Partial<SavedSetup>).updatedAt) : 0,
            };
          })
          .filter((setup): setup is SavedSetup => setup !== null)
      : [];

    if (setups.length > 0) {
      return setups.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
    }

    return [];
  } catch {
    return [];
  }
}

function readStoredSetup(key: string): ControlsState | null {
  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return null;
    }

    return normalizeStoredSetup(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeStoredSetup(value: unknown): ControlsState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Partial<ControlsState>;

  return {
    options: Array.isArray(parsed.options) ? parsed.options : DEFAULT_OPTIONS,
    mapSeed: typeof parsed.mapSeed === "string" ? parsed.mapSeed : createSeed(),
    obstacleSeed: typeof parsed.obstacleSeed === "string" ? parsed.obstacleSeed : createSeed(),
    musicVolume: Number.isFinite(parsed.musicVolume) ? Number(parsed.musicVolume) : 0.5,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
