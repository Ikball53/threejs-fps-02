// main.ts — entrypoint for the Ember Yard three.js FPS entry.
// Copies game/ and screenshots/ into the output directory (env
// MAKEFUN_OUTPUT_DIR, else /output) and writes /output/dossier.json with
// buildDossier from ./vendor/makefun-threejs.ts. Deterministic: files are
// copied in sorted order and no timestamps are written anywhere, so two
// runs produce identical bytes.

import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function listSorted(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const name of listSorted(src)) {
    const from = join(src, name);
    const to = join(dst, name);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else cpSync(from, to);
  }
}

function main(): void {
  for (const name of ['game', 'screenshots']) {
    if (!statSync(join(repoRoot, name), { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`missing required directory: ${name}/`);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyTree(join(repoRoot, 'game'), join(outDir, 'game'));
  copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 256 * 1024 },
    game_max_files: 993,
    game_max_bytes: 48 * 1024 * 1024,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
}

main();
