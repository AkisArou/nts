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
  const fileForm = /^(?:emit-c\b[^>]*->\s*)?(emits-c|emits-addon|lacks-c|duplicates-c|compiles|once-c)\b/
    .test(expected);
  const viaEmit = expected.includes("emit-c") || fileForm;
  // Flags written into the expectation's command prefix, beyond the `--napi`
  // every file-form fixture gets. `--rc` is the one that motivated this: a
  // defect can exist only under reference counting, and until now there was no
  // way to say so -- the fixture would have had to assert against a build the
  // harness does not produce.
  const extraFlags = (/^emit-c\b([^>]*)->/.exec(expected)?.[1] ?? "")
    .split(/\s+/)
    .filter((f) => f.startsWith("--") && f !== "--napi");
  const output = viaEmit
    ? run(["emit-c", tsconfig, "--out", mkdtempSync(join(tmpdir(), "nts-blk-")), "--napi", ...extraFlags])
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
  // A **fourth** guard form, and the counterpart of `emits-addon`: a name that
  // must *not* be in the wrapper.
  //
  // `lowers` and `publishes` say what is there; nothing said what is absent
  // from the addon, and absence is what one class of correctness looks like. A
  // function whose body the C backend refused leaves its `Func` in place, so a
  // wrapper naming its symbol is well-formed C that fails at the *linker* --
  // and worse, the addon loads and dies on the first call with
  // `undefined symbol`, at whatever later moment somebody calls it.
  //
  // Read from a file that must exist, for the reason `lacks-c` gives: `""`
  // contains nothing, so a fixture whose emission failed outright would
  // otherwise report the absence as holding.
  //
  // **Controlled on the day it was written**, like the other three: pointed at
  // `nts_napi_passthrough`, which the same fixture's addon does contain, it
  // reported `REGRESSED  wrapper-for-a-refused-body: the wrapper names it now`.
  // A guard form that has never been seen to fail is worth as little as a
  // fixture that has never been seen to reproduce.
  const lacksAddon = /^lacks-addon\s+(.+)$/.exec(wanted);
  // A **fifth** guard form, and the one the other four cannot reach: does the
  // *wrapper* compile.
  //
  // `compiles` builds `program.c`. Every guard above it reads emitted text. So
  // an addon that is well-formed text and uncompilable C had nothing here that
  // could see it -- and that is not hypothetical: `process` exports a global
  // whose C name is `env`, `NAPI_MODULE_INIT`'s parameter is also `env`, and the
  // parameter shadowed the extern. The wrapper emitted
  // `nts_to_napi_entries(env, env, &value)`, which is a `napi_env` where an
  // `NtsMap *` belongs. `process` and `readline` both stopped building.
  //
  // The gate's `addons` step caught it, twenty minutes and twenty-two modules
  // later. This is the same question asked of one file in two seconds.
  const addonCompiles = /^addon-compiles$/.test(wanted);
  // Three guard forms, each the counterpart of a blocker form that had none.
  //
  // A fixed blocker with no way to state its fixed state either stays loud
  // forever or gets deleted, and deleting it throws away the regression guard
  // the work just earned. Thirteen fixtures were in that position at once on
  // 2026-09-08 -- every one of them FIXED, none of them able to say so.
  //
  //   compiles      the counterpart of `fails-to-compile`
  //   once-c X      the counterpart of `duplicates-c`, which means "more than
  //                 once"; the fixed state is *exactly* once, and `emits-c`
  //                 cannot say that because it holds for two as well
  //   lowers        `nothing refused`, without also requiring the wrapper to
  //                 carry it
  //
  // The third exists because `nothing refused` is spelled `/nothing refused/ &&
  // !/no wrapper/`, which makes it mean "lowered *and* crossed the boundary".
  // Those are two axes and a lowering fixture is about one of them: five
  // fixtures here lower cleanly now and are still declined at the wrapper for
  // reasons that have nothing to do with what they were filed for -- `takes
  // unknown`, `returns Promise<f64[]>`, the export-class arm. Requiring both
  // would keep them red for someone else's blocker.
  // **All three were controlled on the day they were written**, by pointing
  // each at something false and checking it said so:
  //
  //   once-c    `once-c NtsHeader header;` on duplicate-type-name
  //             -> REGRESSED, "emitted 3 time(s), not once"
  //   compiles  added to rc-widened-global-save, which does not compile under
  //             --rc -> REGRESSED, with the clang error quoted
  //   lowers    added to weakref-property, which still refuses
  //             -> REGRESSED, "something refuses again"
  //
  // A guard form that has never been seen to fail is worth as little as a
  // fixture that has never been seen to reproduce.
  // `calls <expression>` -- the runtime form, and the only one that can express
  // a defect in an addon whose emitted text is correct.
  //
  // The expression is evaluated with the loaded addon bound to `exports` and
  // must be **true**, so a blocker asserts the defect as it stands today and
  // stops holding when it is fixed, exactly like the diagnostic forms.
  //
  // A `// control:` line in the same file is **required**. Without one the form
  // certifies nothing when the class simply is not published: every expression
  // about a missing name is false, and "false" would read as fixed. The control
  // must hold before the call expression is believed either way.
  const calls = /^calls\s+(.+)$/.exec(wanted);
  const controlLine = /^\/\/\s*control:\s*(.+)$/m.exec(source);
  const compiles = /^compiles$/.test(wanted);
  const onceC = /^once-c\s+(.+)$/.exec(wanted);
  const lowersOnly = /^lowers$/.test(wanted);
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
  // Compiling the emitted C, and -- when the fixture named a flag -- compiling
  // the build *without* it too.
  //
  // A fixture that says "this fails under `--rc`" is making two claims, and the
  // second one is the whole content: it fails *with* the flag and compiles
  // *without* it. Asserting only the first would hold just as well for a
  // program that does not compile at all, which is a different defect with a
  // different owner. The control was in the prose of the first draft and prose
  // is not a control; three fixtures were wrong on 2026-09-08 for exactly that.
  // **How far this control has been demonstrated, precisely.** Inverting the
  // condition below flips `rc-widened-global-save` from `reproduces` to
  // `FIXED`, so the branch is load-bearing rather than decorative. It has *not*
  // been shown to reject a real mis-attributed fixture, because there is
  // currently no program in this tree that emits non-compiling C without
  // `--rc`: all five `fails-to-compile` fixtures went FIXED on 2026-09-08. That
  // is a good state for the compiler and an untested state for this check, and
  // the two are worth writing down separately.
  const compileEmitted = (dir, file = "program.c") => {
    const cc = spawnSync("clang", [
      "-std=c11", "-c", join(dir, file), "-I", dir,
      "-include", join(ROOT, "runtime/node/internal/nts_node.h"),
      "-include", join(ROOT, "runtime/node/internal/shared.h"),
      "-I", join(ROOT, "runtime/c"),
      "-I", join(ROOT, "runtime/node/internal"),
      "-I", join(ROOT, "third_party/node/src"),
      "-I", join(ROOT, "third_party/node/deps/uv/include"),
      "-o", "/dev/null",
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return `${cc.stdout ?? ""}${cc.stderr ?? ""}`.split("\n").filter((l) => l.includes("error:"));
  };
  /**
   * Link the emitted C into an addon, load it, and evaluate two expressions.
   *
   * The form every other expectation here cannot express: a fixture that
   * **publishes cleanly and answers wrongly**. `util.types` publishes 31
   * predicates and none can be asked about a reference;
   * `async_hooks.executionAsyncResource` publishes and throws on every call; a
   * class crosses with its methods and without its fields. All three emit
   * well-formed text, so reading the text says nothing.
   *
   * Nothing but the generated C and `runtime/node/internal/*.c` is linked. A
   * fixture is self-contained by construction, so anything else being needed is
   * a fact about the fixture rather than about the compiler.
   *
   * `RTLD_NOW`, because a wrapper naming a symbol the backend refused links
   * happily and dies on the first call instead of at load. See `loads.sh`.
   *
   * Every failure before the expression is evaluated is reported as itself.
   * "Emitted nothing" and "answered false" are opposite findings and the first
   * one has read as the second for both lanes this week.
   *
   * **All three paths were controlled on the day this was written**, with a
   * throwaway fixture pointed at each in turn:
   *
   *   control false     `control: exports.answer() === 999` with answer() = 7
   *                     -> CONTROL FAILED, quoting the control
   *   call false        `calls exports.answer() === 8` with answer() = 7
   *                     -> FIXED, quoting the expression and `got: false`
   *   nothing emitted   a body calling an undeclared function
   *                     -> NOTHING EMITTED, saying in as many words that this
   *                        is not the expression answering false
   *
   * The third is the one the compiler lane asked for by name, and it is the
   * loudest of the three rather than the quietest.
   */
  const answersAgainstAddon = (dir, callExpr, controlExpr) => {
    const work = mkdtempSync(join(tmpdir(), "nts-blk-run-"));
    const addon = join(work, "fixture.node");
    const sources = readdirSync(dir).filter((f) => f.endsWith(".c")).map((f) => join(dir, f));
    if (sources.length === 0) return { stage: "emitted-nothing" };
    const internal = readdirSync(join(ROOT, "runtime/node/internal"))
      .filter((f) => f.endsWith(".c"))
      .map((f) => join(ROOT, "runtime/node/internal", f));
    const link = spawnSync("clang", [
      "-std=c11", "-O0", "-D_GNU_SOURCE", "-fPIC", "-shared", "-fvisibility=hidden",
      "-I", dir,
      "-I", join(ROOT, "third_party/node/src"),
      "-I", join(ROOT, "third_party/node/deps/uv/include"),
      "-I", join(ROOT, "runtime/node/internal"),
      "-o", addon, ...sources, ...internal, "-luv", "-lm",
    ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (link.status !== 0) {
      const text = `${link.stdout ?? ""}${link.stderr ?? ""}`;
      return { stage: "did-not-link", errors: text.split("\n").filter((l) => l.includes("error:")) };
    }
    const probe = `
      const flags = require("node:os").constants.dlopen;
      const m = { exports: {} };
      try { process.dlopen(m, ${JSON.stringify(addon)}, flags.RTLD_NOW); }
      catch (e) { console.log(JSON.stringify({ stage: "did-not-load", message: String(e.message) })); process.exit(0); }
      const exports = m.exports;
      // new Function, not eval: the expression is a fixture's own declared text
      // and wants exactly one binding. run-one.mjs builds a test's CommonJS
      // wrapper the same way and for the same reason.
      // (No backticks in this comment: it lives inside a template literal, and
      // one closed it the first time this was written.)
      const evaluate = (src) => {
        try { return { ok: true, value: new Function("exports", "return (" + src + ");")(exports) }; }
        catch (e) { return { ok: false, value: String(e && e.message) }; }
      };
      console.log(JSON.stringify({
        stage: "ran",
        control: evaluate(${JSON.stringify(controlExpr)}),
        call: evaluate(${JSON.stringify(callExpr)}),
      }));`;
    const out = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", timeout: 60_000 });
    const line = `${out.stdout ?? ""}`.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    if (line === undefined) return { stage: "probe-failed", message: `${out.stderr ?? ""}`.slice(0, 160) };
    return JSON.parse(line);
  };
  let controlErrors = null;
  if (failsToCompile !== null && extraFlags.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), "nts-blk-ctl-"));
    const plain = run(["emit-c", tsconfig, "--out", dir, "--napi"]);
    const emitted = /wrote .* to (\S+)/.exec(plain);
    controlErrors = emitted === null ? ["control build emitted nothing"] : compileEmitted(emitted[1]);
  }

  let addonErrors = null;
  if (addonCompiles) {
    const emitted = /wrote .* to (\S+)/.exec(output);
    addonErrors = emitted === null
      ? ["the compiler emitted nothing to compile"]
      : compileEmitted(emitted[1], "addon.c");
  }

  let callResult = null;
  if (calls !== null) {
    const emitted = /wrote .* to (\S+)/.exec(output);
    callResult = emitted === null
      ? { stage: "emitted-nothing" }
      : answersAgainstAddon(emitted[1], calls[1], controlLine === null ? "true" : controlLine[1]);
  }
  let compileErrors = null;
  if ((failsToCompile !== null || compiles) && program.length > 0) {
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

  const holds = calls !== null
    ? callResult?.stage === "ran" &&
      callResult.control.ok && callResult.control.value === true &&
      callResult.call.ok && callResult.call.value === true
    : addonCompiles
    ? addonErrors !== null && addonErrors.length === 0
    : compiles
    ? compileErrors !== null && compileErrors.length === 0
    : onceC !== null
    ? occurrences(program, onceC[1]) === 1
    : lowersOnly
    ? /nothing refused/.test(output)
    : failsToCompile !== null
    ? compileErrors !== null && compileErrors.length > 0 &&
      (failsToCompile[1] === undefined ||
        compileErrors.some((l) => l.includes(failsToCompile[1]))) &&
      // With a flag named, the flagless build must be clean or the fixture is
      // not about the flag.
      (controlErrors === null || controlErrors.length === 0)
    : duplicatesC !== null
    ? occurrences(program, duplicatesC[1]) > 1
    : lacksC !== null
    ? program.length > 0 && !program.includes(lacksC[1])
    : emitsC !== null
    ? program.includes(emitsC[1])
    : emitsAddon !== null
    ? readEmitted(output, "addon.c").includes(emitsAddon[1])
    : lacksAddon !== null
    ? readEmitted(output, "addon.c").length > 0 &&
      !readEmitted(output, "addon.c").includes(lacksAddon[1])
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
  // The three forms above are guard forms by construction: each asserts correct
  // behaviour, so "holds" means the fix is still in place and not-holding is a
  // regression. Deciding this from the form rather than from the prose means a
  // guard cannot be mislabelled by someone forgetting to write FIXED.
  // A fixture that says so in its own header is a guard, whatever form its
  // expectation takes.
  //
  // The forms cannot tell on their own: `emits-c`, `emits-addon` and `calls`
  // are each used both ways -- to assert a defect while it stands, and to
  // assert the fixed state afterwards -- and the file's comment already says
  // that about the first two. So a converted fixture printed `reproduces` for
  // a defect its own header calls FIXED, which is the reassuring word for the
  // wrong outcome, the same way `FIXED` once printed for a regressed guard.
  //
  // `kept as a guard` rather than `FIXED` alone: 34 of the 56 fixtures
  // mentioning the word use that phrase, and a fixture can mention a fix in
  // prose without being one.
  const declaresGuard = /kept as a guard/i.test(source);
  const isGuard = declaresGuard || expectsClean || compiles || onceC !== null || lowersOnly ||
    lacksAddon !== null || addonCompiles ||
    /^\/\/\s+FIXED\b/m.test(source);
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
  // Only for expectations that *are* a diagnostic. `lowers` is a word, not a
  // message, and searching the output for it found two incidental matches and
  // reported a correct fixture as holding on another file's diagnostic.
  //
  // This guard shipped documented as uncontrolled -- "a guard against a state
  // that does not exist yet" -- and the first time it ever fired, it was wrong.
  // That is the argument for writing down which checks have never run: the note
  // is what made this take a minute to diagnose instead of an hour.
  if (holds && !viaEmit && !expectsClean && !lowersOnly) {
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

  // The runtime form reports its own failures, and reports them loudly.
  //
  // Every stage before the expression is a different finding from the
  // expression being false, and the request from the compiler lane was
  // explicit: make "emitted nothing" the loudest line rather than the quietest.
  // An empty diagnostic list reading as a clean bill has cost both lanes
  // separately this week.
  if (calls !== null && callResult?.stage !== "ran") {
    unexpected++;
    const stage = callResult?.stage ?? "unknown";
    if (stage === "emitted-nothing") {
      console.log(`  NOTHING EMITTED ${name}: the compiler wrote no C, so the call was never made.`);
      console.log("                  This is not the expression answering false. Read the");
      console.log("                  diagnostics above before reading anything else.");
    } else if (stage === "did-not-link") {
      console.log(`  DID NOT LINK    ${name}: the emitted C does not link into an addon.`);
      for (const line of (callResult.errors ?? []).slice(0, 2)) console.log(`                  ${line.trim()}`);
    } else if (stage === "did-not-load") {
      console.log(`  DID NOT LOAD    ${name}: ${String(callResult.message).slice(0, 88)}`);
      console.log("                  RTLD_NOW, so an undefined symbol is named here rather than");
      console.log("                  on the first call to it.");
    } else {
      console.log(`  PROBE FAILED    ${name}: ${String(callResult?.message ?? stage).slice(0, 88)}`);
    }
    continue;
  }
  if (calls !== null && !(callResult.control.ok && callResult.control.value === true)) {
    unexpected++;
    console.log(`  CONTROL FAILED  ${name}: the control expression did not hold, so the`);
    console.log("                  expectation says nothing either way.");
    console.log(`                  control: ${controlLine === null ? "(none declared)" : controlLine[1].slice(0, 70)}`);
    console.log(`                  gave: ${String(callResult.control.value).slice(0, 70)}`);
    continue;
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
  if (calls !== null) {
    console.log(`  ${verdict}  ${name}: the call answers differently now. Expected true from:`);
    console.log(`                ${calls[1].slice(0, 88)}`);
    console.log(`                got: ${callResult.call.ok ? String(callResult.call.value).slice(0, 60) : "threw " + String(callResult.call.value).slice(0, 54)}`);
    continue;
  }
  if (failsToCompile !== null) {
    console.log(`  ${verdict}  ${name}: the emitted C compiles now. Expected a clang error:`);
  } else if (duplicatesC !== null) {
    console.log(`  ${verdict}  ${name}: emitted once now, not twice. Expected duplicates of:`);
  } else if (lacksC !== null) {
    console.log(`  ${verdict}  ${name}: the backend now emits it. Expected absence of:`);
  } else if (lacksAddon !== null) {
    console.log(`  ${verdict}  ${name}: the wrapper names it now. Expected absence of:`);
  } else if (addonCompiles) {
    console.log(`  ${verdict}  ${name}: the wrapper stopped compiling. Errors:`);
    for (const line of (addonErrors ?? []).slice(0, 2)) {
      console.log(`                ${line.trim()}`);
    }
  } else if (compiles) {
    console.log(`  ${verdict}  ${name}: the emitted C stopped compiling. Errors:`);
    for (const line of (compileErrors ?? []).slice(0, 2)) {
      console.log(`                ${line.trim()}`);
    }
  } else if (onceC !== null) {
    console.log(
      `  ${verdict}  ${name}: emitted ${occurrences(program, onceC[1])} time(s), not once:`,
    );
  } else if (lowersOnly) {
    console.log(`  ${verdict}  ${name}: something refuses again. Expected nothing:`);
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
