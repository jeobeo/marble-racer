import "./ui/styles.css";
import { RaceController } from "./game/raceController";

const controls = document.querySelector<HTMLElement>("#controls");
const canvas = document.querySelector<HTMLCanvasElement>("#race-canvas");
const banner = document.querySelector<HTMLElement>("#winner-banner");

if (!controls || !canvas || !banner) {
  throw new Error("App root elements are missing.");
}

const controller = new RaceController({
  controlsRoot: controls,
  canvas,
  winnerBanner: banner,
});

controller.init();
