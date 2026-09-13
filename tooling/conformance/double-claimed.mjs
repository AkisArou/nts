// Files more than one module claims, and whether the modules agree about them.
//
//   node tooling/conformance/double-claimed.mjs [--run]
//
// # Why this matters to every number in the ledger
//
// A module's denominator is its `test-pattern` plus its `extra-tests` plus its
// `test-suites`. Nothing stops two modules matching the same file, and when they do
// the file is counted twice -- once in each module's row -- so any **sum across
// modules** double-counts it. The compiled axis is such a sum.
//
// Worse, the two rows need not agree. A lane substitutes only the modules in its
// `uses`, so the same file runs against different code in each:
//
//     test-cluster-net-send.js   child_process lane: 1 passed
//                                cluster lane:       1 failed
//
// because `cluster` uses `net` and `child_process` does not. That file was claimed by
// `child_process/extra-tests` on the recorded grounds that "upstream names it for
// cluster, which this profile does not implement" -- true when written, false from the
// day `cluster` landed, and re-read by nobody. Released on 2026-09-13.
//
// # What it found on 2026-09-13
//
//     8 files claimed twice, 6 agreeing (stream/zlib) and 2 disagreeing:
//       test-stream-preprocess.js                 readline passes, stream fails
//       test-stream2-httpclient-response-end.js   http passes, stream fails
//
// The compiled axis was **not** inflated by any of them, and the argument is short
// enough to check: every one of the eight is shared with `stream`, and `stream`'s only
// compiled pass is `local/default-highwatermark-static.js`, which no other module
// claims. So no shared file passes compiled in two modules. The *interpreted* sum is a
// different story -- the six stream/zlib files pass in both lanes, so adding interpreted
// passes across modules over-counts by six.
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "../..");
const PARALLEL = join(ROOT, "third_party/node/test/parallel");
const run = process.argv.includes("--run");

const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
    : [];

const tests = readdirSync(PARALLEL).sort();
const claims = new Map();
const claim = (file, module) => {
  const held = claims.get(file) ?? new Set();
  held.add(module);
  claims.set(file, held);
};

for (const module of readdirSync(join(ROOT, "runtime/node")).sort()) {
  const dir = join(ROOT, "runtime/node", module);
  if (!existsSync(join(dir, "tsconfig.json"))) continue;
  const [written] = lines(join(dir, "test-pattern"));
  // The default when a module names no pattern, matching `run.mjs`: the module's own
  // name, with `_` allowed to appear as `-`.
  const pattern = new RegExp(
    written ?? `^test-${module.replaceAll("_", "[-_]")}(-.*)?\\.(?:js|mjs)$`,
  );
  for (const test of tests) if (pattern.test(test)) claim(test, module);
  for (const entry of lines(join(dir, "extra-tests"))) {
    const name = entry.split(":")[0].trim();
    if (name.endsWith(".js") || name.endsWith(".mjs")) claim(name, module);
  }
}

const shared = [...claims].filter(([, held]) => held.size > 1)
  .map(([file, held]) => [file, [...held].sort()]).sort();

console.log(`  ${shared.length} file(s) claimed by more than one module\n`);
if (shared.length === 0) process.exit(0);

const passes = (module, file) => {
  const out = execFileSync(process.execPath, [
    join(HERE, "run.mjs"), "--module", module, "--only", file,
  ], {
    encoding: "utf8", cwd: ROOT,
    env: { ...process.env, NTS_CONFORMANCE_TIMEOUT_MS: "20000", NTS_TEST_TMPDIR_ID: `dc-${module}` },
  });
  const tail = out.trim().split("\n").pop() ?? "";
  return /1 passed/.test(tail);
};

let disagreeing = 0;
for (const [file, held] of shared) {
  if (!run) { console.log(`  ${file.padEnd(50)} ${held.join(" ")}`); continue; }
  const results = held.map((m) => [m, passes(m, file)]);
  const agree = new Set(results.map(([, p]) => p)).size === 1;
  if (!agree) disagreeing += 1;
  console.log(
    `  ${file.padEnd(50)} ${results.map(([m, p]) => `${m}=${p ? "pass" : "FAIL"}`).join(" ")}` +
    `${agree ? "" : "   DISAGREE"}`,
  );
}
if (!run) {
  console.log("\n  pass --run to execute each file in each claiming lane and compare.");
  process.exit(0);
}
console.log(`\n  ${disagreeing} file(s) disagree between the lanes that claim them.`);
process.exit(disagreeing === 0 ? 0 : 1);
