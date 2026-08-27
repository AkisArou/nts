// The JavaScript side of the same measurement, kept deliberately parallel to
// benches/common/main.c: same calibration, same best-of-five, same output.
//
// Node 24 strips TypeScript types natively, so a case imports its own `.ts`
// source rather than a hand-maintained JavaScript copy. There is no second
// version of the program to drift.
export function measure(run) {
  const checksum = run();

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
  process.stdout.write(`${best.toFixed(4)} ${checksum}\n`);
}
