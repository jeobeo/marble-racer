import {
  AmbientLight,
  DirectionalLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

export type SceneBundle = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
};

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(48, 1, 0.1, 140);
  camera.position.set(0, 9, -11);
  camera.lookAt(0, 1.8, 12);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const ambient = new AmbientLight(0xffffff, 1.45);
  scene.add(ambient);

  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-5, 13, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  const fill = new DirectionalLight(0x9cc7ff, 1.2);
  fill.position.set(8, 7, 11);
  scene.add(fill);

  return { scene, camera, renderer };
}

export function resizeScene(bundle: SceneBundle, width: number, height: number): void {
  bundle.camera.aspect = width / Math.max(height, 1);
  bundle.camera.updateProjectionMatrix();
  bundle.renderer.setSize(width, height, false);
}
