import type { PickerOption, RaceResult } from "../simulation/types";

export type ControlsState = {
  options: PickerOption[];
  seed: string;
  speed: number;
};

type RenderState = ControlsState & {
  busy: boolean;
  history: RaceResult[];
  hasPreparedRace?: boolean;
  progress?: SimulationProgress | null;
};

type ControlsCallbacks = {
  onChange: (state: ControlsState) => void;
  onStart: () => void;
  onCancel: () => void;
  onReset: () => void;
  onNewSeed: () => void;
  onReplay: () => void;
};

export type SimulationProgress = {
  phase: string;
  detail: string;
  attempt: number;
  maxAttempts: number;
  percent: number;
};

const COLORS = ["#e84c4f", "#4094f7", "#38b36b", "#f2b84b", "#a35df2", "#f07ca6", "#25b6b1", "#f27d42"];

export class ControlsUi {
  private readonly root: HTMLElement;
  private readonly callbacks: ControlsCallbacks;
  private state: RenderState = {
    options: [],
    seed: "",
    speed: 1,
    busy: false,
    history: [],
    hasPreparedRace: false,
    progress: null,
  };

  constructor(root: HTMLElement, callbacks: ControlsCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("click", (event) => this.handleClick(event));
  }

  render(state: RenderState): void {
    this.state = cloneState(state);
    const totalWeight = this.state.options.reduce((total, option) => total + Math.max(0, option.weight), 0);
    const primaryLabel = this.state.busy ? "Finding..." : this.state.hasPreparedRace ? "Start Race" : "Find Race";

    this.root.innerHTML = `
      <div class="panel-header">
        <div>
          <h1>Marble Race Picker</h1>
          <p>seed + weights -> winner -> replay</p>
        </div>
      </div>

      <section class="control-section">
        <div class="section-title">
          <h2>Options</h2>
          <button class="icon-text" type="button" data-action="add" ${this.state.busy ? "disabled" : ""}>+ Add</button>
        </div>
        <div class="options-list">
          ${this.state.options
            .map((option, index) => this.optionRow(option, index, totalWeight))
            .join("")}
        </div>
      </section>

      <section class="control-section">
        <label class="field-label" for="seed-input">Seed</label>
        <div class="seed-row">
          <input id="seed-input" data-field="seed" value="${escapeHtml(this.state.seed)}" ${this.state.busy ? "disabled" : ""} />
          <button class="icon-button" type="button" data-action="new-seed" title="Generate seed" ${this.state.busy ? "disabled" : ""}>↻</button>
        </div>
      </section>

      <section class="control-section">
        <label class="field-label" for="speed-input">Replay Speed <span>${this.state.speed.toFixed(1)}x</span></label>
        <input id="speed-input" type="range" min="0.5" max="2.5" step="0.1" data-field="speed" value="${this.state.speed}" />
      </section>

      <section class="action-row">
        <button class="primary" type="button" data-action="start" ${this.state.busy ? "disabled" : ""}>${primaryLabel}</button>
        ${this.state.busy ? `<button class="danger" type="button" data-action="cancel">Cancel</button>` : ""}
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="replay" ${this.state.history.length === 0 ? "disabled" : ""}>Replay</button>
      </section>

      ${this.state.busy && this.state.progress ? this.progressPanel(this.state.progress) : ""}

      <section class="control-section history">
        <h2>Recent Races</h2>
        ${
          this.state.history.length === 0
            ? `<p class="muted">No races yet.</p>`
            : this.state.history.map((result) => this.historyRow(result)).join("")
        }
      </section>
    `;
  }

  getState(): ControlsState {
    return {
      options: this.state.options.map((option) => ({ ...option })),
      seed: this.state.seed,
      speed: this.state.speed,
    };
  }

  setSeed(seed: string): void {
    this.state.seed = seed;
    this.render(this.state);
    this.callbacks.onChange(this.getState());
  }

  setBusy(busy: boolean, progress: SimulationProgress | null = null): void {
    this.state.busy = busy;
    this.state.progress = progress;
    this.render(this.state);
  }

  setProgress(progress: SimulationProgress): void {
    this.state.progress = progress;
    this.render(this.state);
  }

  private optionRow(option: PickerOption, index: number, totalWeight: number): string {
    const odds = totalWeight > 0 ? (Math.max(0, option.weight) / totalWeight) * 100 : 0;

    return `
      <div class="option-row" data-index="${index}">
        <input class="color-input" type="color" data-option-field="color" value="${escapeHtml(option.color ?? COLORS[index % COLORS.length])}" aria-label="Color" ${this.state.busy ? "disabled" : ""} />
        <input class="label-input" data-option-field="label" value="${escapeHtml(option.label)}" aria-label="Label" ${this.state.busy ? "disabled" : ""} />
        <input class="weight-input" type="number" min="0" step="1" data-option-field="weight" value="${option.weight}" aria-label="Weight" ${this.state.busy ? "disabled" : ""} />
        <span class="odds">${odds.toFixed(1)}%</span>
        <button class="icon-button" type="button" data-action="remove" data-index="${index}" title="Remove option" ${this.state.options.length <= 2 || this.state.busy ? "disabled" : ""}>×</button>
      </div>
    `;
  }

  private historyRow(result: RaceResult): string {
    const winner = this.state.options.find((option) => option.id === result.actualWinnerId);
    return `
      <div class="history-row">
        <span>${escapeHtml(winner?.label ?? result.actualWinnerId)}</span>
        <small>attempt ${result.attempt + 1}</small>
      </div>
    `;
  }

  private progressPanel(progress: SimulationProgress): string {
    const percent = Math.max(0, Math.min(100, progress.percent));

    return `
      <section class="simulation-progress" aria-live="polite">
        <div class="progress-header">
          <strong>${escapeHtml(progress.phase)}</strong>
          <span>${progress.attempt}/${progress.maxAttempts}</span>
        </div>
        <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(0)}">
          <div style="width: ${percent.toFixed(1)}%"></div>
        </div>
        <p>${escapeHtml(progress.detail)}</p>
      </section>
    `;
  }

  private handleInput(event: Event): void {
    const target = event.target;

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
      } else if (optionField === "label") {
        option.label = target.value;
      } else if (optionField === "color") {
        option.color = target.value;
      }
    }

    if (target.dataset.field === "seed") {
      this.state.seed = target.value;
    }

    if (target.dataset.field === "speed") {
      this.state.speed = Number(target.value);
    }

    this.callbacks.onChange(this.getState());
    this.render(this.state);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;

    if (action === "add") {
      const index = this.state.options.length;
      this.state.options.push({
        id: `option-${Date.now()}-${index}`,
        label: `Option ${index + 1}`,
        weight: 10,
        color: COLORS[index % COLORS.length],
      });
      this.callbacks.onChange(this.getState());
      this.render(this.state);
    }

    if (action === "remove") {
      const index = Number(target.dataset.index);
      this.state.options.splice(index, 1);
      this.callbacks.onChange(this.getState());
      this.render(this.state);
    }

    if (action === "new-seed") {
      this.callbacks.onNewSeed();
    }

    if (action === "start") {
      this.callbacks.onStart();
    }

    if (action === "cancel") {
      this.callbacks.onCancel();
    }

    if (action === "reset") {
      this.callbacks.onReset();
    }

    if (action === "replay") {
      this.callbacks.onReplay();
    }
  }
}

function cloneState(state: RenderState): RenderState {
  return {
    options: state.options.map((option) => ({ ...option })),
    seed: state.seed,
    speed: state.speed,
    busy: state.busy,
    history: [...state.history],
    hasPreparedRace: state.hasPreparedRace ?? false,
    progress: state.progress ? { ...state.progress } : null,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
