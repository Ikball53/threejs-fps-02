// CINDERLINE v2 — entry program for threejs-fps-02.
// Copies game/ and screenshots/ from this repository to the output directory
// and writes dossier.json with the kit's buildDossier. Node 22 stdlib only.
// It never deletes anything: the output directory is created, never cleared,
// because on the grader /output is a fresh mount and clearing it fails.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

function copyTree(srcDir: string, dstDir: string): number {
  mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(src, dst);
    } else {
      copyFileSync(src, dst);
      count += 1;
    }
  }
  return count;
}

const gameFiles = copyTree(join(ROOT, "game"), join(OUT, "game"));
const shotFiles = copyTree(join(ROOT, "screenshots"), join(OUT, "screenshots"));
// Fail fast if the vendored three.js files did not land: the gate refuses
// an entry without them, and a missing copy is cheaper to catch here.
for (const name of ["three.module.min.js", "three.core.min.js"]) {
  const p = join(OUT, "game", "vendor", "three", name);
  if (!existsSync(p)) throw new Error(`cinderline: missing ${p}`);
}
const dossier = buildDossier(OUT, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(OUT, "dossier.json"), dossier);
console.log(
  `cinderline: ${gameFiles} game files, ${shotFiles} screenshots, dossier ${dossier.length} bytes -> ${OUT}`,
);
