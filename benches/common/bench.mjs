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
  for (let i = 0; i < 20000; i++) {
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
