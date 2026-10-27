// run: check
// backend: llvm

// L10: the decorator replaces value() with a function returning twice its value.
// Plain differs only by the decorator and must agree with Node.
// Node uses decorated.mjs, the checked TypeScript 7.0.2 ES2022 emit of
// decorated.mts; TypeScript resolves the same import to .mts for nts.
// Regenerate with: node node_modules/typescript/bin/tsc --ignoreConfig
// --target es2022 --module es2022 --strict --outDir <scratch> src/decorated.mts

import { Thing, Plain } from "./decorated.mjs";
export function decorated(n: number): number { return new Thing().value() + (n & 7); }
export function undecorated(n: number): number { return new Plain().value() + (n & 7); }
