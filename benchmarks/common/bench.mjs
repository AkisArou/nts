// The JavaScript side of the same measurement, kept deliberately parallel to
// benchmarks/common/main.c: same calibration, same best-of-five, same output.
//
// Node 24 strips TypeScript types natively, so a case imports its own `.ts`
// source rather than a hand-maintained JavaScript copy. There is no second
// version of the program to drift.
//
// Counting mode (tooling/bench/README.md is the spec) is selected by
// NTS_BENCH_COUNT_MODE. Unset, this file is exactly the timed harness above.
// `calibrate` prints the numbers a frozen plan is built from; `count` runs a
// fixed loop bracketed by perf's control FIFO so only the loop is counted.
import { closeSync, openSync, readSync, writeSync } from "node:fs";

// The sixty-four bits, not the number's text. See the comment in main.cpp:
// `%.17g` and JavaScript's shortest round-trip disagree on values like 0.1,
// and the runner compares checksums as strings.
function bits(value) {
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

// Bounded by *time* as well as by count. Twenty thousand iterations is right
// for a one-microsecond case and absurd for a twenty-millisecond one, where
// it is eight minutes of warmup for a half-second measurement -- and a
// benchmark that takes eight minutes to warm up does not get run. A long
// call tiers up inside itself through on-stack replacement, so it does not
// need the count anyway. Returns how many iterations actually ran, which
// counting mode freezes as the plan's warmup.
function warmup(run) {
  const until = process.hrtime.bigint() + 300_000_000n;
  let done = 0;
  while (done < 20000 && process.hrtime.bigint() < until) {
    run();
    done++;
  }
  return done;
}

function calibrate(run, checksum) {
  const warmed = warmup(run);
  let reps = 1;
  let elapsed = 0;
  let sink = 0;
  for (;;) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) sink += run();
    elapsed = Number(process.hrtime.bigint() - start);
    if (elapsed >= 20_000_000 || reps >= 50_000_000) break;
    reps = Math.min(reps * 2, 50_000_000);
  }
  if (Number.isNaN(sink)) throw new Error("unreachable");
  console.log(JSON.stringify({ checksum: bits(checksum), warmup: warmed, nsPerOp: elapsed / reps, reps }));
}

function count(run, checksum) {
  const n = Number(process.env.NTS_BENCH_COUNT_N);
  const warmed = Number(process.env.NTS_BENCH_COUNT_WARMUP);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(warmed) || warmed < 0) {
    throw new Error("fixed counts are required: NTS_BENCH_COUNT_N and NTS_BENCH_COUNT_WARMUP");
  }
  for (let i = 0; i < warmed; i++) run();
  const control = openSync(process.env.NTS_BENCH_COUNT_CONTROL, "w");
  const acknowledgement = openSync(process.env.NTS_BENCH_COUNT_ACK, "r");
  perfCommand(control, acknowledgement, "enable");
  let sink = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) sink += run();
  const elapsed = Number(process.hrtime.bigint() - start);
  perfCommand(control, acknowledgement, "disable");
  closeSync(control);
  closeSync(acknowledgement);
  if (Number.isNaN(sink)) throw new Error("unreachable");
  console.log(JSON.stringify({
    checksum: bits(checksum),
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
  warmup(run);

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
  process.stdout.write(`${best.toFixed(4)} ${bits(checksum)}\n`);
}
