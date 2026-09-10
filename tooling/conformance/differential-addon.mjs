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

// Assigned defensively: under `node --no-deprecation` this property is read-only
// and a bare assignment throws before the harness reaches its first comparison.
try {
  process.noDeprecation = true;
} catch {
  // already suppressed by the flag, which is the outcome this wanted
}
const compiled = require_(resolve(addonPath));
const upstream = require_(`node:${name}`);

// # `--sabotage`: the control, and why it perturbs the module rather than the
// # comparison
//
// "0 divergence(s)" is a claim until something has been shown to make it say
// otherwise, and this harness shipped with nothing that could. Two of its own
// recorded failures were exactly that: a spec naming `m.ucs3.decode` compared a
// TypeError against a TypeError and read clean, and `http` reported 0 over 0
// because every spec it had was skipped.
//
// The cheap version of this flag would append a marker to one side's rendered
// string, which demonstrates that `!==` works and nothing else. This perturbs the
// **addon's own exported values** instead, so a sabotaged run exercises the whole
// path a real defect takes: the module answers differently, `invoke` carries it,
// `show` renders it, `compare` counts it. A spec that stays silent under sabotage
// is a spec that is not reading the addon.
//
// `publishes()` still consults the unperturbed exports, so sabotage changes what
// the specs *answer* and never which of them run -- a control that also moved the
// coverage would confound the two.
const SABOTAGE = argv.includes("--sabotage");

function perturb(value, depth = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value + 1 : 0;
  if (typeof value === "bigint") return value + 1n;
  if (typeof value === "string") return `${value}\u0001`;
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) return value.length > 0 ? value.slice(0, -1) : ["sabotage"];
  if (typeof value === "function") {
    return (...args) => {
      let result;
      try {
        result = value(...args);
      } catch (error) {
        // The thrown error is perturbed too, and it has to be. A `throws: true`
        // spec records the error rather than a return value, so rethrowing the
        // original made both sides answer identically and all six of `path`'s
        // `!` specs read SILENT on the first sweep -- the control suppressing
        // exactly what it exists to demonstrate.
        const sabotaged = new TypeError(`${error?.message ?? "threw"}\u0001`);
        sabotaged.code = error?.code === undefined ? "ERR_SABOTAGE" : `${error.code}_SABOTAGE`;
        throw sabotaged;
      }
      return perturb(result, depth + 1);
    };
  }
  // Every own key, not just the first. An earlier version perturbed one key of an
  // object and stopped, which made a spec reaching `m.constants.X` read *silent*
  // under sabotage -- the control would then have accused a working spec.
  // Depth is bounded because a module's exports reach cyclic structures.
  if (value !== null && typeof value === "object" && depth < 4) {
    const copy = { ...value };
    for (const key of Object.keys(copy)) copy[key] = perturb(copy[key], depth + 1);
    return copy;
  }
  return value;
}

/** The addon's exports with every own value perturbed one step. */
function sabotaged(exports_) {
  const copy = { ...exports_ };
  for (const key of Object.keys(copy)) copy[key] = perturb(copy[key]);
  return copy;
}

const subject = SABOTAGE ? sabotaged(compiled) : compiled;

// `code` is part of a thrown error here, not decoration: `assert.throws(fn, { code })`
// is how node states nearly every error expectation, so a right name and message
// over a wrong code is a divergence this had no way to show.
const show = (r) =>
  "threw" in r
    ? `throw ${r.threw}${r.code === undefined || r.code === null ? "" : ` [${r.code}]`}`
    : JSON.stringify(r.value);

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
    return { threw: `${error.name}: ${error.message}`, code: error.code ?? null };
  }
}

/* Whether the compiled module publishes what a spec reaches for.
 *
 * `invoke` can only see absence for the `spec.name` form: it looks the function
 * up and returns `{ missing }`. A `spec.call` form -- `(m, input) =>
 * m.posix.normalize(input)` -- reaches through the module itself and *throws*,
 * which arrives as a divergence.
 *
 * That is not a small difference in reporting. `path` publishes 4 of its 17
 * exports, and the differential answered **400,840 comparisons, 400,840
 * divergences**: every one of them `Cannot read properties of undefined`. A
 * real wrong answer among them would have been invisible. `buffer` and `util`
 * read the same way, for the same reason.
 *
 * The first segment of a label is the top-level export a spec needs --
 * `posix.normalize` needs `posix`, `ucs2.decode` needs `ucs2` -- so this is a
 * lookup rather than a guess about an error message. Matching on "Cannot read
 * properties of undefined" would also have caught a module that genuinely
 * returned undefined from a nested read, which is a defect and not an absence.
 */
function publishes(spec) {
  const label = spec.label ?? spec.name ?? "";
  // The whole dotted chain, not only the leading identifier. A label may spell
  // its arguments -- `posix.format("")` -- so the chain is the identifiers
  // before the first `(`, and each one is resolved in turn.
  //
  // **The root alone is one level too shallow.** `path` publishes `posix` and
  // does not publish `posix.format`, so every `posix.format(...)` spec passed
  // this guard, threw inside the module, and arrived as a divergence: 40,084 of
  // them on a 2026-09-10 pin, every one `m[ns].format is not a function`. That
  // is the same failure this function was written to fix, one level down, and it
  // hid whatever real divergence `path` may have -- which is exactly the
  // objection recorded above.
  //
  // `util` published two functions and its corpus exercises `format`, so it
  // reported 45,216 comparisons and 45,216 divergences, all of them
  // `m.format is not a function`.
  //
  // Still a lookup rather than a guess about an error message, for the reason
  // given above: matching "is not a function" would also catch a module that
  // genuinely published a non-function, which is a defect and not an absence.
  const chain = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(label)?.[0];
  if (chain === undefined) return true;
  let cursor = compiled;
  for (const segment of chain.split(".")) {
    if (cursor === undefined || cursor === null) return false;
    if (typeof cursor !== "object" && typeof cursor !== "function") return false;
    cursor = cursor[segment];
  }
  return cursor !== undefined && cursor !== null;
}

const perLabel = new Map();
const perLabelDiverged = new Map();

function compare(spec, input) {
  const label = spec.label ?? spec.name;
  if (!publishes(spec)) {
    absent.add(label);
    return;
  }
  const a = invoke(subject, spec, input);
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
  perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
  if (show(a) === show(b)) return;
  diverged++;
  perLabelDiverged.set(label, (perLabelDiverged.get(label) ?? 0) + 1);
  if (diverged <= 10) {
    console.log(`  ${label}(${JSON.stringify(input)})`);
    console.log(`     compiled: ${show(a)}`);
    console.log(`     node:     ${show(b)}`);
  }
}

// A spec that names nothing real is a spec that tests nothing and says it
// passed. `invoke` catches, so `m.ucs3.decode(s)` throws the same TypeError on
// both sides and compares *equal* -- 0 divergences from a corpus with a typo in
// it. Demonstrated with exactly that typo before this guard was written.
//
// So every spec has to produce at least one non-throwing answer from *node*
// across the fixed inputs. Node is the oracle; if the oracle cannot answer a
// question, the question is wrong rather than the implementation.
{
  // A spec may declare `throws: true`: node is expected to reject its input, and
  // the comparison is of the error rather than of an answer. Those specs exist
  // because the corpora generate inputs a function accepts, so the error paths --
  // where `code` lives, and `code` is what node's suite asserts on -- were never
  // reached at all.
  //
  // Held to the mirror of the rule above rather than exempted from it. That rule
  // catches a typo because a spec naming nothing real throws; an error-path spec
  // throws too, so "it threw" cannot separate them. What does: a typo throws
  // `TypeError: Cannot read properties of undefined`, with **no `code`**, and a
  // module's own validation throws one with a code.
  const broken = [];
  for (const spec of corpus.calls) {
    const label = spec.label ?? spec.name;
    const ok = corpus.fixed.some((input) => {
      const r = invoke(upstream, spec, input);
      if (spec.throws === true) return "threw" in r && r.code !== undefined && r.code !== null;
      return !("threw" in r) && r.missing !== true;
    });
    if (!ok) broken.push(spec.throws === true ? `${label} (declared throws:true)` : label);
  }
  if (broken.length > 0) {
    console.error(
      `  corpus error: node itself never answers ${broken.join(", ")} -- ` +
        "these specs compare two failures and report agreement",
    );
    process.exit(2);
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

// Under sabotage, a spec that compared and never diverged is the finding: the
// addon answered differently and this spec did not notice. Reported by label so
// the answer is "which spec", not "how many".
if (SABOTAGE) {
  const silent = [...perLabel.keys()].filter((l) => (perLabelDiverged.get(l) ?? 0) === 0);
  // A spec that declares `shapeOnly` compares a type and not a value, because the
  // quantity behind it moves between the two calls. It is silent by construction
  // and is reported apart, so the unexplained ones stay countable.
  const declared = new Set(
    (corpus.calls ?? []).filter((sp) => sp.shapeOnly === true).map((sp) => sp.label ?? sp.name),
  );
  const unexplained = silent.filter((l) => !declared.has(l));
  const byDesign = silent.filter((l) => declared.has(l));
  console.log(
    `\n  SABOTAGE: ${perLabel.size} spec(s) compared, ` +
      `${perLabel.size - silent.length} noticed, ${unexplained.length} silent, ` +
      `${byDesign.length} shape-only`,
  );
  for (const l of unexplained) console.log(`    SILENT  ${l}  (${perLabel.get(l)} comparison(s), 0 noticed)`);
  for (const l of byDesign) console.log(`    shape-only  ${l}  (compares a type, not a value)`);
  process.exitCode = unexplained.length > 0 ? 1 : 0;
}

// A run that compared nothing is not a clean run, and until now it printed as
// one: `buffer` answered "0 comparison(s) ... 0 divergence(s)" and exited 0,
// because its addon publishes five names and its corpus calls twenty-nine
// others -- no overlap at all. Read down a column of modules, that row is
// indistinguishable from a module that agreed with node everywhere.
//
// The `absent` list above says which names were missing, and it was not enough:
// nobody reads it when the number beside it is zero.
if (compared === 0) {
  console.log(
    `\n  NOTHING WAS COMPARED. The addon publishes none of the names this\n` +
      `  corpus calls, so "0 divergence(s)" above is a blank and not a result.\n` +
      `  Fix the addon's exports or the corpus's calls before reading this row.`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = diverged + propertyFailures > 0 ? 1 : 0;
}
