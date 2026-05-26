import type { PickerOption } from "../simulation/types";
import type { LiveRenderState } from "../rendering/liveRenderer";

export type ControlsState = {
  options: PickerOption[];
  mapSeed: string;
  obstacleSeed: string;
  musicVolume: number;
};

export type RaceStanding = {
  id: string;
  place: number | string;
  label: string;
  activePowerups?: string[];
  color?: string;
  progressPercent: number;
  status: "racing" | "finished" | "disqualified";
  statusText?: string;
};

export type SavedSetupSummary = {
  id: string;
  name: string;
};

type RenderState = ControlsState & {
  busy: boolean;
  playbackState: LiveRenderState;
  standings: RaceStanding[];
  savedSetups: SavedSetupSummary[];
  selectedSetupId: string;
  setupName: string;
};

type ControlsCallbacks = {
  onStateChange: (state: ControlsState) => void;
  onPrimary: () => void;
  onReset: () => void;
  onNewMapSeed: () => void;
  onNewObstacleSeed: () => void;
  onSaveConfig: (name: string) => void;
  onLoadConfig: (id: string) => void;
};

const COLORS = ["#e84c4f", "#4094f7", "#38b36b", "#f2b84b", "#a35df2", "#f07ca6", "#25b6b1", "#f27d42"];

export class ControlsUi {
  private readonly root: HTMLElement;
  private readonly callbacks: ControlsCallbacks;
  private setupModalOpen = false;
  private state: RenderState = {
    options: [],
    mapSeed: "",
    obstacleSeed: "",
    musicVolume: 0.5,
    busy: false,
    playbackState: "idle",
    standings: [],
    savedSetups: [],
    selectedSetupId: "",
    setupName: "",
  };

  constructor(root: HTMLElement, callbacks: ControlsCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("change", (event) => this.handleInput(event));
    this.root.addEventListener("click", (event) => this.handleClick(event));
  }

  render(state: RenderState): void {
    this.state = cloneState(state);

    const totalWeight = this.totalWeight();

    this.root.innerHTML = `
      <button class="panel-toggle" type="button" data-action="toggle-panel" title="Toggle panel">${this.root.classList.contains("collapsed") ? "Show" : "Hide"}</button>
      <div class="panel-header">
        <div>
          <h1>Marble Race Picker</h1>
          <p>map seed controls the course; objects seed controls objects and powerups</p>
        </div>
      </div>

      <section class="control-section">
        <div class="section-title">
          <h2>Options</h2>
          <button class="icon-text" type="button" data-action="add" ${this.state.busy ? "disabled" : ""}>+ Add</button>
        </div>
        <div class="options-list">
          ${this.state.options.map((option, index) => this.optionRow(option, index, totalWeight)).join("")}
        </div>
      </section>

      <section class="control-section">
        <label class="field-label" for="map-seed-input">Map seed</label>
        <div class="seed-row">
          <input id="map-seed-input" data-field="mapSeed" value="${escapeHtml(this.state.mapSeed)}" ${this.state.busy ? "disabled" : ""} />
          <button class="icon-button" type="button" data-action="new-map-seed" title="Generate map seed" ${this.state.busy ? "disabled" : ""}>↻</button>
        </div>
      </section>

      <section class="control-section">
        <label class="field-label" for="obstacle-seed-input">Objects seed</label>
        <div class="seed-row">
          <input id="obstacle-seed-input" data-field="obstacleSeed" value="${escapeHtml(this.state.obstacleSeed)}" ${this.state.busy ? "disabled" : ""} />
          <button class="icon-button" type="button" data-action="new-obstacle-seed" title="Generate objects seed" ${this.state.busy ? "disabled" : ""}>↻</button>
        </div>
      </section>

      <section class="control-section">
        <label class="field-label" for="music-volume-input">Music volume <span>${Math.round(this.state.musicVolume * 100)}%</span></label>
        <input id="music-volume-input" class="volume-input" type="range" min="0" max="1" step="0.01" data-field="musicVolume" value="${this.state.musicVolume}" />
      </section>

      <section class="setup-row">
        <button type="button" data-action="open-setup-modal">Save / Load Setup</button>
      </section>

      <section class="action-row">
        <button class="primary" type="button" data-action="primary"></button>
        <button type="button" data-action="reset">Reset</button>
      </section>

      <section class="race-results" aria-live="polite">
        <div class="section-title">
          <h2>Race Results</h2>
          <span class="results-state">${this.resultsStateLabel()}</span>
        </div>
        <div class="results-list" data-race-results>
          ${this.raceResultsHtml()}
        </div>
      </section>

      <div data-loading-slot></div>
      ${this.setupModalOpen ? this.setupModalHtml() : ""}
    `;

    this.updateDerivedUi();
  }

  getState(): ControlsState {
    return {
      options: this.state.options.map((option) => ({ ...option })),
      mapSeed: this.state.mapSeed,
      obstacleSeed: this.state.obstacleSeed,
      musicVolume: this.state.musicVolume,
    };
  }

  setMapSeed(seed: string): void {
    this.state.mapSeed = seed;

    const input = this.root.querySelector<HTMLInputElement>('[data-field="mapSeed"]');
    if (input) {
      input.value = seed;
    }

    this.callbacks.onStateChange(this.getState());
  }

  setObstacleSeed(seed: string): void {
    this.state.obstacleSeed = seed;

    const input = this.root.querySelector<HTMLInputElement>('[data-field="obstacleSeed"]');
    if (input) {
      input.value = seed;
    }

    this.callbacks.onStateChange(this.getState());
  }

  setRuntimeState(partial: Partial<Pick<RenderState, "busy" | "playbackState">>): void {
    this.state = {
      ...this.state,
      busy: partial.busy ?? this.state.busy,
      playbackState: partial.playbackState ?? this.state.playbackState,
    };

    this.updateDerivedUi();
  }

  setRaceStandings(standings: RaceStanding[]): void {
    this.state.standings = standings.map((standing) => ({ ...standing }));

    const list = this.root.querySelector<HTMLElement>("[data-race-results]");
    const label = this.root.querySelector<HTMLElement>(".results-state");

    if (list) {
      list.innerHTML = this.raceResultsHtml();
    }

    if (label) {
      label.textContent = this.resultsStateLabel();
    }
  }

  setSavedSetups(savedSetups: SavedSetupSummary[], selectedSetupId: string, setupName: string): void {
    this.state.savedSetups = savedSetups.map((setup) => ({ ...setup }));
    this.state.selectedSetupId = selectedSetupId;
    this.state.setupName = setupName;
    this.render(this.state);
  }

  private optionRow(option: PickerOption, index: number, totalWeight: number): string {
    const odds = totalWeight > 0 ? (Math.max(0, option.weight) / totalWeight) * 100 : 0;

    return `
      <div class="option-row" data-index="${index}">
        <input class="color-input" type="color" data-option-field="color" value="${escapeHtml(option.color ?? COLORS[index % COLORS.length])}" aria-label="Color" ${this.state.busy ? "disabled" : ""} />
        <input class="label-input" data-option-field="label" value="${escapeHtml(option.label)}" aria-label="Label" ${this.state.busy ? "disabled" : ""} />
        <input class="weight-input" type="number" min="0" step="1" data-option-field="weight" value="${option.weight}" aria-label="Weight" ${this.state.busy ? "disabled" : ""} />
        <span class="odds" data-odds>${odds.toFixed(1)}%</span>
        <button class="icon-button" type="button" data-action="remove" data-index="${index}" title="Remove option" ${this.state.options.length <= 2 || this.state.busy ? "disabled" : ""}>×</button>
      </div>
    `;
  }

  private updateDerivedUi(): void {
    this.updateActionButtons();
    this.updateLoadingPanel();
    this.updateInputDisabledState();
    this.setRaceStandings(this.state.standings);
  }

  private updateActionButtons(): void {
    const primary = this.root.querySelector<HTMLButtonElement>('[data-action="primary"]');

    if (primary) {
      primary.textContent = this.primaryLabel();
      primary.disabled = this.state.busy;
    }
  }

  private primaryLabel(): string {
    if (this.state.busy) {
      return "Loading";
    }

    if (this.state.playbackState === "live") {
      return "Pause";
    }

    if (this.state.playbackState === "paused") {
      return "Resume";
    }

    return "Start";
  }

  private updateLoadingPanel(): void {
    const slot = this.root.querySelector<HTMLElement>("[data-loading-slot]");

    if (!slot) {
      return;
    }

    slot.innerHTML = this.state.busy
      ? `
        <section class="simulation-progress" aria-live="polite">
          <div class="progress-header">
            <strong>Loading...</strong>
          </div>
          <div class="loading-spinner" aria-hidden="true"></div>
        </section>
      `
      : "";
  }

  private updateInputDisabledState(): void {
    const editableInputs = this.root.querySelectorAll<HTMLInputElement>("[data-option-field], [data-field='mapSeed'], [data-field='obstacleSeed']");
    const addButton = this.root.querySelector<HTMLButtonElement>('[data-action="add"]');
    const removeButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-action="remove"]');

    editableInputs.forEach((input) => {
      input.disabled = this.state.busy;
    });

    if (addButton) {
      addButton.disabled = this.state.busy;
    }

    removeButtons.forEach((button) => {
      button.disabled = this.state.busy || this.state.options.length <= 2;
    });
  }

  private updateOddsLabels(): void {
    const totalWeight = this.totalWeight();

    this.root.querySelectorAll<HTMLElement>(".option-row").forEach((row) => {
      const index = Number(row.dataset.index);
      const option = this.state.options[index];
      const odds = row.querySelector<HTMLElement>("[data-odds]");

      if (!option || !odds) {
        return;
      }

      const value = totalWeight > 0 ? (Math.max(0, option.weight) / totalWeight) * 100 : 0;
      odds.textContent = `${value.toFixed(1)}%`;
    });
  }

  private totalWeight(): number {
    return this.state.options.reduce((total, option) => total + Math.max(0, option.weight), 0);
  }

  private resultsStateLabel(): string {
    if (this.state.playbackState === "live") {
      return "Live";
    }

    if (this.state.playbackState === "paused") {
      return "Paused";
    }

    if (this.state.playbackState === "finished") {
      return "Final";
    }

    return "Waiting";
  }

  private raceResultsHtml(): string {
    if (this.state.standings.length === 0) {
      return `<div class="empty-results">Start a race to see live positions.</div>`;
    }

    return this.state.standings.map((standing) => {
      const color = escapeHtml(standing.color ?? "#8fa1b2");
      const progress = Math.max(0, Math.min(100, standing.progressPercent));
      const status = standing.statusText ?? statusLabel(standing);

      return `
        <div class="result-row ${standing.status}">
          <span class="result-place">${escapeHtml(String(standing.place))}</span>
          <span class="result-swatch" style="background:${color}"></span>
          <span class="result-label">${escapeHtml(formatStandingLabel(standing))}</span>
          <span class="result-status">${escapeHtml(status)}</span>
          <span class="result-meter"><span style="width:${progress.toFixed(1)}%"></span></span>
        </div>
      `;
    }).join("");
  }

  private setupModalHtml(): string {
    const selectedId = this.selectedSetupId();
    const optionsHtml = this.state.savedSetups
      .map((setup) => `<option value="${escapeHtml(setup.id)}" ${setup.id === selectedId ? "selected" : ""}>${escapeHtml(setup.name)}</option>`)
      .join("");

    return `
      <div class="modal-backdrop" data-action="close-setup-modal">
        <section class="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-modal-title">
          <div class="modal-header">
            <h2 id="setup-modal-title">Setups</h2>
            <button class="icon-button" type="button" data-action="close-setup-modal" title="Close">×</button>
          </div>
          <label class="field-label" for="setup-name-input">Setup name</label>
          <input id="setup-name-input" data-field="setupName" value="${escapeHtml(this.state.setupName)}" placeholder="Name this setup" aria-label="Setup name" />
          <button type="button" data-action="save-config">Save Current Setup</button>
          <div class="saved-setup-block">
            <label class="field-label" for="setup-select-input">Load saved setup</label>
            ${
              this.state.savedSetups.length > 0
                ? `<select id="setup-select-input" data-field="selectedSetupId" aria-label="Saved setup">${optionsHtml}</select>`
                : `<div class="empty-results">No saved setups yet.</div>`
            }
            <button type="button" data-action="load-config" ${selectedId ? "" : "disabled"}>Load Selected Setup</button>
          </div>
        </section>
      </div>
    `;
  }

  private selectedSetupId(): string {
    return this.state.selectedSetupId || this.state.savedSetups[0]?.id || "";
  }

  private markNeedsPreparation(): void {
    this.state.playbackState = "idle";
    this.updateDerivedUi();
  }

  private handleInput(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLSelectElement && target.dataset.field === "selectedSetupId") {
      this.state.selectedSetupId = target.value;
      const selectedSetup = this.state.savedSetups.find((setup) => setup.id === target.value);
      this.state.setupName = selectedSetup?.name ?? this.state.setupName;
      const input = this.root.querySelector<HTMLInputElement>('[data-field="setupName"]');
      if (input) {
        input.value = this.state.setupName;
      }
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const optionField = target.dataset.optionField;

    if (optionField) {
      const row = target.closest<HTMLElement>(".option-row");
      const index = Number(row?.dataset.index);
      const option = this.state.options[index];

      if (!option) {
        return;
      }

      if (optionField === "weight") {
        option.weight = Number(target.value);
        this.updateOddsLabels();
      } else if (optionField === "label") {
        option.label = target.value;
      } else if (optionField === "color") {
        option.color = target.value;
      }

      this.markNeedsPreparation();
      this.callbacks.onStateChange(this.getState());
      return;
    }

    if (target.dataset.field === "mapSeed") {
      this.state.mapSeed = target.value;
      this.markNeedsPreparation();
      this.callbacks.onStateChange(this.getState());
      return;
    }

    if (target.dataset.field === "obstacleSeed") {
      this.state.obstacleSeed = target.value;
      this.markNeedsPreparation();
      this.callbacks.onStateChange(this.getState());
      return;
    }

    if (target.dataset.field === "musicVolume") {
      this.state.musicVolume = Number(target.value);
      const label = this.root.querySelector<HTMLElement>('[for="music-volume-input"] span');
      if (label) {
        label.textContent = `${Math.round(this.state.musicVolume * 100)}%`;
      }
      this.callbacks.onStateChange(this.getState());
    }

    if (target.dataset.field === "setupName") {
      this.state.setupName = target.value;
      return;
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;

    if (action === "toggle-panel") {
      this.root.classList.toggle("collapsed");
      this.root.parentElement?.classList.toggle("controls-collapsed", this.root.classList.contains("collapsed"));
      target.textContent = this.root.classList.contains("collapsed") ? "Show" : "Hide";
      return;
    }

    if (action === "close-setup-modal" && target === event.target) {
      this.setupModalOpen = false;
      this.render(this.state);
      return;
    }

    if (target.closest(".setup-modal") && action === "close-setup-modal") {
      this.setupModalOpen = false;
      this.render(this.state);
      return;
    }

    if (action === "open-setup-modal") {
      this.setupModalOpen = true;
      this.render(this.state);
      return;
    }

    if (action === "add") {
      const index = this.state.options.length;
      this.state.options.push({
        id: `option-${Date.now()}-${index}`,
        label: `Option ${index + 1}`,
        weight: 1,
        color: generateDistinctColor(this.state.options, index),
      });

      this.markNeedsPreparation();
      this.callbacks.onStateChange(this.getState());
      this.render(this.state);
    }

    if (action === "remove") {
      const index = Number(target.dataset.index);
      this.state.options.splice(index, 1);

      this.markNeedsPreparation();
      this.callbacks.onStateChange(this.getState());
      this.render(this.state);
    }

    if (action === "new-map-seed") {
      this.callbacks.onNewMapSeed();
      this.markNeedsPreparation();
      this.updateDerivedUi();
    }

    if (action === "new-obstacle-seed") {
      this.callbacks.onNewObstacleSeed();
      this.markNeedsPreparation();
      this.updateDerivedUi();
    }

    if (action === "save-config") {
      this.callbacks.onSaveConfig(this.state.setupName.trim());
    }

    if (action === "load-config") {
      const selectedId = this.selectedSetupId();
      if (selectedId) {
        this.setupModalOpen = false;
        this.callbacks.onLoadConfig(selectedId);
      }
    }

    if (action === "primary") {
      this.callbacks.onPrimary();
    }

    if (action === "reset") {
      this.callbacks.onReset();
    }
  }
}

function statusLabel(standing: RaceStanding): string {
  if (standing.status === "finished") {
    return "Finished";
  }

  if (standing.status === "disqualified") {
    return "DQ";
  }

  return `${Math.max(0, Math.min(100, standing.progressPercent)).toFixed(0)}%`;
}

function formatStandingLabel(standing: RaceStanding): string {
  const effects = standing.activePowerups?.filter(Boolean) ?? [];

  if (effects.length === 0) {
    return standing.label;
  }

  return `${standing.label} [${effects.map(formatPowerupName).join(", ")}]`;
}

function formatPowerupName(powerup: string): string {
  if (powerup === "slow-source") {
    return "Slow";
  }

  if (powerup === "slow") {
    return "Slowed";
  }

  return powerup.charAt(0).toUpperCase() + powerup.slice(1);
}

function generateDistinctColor(options: PickerOption[], index: number): string {
  const existingHues = options
    .map((option) => hexToHue(option.color))
    .filter((hue): hue is number => hue !== null);
  let bestHue = (index * 137.508 + 18) % 360;
  let bestScore = -1;

  for (let candidateIndex = 0; candidateIndex < 24; candidateIndex += 1) {
    const hue = (index * 137.508 + candidateIndex * 47 + 18) % 360;
    const score = existingHues.length === 0
      ? 180
      : Math.min(...existingHues.map((existingHue) => hueDistance(hue, existingHue)));

    if (score > bestScore) {
      bestScore = score;
      bestHue = hue;
    }
  }

  return hslToHex(bestHue, 72, 56);
}

function hexToHue(color?: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color ?? "");

  if (!match) {
    return null;
  }

  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  if (max === r) {
    return ((g - b) / delta * 60 + 360) % 360;
  }

  if (max === g) {
    return (2 + (b - r) / delta) * 60;
  }

  return (4 + (r - g) / delta) * 60;
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = hue / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 1 ? [c, x, 0] :
    h < 2 ? [x, c, 0] :
    h < 3 ? [0, c, x] :
    h < 4 ? [0, x, c] :
    h < 5 ? [x, 0, c] :
    [c, 0, x];

  return `#${[r, g, b]
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function cloneState(state: RenderState): RenderState {
  return {
    options: state.options.map((option) => ({ ...option })),
    mapSeed: state.mapSeed,
    obstacleSeed: state.obstacleSeed,
    musicVolume: state.musicVolume,
    busy: state.busy,
    playbackState: state.playbackState,
    standings: state.standings.map((standing) => ({ ...standing })),
    savedSetups: state.savedSetups.map((setup) => ({ ...setup })),
    selectedSetupId: state.selectedSetupId,
    setupName: state.setupName,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
