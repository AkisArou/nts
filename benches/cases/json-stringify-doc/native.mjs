// The half of `json-stringify-doc` the bench harness cannot express: the host's *own* JSON.
//
// The harness compiles one source four ways, so its `node` and `bun` columns are those engines
// running our TypeScript. That answers "does nts lower this well". It does not answer "is our
// JSON faster than node's", because nothing in the table ever calls `JSON.stringify`.
//
// This script does. It builds the identical document as ordinary JavaScript objects and times
// the engine's built-in serializer, so the two numbers can be put beside each other:
//
//     ./target/release/nts-bench json-stringify-doc      -> microseconds per op, compiled
//     node benches/cases/json-stringify-doc/native.mjs   -> milliseconds per serialize, native
//     bun  benches/cases/json-stringify-doc/native.mjs   -> the harder bar
//
// `work(1)` in the case serializes exactly once and returns the text length, so the bench's
// checksum *is* the byte count of the document. This script prints the same number, and if the
// two disagree the documents are not the same document and neither comparison means anything.

const ROWS = 2000;

/** The corpus, mirroring `case.ts` exactly -- same keys, same order, same values. */
function document() {
  const rows = [];
  for (let at = 0; at < ROWS; at++) {
    rows.push({
      id: "8f3a2b1c-" + at,
      name: at % 7 === 0 ? 'Ada "Countess" Lovelace' : "Ada Lovelace",
      email: "user" + at + "@example.test",
      created: "2026-09-08T12:00:00Z",
      score: at * 1.5,
      rank: at,
      active: at % 3 !== 0,
      note: at % 11 === 0 ? "line\nbreak\ttab" : null,
      tags: ["founder", "analyst", "engineering"],
      meta: { level: at % 5, path: "/a/b/c", weight: at / 7 },
    });
  }
  return { version: 1, rows };
}

const doc = document();

// Warm, then calibrate to roughly 100ms of work the way `benches/common/main.cpp` does, so a
// fast engine is not measured against clock granularity.
for (let at = 0; at < 5; at++) JSON.stringify(doc);

const one = (() => {
  const started = process.hrtime.bigint();
  JSON.stringify(doc);
  return Number(process.hrtime.bigint() - started);
})();
const reps = Math.max(5, Math.min(2000, Math.round(1e8 / Math.max(one, 1))));

let sink = 0;
const started = process.hrtime.bigint();
for (let at = 0; at < reps; at++) sink += JSON.stringify(doc).length;
const elapsed = Number(process.hrtime.bigint() - started);

const perOp = elapsed / reps;
const bytes = JSON.stringify(doc).length;

// `sink` is returned into the report so the loop cannot be optimised away.
console.log(
  [
    `engine        ${typeof Bun === "undefined" ? "node " + process.versions.node : "bun " + Bun.version}`,
    `bytes         ${bytes}   <- must equal the bench row's checksum`,
    `per serialize ${(perOp / 1e6).toFixed(3)} ms   (${(perOp / 1e3).toFixed(1)} us)`,
    `reps          ${reps}`,
    `sink          ${sink / reps}`,
  ].join("\n"),
);
