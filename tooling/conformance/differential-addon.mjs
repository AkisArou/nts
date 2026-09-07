// A compiled addon against node's own module, on inputs no pinned test uses.
//
//   node tooling/conformance/differential-addon.mjs punycode target/node/punycode.node
//   node tooling/conformance/differential-addon.mjs punycode <addon> --iterations 50000
//
// Node's tests are the oracle, and they are a fixed set of inputs chosen to
// pin behaviour a human thought of. A compiled artifact can differ from node
// on inputs nobody wrote a test for -- a surrogate pair split across a code
// path, an astral code point, a string long enough to change how a buffer
// grows -- and no pass count will say so. This asks node the same questions it
// asks the addon and compares the answers, which is the one oracle that scales
// past the corpus.
//
// A divergence is reported with the input that produced it. The generator is a
// seeded PRNG rather than `Math.random`, so a run is reproducible from its seed
// and a failure can be replayed rather than described.
//
// Per-module corpora, because a generic string generator is only meaningful for
// a module whose surface takes strings. Adding a module here is adding an entry
// to CORPORA: the functions to compare, and how to build inputs for them.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// The *same* corpora the TypeScript lane uses, imported rather than restated.
// This file kept its own copy, which made that file's comment about sharing
// them false and, worse, meant the two lanes asked `punycode` different
// questions -- so a divergence between lanes could not be told from a
// divergence between corpora, which is exactly what that comment warns against.
import { CORPORA, makeRandom } from "./differential-corpora.mjs";

const require_ = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const [name, addonPath] = argv.filter((a) => !a.startsWith("--"));
const iterFlag = argv.indexOf("--iterations");
const ITERATIONS = iterFlag < 0 ? 20000 : Number(argv[iterFlag + 1]);

if (name === undefined || addonPath === undefined) {
  console.error("usage: differential-addon.mjs <module> <addon.node> [--iterations N]");
  process.exit(2);
}
if (!existsSync(addonPath)) {
  console.error(`no addon at ${addonPath}; build it with check.sh ${name}`);
  process.exit(2);
}

const corpus = CORPORA[name];
if (corpus === undefined) {
  console.error(`no corpus for ${name}; add one to differential-corpora.mjs`);
  process.exit(2);
}

process.noDeprecation = true;
const compiled = require_(resolve(addonPath));
const upstream = require_(`node:${name}`);

const show = (r) => ("threw" in r ? `throw ${r.threw}` : JSON.stringify(r.value));

let compared = 0;
let diverged = 0;
let propertyFailures = 0;

const absent = new Set();

function invoke(target, spec, input) {
  try {
    if (typeof spec.call === "function") return { value: spec.call(target, input) };
    const fn = target[spec.name];
    if (typeof fn !== "function") return { missing: true };
    return { value: fn(...spec.args(input)) };
  } catch (error) {
    return { threw: `${error.name}: ${error.message}` };
  }
}

function compare(spec, input) {
  const label = spec.label ?? spec.name;
  const a = invoke(compiled, spec, input);
  const b = invoke(upstream, spec, input);
  // An addon that does not publish the function is named rather than counted
  // as agreeing: a differential over three of four functions reporting zero
  // says less than it appears to.
  if (a.missing === true) {
    absent.add(label);
    return;
  }
  if (b.missing === true) return;
  compared++;
  if (show(a) === show(b)) return;
  diverged++;
  if (diverged <= 10) {
    console.log(`  ${label}(${JSON.stringify(input)})`);
    console.log(`     compiled: ${show(a)}`);
    console.log(`     node:     ${show(b)}`);
  }
}

const rnd = makeRandom();
const inputs = [...corpus.fixed];
for (let i = 0; i < ITERATIONS; i++) inputs.push(corpus.input(rnd));

for (const input of inputs) {
  for (const spec of corpus.calls) compare(spec, input);
  if (corpus.property !== undefined) {
    const failure = corpus.property(compiled, input);
    if (failure !== undefined) {
      propertyFailures++;
      if (propertyFailures <= 3) console.log(`  property: ${JSON.stringify(input)} -- ${failure}`);
    }
  }
}

if (absent.size > 0) {
  console.log(`\n  not compared, absent from the addon: ${[...absent].join(", ")}`);
}

console.log(
  `\n  ${compared} comparison(s) over ${ITERATIONS} random inputs and ` +
    `${corpus.fixed.length} fixed: ${diverged} divergence(s), ` +
    `${propertyFailures} property failure(s)`,
);
process.exitCode = diverged + propertyFailures > 0 ? 1 : 0;
