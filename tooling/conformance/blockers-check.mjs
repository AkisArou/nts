// The minimal reproductions, re-measured against whatever compiler is current.
//
//   node tooling/conformance/blockers-check.mjs
//   NTS_COMPILER=<a pinned copy> node tooling/conformance/blockers-check.mjs
//
// Every compiled-axis blocker this lane has reported should exist here as a
// fixture that can be run, not as a sentence in a document. The reason is the
// one that cost the most today: the largest blocker in `fs` was reported for
// hours as "nullable properties", which is a description of a *grouped
// diagnostic message* rather than of anything that refuses. A plain nullable
// property compiles. One fixture would have caught it on the first day instead
// of the third.
//
// Each fixture states what it expects in an `// expect:` comment at the top,
// and this checks that the expectation still holds. Three outcomes matter:
//
//   reproduces  the blocker is still there, and the fixture is the report
//   FIXED       it no longer refuses, which is news and worth a message
//   CHANGED     it refuses differently, which is either progress or a
//               regression and needs a person either way
//
// A fixture that says "nothing refused" is a regression guard for something
// already repaired. Those are the ones worth having when a compiler is moving
// quickly: the annotated-const write was fixed twice today, the second time
// because the first fix broke `instanceof`.

import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const FIXTURES = join(HERE, "blockers");

const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ??
  join(ROOT, "target/release/nts");
if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}; the compiler session builds it`);
  process.exit(2);
}

/** The `// expect:` lines at the top of a fixture, joined. */
function expectation(source) {
  const lines = source.split("\n");
  const out = [];
  for (const line of lines) {
    const m = /^\/\/\s*expect:\s*(.*)$/.exec(line);
    if (m !== null) {
      out.push(m[1].trim());
      continue;
    }
    // Continuation lines are indented under the `expect:` and only count while
    // no other comment has intervened.
    if (out.length > 0 && /^\/\/\s{8,}\S/.test(line)) {
      out.push(line.replace(/^\/\/\s+/, "").trim());
      continue;
    }
    if (out.length > 0) break;
  }
  return out.join(" ");
}

/** The addon the last `emit-c` wrote, so a "publishes X" expectation can be read. */
function readEmitted(output, file = "addon.c") {
  const m = /wrote .* to (\S+)/.exec(output);
  if (m === null) return "";
  const emitted = join(m[1], file);
  return existsSync(emitted) ? readFileSync(emitted, "utf8") : "";
}

function run(args) {
  const result = spawnSync(compiler, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
  });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const names = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let unexpected = 0;
for (const name of names) {
  const tsconfig = join(FIXTURES, name, "tsconfig.json");
  const source = readFileSync(join(FIXTURES, name, "src/main.ts"), "utf8");
  const expected = expectation(source);

  // A wrapper-signature limit is invisible to `hir`, which is itself a thing
  // worth not forgetting: `f64[]` lowers cleanly and fails at the boundary, so
  // checking it the usual way reports "nothing refused" and says nothing.
  const viaEmit = expected.includes("emit-c");
  const output = viaEmit
    ? run(["emit-c", tsconfig, "--out", mkdtempSync(join(tmpdir(), "nts-blk-")), "--napi"])
    : run(["hir", tsconfig]);

  // Two ways for a fixture to say "this works now". `nothing refused` is the
  // lowering's, and `publishes X` is the wrapper's -- `emit-c` prints no such
  // phrase when it succeeds, so a fixture about a boundary has to name what it
  // expects to see published instead.
  const publishes = /^publishes\s+(\S+)/.exec(
    expected.replace(/^emit-c\b[^>]*->\s*/, ""),
  );
  const expectsClean = expected.startsWith("nothing refused") || publishes !== null;
  const isClean = publishes !== null
    ? new RegExp(`napi_set_named_property\\(env, exports, "${publishes[1]}"`).test(
      readEmitted(output),
    ) && !/no wrapper/.test(output)
    : /nothing refused/.test(output) && !/no wrapper/.test(output);

  // The expectation minus its prose: the diagnostic text itself. The command
  // prefix has to come off *before* the prose, because ` --napi ` looks exactly
  // like the ` -- ` that introduces a comment and the first version of this ate
  // the flag and compared against the string "emit-c".
  const wanted = expected
    .replace(/^emit-c\b[^>]*->\s*/, "")
    .replace(/\s+--\s.*$/, "")
    .trim();
  // A third kind of blocker: one that emits *bad C* rather than refusing.
  // Nothing appears on stdout, `emit-c` reports success, and the defect is a
  // line in program.c that clang later rejects. Checking stdout for these is
  // worse than useless -- `includes("")` is true, so a fixture that asserted
  // nothing would report "reproduces" -- so they are asserted against the
  // emitted file instead.
  // Absence, which is a blocker shape the other three forms cannot state. Some
  // defects are a constant the backend does not emit: nothing refuses, nothing
  // is missing from the export table, and the artifact builds and loads. The
  // only statement that captures it is "program.c does not contain this yet",
  // and it flips to needing-a-person on the day it does -- which is the correct
  // loud outcome, the same as `FIXED`.
  // A fifth form, for a defect that is a *count* rather than a presence: the
  // same struct defined twice, which clang rejects as a redefinition. `emits-c`
  // cannot state it, because one definition is what a correct compiler emits and
  // the fixture would pass after the fix.
  const duplicatesC = /^duplicates-c\s+(.+)$/.exec(wanted);
  const lacksC = /^lacks-c\s+(.+)$/.exec(wanted);
  const emitsC = /^emits-c\s+(.+)$/.exec(wanted);
  // And a fourth: a blocker visible only in the *wrapper*. `emits-addon` reads
  // addon.c, where a defect can be that two exports each got their own
  // `napi_create_function` over one implementation -- which publishes both names
  // and still breaks an identity node guarantees.
  const emitsAddon = /^emits-addon\s+(.+)$/.exec(wanted);
  // Absence has to be read from a file that exists. `readEmitted` answers `""`
  // for a missing one, and `"".includes(x)` is false, so the naive spelling --
  // `!readEmitted(...).includes(text)` -- reports the blocker as *holding* when
  // `emit-c` failed outright and wrote nothing. A check that passes when its
  // subject does not exist is the thing this whole directory is against, and it
  // was in the first draft of the form written to catch exactly that.
  const program = readEmitted(output, "program.c");
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
  const holds = duplicatesC !== null
    ? occurrences(program, duplicatesC[1]) > 1
    : lacksC !== null
    ? program.length > 0 && !program.includes(lacksC[1])
    : emitsC !== null
    ? program.includes(emitsC[1])
    : emitsAddon !== null
    ? readEmitted(output, "addon.c").includes(emitsAddon[1])
    : expectsClean
    ? isClean
    : output.includes(wanted);

  // A fixture is a *guard* if it says so, not if its expectation happens to be
  // phrased as a clean one. `emits-c` and `emits-addon` are used both ways --
  // `undefined-required-field` asserts that bad C is still emitted, and
  // `modscope-refusing-call` asserts that a good export still is -- so the
  // expectation form cannot tell them apart. Deciding the label from
  // `expectsClean` printed "reproduces" for a passing guard, which read as a
  // still-open blocker on a binary where the thing had been fixed. The verdict
  // was right and the word was wrong, which is the worse of the two failures.
  const isGuard = expectsClean || /^\/\/\s+FIXED\b/m.test(source);
  if (holds) {
    console.log(`  ${isGuard ? "guard ok  " : "reproduces"}  ${name}`);
    continue;
  }
  unexpected++;
  if (duplicatesC !== null) {
    console.log(`  FIXED       ${name}: emitted once now, not twice. Expected duplicates of:`);
  } else if (lacksC !== null) {
    console.log(`  FIXED       ${name}: the backend now emits it. Expected absence of:`);
  } else if (emitsC !== null || emitsAddon !== null) {
    console.log(`  FIXED       ${name}: no longer emits it. Expected:`);
  } else if (expectsClean) {
    console.log(`  REGRESSED   ${name}: expected no refusal, got:`);
  } else if (isClean) {
    console.log(`  FIXED       ${name}: no longer refuses. Expected:`);
  } else {
    console.log(`  CHANGED     ${name}: refuses differently. Expected:`);
  }
  console.log(`                ${wanted}`);
  const shown = output
    .split("\n")
    .filter((l) => /NTS1001|NTS1003|no wrapper|nothing refused|^ {4}void [A-Za-z_]/.test(l))
    .slice(0, 3);
  for (const line of shown) console.log(`                got: ${line.trim().replace(/^-- \S+ /, "")}`);
}

console.log(
  `\n  ${names.length} fixture(s), ${names.length - unexpected} as expected, ` +
    `${unexpected} needing a person`,
);
// Not a failure: a blocker being fixed is the outcome this lane wants, and it
// should be loud rather than red. The count is the signal.
process.exitCode = 0;
