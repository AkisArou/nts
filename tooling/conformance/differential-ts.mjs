// The TypeScript module against node's own, on inputs no pinned test uses.
//
//   node tooling/conformance/differential-ts.mjs querystring
//   node tooling/conformance/differential-ts.mjs path --iterations 20000
//   node tooling/conformance/differential-ts.mjs --all
//
// The sibling `differential-addon.mjs` asks the same question of a compiled
// addon. This one needs no build, so it runs against the twenty-one modules
// that do not compile yet -- which is where the behaviour actually is today.
//
// It found the `querystring` `__proto__` ordering bug on its first serious run:
// 20 divergences over 4,000 generated queries, in a module whose four pinned
// test files all passed. That is the argument for it. Node's tests are a fixed
// set of inputs a human chose; this is the same oracle asked a great many more
// questions.
//
// Two processes, because inside the substitution `require("node:path")` and
// `require("path")` are the same object and node's real module is unreachable.
// The probe runs under `run-one.mjs` and prints this profile's answers; the
// host computes node's and compares. Inputs are generated once here and handed
// to the probe as a file, so both sides are answering identically the same
// questions rather than two seeded sequences that are supposed to agree.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

import { CORPORA, makeRandom } from "./differential-corpora.mjs";

/* Emitted trees under one root, removed when the run ends.
 *
 * Temp directories created per case and never removed filled a 16G `/tmp`
 * across a day of runs. The failure does not look like a disk error: `emit-c`
 * has nowhere to write, every case reports a refusal it did not have, and a
 * failed emit reads exactly like a real regression. `NTS_KEEP_TEMP=1` keeps the
 * tree for anyone reducing a case by hand. */
const RUN_ROOT = mkdtempSync(join(tmpdir(), "nts-differentialts-"));
const workspace = (prefix) => mkdtempSync(join(RUN_ROOT, prefix));
process.on("exit", () => {
  if (process.env.NTS_KEEP_TEMP === undefined) {
    try { rmSync(RUN_ROOT, { recursive: true, force: true }); } catch { /* going away anyway */ }
  } else {
    console.log(`  kept ${RUN_ROOT}`);
  }
});


const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const require_ = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const iterFlag = argv.indexOf("--iterations");
const ITERATIONS = iterFlag < 0 ? 4000 : Number(argv[iterFlag + 1]);
const named = argv.filter((a) => !a.startsWith("--") && a !== String(ITERATIONS));

const modules = argv.includes("--all") ? Object.keys(CORPORA) : named;
if (modules.length === 0) {
  console.error("usage: differential-ts.mjs <module>... [--iterations N]   |   --all");
  console.error(`known corpora: ${Object.keys(CORPORA).join(", ")}`);
  process.exit(2);
}

const show = (r) => JSON.stringify(r);
let failed = false;

for (const name of modules) {
  const corpus = CORPORA[name];
  // A corpus whose module is implemented in C behind stand-ins that call node
  // cannot be run on this lane: it would compare node with node. Skipped out
  // loud rather than silently, because a missing row and a passing row look the
  // same in a summary and only one of them is honest.
  if (corpus !== undefined && corpus.addonOnly === true) {
    console.log(`  ${name}: skipped on this lane -- its bindings stand in as node here;`);
    console.log(`      run differential-addon.mjs against the built addon instead`);
    continue;
  }
  if (corpus === undefined) {
    console.error(`no corpus for ${name}; add one to differential-corpora.mjs`);
    process.exit(2);
  }
  if (!existsSync(join(ROOT, "runtime/node", name, "tsconfig.json"))) {
    console.error(`no such module: ${name}`);
    process.exit(2);
  }

  const rnd = makeRandom();
  const inputs = [...corpus.fixed];
  for (let i = 0; i < ITERATIONS; i++) inputs.push(corpus.input(rnd));

  const dir = workspace("nts-diff-");
  const inputsPath = join(dir, "inputs.json");
  writeFileSync(inputsPath, JSON.stringify(inputs));

  const run = spawnSync(
    process.execPath,
    [join(HERE, "run-one.mjs"), name, join(HERE, "differential-probe.cjs"), "-"],
    {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      env: {
        ...process.env,
        NTS_DIFF_MODULE: name,
        NTS_DIFF_INPUTS: inputsPath,
        NTS_DIFF_CORPORA: join(HERE, "differential-corpora.mjs"),
      },
    },
  );
  const line = `${run.stdout ?? ""}`.split("\n").find((l) => l.startsWith("NTSDIFF "));
  if (line === undefined) {
    // Reported rather than counted as zero divergences, for the same reason
    // `blockers.mjs` reports an unreadable public API: a comparison that never
    // ran is not a comparison that agreed.
    console.error(`${name}: the probe produced no results.`);
    console.error(`${run.stderr ?? ""}`.trim().split("\n").slice(-3).join("\n"));
    failed = true;
    continue;
  }
  const ours = JSON.parse(line.slice("NTSDIFF ".length));

  process.noDeprecation = true;
  const upstream = require_(`node:${name}`);

  // A corpus may declare what has to be true before its answers mean anything.
  // The `fs` one reads a directory in the repository, and if that directory
  // were missing both sides would return ENOENT, compare equal, and report
  // agreement while comparing nothing. Comparison cannot catch that -- two
  // identical failures are identical -- so the precondition is asserted against
  // node rather than compared, and a false one fails the run.
  if (typeof corpus.precondition === "function") {
    let held;
    try {
      held = corpus.precondition(upstream);
    } catch (error) {
      held = `threw ${error.message}`;
    }
    if (held !== true) {
      console.error(`${name}: precondition does not hold (${held}); its comparisons would be`);
      console.error(`  two identical failures, which compare equal and mean nothing.`);
      failed = true;
      continue;
    }
  }

  // The same argument as the precondition above, one level down: a *spec* that
  // names nothing real compares two identical failures and reports agreement.
  // `m.ucs3.decode(s)` throws the same TypeError on both sides, and a corpus
  // with that typo in it reported 574 comparisons and 0 divergences while
  // testing nothing. Demonstrated with exactly that typo before this was
  // written, in the addon lane, which has the same guard.
  //
  // Node is the oracle, so the question is put to node: if it cannot answer a
  // spec for any fixed input, the spec is wrong rather than the implementation.
  {
    const broken = [];
    for (const spec of corpus.calls) {
      const label = spec.label ?? spec.name;
      const answered = corpus.fixed.some((input) => {
        try {
          if (typeof spec.call === "function") {
            spec.call(upstream, input);
            return true;
          }
          const fn = upstream[spec.name];
          if (typeof fn !== "function") return false;
          fn(...spec.args(input));
          return true;
        } catch {
          return false;
        }
      });
      if (!answered) broken.push(label);
    }
    if (broken.length > 0) {
      console.error(`${name}: node itself never answers ${broken.join(", ")};`);
      console.error(`  those specs compare two failures, which agree and mean nothing.`);
      failed = true;
      continue;
    }
  }

  let compared = 0;
  let diverged = 0;
  const absent = new Set();
  // Per call, because the total says how bad and this says where. A run that
  // reports 4,142 divergences over 29 calls is a different problem from one
  // that reports 4,142 over two, and only one of those is a single bug.
  const byCall = new Map();
  for (let i = 0; i < inputs.length; i++) {
    for (let c = 0; c < corpus.calls.length; c++) {
      const spec = corpus.calls[c];
      const fnName = spec.label ?? spec.name;
      const mine = ours[i][c];
      if (mine.absent === true) {
        absent.add(fnName);
        continue;
      }
      let theirs;
      try {
        if (typeof spec.call === "function") {
          theirs = { value: spec.call(upstream, inputs[i]) };
        } else {
          const fn = upstream[spec.name];
          if (typeof fn !== "function") continue;
          theirs = { value: fn(...spec.args(inputs[i])) };
        }
      } catch (error) {
        // `code` as well as name and message. Node's errors carry one --
        // `ERR_INVALID_ARG_TYPE` and its kin -- and `assert.throws(fn, { code })`
        // is how node's own suite states nearly every error expectation, so a
        // wrong `code` under a right name and message is exactly the divergence
        // this file exists to find and was the one shape it could not see.
        theirs = { threw: `${error.name}: ${error.message}`, code: error.code ?? null };
      }
      compared++;
      if (show(mine) === show(theirs)) continue;
      diverged++;
      byCall.set(fnName, (byCall.get(fnName) ?? 0) + 1);
      if (diverged <= 8) {
        console.log(`  ${fnName}(${JSON.stringify(inputs[i])})`);
        console.log(`     ours ${show(mine)}`);
        console.log(`     node ${show(theirs)}`);
      }
    }
  }

  if (absent.size > 0) {
    console.log(`  ${name}: not compared, absent from the module: ${[...absent].join(", ")}`);
  }
  if (byCall.size > 0) {
    console.log(`  ${name}: divergences by call --`);
    for (const [label, count] of [...byCall].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(count).padStart(6)}  ${label}`);
    }
  }
  console.log(
    `  ${name}: ${compared} comparison(s) over ${inputs.length} inputs, ` +
      `${diverged} divergence(s) across ${byCall.size} call(s)`,
  );
  if (diverged > 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
