// Is what `nts types` prints a consistent table?
//
//   node tooling/conformance/types-check.mjs [project ...]   (default: runtime/node/*, runtime/web-platform)
//   node tooling/conformance/types-check.mjs --examples      every examples/* project instead
//   node tooling/conformance/types-check.mjs --self-test
//   NTS_BIN=<a pinned copy> node tooling/conformance/types-check.mjs
//
// # Why
//
// `nts types` is the snapshot every representation decision is read from, and
// no step consumed it. `emit-llvm` was the last artefact in that position, and
// `assembles` found two defects nobody knew about in its first evening. So
// this reads the three tables the command prints -- types, bases, signatures --
// and holds them to what a table of ids must be:
//
//   resolves       every `TypeId`, `#n` and `SignatureId` a line names is a row
//                  that exists
//   base-acyclic   no type is its own base, directly or through others
//   base-is-object a base is an object type (or one the snapshot has not
//                  decomposed, `Structured`)
//   arity          an instantiation has as many arguments as the declaration
//                  it instantiates -- or one more, which is the checker's
//                  `this` type appended inside a class (`Base<T, this>`), and
//                  is counted separately rather than excused silently: that
//                  appendix cost two defects on 2026-09-22
//   members        an instantiation has its declaration's members, by name:
//                  the checker substitutes a member's type, never its name,
//                  so a missing or extra member is a record built from the
//                  wrong type. The `this`-appended form is exempt -- it is a
//                  placeholder nothing reads the members of
//   read-whole     every line the command printed was read as one of the three
//                  shapes; a line nothing parsed is a table this checks
//                  nothing about
//
// What it cannot check: a signature's parameter count against its
// declaration's. The dump names no declaration for a signature, and a check
// that guessed one would be a second derivation of the thing it checks.
//
// Exit 0: every project read whole and clean. Exit 1: a violation, or a
// project not measured. Exit 2: the tool could not start.

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendFor } from "./pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORKERS = Number(process.env.NTS_TYPES_CHECK_JOBS ?? 4);

const TYPE_LINE = /^#(\d+)(?: `([^`]*)`)?(?: args\[([^\]]*)\])? ([A-Za-z]+)(.*)$/;
const BASE_LINE = /^base #(\d+) -> \[([\d, ]*)\]$/;
const SIG_LINE = /^sig#(\d+)(?: <\[([^\]]*)\]>)? \((.*)\) -> #(\d+)$/;
/**
 * `TypeKind`'s variants (compiler/semantic-schema/src/schema.rs). A type line
 * whose kind is not one of these was not understood, however well it parsed:
 * a new variant is a table this reader has not been taught to check.
 */
const KINDS = new Set(["Any", "Unknown", "Never", "Void", "Undefined", "Null", "Boolean", "Number", "BigInt", "String", "Symbol", "Literal", "Object", "Array", "Tuple", "Union", "Intersection", "Function", "TypeParameter", "Conditional", "IndexedAccess", "TemplateLiteral", "Structured", "Unsupported"]);
const ids = (text, re) => [...(text ?? "").matchAll(re)].map((m) => Number(m[1]));
const TYPE_REF = /TypeId\((\d+)\)/g;
const SIG_REF = /SignatureId\((\d+)\)/g;
const HASH_REF = /#(\d+)/g;

/** The three tables, and every line none of them read. */
export function readTypes(text) {
  const types = [];
  const bases = new Map();
  const signatures = [];
  const unread = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let m;
    if ((m = TYPE_LINE.exec(line))) {
      const members = m[4] === "Object" ? [...m[5].matchAll(/PropertyRecord \{ name: "((?:[^"\\]|\\.)*)"/g)].map((p) => p[1]) : null;
      types.push({ id: Number(m[1]), name: m[2] ?? null, args: m[3] === undefined ? null : ids(m[3], TYPE_REF), kind: m[4], types: ids(m[5], TYPE_REF), sigs: ids(m[5], SIG_REF), members });
    } else if ((m = BASE_LINE.exec(line))) {
      bases.set(Number(m[1]), m[2].split(",").map((s) => s.trim()).filter(Boolean).map(Number));
    } else if ((m = SIG_LINE.exec(line))) {
      signatures.push({ id: Number(m[1]), typeParameters: ids(m[2], TYPE_REF), parameters: ids(m[3], HASH_REF), returns: Number(m[4]) });
    } else unread.push(line);
  }
  return { types, bases, signatures, unread };
}

/** One project's violations, from what `nts types` printed. */
export function judge(text) {
  const { types, bases, signatures, unread } = readTypes(text);
  if (types.length === 0) return { unmeasured: "no type lines" };
  const out = [];
  const say = (rule, detail) => out.push({ rule, detail });
  for (const u of unread.slice(0, 5)) say("read-whole", `a line nothing read: ${u.slice(0, 120)}`);
  for (const t of types.filter((t) => !KINDS.has(t.kind)).slice(0, 5)) say("read-whole", `#${t.id} is a \`${t.kind}\`, which this reader does not know`);
  if (unread.length > 5) say("read-whole", `and ${unread.length - 5} more unread line(s)`);

  const byId = new Map(types.map((t) => [t.id, t]));
  // Rows are dense: the command prints an index per record.
  types.forEach((t, i) => { if (t.id !== i) say("read-whole", `type row ${i} is numbered #${t.id}`); });
  signatures.forEach((s, i) => { if (s.id !== i) say("read-whole", `signature row ${i} is numbered sig#${s.id}`); });
  const typeExists = (n) => n < types.length;
  const sigExists = (n) => n < signatures.length;
  for (const t of types) {
    for (const n of [...t.types, ...(t.args ?? [])]) if (!typeExists(n)) say("resolves", `#${t.id} (${t.kind}) names TypeId(${n}), and there are ${types.length} types`);
    for (const n of t.sigs) if (!sigExists(n)) say("resolves", `#${t.id} (${t.kind}) names SignatureId(${n}), and there are ${signatures.length} signatures`);
  }
  for (const s of signatures) {
    for (const n of [...s.typeParameters, ...s.parameters, s.returns]) if (!typeExists(n)) say("resolves", `sig#${s.id} names #${n}, and there are ${types.length} types`);
  }
  for (const [ty, list] of bases) {
    if (!typeExists(ty)) say("resolves", `base #${ty} is not a type`);
    for (const b of list) {
      if (!typeExists(b)) say("resolves", `#${ty}'s base #${b} is not a type`);
      else if (!["Object", "Structured"].includes(byId.get(b).kind)) say("base-is-object", `#${ty}'s base #${b} is ${byId.get(b).kind}`);
    }
  }
  // A cycle, found by walking each type's bases with its own path.
  for (const start of bases.keys()) {
    const stack = [[start, [start]]];
    const seen = new Set();
    while (stack.length > 0) {
      const [at, path] = stack.pop();
      for (const b of bases.get(at) ?? []) {
        if (b === start) {
          say("base-acyclic", `#${start} is its own base through ${[...path, b].map((n) => `#${n}`).join(" -> ")}`);
          stack.length = 0;
          break;
        }
        if (!seen.has(b)) {
          seen.add(b);
          stack.push([b, [...path, b]]);
        }
      }
    }
  }
  // Arity: a declaration is the type whose arguments are all its own type
  // parameters; its instantiations share its name. A name two declarations
  // share is ambiguous here and counted, not judged.
  const generic = new Map();
  for (const t of types.filter((t) => t.args && t.name !== null)) {
    const row = generic.get(t.name) ?? { declarations: [], uses: [] };
    (t.args.every((a) => byId.get(a)?.kind === "TypeParameter") ? row.declarations : row.uses).push(t);
    generic.set(t.name, row);
  }
  let thisAppended = 0;
  let ambiguous = 0;
  let judged = 0;
  let membersJudged = 0;
  for (const [name, { declarations, uses }] of generic) {
    const arities = new Set(declarations.map((d) => d.args.length));
    if (arities.size !== 1) {
      if (arities.size > 1) ambiguous += 1;
      continue;
    }
    const [arity] = arities;
    // The members every declaration of the name agrees on, when it is one.
    const declared = declarations[0].members;
    for (const u of uses) {
      judged += 1;
      if (u.args.length === arity && declared && u.members && declarations.length === 1) {
        membersJudged += 1;
        const want = new Set(declared);
        const have = new Set(u.members);
        const missing = [...want].filter((n) => !have.has(n));
        const extra = [...have].filter((n) => !want.has(n));
        if (missing.length + extra.length > 0) say("members", `\`${name}\` #${u.id} ${missing.length ? `lacks ${missing.slice(0, 4).join(", ")}` : ""}${missing.length && extra.length ? " and " : ""}${extra.length ? `has ${extra.slice(0, 4).join(", ")}` : ""} against its declaration #${declarations[0].id}`);
      }
      if (u.args.length === arity) continue;
      if (u.args.length === arity + 1) thisAppended += 1;
      else say("arity", `\`${name}\` #${u.id} has ${u.args.length} argument(s) where its declaration takes ${arity}`);
    }
  }
  const unsupported = types.filter((t) => t.kind === "Unsupported").length;
  const edges = [...bases.values()].reduce((a, l) => a + l.length, 0);
  return { violations: out, types: types.length, signatures: signatures.length, edges, judged, membersJudged, thisAppended, ambiguous, unsupported };
}

// **Seen to catch each defect before it is trusted.**
function selfTest() {
  const good = [
    "#0 Number",
    "#1 `T` TypeParameter { name: \"T\", constraint: None }",
    "#2 `Box` args[TypeId(1)] Object { properties: [PropertyRecord { name: \"v\", ty: TypeId(1), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }",
    "#3 `Box` args[TypeId(0)] Object { properties: [PropertyRecord { name: \"v\", ty: TypeId(0), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }",
    "#4 Function(SignatureId(0))",
    "#5 `Sub` Object { properties: [] }",
    "base #5 -> [3]",
    "sig#0 (x: #0) -> #3",
  ];
  const rules = (lines) => (judge(lines.join("\n")).violations ?? []).map((v) => v.rule);
  if (rules(good).length !== 0) return `the clean table read as ${rules(good).join(", ")}`;
  const arms = [
    [good.map((l) => l.replace("TypeId(1), readonly", "TypeId(9), readonly")), "resolves", "a property naming a type that does not exist"],
    [good.map((l) => l.replace("SignatureId(0)", "SignatureId(3)")), "resolves", "a function naming a signature that does not exist"],
    [good.map((l) => l.replace("-> #3", "-> #8")), "resolves", "a signature returning a type that does not exist"],
    [[...good, "base #3 -> [5]"], "base-acyclic", "two types each the other's base"],
    [good.map((l) => l.replace("base #5 -> [3]", "base #5 -> [0]")), "base-is-object", "a number as a base"],
    [good.map((l) => l.replace("args[TypeId(0)]", "args[TypeId(0), TypeId(0), TypeId(0)]")), "arity", "an instantiation with two extra arguments"],
    [[...good, "#6 something new"], "read-whole", "a line nothing reads"],
    [good.map((l) => l.replace('name: \"v\", ty: TypeId(0)', 'name: \"w\", ty: TypeId(0)')), "members", "an instantiation whose member is not its declaration's"],
  ];
  for (const [lines, rule, what] of arms) if (!rules(lines).includes(rule)) return `${what} was not caught (${rules(lines).join(", ") || "clean"})`;
  const appended = judge(good.map((l) => l.replace("args[TypeId(0)]", "args[TypeId(0), TypeId(5)]")).join("\n"));
  if (appended.violations.length !== 0 || appended.thisAppended !== 1) return "a `this`-appended instantiation was not counted as one";
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: a clean table clean; each rule caught by its arm; a `this` appendix counted, not failed");
  process.exit(0);
}

const SOURCE = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
if (!existsSync(SOURCE)) {
  console.log(`  NOT MEASURED: no compiler at ${SOURCE}; set NTS_BIN`);
  process.exit(2);
}
// Pinned, with a private snapshot cache: `types` is served from it.
const base = join(homedir(), ".cache/nts-types-check");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
const NTS = join(scratch, "nts");
copyFileSync(SOURCE, NTS);
chmodSync(NTS, 0o755);
// The frontend follows the pin (pin.mjs `frontendFor`); none stops the run
// here, before every project prints nothing and reads as clean.
const FRONTEND = frontendFor(SOURCE, ROOT);
if (!FRONTEND.exists) {
  console.log(`  NOT MEASURED: no frontend at ${FRONTEND.path} -- set NTS_TSGO, or use a pin (it records its frontend)`);
  process.exit(2);
}
const env = { ...process.env, NTS_TSGO: FRONTEND.path, NTS_SNAPSHOT_CACHE: join(scratch, "snapshots") };
delete env.NTS_NO_SNAPSHOT_CACHE;

const under = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, dir, e.name, "tsconfig.json")))
    .map((e) => `${dir}/${e.name}`);
const named = argv.filter((a) => !a.startsWith("--"));
const projects = (named.length > 0 ? named : argv.includes("--examples") ? under("examples") : [...under("runtime/node"), "runtime/web-platform"]).sort();

const run = (args) =>
  new Promise((done) => {
    const child = spawn(NTS, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 600_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out, err }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out, err }); });
  });

const found = [];
const unmeasured = [];
const totals = { types: 0, signatures: 0, edges: 0, judged: 0, membersJudged: 0, thisAppended: 0, ambiguous: 0, unsupported: 0 };
let measured = 0;
const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async () => {
  while (next < projects.length) {
    const project = projects[next++];
    const r = await run(["types", project]);
    if (r.error || r.signal || r.status !== 0) {
      unmeasured.push(`${project}: nts types ${r.signal ?? r.error?.message ?? `exit ${r.status}`} -- ${r.err.trim().split("\n").pop()?.slice(0, 100) ?? ""}`);
      continue;
    }
    const verdict = judge(r.out);
    if (verdict.unmeasured) {
      unmeasured.push(`${project}: ${verdict.unmeasured}`);
      continue;
    }
    measured += 1;
    for (const k of Object.keys(totals)) totals[k] += verdict[k];
    for (const v of verdict.violations) found.push({ project, ...v });
  }
}));

console.log(`  compiler ${SOURCE} (pinned)`);
console.log(`  ${measured} of ${projects.length} project(s) read whole: ${totals.types} types, ${totals.signatures} signatures, in ${Math.round((Date.now() - started) / 1000)} s`);
console.log(`  ${totals.edges} base edge(s) walked; ${totals.judged} instantiation(s) judged against their declaration's arity, ${totals.membersJudged} against its members`);
console.log(`  ${totals.thisAppended} instantiation(s) carry the appended \`this\` type; ${totals.ambiguous} generic name(s) two declarations share, not judged; ${totals.unsupported} Unsupported type(s)`);
const byRule = new Map();
for (const v of found) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
for (const [rule, vs] of byRule) {
  console.log(`  ${rule}: ${vs.length}`);
  for (const v of vs.slice(0, 12)) console.log(`    ${v.project}: ${v.detail}`);
  if (vs.length > 12) console.log(`    ... ${vs.length - 12} more`);
}
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED  ${u}`);
const ok = found.length === 0 && unmeasured.length === 0 && measured > 0;
console.log(ok ? "  every table consistent" : `  ${found.length} violation(s), ${unmeasured.length} project(s) not measured`);
process.exit(ok ? 0 : 1);
