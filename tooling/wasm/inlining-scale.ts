// How much inlining V8 allows each counted module, before and after: the
// share of its functions V8 calls small, and the budget scale that share buys.
//
//   node tooling/wasm/inlining-scale.ts <counted-dir> [--all]
//
// `<counted-dir>` is an `nts-bench --count --out` directory; its
// `artifacts/B` and `artifacts/F` hold each row's module as each arm emitted
// it. Prints every row whose share moved, marking one that crosses 25% or
// 50%; `--all` prints every row. Exit 0 either way, 2 when the instrument
// could not run.
//
// # The rule it reads
//
// V8 (src/wasm/module-decoder-impl.h, src/wasm/inlining-tree.h) counts a
// function body under 50 bytes as small and scales every caller's inlining
// budget by the module's share of them: at 25% or fewer, the low budget (a
// tenth of the cap, a growth factor of 2); at 50% or more, the high one;
// linearly between. It reads few small functions as a toolchain that has
// already inlined. A change that removes refusal stubs or tiny helpers lowers
// the share, and a row can then lose inlining it had, with less code to run.
//
// # Why
//
// Three counts in a week moved for this reason and were attributed only after
// a trace: fib's local order, map-and-set's caller budget, array-methods'
// helpers. A count that lists the crossings beside its rows attributes them
// the day they happen.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SMALL_BYTES = 50;
const LOW = 25;
const HIGH = 50;

const args = process.argv.slice(2);
const all = args.includes("--all");
const [counted] = args.filter((arg) => arg !== "--all");
if (!counted) fail("usage: node tooling/wasm/inlining-scale.ts <counted-dir> [--all]");
const arms = ["B", "F"].map((arm) => join(counted, "artifacts", arm));
for (const arm of arms) if (!existsSync(arm)) fail(`no ${arm}: not an nts-bench --count directory`);

function fail(why: string): never {
  console.error(`inlining-scale: ${why}`);
  process.exit(2);
}

/** The body size of every function the module defines, in wire bytes. */
function bodySizes(bytes: Uint8Array): number[] {
  let at = 8;
  const leb = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (byte < 0x80) return value;
    }
  };
  while (at < bytes.length) {
    const id = bytes[at++];
    const size = leb();
    const end = at + size;
    if (id === 10) {
      const sizes: number[] = [];
      for (let count = leb(); count > 0; count--) {
        const body = leb();
        sizes.push(body);
        at += body;
      }
      return sizes;
    }
    at = end;
  }
  return [];
}

type Scale = { small: number; functions: number; share: number; scale: number };

function scaleOf(module: string): Scale | undefined {
  if (!existsSync(module)) return undefined;
  const sizes = bodySizes(readFileSync(module));
  const small = sizes.filter((size) => size < SMALL_BYTES).length;
  const share = sizes.length ? (100 * small) / sizes.length : 0;
  const scale = share <= LOW ? 0 : share >= HIGH ? 1 : (share - LOW) / (HIGH - LOW);
  return { small, functions: sizes.length, share, scale };
}

const band = (share: number): string => (share <= LOW ? "low" : share >= HIGH ? "high" : "between");
const shown = (it: Scale): string =>
  `${it.small}/${it.functions} small ${it.share.toFixed(1)}% scale ${it.scale.toFixed(2)}`;

let moved = 0;
let crossed = 0;
for (const row of readdirSync(arms[1]).sort()) {
  const [before, after] = arms.map((arm) => scaleOf(join(arm, row, `${row}.wasm`, "program.wasm")));
  if (!before || !after) continue;
  const changed = before.small !== after.small || before.functions !== after.functions;
  const crossing = band(before.share) !== band(after.share);
  if (changed) moved++;
  if (crossing) crossed++;
  if (!all && !changed) continue;
  const mark = crossing ? `  CROSSES ${band(before.share)} -> ${band(after.share)}` : "";
  console.log(`${row.padEnd(30)} ${shown(before)}  ->  ${shown(after)}${mark}`);
}
console.log(`${moved} row(s) changed their small-function share; ${crossed} crossed a band edge (25% or 50%)`);
