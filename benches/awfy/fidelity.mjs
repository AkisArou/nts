// Does the TypeScript port compute what the original computes?
//
// The checksum rule in the benchmark runner catches a *variant* that computes
// the wrong answer. It cannot catch a port that computes the right answer too
// cheaply -- an annotation that hands the analysis a fact V8 has to discover, a
// loop restructured while transcribing, an object flattened because the object
// orientation was inconvenient. Each of those produces a benchmark that agrees
// with itself and measures something else.
//
// So this runs Are We Fast Yet's own JavaScript and our TypeScript on the same
// engine and compares. It is the only check that is about *fidelity* rather
// than about correctness, and it costs one script.
//
// Skips with a message when the upstream clone is absent; `.gitignore` says how
// to make one.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const upstream = join(here, "../../third_party/are-we-fast-yet/benchmarks/JavaScript");

if (!existsSync(upstream)) {
  console.log("SKIP: third_party/are-we-fast-yet is not cloned");
  process.exit(0);
}

const require = createRequire(import.meta.url);

// Each entry is the benchmark's name, the inner-iteration count its
// `verifyResult` knows an answer for, and how to get one number out of each
// side. Most are `benchmark()`; the two that override `innerBenchmarkLoop`
// compute their result from the iteration count instead.
const CASES = [
  { name: "bounce", run: (b) => b.benchmark() },
  { name: "list", run: (b) => b.benchmark() },
  { name: "mandelbrot", run: (b) => b.mandelbrot(500) },
  // Overrides `innerBenchmarkLoop`, so there is no `benchmark()` upstream to
  // call. Both sides check the same recorded constant instead, which is a
  // stronger statement than agreeing with each other.
  {
    name: "nbody",
    run: (b) => b.innerBenchmarkLoop(250000),
    ours: (b) => b.verifyResult(b.benchmark()),
  },
  { name: "permute", run: (b) => b.benchmark() },
  { name: "queens", run: (b) => b.benchmark(), ours: (b) => b.benchmark() === 1 },
  { name: "sieve", run: (b) => b.benchmark() },
  { name: "storage", run: (b) => b.benchmark() },
  { name: "towers", run: (b) => b.benchmark() },
];

const CLASSES = {
  bounce: "Bounce",
  list: "List",
  mandelbrot: "Mandelbrot",
  nbody: "NBody",
  permute: "Permute",
  queens: "Queens",
  sieve: "Sieve",
  storage: "Storage",
  towers: "Towers",
};

let failures = 0;
for (const { name, run, ours } of CASES) {
  const original = require(join(upstream, `${name}.js`)).newInstance();
  const ported = new (await import(`./src/${name}.ts`))[CLASSES[name]]();

  const theirs = run(original);
  const mine = (ours ?? run)(ported);
  const agree = Object.is(theirs, mine);
  if (!agree) {
    failures += 1;
  }
  console.log(`${agree ? "ok  " : "FAIL"} ${name.padEnd(12)} upstream ${theirs}  port ${mine}`);
}

if (failures) {
  console.log(`\n${failures} benchmark(s) do not match the original.`);
  process.exit(1);
}
console.log(`\n${CASES.length} benchmark(s) match the original.`);
