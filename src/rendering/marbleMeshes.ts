import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
} from "three";
import type { PickerOption } from "../simulation/types";
import { createStartLayout } from "../shared/marbleLayout";

export type MarbleMesh = {
  id: string;
  group: Group;
  sphere: Mesh;
  label: Sprite;
};

export function createMarbleMeshes(options: PickerOption[]): Map<string, MarbleMesh> {
  const marbles = new Map<string, MarbleMesh>();
  const { radius } = createStartLayout(options.length);
  const geometry = new SphereGeometry(radius, 48, 32);

  for (const option of options) {
    const color = new Color(option.color ?? "#ff4f5e");
    const material = new MeshPhysicalMaterial({
      color,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 0.8,
      clearcoatRoughness: 0.16,
    });
    const sphere = new Mesh(geometry, material);
    sphere.castShadow = true;
    sphere.receiveShadow = true;

    const label = createLabel(option.label, color.getStyle());
    label.position.set(0, radius + 0.38, 0);
    label.scale.set(Math.max(0.8, radius * 4.25), Math.max(0.22, radius * 1.12), 1);

    const group = new Group();
    group.add(sphere, label);
    marbles.set(option.id, { id: option.id, group, sphere, label });
  }

  return marbles;
}

function createLabel(text: string, color: string): Sprite {
  const texture = labelTexture(text, color);
  return new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
}

function labelTexture(text: string, color: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (!context) {
    return new Texture();
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(12, 17, 23, 0.78)";
  roundRect(context, 16, 20, 480, 88, 22);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#f8fbff";
  context.font = "700 42px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 18), canvas.width / 2, canvas.height / 2 + 3, 440);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
