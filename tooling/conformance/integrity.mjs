// Is what the backend receives whole? Nine facts about a program, checked from
// the compiler's own listings, each one a defect that shipped silently.
//
//   node tooling/conformance/integrity.mjs [project ...]   (default: examples/*, blockers/*)
//   node tooling/conformance/integrity.mjs --runtime       runtime/node/* and runtime/web-platform
//   node tooling/conformance/integrity.mjs --self-test
//   NTS_BIN=<a pinned copy> node tooling/conformance/integrity.mjs
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KNOWN = join(HERE, "integrity.known");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const env = { ...process.env, NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo") };
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
  const init = /^(?:export )?func module#init\(.*?^\}/ms.exec(text)?.[0] ?? "";
  const initCalls = new Set([...init.matchAll(/= call (.+?)\(/g)].map((m) => m[1]));
  const stated = /^(\d+) function\(s\)/m.exec(text);
  const lines = [...defined.values()].reduce((a, n) => a + n, 0);
  return { defined, compiled, methods, calls, initCalls, lines, stated: stated ? Number(stated[1]) : null };
}

/**
 * Classes from `nts layouts`: `{ byName, byId }`, each class `{ name, base,
 * methods }`. A block is a header `Name [ids]` and two-space lines under it.
 * Joined to HIR **by type id**, never by name: after 8482afb63 `layouts` names
 * two same-named classes `Thing` and `Thing11` while their methods are
 * `Thing@a#value` and `Thing@b#value` -- a third spelling of one class. A table line's entries each name
 * a method, `Owner#member`, and member names may hold spaces (`C#get size`), so
 * entries split only before a token holding `#`. A *field* that happens to be
 * called `methods` prints as `methods : Type` and is not a table.
 */
export function readLayouts(text) {
  const byName = new Map();
  const byId = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const head = /^(\S.*?) \[([\d ]+)\]$/.exec(line);
    if (head) {
      current = { name: head[1], base: null, methods: [] };
      byName.set(head[1], current);
      for (const id of head[2].split(" ")) byId.set(id, current);
      continue;
    }
    if (!current) continue;
    const base = /^ {2}base \d+ -> (.+)$/.exec(line);
    if (base) current.base = base[1];
    const table = /^ {2}methods (?!:)(.+)$/.exec(line);
    if (table && table[1].includes("#")) current.methods.push(...table[1].split(/ (?=\S+#)/));
  }
  return { byName, byId };
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
 *
 * The last two are also the *reports* of a cut from `module#init`, which
 * `top-level-kept` holds the program to.
 */
export function readCascades(text) {
  const calls = [...text.matchAll(/NTS1003 `([^`]+)` cannot be compiled because it calls `([^`]+)`/g)].map(([, who, cause]) => ({ who, cause }));
  const reads = [...text.matchAll(/NTS1003 `([^`]+)` cannot be compiled because it reads `([^`]+)`/g)].map(([, who, global]) => ({ who, global }));
  const initializers = [...text.matchAll(/NTS1003 the initializer of `([^`]+)` was not compiled because it calls `([^`]+)`/g)].map(([, global, cause]) => ({ global, cause }));
  const statements = [...text.matchAll(/NTS1003 this module-scope statement was dropped because it calls `([^`]+)`/g)].map(([, cause]) => ({ cause }));
  // A skipped module-scope statement that leaves a global unwritten says so
  // (1c12d40c9): `NTS1005 this statement, which module evaluation therefore
  // skips, leaving `stdout` unwritten`. That is the global's record as much as
  // an initializer line is.
  const unwritten = [...text.matchAll(/NTS1005 this statement, which module evaluation therefore skips, leaving `([^`]+)` unwritten/g)].map(([, global]) => global);
  return { calls, reads, initializers, statements, unwritten };
}

const member = (name) => name.slice(name.indexOf("#") + 1);
/** A generic instance is filed under its generic: `R<3054>#m` is `R#m`. */
const generic = (name) => name.replace(/<\d+>/g, "");
/**
 * A violation's text with the compiler's numbering taken out, for matching
 * known entries: a closure's number and a generic's type id move with
 * unrelated changes (`Closure524274`, `R<3054>`, `map@0obj7889`), and an
 * entry keyed on one would expire and reappear as "new" the day they did.
 */
const stable = (detail) => detail.replace(/Closure\d+/g, "ClosureN").replace(/<\d+>/g, "<N>").replace(/obj\d+/g, "objN");

// --- the rules ----------------------------------------------------------------

/**
 * One project's violations from its four listings, or why it was not measured.
 * The scan and the self-test both go through this.
 */
export function judge({ prepared, plain, layouts, refusals }, sourceLine = readSourceLine) {
  const hir = readHir(prepared);
  if (hir.stated === null) return { unmeasured: 'hir --prepared printed no "N function(s)" line' };
  if (hir.lines !== hir.stated) return { unmeasured: `parsed ${hir.lines} definition(s) where the summary states ${hir.stated}` };
  const { byName: classes, byId } = readLayouts(layouts);
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
  const dispatchedAbove = (cls) => {
    const members = new Set();
    for (let at = cls.base, seen = 0; at && seen < 64; at = classes.get(at)?.base, seen++) {
      for (const m of classes.get(at)?.methods ?? []) members.add(member(m));
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
    if (dispatchedAbove(cls).has(member(name)) && !cls.methods.includes(name)) {
      say("override-in-table", `\`${name}\` overrides a method its ancestors dispatch, and its class \`${cls.name}\`'s table does not hold it`);
    }
  }

  const isRefused = (name) => refused.has(name) || refusedGenerically.has(generic(name));
  const cascades = readCascades(prepared);
  for (const { who, cause } of cascades.calls) {
    if (!isRefused(cause)) say("cascade-has-root", `\`${who}\` blames \`${cause}\`, which has no refusal of its own`, cause);
  }
  const uncompiled = new Set([...cascades.initializers.map((i) => i.global), ...cascades.unwritten]);
  for (const { who, global } of cascades.reads) {
    if (!uncompiled.has(global)) say("cascade-has-root", `\`${who}\` blames the initializer of \`${global}\`, and no line says it was not compiled`, `the initializer of ${global}`);
  }
  for (const { global, cause } of cascades.initializers) {
    if (!isRefused(cause)) say("cascade-has-root", `the initializer of \`${global}\` blames \`${cause}\`, which has no refusal of its own`, cause);
  }
  for (const { cause } of cascades.statements) {
    if (!isRefused(cause)) say("cascade-has-root", `a dropped module-scope statement blames \`${cause}\`, which has no refusal of its own`, cause);
  }

  // A call to a refused function that preparation cut from the top level must
  // be reported as a cut. A call to one that compiles may be folded or inlined
  // away (`"toString" in makeReceiver()` folds), which is not a loss.
  // Every cut is named. A reported cut is honest, and it still makes a
  // program that does less than its source says; the known file is the
  // ratchet that lets `nts build` treat one as an error the day it is empty.
  for (const { global, cause } of cascades.initializers) {
    say("top-level-cut", `the initializer of \`${global}\` was not compiled (it calls \`${cause}\`)`, `the initializer of ${global}`);
  }
  for (const { cause } of cascades.statements) {
    say("top-level-cut", `a module-scope statement calling \`${cause}\` was dropped`, `a statement calling ${cause}`);
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
  // A field named `methods` is not a table.
  if (readLayouts("C [1]\n  methods : Erased\n").byName.get("C").methods.length !== 0) return "a field named `methods` read as a table";
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
const projects = (named.length > 0
  ? named
  : process.argv.includes("--runtime")
    ? [...under("runtime/node"), "runtime/web-platform"]
    : [...under("examples"), ...under("tooling/conformance/blockers")]
).sort();

/**
 * Projects with no prepared program by design, each with its reason. Named,
 * never silent: one that starts typechecking has an expired reason.
 */
const DOES_NOT_TYPECHECK = new Map([["examples/invalid", "does not typecheck on purpose"]]);

/** Known violations: `project<TAB>rule<TAB>detail` -> why. */
const known = new Map(
  (existsSync(KNOWN) ? readFileSync(KNOWN, "utf8") : "")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .map(([project, rule, subject, why]) => [`${project}\t${rule}\t${stable(subject ?? "")}`, why ?? ""]),
);

const run = (args) =>
  new Promise((resolve) => {
    const child = spawn(NTS, args, { cwd: ROOT, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 900_000);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (error) => { clearTimeout(timer); resolve({ error, stdout, stderr }); });
    child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
  });

const found = [];
const unmeasured = [];
const skipped = [];
let measured = 0;
let functions = 0;

async function scan(project) {
  const listings = {};
  for (const [key, args] of [["prepared", ["hir", "--prepared", project]], ["plain", ["hir", project]], ["layouts", ["layouts", project]], ["refusals", ["refusals", project]]]) {
    const done = await run(args);
    if (done.error || done.signal) {
      unmeasured.push(`${project}: nts ${args[0]} ${done.signal ?? done.error?.message}`);
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
  const verdict = judge(listings);
  if (verdict.unmeasured) {
    unmeasured.push(`${project}: ${verdict.unmeasured}`);
    return;
  }
  measured += 1;
  functions += verdict.functions;
  for (const v of verdict.violations) found.push({ project, ...v });
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async () => {
  while (next < projects.length) await scan(projects[next++]);
}));

const key = (v) => `${v.project}\t${v.rule}\t${stable(v.subject)}`;
const fresh = found.filter((v) => !known.has(key(v))).sort((a, b) => key(a).localeCompare(key(b)));
const held = found.filter((v) => known.has(key(v)));
const seen = new Set(found.map(key));
// An entry for a project this run did not scan is not expired, only unasked.
const expired = [...known.keys()].filter((k) => projects.includes(k.split("\t")[0]) && !seen.has(k));

console.log(`  compiler ${NTS}`);
console.log(`  ${measured} of ${projects.length} project(s) measured, ${functions} function(s), in ${Math.round((Date.now() - started) / 1000)} s`);
for (const v of fresh) console.log(`  ${v.rule.padEnd(18)} ${v.project}: ${v.detail}`);
// One line per known entry, with how many violations it holds: the open item,
// not every function standing behind it.
const heldBy = new Map();
for (const v of held) heldBy.set(key(v), [...(heldBy.get(key(v)) ?? []), v]);
for (const [k, vs] of [...heldBy].sort(([a], [b]) => a.localeCompare(b))) {
  const [project, rule, subject] = k.split("\t");
  const what = vs.length === 1 ? vs[0].detail : `${rule} \`${subject}\`, ${vs.length} violations`;
  console.log(`  known             ${project}: ${what} -- ${known.get(k)}`);
}
for (const k of expired) console.log(`  ^ no longer occurs, remove it from tooling/conformance/integrity.known: ${k.replaceAll("\t", " | ")}`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED       ${u}`);
for (const s of skipped.sort()) console.log(`  skipped            ${s}`);
const ok = fresh.length === 0 && unmeasured.length === 0 && measured > 0;
console.log(ok ? `  whole: no violation beyond the ${held.length} known` : `  ${fresh.length} violation(s), ${unmeasured.length} project(s) not measured`);
process.exit(ok ? 0 : 1);
