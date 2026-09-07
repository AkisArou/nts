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

// Deterministic, so a divergence is replayable from the seed printed below.
let seed = 0x2545f491;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Chosen to cross the boundaries a codec actually has: ASCII, Latin-1
// supplement, Greek and Cyrillic, CJK, emoji, and the astral planes, which are
// where surrogate handling either works or does not.
const RANGES = [
  [0x20, 0x7e], [0xa0, 0x24f], [0x370, 0x4ff],
  [0x4e00, 0x9fff], [0x1f300, 0x1f9ff], [0x10000, 0x10ffff],
];

function randomString(maxLength = 12) {
  const n = 1 + Math.floor(rnd() * maxLength);
  let s = "";
  for (let i = 0; i < n; i++) {
    const [lo, hi] = pick(RANGES);
    s += String.fromCodePoint(lo + Math.floor(rnd() * (hi - lo + 1)));
  }
  return s;
}

const CORPORA = {
  punycode: {
    // Every published function takes one string and returns one string, so all
    // four take the same generated input; the fixed list carries the shapes a
    // generator will not reach on its own.
    functions: ["encode", "decode", "toASCII", "toUnicode"],
    fixed: [
      "", "a", "abc", "-", "--", "xn--", "0", "z", " ", "  ", "\t", "\n",
      ".", "..", "a..b", "a.", ".a", "xn--a", "xn--0zwm56d",
      "mañana", "bücher", "日本語", "☃", "😀", "a😀b", "\u{10FFFF}",
      "москва", "北京", "ｅｘａｍｐｌｅ", "ß", "a".repeat(200), "ü".repeat(60),
    ],
    random: () => randomString(),
    // decode(encode(s)) is the identity on anything encode accepts. Checked on
    // the addon alone, because a round trip that agrees with node while losing
    // the input would be two bugs cancelling.
    property: (m, input) => {
      let encoded;
      try {
        encoded = m.encode(input);
      } catch {
        // `encode` refusing an input is not a round-trip failure; there is
        // nothing to decode. A divergence in *whether* it refuses is caught by
        // the comparison above, which is where it belongs.
        return undefined;
      }
      // `decode` throwing here is the loudest possible round-trip failure --
      // `encode` produced something its own `decode` rejects -- so it is
      // reported rather than propagated. Letting it throw crashed the whole
      // run the first time this had a real defect to find, which is a
      // differential failing to report the thing it exists to report.
      try {
        const back = m.decode(encoded);
        return back === input ? undefined : `round-trip returned ${JSON.stringify(back)}`;
      } catch (error) {
        return `encode produced ${JSON.stringify(encoded)}, which its own decode rejects: ${error.message}`;
      }
    },
  },
};

const corpus = CORPORA[name];
if (corpus === undefined) {
  console.error(`no corpus for ${name}; add one to CORPORA in this file`);
  process.exit(2);
}

process.noDeprecation = true;
const compiled = require_(resolve(addonPath));
const upstream = require_(`node:${name}`);

const call = (fn, input) => {
  try {
    return { value: fn(input) };
  } catch (error) {
    return { threw: `${error.name}: ${error.message}` };
  }
};
const show = (r) => ("threw" in r ? `throw ${r.threw}` : JSON.stringify(r.value));

let compared = 0;
let diverged = 0;
let propertyFailures = 0;

function compare(fnName, input) {
  const ours = compiled[fnName];
  const theirs = upstream[fnName];
  if (typeof ours !== "function" || typeof theirs !== "function") return;
  compared++;
  const a = call(ours, input);
  const b = call(theirs, input);
  if (show(a) === show(b)) return;
  diverged++;
  if (diverged <= 10) {
    console.log(`  ${fnName}(${JSON.stringify(input)})`);
    console.log(`     compiled: ${show(a)}`);
    console.log(`     node:     ${show(b)}`);
  }
}

for (const input of corpus.fixed) {
  for (const fnName of corpus.functions) compare(fnName, input);
}
for (let i = 0; i < ITERATIONS; i++) {
  const input = corpus.random();
  for (const fnName of corpus.functions) compare(fnName, input);
  if (corpus.property !== undefined) {
    const failure = corpus.property(compiled, input);
    if (failure !== undefined) {
      propertyFailures++;
      if (propertyFailures <= 3) console.log(`  property: ${JSON.stringify(input)} -- ${failure}`);
    }
  }
}

// Functions the addon does not publish are named rather than silently skipped:
// a differential over three of four functions that reports "0 divergences"
// says less than it appears to.
const absent = corpus.functions.filter((f) => typeof compiled[f] !== "function");
if (absent.length > 0) {
  console.log(`\n  not compared, absent from the addon: ${absent.join(", ")}`);
}

console.log(
  `\n  ${compared} comparison(s) over ${ITERATIONS} random inputs and ` +
    `${corpus.fixed.length} fixed: ${diverged} divergence(s), ` +
    `${propertyFailures} property failure(s)`,
);
process.exitCode = diverged + propertyFailures > 0 ? 1 : 0;
