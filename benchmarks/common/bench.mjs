// The JavaScript side of the same measurement, kept deliberately parallel to
// benchmarks/common/main.c: same calibration, same best-of-five, same output.
//
// Node 24 strips TypeScript types natively, so a case imports its own `.ts`
// source rather than a hand-maintained JavaScript copy. There is no second
// version of the program to drift.
//
// Counting mode (tooling/bench/README.md is the spec) is selected by
// NTS_BENCH_COUNT_MODE. The timed path below is the original code shape on
// purpose: its warmup loop lives inside measure() so the whole function is
// OSR-compiled before the timed loop runs, and node's column — every row's
// denominator — measures the same thing it always did. Counting branches
// before it and changes none of it.
import { closeSync, openSync, readSync, writeSync } from "node:fs";

// The sixty-four bits, not the number's text: `%.17g` and JavaScript's
// shortest round-trip disagree on values like 0.1, and the runner compares
// checksums as strings. (The timed path spells this inline, as it always
// has; the counting paths share this spelling.)
function checksumBits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

function perfCommand(control, acknowledgement, value) {
  writeSync(control, value + "\n");
  const byte = Buffer.alloc(1);
  let message = "";
  while (!message.endsWith("\n")) {
    if (readSync(acknowledgement, byte, 0, 1, null) !== 1) {
      throw new Error("perf control acknowledgement missing");
    }
    message += byte.toString();
  }
  // perf appends a NUL after ack\n; it can prefix the next acknowledgement.
  message = message.replaceAll("\0", "");
  if (message !== "ack\n") {
    throw new Error("unexpected perf acknowledgement: " + JSON.stringify(message));
  }
}

// The one loop counting mode warms up and counts, spelled once so warmup
// tiers up the very loop the counter then brackets — a warmup in a different
// shape would leave the counted loop to be compiled mid-count on a TurboFan
// worker, and its instructions would move with scheduling.
function runLoop(run, reps) {
  let sink = 0;
  for (let i = 0; i < reps; i++) {
    sink += run();
  }
  return sink;
}

function calibrate(run, checksum) {
  // The timed path's warmup bounds: 20,000 calls or 300 ms.
  const until = process.hrtime.bigint() + 300_000_000n;
  let warmed = 0;
  while (warmed < 20000 && process.hrtime.bigint() < until) {
    run();
    warmed++;
  }
  let reps = 1;
  let elapsed = 0;
  let sink = 0;
  for (;;) {
    const start = process.hrtime.bigint();
    sink += runLoop(run, reps);
    elapsed = Number(process.hrtime.bigint() - start);
    if (elapsed >= 20_000_000 || reps >= 50_000_000) break;
    reps = Math.min(reps * 2, 50_000_000);
  }
  if (Number.isNaN(sink)) throw new Error("unreachable");
  process.stderr.write("NTS_BENCH_SINK " + checksumBits(sink) + "\n");
  console.log(JSON.stringify({ checksum: checksumBits(checksum), warmup: warmed, nsPerOp: elapsed / reps, reps }));
}

function count(run, checksum) {
  const n = Number(process.env.NTS_BENCH_COUNT_N);
  const warmed = Number(process.env.NTS_BENCH_COUNT_WARMUP);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(warmed) || warmed < 0) {
    throw new Error("fixed counts are required: NTS_BENCH_COUNT_N and NTS_BENCH_COUNT_WARMUP");
  }
  // Warm up the loop being counted, outside the bracket.
  runLoop(run, warmed);
  const control = openSync(process.env.NTS_BENCH_COUNT_CONTROL, "w");
  const acknowledgement = openSync(process.env.NTS_BENCH_COUNT_ACK, "r");
  perfCommand(control, acknowledgement, "enable");
  const start = process.hrtime.bigint();
  const sink = runLoop(run, n);
  const elapsed = Number(process.hrtime.bigint() - start);
  perfCommand(control, acknowledgement, "disable");
  closeSync(control);
  closeSync(acknowledgement);
  if (Number.isNaN(sink)) throw new Error("unreachable");
  console.log(JSON.stringify({
    checksum: checksumBits(checksum),
    warmup: warmed,
    n,
    elapsedNs: elapsed,
    nsPerOp: elapsed / n,
    sink,
  }));
}

export function measure(run) {
  const checksum = run();

  const mode = process.env.NTS_BENCH_COUNT_MODE;
  if (mode === "calibrate") return calibrate(run, checksum);
  if (mode === "count") return count(run, checksum);
  if (mode !== undefined) throw new Error("unknown NTS_BENCH_COUNT_MODE: " + mode);

  // Let the JIT reach steady state. Timing a cold interpreter would flatter us
  // enormously and mean nothing.
  //
  // Bounded by *time* as well as by count. Twenty thousand iterations is right
  // for a one-microsecond case and absurd for a twenty-millisecond one, where
  // it is eight minutes of warmup for a half-second measurement -- and a
  // benchmark that takes eight minutes to warm up does not get run. A long
  // call tiers up inside itself through on-stack replacement, so it does not
  // need the count anyway.
  const until = process.hrtime.bigint() + 300_000_000n;
  for (let i = 0; i < 20000 && process.hrtime.bigint() < until; i++) {
    run();
  }

  const probe = process.hrtime.bigint();
  run();
  const one = Number(process.hrtime.bigint() - probe);
  let reps = Math.floor(1e8 / Math.max(one, 1));
  reps = Math.min(Math.max(reps, 1), 50_000_000);

  let best = Infinity;
  let sink = 0;
  for (let trial = 0; trial < 5; trial++) {
    const began = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) {
      sink += run();
    }
    const per = Number(process.hrtime.bigint() - began) / reps;
    if (per < best) {
      best = per;
    }
  }

  if (Number.isNaN(sink)) {
    throw new Error("unreachable");
  }
  process.stderr.write("NTS_BENCH_SINK " + checksumBits(sink) + "\n");
  // The sixty-four bits, not the number's text. See the comment in main.cpp:
  // `%.17g` and JavaScript's shortest round-trip disagree on values like 0.1,
  // and the runner compares checksums as strings.
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, checksum);
  const bits = view.getBigUint64(0).toString(16).padStart(16, "0");
  process.stdout.write(`${best.toFixed(4)} ${bits}\n`);
}

// Reload a bit-preserving input through shared atomic storage on every call.
// A cached argv value alone lets an AOT optimizer hoist a pure workload.
const opaqueGate = new Int32Array(new SharedArrayBuffer(4));
const opaqueScratch = new ArrayBuffer(8);
const opaqueFloat = new Float64Array(opaqueScratch);
const opaqueWords = new Int32Array(opaqueScratch);
export function opaqueInput(value) {
  opaqueFloat[0] = value;
  opaqueWords[0] = opaqueWords[0] ^ Atomics.load(opaqueGate, 0);
  return opaqueFloat[0];
}
