import {
  CanvasTexture,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SphereGeometry,
  Texture,
} from "three";
import type { PickerOption, RaceBall } from "../simulation/types";
import { createStartLayout } from "../shared/marbleLayout";

type MarbleRenderable = PickerOption | RaceBall;
const textureCache = new Map<string, Texture>();

export type MarbleMesh = {
  id: string;
  group: Group;
  sphere: Mesh;
};

export function createMarbleMeshes(options: MarbleRenderable[], maxAnisotropy = 1): Map<string, MarbleMesh> {
  const marbles = new Map<string, MarbleMesh>();
  const { radius } = createStartLayout(options.length);
  const geometry = new SphereGeometry(radius, 64, 40);

  for (const option of options) {
    const color = new Color(option.color ?? "#8d96a3");
    const material = new MeshPhysicalMaterial({
      color: 0xffffff,
      map: stripeTexture(color, maxAnisotropy),
      roughness: 0.2,
      metalness: 0.03,
      clearcoat: 0.86,
      clearcoatRoughness: 0.12,
    });

    const sphere = new Mesh(geometry, material);
    sphere.castShadow = true;
    sphere.receiveShadow = true;

    const group = new Group();
    group.add(sphere);

    marbles.set(option.id, {
      id: option.id,
      group,
      sphere,
    });
  }

  return marbles;
}

function stripeTexture(color: Color, maxAnisotropy: number): Texture {
  const cacheKey = `${color.getHexString()}:${maxAnisotropy}`;
  const cached = textureCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;

  const context = canvas.getContext("2d");

  if (!context) {
    return new Texture();
  }

  const base = color.clone();
  const dark = color.clone().offsetHSL(0, -0.08, -0.24);
  const light = color.clone().offsetHSL(0, -0.04, 0.16);

  context.fillStyle = base.getStyle();
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.lineWidth = 38;
  context.strokeStyle = dark.getStyle();

  for (let x = -canvas.height; x < canvas.width + canvas.height; x += 116) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + canvas.height, canvas.height);
    context.stroke();
  }

  context.lineWidth = 13;
  context.strokeStyle = light.getStyle();

  for (let x = -canvas.height; x < canvas.width + canvas.height; x += 116) {
    context.beginPath();
    context.moveTo(x + 40, 0);
    context.lineTo(x + canvas.height + 40, canvas.height);
    context.stroke();
  }

  context.fillStyle = "rgba(255, 255, 255, 0.18)";
  context.beginPath();
  context.arc(canvas.width * 0.25, canvas.height * 0.32, 42, 0, Math.PI * 2);
  context.fill();

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1.45, 1.05);
  texture.generateMipmaps = true;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  textureCache.set(cacheKey, texture);

  return texture;
}
