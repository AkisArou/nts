// expect: emit-c --rc -> lacks-c module__init(
//
// **FIXED 2026-10-07, kept as a guard** (MainClaude): a declaration file is
// never evaluated, as TypeScript emits nothing for one, so its statements are
// none of module evaluation's (`is_declaration_file` in `module_statements`).
// The report as filed, which expected the `module__init` below:
//
// A program with no module-level state gets a `module__init` -- empty, its
// body `return;` -- when the Chromium overlay (lib-dom-bindings.d.ts) is
// among its files: the overlay's bound global declarations (`declare var
// document: Document;`, `declare var window: ...`) make one. program.h says
// "If `module__init` is declared below, ... the program has module-level
// state", and an embedder keys on that: tooling/chromium/app.ts refuses an
// app with module state (module state is process-wide, an app's document
// is not; runtime/chromium/contracts/workarounds.md, 9). Since
// target.chromium() puts the overlay into every program, every app now
// declares one. Found 2026-10-07 switching app.ts to target.chromium().
//
// Control, one difference -- the overlay left out of tsconfig.json's files:
// no `module__init` is declared.

import type { Document } from "nts:dom";
export function main(document: Document): void {
  const body = document.body;
  if (body !== null) body.textContent = "ready";
}
