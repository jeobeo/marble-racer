import "./ui/styles.css";
import { RaceController } from "./game/raceController";

const controls = document.querySelector<HTMLElement>("#controls");
const canvas = document.querySelector<HTMLCanvasElement>("#race-canvas");

if (!controls || !canvas) {
  throw new Error("App root elements are missing.");
}

const controller = new RaceController({
  controlsRoot: controls,
  canvas,
});

controller.init();
