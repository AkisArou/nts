// Our React against upstream's, on the same scenarios (scenarios.cjs), each
// arm in its own process. Both are production builds: ours from
// tools/build-js.ts, upstream's the stable build the conformance harness
// uses. Every scenario must leave the same host tree on both arms.
//
// What it measures, from profiles of both arms (2026-09-26):
// - `mount` is mostly the noop renderer's own host: its createInstance hides
//   fields with Object.defineProperty, about two thirds of the time on both.
// - `reverse` and `swap` at thousands of rows are the noop host's
//   indexOf/splice per move, which is quadratic, on both.
// - `updateEvery10th` and `stateUpdates` are the reconciler's own work, and
//   the ones to read. Ours ran 1.1-1.2x upstream there. Upstream's build is
//   Closure-compiled and inlined, and ours esbuild's; the one clear
//   difference in our code is createElement's `...children`, an array per
//   call that upstream builds only for two children or more.
// Every timing under a few milliseconds moves by 20% or more between runs:
// take BENCH_ROWS=10000 for anything read closely.
//
// usage: node bench/compare.mjs
//   NTS_REACT_UPSTREAM as conformance/upstream-tests/run.ts reads it;
//   BENCH_ROWS, BENCH_ITERATIONS and BENCH_WARMUP go to scenarios.cjs.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const lane = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = process.env.NTS_REACT_UPSTREAM ?? join(homedir(), ".cache/nts-react/upstream");
const arms = {
  upstream: join(upstream, "build/oss-stable"),
  nts: join(lane, "build/js/production"),
};

const results = {};
for (const [arm, root] of Object.entries(arms)) {
  if (!existsSync(join(root, "react-noop-renderer"))) throw new Error(`the ${arm} arm is not built: ${root}`);
  // A directory outside the workspace, whose node_modules names this arm's
  // packages; with --preserve-symlinks their own requires resolve there too.
  const dir = join(homedir(), ".cache/nts-react", `bench-${arm}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  for (const name of ["react", "react-noop-renderer", "scheduler", "react-reconciler"]) {
    if (existsSync(join(root, name))) symlinkSync(join(root, name), join(dir, "node_modules", name));
  }
  // The scenarios run from there too: a require resolves from its file.
  copyFileSync(join(lane, "bench/scenarios.cjs"), join(dir, "scenarios.cjs"));
  const out = execFileSync(process.execPath, ["--preserve-symlinks", join(dir, "scenarios.cjs")], {
    cwd: dir,
    env: { ...process.env, NODE_ENV: "production", NODE_PATH: join(dir, "node_modules") },
    encoding: "utf8",
  });
  results[arm] = JSON.parse(out.trim().split("\n").pop());
}

let failures = 0;
console.log("scenario          upstream ms   nts ms   nts/upstream");
for (const name of Object.keys(results.upstream)) {
  const u = results.upstream[name];
  const n = results.nts[name];
  const same = u.fingerprint === n.fingerprint;
  if (!same) failures++;
  console.log(
    `${name.padEnd(16)} ${u.median.toFixed(2).padStart(11)} ${n.median.toFixed(2).padStart(8)} ${(n.median / u.median).toFixed(2).padStart(12)}${same ? "" : "   TREES DIFFER"}`,
  );
}
process.exitCode = failures === 0 ? 0 : 1;
