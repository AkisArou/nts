// Defects that neither `tests/programs/` nor `blockers/` can hold, each pinned to what
// it does today, re-measured against whatever compiler is current.
//
//   node tooling/conformance/outcomes-check.ts [name ...]
//   node tooling/conformance/outcomes-check.ts --record <name> [name ...]
//   NTS_BIN=<a pinned copy> node tooling/conformance/outcomes-check.ts
//
// **A record is a claim about main, so --record runs on main's binary**: built
// from a clean tree at a named commit, never a worktree carrying an unlanded
// change and never a shared tree with someone's edits in it. A pin gives
// stability, not provenance. Measure a change *against* the records from its
// own worktree; re-record only once the change is on main.
//
// # Why a third fixture kind
//
// `tests/programs/` requires agreement with node, so a program that disagrees cannot
// be committed there without failing the gate for everyone. `blockers/` requires
// an `// expect:` line naming a refusal, so a program that refuses nothing has no
// line to write. In one night three lanes found nine defects that fit neither --
// a conditional calling the wrong function, invalid HIR twice, a cross-module
// `try` abort, lone surrogates, a closure capturing the wrong loop copy, two
// programs whose C does not compile, a runtime refusal that aborts -- and every
// one of them lived in a cache directory or a commit message. A report that is
// not run is a sentence, and sentences expire silently.
//
// # The fixture
//
//   tests/outcomes/<name>/
//     tsconfig.json   extends ../../../../tsconfig.fixtures.json
//     src/main.ts     the program; `// run: build` (default) or `// run: check`,
//                     and with `check`, optionally `// backend: jvm` (`llvm`, `wasm`)
//                     `// provider: rc` selects reference counting, and
//                     `// sanitizer: address` enables Clang ASan with no
//                     virtual-address cap: in build mode with
//                     detect_stack_use_after_return, in check mode (C only) as
//                     `NTS_SANITIZE=address`, a report stopping it by kind.
//     outcome.json    what it did, written by --record, compared by default
//
// **`// backend:` is for a defect only one backend has.** `build` is `emit-c`
// by construction, and `check` ran whatever `NTS_BACKEND` the caller's shell
// happened to export -- so a JVM-only wrong answer (a `string[]` cast to
// `unknown[]` passes the JVM's `checkcast`, where C stops by name) had no
// fixture that could hold it. The line sets `NTS_BACKEND` for that fixture,
// and its absence now *unsets* it, so every other `check` record is measured
// on the default backend whatever the shell exports.
//
// # How a case is run -- recorded, because the two disagree about "declined"
//
//   build  `emit-c --main`, link, execute; the same text under node. The
//          program reports by calling `observe(label, String(value))` and then
//          `done()`, from `outcomes-harness.ts`, prepended to both runs: a
//          compiled program has nothing to print with, so the observations leave
//          as the message of an uncaught `Observed`, and node's preload prints
//          it in nts's own shape. A wrong answer is then two strings.
//
//          **Observations are reported only by `done()`.** `observe` collects;
//          nothing leaves until `done()` throws. So a program that aborts part
//          way reports *no* arm -- the controls observed before the abort
//          included -- and its record is the abort itself, so no control can
//          show the abort was specific to the defect arm. An aborting shape
//          therefore gets a fixture of its own rather than an arm in another,
//          where it would erase every arm beside it (a-repeat-too-long-aborts-
//          instead-of-throwing is its own record for that reason). Arms that
//          each produce a value can share one program, which is what lets one
//          run answer several hypotheses at once.
//   check  `nts check`, which differentially tests exported functions with
//          scalar arguments against node. Its summary and disagreement lines
//          are the record. **Its "declined" is not "agreed"**: an uncaught throw
//          lands there, and a probe of the callback-throw escape printed "17
//          cases declined ... agreed on every case" while the program aborted.
//          So a declined line is part of the record, never filtered.
//
// # Five categories, each one a way a defect has hidden before
//
//   wrong-answer    ran to the end and answered differently from node
//   invalid-hir     the verifier refused to emit; `emit-c` writes nothing, so
//                   anything reading output files scores it as "no refusals".
//                   Decided by the verifier's own line, never by the missing
//                   file: "wrote nothing" is also what a run that never
//                   happened looks like. One operator can move a program
//                   between this and `refused` -- a generic copy's `typeof v
//                   === "number"` arm was invalid HIR until c4f08a907, while
//                   `!== "string"` then `.length` refuses by name -- so a
//                   refusing variant is not evidence the family is handled
//   uncompilable-c  `emit-c` exited 0 and `cc` rejected what it wrote
//   aborted         the program died without an uncaught throw -- a signal, a
//                   runtime refusal (`nts: refused: index 1 is outside [0, 1)`)
//   refused         a compile-time refusal: `blockers/` holds these, so a case
//                   that starts refusing is handed back, with its expect line.
//                   Under `build` the record also has `ran`: what the artefact
//                   did anyway. `emit-c` can exit 0 past a refusal, and an app
//                   whose top level called the refused function runs without
//                   that statement -- a silently different program, which a
//                   record that stopped at the refusal could not see
//   agrees          nts and node say the same: a regression guard
//
// # Verdicts, in the test262 step's vocabulary
//
//   holds / reproduces   the record still describes the case
//   FIXED                it agrees with node now -- loud, because the fixture
//                        should move to `tests/programs/` or be re-recorded as a guard
//   REFUSES NOW          hand it to `blockers/` with the printed expect line
//   REGRESSED            a guard that agreed stopped agreeing
//   CHANGED              still wrong, differently -- a person decides which way
//   ORACLE CHANGED       node's own answer moved; the record is stale, not nts
//   NOT MEASURED         the harness could not produce a verdict; never a pass
//
// **FIXED and REFUSES NOW print and pass; the rest fail.** `tooling/gate/
// example-refusals` says why in its header -- "a gate that goes red when you fix
// something teaches people to stop fixing things" -- and `blockers-check` keeps
// the same rule, so three harnesses give one answer to "what happens when
// someone fixes this". The cost is the one that header also names: a stale
// record can let a regression back in unnoticed. So the count of both is in
// the summary line, `N fixed, M refusing now -- move or re-record`, where a
// run cannot be scrolled past it; `array-from-unsupported` sat stale for
// twelve days in a harness whose summary did not say so.
//
// **REGRESSED is written and has never been seen to fire.** Every other verdict
// was driven with a sabotaged record before this landed; REGRESSED needs nts to
// *disagree* with node on a program it agreed on, and that cannot be produced
// on demand from here. The first real one is its proof -- or its bug.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { capped, linkCommand, withCachedObjects } from "../census/attempt262.ts";
import { compileSync, serialRun } from "../census/worker-memory.ts";
import { OUTCOMES as FIXTURES, materialise as materialiseIn, outcomeFixtures, runMode } from "./outcomes-project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PRELOAD = join(HERE, "outcomes-node-preload.ts");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const CC = process.env.CC ?? "cc";
const SCRATCH = join(homedir(), ".cache/nts/outcomes", String(process.pid));
const TOOLS = {
  nts: NTS,
  cc: CC,
  memoryCapKb: Number(process.env.NTS_CENSUS_MEMORY_CAP_KB ?? 6_000_000),
  objectCache: process.env.NTS_CENSUS_OBJECT_CACHE ?? join(homedir(), ".cache/nts/c-objects"),
};

const argv = process.argv.slice(2);
const recording = argv.includes("--record");
const named = argv.filter((a) => !a.startsWith("--"));

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}
serialRun(TOOLS);
const FINGERPRINT = createHash("sha256").update(readFileSync(NTS)).digest("hex").slice(0, 16);
mkdirSync(SCRATCH, { recursive: true });
process.env.TMPDIR = join(SCRATCH, "tmp");
mkdirSync(process.env.TMPDIR, { recursive: true });
process.on("exit", () => rmSync(SCRATCH, { recursive: true, force: true }));

// --- one project in a scratch directory --------------------------------------

/** A fixture as a project under this run's scratch: see outcomes-project.ts. */
const materialise = (name, sources, mode) => materialiseIn(SCRATCH, name, sources, mode);

const env = () => ({
  ...process.env,
  NTS_CHECKERS: "1",
});
const CASCADE = new Set(["NTS1003", "NTS1005"]);
const rootLine = (d) => `${d.code} ${d.raw}`;

/** Everything the build run observed, reduced to one category and one detail. */
function runBuild(dir, options = { rc: false, address: false }) {
  const out = join(dir, "out");
  const emit = compileSync(TOOLS, NTS, ["emit-c", join(dir, "tsconfig.json"), "--out", out, "--main", ...(options.rc ? ["--rc"] : [])], {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    env: env(),
  });
  if (emit.memoryKilled) return { category: "not-measured", nts: "the resident memory cap" };
  const said = `${emit.stdout ?? ""}${emit.stderr ?? ""}`;
  if (emit.error || emit.signal) return { category: "not-measured", nts: `emit-c ${emit.signal ?? emit.error?.message}` };
  const invalid = /^invalid HIR: (.*)$/m.exec(said);
  if (invalid) return { category: "invalid-hir", nts: `invalid HIR: ${invalid[1].trim()}` };
  const roots = rawRoots(said);
  if (roots.length > 0) {
    // **A refusal does not always stop the program.** `emit-c` exits 0 with a
    // refusal printed, and an app whose top level called the refused function
    // runs without that statement (`excise_from_initializer`). React's refused
    // `main` "printed nothing", exit 0. So a refused record also says what the
    // artefact did, and a program that runs past its refusal is compared
    // rather than filed.
    const ran = emit.status === 0 ? buildAndRun(emit, out, options) : { category: "no artefact", nts: `emit-c exited ${emit.status}` };
    return { category: "refused", nts: rootLine(rootOfTheProgram(said, roots, join(dir, "src/main.ts"))), roots: roots.map(rootLine), ran: ran.category === "completed" || ran.category === "aborted" ? ran.nts : ran.category === "not-measured" ? null : `${ran.category}: ${ran.nts}` };
  }
  if (emit.status !== 0) return { category: "not-measured", nts: `emit-c exited ${emit.status}: ${said.trim().split("\n")[0]}` };
  return buildAndRun(emit, out, options);
}

/** Link what `emit-c` wrote into `out` and run it: completed, aborted or uncompilable-c. */
function buildAndRun(emit, out, options) {
  const printed = linkCommand(emit.stdout ?? "");
  if (!printed) return { category: "not-measured", nts: "no link command in the emit output" };
  const tools = options.address ? { ...TOOLS, cc: "clang" } : TOOLS;
  // These flags enter the runtime-object cache key as well as the program
  // build: an unsanitized cached runtime cannot stand in for the ASan arm.
  const flags = options.address
    ? [...printed.filter((arg) => !/^-O/.test(arg)), "-O1", "-g", "-fsanitize=address", "-fno-inline", "-fno-omit-frame-pointer"]
    : printed;
  let args;
  try {
    ({ args } = withCachedObjects(flags, out, tools));
  } catch (error) {
    return { category: "uncompilable-c", nts: firstCError(`${error.stdout ?? ""}${error.stderr ?? ""}`) };
  }
  const link = spawnSync(tools.cc, args, { cwd: out, encoding: "utf8", timeout: 180_000 });
  if (link.signal) return { category: "not-measured", nts: `cc ${link.signal}` };
  if (link.status !== 0) return { category: "uncompilable-c", nts: firstCError(`${link.stdout}${link.stderr}`) };

  // ASan reserves a large shadow address space. The normal cap is retained
  // for emit-c; only the sanitized executable runs without that address cap.
  const runTools = options.address ? { ...tools, memoryCapKb: 0 } : tools;
  // `symbolize=0`: a verdict reads only ASan's `ERROR: AddressSanitizer: <kind>`
  // line, which comes before any frame, and symbolizing the frames spawns
  // llvm-symbolizer to load debug information -- under a gate's load the
  // self-check's deliberate fault took the run past its 30 s and the step read
  // NOT MEASURED ("the program timed out", 2026-10-16).
  const runEnv = options.address
    ? { ...env(), ASAN_OPTIONS: "detect_stack_use_after_return=1:detect_leaks=0:symbolize=0" }
    : env();
  const ran = spawnSync("sh", capped(runTools, join(out, "program"), []), { encoding: "utf8", timeout: 30_000, env: runEnv });
  if (ran.error?.code === "ETIMEDOUT" || ran.signal === "SIGTERM") return { category: "not-measured", nts: "the program timed out" };
  const addressError = /ERROR: AddressSanitizer: ([a-z-]+)/.exec(ran.stderr ?? "");
  if (options.address && addressError) return { category: "aborted", nts: `AddressSanitizer: ${addressError[1]}` };
  const last = (ran.stderr ?? "").split("\n").filter((l) => l.startsWith("nts: "));
  const uncaught = last.find((l) => l.startsWith("nts: uncaught "));
  if (ran.signal || (ran.status !== 0 && !uncaught)) {
    return { category: "aborted", nts: `${ran.signal ?? `exit ${ran.status}`}${last[0] ? `; ${last[0]}` : ""}` };
  }
  return { category: "completed", nts: `exit ${ran.status}${uncaught ? `; ${uncaught}` : ""}` };
}

/** NTS and TS roots with their message as printed -- verbatim, because a hand-back needs the expect line. */
function rawRoots(said) {
  const raw = [];
  for (const line of said.split("\n")) {
    const m = /^.*?:\d+:\d+:\s+(NTS\d{4})\s+(.*)$/.exec(line.trim()) ?? /^(?:\S+ )?(TS\d{4,5})\s+(.*)$/.exec(line.trim());
    if (m && !CASCADE.has(m[1])) raw.push({ code: m[1], raw: m[2].replace(/ is not supported by this lowering yet$/, "") });
  }
  return raw;
}

/**
 * The root a refused program's record names: the one its **own** first cut
 * rests on, when it has cuts, else the first root printed. A fixture that
 * imports runtime code prints that code's refusals first -- an-init-hook-of-
 * one-parameter's record named `captureStackTrace`, in `internal/errors.ts`,
 * while what emptied the program was `AsyncHook#enable`'s refusal cutting its
 * three `createHook(...).enable()` statements. A cut names the function it
 * calls; that function's cascade line carries the root's text inline
 * ("`X` cannot be compiled because it calls `Y`, and <root>").
 */
export function rootOfTheProgram(said, roots, main) {
  const lines = said.split("\n").map((l) => l.trim());
  const reasons = new Map();
  for (const l of lines) {
    const m = /NTS1003 `([^`]+)` cannot be compiled because it calls `[^`]+`, and (.*?)(?: is not supported by this lowering yet)?$/.exec(l);
    if (m && !reasons.has(m[1])) reasons.set(m[1], m[2]);
  }
  for (const l of lines) {
    if (!l.startsWith(`${main}:`)) continue;
    const cut = /NTS1003 (?:this module-scope statement was dropped|the initializer of `[^`]+` was not compiled) because it calls `([^`]+)`/.exec(l);
    const reason = cut && reasons.get(cut[1]);
    const root = reason && roots.find((r) => r.raw === reason);
    if (root) return root;
  }
  return roots[0];
}

/**
 * `program.c:147:5: error: 'v1' undeclared` -> `error: 'vN' undeclared`, and
 * `'NtsObj_Iterable_15_'` -> `'NtsObj_Iterable_N_'`: a local's number and a
 * generated layout's are both where codegen reached, which any unrelated type
 * or statement moves.
 */
function firstCError(text) {
  const line = text.split("\n").find((l) => /\berror\b/.test(l)) ?? text.trim().split("\n")[0] ?? "";
  return line
    .replace(/^\S*?:\d+:\d+:\s*/, "")
    .replace(/\bv\d+\b/g, "vN")
    .replace(/\b(NtsObj_[A-Za-z]\w*?)\d+(_?)(?![\w])/g, "$1N$2")
    .replace(/[‘’]/g, "'")
    .trim();
}

/** node on the same text: its exit and its uncaught line, in nts's shape. */
function runNode(dir) {
  const ran = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "--import", PRELOAD, join(dir, "src/main.ts")],
    { encoding: "utf8", timeout: 30_000, cwd: dir },
  );
  if (ran.signal) return `node ${ran.signal}`;
  const lines = (ran.stderr ?? "").split("\n");
  const uncaught = lines.find((l) => l.startsWith("nts: uncaught "));
  if (uncaught) return `exit ${ran.status}; ${uncaught}`;
  // A program node refuses to *load* never reaches the preload's handler: an
  // early error is thrown before any code runs. Its `SyntaxError: ...` line is
  // the answer -- the one a test of an early error exists to compare with.
  const early = lines.find((l) => /^\w*Error(?: \[\w+\])?: /.test(l));
  return `exit ${ran.status}${early ? `; before running: ${early.trim()}` : ""}`;
}

/**
 * The backend a `check` fixture's text names with `// backend: <name>` on a
 * line of its own, or null. Only the name: the prose a fixture writes about a
 * backend ("// backend: Wasm stores a bigint as one v128 ...") selects none.
 */
const backendIn = (text) => /^\/\/\s*backend:\s*(jvm|llvm|wasm)\s*$/m.exec(text)?.[1] ?? null;
/** The backend a `check` fixture names, from its `src/main.ts`. */
const backendOf = (name) => backendIn(readFileSync(join(FIXTURES, name, "src/main.ts"), "utf8"));

/**
 * Whether `nts check` said a backend declined, in any backend's words: "the
 * backend declined", "the LLVM backend declined", "the Wasm backend declined
 * N shape(s)" -- `tooling/differential/agree.mjs` reads the same three. Only
 * the first was read, so an LLVM or Wasm decline was not a refusal here.
 */
const backendDeclined = (said) => said.some((l) => /\bthe (?:LLVM |Wasm )?backend declined\b/.test(l));

/** `nts check`: the lines that decide, verbatim, declined ones included. */
function runCheck(dir, backend, options) {
  const { NTS_BACKEND: _ambient, NTS_RC: _rc, NTS_SANITIZE: _sanitize, ...rest } = env();
  if (options.rc) rest.NTS_RC = "1";
  // The check builds its program under AddressSanitizer and runs it without an
  // address-space cap, which the sanitizer's shadow memory cannot start under
  // (`address_sanitized` in tooling/differential). A cap on `nts` would be
  // inherited by that program, so `nts` has no address-space cap, as build mode runs
  // its sanitized executable.
  if (options.address) rest.NTS_SANITIZE = "address";
  const tools = options.address ? { ...TOOLS, memoryCapKb: 0 } : TOOLS;
  const ran = compileSync(tools, NTS, ["check", dir], {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env: backend === null ? rest : { ...rest, NTS_BACKEND: backend },
  });
  if (ran.memoryKilled) return { category: "not-measured", nts: "the resident memory cap" };
  const said = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.split("\n").map((l) => l.trim());
  return decideCheck(said, ran.status);
}

/** What a finished `nts check` run decided, from its lines alone. */
function decideCheck(said, status) {
  // The CLI says a decline as "17 case(s) the compiled program declined -- …",
  // count first: matched by its words, not by a line start, or it drops out
  // of the record and the check reads "agreed on every case" over cases that
  // never ran (CompilerHelper's BigInt(number) probe, 2026-10-14: 21 of 696).
  const declined = /\bcase\(s\) the compiled program declined\b/;
  // And invalid HIR by its words too: `nts check` says it as
  // "Error: invalid HIR: …", which a line-start match dropped, so the JVM
  // lane's `function ([]) {…}` over an array literal recorded as not measured
  // (2026-10-15). The prefix goes, so the record reads as `emit-c`'s does.
  const lines = said.filter(
    (l) =>
      /^(checked|agreed|disagree|declined|refused:|not emitted:|not rendered:|nothing to check|invalid HIR)/i.test(l) ||
      /\bdisagree/i.test(l) ||
      /\binvalid HIR\b/.test(l) ||
      declined.test(l),
  ).map((l) => stableCheckText(l.replace(/^Error: (?=invalid HIR)/, "")));
  const text = lines.join(" | ");
  if (/invalid HIR/.test(text)) return { category: "invalid-hir", nts: text };
  // An internal emitter error decides the run on its own: nothing was emitted
  // to compare, and the line matches no deciding prefix above (the Wasm
  // emitter's "no callable fills uniform slot N" in CookieJar#evict@raises
  // recorded as NOT MEASURED with a wall of unrelated refusals as its text,
  // 2026-10-27). The slot number moves with the program, so it comes out.
  const internal = said.find((l) => /^Error: internal \w+ emitter error\b/.test(l));
  if (internal) return { category: "aborted", nts: internal.replace(/^Error: /, "").replace(/uniform slot \d+/, "uniform slot N") };
  // **A backend's refusal by name is a refusal**, as a lowering's is: `nts
  // check` lists each function it did not emit and checks nothing. Before the
  // disagreement test, which a decline's own message can trip -- the JVM
  // emitter's "the emitter and its own accounting disagree" was recorded as a
  // wrong answer -- and which nothing compared can earn. LLVM lists each
  // function as "not rendered:", the others as "not emitted:".
  const notEmitted = lines.find((l) => /^not (?:emitted|rendered):/.test(l));
  if (notEmitted && backendDeclined(said)) {
    return { category: "refused", nts: notEmitted };
  }
  if (/disagree/i.test(text)) return { category: "wrong-answer", nts: text };
  // A stop by name, as a `build` fixture's `aborted`: the first reason, without
  // the counts, which move with the case pool. Below a disagreement, which is
  // the worse answer when a program gives both.
  const aborted = said.find((l) => l.startsWith("the compiled program aborted: "));
  if (aborted) return { category: "aborted", nts: aborted.replace(/^the compiled program aborted: /, "") };
  // **Declined is not agreed**: those cases stopped -- an uncaught throw, a
  // refusal by name -- and were never compared. The first such line, without
  // its explanation, which does not change; below a named abort, whose reason
  // says more.
  const decline = lines.find((l) => declined.test(l));
  if (decline) return { category: "aborted", nts: decline.replace(/\s+--\s.*$/, "") };
  if (/nothing to check/.test(text) && /refused:/.test(text)) {
    const first = lines.find((l) => l.startsWith("refused:"));
    // A location, if the line carries one, is where the fixture's text puts the
    // refusal, not what was refused: moving a line must not change an outcome.
    return { category: "refused", nts: first.replace(/^refused:\s*(?:\S+:\d+:\d+:\s+)?/, "") };
  }
  if (/agreed on every case/.test(text)) return { category: "agrees", nts: text };
  return { category: "not-measured", nts: text || `nts check exited ${status} and said nothing that decides` };
}

/**
 * The construct, not its scratch directory or moved source location: a
 * lowering's `refused:` line, and a backend's `not emitted:` one, which names
 * the same scratch path (a JVM decline, `a-boolean-radix-to-parse-int`).
 */
function stableCheckText(text) {
  return text.replace(/\b(refused|not emitted):\s*\S+:\d+:\d+:\s+/g, "$1: ");
}

function memoryOptions(name) {
  const source = readFileSync(join(FIXTURES, name, "src/main.ts"), "utf8");
  return {
    rc: /^\/\/\s*provider:\s*rc\s*$/m.test(source),
    address: /^\/\/\s*sanitizer:\s*address\s*$/m.test(source),
  };
}

function measure(name) {
  const mode = runMode(name);
  const options = memoryOptions(name);
  // A check reaches what build mode cannot -- a raising copy, which only a
  // caller of the exported function exercises -- so it takes the sanitizer
  // too; on the C backend, where the check links a native program.
  if (mode === "check" && options.address && backendOf(name) !== null) return { run: mode, category: "not-measured", nts: "the address sanitizer checks the C backend only", node: null };
  const dir = materialise(name, join(FIXTURES, name, "src"), mode);
  if (mode === "check") return { run: "check", ...runCheck(dir, backendOf(name), options), node: null };
  const nts = runBuild(dir, options);
  if (nts.category === "refused" && nts.ran === null) return { run: "build", category: "not-measured", nts: "a refused program's artefact could not be run to the end", node: null };
  if (nts.category !== "completed") return { run: "build", ...nts, node: nts.category === "not-measured" ? null : runNode(dir) };
  const node = runNode(dir);
  return { run: "build", category: nts.nts === node ? "agrees" : "wrong-answer", nts: nts.nts, node };
}

// --- self-checks, before any fixture counts ----------------------------------
//
// Each through `measure`'s own path. An agreeing program must come back
// `agrees`; the same program with node told a different story must not; a
// refused construct must come back `refused`, not "completed".

function selfCheck() {
  // `// backend:` names a backend on a line of its own and selects it; prose
  // about one selects nothing.
  for (const [text, want] of [
    ["// run: check\n// backend: wasm\n", "wasm"],
    ["// run: check\n// backend: llvm\n", "llvm"],
    ["// run: check\n// backend: jvm\n", "jvm"],
    ["// backend: Wasm stores a bigint as one v128 and refuses there.\n", null],
    ["// run: check\n", null],
  ]) {
    if (backendIn(text) !== want) return `\`// backend:\` in ${JSON.stringify(text)} read as ${backendIn(text)}, not ${want}`;
  }
  for (const words of [
    "Error: the backend declined 1 function(s), listed above; nothing can be checked",
    "Error: the LLVM backend declined 1 function(s)",
    "Error: the Wasm backend declined 1 shape(s), listed above; nothing can be checked",
  ]) {
    if (!backendDeclined([words])) return `a backend's decline not read as one: ${words}`;
  }
  if (backendDeclined(["agreed on every case"])) return "an agreement read as a backend's decline";
  // An internal emitter error outranks any partial-agreement line before it,
  // and its uniform-slot number is normalised out; an unrelated error stays
  // not measured (the CookieJar#evict@raises line verbatim, 2026-10-27).
  const emitter = decideCheck([
    "checked 12 of 29 cases; the rest were not reached",
    "agreed on every case",
    "Error: internal wasm emitter error in `CookieJar#evict@raises`: no callable fills uniform slot 611",
  ], 1);
  if (emitter.category !== "aborted" || emitter.nts !== "internal wasm emitter error in `CookieJar#evict@raises`: no callable fills uniform slot N") {
    return `an internal emitter error read as ${JSON.stringify(emitter)}`;
  }
  const unrelated = decideCheck(["Error: the input file could not be read"], 1);
  if (unrelated.category !== "not-measured") return `an unrelated error read as ${unrelated.category}`;
  const summary = (site, count = 27) => ({
    run: "check", category: "wrong-answer", node: null,
    nts: `checked 29 cases | refused: ${site} NTS1001 missing method | Error: ${count} case(s) disagree`,
  });
  const before = summary("/scratch/100/source.ts:7:52:");
  if (!judge(before, summary("/scratch/200/source.ts:8:53:")).ok) {
    return "check refusal locations changed an identical observation";
  }
  if (judge(before, summary("/scratch/200/source.ts:8:53:", 28)).ok
      || judge(before, { ...before, nts: before.nts.replace("missing method", "wrong contract") }).ok) {
    return "check location normalization hid a changed count or refusal";
  }
  // A backend's decline names the scratch path the same way.
  const declined = (site, code) => ({
    run: "check", category: "wrong-answer", node: null,
    nts: `not emitted: ${site} ${code} emitting %3 moved the operand stack | Error: the backend declined 1 function(s)`,
  });
  const once = declined("/scratch/100/case.js:19:1:", "NTS4001");
  if (!judge(once, declined("/scratch/200/case.js:19:1:", "NTS4001")).ok) {
    return "check decline locations changed an identical observation";
  }
  if (judge(once, declined("/scratch/200/case.js:19:1:", "NTS4002")).ok) {
    return "check decline normalization hid a changed decline";
  }
  const dir = join(SCRATCH, "self");
  const probe = (text, compilerOptions) => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/main.ts"), text);
    if (compilerOptions) writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions }));
    const d = materialise("self-run", join(dir, "src"), "build");
    const nts = runBuild(d);
    return { nts, node: runNode(d) };
  };
  // Exercise ASan's actual compile/cache/run path independently of the
  // compiler defect. Fixing escape analysis must not invalidate this oracle.
  if (chosen.some((name) => memoryOptions(name).address)) {
    const out = join(SCRATCH, "self-asan");
    mkdirSync(out, { recursive: true });
    const asan = (source) => {
      writeFileSync(join(out, "program.c"), source);
      return buildAndRun({ stdout: "cc -std=c11 program.c -o program\n" }, out, { rc: false, address: true });
    };
    const safe = asan("int main(void) { return 0; }\n");
    if (safe.category !== "completed" || safe.nts !== "exit 0") return `ASan control: ${JSON.stringify(safe)}`;
    const fault = asan("__attribute__((noinline)) static volatile int *returned(void) { volatile int value = 7; return &value; }\nint main(void) { return *returned(); }\n");
    if (fault.category !== "aborted" || fault.nts !== "AddressSanitizer: stack-use-after-return") return `ASan fault: ${JSON.stringify(fault)}`;
  }
  const control = probe('observe("sum", String(1 + 2));\ndone();\n');
  if (control.nts.category !== "completed" || control.nts.nts !== control.node || !/Observed: sum=3;/.test(control.node)) {
    return `control: nts said ${JSON.stringify(control.nts)}, node said ${control.node}`;
  }
  const refused = probe('function classify(text: string): boolean { return /^[a-z]+$/.test(text); }\nobserve("r", String(classify("abc")));\ndone();\n');
  if (refused.nts.category !== "refused") return `refusal arm came back ${refused.nts.category}: ${refused.nts.nts}`;
  // The refused call sits at the top level, so the artefact runs without it:
  // the harness must say so rather than stop at the refusal.
  if (typeof refused.nts.ran !== "string" || !/^exit /.test(refused.nts.ran)) return `refusal arm's artefact was not run: ran=${refused.nts.ran}`;
  // A fixture's own compilerOptions reach the compiler: one read past the end,
  // with and without `noUncheckedIndexedAccess`. With it the read answers
  // `undefined`, as node does; without it the read is typed `number`, and the
  // compiled program cannot answer `undefined` there. When the copy dropped
  // the fixture's options, a defect that needs one was recorded as agreeing.
  const pastTheEnd = 'const xs = [1, 2];\nobserve("past the end", String(xs["ab".length]));\ndone();\n';
  const unchecked = probe(pastTheEnd, { noUncheckedIndexedAccess: true });
  if (unchecked.nts.category !== "completed" || unchecked.nts.nts !== unchecked.node || !/past the end=undefined;/.test(unchecked.node)) {
    return `option arm: nts said ${JSON.stringify(unchecked.nts)}, node said ${unchecked.node}`;
  }
  const typed = probe(pastTheEnd);
  if (typed.nts.category === "completed" && typed.nts.nts === typed.node) {
    return "a fixture's compilerOptions did not change what was compiled";
  }
  return null;
}

// --- the run ----------------------------------------------------------------------

const all = outcomeFixtures();
const chosen = named.length > 0 ? named : all;
if (chosen.length === 0) {
  console.log("  NOT MEASURED: no fixtures under tooling/conformance/outcomes");
  process.exit(1);
}
for (const name of chosen) {
  if (!all.includes(name)) {
    console.log(`  NOT MEASURED: no fixture named ${name}`);
    process.exit(1);
  }
}

console.log(`  compiler ${NTS} (sha256:${FINGERPRINT})`);
const broken = selfCheck();
if (broken) {
  console.log(`  NOT MEASURED: self-check failed -- ${broken}`);
  console.log("  a harness that cannot tell agreement from disagreement cannot hold a record");
  process.exit(2);
}
console.log("  self-checks: control agrees with node, refusal arm refused and its artefact run, a fixture's options reach the compiler" +
  (chosen.some((name) => memoryOptions(name).address) ? "; ASan control clean, use-after-return fault detected" : ""));

let unexpected = 0;
let loud = 0;
const tally = new Map();
for (const name of chosen) {
  const now = measure(name);
  const recordFile = join(FIXTURES, name, "outcome.json");
  if (recording) {
    if (now.category === "not-measured") {
      console.log(`  NOT MEASURED  ${name}: ${now.nts} -- not recorded`);
      unexpected += 1;
      continue;
    }
    const record = {
      run: now.run, category: now.category, nts: now.nts,
      ...(now.category === "refused" && now.run === "build" ? { ran: now.ran } : {}),
      node: now.node, measured_with: FINGERPRINT, source: "measured",
    };
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`  recorded      ${name}: ${now.category} -- ${now.nts}${now.ran !== undefined ? `; ran: ${now.ran}` : ""}${now.node ? `  (node: ${now.node})` : ""}`);
    continue;
  }
  if (!existsSync(recordFile)) {
    console.log(`  NOT MEASURED  ${name}: no outcome.json; run with --record ${name}`);
    unexpected += 1;
    continue;
  }
  const was = JSON.parse(readFileSync(recordFile, "utf8"));
  const verdict = judge(was, now);
  tally.set(verdict.word, (tally.get(verdict.word) ?? 0) + 1);
  if (!verdict.ok) unexpected += 1;
  if (verdict.loud) loud += 1;
  console.log(`  ${verdict.word.padEnd(14)}${name}: ${verdict.why}`);
}

function judge(was, now) {
  if (now.category === "not-measured") return { word: "NOT MEASURED", ok: false, why: now.nts };
  if (was.run !== now.run) return { word: "CHANGED", ok: false, why: `recorded under ${was.run}, measured under ${now.run}` };
  if (now.node !== was.node && was.node !== null && now.node !== null && now.category !== "refused") {
    return { word: "ORACLE CHANGED", ok: false, why: `node said ${was.node}, now ${now.node}` };
  }
  // A refused build record says what its artefact did; one written before it
  // did has no `ran`, and reads as CHANGED until re-recorded, never as the same.
  const ranTo = (r) => (r.category === "refused" && r.run === "build" ? r.ran : undefined);
  // Old records retain their original spelling and provenance. Apply the same
  // normalization to them that new check measurements use.
  const textOf = (r) => r.run === "check" ? stableCheckText(r.nts) : r.nts;
  const same = was.category === now.category && textOf(was) === textOf(now) && ranTo(was) === ranTo(now);
  const past = ranTo(now) !== undefined && ranTo(now) !== now.node && /^exit /.test(ranTo(now))
    ? ` -- and the program still ran, answering ${ranTo(now)} where node answers ${now.node}`
    : "";
  if (same) return { word: was.category === "agrees" ? "holds" : "reproduces", ok: true, why: `${now.category} -- ${now.nts}${past}` };
  if (was.category === "agrees") return { word: "REGRESSED", ok: false, why: `agreed with node; now ${now.category} -- ${now.nts}` };
  if (now.category === "agrees") {
    return { word: "FIXED", ok: true, loud: true, why: `was ${was.category} (${was.nts}); agrees with node now -- move it to tests/programs/ or re-record it as a guard` };
  }
  if (now.category === "refused" && was.category !== "refused") {
    return {
      word: "REFUSES NOW",
      ok: true,
      loud: true,
      why: `was ${was.category}; hand it to tests/refusals/ with\n                // expect: ${now.nts}`,
    };
  }
  if (was.category === now.category && textOf(was) === textOf(now)) {
    return { word: "CHANGED", ok: false, why: `refused as before; its artefact ran to ${ranTo(was) ?? "(not recorded)"}, now ${ranTo(now)}` };
  }
  return { word: "CHANGED", ok: false, why: `${was.category} (${was.nts}) -> ${now.category} (${now.nts})` };
}

// **A recorded fixture is an input to `integrity`**, which reads every outcomes
// program, and one that pins a defect shows that defect's structural
// violations. Two fixtures landed without their integrity.known entries and
// turned `integrity` red on main for every lane (an-init-hook-of-one-
// parameter, a-teed-stream-read-back). So a record is not finished until
// integrity passes over it: run here, on the same pinned compiler, and any
// violation it does not already know is printed as owed.
if (recording && chosen.length > 0) {
  const recorded = chosen.map((name) => join("tests/outcomes", name));
  const check = spawnSync("node", [join(HERE, "integrity.ts"), ...recorded], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NTS_BIN: NTS },
    maxBuffer: 1 << 26,
  });
  const said = `${check.stdout ?? ""}${check.stderr ?? ""}`;
  if (check.status === 0) {
    console.log(`  integrity: clean over the recorded fixture(s)`);
  } else {
    const owed = said.split("\n").filter((l) => /^ {2}[a-z-]+ {2,}tests\/outcomes\//.test(l));
    console.log(`  integrity: the recorded fixture(s) owe ${owed.length} integrity.known entr${owed.length === 1 ? "y" : "ies"} -- add them in this commit`);
    for (const line of owed.slice(0, 20)) console.log(`  ${line.trim()}`);
    if (owed.length === 0) console.log(`  ${said.trim().split("\n").slice(-2).join(" / ")}`);
    unexpected += 1;
  }
}

console.log();
console.log(
  `  ${chosen.length} fixture(s)` +
    (recording ? " recorded" : `: ${[...tally].map(([w, n]) => `${n} ${w}`).join(", ")}`) +
    (loud > 0 ? `; ${tally.get("FIXED") ?? 0} fixed, ${tally.get("REFUSES NOW") ?? 0} refusing now -- move or re-record` : "") +
    (unexpected > 0 ? `; ${unexpected} need a person` : ""),
);
process.exit(unexpected > 0 ? 1 : 0);
