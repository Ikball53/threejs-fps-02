// IRONVEIL — Dockside Foundry. The program that hands the game in.
//
// It runs under Node 22 with the standard library only, inside the grader's
// container (or with MAKEFUN_OUTPUT_DIR set while developing). It takes the
// playable game and the four screenshots from beside this file, places them
// under the output directory, and writes the dossier the judge reads with
// the kit's own library, so the dossier always matches the files exactly.
//
// The program never writes anything outside the output directory, never
// removes a directory, and never touches the network: two runs on the same
// repository write byte-identical output.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Where this file lives, and where the entry goes.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, taken from the kit's gate: the text cap shapes the
// dossier; the other caps refuse an entry the scorer would refuse, so the
// program applies them here and fails loudly instead of handing in bad work.
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// The whole game, exactly as it sits in the repository.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// The four staged renders, exactly as they were captured from the live game.
const shotDir = join(repoRoot, 'screenshots');
if (existsSync(shotDir)) {
  cpSync(shotDir, join(outDir, 'screenshots'), { recursive: true });
}

// Guardrail: the game is not an entry without its page, and the judge
// reads the dossier the library writes — so refuse to hand in a broken
// tree instead of writing a dossier for it.
if (!existsSync(join(outDir, 'game', 'index.html'))) {
  throw new Error('IRONVEIL: game/index.html is missing, refusing to hand in');
}

// The dossier: screenshots plus every line of the game's source, as the
// library reads them from the output directory just written.
const dossier = buildDossier(outDir, dossierCaps);
writeFileSync(join(outDir, 'dossier.json'), dossier);

// One line of proof on stdout: the dossier's size and the screenshots it
// carries, so a run's log shows the entry went out whole.
const shotCount = existsSync(join(outDir, 'screenshots'))
  ? readdirSync(join(outDir, 'screenshots')).filter((n) => !n.startsWith('.')).length
  : 0;
console.log(`IRONVEIL handed in: dossier ${dossier.length} bytes, ${shotCount} screenshots`);
