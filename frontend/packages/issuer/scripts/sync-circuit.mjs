// Copies the compiled commit circuits (Poseidon2 2-arity and 3-arity) from
// the app's public/circuits/ output into src/ so tsup/esbuild can inline them
// directly into dist/index.{js,mjs} — the published package ships fully
// self-contained, with no dependency on this repo's file layout.
//
// The circuits themselves are compiled from circuits/{commit,commit3}/src/main.nr
// via circuits/scripts/build.sh; this script only copies the already-built
// artifacts, it doesn't compile Noir.
//
// Runs automatically on prebuild so the copy can never drift from the
// currently-built circuit.

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicCircuits = join(here, "..", "..", "..", "public", "circuits");

function sync(name) {
  const src = join(publicCircuits, `${name}.json`);
  const dest = join(here, "..", "src", `${name}-circuit.json`);
  copyFileSync(src, dest);
  console.log(`[sync-circuit] copied ${src} -> ${dest}`);
}

sync("commit");
sync("commit3");
