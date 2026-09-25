// Build one Test262 body, run it, and say what happened. Shared by every runner.
//
// `run262.mjs` (one process, one file at a time) and `conformance262.mjs` (the
// whole suite, in parallel workers) both call `attempt` from here. It was
// written inside `run262.mjs`, and a second runner with its own copy would be a
// second derivation of "what did this file do" -- the first time the two
// disagreed, two reports would describe different programs under one corpus's
// name. `project.mjs` exists for the same reason one step earlier.

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import { environment, HARNESS, materialise, workspace } from "./project.mjs";

/**
 * The first line of the test body, in the materialised `src/main.ts`.
 *
 * `materialise` writes `"use strict";\n` and then the harness, so every line
 * before this one is ours and not the test's. A refusal located there is a
 * fact about the stand-in, and ranking it as the test's cause would put the
 * harness at the top of the table -- which is the failure `harness.ts`'s own
 * header describes (918 refusals in one file, every one of them the harness).
 */
export const BODY_FIRST_LINE = 1 + HARNESS.split("\n").length;

/** The text of a refusal, after the code: `… NTS1001 <this part>`. */
const FIRST_REFUSAL = /NTS\d{4}\s+(.*?)(?: is not supported by this lowering yet)?$/m;

/**
 * `TS2322 Type 'string' is not assignable to type 'number'.` — code and message.
 *
 * **The largest bucket in this census recorded nothing but its own name.** The
 * `typescript` branch below tested `/^TS\d{4,5}/m` and threw the match away, so
 * 2,747 of 4,812 files — 57% — arrived as `{why: "typescript"}` and the ranked
 * refusal list ranked the other 43%. The reasoning for why that is not enough is
 * already written out one branch further down, for `lowering`: "a run that
 * records only the bucket can say 413 files are blocked and nothing about what
 * to fix". The same question, asked of the smaller half only.
 *
 * Identifiers are redacted the way `FIRST_REFUSAL`'s are, so that a hundred
 * files naming a hundred different names rank as one shape — single quotes here
 * rather than backticks, because that is how TypeScript quotes them.
 */
const FIRST_TYPE_ERROR = /^(TS\d{4,5})\s+(.*)$/m;

/** `nts: uncaught <Class>: <message>` — the class comes from the descriptor. */
const UNCAUGHT = /^nts: uncaught ([A-Za-z_$][A-Za-z0-9_$]*)(?::|$)/m;

/**
 * The link command, read from what `emit-c` printed rather than rebuilt.
 *
 * `emit-c --out` ends by printing the exact `cc` line a person now runs.
 * Reconstructing it here would be a second derivation of the build, and the
 * first time the runtime gained a source or a library this would link a
 * different program than `nts build` does.
 */
function linkCommand(emitted) {
  const joined = emitted
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("cc ") || line.startsWith("-I"))
    .join(" ")
    .replace(/\\/g, " ");
  if (!joined.includes(" -o ")) return null;
  return joined.replace(/^cc\s+/, "").split(/\s+/).filter((part) => part !== "");
}

/**
 * Every diagnostic in an `emit-c` output, not only the first.
 *
 * The first is what `first` has always recorded, and it ranks *reach*: the
 * compiler reports one blocker at a time, and a case blocked three ways shows
 * up under whichever came first. Recording all of them is what lets a ranking
 * ask the question that clears work -- "in how many cases is this the **only**
 * cause?" -- rather than "in how many is it the first?".
 *
 * Each entry: `code`, a redacted `message` that ranks (identifiers `X`, type
 * ids `N`), the `named` identifiers it redacted, and `where`:
 *
 *   body     a line of the test itself
 *   harness  a line of the prepended stand-in -- a fact about us, not the test
 *   none     TypeScript prints no location, so a checker error says nothing
 *
 * Duplicates (same code, message and place) are one entry: a generic copy of
 * one function reports the same line once per instantiation.
 */
const unapostrophe = (text) => text.replace(/(\w)'(t|s|re|ve|ll|d)\b/g, "$1\u2019$2");
const redactQuoted = (text) => unapostrophe(text).replace(/'[^']*'/g, "'X'").replace(/\u2019/g, "'").trim();

export function parseDiagnostics(text) {
  const seen = new Set();
  const found = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    let entry = null;
    const located = /^(.*?):(\d+):(\d+):\s+(NTS\d{4})\s+(.*)$/.exec(line);
    if (located) {
      const [, file, row, , code, said] = located;
      const where = !file.endsWith("src/main.ts")
        ? "other"
        : Number(row) >= BODY_FIRST_LINE
          ? "body"
          : "harness";
      const text = said.replace(/ is not supported by this lowering yet$/, "");
      entry = {
        code,
        message: text.replace(/`[^`]*`/g, "`X`").replace(/\btype \d+/g, "type N").trim(),
        named: [...new Set(text.match(/`[^`]*`/g) ?? [])].map((quoted) => quoted.slice(1, -1)),
        where,
      };
    } else {
      const checker = /^(TS\d{4,5})\s+(.*)$/.exec(line);
      if (checker) {
        const [, code, said] = checker;
        entry = {
          code,
          // `can't` is an apostrophe, not a quote: left in, it pairs with the
          // next quote and the redaction eats the text between them.
          message: redactQuoted(said),
          named: [...new Set(unapostrophe(said).match(/'[^']*'/g) ?? [])].map((quoted) => quoted.slice(1, -1)),
          where: "none",
        };
      }
    }
    if (entry === null) continue;
    const key = `${entry.code} ${entry.message} ${entry.where} ${entry.named.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(entry);
  }
  return found;
}

/** Compile, link and run one program body. Never reads an exit status alone. */
export function attempt(dir, body, tools) {
  const { nts, cc } = tools;
  materialise(dir, body);
  const out = join(dir, "out");

  // **`spawnSync`, because both streams have to be read on success.**
  //
  // This was `execFileSync`, which returns stdout and throws away stderr unless
  // the child fails -- and `emit-c` prints its refusals on **stderr** while
  // exiting 0. So the `NTS\d{4}` test below read a stream that never carries a
  // refusal, the `unsupported/lowering` bucket never once fired, and a refused
  // program went on to be linked and run:
  //
  //   it completed  ->  `strict-pass`. A compiler refusal counted as a pass,
  //                     which is the one rule `docs/conformance/test262.md`
  //                     says must never be broken.
  //   it threw      ->  `threw Test262Error`, indistinguishable from a real
  //                     conformance failure.
  //
  // 151 of the first 906 rows were the second, all from one directory, and they
  // read as 151 correctness bugs. They are one refusal -- `a default on a
  // property that can be \`null\` as well as missing` -- dropping a method body
  // whose last statement increments the counter the test then asserts on.
  //
  // The two self-checks below could not see it: neither program has a refusal
  // in it, so the arm that would have fired never ran. `refused()` is that arm.
  const emit = spawnSync(nts, ["emit-c", join(dir, "tsconfig.json"), "--out", out, "--main"], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: environment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = emit.stdout ?? "";
  const diagnostics = `${stdout}${emit.stderr ?? ""}`;
  if (emit.error || emit.status !== 0) {
    if (emit.signal === "SIGTERM") return { bucket: "timeout", why: "emit" };
    if (diagnostics.includes("frontend transport failed") || diagnostics.includes("panic: ")) {
      return { bucket: "frontend-crash" };
    }
    const type_error = FIRST_TYPE_ERROR.exec(diagnostics);
    if (type_error) {
      return {
        bucket: "unsupported",
        why: "typescript",
        // The code separately from the message: a code is stable across
        // TypeScript versions and a message is not, so a row keyed on the text
        // alone silently splits in two the day a wording changes.
        code: type_error[1],
        first: type_error[2].replace(/'[^']*'/g, "'X'").trim(),
        diagnostics: parseDiagnostics(diagnostics),
      };
    }
    // **Invalid HIR is a compiler defect, not a decline.** The verifier caught
    // a program the lowering built wrong and refused to emit it; nothing about
    // the test is unsupported. `invalid HIR: ReturnType { func: "myfunc3", ... }`
    // was the first, on `statements/return/S12.9_A5.js`. Names and ids are
    // redacted so one defect ranks as one row.
    const invalid = /^invalid HIR: (.*)$/m.exec(diagnostics);
    if (invalid) {
      return {
        bucket: "invalid-hir",
        first: invalid[1].replace(/"[^"]*"/g, '"X"').replace(/\b(\w*Id)\(\d+\)/g, "$1(N)").trim().slice(0, 200),
      };
    }
    return { bucket: "unsupported", why: "emit" };
  }
  // `emit-c` exits 0 while refusing, so the diagnostics decide, never the
  // status -- and *both* streams are the diagnostics.
  if (/NTS\d{4}/.test(diagnostics)) {
    // **Which refusal, not merely that there was one.** A run that records
    // only the bucket can say 413 files are blocked in lowering and nothing
    // about what to fix; the census records its first diagnostic for exactly
    // this reason and the runner did not, so the two instruments answered
    // different halves of one question.
    //
    // The first, because the compiler reports one blocker at a time -- so this
    // ranks reach rather than causes, the same caveat the census carries.
    // Identifiers are redacted to `X` so that a hundred files naming a hundred
    // different names rank as one shape.
    const first = FIRST_REFUSAL.exec(diagnostics);
    return {
      bucket: "unsupported",
      why: "lowering",
      diagnostics: parseDiagnostics(diagnostics),
      first: first ? first[1].replace(/`[^`]*`/g, "`X`").trim() : undefined,
      // **The redaction that makes a row rankable destroys the work list.**
      // The largest actionable row is 147 files of ``\`X\`, a builtin this
      // compiler does not provide``, and *which* builtin is the entire content
      // of that row: `Proxy` and `String.raw` rank as one line and are two
      // different days of work. Ranking wants the shape and acting wants the
      // names, so both are recorded rather than one derived from the other.
      //
      // The names as the compiler quoted them, in order, deduplicated -- a file
      // naming the same builtin twice is one entry, so a tally over this field
      // counts files rather than mentions.
      named: first
        ? [...new Set(first[1].match(/`[^`]*`/g) ?? [])].map((quoted) => quoted.slice(1, -1))
        : undefined,
    };
  }

  const args = linkCommand(stdout);
  if (!args) return { bucket: "infrastructure-error", why: "no link command in the emit output" };
  try {
    execFileSync(cc, args, {
      cwd: out,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // A backend declining a function, or C the compiler will not take. Both are
    // `unsupported`, and this is exactly the gap the census could not see: it
    // measured lowering, and lowering is not building.
    //
    // **A refusal and an unmeasurable run must not look alike**, which is the
    // rule `tooling/differential` already states for its own timeouts and which
    // this `catch` broke by discarding the error. Two censuses reported exactly
    // one `link` failure each, on two different files, and **neither
    // reproduced** -- three runs apiece in isolation, all `strict-pass`. Both
    // full runs overlapped a gate, so `cc` was competing for the machine and the
    // timeout here is 180s. A row that reads `link` both for "the toolchain
    // refused this C" and for "the toolchain did not finish" is one nobody can
    // act on, and it cost two investigations that ended in "does not reproduce".
    const timedOut = error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT";
    if (timedOut) return { bucket: "timeout", why: "link" };
    const said = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
    // **The toolchain crashing is not the program's fault**, and the third
    // unexplained `link` row in as many censuses is what named it:
    //
    //     quickjs/dtoa.c:1353:8: internal compiler error: Segmentation fault
    //
    // `cc` segfaulted on a *runtime* source the program does not contain, under
    // a census sharing the machine with a gate. The file passes on its own, and
    // so did the two before it -- which is all anyone could say until the
    // message was kept. `infrastructure-error` is the bucket the runner already
    // has for "this run could not measure anything", and it belongs here rather
    // than in `unsupported`, where it reads as a refusal the compiler made.
    if (/internal compiler error|Segmentation fault|Killed|out of memory/i.test(said)) {
      return { bucket: "infrastructure-error", why: "the toolchain did not survive the link" };
    }
    // The first line the toolchain said, so the next one is diagnosable from the
    // rows rather than from a re-run that may not reproduce it. Paths are
    // stripped: they name a per-process scratch directory, which would make
    // every row unique and unrankable.
    const line = said
      .split("\n")
      .find((text) => /error|undefined reference|cannot find/i.test(text));
    return {
      bucket: "unsupported",
      why: "link",
      first: line?.replace(/\/\S*\//g, "").trim().slice(0, 160),
    };
  }

  try {
    execFileSync(join(out, "program"), [], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { bucket: "strict-pass" };
  } catch (error) {
    if (error.signal === "SIGTERM") return { bucket: "timeout" };
    const thrown = UNCAUGHT.exec(String(error.stderr ?? ""));
    if (thrown) {
      // The line as well as the class: a wrong answer recorded as only
      // `Test262Error` cannot tell one wrong value from another, so a case that
      // changes *how* it is wrong would look unchanged.
      const said = String(error.stderr ?? "").split("\n").find((text) => UNCAUGHT.test(text));
      return { bucket: "threw", thrown: thrown[1], message: said?.trim().slice(0, 240) };
    }
    return { bucket: "crash", why: error.signal ?? `exit ${error.status}` };
  }
}

// --- self-checks, before the run ------------------------------------------
//
// Both run through `attempt`, the same path a real test takes. A control that
// takes a different path proves nothing about the one that matters.

export function selfChecks(scratch, tools, cannotMeasure) {
  const dir = workspace(join(scratch, "checks"));
  const control = attempt(dir, `assert.sameValue(1 + 1, 2, "control");\n`, tools);
  if (control.bucket !== "strict-pass") {
    cannotMeasure(
      `the control program does not pass (${control.bucket}${control.why ? `: ${control.why}` : ""}). ` +
        "The materialiser or the toolchain is wrong, not the corpus.",
    );
  }
  // **The arm that matters.** A runner that reports everything as passing is
  // the failure this whole effort exists to avoid, and it looks exactly like
  // success. A deliberately failing assertion must come back `threw
  // Test262Error` — not merely non-passing, because a crash would satisfy that.
  const sabotage = attempt(dir, `assert.sameValue(1 + 1, 3, "sabotage");\n`, tools);
  if (sabotage.bucket !== "threw" || sabotage.thrown !== "Test262Error") {
    cannotMeasure(
      `a deliberately failing assertion reported ${sabotage.bucket}` +
        `${sabotage.thrown ? ` (${sabotage.thrown})` : ""}, not a thrown Test262Error. ` +
        "The verdict does not depend on what the program did.",
    );
  }
  // **The third arm, and the one this runner shipped without.**
  //
  // A program that is *refused* and would otherwise complete. Both arms above
  // are clean programs, so neither can tell whether a refusal is noticed -- and
  // it was not: refusals go to stderr, the runner read stdout, and every refused
  // program was linked and run anyway. One that completed came back
  // `strict-pass`.
  //
  // The regex must be **reached**, not merely written. `const pattern = /x/;`
  // with no reader is a dead binding and lowers clean, which is the same trap
  // the sabotage arm hit once with an unused `any`: the arm tested the compiler
  // on a program the compiler had deleted.
  //
  // Required to be exactly `unsupported`, not merely "not a pass". A crash or a
  // throw would satisfy the weaker test while still meaning the refusal went
  // unread.
  const refused = attempt(
    dir,
    'function classify(text: string): boolean {\n' +
      '  return /^[a-z]+$/.test(text);\n' +
      '}\n' +
      'classify("abc");\n' +
      'assert.sameValue(1 + 1, 2, "refusal arm");\n',
    tools,
  );
  if (refused.bucket !== "unsupported") {
    cannotMeasure(
      `a program containing a refused construct reported ${refused.bucket}` +
        `${refused.why ? ` (${refused.why})` : ""}, not unsupported. ` +
        "A compiler refusal is being counted as a verdict about the language.",
    );
  }
  return {
    control: control.bucket,
    sabotage: `${sabotage.bucket} ${sabotage.thrown}`,
    refused: `${refused.bucket}/${refused.why}`,
  };
}
