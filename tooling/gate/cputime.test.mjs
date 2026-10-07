// How compile-time.mjs reads perf, on outputs captured from this box.
//
//   node --test tooling/gate/cputime.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { PERF_ARGS, followInstructions, instructionsWork, parsePerf } from "./cputime.mjs";

// `nts hir --prepared runtime/node/events`, twice, each counted by two perfs
// attached to the same process: one with PERF_ARGS (raw), one as the first
// version of this file ran it (scaled). 2026-10-07, a quiet box.
const RUN1_RAW = `# started on Wed Oct  7 12:58:18 2026

437435671,,cpu_atom/instructions/u,58433178,0.00,,
281214548494,,cpu_core/instructions/u,18815227346,99.00,,
`;
const RUN1_SCALED = `# started on Wed Oct  7 12:58:18 2026

141289805520,,cpu_atom/instructions/u,58433178,0.00,,
282087897482,,cpu_core/instructions/u,18815227346,99.00,,
`;
const RUN6_RAW = `# started on Wed Oct  7 13:00:01 2026

193545757,,cpu_atom/instructions/u,42558845,0.00,,
281466913576,,cpu_core/instructions/u,17719993461,99.00,,
`;
// A process pinned to the fast cores: the slow kind never ran.
const NOT_COUNTED = `<not counted>,,cpu_atom/instructions/u,0,0.00,,
49614068601,,cpu_core/instructions/u,3141914869,100.00,,
`;

test("the raw count is the sum of the core kinds' counts", () => {
  assert.equal(parsePerf(RUN1_RAW), 437435671 + 281214548494);
  assert.equal(parsePerf(RUN6_RAW), 193545757 + 281466913576);
  // Two runs of the same work agree to within 0.01%.
  assert.ok(Math.abs(parsePerf(RUN1_RAW) / parsePerf(RUN6_RAW) - 1) < 1e-4);
});

test("a kind the process never ran on adds nothing", () => {
  assert.equal(parsePerf(NOT_COUNTED), 49614068601);
});

test("no count line is no count", () => {
  assert.equal(parsePerf(""), null);
  assert.equal(parsePerf("<not supported>,,instructions:u,0,100.00,,\n"), null);
});

test("counts are taken raw: the scaled ones cannot be undone", () => {
  assert.ok(PERF_ARGS.includes("--no-scale"));
  assert.ok(PERF_ARGS.includes("--no-inherit"));
  // What the first version did with the scaled output of run 1: undo each
  // line's scaling by its printed share, and add a line whose share printed as
  // 0.00 whole. The slow kind ran under half a percent of the run, so its
  // line was the whole run's work extrapolated, and the module read 1.49x.
  const undo = (text) => text.split("\n").map((l) => l.split(",")).filter((f) => /instructions/.test(f[2] ?? ""))
    .reduce((s, f) => s + (Number(f[4]) > 0 ? (Number(f[0]) * Number(f[4])) / 100 : Number(f[0])), 0);
  assert.ok(undo(RUN1_SCALED) / parsePerf(RUN1_RAW) > 1.4);
});

test("on this machine, the same work counts the same", { skip: instructionsWork() ?? false }, async () => {
  const counts = [];
  for (let i = 0; i < 3; i++) {
    const child = spawn("sh", ["-c", "i=0; while [ $i -lt 1000000 ]; do i=$((i+1)); done"], { stdio: "ignore" });
    counts.push(await followInstructions(child));
  }
  for (const c of counts) assert.ok(c > 1e8, `counted ${c}`);
  const spread = Math.max(...counts) / Math.min(...counts) - 1;
  // 3%, not 1%: perf attaches after the child starts and loses what it ran
  // first -- measured at 1-2% on this box -- so three identical runs under a
  // gate's load read 24.50, 24.57 and 24.75 G (1.02%) and failed a 1% bound
  // (2026-10-08). The table's own threshold is 2x, so 3% still catches an
  // instrument that has stopped counting the same thing.
  assert.ok(spread < 0.03, `three runs read ${counts.map((c) => (c / 1e9).toFixed(2)).join(", ")} G`);
});
