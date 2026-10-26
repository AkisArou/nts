// Is what `nts types` prints a consistent table?
//
//   node tooling/conformance/types-check.mjs [project ...]   (default: runtime/node/*, runtime/web-platform)
//   node tooling/conformance/types-check.mjs --examples      every tests/programs/* project instead
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

import { longestFirst } from "../gate/costs.mjs";
import { withToken } from "../gate/tokens.mjs";

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
const KINDS = new Set(["Any", "Evolving", "Unknown", "Never", "Void", "Undefined", "Null", "Boolean", "Number", "BigInt", "String", "Symbol", "UniqueSymbol", "NonPrimitive", "Literal", "Object", "Array", "Tuple", "Union", "Intersection", "Function", "TypeParameter", "Conditional", "IndexedAccess", "TemplateLiteral", "Structured", "Unsupported"]);
const ids = (text, re) => [...(text ?? "").matchAll(re)].map((m) => Number(m[1]));
const TYPE_REF = /TypeId\((\d+)\)/g;
const SIG_REF = /SignatureId\((\d+)\)/g;
const HASH_REF = /#(\d+)/g;

/**
 * The Object payload's PropertyRecord keys, as the actual Rust Debug producer
 * spells them. Keep the complete tagged token: Rust's \u{...} escapes are not
 * JSON, and Name/Private/Symbol are disjoint even at the same printed label.
 * The legacy quoted public name remains readable as a Name.
 */
/** Validate the string escape forms emitted by Rust Debug; preserve the token.
 * See core/char/methods.rs escape_debug_ext: simple escapes or a Unicode scalar.
 * This does not decode or canonicalize names across member namespaces.
 */
function rustDebugString(token) {
  if (token[0] !== '"' || token.at(-1) !== '"') return false;
  for (let i = 1; i < token.length - 1; i += 1) {
    const code = token.codePointAt(i);
    if (code === 92) {
      const escaped = token[++i];
      if ('"\\nrt0'.includes(escaped ?? "") && escaped !== undefined) continue;
      if (escaped !== "u" || token[i + 1] !== "{") return false;
      const end = token.indexOf("}", i + 2);
      const digits = end < 0 ? "" : token.slice(i + 2, end);
      if (!/^[0-9a-fA-F]{1,6}$/.test(digits)) return false;
      const scalar = Number.parseInt(digits, 16);
      if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) return false;
      i = end;
    } else {
      if (code === 34 || code < 0x20 || code === 0x7f || (code >= 0xd800 && code <= 0xdfff)) return false;
      if (code > 0xffff) i += 1;
    }
  }
  return true;
}

function objectMembers(payload) {
  const prefix = " { properties: [";
  const suffix = "] }";
  const bad = () => ({ members: [], error: "an Object property list or key was not read" });
  if (!payload.startsWith(prefix) || !payload.endsWith(suffix)) return bad();
  const text = payload.slice(prefix.length, -suffix.length);
  const members = [];
  let at = 0;
  while (at < text.length) {
    const head = "PropertyRecord { name: ";
    if (!text.startsWith(head, at)) return bad();
    const key = /^(?:(Name|Private)\(("(?:[^"\\]|\\.)*")\)|Symbol\(TypeId\((\d+)\)\)|("(?:[^"\\]|\\.)*"))(?=, ty:)/.exec(text.slice(at + head.length));
    if (!key) return bad();
    const stringToken = key[2] ?? key[4];
    if (stringToken !== undefined && !rustDebugString(stringToken)) return bad();
    members.push(key[1] ? `${key[1]}(${key[2]})` : key[3] !== undefined ? `Symbol(TypeId(${key[3]}))` : `Name(${key[4]})`);
    // Find this record's end outside strings, including escaped Rust strings.
    // Delimiter balance also prevents malformed records from looking empty.
    const stack = [];
    let quoted = false, escaped = false, end = -1;
    for (let i = at + "PropertyRecord ".length; i < text.length; i += 1) {
      const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if ("{[(".includes(c)) stack.push(c);
      else if ("}])".includes(c)) {
        if (stack.pop() !== ({ "}": "{", "]": "[", ")": "(" })[c]) return bad();
        if (stack.length === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) return bad();
    at = end;
    if (at < text.length) {
      if (!text.startsWith(", ", at)) return bad();
      at += 2;
      if (at === text.length) return bad();
    }
  }
  return { members, error: null };
}

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
      const object = m[4] === "Object" ? objectMembers(m[5]) : null;
      const members = object?.members ?? null;
      if (object?.error) unread.push(`#${m[1]}: ${object.error}`);
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
    "#1 `T` TypeParameter { name: \"T\", constraint: None, is_this: false }",
    "#2 `Box` args[TypeId(1)] Object { properties: [PropertyRecord { name: Name(\"v\"), ty: TypeId(1), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }",
    "#3 `Box` args[TypeId(0)] Object { properties: [PropertyRecord { name: Name(\"v\"), ty: TypeId(0), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }",
    "#4 Function(SignatureId(0))",
    "#5 `Sub` Object { properties: [] }",
    "base #5 -> [3]",
    "sig#0 (x: #0) -> #3",
  ];
  const rules = (lines) => (judge(lines.join("\n")).violations ?? []).map((v) => v.rule);
  if (rules(good).length !== 0) return `the clean table read as ${rules(good).join(", ")}`;
  const units = judge("#0 UniqueSymbol\n#1 NonPrimitive");
  if (units.violations.length !== 0 || units.types !== 2) return "the schema's two unit kinds were not read";
  if (!rules(["#0 FutureKind"]).includes("read-whole")) return "an unknown kind was accepted";
  for (const kind of ["UniqueSymbol", "NonPrimitive"]) {
    if (!rules([`#0 ${kind}`, "#1 Object { properties: [] }", "base #1 -> [0]"]).includes("base-is-object")) return `${kind} was accepted as a stored object base`;
  }
  const arms = [
    [good.map((l) => l.replace("TypeId(1), readonly", "TypeId(9), readonly")), "resolves", "a property naming a type that does not exist"],
    [good.map((l) => l.replace("SignatureId(0)", "SignatureId(3)")), "resolves", "a function naming a signature that does not exist"],
    [good.map((l) => l.replace("-> #3", "-> #8")), "resolves", "a signature returning a type that does not exist"],
    [[...good, "base #3 -> [5]"], "base-acyclic", "two types each the other's base"],
    [good.map((l) => l.replace("base #5 -> [3]", "base #5 -> [0]")), "base-is-object", "a number as a base"],
    [good.map((l) => l.replace("args[TypeId(0)]", "args[TypeId(0), TypeId(0), TypeId(0)]")), "arity", "an instantiation with two extra arguments"],
    [[...good, "#6 something new"], "read-whole", "a line nothing reads"],
    [good.map((l) => l.replace('name: Name(\"v\"), ty: TypeId(0)', 'name: \"w\", ty: TypeId(0)')), "members", "an instantiation whose member is not its declaration's"],
  ];
  for (const [lines, rule, what] of arms) if (!rules(lines).includes(rule)) return `${what} was not caught (${rules(lines).join(", ") || "clean"})`;
  const property = (key) => `PropertyRecord { name: ${key}, ty: TypeId(0), readonly: false, optional: false, declaration: None, kind: Field, own: true }`;
  const typed = (declared, used) => [
    "#0 Number", "#1 TypeParameter { name: \"T\", constraint: None, is_this: false }",
    "#2 `Box` args[TypeId(1)] Object { properties: [" + declared.map(property).join(", ") + "] }",
    "#3 `Box` args[TypeId(0)] Object { properties: [" + used.map(property).join(", ") + "] }",
  ];
  const publicKey = 'Name("v")', privateKey = 'Private("v")';
  if (rules(typed([publicKey, privateKey], [publicKey, privateKey])).length !== 0) return "matching tagged keys were not read";
  for (const changed of ['Name("w")', privateKey]) {
    if (!rules(typed([publicKey], [changed])).includes("members")) return "a changed tagged member was accepted";
  }
  if (!rules(typed([publicKey, privateKey], [publicKey])).includes("members")) return "a missing private member was accepted";
  for (const key of ['FutureKey("v")', 'Symbol(TypeId(x))', 'Name("v"']) {
    if (!rules(typed([publicKey], [key])).includes("read-whole")) return "an unknown or malformed key was accepted";
  }
  if (rules(typed([], [])).length !== 0) return "legitimate empty property lists failed";
  const symbolic = (key) => [
    "#0 UniqueSymbol", "#1 UniqueSymbol", "#2 Number", "#3 TypeParameter { name: \"T\", constraint: None, is_this: false }",
    "#4 `Box` args[TypeId(3)] Object { properties: [PropertyRecord { name: Symbol(TypeId(0)), ty: TypeId(2), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }",
    `#5 \`Box\` args[TypeId(2)] Object { properties: [PropertyRecord { name: ${key}, ty: TypeId(2), readonly: false, optional: false, declaration: None, kind: Field, own: true }] }`,
  ];
  if (rules(symbolic("Symbol(TypeId(0))")).length !== 0) return "the same symbol ID did not match";
  if (!rules(symbolic("Symbol(TypeId(1))")).includes("members")) return "a different symbol ID was accepted";
  if (!rules(symbolic('Name("v")')).includes("members")) return "a symbol key became public";
  if (!rules(symbolic("Symbol(TypeId(9))")).includes("resolves")) return "a missing symbol type was accepted";
  const escaped = String.raw`Name("a\u{1f600}\" PropertyRecord { name: ")`;
  if (rules(typed([escaped], [escaped])).length !== 0) return "a Rust Debug escape or quoted marker was not preserved";
  const tagged = (tag, literal) => tag === "legacy" ? literal : `${tag}(${literal})`;
  for (const literal of [String.raw`"bad\q"`, String.raw`"bad\u{zz}"`, String.raw`"bad\u{110000}"`, String.raw`"bad\u{d800}"`, String.raw`"bad\u{}"`, String.raw`"bad\u{1234567}"`]) {
    for (const tag of ["Name", "Private", "legacy"]) {
      const key = tagged(tag, literal);
      if (!rules(typed([key], [key])).includes("read-whole")) return "a malformed Rust Debug escape was accepted";
    }
  }
  for (const literal of [String.raw`"quote\"slash\\"`, String.raw`"nul\0tab\tcr\rnl\n"`, String.raw`"edge\u{0}\u{d7ff}\u{e000}\u{10ffff}"`, '"raw💯"']) {
    for (const tag of ["Name", "Private", "legacy"]) {
      const key = tagged(tag, literal);
      if (rules(typed([key], [key])).length !== 0) return "a supported Rust Debug token was rejected";
    }
  }
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

const env = { ...process.env, NTS_CHECKERS: "1" };

const under = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, dir, e.name, "tsconfig.json")))
    .map((e) => `${dir}/${e.name}`);
const named = argv.filter((a) => !a.startsWith("--"));
const projects = (named.length > 0 ? named : argv.includes("--examples") ? under("tests/programs") : [...under("runtime/node"), "runtime/web-platform"]).sort();

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
// Longest first (tooling/gate/costs.mjs); order only, every result is sorted.
const queue = longestFirst(argv.includes("--examples") ? "types-examples" : "types", projects);
await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
  while (next < queue.length) {
    const project = queue[next++];
    const r = await withToken(() => run(["types", project]));
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
