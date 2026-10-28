// How compile-time.mjs reads perf, on outputs captured from this box.
//
//   node --test tooling/gate/cputime.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERF_ARGS, countedLaunch, parsePerf, parseMeasurement, parseUserEvents } from "./cputime.mjs";

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
  assert.ok(!PERF_ARGS.includes("--no-inherit"));
  assert.ok(PERF_ARGS.includes("--no-big-num"));
  // What the first version did with the scaled output of run 1: undo each
  // line's scaling by its printed share, and add a line whose share printed as
  // 0.00 whole. The slow kind ran under half a percent of the run, so its
  // line was the whole run's work extrapolated, and the module read 1.49x.
  const undo = (text) => text.split("\n").map((l) => l.split(",")).filter((f) => /instructions/.test(f[2] ?? ""))
    .reduce((s, f) => s + (Number(f[4]) > 0 ? (Number(f[0]) * Number(f[4])) / 100 : Number(f[0])), 0);
  assert.ok(undo(RUN1_SCALED) / parsePerf(RUN1_RAW) > 1.4);
});

test("launch output sums hybrid counts and uses waited-command user plus sys CPU", () => {
  const text = `
     123456789 cpu_atom/instructions/u (42.37%)
     987654321 cpu_core/instructions/u (57.63%)
     1.500000000 seconds time elapsed
     0.239235000 seconds user
     0.002937000 seconds sys
  `;
  const row = parseMeasurement(text);
  assert.equal(row.instructions, 1111111110);
  assert.equal(row.cpu_s, 0.239235 + 0.002937);
  assert.equal(parseMeasurement("123 instructions:u").cpu_s, null);
});

test("extra user counters keep inheritance and pin before counting starts", () => {
  const legacy = countedLaunch("nts",["hir"]);
  assert.equal(legacy.command,"timeout");
  assert.deepEqual(legacy.args.slice(4),PERF_ARGS);
  const extra = countedLaunch("nts",["hir"],{cpu:4,events:["cycles","branch-misses"]});
  assert.equal(extra.command,"taskset"); assert.deepEqual(extra.args.slice(0,3),["-c","4","timeout"]);
  assert.ok(extra.args.includes("instructions:u,cycles:u,branch-misses:u"));
  assert.ok(!extra.args.includes("--no-inherit")); assert.ok(extra.args.includes("--no-scale"));
  assert.throws(()=>countedLaunch("nts",[],{events:["cycles"]}));
  assert.throws(()=>countedLaunch("nts",[],{cpu:4,events:["instructions"]}));
});

test("pinned metrics reject empty, duplicate, unsupported and multiplexed values", () => {
  const text = "123,,cpu_core/instructions/u,999,100.00,,\n<not counted>,,cpu_atom/instructions/u,0,0.00,,\n456,,cpu_core/cycles/u,999,100.00,,\n0,,cpu_core/branch-misses/u,999,100.00,,\n";
  const parsed = parseUserEvents(text,["instructions","cycles","branch-misses"]);
  assert.equal(parsed.instructions.value,123); assert.equal(parsed.cycles.value,456); assert.equal(parsed["branch-misses"].value,0);
  assert.deepEqual(parsed.instructions.inactive,["cpu_atom/instructions/u"]);
  for (const bad of [text.replace("123,,",",,"),text.replace("456,,","<not supported>,,"),text.replaceAll("100.00","98.00"),text+"456,,cpu_core/cycles/u,999,100.00,,\n"])
    assert.throws(()=>parseUserEvents(bad,["instructions","cycles"]));
  assert.throws(()=>parseUserEvents(text.replace("<not counted>","12"),["instructions"]));
  assert.throws(()=>parseUserEvents("<not counted>,,cpu_atom/cycles/u,0,0.00,,",["cycles"]));
});

test("CSV counter CPU keeps the waited-command measurement", () => {
  const row=parseMeasurement("123,,cpu_core/instructions/u,999,100.00,,\n0.125,seconds user\n0.025,seconds sys\n");
  assert.equal(row.instructions,123); assert.equal(row.cpu_s,0.15);
});

test("human extra events retain real perf rusage and implicit full running time", () => {
  const raw = ` <not counted> cpu_atom/instructions/u (0.00%)
 50914920 cpu_core/instructions/u
 <not counted> cpu_atom/cycles/u (0.00%)
 74890938 cpu_core/cycles/u
 0.014955945 seconds time elapsed
 0.014926000 seconds user
 0.000000000 seconds sys
 `;
  const events = parseUserEvents(raw,["instructions","cycles"]);
  assert.equal(events.cycles.value,74890938); assert.equal(events.cycles.running_percent,100);
  assert.equal(parseMeasurement(raw).cpu_s,0.014926);
  assert.throws(()=>parseUserEvents(raw.replace("74890938 cpu_core/cycles/u","74890938 cpu_core/cycles/u (98.00%)"),["cycles"]));
  for(const suffix of ["(n/a%)","(98.00%) trailing","(99.00%"])
    assert.throws(()=>parseUserEvents(raw.replace("74890938 cpu_core/cycles/u","74890938 cpu_core/cycles/u "+suffix),["cycles"]));
  assert.equal(parseUserEvents("7 cpu_core/branch-misses/u # 0.12% of all branches",["branch-misses"])["branch-misses"].running_percent,100);
});
