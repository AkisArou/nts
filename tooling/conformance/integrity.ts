import { FIXED_AMBIENT } from "../gate/canonical-environment.ts";
// Is what the backend receives whole? Nine facts about a program, checked from
// the compiler's own listings, each one a defect that shipped silently.
//
//   node tooling/conformance/integrity.ts [project ...]   (default: tests/programs/*, blockers/*, outcomes/*)
//   node tooling/conformance/integrity.ts --runtime       runtime/node/* and runtime/web-platform
//   node tooling/conformance/integrity.ts --self-test
//   NTS_BIN=<a pinned copy> node tooling/conformance/integrity.ts
//
// # Why
//
// Every other instrument asks whether a program *answers* right (the
// differential, outcomes) or *refuses* honestly (phantoms, blockers). None asks
// whether the program the backend was handed is the one the source describes.
// On 2026-09-27 three defects in one night were exactly that, and each was
// found by a person:
//
//   - two modules exporting a class named `Thing`: the method table asked for
//     `Thing#value`, the methods were `Thing@a#value` and `Thing@b#value`, and
//     no table was emitted -- a virtual call through null, no refusal (8482afb63);
//   - a refused `main` cut out of the top level by `excise_from_initializer`:
//     the app built, exited 0, and did less than its source;
//   - cascades naming a cause with no refusal of its own -- a generator's
//     refusal filed under another name, a static's under `Owner#m` for
//     `Owner.m` -- which is how a reader spends a night on the wrong function.
//
// # The rules, each checked over `hir --prepared`, `hir`, `layouts`, `refusals`
//
//   call-resolves      every direct `call NAME(` names exactly one definition,
//                      and no name is defined twice. Not `call.virtual`: its
//                      name only supplies a signature, and a refused declared
//                      method dispatches fine through its receiver's table.
//   table-resolves     every entry of a `methods` table is defined exactly once.
//   owner-has-layout   every instance method's `this` type (a definition taking
//                      `this`; `apply#Closure1` is a specialisation) is a class
//                      `layouts` lists.
//   override-in-table  a method whose name an ancestor's table dispatches is in
//                      its own class's table -- the `Thing` defect, where both
//                      classes merged into one layout with no table. Methods
//                      join layouts by the type id of `this`, never by name:
//                      after the fix `layouts` calls them `Thing` and
//                      `Thing11`, a third spelling. Scoped to the hierarchy:
//                      across unrelated classes a shared member name means
//                      nothing, and the first version flagged 247 methods so.
//   cascade-has-root   every NTS1003 names a cause with a root of its own: a
//                      called `X` that `nts refusals` lists (a generic instance
//                      matching its generic -- `R<3054>#m` is filed as `R#m`),
//                      or a read global whose initializer has its own line.
//                      It asks whether a blamed cause *has* a record, not
//                      whether the record is the *right* one: an attribution
//                      that overwrote a nested function's own reason with its
//                      enclosing function's (ffd44917d, corrected) passed it.
//                      Truth needs a fixture that varies what a change decides.
//                      The runtime has 208 distinct causes with none on
//                      47cba8c15 -- 76 symbol-keyed and 70 private methods,
//                      51 functions -- whose roots print at lowering and are
//                      missing from `Program::uncompiled`. Hence `--runtime`
//                      is not in the default run until they are recorded.
//   top-level-kept     every call to a refused function that preparation cuts
//                      from `module#init` is reported as a cut ("this
//                      module-scope statement was dropped", "the initializer
//                      of `G` was not compiled"). Before 47cba8c15 a statement
//                      whose value no global stored was cut in silence -- 29
//                      of them across the runtime, `Process#constructor` among
//                      them. A firing now is a third way to lose one.
//   location-on-a-token
//                      every diagnostic's location is the first byte of a
//                      token: not whitespace, not past the end of its line,
//                      not inside a character or an identifier. Columns are
//                      UTF-8 bytes; a UTF-16 offset read as bytes lands inside
//                      tokens after any non-ASCII text, which only this
//                      stricter form sees. nts located at a
//                      node's full start, its leading trivia: one column early
//                      after a space, the line *before* after a newline -- on
//                      a clean 1075648be about 2,200 of them, `map`'s at a
//                      type alias among them. One cause, so known entries
//                      name a project and a code, not each location.
//   refusal-not-compiled
//                      no name `nts refusals` lists is compiled by the
//                      prepared program (a `declare func` shell is not). This
//                      is phantoms.mjs's question, asked here so the runtime is
//                      covered: the gate's phantoms step never ran over it, and
//                      runtime/node/punycode had four.
//   unerase-is-built   in a whole program, every `unerase` to an object type
//                      targets a layout some `object.new` builds, or one a
//                      built class descends from -- or is guarded by an
//                      `instanceof` of the same value. Otherwise nothing that
//                      could be there has that layout: a conditional of two
//                      classes returned at an interface unerased to the
//                      interface's own layout, whose table nothing fills (a
//                      null jump), and `pendingProps as SuspenseProps` read a
//                      record at another record's offsets (a wrong answer).
//                      Both unchecked on C and LLVM, so nothing else refuses.
//                      Signature layouts (`Fn…`) are not judged: the call slot
//                      is program-global, and census/erased-calls.ts asks
//                      their question. Not over the runtime, whose values
//                      arrive across an addon's boundary built by glue no
//                      listing shows (erased-calls' "outside") -- nor, for
//                      the same reason, a value unerased from an exported
//                      function's parameter, or from a parameter every direct
//                      caller fills from one.
//                      An erased element read from a proved typed array also
//                      keeps its element layout. Empty arrays and arrays of
//                      nulls need not construct that layout. This rule checks
//                      representation, not the separate absence/coercion check.
//   top-level-cut      every reported cut, named: a dropped statement, an
//                      initializer not compiled, a refused `module#init`.
//                      Honest, and still a program that does less than its
//                      source. integrity.known is the ratchet -- a new cut
//                      fails, a fixed one prints "remove it" -- so that the
//                      day it is empty `nts build` can make one an error.
//
// Each rule was run over all examples, the blockers and the 27 runtime modules
// (40,052 functions) before it was kept, and each fires on the defect it names
// while its one-thing control stays clean. The four structural rules are clean
// on all of it. Two candidates were dropped on that evidence:
// "a subclass of a class with a table has one" (a closure whose `#call` was
// refused legitimately has none: 1,387 runtime hits) and an unscoped member
// match (above).
//
// # What no rule here can see
//
// A program that compiles *wrongly*. Every rule asks whether the program the
// backend receives is consistent with itself and with its diagnostics; none
// asks whether it computes what the source means. On 2026-09-27 an arm that
// unerased a structurally-assignable `Slim` to a `Both` (an all-optional
// interface extending it) read a slot that does not exist, and would have
// passed every rule: it defined what it called, its tables resolved, nothing
// was cut. Only an answer compared against node, or a fixture that varies what
// the change decides, sees that. This is a consistency check, not a
// correctness oracle -- written down so nobody reads a clean run as one.
//
// # Known violations are named, never counted
//
// `tooling/conformance/integrity.known`, one per line:
// `project<TAB>rule<TAB>subject<TAB>why`. The subject is the violation's text,
// except under cascade-has-root, where it is the blamed cause alone: an entry
// names the unrecorded root once, and covers every cascade through it, so a
// new caller of an already-known cause is not a new violation. A violation listed there is printed
// and passes; any other fails. A listed one that no longer occurs prints
// "remove it" and passes -- going red on a fix is the wrong direction.
//
// # Not measured is a failure
//
// A project whose parsed definitions disagree with its own "N function(s)"
// summary, or whose command fails, is NOT MEASURED and fails the run: a
// listing parsed as empty satisfies every rule above.
//
// Exit 0: every project measured, nothing but known violations. Exit 1: a
// violation or a project not measured. Exit 2: the tool could not start.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { OUTCOMES, materialise, outcomeFixtures, runMode } from "./outcomes-project.ts";

import { limiter, longestFirst, recordCosts } from "../gate/costs.mjs";
import { withToken } from "../gate/tokens.mjs";
import { COUNTER_SCOPE, spawnCounted } from "../gate/cputime.mjs";
import { COMPILE_WORK_PROFILE, compileWorkSettings, compileCommand } from "../gate/compile-counter.ts";
import { measuredCompileEnvironment } from "../gate/canonical-environment.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KNOWN = join(HERE, "integrity.known");
/** The projects built as addons: their exported surface is called from outside. */
const ADDON = /^runtime\/(node|web-platform)(\/|$)/;
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");

// hir --prepared without --rc prepares NoGC; kept rows record that arm.
const env = { ...process.env, NTS_CHECKERS: "1", ...FIXED_AMBIENT };
// Four listings per project; `http` alone lowers for about 95 s. Memory, not
// cores, is what this box runs out of.
const WORKERS = Number(process.env.NTS_INTEGRITY_JOBS ?? 4);

// --- reading the listings ----------------------------------------------------

/**
 * Definitions (with multiplicity), which of them are instance methods, direct
 * calls, and `module#init`'s calls. An instance method is one whose first
 * parameter is `this`: `#` alone also spells a specialisation (`apply#Closure1`).
 */
export function readHir(text) {
  const defined = new Map();
  /** instance method -> the type id of its `this`, the compiler's own identity for its class */
  const methods = new Map();
  /** Definitions with a body: a `declare func` shell is emitted for dispatch and compiles nothing. */
  const compiled = new Set();
  for (const m of text.matchAll(/^(?:export )?(declare )?func (.+?)\((?:this: managed<obj#(\d+)>)?/gm)) {
    defined.set(m[2], (defined.get(m[2]) ?? 0) + 1);
    if (!m[1]) compiled.add(m[2]);
    if (m[3]) methods.set(m[2], m[3]);
  }
  const calls = [...text.matchAll(/= call (.+?)\(/g)].map((m) => m[1]);
  // A generated bridge can be shared by class and interface slots. Its
  // suffix says nothing about which body it serves: prove that from its one
  // direct call, on this same receiver. A wrapper calling the base body must
  // not count as the overriding body merely because its name looks right.
  const bridges = new Map();
  for (const m of text.matchAll(/^(?:export )?func (.+?)\([^\n]*\n(.*?)^\}/gms)) {
    const name = m[1];
    if (!methods.has(name) || name.lastIndexOf("@") <= name.indexOf("#")) continue;
    const direct = [...m[2].matchAll(/^  (?:%\d+ = )?call (.+?)\(([^\n]*)\)/gm)];
    if (direct.length !== 1) continue;
    const [, target, args] = direct[0];
    if (args.split(",")[0].trim() === "%0" && compiled.has(target) && methods.get(target) === methods.get(name)) {
      bridges.set(name, target);
    }
  }
  const init = /^(?:export )?func module#init\(.*?^\}/ms.exec(text)?.[0] ?? "";
  const initCalls = new Set([...init.matchAll(/= call (.+?)\(/g)].map((m) => m[1]));
  const stated = /^(\d+) function\(s\)/m.exec(text);
  const lines = [...defined.values()].reduce((a, n) => a + n, 0);
  return { defined, compiled, methods, bridges, calls, initCalls, lines, stated: stated ? Number(stated[1]) : null };
}

/**
 * Classes from `nts layouts`: `{ byName, byId, byType }`, each class `{ name, base,
 * methods }`. A block is a header `Name [ids]` and two-space lines under it.
 * Joined to HIR **by type id**, never by name: after 8482afb63 `layouts` names
 * two same-named classes `Thing` and `Thing11` while their methods are
 * `Thing@a#value` and `Thing@b#value` -- a third spelling of one class. A *field*
 * that happens to be called `methods` prints as `methods : Type` and is not a table. Each table
 * entry has its own row; names can contain spaces or lack a member separator.
 */
export function readLayouts(text) {
  const byName = new Map();
  const byId = new Map();
  const byType = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const head = /^(\S.*?) \[([\d ]+)\]$/.exec(line);
    if (head) {
      current = { name: head[1], base: null, methods: [], implements: [], fields: 0, ids: head[2].split(" ") };
      byName.set(head[1], current);
      for (const id of head[2].split(" ")) byId.set(id, current);
      continue;
    }
    if (!line.startsWith("  ")) {
      current = null;
      continue;
    }
    if (!current) continue;
    const hirType = /^ {2}hir-type (managed<[^>]+>)$/.exec(line);
    if (hirType) byType.set(hirType[1], current);
    const base = /^ {2}base \d+ -> (.+)$/.exec(line);
    if (base) current.base = base[1];
    const implemented = /^ {2}implements (.+)$/.exec(line);
    if (implemented) current.implements.push(...implemented[1].split(/,\s*|\s+/).filter(Boolean));
    const table = /^ {2}methods (?!:)(.+)$/.exec(line);
    // Typed symbol and quoted field labels can contain spaces. Classify a
    // method-table row first: its target label may also contain ` : `.
    if (table) current.methods.push(table[1]);
    else if (/^ {2}.+ : /.test(line)) current.fields += 1;
  }
  return { byName, byId, byType };
}

const identifierByte = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x24 || b >= 0x80;

/**
 * Whether byte `at` of a line starts a token: null if it does, else where it
 * is instead. Not whitespace, not past the end, not inside a multi-byte
 * character, and not inside an identifier -- the old `60:9` landed on the `ta`
 * of `total`, a character of a token and not its start. Punctuation is a
 * token of its own, so `(` after `f` starts one.
 */
function tokenStart(bytes, at) {
  const b = bytes[at];
  if (b === undefined) return "past the end of its line";
  if (b === 0x20 || b === 0x09 || b === 0x0d) return "on whitespace";
  if (b >= 0x80 && b <= 0xbf) return "inside a character";
  if (at > 0 && identifierByte(b) && identifierByte(bytes[at - 1])) return "inside a token";
  return null;
}

/**
 * Every diagnostic's location: `/abs/file.ts:107:14 NTS1001 ...`, each once. A
 * location in code a source transform generated carries `(in code ...
 * generated from it)` after it and is not read: its column is the generated
 * code's, and the file on disk is not that code.
 */
export function readLocations(text) {
  const seen = new Map();
  for (const [, file, line, col, code, body] of text.matchAll(/(\/\S+?\.[cm]?tsx?):(\d+):(\d+):? (NTS\d{4}) (.*)$/gm)) {
    seen.set(`${file}:${line}:${col} ${code} ${body}`, { file, line: +line, col: +col, code, text: body });
  }
  return [...seen.values()];
}

/** Statement cuts without the named call/read/initializer report at that site. */
export function readStatementCuts(text) {
  // Match diagnostic lines, not diagnostic-looking HIR string constants.
  // Cuts can originate in JavaScript or generated sources as well as TypeScript.
  const locations = [...text.matchAll(/^[ \t]*(?:--[ \t]+)?(\/.+?):(\d+):(\d+):? (NTS100[35]) (.*)$/gm)]
    .map(([, file, line, col, code, body]) => ({ file, line: +line, col: +col, code, text: body }));
  const site = ({ file, line, col }) => `${file}:${line}:${col}`;
  const named = new Set(locations.filter((d) => d.code === "NTS1003" &&
    /^(?:this module-scope statement was dropped because it (?:calls|reads)|the initializer of `[^`]+` was not compiled because it (?:calls|reads)) /.test(d.text)).map(site));
  const cuts = new Map();
  for (const d of locations) {
    if (d.code === "NTS1005" && d.text.startsWith("this statement, which module evaluation therefore skips") && !named.has(site(d))) {
      cuts.set(site(d), d);
    }
  }
  return [...cuts.values()];
}

const sourceLines = new Map();
/** One line of a source file on disk, 1-based; undefined when it cannot be read. */
function readSourceLine(file, n) {
  if (!sourceLines.has(file)) {
    try { sourceLines.set(file, readFileSync(file, "utf8").split("\n")); } catch { sourceLines.set(file, null); }
  }
  return sourceLines.get(file)?.[n - 1];
}

/** The first column of `nts refusals`. */
export const readRefusals = (text) => new Set(text.split("\n").map((l) => l.split("\t")[0]).filter(Boolean));
/** `nts refusals` as name -> reason. */
export const readReasons = (text) => new Map(text.split("\n").filter((l) => l.includes("\t")).map((l) => [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)]));

/**
 * The refusal a name finally rests on, followed through "it calls `Y`" to the
 * function whose reason is its own. A cut is ranked by this: thirty of the
 * runtime's cuts were two globals, and whether those two share one root is
 * what decides the order of the work. `null` when the name has no reason.
 */
export function rootOf(name, reasons) {
  const seen = new Set();
  let at = reasons.has(name) ? name : reasons.has(generic(name)) ? generic(name) : null;
  while (at && !seen.has(at)) {
    seen.add(at);
    const next = /^it calls `([^`]+)`/.exec(reasons.get(at))?.[1];
    if (!next || !(reasons.has(next) || reasons.has(generic(next)))) return { name: at, reason: reasons.get(at).replace(/^it calls `[^`]+`, and /, "") };
    at = reasons.has(next) ? next : generic(next);
  }
  return at ? { name: at, reason: `a cycle through \`${at}\`` } : null;
}

/**
 * NTS1003 cascades, in the four shapes lowering prints, each with the kind of
 * root it owes:
 *
 *   `W` cannot be compiled because it calls `X`            X is refused
 *   `W` cannot be compiled because it reads `G`, whose
 *     initializer was not compiled                         G's initializer line exists
 *   the initializer of `G` was not compiled because it
 *     calls `X`                                            X is refused
 *   this module-scope statement was dropped because it
 *     calls `X`                                            X is refused
 *   the initializer of `G` was not compiled because it
 *     reads `H`                                            H's initializer line exists
 *   this module-scope statement was dropped because it
 *     reads `H`                                            H's initializer line exists
 *
 * The last two are also the *reports* of a cut from `module#init`, which
 * `top-level-kept` holds the program to.
 */
export function readCascades(text) {
  const calls = [...text.matchAll(/NTS1003 `([^`]+)` cannot be compiled because it calls `([^`]+)`/g)].map(([, who, cause]) => ({ who, cause }));
  const reads = [...text.matchAll(/NTS1003 `([^`]+)` cannot be compiled because it reads `([^`]+)`/g)].map(([, who, global]) => ({ who, global }));
  const initializers = [...text.matchAll(/NTS1003 the initializer of `([^`]+)` was not compiled because it calls `([^`]+)`/g)].map(([, global, cause]) => ({ global, cause }));
  const statements = [...text.matchAll(/NTS1003 this module-scope statement was dropped because it calls `([^`]+)`/g)].map(([, cause]) => ({ cause }));
  // Module evaluation reading a binding it no longer assigns is cut with its
  // statement (641b21042), and the line names the binding rather than a call.
  const initializerReads = [...text.matchAll(/NTS1003 the initializer of `([^`]+)` was not compiled because it reads `([^`]+)`/g)].map(([, global, read]) => ({ global, read }));
  const statementReads = [...text.matchAll(/NTS1003 this module-scope statement was dropped because it reads `([^`]+)`/g)].map(([, read]) => ({ read }));
  // A skipped module-scope statement that leaves a global unwritten says so
  // (1c12d40c9): `NTS1005 this statement, which module evaluation therefore
  // skips, leaving `stdout` unwritten`. That is the global's record as much as
  // an initializer line is.
  // Every name in the clause: `leaving `a`, `b` unwritten and `c` as it was`
  // -- the last for a binding the statement would have reassigned.
  const unwritten = [...text.matchAll(/NTS1005 this statement, which module evaluation therefore skips, leaving ([^;]+);/g)].flatMap(([, clause]) => [...clause.matchAll(/`([^`]+)`/g)].map(([, global]) => global));
  return { calls, reads, initializers, statements, initializerReads, statementReads, unwritten };
}

/**
 * A member's spelling, without the legacy erasure suffix:
 * `Sub#read@erased` is `Sub#read`, erased to the slot's representation
 * (`lower/virtual_returns.rs`). This discovers an ancestor's dispatched name;
 * accepting a table entry requires its resolved call target below.
 */
const unbridged = (name) => name.replace(/@erased$/, "");
const member = (name) => unbridged(name).slice(name.indexOf("#") + 1);
/** A generic instance is filed under its generic: `R<3054>#m` is `R#m`. */
const generic = (name) => name.replace(/<\d+>/g, "");
/**
 * A violation's text with the compiler's numbering taken out, for matching
 * known entries: a closure's number and a generic's type id move with
 * unrelated changes (`Closure524274`, `R<3054>`, `map@0obj7889`), and an
 * entry keyed on one would expire and reappear as "new" the day they did.
 */
const stable = (detail) => detail.replace(/Closure\d+/g, "ClosureN").replace(/<\d+>/g, "<N>").replace(/obj\d+/g, "objN");

/**
 * What a program has under a name a cascade blames and nothing refused -- the
 * evidence for *why* the root is missing, read from the program's own raw
 * names (never the known file's, whose numbering is taken out and with it the
 * suffixes that tell these apart):
 *
 *   compiled       the blamed function compiles: the cascade is stale
 *   declared       a `declare func` shell and no body
 *   instantiated   only instances `name<...>`: the call names the generic,
 *                  which is a wrong call rather than a missing refusal
 *   renumbered     the same name under another number (`Closure12` for
 *                  `Closure9`): a lifted function renamed after it was cited
 *   suffixed       `name@...`: a module-qualified or aliased spelling
 *   member         `Owner#name`
 *   copy-of-refused  `name@0obj7`, a copy specialised for an argument's
 *                  shape, whose `name` is refused: the copy was never made,
 *                  and the cascade cites the name only it would have had
 *   refused-as     nothing defined, but refused under one of the spellings
 *                  above (`name@async` for `name`): the refusal is recorded
 *                  against another name
 *   nothing        none of these: no body, no refusal, no resemblance.
 *                  Names cannot say more; by hand on 2026-09-27 these were a
 *                  function nested in a refused one (`filterFn` in `filter`),
 *                  lowered with its parent and so never, and a `declare`d
 *                  binding taken as a value (`applyId(nts_process_setuid)`),
 *                  whose wrapper calls a binding nothing declares
 *
 * `shape` is the blamed name's own form, independent of the program: a
 * binding (`nts_`), a closure, a nested function (`outer@...`), or plain.
 */
/** `; the program has ...` or `; refused as ...`, whichever the evidence is. */
export const evidenceText = (r) =>
  r.evidence.length === 0 ? "" : `; ${r.kind === "refused-as" || r.kind === "copy-of-refused" ? "refused as" : "the program has"} ${r.evidence.map((e) => `\`${e}\``).join(", ")}`;

export function resemblance(cause, hir, refused) {
  const shape = /^nts_/.test(cause) ? "binding" : /Closure\d+/.test(cause) ? "closure" : cause.includes("@") ? "nested" : "plain";
  const spelled = (d) => d.startsWith(`${cause}<`) || d.startsWith(`${cause}@`) || d.endsWith(`#${cause}`) || (d !== cause && stable(d) === stable(cause));
  const defined = [...hir.defined.keys()];
  const kinds = [
    ["compiled", () => (hir.compiled.has(cause) ? [cause] : [])],
    ["declared", () => (hir.defined.has(cause) ? [cause] : [])],
    ["instantiated", () => defined.filter((d) => d.startsWith(`${cause}<`))],
    ["renumbered", () => defined.filter((d) => d !== cause && stable(d) === stable(cause))],
    ["suffixed", () => defined.filter((d) => d.startsWith(`${cause}@`))],
    ["member", () => defined.filter((d) => d.endsWith(`#${cause}`))],
    ["copy-of-refused", () => {
      const base = /^(.+)@\d+obj\d+$/.exec(cause)?.[1];
      return base && refused.has(base) ? [base] : [];
    }],
    ["refused-as", () => [...refused].filter((r) => r !== cause && spelled(r))],
  ];
  for (const [kind, find] of kinds) {
    const evidence = find();
    if (evidence.length > 0) return { shape, kind, evidence: evidence.sort().slice(0, 4) };
  }
  return { shape, kind: "nothing", evidence: [] };
}

/**
 * An element read through the runtime: its array is the first operand. The
 * third, when present, is the absence tag a null slot reads as. One pattern for
 * every reader -- two copies of it went stale apart when the tag was added.
 */
const ARRAY_ELEMENT = /^call\.extern nts_array_element\((%\d+), %\d+(?:, %\d+)?\)$/;

/**
 * `unerase` sites whose object layout nothing in the program builds, and no
 * built class descends from, and no `instanceof` of the same value guards:
 * `{ fn, target }` each. See `unerase-is-built`.
 */
// Optional final-operation proof facts. A partial, stale or contradictory
// projection grants nothing; old listings retain the original judgment.
function readFieldContracts(prepared) {
  const result = new Map();
  const integer = (n) => Number.isSafeInteger(n) && n >= 0;
  for (const line of prepared.split("\n")) {
    if (!line.startsWith("field-read-contract ")) continue;
    try {
      const encoded = line.slice("field-read-contract ".length);
      if (!/^(?:[a-f0-9]{2})+$/.test(encoded)) return new Map();
      const text = Buffer.from(encoded, "hex").toString("utf8"), p = JSON.parse(text);
      if (Buffer.from(text, "utf8").toString("hex") !== encoded) return new Map();
      const key = `${p.function}\0${p.operation}`;
      const member = p.member && typeof p.member === "object" && !Array.isArray(p.member) ? Object.keys(p.member) : [];
      if (JSON.stringify(p) !== text || p.version !== 1 || p.eager !== false || typeof p.function !== "string"
          || ![p.operation, p.root, p.receiver, p.face, p.field].every(integer)
          || ![null, 0].includes(p.argument) || typeof p.rendered !== "string"
          || !/^[a-f0-9]{64}$/.test(p.body_sha256)
          || !Array.isArray(p.dependencies)
          || p.dependencies.some((d) => typeof d.function !== "string" || !/^[a-f0-9]{64}$/.test(d.body_sha256) || d.function === p.function)
          || new Set(p.dependencies.map((d) => d.function)).size !== p.dependencies.length
          || ((p.argument === null) !== (p.dependencies.length === 0))
          || typeof p.representation !== "string" || !p.representation
          || member.length !== 1 || !["Name", "Private", "Symbol"].includes(member[0])
          || (member[0] === "Symbol" ? !integer(p.member.Symbol) : typeof p.member[member[0]] !== "string")
          || !Array.isArray(p.owners) || p.owners.length === 0
          || p.owners.some((o) => !integer(o.id) || typeof o.field_prefix !== "boolean")
          || new Set(p.owners.map((o) => o.id)).size !== p.owners.length
          || ![p.prefix_receivers, p.other_receivers].every((v) => Array.isArray(v) && v.every(integer) && new Set(v).size === v.length)
          || p.prefix_receivers.some((id) => p.other_receivers.includes(id))
          || !["stored-prefix", "dominating-direct", "validated-small-dispatch"].includes(p.mode)
          || (p.mode === "stored-prefix" && p.owners.some((o) => !o.field_prefix))
          || ((p.argument === null) !== ["stored-prefix", "dominating-direct"].includes(p.mode))
          || result.has(key)) return new Map();
      result.set(key, p);
    } catch { return new Map(); }
  }
  return result;
}

// Check all uses, not just a recognized getter. The producer owns licensing;
// this reader binds it to the exact active op, receiver and call argument.
// Unsupported alias/control transfers fail closed rather than lose a use.
function contractedFieldRead(f, start, face, contracts) {
  const lines = f.chunk.split("\n").filter((line) => line.startsWith("  "));
  const users = new Map();
  for (const line of lines) {
    const definition = /^ {2}(%\d+) = /.exec(line)?.[1];
    const expression = line.replace(/^ {2}%\d+ = /, "");
    for (const value of new Set(expression.match(/%\d+/g) ?? [])) {
      users.set(value, [...(users.get(value) ?? []), { line, definition, expression }]);
    }
  }
  let reads = 0;
  const seen = new Set();
  const walk = (value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    const uses = users.get(value) ?? [];
    if (uses.length === 0) return false;
    return uses.every(({ line, definition, expression }) => {
      // These inspect identity/tag only, and the scalar result is not an alias.
      if (new RegExp(`^(?:instanceof|tag\\.of) ${value}(?: |$)`).test(expression)) return true;
      if (definition && new RegExp(`^(?:erase|unerase|convert) ${value}(?: :|$)`).test(expression)) return walk(definition);
      const id = definition ? Number(definition.slice(1)) : null;
      const proof = contracts.get(`${f.name}\0${id}`);
      if (!proof || proof.root !== Number(start.slice(1)) || proof.face !== Number(face)
          || proof.receiver !== Number(value.slice(1)) || line !== `  ${proof.rendered}`) return false;
      if (proof.argument === null) {
        if (expression !== `field.get ${value}.${proof.field} : ${proof.representation}`) return false;
      } else {
        // Exactly one receiver argument, at the recorded ABI index. A default
        // body name or another use of this value cannot stand in for the op.
        const call = /^call (.+)\(([^()]*)\) : .+$/.exec(expression);
        if (!call || call[2].trim() !== value || !proof.dependencies.some((d) => d.function === call[1])) return false;
      }
      reads += 1;
      return true;
    });
  };
  return walk(start) && reads > 0;
}

export function unbuiltUnerases(prepared, { byName, byId, byType }) {
  const fieldContracts = readFieldContracts(prepared);
  // Anonymous cast faces dispatch by the concrete receiver. They need no
  // allocation of the face's own layout; a positional read still violates
  // that contract and must not gain an exemption from the printed marker.
  const castFaces = new Set([...prepared.matchAll(/^cast-face (\d+)$/gm)].map((m) => m[1]));
  const allocations = [...prepared.matchAll(/object\.new \S+ : (managed<[^>]+>)/g)].map((m) => m[1]);
  const madeIds = new Set(allocations.flatMap((type) => /^managed<obj#(\d+)>$/.exec(type)?.[1] ?? []));
  // The CLI renders a synthetic frame as `generator#N`, while layouts lists
  // its actual type id. Join through the renderer's explicit alias: neither
  // the frame's name nor an independent copy of its synthetic-id bands.
  const madeLayouts = new Set(allocations.map((type) => byType.get(type) ?? byId.get(/^managed<obj#(\d+)>$/.exec(type)?.[1])).filter(Boolean));
  const covered = new Set();
  for (const layout of madeLayouts) {
    for (let at = layout, seen = 0; at && seen < 64; at = byName.get(at.base), seen++) {
      covered.add(at.name);
      // **An interface a built class implements, if it declares no fields.**
      // Unerased to it, a value is only dispatched on, and dispatch reads the
      // object's own descriptor -- so nothing lands at a wrong offset. The case
      // this rule was first written for, a conditional of two classes unerased
      // to their interface, was not that defect after all: its segfault was a
      // frame escape (be4e79d81). An interface *with* fields is still judged,
      // since a field read at its offsets is the record-misread this rule exists
      // for (`pendingProps as SuspenseProps`).
      for (const name of at.implements) if ((byName.get(name)?.fields ?? 1) === 0) covered.add(name);
    }
  }
  const fns = new Map();
  let duplicateFunctions = false;
  for (const chunk of prepared.split(/\n(?=(?:export )?(?:declare )?func )/)) {
    const name = /^(?:export )?(?:declare )?func (.+?)\(/.exec(chunk)?.[1];
    if (!name) continue;
    const params = new Map([...chunk.matchAll(/^ {2}(%\d+) = param (\d+) /gm)].map((m) => [m[1], Number(m[2])]));
    const values = new Map([...chunk.matchAll(/^ {2}(%\d+) = (.*?) : (.+)$/gm)].map((m) => [m[1], { op: m[2], type: m[3] }]));
    if (fns.has(name)) duplicateFunctions = true;
    fns.set(name, { name, chunk, exported: chunk.startsWith("export "), params, values });
  }
  const bodyHashes = new Map();
  const bodyHash = (name) => {
    if (!bodyHashes.has(name)) {
      const f = fns.get(name);
      const body = f ? f.chunk.slice(f.chunk.indexOf("\n") + 1, f.chunk.lastIndexOf("\n}")) + "\n" : null;
      bodyHashes.set(name, body === null ? null : createHash("sha256").update(body).digest("hex"));
    }
    return bodyHashes.get(name);
  };
  if (duplicateFunctions || [...fieldContracts.values()].some((p) => {
    const f = fns.get(p.function), op = f?.values.get(`%${p.operation}`), root = f?.values.get(`%${p.root}`);
    return !op || !root || !f.values.has(`%${p.receiver}`)
      || bodyHash(p.function) !== p.body_sha256
      || p.dependencies.some((d) => bodyHash(d.function) !== d.body_sha256)
      || p.rendered !== `%${p.operation} = ${op.op} : ${op.type}`
      || !/^unerase %\d+$/.test(root.op) || root.type !== `managed<obj#${p.face}>`;
  })) fieldContracts.clear();
  const callers = new Map();
  for (const f of fns.values()) {
    for (const m of f.chunk.matchAll(/^ {2}(?:%\d+ = )?call ([^\s(]+)\(([^)]*)\)/gm)) {
      callers.set(m[1], [...(callers.get(m[1]) ?? []), { f, args: m[2].split(",").map((a) => a.trim()) }]);
    }
  }
  // An export's parameters are filled by whoever calls it -- another module,
  // the `nts check` harness -- and so is a parameter every direct caller
  // fills from one of those. Such a value arrives from outside, as a runtime
  // module's do, and is not judged. Depth-bounded; a cycle is not boundary.
  // **An element of an aggregate that arrived from outside arrived from outside
  // too.** An exported rest parameter is a `managed<[erased]>` the caller built,
  // and `array.get` of it unerased to obj#N is the same unjudgeable arrival as
  // the parameter itself (2026-10-04, blockers/a-rest-parameter-that-is-a-union-
  // of-tuples). Element reads only -- `array.get`, or `nts_array_element` of an
  // `erase` -- and only when the array is itself boundary; a field read, or an
  // array this program built, is judged as before.
  const elementSource = (f, value) => {
    const op = f.values.get(value)?.op ?? "";
    const direct = /^array\.get (%\d+)\[%\d+\]$/.exec(op)?.[1];
    if (direct !== undefined) return direct;
    const erased = ARRAY_ELEMENT.exec(op)?.[1];
    return /^erase (%\d+)$/.exec(f.values.get(erased)?.op ?? "")?.[1];
  };
  const boundary = (f, value, left = 6, seen = new Set()) => {
    const array = elementSource(f, value);
    if (array !== undefined) return boundary(f, array, left, seen);
    const index = f.params.get(value);
    if (index === undefined) return false;
    if (f.exported) return true;
    const sites = callers.get(f.name) ?? [];
    if (left === 0 || sites.length === 0 || seen.has(f.name)) return false;
    return sites.every((c) => boundary(c.f, c.args[index], left - 1, new Set([...seen, f.name])));
  };
  // A typed array retains the layout of its present elements even when a
  // particular program constructs only null slots. Follow its actual origin:
  // a local array allocation or parameters filled entirely from those arrays
  // (or a typed external boundary). An unchecked array cast is not evidence.
  // IDs which resolve to one layout are equivalent, as lowering can retain
  // the checker ID at a caller and the inferred ID in the callee.
  const arrayCarries = (f, value, layout, left = 6, seen = new Set()) => {
    const definition = f.values.get(value);
    const element = /^managed<\[managed<obj#(\d+)>\]>$/.exec(definition?.type ?? "")?.[1];
    if (!layout || byId.get(element) !== layout) return false;
    // `filled`: a literal or a counted walk, printed so since 2026-10-14 and
    // the same local allocation it was before. (`uninitialized`, `map`'s, is
    // not accepted here, and was not before: a question of its own.)
    if (/^array\.new(?: filled)? %\d+$/.test(definition.op)) return true;
    const index = f.params.get(value);
    if (index === undefined) return false;
    if (f.exported) return true;
    const sites = callers.get(f.name) ?? [];
    if (left === 0 || sites.length === 0 || seen.has(f.name)) return false;
    return sites.every((c) => arrayCarries(c.f, c.args[index], layout, left - 1, new Set([...seen, f.name])));
  };
  const arrayElement = (f, value, layout) => {
    const erasedArray = ARRAY_ELEMENT.exec(f.values.get(value)?.op ?? "")?.[1];
    const source = /^erase (%\d+)$/.exec(f.values.get(erasedArray)?.op ?? "")?.[1];
    return source !== undefined && arrayCarries(f, source, layout);
  };
  const out = [];
  for (const f of fns.values()) {
    // `%c = instanceof %v ...` then `br %c, bT, ...`: in bT, %v is known.
    const tests = new Map([...f.chunk.matchAll(/^ {2}(%\d+) = instanceof (%\d+) /gm)].map((m) => [m[1], m[2]]));
    const guarded = new Set();
    for (const m of f.chunk.matchAll(/^ {2}br (%\d+), (b\d+)/gm)) if (tests.has(m[1])) guarded.add(`${m[2]} ${tests.get(m[1])}`);
    let block = "b0";
    for (const line of f.chunk.split("\n")) {
      const head = /^(b\d+)(?:\(.*\))?:$/.exec(line);
      if (head) { block = head[1]; continue; }
      const u = /^ {2}%\d+ = unerase (%\d+) : managed<obj#(\d+)>$/.exec(line);
      if (!u || guarded.has(`${block} ${u[1]}`) || boundary(f, u[1])) continue;
      const result = /^ {2}(%\d+) = unerase /.exec(line)?.[1];
      if (result && !castFaces.has(u[2]) && contractedFieldRead(f, result, u[2], fieldContracts)) continue;
      const layout = byId.get(u[2]);
      if (castFaces.has(u[2])) {
        const result = /^ {2}(%\d+) = unerase /.exec(line)?.[1];
        const positional = f.chunk.split("\n").some((line) =>
          line.includes(` = field.get ${result}.`) || line.trimStart().startsWith(`field.set ${result}.`));
        if (!positional) continue;
      }
      if (arrayElement(f, u[1], layout)) continue;
      if (layout && /^Fn[\d_]*__\d+$/.test(layout.name)) continue;
      if (layout ? covered.has(layout.name) : madeIds.has(u[2])) continue;
      out.push({ fn: f.name, target: layout ? layout.name : `a record no layout lists (obj#${u[2]})` });
    }
  }
  return out;
}

// --- the rules ----------------------------------------------------------------

/**
 * One project's violations from its four listings, or why it was not measured.
 * The scan and the self-test both go through this.
 */
export function judge({ prepared, plain, layouts, refusals, whole = true, sourceRoot = ROOT }, sourceLine = readSourceLine) {
  const hir = readHir(prepared);
  if (hir.stated === null) return { unmeasured: 'hir --prepared printed no "N function(s)" line' };
  if (hir.lines !== hir.stated) return { unmeasured: `parsed ${hir.lines} definition(s) where the summary states ${hir.stated}` };
  const { byName: classes, byId, byType } = readLayouts(layouts);
  const refused = readRefusals(refusals);
  const refusedGenerically = new Set([...refused].map(generic));
  const out = [];
  // `subject` is what a known entry names: the violation itself, except for a
  // cascade, where the open item is the cause and not each function that calls
  // it -- one unrecorded root stands behind 62 cascades in one module.
  const say = (rule, detail, subject = detail) => out.push({ rule, detail, subject });

  for (const callee of new Set(hir.calls)) {
    const n = hir.defined.get(callee) ?? 0;
    if (n !== 1) say("call-resolves", `\`${callee}\` is called and defined ${n} time(s)`);
  }
  for (const [name, n] of hir.defined) if (n > 1 && !hir.calls.includes(name)) say("call-resolves", `\`${name}\` is defined ${n} times`);

  for (const [cls, { methods }] of classes) {
    for (const m of methods) {
      const n = hir.defined.get(m) ?? 0;
      if (n !== 1) say("table-resolves", `\`${cls}\`'s table names \`${m}\`, defined ${n} time(s)`);
    }
  }

  // `base` names a class, and the name is unique within one listing.
  const resolved = (name) => {
    const seen = new Set();
    while (hir.bridges.has(name) && !seen.has(name)) {
      seen.add(name);
      name = hir.bridges.get(name);
    }
    return name;
  };
  const dispatchedAbove = (cls) => {
    const members = new Set();
    for (let at = cls.base, seen = 0; at && seen < 64; at = classes.get(at)?.base, seen++) {
      for (const m of classes.get(at)?.methods ?? []) members.add(member(resolved(m)));
    }
    return members;
  };
  for (const [name, id] of hir.methods) {
    if (!name.includes("#") || /#constructor$/.test(name)) continue;
    const cls = byId.get(id);
    if (!cls) {
      say("owner-has-layout", `\`${name}\` takes \`this\` of type ${id}, which \`layouts\` does not list`);
      continue;
    }
    if (dispatchedAbove(cls).has(member(resolved(name))) && !cls.methods.some((entry) => resolved(entry) === resolved(name))) {
      say("override-in-table", `\`${name}\` overrides a method its ancestors dispatch, and its class \`${cls.name}\`'s table does not hold it`);
    }
  }

  const isRefused = (name) => refused.has(name) || refusedGenerically.has(generic(name));
  // A rootless cause says what the program has under its name instead.
  const rootless = (text, cause) => {
    const r = resemblance(cause, hir, refused);
    const has = evidenceText(r);
    out.push({ rule: "cascade-has-root", detail: `${text}, which has no refusal of its own [${r.shape}, ${r.kind}${has}]`, subject: cause, resemblance: r });
  };
  const cascades = readCascades(prepared);
  for (const { who, cause } of cascades.calls) {
    if (!isRefused(cause)) rootless(`\`${who}\` blames \`${cause}\``, cause);
  }
  const uncompiled = new Set([
    ...cascades.initializers.map((i) => i.global),
    ...cascades.initializerReads.map((i) => i.global),
    ...cascades.unwritten,
  ]);
  for (const { who, global } of cascades.reads) {
    if (!uncompiled.has(global)) say("cascade-has-root", `\`${who}\` blames the initializer of \`${global}\`, and no line says it was not compiled`, `the initializer of ${global}`);
  }
  for (const { global, read } of cascades.initializerReads) {
    if (!uncompiled.has(read)) say("cascade-has-root", `the initializer of \`${global}\` blames the initializer of \`${read}\`, and no line says it was not compiled`, `the initializer of ${read}`);
  }
  for (const { read } of cascades.statementReads) {
    if (!uncompiled.has(read)) say("cascade-has-root", `a dropped module-scope statement blames the initializer of \`${read}\`, and no line says it was not compiled`, `the initializer of ${read}`);
  }
  for (const { global, cause } of cascades.initializers) {
    if (!isRefused(cause)) rootless(`the initializer of \`${global}\` blames \`${cause}\``, cause);
  }
  for (const { cause } of cascades.statements) {
    if (!isRefused(cause)) rootless(`a dropped module-scope statement blames \`${cause}\``, cause);
  }

  // A call to a refused function that preparation cut from the top level must
  // be reported as a cut. A call to one that compiles may be folded or inlined
  // away (`"toString" in makeReceiver()` folds), which is not a loss.
  // Every cut is named. A reported cut is honest, and it still makes a
  // program that does less than its source says; the known file is the
  // ratchet that lets `nts build` treat one as an error the day it is empty.
  const reasons = readReasons(refusals);
  const cut = (detail, subject, cause) => out.push({ rule: "top-level-cut", detail, subject, root: rootOf(cause, reasons) });
  for (const { global, cause } of cascades.initializers) {
    cut(`the initializer of \`${global}\` was not compiled (it calls \`${cause}\`)`, `the initializer of ${global}`, cause);
  }
  for (const { cause } of cascades.statements) {
    cut(`a module-scope statement calling \`${cause}\` was dropped`, `a statement calling ${cause}`, cause);
  }
  // A cut that follows another is a cut all the same: named, and its root is
  // the binding's.
  for (const { global, read } of cascades.initializerReads) {
    cut(`the initializer of \`${global}\` was not compiled (it reads \`${read}\`)`, `the initializer of ${global}`, read);
  }
  for (const { read } of cascades.statementReads) {
    cut(`a module-scope statement reading \`${read}\` was dropped`, `a statement reading ${read}`, read);
  }
  for (const d of readStatementCuts(prepared)) {
    // Outcome fixtures are materialised in a fresh scratch directory each run.
    // The project-local source path, rather than that directory, names the cut.
    const file = d.file.startsWith(`${sourceRoot}/`) ? relative(sourceRoot, d.file)
      : d.file.startsWith(`${ROOT}/`) ? relative(ROOT, d.file) : d.file;
    const subject = `a statement at ${file}:${d.line}:${d.col}`;
    say("top-level-cut", `${subject} was dropped (${d.text})`, subject);
  }
  if (refused.has("module#init")) say("top-level-cut", "module#init is refused, so none of the module's evaluation runs", "module#init");

  // A refusal that is not one: a name `nts refusals` lists, which the prepared
  // program compiles. `phantoms.mjs`'s question, asked here so the runtime is
  // covered too: `runtime/node/punycode` had four, a refused module-scope
  // binding (`export const toASCII = codec.toASCII`) filed under the bare name
  // of the function it holds, which compiles.
  for (const name of refused) {
    if (hir.compiled.has(name)) say("refusal-not-compiled", `\`${name}\` is listed as refused, and the prepared program compiles it`, name);
  }

  // A refused `module#init` is itself the report for every call it held:
  // `runtime/node/console`'s reads an uncompiled `stdout`, and all of it goes.
  const reported = new Set([...cascades.initializers, ...cascades.statements].map((c) => c.cause));
  if (!refused.has("module#init")) for (const callee of readHir(plain).initCalls) {
    if (!hir.initCalls.has(callee) && isRefused(callee) && !reported.has(callee)) {
      say("top-level-kept", `module#init lost its call to refused \`${callee}\`, and no line reports the cut`);
    }
  }

  // Where a reader is sent. A location is the start of the construct's first
  // token; one on whitespace, or past the end of its line, is the node's full
  // start -- its leading trivia -- and when that trivia holds a newline the
  // reader lands on the line *before*: `map` at a type alias's closing
  // `) => unknown;`, a generator at the `let` above it. Reading the character
  // at a position the compiler printed is not a second derivation of it.
  for (const d of readLocations(prepared)) {
    const line = sourceLine(d.file, d.line);
    if (line === undefined) continue;
    // The column counts UTF-8 bytes from the line's start, one-based
    // (`where_it_is`), so the line is read as bytes, not as UTF-16 units.
    const where = tokenStart(Buffer.from(line, "utf8"), d.col - 1);
    if (where === null) continue;
    say("location-on-a-token", `${d.code} at ${d.file}:${d.line}:${d.col} is ${where}: ${d.text.slice(0, 80)}`, d.code);
  }

  if (whole) for (const v of unbuiltUnerases(prepared, { byName: classes, byId, byType })) {
    say("unerase-is-built", `\`${v.fn}\` unerases a value to \`${v.target}\`, which nothing in this program builds or descends from`, v.target);
  }

  return { violations: out, functions: hir.stated };
}

// **Seen to fire before it is trusted**, on the shapes the listings print --
// each defect from the night that motivated a rule, and its control.
function selfTest() {
  const summary = (n) => `\n${n} function(s), nothing refused\n`;
  const clean = {
    prepared: "export declare func Base#value(this: managed<obj#1>) -> f64 {\n}\nexport func Thing#value(this: managed<obj#5>) -> f64 {\n}\nexport func Other#value(this: managed<obj#11>) -> f64 {\n}\nfunc total(t: f64) -> f64 {\n  %1 = call.virtual[0] Base#value(%0) : f64\n}\nexport func module#init() -> void {\n  %2 = call total(%1) : f64\n}" + summary(5),
    plain: "export func module#init() -> void {\n  %2 = call total(%1) : f64\n}\n",
    layouts: "Base [1]\n  methods Base#value\nThing [5]\n  base 1 -> Base\n  methods Thing#value\nOther [11]\n  base 1 -> Base\n  sizes : Managed(Array(Float { bits: 64 }))\n  methods Other#value\n",
    refusals: "",
  };
  const control = judge(clean);
  if (control.unmeasured || control.violations.length > 0) return `the control reported ${JSON.stringify(control)}`;
  // A slot target need not be a Class#member. Keep its whole spelling,
  // including spaces, and check it against the same prepared definitions.
  const slotNames = ["Other#value", "nts$refused$Other$1", "plain_stop", "Other#set value"];
  const slotBodies = slotNames.slice(1).map((name) => `func ${name}(this: managed<obj#11>) -> void {\n}\n`).join("");
  const slots = {
    ...clean,
    prepared: clean.prepared.replace(summary(5), `\n${slotBodies}${summary(8)}`),
    layouts: clean.layouts.replace("  methods Other#value\n", slotNames.map((name) => `  methods ${name}\n`).join("")),
  };
  const parsedSlots = readLayouts(slots.layouts).byName.get("Other").methods;
  if (JSON.stringify(parsedSlots) !== JSON.stringify(slotNames)) return `slot names were lost or joined: ${JSON.stringify(parsedSlots)}`;
  // Field labels retain spaces and typed/private key spellings; a field
  // named methods remains distinct from actual table rows, including labels
  // containing the same colon separator as a field.
  const fieldRows = readLayouts([
    "Fields [21]", "  plain : Erased", "  #private : Erased",
    "  [symbol #0] : Erased", "  two words : Erased", "  methods : Erased",
    "  methods Fields#set has : colon", "  methods Fields#get plain", "",
  ].join("\n")).byName.get("Fields");
  if (fieldRows.fields !== 5) return `field labels were lost or tables counted as fields: ${fieldRows.fields}`;
  if (JSON.stringify(fieldRows.methods) !== JSON.stringify(["Fields#set has : colon", "Fields#get plain"])) return "field labels attached as method-table rows";
  // Count raw rows independently of block boundaries: resetting too early
  // must not make a dropped table look like a clean, smaller program.
  const countsAgree = (text) => {
    const raw = text.split("\npublic api\n", 1)[0];
    const headers = [...raw.matchAll(/^\S.* \[[\d ]*\]$/gm)].length;
    const rows = [...raw.matchAll(/^  methods (?!:).+$/gm)].length;
    const layouts = readLayouts(text).byName;
    return layouts.size === headers && [...layouts.values()].reduce((n, layout) => n + layout.methods.length, 0) === rows;
  };
  if (!countsAgree(slots.layouts)) return "raw layout headers or slots were lost by the reader";
  const droppedTail = slots.layouts.replace("  methods Other#value\n", "\n  methods Other#value\n");
  if (countsAgree(droppedTail)) return "the raw-count control missed rows dropped after a premature block end";
  const resolvedSlots = judge(slots);
  if (resolvedSlots.unmeasured || resolvedSlots.violations.length !== 0) return `defined slot targets did not resolve: ${JSON.stringify(resolvedSlots)}`;
  const stopBody = "func nts$refused$Other$1(this: managed<obj#11>) -> void {\n}\n";
  const missingSlot = judge({ ...slots, prepared: slots.prepared.replace(stopBody, "").replace(summary(8), summary(7)) });
  if (!missingSlot.violations?.some((v) => v.rule === "table-resolves" && v.detail.includes("`nts$refused$Other$1`, defined 0 time(s)"))) return "a missing stop entry was exempted from table resolution";
  const duplicateSlot = judge({ ...slots, prepared: slots.prepared.replace(summary(8), `\n${stopBody}${summary(9)}`) });
  if (!duplicateSlot.violations?.some((v) => v.rule === "table-resolves" && v.detail.includes("`nts$refused$Other$1`, defined 2 time(s)"))) return "a duplicate stop entry was exempted from table resolution";
  // The last layout may be a closure frame. Public exports follow it, and
  // an export called `methods` is not another slot on that frame.
  for (const gap of ["", "\n"]) {
    const sections = { ...slots, layouts: `${slots.layouts}${gap}public api\n  methods -> methods   (a value)\n` };
    if (!countsAgree(sections.layouts)) return "raw counts included the public export section";
    if (JSON.stringify(readLayouts(sections.layouts).byName.get("Other").methods) !== JSON.stringify(slotNames)) return "a public export named methods attached to the last layout";
    if (judge(sections).violations?.length !== 0) return "the public export section read as a layout table";
  }
  // 8482afb63's defect: two `Thing`s merged into one layout with no table.
  const merged = judge({
    ...clean,
    prepared: clean.prepared.replace("Thing#value", "Thing@a#value").replace("Other#value", "Thing@b#value"),
    layouts: "Base [1]\n  methods Base#value\nThing [5 11]\n  base 1 -> Base\n",
  });
  if (merged.violations?.filter((v) => v.rule === "override-in-table").length !== 2) return `the merged-class defect was not caught: ${JSON.stringify(merged)}`;
  // After the fix `layouts` names the second class `Thing11`: joined by id, clean.
  const renamed = judge({
    ...clean,
    prepared: clean.prepared.replace("Thing#value", "Thing@a#value").replace("Other#value", "Thing@b#value"),
    layouts: "Base [1]\n  methods Base#value\nThing [5]\n  base 1 -> Base\n  methods Thing@a#value\nThing11 [11]\n  base 1 -> Base\n  methods Thing@b#value\n",
  });
  if (renamed.violations?.length !== 0) return `the fixed program's third spelling read as a defect: ${JSON.stringify(renamed)}`;
  // A table that lost an override, with the owner known.
  const lost = judge({ ...clean, layouts: clean.layouts.replace("  methods Other#value\n", "") });
  if (!lost.violations?.some((v) => v.rule === "override-in-table")) return "an override missing from its table was not caught";
  // A table holding an override through its bridge -- `Other#value@erased`,
  // the slot's erased form -- holds the override, and the bridge with it.
  const bridgeFixture = {
    ...clean,
    prepared: clean.prepared.replace(
      "export func Other#value(this: managed<obj#11>) -> f64 {\n}\n",
      "export func Other#value(this: managed<obj#11>) -> f64 {\n}\nfunc Other#value@erased(this: managed<obj#11>) -> erased {\n  %1 = call Other#value(%0) : f64\n  %2 = erase %1 : erased\n  ret %2\n}\n",
    ).replace(summary(5), summary(6)),
    layouts: clean.layouts.replace("  methods Other#value\n", "  methods Other#value@erased\n"),
  };
  const bridged = judge(bridgeFixture);
  if (bridged.unmeasured || bridged.violations.length !== 0) return `an override held through its bridge read as missing: ${JSON.stringify(bridged)}`;
  // The same bridge may first be made for an interface, then shared by the
  // class slot. Neither its suffix nor its declared result proves the target.
  const shared = { ...bridgeFixture, prepared: bridgeFixture.prepared.replaceAll("@erased", "@Reader"), layouts: bridgeFixture.layouts.replaceAll("@erased", "@Reader") };
  if (judge(shared).violations?.length !== 0) return "a shared interface bridge read as a missing override";
  const voidBridge = { ...shared, prepared: shared.prepared.replace("%1 = call Other#value(%0) : f64", "call Other#value(%0)") };
  if (judge(voidBridge).violations?.length !== 0) return "a bridge's void call did not prove the override";
  for (const fixture of [bridgeFixture, shared]) {
    const stale = judge({ ...fixture, prepared: fixture.prepared.replace("export declare func Base#value", "export func Base#value").replace("call Other#value(%0)", "call Base#value(%0)") });
    if (!stale.violations?.some((v) => v.rule === "override-in-table" && v.detail.includes("`Other#value`"))) return "a bridge calling the base body hid the missing override";
    const wrongReceiver = judge({ ...fixture, prepared: fixture.prepared.replace("call Other#value(%0)", "call Other#value(%1)") });
    if (!wrongReceiver.violations?.some((v) => v.rule === "override-in-table")) return "a bridge calling the override on another receiver hid the missing entry";
    const missingBody = judge({ ...fixture, prepared: fixture.prepared.replace("  %1 = call Other#value(%0) : f64\n", "") });
    if (!missingBody.violations?.some((v) => v.rule === "override-in-table")) return "a bridge suffix without a target hid the missing entry";
  }
  // A refused `main` cut from the top level.
  const cut = clean.prepared.replace("  %2 = call total(%1) : f64\n", "");
  // A refused `total` is also absent from the prepared program -- a fixture
  // listing it as refused while still compiling it would be a phantom.
  const gone = (t) => t.replace(/func total\(t: f64\) -> f64 \{\n.*?\n\}\n/s, "").replace(summary(5), summary(4));
  const excised = judge({ ...clean, prepared: gone(cut), refusals: "total\tsomething\n" });
  if (!excised.violations?.some((v) => v.rule === "top-level-kept" && /total/.test(v.detail))) return "a silently excised top-level call was not caught";
  // The same cut, reported as 47cba8c15 reports it, is not silent.
  // The same cut, reported as 47cba8c15 reports it, is not silent -- and is
  // still a cut, named for the ratchet.
  const said = judge({ ...clean, prepared: `${gone(cut)}\n  -- main.ts:11:23 NTS1003 this module-scope statement was dropped because it calls \`total\`, which was refused above\n`, refusals: "total\tsomething\n" });
  if (said.violations?.length !== 1 || said.violations[0].rule !== "top-level-cut") return `a reported cut read as silent, or went unnamed: ${JSON.stringify(said)}`;
  const declarationCut = "NTS1005 this statement, which module evaluation therefore skips; the rest of the module's evaluation still runs";
  for (const sourceRoot of ["/scratch/first/project", "/scratch/second/project"]) {
    const diagnostic = `  -- ${sourceRoot}/src/main.ts:12:1 ${declarationCut}\n`;
    const generic = judge({ ...clean, sourceRoot, prepared: `${clean.prepared}\n${diagnostic}${diagnostic}` });
    if (generic.violations?.length !== 1 || generic.violations[0].rule !== "top-level-cut" || generic.violations[0].subject !== "a statement at src/main.ts:12:1") return `a generic declaration cut was lost, duplicated, or named by its scratch path: ${JSON.stringify(generic)}`;
  }
  const namedCut = "  -- /project/main.ts:11:23 NTS1003 this module-scope statement was dropped because it calls `total`, which was refused above\n";
  const genericNamed = judge({ ...clean, prepared: `${gone(cut)}\n${namedCut}  -- /project/main.ts:11:23 ${declarationCut}\n`, refusals: "total\tsomething\n" });
  if (genericNamed.violations?.length !== 1 || genericNamed.violations[0].subject !== "a statement calling total") return `a named statement cut was counted twice: ${JSON.stringify(genericNamed)}`;
  for (const extension of ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"]) {
    if (readStatementCuts(`  -- /project/main.${extension}:12:1 ${declarationCut}\n`).length !== 1) return `a ${extension} statement cut was lost`;
  }
  for (const body of [
    "this module-scope statement was dropped because it reads `global`, which was refused above",
    "the initializer of `global` was not compiled because it calls `total`, which was refused above",
    "the initializer of `global` was not compiled because it reads `other`, which was refused above",
  ]) {
    if (readStatementCuts(`  -- /project/main.js:12:1 NTS1003 ${body}\n  -- /project/main.js:12:1 ${declarationCut}\n`).length !== 0) return "a named read or initializer cut was counted twice";
  }
  if (readStatementCuts(`  %0 = const "/project/main.ts:12:1 ${declarationCut}" : string\n`).length !== 0) return "diagnostic-looking string contents read as a statement cut";
  if (readStatementCuts("  -- /project/main.ts:12:1 NTS1001 an ordinary refusal\n").length !== 0) return "an ordinary refusal read as a statement cut";
  // A call to a function that compiles, folded away, is not a loss.
  if (judge({ ...clean, prepared: cut }).violations?.length !== 0) return "a folded call to a compiled function read as a lost statement";
  // A refused module#init reports every call it held.
  // A refused module#init is absent from the prepared program; plain `hir`,
  // before the drops, still has it and its calls.
  const noInit = gone(cut).replace(/export func module#init\(\) -> void \{\n(?:.*?\n)?\}/s, "").replace(summary(4), summary(3));
  const whole = judge({ ...clean, prepared: noInit, refusals: "total\tx\nmodule#init\tit reads `stdout`\n" }).violations ?? [];
  if (whole.length !== 1 || whole[0].rule !== "top-level-cut") return `a refused module#init read as silently cut, or went unnamed: ${JSON.stringify(whole)}`;
  // A cascade whose cause is filed under another name; its generic is not.
  const blamed = (cause, refusals) => judge({ ...clean, prepared: `${clean.prepared}\n  -- main.ts:9:1 NTS1003 \`walk\` cannot be compiled because it calls \`${cause}\`, which was refused above\n`, refusals });
  if (!blamed("guarded", "guarded@0#next\tx\n").violations?.some((v) => v.rule === "cascade-has-root")) return "a cascade with no root was not caught";
  if (blamed("R<3054>#m", "R#m\tx\n").violations?.length !== 0) return "a generic instance's cascade did not find its generic's refusal";
  // A read of a global whose initializer was not compiled owes that line.
  const reads = (lines) => judge({ ...clean, prepared: `${clean.prepared}\n${lines}`, refusals: "classify\tx\n" });
  const read = "  -- main.ts:102:9 NTS1003 `readPattern` cannot be compiled because it reads `pattern`, whose initializer was not compiled -- see the refusal above that says which\n";
  const init = "  -- main.ts:23:6 NTS1003 the initializer of `pattern` was not compiled because it calls `classify`, which was refused above; the rest of the module's evaluation still runs\n";
  if (reads(init + read).violations?.some((v) => v.rule === "cascade-has-root")) return "a read of an uncompiled global, with its initializer line, read as rootless";
  if (!reads(init + read).violations?.some((v) => v.rule === "top-level-cut")) return "an uncompiled initializer went unnamed";
  if (!reads(read).violations?.some((v) => v.rule === "cascade-has-root")) return "a read of a global with no initializer line was not caught";
  const skipped = "  -- main.ts:134:2 NTS1005 this statement, which module evaluation therefore skips, leaving `pattern` unwritten; the rest of the module's evaluation still runs\n";
  if (reads(skipped + read).violations?.some((v) => v.rule === "cascade-has-root")) return "a read of a global a skipped statement left unwritten read as rootless";
  const reassigned = "  -- main.ts:134:2 NTS1005 this statement, which module evaluation therefore skips, leaving `other` unwritten and `pattern` as it was; the rest of the module's evaluation still runs\n";
  if (reads(reassigned + read).violations?.some((v) => v.rule === "cascade-has-root")) return "a read of a global a skipped statement would have reassigned read as rootless";
  // An initializer cut for reading a cut binding: rooted by that binding's line.
  const following = "  -- main.ts:24:6 NTS1003 the initializer of `size` was not compiled because it reads `pattern`, which a module statement evaluation skips would have assigned; the rest of the module's evaluation still runs\n";
  if (reads(init + following).violations?.some((v) => v.rule === "cascade-has-root")) return "an initializer cut for reading a cut binding, with that binding's line, read as rootless";
  if (!reads(init + following).violations?.some((v) => v.rule === "top-level-cut" && /it reads `pattern`/.test(v.detail))) return "an initializer cut for reading a cut binding went unnamed";
  if (!reads(following).violations?.some((v) => v.rule === "cascade-has-root")) return "an initializer cut for reading a binding with no line of its own was not caught";
  // A diagnostic located in trivia: the node's full start, not its token.
  const lines = { "/p/o.ts": ["export type MapFn = (", ") => unknown;", "", "export function map() {", "  const x = Object.getPrototypeOf(y);", "  const é = f(y);"] };
  const located = (at) => judge({ ...clean, prepared: `${clean.prepared}\n  -- /p/o.ts:${at} NTS1001 a construct is not supported by this lowering yet\n` }, (f, n) => lines[f]?.[n - 1]).violations ?? [];
  if (located("4:1").length !== 0) return "a location on a token was flagged";
  if (located("5:13").length !== 0) return "a location on a token mid-line was flagged";
  if (located("2:14")[0]?.rule !== "location-on-a-token" || !/past the end/.test(located("2:14")[0].detail)) return "a location past the end of its line (map's) was not caught";
  if (!/on whitespace/.test(located("5:12")[0]?.detail ?? "")) return "a location on the space before a construct was not caught";
  // Columns are bytes: `é` is two, so `f` is byte 14 where UTF-16 would say 13.
  if (located("6:14").length !== 0 || located("6:13").length !== 1) return "a byte column after a multi-byte character was misread";
  // Inside a token: `getPrototypeOf` at its `P`, a mid-identifier landing.
  if (!/inside a token/.test(located("5:23")[0]?.detail ?? "")) return "a location inside an identifier was not caught";
  // Punctuation starts its own token: the `(` after `getPrototypeOf`.
  if (located("5:34").length !== 0 || located("5:20").length !== 0) return "a location on punctuation after an identifier was flagged";
  // Inside a character: the second byte of `é`.
  if (!/inside a character/.test(located("6:10")[0]?.detail ?? "")) return "a location inside a multi-byte character was not caught";
  // A phantom: refused and compiled. A declaration shell is neither.
  const phantom = judge({ ...clean, refusals: "total\tsomething\n" }).violations ?? [];
  if (!phantom.some((v) => v.rule === "refusal-not-compiled" && /total/.test(v.detail))) return "a refusal naming a compiled function was not caught";
  if (judge({ ...clean, refusals: "Base#value\tno class implements it\n" }).violations?.length !== 0) return "a refused declaration shell was called a phantom";
  // **Control arms for the rules the corpus never trips.** call-resolves,
  // table-resolves and owner-has-layout are clean over 40,000 functions, and
  // a rule that is always clean is indistinguishable from one that cannot
  // fire. Each must fire here, on the shape it exists for.
  // What a rootless cause resembles, from raw names: each kind, and a name
  // that is only an instance's prefix is not mistaken for nothing.
  const resembles = (cause, defs, refusals = []) => {
    const r = resemblance(cause, readHir(defs.map((d) => `func ${d}() -> f64 {\n}`).join("\n")), new Set(refusals));
    return `${r.shape} ${r.kind}`;
  };
  const kinds = [
    [resembles("extractSize", ["extractSize<erased>", "extractSize<str>"]), "plain instantiated"],
    [resembles("Closure9#call", ["Closure12#call"]), "closure renumbered"],
    [resembles("mkdtemp", ["mkdtemp@async"]), "plain suffixed"],
    [resembles("map@ops@0obj7", [], ["map@ops@0obj8"]), "nested refused-as"],
    [resembles("map@ops@0obj7", [], ["map@ops"]), "nested copy-of-refused"],
    [resembles("map@ops@0obj7", [], ["map"]), "nested nothing"],
    [resembles("nts_env", ["other"]), "binding nothing"],
    [resembles("extractSize", ["extractSizeAlgorithm<str>"]), "plain nothing"],
  ];
  for (const [got, want] of kinds) if (got !== want) return `a rootless cause read as ${got}, not ${want}`;
  // A cut's root is followed through "it calls", to the reason of its own.
  const chain = readReasons("a\tit calls `b`, and x\nb\tit calls `c<7>`, and y\nc\ty\nloop\tit calls `loop`\n");
  if (rootOf("a", chain)?.name !== "c" || rootOf("a", chain)?.reason !== "y") return `a cut's root read as ${JSON.stringify(rootOf("a", chain))}`;
  if (rootOf("loop", chain)?.reason !== "a cycle through `loop`" || rootOf("nowhere", chain) !== null) return "a cyclic or unknown root";
  // An unerase to a layout nothing builds fires; guarded, built, a signature
  // layout, or a runtime program does not.
  const shapes = "Shape [10]\n  methods Shape#area\nSquare [13]\n  implements Shape\n  methods Square#area\nFn2__7 [6]\n  methods Fn2__7#call\n";
  const lay = readLayouts(shapes);
  const unerase = (target, guard = false) => [
    "func f(x: erased) -> void {", "b0:", "  %0 = param 0 : erased", "  %1 = object.new heap : managed<obj#13>",
    ...(guard ? ["  %2 = instanceof %0 against 1 class(es) : bool", "  br %2, b1, b2", "b1:"] : []),
    `  %3 = unerase %0 : managed<obj#${target}>`, "}",
  ].join("\n");
  // `Shape` is field-free and implemented by the built `Square`: dispatch only,
  // so accepted. With a field, or with no built implementor, it is judged.
  if (unbuiltUnerases(unerase(10), lay).length !== 0) return "an unerase to a field-free interface a built class implements was caught";
  const withField = readLayouts(shapes.replace("Shape [10]\n", "Shape [10]\n  width : Int { bits: 32, signed: true }\n"));
  if (unbuiltUnerases(unerase(10), withField).length !== 1) return "an unerase to an interface with fields was not caught";
  const unbuiltImplementor = readLayouts(shapes.replace("  implements Shape\n", ""));
  if (unbuiltUnerases(unerase(10), unbuiltImplementor).length !== 1) return "an unerase to an interface nothing built implements was not caught";
  if (unbuiltUnerases(unerase(10, true), withField).length !== 0) return "an instanceof-guarded unerase was caught";
  const castFace = `cast-face 10\n${unerase(10)}`;
  if (unbuiltUnerases(castFace, withField).length !== 0) return "a dispatch-only anonymous cast face was caught";
  const positionalCast = castFace.replace("  %3 = unerase %0 : managed<obj#10>", "  %3 = unerase %0 : managed<obj#10>\n  %4 = field.get %3.0 : erased");
  if (positionalCast === castFace || unbuiltUnerases(positionalCast, withField).length !== 1) return "a cast-face marker hid a positional field read";
  if (unbuiltUnerases(unerase(13), lay).length !== 0 || unbuiltUnerases(unerase(6), lay).length !== 0) return "an unerase to a built class or a signature layout was caught";
  const generatorLayoutText = "Declared [39]\n  state : Int32\nConcrete [12345]\n  hir-type managed<generator#7>\n  base 39 -> Declared\n";
  const generatorLayouts = readLayouts(generatorLayoutText);
  const generatorRead = [
    "func constructed() -> void {", "b0:",
    "  %0 = object.new heap : managed<generator#7>",
    "  %1 = erase %0 : erased", "  %2 = unerase %1 : managed<obj#39>", "}",
  ].join("\n");
  if (unbuiltUnerases(generatorRead, generatorLayouts).length !== 0) return "a built generator's declared base was caught";
  if (unbuiltUnerases(generatorRead.replace("  %0 = object.new heap : managed<generator#7>", "  %0 = param 0 : erased"), generatorLayouts).length !== 1) return "a generator layout without an allocation counted as built";
  if (unbuiltUnerases(generatorRead.replace("managed<generator#7>", "managed<generator#8>"), generatorLayouts).length !== 1) return "a different generator allocation counted as the declared frame";
  const generatorJudgment = (text) => judge({ prepared: `${text}\n1 function(s), nothing refused\n`, plain: text, layouts: generatorLayoutText, refusals: "" });
  const builtGenerator = generatorJudgment(generatorRead);
  if (builtGenerator.unmeasured || builtGenerator.violations.length !== 0) return "the complete judge lost the generator allocation's layout alias";
  const unbuiltGenerator = generatorJudgment(generatorRead.replace("object.new heap", "param 0"));
  if (unbuiltGenerator.unmeasured || unbuiltGenerator.violations.filter((v) => v.rule === "unerase-is-built").length !== 1) return "the complete judge accepted a generator base without an allocation";
  if (unbuiltUnerases(`export ${unerase(10)}`, withField).length !== 0) return "an unerase of an exported function's own parameter was judged";
  const through = `${unerase(10)}\nexport func g(y: erased) -> void {\nb0:\n  %0 = param 0 : erased\n  call f(%0)\n}`;
  if (unbuiltUnerases(through, withField).length !== 0) return "a parameter filled only by an export's parameter was judged";
  if (unbuiltUnerases(`${through.replace("export func g", "func g")}`, withField).length !== 1) return "a parameter filled by an unexported caller's parameter was not judged";
  // An element read out of an exported parameter's array arrives from outside; out
  // of an unexported one with no caller, or out of an array built here, it does not.
  const restElement = (exported, source) => [
    `${exported ? "export " : ""}func r(given: managed<[erased]>) -> void {`, "b0:", "  %0 = param 0 : managed<[erased]>",
    ...(source === "built" ? ["  %9 = const 0 : f64", "  %1 = array.new %9 : managed<[erased]>"] : []),
    "  %2 = const 1 : f64", `  %3 = array.get ${source === "built" ? "%1" : "%0"}[%2] : erased`,
    "  %4 = unerase %3 : managed<obj#10>", "}",
  ].join("\n");
  if (unbuiltUnerases(restElement(true, "param"), withField).length !== 0) return "an element of an exported parameter's array was judged";
  if (unbuiltUnerases(restElement(false, "param"), withField).length !== 1) return "an element of an unexported, uncalled parameter's array was not judged";
  if (unbuiltUnerases(restElement(true, "built"), withField).length !== 1) return "an element of an array this program built was exempted as boundary";
  const arrays = readLayouts(`${shapes}Element [20 21]\n  value: Erased\nOtherElement [22]\n  value: Erased\n`);
  const fromArray = [
    "func element(xs: managed<[managed<obj#20>]>) -> void {", "b0:",
    "  %0 = param 0 : managed<[managed<obj#20>]>", "  %1 = const 0 : f64",
    "  %2 = erase %0 : erased", "  %3 = call.extern nts_array_element(%2, %1) : erased",
    "  %4 = unerase %3 : managed<obj#20>", "}",
    "func caller() -> void {", "b0:", "  %0 = const 0 : f64",
    "  %1 = array.new %0 : managed<[managed<obj#21>]>", "  call element(%1)", "}",
  ].join("\n");
  if (unbuiltUnerases(fromArray, arrays).length !== 0) return "an element from a proved array with an equivalent layout ID was judged";
  for (const bad of [
    fromArray.replace("array.new %0 : managed<[managed<obj#21>]>", "array.new %0 : managed<[managed<obj#22>]>"),
    fromArray.replace("array.new %0", "unerase %0"),
    fromArray.replace("nts_array_element", "another_helper"),
    fromArray.replace("unerase %3 : managed<obj#20>", "unerase %2 : managed<obj#20>"),
    fromArray.replace("  call element(%1)", "  call element(%1)\n  call element(%0)"),
  ]) if (unbuiltUnerases(bad, arrays).length !== 1) return "an unproved array element reconstruction was not caught";
  // The known file's order: a sorted file passes, an appended entry is named.
  if (firstDisorder(["# h", "a\t1", "b\t2"]) !== null) return "a sorted known file read as out of order";
  if (firstDisorder(["a\t1", "c\t3", "b\t2"])?.at !== 3) return "an out-of-order known entry was not named";
  const rules = (t) => (judge(t).violations ?? []).map((v) => v.rule);
  if (!rules({ ...clean, prepared: clean.prepared.replace("  %2 = call total(%1) : f64", "  %2 = call nowhere(%1) : f64") }).includes("call-resolves")) return "a direct call to a function nothing defines was not caught";
  if (!rules({ ...clean, prepared: clean.prepared.replace("func total(t: f64) -> f64 {", "func total(t: f64) -> f64 {\n}\nfunc total(t: f64) -> f64 {").replace(summary(5), summary(6)) }).includes("call-resolves")) return "a function defined twice was not caught";
  if (!rules({ ...clean, layouts: clean.layouts.replace("  methods Other#value", "  methods Other#value\n  methods Other#missing") }).includes("table-resolves")) return "a table naming a method nothing defines was not caught";
  if (!rules({ ...clean, layouts: clean.layouts.replace("Other [11]", "Other [12]") }).includes("owner-has-layout")) return "a method whose `this` type has no layout was not caught";
  // A field named `methods` is not a table.
  if (readLayouts("C [1]\n  methods : Erased\n").byName.get("C").methods.length !== 0) return "a field named `methods` read as a table";
  // Producer facts are synthetic in this reader control; the core tests
  // separately demand real final-operation contracts from both gated fixtures.
  const proved = ["func proved(x: erased) -> f64 {", "b0:",
    "  %0 = param 0 : erased", "  %1 = unerase %0 : managed<obj#10>",
    "  %2 = field.get %1.0 : f64", "  ret %2", "}", ""].join("\n");
  const proofFor = (text) => ({ version: 1, eager: false, dependencies: [], function: "proved", operation: 2,
    root: 1, receiver: 1, argument: null, face: 10, field: 0,
    member: { Name: "width" }, representation: "f64", owners: [{ id: 13, field_prefix: true }],
    prefix_receivers: [13], other_receivers: [], mode: "stored-prefix",
    rendered: "%2 = field.get %1.0 : f64",
    body_sha256: createHash("sha256").update(text.slice(text.indexOf("\n") + 1, text.lastIndexOf("\n}")) + "\n").digest("hex"),
  });
  const facts = (text, proof = proofFor(text)) => `field-read-contract ${Buffer.from(JSON.stringify(proof)).toString("hex")}\n${text}`;
  const fieldLayouts = readLayouts("Shape [10]\n  width : Float { bits: 64 }\nSquare [13]\n  width : Float { bits: 64 }\n");
  if (unbuiltUnerases(proved, fieldLayouts).length !== 1) return "an old positional listing gained a field-read exemption";
  if (unbuiltUnerases(facts(proved), fieldLayouts).length !== 0) return "a complete bound field-read contract was lost";
  if (JSON.stringify([...readHir(proved).defined]) !== JSON.stringify([...readHir(facts(proved)).defined]) || JSON.stringify(readHir(proved).calls) !== JSON.stringify(readHir(facts(proved)).calls)) return "field proof metadata changed raw function or call populations";
  if (unbuiltUnerases(`cast-face 10\n${facts(proved)}`, fieldLayouts).length !== 1) return "a fresh complete stored-prefix fact hid a cast-face positional read";
  // Supported-only mixed facts keep the good exact root. A deliberately
  // supplied unsupported Param/Convert root still invalidates all facts.
  const mixedRead = proved.replace("proved(x: erased)", "proved(x: erased, named: managed<obj#10>)")
    .replace("  %0 = param 0 : erased", "  %0 = param 0 : erased\n  %3 = param 1 : managed<obj#10>\n  %4 = convert %3 : managed<obj#10>\n  %5 = field.get %3.0 : f64\n  %6 = field.get %4.0 : f64");
  if (unbuiltUnerases(facts(mixedRead), fieldLayouts).length !== 0) return "unsupported mixed candidates poisoned a supported exact root";
  for (const [root, operation] of [[3, 5], [4, 6]]) {
    const unsupported = { ...proofFor(mixedRead), root, receiver: root, operation,
      rendered: `%${operation} = field.get %${root}.0 : f64` };
    const bad = `field-read-contract ${Buffer.from(JSON.stringify(unsupported)).toString("hex")}\n${facts(mixedRead)}`;
    if (unbuiltUnerases(bad, fieldLayouts).length !== 1) return "a supplied unsupported mixed root did not fail closed";
  }
  const escapedRead = proved.replace("  ret %2", "  %3 = erase %1 : erased\n  call leak(%3) : void\n  ret %2");
  for (const bad of [
    facts(proved, { ...proofFor(proved), owners: [] }),
    facts(proved, { ...proofFor(proved), owners: [{ id: 13, field_prefix: false }] }),
    facts(proved, { ...proofFor(proved), root: 0 }),
    facts(proved, { ...proofFor(proved), argument: 1 }),
    facts(proved, { ...proofFor(proved), member: "width" }),
    facts(proved.replace("field.get %1.0", "field.get %1.1"), proofFor(proved)),
    facts(escapedRead), // Fresh body binding still cannot hide an uncovered use.
    `field-read-contract {\n${facts(proved)}`,
    `${facts(proved).split("\n")[0]}\n${facts(proved)}`,
  ]) if (unbuiltUnerases(bad, fieldLayouts).length !== 1) return "an absent/contradictory/stale field proof or extra alias use hid a positional risk";
  // A listing that lost a function is not a clean program.
  if (!judge({ ...clean, prepared: clean.prepared.replace(summary(5), summary(6)) }).unmeasured) return "a listing short of its summary was measured";
  return null;
}

// --- the run --------------------------------------------------------------------

const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (process.argv.includes("--self-test")) {
  console.log("  self-test: each night's defect caught by its rule, its control clean, a short listing not measured");
  process.exit(0);
}
if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}
const under = (base) =>
  readdirSync(join(ROOT, base), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, base, e.name, "tsconfig.json")))
    .map((e) => join(base, e.name));
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/**
 * What `nts` is pointed at for each project. An outcomes fixture does not
 * typecheck on its own -- its `main.ts` calls the harness's `observe` and
 * `done` -- so it is read through the project outcomes-check builds, from
 * the one definition of it, and reported under its own path.
 */
const pathOf = new Map();
let scratchDir = null;
function scratch() {
  if (!scratchDir) {
    const base = join(homedir(), ".cache/nts-integrity");
    mkdirSync(base, { recursive: true });
    scratchDir = mkdtempSync(join(base, "run-"));
    process.on("exit", () => rmSync(scratchDir, { recursive: true, force: true }));
  }
  return scratchDir;
}
/** Every fixture (or the named ones), materialised, as their labels. */
function outcomes(names = outcomeFixtures()) {
  return names.map((name) => {
    const label = `tests/outcomes/${name}`;
    pathOf.set(label, materialise(scratch(), name, join(OUTCOMES, name, "src"), runMode(name)));
    return label;
  });
}
// A fixture named on the command line is read through its project too, not
// its bare directory -- which does not typecheck without the harness.
const fixturePrefix = "tests/outcomes/";
const projects = (named.length > 0
  ? named.flatMap((p) => (p.replace(/\/$/, "").startsWith(fixturePrefix) ? outcomes([p.replace(/\/$/, "").slice(fixturePrefix.length)]) : [p]))
  : process.argv.includes("--runtime")
    ? [...under("runtime/node"), "runtime/web-platform"]
    : [...under("tests/programs"), ...under("tests/refusals"), ...outcomes()]
).sort();

/**
 * Projects with no prepared program by design, each with its reason. Named,
 * never silent: one that starts typechecking has an expired reason.
 */
const DOES_NOT_TYPECHECK = new Map([["tests/programs/invalid", "does not typecheck on purpose"]]);

/**
 * The first entry of a known file out of byte order, as `{ at, line, before }`,
 * or null. The file is sorted (LC_ALL=C), so an addition is inserted where it
 * sorts: an appended one reorders nothing today and forces a reorder later,
 * and a large reorder is how a real change hides in a diff. Compared as UTF-8
 * bytes, which is what `sort` compares.
 */
export function firstDisorder(lines) {
  const entries = lines.map((l, i) => [l, i + 1]).filter(([l]) => l.trim() !== "" && !l.startsWith("#"));
  for (let i = 1; i < entries.length; i++) {
    if (Buffer.compare(Buffer.from(entries[i - 1][0]), Buffer.from(entries[i][0])) > 0) {
      return { at: entries[i][1], line: entries[i][0], before: entries[i - 1][0] };
    }
  }
  return null;
}

/** Known violations: `project<TAB>rule<TAB>detail` -> why. */
const known = new Map(
  (existsSync(KNOWN) ? readFileSync(KNOWN, "utf8") : "")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .map(([project, rule, subject, why]) => [`${project}\t${rule}\t${stable(subject ?? "")}`, why ?? ""]),
);

const disorder = firstDisorder(existsSync(KNOWN) ? readFileSync(KNOWN, "utf8").split("\n") : []);
if (disorder) {
  console.log(`  integrity.known is out of order at line ${disorder.at}: this entry sorts before the one above it`);
  console.log(`    ${disorder.line.slice(0, 140)}`);
  console.log(`    above: ${disorder.before.slice(0, 140)}`);
  console.log("  insert entries where they sort (LC_ALL=C); the order keeps a reorder out of every later diff");
  process.exit(1);
}

// **One pool of `WORKERS` nts processes, shared by every project's four
// listings**, which run at once rather than one after another. The four are
// independent reads of the same project, and serially they put four times the
// largest project's lowering on the critical path: `runtime/web-platform`'s
// four calls were the last thing `integrity --runtime` waited for. Projects
// are queued longest first (tooling/gate/costs.mjs), so the expensive ones
// start while every worker is still free.
const slot = limiter(WORKERS);
// Each process holds one of the gate's tokens while it runs (tokens.mjs).
const run = (args) => slot(() => withToken(() =>
  new Promise((resolve) => {
    // The native producer captures anew; there is no producer-cache mode.
    // Only a kept prepared listing supplies the compile-time step's counters.
    const timedRun = KEEP && ADDON.test(args.at(-1)) && args[0] === "hir" && args[1] === "--prepared";
    const measuredEnvironment=timedRun?measuredCompileEnvironment(env):env;
    const work_settings=timedRun?compileWorkSettings(measuredEnvironment):undefined;
    const counted = timedRun ? spawnCounted(NTS, compileCommand("nogc", args.at(-1)), { cwd: ROOT, env:measuredEnvironment,
      counterFile: join(KEEP, `${args.at(-1).replaceAll("/", "_")}.perf`) }) : null;
    const child = counted?.child ?? spawn(NTS, args, { cwd: ROOT, env });
    // Only the prepared listing supplies compile-time's launch-time counters.
    const cpu = counted?.measurement ?? Promise.resolve({});
    let stdout = "";
    let stderr = "";
    const timer = counted ? undefined : setTimeout(() => child.kill("SIGTERM"), 900_000);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (error) => { clearTimeout(timer); resolve({ error, stdout, stderr }); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      cpu.then((counters) => resolve({ ...counters, work_profile: timedRun ? COMPILE_WORK_PROFILE : undefined, work_settings, status, signal, stdout, stderr }));
    });
  })));

const found = [];
const unmeasured = [];
const skipped = [];
let measured = 0;
let functions = 0;

// **The `hir --prepared` listing of each runtime module, kept for `definitions`.**
// That step ran the identical command over the identical modules and parsed
// the same `func` lines and summary -- a strict subset of this one's work, a
// full lowering of the runtime corpus repeated (968-1,308 s on 2026-10-06). With
// NTS_INTEGRITY_KEEP set (run.mjs sets it when both steps are in one run) each
// listing is written there with how the process ended, and `meta.json` records
// the binary's sha256, which definitions.ts checks against its own before it
// reads a byte: one invocation, one binary, one run.
const KEEP = process.env.NTS_INTEGRITY_KEEP;
const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
if (KEEP) {
  rmSync(KEEP, { recursive: true, force: true });
  mkdirSync(KEEP, { recursive: true });
}
function keep(project, done) {
  if (!KEEP || !ADDON.test(project)) return;
  const name = project.replaceAll("/", "_");
  writeFileSync(join(KEEP, `${name}.txt`), `${done.stdout}${done.stderr}`);
  writeFileSync(join(KEEP, `${name}.json`), JSON.stringify({ arm: "nogc", work_profile: done.work_profile, work_settings:done.work_settings, status: done.status ?? null, signal: done.signal ?? null, error: done.error?.message ?? null, cpu_s: done.cpu_s ?? null, instructions: done.instructions ?? null, counter_scope: done.counter_scope ?? null, counter_file: done.counter_file ?? null, counter_error: done.counter_error ?? null, user_s: done.user_s ?? null, sys_s: done.sys_s ?? null }));
}

const cost = {};
async function scan(project) {
  const listings = {};
  const at = pathOf.get(project) ?? project;
  const began = Date.now();
  const commands = [["prepared", ["hir", "--prepared", at]], ["plain", ["hir", at]], ["layouts", ["layouts", at]], ["refusals", ["refusals", at]]];
  const results = await Promise.all(commands.map(([, args]) => run(args)));
  cost[project] = (Date.now() - began) / 1000;
  keep(project, results[0]);
  for (const [i, [key, args]] of commands.entries()) {
    const done = results[i];
    // The wrapper expresses command signals as nonzero statuses. Counter
    // failure must remain a not-measured listing, even if output was complete.
    if (done.error || done.signal || done.counter_error) {
      unmeasured.push(`${project}: nts ${args[0]} ${done.counter_error ?? done.signal ?? done.error?.message}`);
      return;
    }
    // Diagnostics (the cascades) arrive on stderr beside the listing.
    listings[key] = key === "refusals" ? done.stdout : `${done.stdout}${done.stderr}`;
  }
  if (DOES_NOT_TYPECHECK.has(project)) {
    if (/does not typecheck/.test(listings.prepared)) skipped.push(`${project}: ${DOES_NOT_TYPECHECK.get(project)}`);
    else unmeasured.push(`${project}: listed as not typechecking, and now it does -- the reason has expired`);
    return;
  }
  // A runtime module is an addon, whose values arrive across its boundary;
  // everything else -- examples, fixtures, an app like runtime/react's -- is
  // a whole program.
  const verdict = judge({ ...listings, whole: !ADDON.test(project), sourceRoot: pathOf.get(project) ?? join(ROOT, project) });
  if (verdict.unmeasured) {
    // How the listing's process ended, beside what its output lacked. A
    // process killed by a signal is reported above; one that exited by itself
    // without its summary said why on stderr, and two GObject fixtures failed
    // on alternate runs of one pin with nothing to go on until this line.
    const prepared = results[0];
    const said = prepared.stderr.trim().split("\n").at(-1)?.slice(0, 200) ?? "";
    unmeasured.push(`${project}: ${verdict.unmeasured} (exit ${prepared.status}${said ? `; stderr: ${said}` : ""})`);
    return;
  }
  measured += 1;
  functions += verdict.functions;
  for (const v of verdict.violations) found.push({ project, ...v });
}

const started = Date.now();
const costKey = process.argv.includes("--runtime") ? "integrity-runtime" : "integrity";
await Promise.all(longestFirst(costKey, projects, (p) => pathOf.get(p) ?? p).map(scan));
recordCosts(costKey, cost);
if (KEEP) writeFileSync(join(KEEP, "meta.json"), JSON.stringify({ nts: NTS, sha256: sha256Of(NTS), counter_scope: COUNTER_SCOPE, work_profile: COMPILE_WORK_PROFILE, work_settings:compileWorkSettings(measuredCompileEnvironment(env)), arm: "nogc", projects }, null, 1));

const key = (v) => `${v.project}\t${v.rule}\t${stable(v.subject)}`;
const fresh = found.filter((v) => !known.has(key(v))).sort((a, b) => key(a).localeCompare(key(b)));
const held = found.filter((v) => known.has(key(v)));
const seen = new Set(found.map(key));
// An entry for a project this run did not scan is not expired, only unasked.
const expired = [...known.keys()].filter((k) => projects.includes(k.split("\t")[0]) && !seen.has(k));
// Nor is one for a project that is not there at all -- it is gone, and no run
// would ever ask: a fixture renamed, promoted to tests/programs, or deleted
// while its entry stayed. Four did, silently, until this said so.
const gone = [...known.keys()].filter((k) => !existsSync(join(ROOT, k.split("\t")[0])));

console.log(`  compiler ${NTS}`);
console.log(`  ${measured} of ${projects.length} project(s) measured, ${functions} function(s), in ${Math.round((Date.now() - started) / 1000)} s`);
for (const v of fresh) console.log(`  ${v.rule.padEnd(18)} ${v.project}: ${v.detail}`);
// One line per known entry, with how many violations it holds: the open item,
// not every function standing behind it.
const heldBy = new Map();
for (const v of held) heldBy.set(key(v), [...(heldBy.get(key(v)) ?? []), v]);
for (const [k, vs] of [...heldBy].sort(([a], [b]) => a.localeCompare(b))) {
  const [project, rule, subject] = k.split("\t");
  const r = vs[0].resemblance;
  const as = r ? ` [${r.shape}, ${r.kind}${evidenceText(r)}]` : "";
  const what = vs.length === 1 ? vs[0].detail : `${rule} \`${subject}\`, ${vs.length} violations${as}`;
  console.log(`  known             ${project}: ${what} -- ${known.get(k)}`);
}
// Rootless causes by what their program has under the name: entries (one per
// blamed name) and violations (every cascade through it) are both counted,
// because they rank differently.
const tally = new Map();
for (const v of found.filter((f) => f.resemblance)) {
  const t = `${v.resemblance.shape} / ${v.resemblance.kind}`;
  const row = tally.get(t) ?? { entries: new Set(), violations: 0 };
  row.entries.add(key(v));
  row.violations += 1;
  tally.set(t, row);
}
// Cuts by the refusal they finally rest on: the order to clear them in.
const roots = new Map();
for (const v of found.filter((f) => f.rule === "top-level-cut")) {
  const r = v.root ? `\`${stable(v.root.name)}\`: ${stable(v.root.reason).slice(0, 110)}` : "(no recorded reason)";
  const row = roots.get(r) ?? { entries: new Set(), projects: new Set() };
  row.entries.add(key(v));
  row.projects.add(v.project);
  roots.set(r, row);
}
if (roots.size > 0) {
  console.log("  top-level cuts, by the refusal each finally rests on:");
  for (const [r, row] of [...roots].sort(([, a], [, b]) => b.entries.size - a.entries.size).slice(0, 25)) {
    console.log(`    ${String(row.entries.size).padStart(4)} cut(s) in ${String(row.projects.size).padStart(2)} project(s)  ${r}`);
  }
  if (roots.size > 25) console.log(`    ... ${roots.size - 25} more root(s)`);
}
if (tally.size > 0) {
  console.log("  rootless causes, by the blamed name's shape / what the program has under it:");
  for (const [t, row] of [...tally].sort(([, a], [, b]) => b.entries.size - a.entries.size || b.violations - a.violations)) {
    console.log(`    ${t.padEnd(26)} ${String(row.entries.size).padStart(4)} entr${row.entries.size === 1 ? "y" : "ies"}, ${row.violations} violation(s)`);
  }
}
for (const k of expired) console.log(`  ^ no longer occurs, remove it from tooling/conformance/integrity.known: ${k.replaceAll("\t", " | ")}`);
for (const k of gone) console.log(`  ^ names no project, move or remove it in tooling/conformance/integrity.known: ${k.replaceAll("\t", " | ")}`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED       ${u}`);
for (const s of skipped.sort()) console.log(`  skipped            ${s}`);
const ok = fresh.length === 0 && unmeasured.length === 0 && measured > 0;
console.log(ok ? `  whole: no violation beyond the ${held.length} known`
  : measured === 0 ? `  NOT MEASURED: none of ${projects.length} project(s) was measured, so no violation count means anything`
  : `  ${fresh.length} violation(s), ${unmeasured.length} project(s) not measured`);
process.exit(ok ? 0 : 1);
