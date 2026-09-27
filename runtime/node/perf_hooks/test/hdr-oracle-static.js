// Every number a histogram reports, against node's own on the same recordings.
//
// Preserves node v24.20.0 `src/histogram-inl.h` and the HdrHistogram_c it
// wraps: `min`, `max`, `mean`, `stddev`, `exceeds`, `percentile`,
// `percentiles`, and their bigint twins, after `record`, a refused record, and
// `add` between histograms of different layouts.
//
// Upstream's own test records the value 1 and nothing else, which every
// histogram gets right. The answers that depend on the bucket arithmetic --
// a value's equivalence range, where `highest` puts the last bucket, what a
// percentile lands on between buckets -- only show with many values across
// many magnitudes, and node is the oracle for them: the scenarios below run in
// a child `node`, whose `perf_hooks` is node's, and here, where it is ours.
//
// Recordings stay below the magnitudes where node's `mean` sums its int64
// `count * value` past 2^53 and the two diverge by rounding alone; values past
// 2^53 are asserted through the answers that do not sum.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const { createHistogram } = require("perf_hooks");

// The scenarios, as source, so the oracle runs exactly this code.
const scenarios = String.raw`
function scenarios(createHistogram) {
  let seed = 0x2545f491;
  const random = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  const report = (h) => ({
    count: h.count,
    exceeds: h.exceeds,
    min: h.min,
    max: h.max,
    minBigInt: String(h.minBigInt),
    maxBigInt: String(h.maxBigInt),
    mean: h.mean,
    stddev: h.stddev,
    percentile: [0.001, 1, 10, 25, 50, 75, 90, 99, 99.9, 99.99, 100].map((p) => h.percentile(p)),
    percentileBigInt: [1, 50, 100].map((p) => String(h.percentileBigInt(p))),
    percentiles: [...h.percentiles].map(([p, v]) => [p, Number(v)]),
  });
  const out = {};
  const layouts = {
    default: {},
    lowest1000: { lowest: 1000 },
    narrow: { lowest: 7, highest: 1e6, figures: 2 },
    figures5: { figures: 5 },
    tiny: { lowest: 1, highest: 11, figures: 1 },
    wide: { lowest: 3n, highest: 2n ** 60n - 1n, figures: 3 },
  };
  for (const [name, options] of Object.entries(layouts)) {
    out[name + ":empty"] = report(createHistogram(options));
    const h = createHistogram(options);
    for (let i = 0; i < 4000; i++) {
      const magnitude = Math.floor(random() * 30);
      h.record(1 + Math.floor(random() * 2 ** magnitude));
    }
    h.record(1);
    h.record(2 ** 31);
    out[name] = report(h);
  }
  {
    const h = createHistogram({ lowest: 1, highest: 1000, figures: 3 });
    for (const v of [1, 999, 1000, 1001, 2047, 2048, 5000, 1e9]) h.record(v);
    out.exceeds = report(h);
  }
  {
    const h = createHistogram({ lowest: 1n, highest: 2n ** 62n, figures: 3 });
    for (const v of [2n ** 53n + 1n, 2n ** 55n + 12345n, 2n ** 61n - 1n, 2n ** 62n - 1n]) h.record(v);
    h.record(2n ** 63n - 1n);
    out.bigValues = {
      count: h.count,
      exceeds: h.exceeds,
      minBigInt: String(h.minBigInt),
      maxBigInt: String(h.maxBigInt),
      percentileBigInt: [1, 25, 50, 75, 100].map((p) => String(h.percentileBigInt(p))),
    };
  }
  {
    const a = createHistogram({ lowest: 1000 });
    const b = createHistogram({ lowest: 1, highest: 5000, figures: 2 });
    for (let i = 1; i < 3000; i += 7) a.record(i * 3);
    for (let i = 1; i < 4000; i += 11) b.record(i);
    b.add(a);
    out.addNarrowing = report(b);
    a.add(b);
    out.addWidening = report(a);
  }
  for (const options of [{ highest: 10n }, { lowest: 5n, highest: 9n }, { lowest: 2 ** 40, highest: 2 ** 41 - 1 }]) {
    try {
      createHistogram(options);
      out["options:" + String(options.lowest) + ":" + String(options.highest)] = "created";
    } catch (error) {
      out["options:" + String(options.lowest) + ":" + String(options.highest)] =
        error.name + " " + error.code + " " + error.message;
    }
  }
  return out;
}
`;

const oracle = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "-e",
      `${scenarios}\nprocess.stdout.write(JSON.stringify(scenarios(require("node:perf_hooks").createHistogram)));`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);

// eslint-disable-next-line no-new-func
const ours = new Function(`${scenarios}\nreturn scenarios;`)()(createHistogram);

// Round-tripped through JSON as the oracle was, so NaN compares as `null` on
// both sides rather than failing on representation.
const actual = JSON.parse(JSON.stringify(ours));

assert.ok(Object.keys(oracle).length >= 17, "the oracle reported too few scenarios to be real");
for (const name of Object.keys(oracle)) {
  assert.deepStrictEqual(actual[name], oracle[name], `scenario ${name}`);
}
