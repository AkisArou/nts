#!/usr/bin/env node
// `cargo test --workspace --no-fail-fast`, with the test binaries run at once.
//
//   node tooling/gate/tests.mjs          (the gate's `tests` step)
//
// cargo builds every test binary in parallel and then runs them **one after
// another**: 173 of them in 315 s, of which the nts-cli unit binary alone is
// 120 s (one test in it, `apple_surface::the_platform_packages_typecheck`, is
// 135 s by itself). Run side by side they take about as long as the slowest.
//
// **How each binary is run is cargo's, not this file's.** The first pass is
// cargo itself -- the same `cargo test --workspace --no-fail-fast` -- with
// `CARGO_TARGET_<host>_RUNNER` pointing at a recorder: cargo compiles
// everything, runs the doctests itself (rustdoc does not use a runner), and for
// every test binary calls the recorder with the exact argv, working directory
// and environment it would have run it with. The recorder writes those down
// and exits 0. The second pass replays every recording, several at once. So the
// working directory (the package root), CARGO_MANIFEST_DIR, CARGO_PKG_*, the
// library path and every other variable a test can read are cargo's own, and a
// new one cargo adds next year comes along without anyone noticing.
//
// The verdict fails closed: the first pass must exit 0 (a compile error or a
// failing doctest fails it), at least one binary must have been recorded, and
// every replayed binary must exit 0. A binary that crashes or is killed fails.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { longestFirst, recordCosts } from "./costs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JOBS = Math.max(1, Number(process.env.NTS_TESTS_JOBS ?? process.env.NTS_GATE_JOBS ?? Math.min(8, cpus().length)));
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "nts-tests-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

const host = /^host: (.+)$/m.exec(spawnSync("rustc", ["-vV"], { encoding: "utf8" }).stdout ?? "")?.[1];
if (!host) {
  console.log("  NOT MEASURED: `rustc -vV` names no host triple, so no runner can be set");
  process.exit(2);
}
const runnerVar = `CARGO_TARGET_${host.toUpperCase().replace(/[-.]/g, "_")}_RUNNER`;
if (process.env[runnerVar]) {
  console.log(`  NOT MEASURED: ${runnerVar} is already set (${process.env[runnerVar]}); this step would replace it`);
  process.exit(2);
}

// The recorder: one JSON file per call, numbered in the order cargo made them.
const recorder = join(work, "record.sh");
const calls = join(work, "calls");
mkdirSync(calls);
writeFileSync(recorder, `#!/bin/sh
n=$(mktemp "${calls}/call-XXXXXXXX")
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1], JSON.stringify({at: process.hrtime.bigint().toString(), cwd: process.cwd(), argv: process.argv.slice(2), env: process.env}))' "$n" "$@"
`);
chmodSync(recorder, 0o755);

const started = Date.now();
const first = spawnSync("cargo", ["test", "--workspace", "--no-fail-fast"], {
  cwd: ROOT,
  env: { ...process.env, [runnerVar]: recorder },
  encoding: "utf8",
  maxBuffer: 1 << 28,
});
const firstOut = `${first.stdout ?? ""}${first.stderr ?? ""}`;
const recorded = readdirSync(calls)
  .map((f) => JSON.parse(readFileSync(join(calls, f), "utf8")))
  .sort((a, b) => (BigInt(a.at) < BigInt(b.at) ? -1 : 1));
for (const r of recorded) delete r.env[runnerVar];
const compiled = (Date.now() - started) / 1000;

if (first.status !== 0) {
  // A compile error, or a doctest that failed: cargo's own output says which.
  console.log(firstOut.split("\n").filter((l) => /^(error|warning: unused|test .* FAILED|failures:|---- )/.test(l)).slice(0, 60).join("\n"));
  console.log(`  cargo test --workspace --no-fail-fast (building, doctests, recording) exited ${first.status ?? first.signal}`);
  process.exit(1);
}
const doctests = (firstOut.match(/^\s+Doc-tests /gm) ?? []).length;
if (recorded.length === 0) {
  console.log(`  NOT MEASURED: cargo ran no test binary through ${runnerVar}, so nothing was tested`);
  process.exit(1);
}

// The replay.
const name = (r) => `${r.cwd.replace(`${ROOT}/`, "")} ${r.argv[0].split("/").pop()}`;
const keyed = new Map(recorded.map((r) => [name(r), r]));
const queue = longestFirst("tests", [...keyed.keys()], () => "/nonexistent");
const results = new Map();
const cost = {};
let next = 0;
const runOne = (key) =>
  new Promise((done) => {
    const r = keyed.get(key);
    const began = Date.now();
    const child = spawn(r.argv[0], r.argv.slice(1), { cwd: r.cwd, env: r.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("error", (e) => { results.set(key, { status: null, signal: null, error: e.message, out }); done(); });
    child.on("close", (status, signal) => {
      cost[key] = (Date.now() - began) / 1000;
      results.set(key, { status, signal, out, seconds: cost[key] });
      done();
    });
  });
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (next < queue.length) await runOne(queue[next++]);
}));
recordCosts("tests", cost);

let passed = 0, failed = 0, ignored = 0;
const bad = [];
for (const r of recorded) {
  const key = name(r);
  const res = results.get(key);
  for (const m of res.out.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)) {
    passed += Number(m[1]); failed += Number(m[2]); ignored += Number(m[3]);
  }
  if (res.status !== 0) bad.push({ key, res });
}
for (const { key, res } of bad) {
  console.log(`  ---- ${key}: ${res.error ?? (res.signal ? `killed by ${res.signal}` : `exit ${res.status}`)}`);
  console.log(res.out.split("\n").filter((l) => /^(test .* FAILED|failures:|---- |thread '.*' panicked|error)/.test(l)).slice(0, 40).map((l) => `    ${l}`).join("\n"));
}
const slowest = [...results].sort(([, a], [, b]) => (b.seconds ?? 0) - (a.seconds ?? 0)).slice(0, 3)
  .map(([k, v]) => `${k.split(" ").pop()} ${Math.round(v.seconds ?? 0)}s`).join(", ");
console.log(`  ${recorded.length} test binaries, ${doctests} doctest crate(s): ${passed} passed, ${failed} failed, ${ignored} ignored` +
  ` (build and doctests ${Math.round(compiled)} s, binaries ${Math.round((Date.now() - started) / 1000 - compiled)} s at ${JOBS} at once; slowest ${slowest})`);
process.exit(bad.length === 0 ? 0 : 1);
