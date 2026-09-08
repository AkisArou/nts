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
  // Any expectation asserted against an emitted *file* has to be run through
  // `emit-c`, whether or not it spells the command out. Writing `emits-c X`
  // without the `emit-c --napi ->` prefix ran `hir` instead, wrote no
  // `program.c`, found nothing in the empty string, and reported **FIXED** --
  // a confident all-clear for a blocker that was fully present. A false
  // "reproduces" wastes an hour; a false "FIXED" gets a fixture deleted.
  const fileForm = /^(?:emit-c\b[^>]*->\s*)?(emits-c|emits-addon|lacks-c|duplicates-c)\b/
    .test(expected);
  const viaEmit = expected.includes("emit-c") || fileForm;
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
  // A sixth form, and the one the others could not state: **the emitted C does
  // not compile**.
  //
  // `emits-c <text>` is a substring match, and a substring chosen from a broken
  // program can also appear in a correct one. `identity-across-subtype` expected
  // `(double)v` -- which was the pointer comparison when it was filed and is a
  // legitimate int-to-double conversion now -- so it reported `reproduces` for a
  // defect that had been fixed. Five fixtures were in that state at once, all of
  // them mine, and the harness could not have told anyone.
  //
  // For a defect whose whole nature is that clang rejects the output, the
  // expectation should say so. This runs the compiler.
  const failsToCompile = /^fails-to-compile(?:\s+(.+))?$/.exec(wanted);
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
  // And if it still came back empty, say so instead of concluding anything. An
  // absent file is not evidence about its contents in either direction.
  if (fileForm && program.length === 0) {
    unexpected++;
    console.log(`  NO OUTPUT   ${name}: emit-c wrote no program.c, so the expectation could not be`);
    console.log(`                evaluated either way. Expected: ${expected}`);
    continue;
  }
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
  // Compiled with the same force-includes `build.sh` uses: without them a
  // missing prototype is an implicit declaration rather than an error, and a
  // fixture about a prototype would report clean.
  let compileErrors = null;
  if (failsToCompile !== null && program.length > 0) {
    const emitted = /wrote .* to (\S+)/.exec(output);
    const dir = emitted === null ? null : emitted[1];
    if (dir !== null) {
      const cc = spawnSync("clang", [
        "-std=c11", "-c", join(dir, "program.c"), "-I", dir,
        "-include", join(ROOT, "runtime/node/internal/nts_node.h"),
        "-include", join(ROOT, "runtime/node/internal/shared.h"),
        "-I", join(ROOT, "runtime/c"),
        "-I", join(ROOT, "runtime/node/internal"),
        "-I", join(ROOT, "third_party/node/src"),
        "-I", join(ROOT, "third_party/node/deps/uv/include"),
        "-o", "/dev/null",
      ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      const text = `${cc.stdout ?? ""}${cc.stderr ?? ""}`;
      compileErrors = text.split("\n").filter((l) => l.includes("error:"));
    }
  }

  const holds = failsToCompile !== null
    ? compileErrors !== null && compileErrors.length > 0 &&
      (failsToCompile[1] === undefined ||
        compileErrors.some((l) => l.includes(failsToCompile[1])))
    : duplicatesC !== null
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
  // A `hir` expectation is a substring of the whole run, and a fixture's
  // tsconfig can pull in more than its own `src`. If the only lines carrying the
  // expected text come from *another* file, the fixture is holding on somebody
  // else's diagnostic and would keep holding after its own defect was fixed.
  //
  // The same shape as the five `emits-c` fixtures that matched correct output:
  // an expectation satisfied by something other than the thing it names.
  //
  // **This guard has not been controlled and cannot be, as the tree stands.**
  // Every fixture's tsconfig covers only its own `src`, so there is no other
  // file for a diagnostic to come from, and an expectation matching nothing
  // takes the `CHANGED` path before reaching here. It is a guard against a
  // state that does not exist yet -- a fixture that imports from another
  // directory -- and it is written down as such rather than counted as a
  // control that passed. An uncontrolled check is a claim; this one says so.
  if (holds && !viaEmit && !expectsClean) {
    const carrying = output.split("\n").filter((l) => l.includes(wanted));
    const own = carrying.filter((l) => l.includes(`blockers/${name}/src`));
    if (carrying.length > 0 && own.length === 0) {
      unexpected++;
      console.log(`  NOT ITS OWN ${name}: the expected text appears ${carrying.length} time(s),`);
      console.log("                none of them in this fixture's own source. It is holding");
      console.log("                on another file's diagnostic.");
      continue;
    }
  }

  if (holds) {
    console.log(`  ${isGuard ? "guard ok  " : "reproduces"}  ${name}`);
    continue;
  }
  unexpected++;
  // A guard that stops holding is a **regression**, and every branch below used
  // to call it `FIXED` -- the reassuring word, for the one outcome that needs a
  // person fastest. `isGuard` was computed and then consulted only on the
  // holding path, so the label was right when nothing was wrong and wrong when
  // something was.
  //
  // Controlled 2026-09-08 rather than asserted, because a check with no
  // demonstrated failure is a claim: `undefined-required-field`'s expectation
  // was pointed at a string the backend does not emit, standing in for the fix
  // regressing, and the harness printed `FIXED       undefined-required-field:
  // no longer emits it`. It is `REGRESSED` now, and the fixture was restored.
  //
  // The sentences below stay as they are -- "no longer emits it" describes a
  // guard's regression as accurately as a blocker's fix. Only the word was
  // carrying the wrong meaning.
  const verdict = isGuard ? "REGRESSED " : "FIXED     ";
  if (failsToCompile !== null) {
    console.log(`  ${verdict}  ${name}: the emitted C compiles now. Expected a clang error:`);
  } else if (duplicatesC !== null) {
    console.log(`  ${verdict}  ${name}: emitted once now, not twice. Expected duplicates of:`);
  } else if (lacksC !== null) {
    console.log(`  ${verdict}  ${name}: the backend now emits it. Expected absence of:`);
  } else if (emitsC !== null || emitsAddon !== null) {
    console.log(`  ${verdict}  ${name}: no longer emits it. Expected:`);
  } else if (expectsClean) {
    console.log(`  REGRESSED   ${name}: expected no refusal, got:`);
  } else if (isClean) {
    console.log(`  ${verdict}  ${name}: no longer refuses. Expected:`);
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
