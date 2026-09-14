// The inner half of `differential-ts.mjs`, run through `run-one.mjs` so that
// `require(module)` is the substituted TypeScript module.
//
// It cannot compare anything itself: inside the substitution, `node:path` and
// `path` are the same object, so node's real module is unreachable from here.
// It computes one side and prints it; the host computes the other.
"use strict";

const { readFileSync } = require("node:fs");

const moduleName = process.env.NTS_DIFF_MODULE;
const inputsPath = process.env.NTS_DIFF_INPUTS;
const corporaPath = process.env.NTS_DIFF_CORPORA;

const isThenable = (v) =>
  v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";

/**
 * **A promise that reaches the comparison makes it vacuous, so this refuses one loudly.**
 *
 * The host renders with `JSON.stringify`, and an unresolved promise renders as `{}` on both
 * sides -- so a spec that forgets an `await` inside an array does not fail, it *agrees*, for
 * every input, forever. That is the shape this directory keeps producing: a check whose answer
 * cannot depend on its input.
 *
 * The top-level result is awaited below, so only a promise nested one level can arrive here.
 * It exits rather than throwing, because a throw would be caught as the spec's own rejection
 * and compared -- and both sides would reject identically, which agrees and means nothing.
 */
function settled(value, label) {
  // **A joined string is where this actually goes wrong.** The array check below never fired
  // for the spec that prompted it, because the spec ends `[...].join("|")` -- so an unawaited
  // promise is already `[object Promise]` inside a string by the time it arrives, identical on
  // both sides. Removing one `await` from a real spec produced 0 divergences and no complaint.
  if (typeof value === "string" && value.includes("[object Promise]")) {
    console.error(
      `${label}: an unawaited promise was stringified into the result. Await it inside the ` +
      "spec; `[object Promise]` is identical on both sides and the comparison cannot fail.",
    );
    process.exit(2);
  }
  if (Array.isArray(value)) {
    for (let at = 0; at < value.length; at++) {
      if (isThenable(value[at])) {
        console.error(
          `NTSDIFF-ERROR ${label}: element ${at} is a promise. Await it inside the spec; ` +
          "unresolved it renders as {} on both sides and the comparison cannot fail.",
        );
        process.exit(2);
      }
    }
  }
  return value;
}

const call = async (fn, args, label) => {
  try {
    return { value: settled(await fn(...args), label) };
  } catch (error) {
    return { threw: `${error.name}: ${error.message}`, code: error.code ?? null };
  }
};

import(corporaPath).then(async ({ CORPORA }) => {
  const corpus = CORPORA[moduleName];
  const target = require(moduleName);
  const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));

  // Sequential rather than `Promise.all`. These specs schedule timers and streams, and
  // running them concurrently would let one program's callbacks land inside another's --
  // which is the ordering this profile is being compared on.
  const rows = [];
  for (const input of inputs) {
    const row = [];
    for (const spec of corpus.calls) {
      const label = spec.label ?? spec.name;
      if (typeof spec.call === "function") {
        try {
          row.push({ value: settled(await spec.call(target, input), label) });
        } catch (error) {
          row.push({ threw: `${error.name}: ${error.message}`, code: error.code ?? null });
        }
        continue;
      }
      const fn = target[spec.name];
      if (typeof fn !== "function") { row.push({ absent: true }); continue; }
      row.push(await call(fn, spec.args(input), label));
    }
    rows.push(row);
  }
  console.log("NTSDIFF " + JSON.stringify(rows));
});
