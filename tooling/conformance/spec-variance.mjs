// Which differential specs compare a value that is not a function of their input.
//
//   node tooling/conformance/spec-variance.mjs --all
//   node tooling/conformance/spec-variance.mjs path util --iterations 800
//
// `differential-ts.mjs` already refuses four ways a spec can agree while
// measuring nothing: an unawaited promise (`{}` on both sides), a false
// precondition (two identical ENOENTs), a spec naming nothing real (the same
// `TypeError` on both sides), and a `throws: true` spec whose error carries no
// `code`. Every one of those is a spec that *fails* identically.
//
// This is the fifth way, and it is the one that succeeds identically: a spec
// whose answer is the same for every input it is given. It agrees with node
// 4,000 times, contributes 4,000 to the comparison count, and asks one
// question. Substituting a wrong implementation could only be caught by that
// one question, so the other 3,999 comparisons are reach and not coverage.
//
// The distinction this cannot draw is whether the constant is intended. A
// surface spec -- `typeof m.f === "function"`, or its `length` -- is constant
// by design and still worth its one question. An accident is constant too. So
// this reports and does not judge: the list is short enough to read, and the
// hazard is a constant nobody has ever looked at, not a constant as such.
//
// Node only. The question is about the spec, so it is put to the oracle; our
// implementation cannot make an input-independent spec input-dependent.

import { createRequire } from "node:module";
import { CORPORA, makeRandom } from "./differential-corpora.mjs";

const require_ = createRequire(import.meta.url);
try { process.noDeprecation = true; } catch { /* already set by the flag */ }

const argv = process.argv.slice(2);
const iterFlag = argv.indexOf("--iterations");
const ITERATIONS = iterFlag < 0 ? 400 : Number(argv[iterFlag + 1]);
const named = argv.filter((a) => !a.startsWith("--") && a !== String(ITERATIONS));
const modules = argv.includes("--all") ? Object.keys(CORPORA) : named;
if (modules.length === 0) {
  console.error("usage: spec-variance.mjs <module>... [--iterations N]   |   --all");
  process.exit(2);
}

const show = (r) => JSON.stringify(r) ?? "undefined";
const clipOne = (s) => (s.length > 68 ? `${s.slice(0, 65)}...` : s);

/**
 * **What separates a hollow spec from a verdict.**
 *
 * A constant answer is not by itself a defect. `assert.deepStrictEqual(a, a)` returns `"ok"` for
 * every input and `http`'s round trip reports `"echoed"` for every input -- but both are *verdicts*
 * over the input: a wrong implementation makes them vary. A genuinely hollow spec is one whose
 * answer no implementation can change, and counting distinct values cannot tell the two apart
 * because a correct implementation produces one value in both cases.
 *
 * A mutation can. Every member of the module is replaced with `undefined` -- the most broken
 * implementation there is -- and the spec is asked again. A verdict changes its answer. A hollow
 * spec returns exactly what it returned before, and that is a proof rather than a suspicion:
 * whatever it is reading, it is not reading the module.
 *
 * This is the shape the `m.ucs3.decode` typo had, which is why the blunt mutation is the right one:
 * that spec reported 574 comparisons and 0 divergences because *both* sides threw the same
 * uncoded `TypeError`, and a module of `undefined`s reproduces exactly that.
 */
const mutantOf = () => new Proxy({}, {
  get: () => undefined,
  has: () => false,
  // `m.Foo` is `undefined` under the trap above, so `new m.Foo()` throws before reaching here;
  // the traps exist so a spec that reflects over the module sees an empty one rather than a
  // proxy that answers every question.
  ownKeys: () => [],
  getOwnPropertyDescriptor: () => undefined,
});

const clip = (s) => (s.length > 68 ? `${s.slice(0, 65)}...` : s);

let constantTotal = 0;
let hollowTotal = 0;
let specTotal = 0;

for (const name of modules) {
  const corpus = CORPORA[name];
  if (corpus === undefined) { console.error(`no corpus for ${name}`); process.exit(2); }

  let upstream;
  try {
    upstream = require_(`node:${name}`);
  } catch {
    console.log(`  ${name}: not resolvable as node:${name}, skipped`);
    continue;
  }

  const rnd = makeRandom();
  const inputs = [...corpus.fixed];
  for (let i = 0; i < ITERATIONS; i++) inputs.push(corpus.input(rnd));

  // Distinct rendered answers per spec. A Set of strings rather than a count of
  // changes: a spec alternating between two answers is a function of its input
  // just as much as one with four hundred, and a spec that returns the input
  // back is the same shape as one that computes from it.
  const seen = corpus.calls.map(() => new Set());
  const absent = corpus.calls.map(() => false);

  for (const input of inputs) {
    for (let c = 0; c < corpus.calls.length; c++) {
      const spec = corpus.calls[c];
      if (absent[c]) continue;
      // Every spec is stopped after the first two distinct answers: the question
      // is whether the answer varies, and a third value does not make it vary
      // more. On `fs` this is the difference between minutes and seconds.
      if (seen[c].size > 1) continue;
      try {
        if (typeof spec.call === "function") {
          seen[c].add(show({ value: await spec.call(upstream, input) }));
        } else {
          const fn = upstream[spec.name];
          if (typeof fn !== "function") { absent[c] = true; continue; }
          seen[c].add(show({ value: await fn(...spec.args(input)) }));
        }
      } catch (error) {
        seen[c].add(show({ threw: `${error.name}: ${error.message}`, code: error.code ?? null }));
      }
    }
  }

  const constant = [];
  for (let c = 0; c < corpus.calls.length; c++) {
    const spec = corpus.calls[c];
    if (absent[c]) continue;
    specTotal++;
    if (seen[c].size === 1) constant.push([c, spec.label ?? spec.name, [...seen[c]][0]]);
  }
  constantTotal += constant.length;

  const live = corpus.calls.length - absent.filter(Boolean).length;
  console.log(
    `  ${name}: ${constant.length} of ${live} spec(s) answer the same for all ` +
      `${inputs.length} inputs`,
  );

  // Only the constant ones are mutated. A spec that already varies with its input is answering
  // a question by construction, and asking it again against a broken module would cost the run
  // its time to confirm something the first pass established.
  for (const [c, label, only] of constant) {
    const spec = corpus.calls[c];
    let after;
    // A module of `undefined`s can leave a spec awaiting a callback that will never be made --
    // `http`'s round trip has no server to answer it. The timer is cleared in a `finally`
    // because a spec that throws *synchronously* would otherwise leave it pending and hold the
    // process open long past the answer it already gave.
    let timer;
    try {
      const raced = await Promise.race([
        (async () => {
          const mutant = mutantOf();
          if (typeof spec.call === "function") return show({ value: await spec.call(mutant, inputs[0]) });
          return show({ value: await mutant[spec.name](...spec.args(inputs[0])) });
        })(),
        new Promise((resolve) => { timer = setTimeout(() => resolve("<hung>"), 5000); }),
      ]);
      after = raced;
    } catch (error) {
      after = show({ threw: `${error.name}: ${error.message}`, code: error.code ?? null });
    } finally {
      clearTimeout(timer);
    }
    const hollow = after === only;
    if (hollow) hollowTotal++;
    console.log(
      `      ${hollow ? "HOLLOW " : "verdict"} ${label.padEnd(30)} ${clipOne(only)}`,
    );
  }
}

console.log(
  `\n  ${constantTotal} of ${specTotal} spec(s) answer the same for every input, of which ` +
    `${hollowTotal} answer the same for a module of \`undefined\`s and so are measuring nothing`,
);
process.exitCode = hollowTotal > 0 ? 1 : 0;
