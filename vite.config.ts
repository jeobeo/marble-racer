import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const MUSIC_DIRECTORY = resolve("public/music");
const MUSIC_MANIFEST_PATH = resolve(MUSIC_DIRECTORY, "manifest.json");
const MUSIC_EXTENSIONS = new Set([".mp3", ".wav"]);

function readMusicTrackUrls(): string[] {
  try {
    return readdirSync(MUSIC_DIRECTORY, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MUSIC_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => `/music/${encodeURIComponent(entry.name)}`)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function writeMusicManifest(): string {
  mkdirSync(MUSIC_DIRECTORY, { recursive: true });
  const manifest = JSON.stringify(readMusicTrackUrls(), null, 2);
  writeFileSync(MUSIC_MANIFEST_PATH, `${manifest}\n`, "utf8");
  return manifest;
}

function musicManifestPlugin(): Plugin {
  return {
    name: "music-manifest",
    buildStart() {
      writeMusicManifest();
    },
    configureServer(server) {
      server.middlewares.use("/music/manifest.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(writeMusicManifest());
      });
    },
  };
}

export default defineConfig({
  plugins: [musicManifestPlugin(), wasm(), topLevelAwait()],
});
