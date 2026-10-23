// Generate the safe syntax edges from upstream's own ordered visitor and accessors.
// No dependency on the generated outputs: a new native field/variant is reviewable.
// This brace-matching text reader does not lex Rust strings/comments. A new
// brace there can change slicing; byte-for-byte regeneration makes that a
// reviewable re-pin diff (or an explicit unknown-form error), never a silent edit.
// node compiler/frontend-tsrs/roles.ts [--check] [--vendor <root>] [--out <adapter>]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
for (let i = 0; i < args.length; i++) {
  if (["--vendor", "--out"].includes(args[i]) && args[i + 1]) i++;
  else if (args[i] !== "--check") throw new Error(`unknown roles argument: ${args[i]}`);
}
const adapter = dirname(fileURLToPath(import.meta.url));
const vendor = resolve(flag("--vendor") ?? join(adapter, "../../third_party/tsrs"));
const output = resolve(flag("--out") ?? adapter);
const generated = readFileSync(join(vendor, "crates/tsrs_ast/src/generated.rs"), "utf8");
const manual = readFileSync(join(vendor, "crates/tsrs_ast/src/ast.rs"), "utf8");
// These balanced blocks are Rust impl/struct/function bodies, not a second AST
// schema. Unknown upstream visitor forms fail rather than silently skip fields.
function block(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error("unbalanced native Rust block");
}
const implementations = new Map<string, string[]>();
const visitors: { owner: string; body: string }[] = [];
const nativeEnum = /pub enum NodeData \{/.exec(generated)!;
const variants = [...block(generated, nativeEnum.index + nativeEnum[0].length - 1).matchAll(/^    (\w+)(?:\(&'static (\w+)\))?,/gm)];
const payloads = new Set(variants.map((variant) => variant[2]));
for (const text of [generated, manual]) {
  for (const match of text.matchAll(/^impl (\w+) \{/gm)) {
    const owner = match[1];
    const body = block(text, match.index! + match[0].length - 1);
    implementations.set(owner, [...(implementations.get(owner) ?? []), body]);
    const visitor = /pub fn for_each_child(?:<[^\n]+>)?\([^]*?\) -> bool \{/.exec(body);
    if (visitor && payloads.has(owner)) visitors.push({ owner, body: block(body, visitor.index + visitor[0].length - 1) });
  }
}
type Field = { field: string; role: "child" | "list"; cardinality: string; variant: string };
type Entry = { owner: string; fields: Field[]; order: string };
const entries: Entry[] = [];
const method = new Map<string, string>();
const access = new Map<string, string>();
for (const { owner, body: original } of visitors) {
  let body = original;
  if (owner === "JSDocParameterOrPropertyTag") {
    const helper = /fn for_each_child_jsdoc_parameter_or_property_tag[^]*?\) -> bool \{/.exec(manual);
    if (!helper || !body.includes("for_each_child_jsdoc_parameter_or_property_tag")) throw new Error("unknown JSDoc visitor");
    body = block(manual, helper.index + helper[0].length - 1).replaceAll("node.", "self.");
  }
  const fields: Field[] = [];
  for (const match of body.matchAll(/self\.(\w+)(\(\))?/g)) {
    const field = match[1];
    if (field === "is_name_first" || fields.some((item) => item.field === field)) continue;
    const accessor = match[2] !== undefined;
    const impl = (implementations.get(owner) ?? []).join("\n");
    let type: string;
    if (accessor) {
      const getter = new RegExp(`pub fn ${field}\\(&self\\) -> ([^\\n{]+)`).exec(impl);
      if (!getter) throw new Error(`no getter type for ${owner}.${field}`);
      type = getter[1].trim();
    } else {
      const struct = new RegExp(`pub struct ${owner} \\{`).exec(generated + manual);
      if (!struct) throw new Error(`no struct for ${owner}`);
      const members = block(generated + manual, struct.index + struct[0].length - 1);
      const member = new RegExp(`pub ${field}: ([^\\n,]+)`).exec(members);
      if (!member) throw new Error(`no field type for ${owner}.${field}`);
      type = member[1].trim();
    }
    const list = /(?:NodeList|ModifierList|\[P<Node>\])/.test(type);
    if (!list && !/^(?:Option<)?P<Node>>?$/.test(type)) throw new Error(`unknown child type ${owner}.${field}: ${type}`);
    const role = list ? "list" : "child";
    const cardinality = list ? (type.startsWith("Option<") ? "optional-list" : "list") : (type.startsWith("Option<") ? "optional" : "one");
    const variant = owner + field.split("_").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
    fields.push({ field: field.replace(/_$/, ""), role, cardinality, variant });
    access.set(variant, field + (accessor && owner !== "SourceFile" ? "()" : ""));
    method.set(variant, /ModifierList/.test(type) ? "modifiers" : /\[P<Node>\]/.test(type) ? "slice" : role);
  }
  if (!fields.length) throw new Error(`native visitor ${owner} has no recognized children`);
  entries.push({ owner, fields, order: owner === "JSDocParameterOrPropertyTag" ? "name/type_expression depend on is_name_first" : "listed native visitor order" });
}
const byOwner = new Map(entries.map((entry) => [entry.owner, entry]));
let rust = "// Native struct field roles, derived from the pinned native visitor.\n// No syntax-kind conversion or encoded AST data is involved.\nuse super::{Edge, Edges, Node};\nuse tsrs_ast::NodeData;\n\n";
for (const [name, role] of [["ChildRole", "child"], ["ListRole", "list"]]) {
  rust += `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]\npub enum ${name} {\n`;
  for (const { fields } of entries) for (const f of fields) if (f.role === role) rust += `/// ${f.cardinality}\n${f.variant},\n`;
  rust += "}\n\n";
}
rust += '#[expect(clippy::too_many_lines, clippy::match_same_arms, reason = "mechanical exhaustive native-node dispatch retains one arm per upstream payload")]\npub(super) fn edges(node: Node<\'_>) -> Vec<Edge<\'_>> {\nlet mut edges = Edges::new(node);\nmatch node.native.data() {\n';
function edge(f: Field, direct = false): string {
  return `edges.${method.get(f.variant)}(${f.role === "child" ? "ChildRole" : "ListRole"}::${f.variant}, data.${direct ? f.field : access.get(f.variant)});\n`;
}
for (const variant of variants) {
  const [, name, owner] = variant;
  const entry = byOwner.get(owner);
  if (!entry) { rust += `NodeData::${name}${owner ? "(_data)" : ""} => {}\n`; continue; }
  rust += `NodeData::${name}(data) => {\n`;
  if (owner === "JSDocParameterOrPropertyTag") {
    const [tag, name, type, comment] = entry.fields;
    rust += edge(tag) + "if data.is_name_first {\n" + edge(name, true) + edge(type, true) + "} else {\n" + edge(type, true) + edge(name, true) + "}\n" + edge(comment);
  } else for (const f of entry.fields) rust += edge(f);
  rust += "}\n";
}
rust += "}\nedges.finish()\n}\n\nimpl ChildRole {\n";
for (const [name, fields] of [
  ["initializer", ["initializer", "object_assignment_initializer"]],
  ["body", ["body"]], ["asterisk", ["asterisk_token"]],
  ["rest", ["dot_dot_dot_token"]], ["question", ["question_token", "postfix_token"]],
] as const) {
  const variants = entries.flatMap((e) => e.fields).filter((f) => f.role === "child" && (fields as readonly string[]).includes(f.field)).map((f) => `Self::${f.variant}`);
  rust += `pub(super) fn marks_${name}(self) -> bool { matches!(self, ${variants.join(" | ")}) }\n`;
}
rust += "}\n";
rust = execFileSync("rustfmt", ["--edition", "2024", "--config-path", join(adapter, "../../rustfmt.toml"), "--emit", "stdout"], { input: rust, maxBuffer: 2 << 20 }).toString();
const upstream = readFileSync(join(vendor, "MANIFEST"), "utf8").split("\n")[0];
const json = JSON.stringify({ upstream, rule: "A role belongs to one distinct field of its native node struct. Missing optional child/list => no edge. Present empty list => list edge with zero elements. Required fields always have edges. All edge order is native visitor order, including the runtime JSDoc name/type-expression order.", nodes: entries }, null, 2) + "\n";
const files = [["src/ast_roles.rs", rust], ["api/roles.json", json]];
if (args.includes("--check")) {
  const temporary = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-tsrs-roles-"));
  try {
    const changed: string[] = [];
    for (const [name, contents] of files) {
      const actual = join(output, name), expected = join(temporary, name);
      mkdirSync(dirname(expected), { recursive: true });
      writeFileSync(expected, contents);
      if (readFileSync(actual, "utf8") !== contents) {
        changed.push(name);
        try { execFileSync("diff", ["-u", actual, expected], { stdio: "inherit" }); } catch {}
      }
    }
    if (changed.length) throw new Error(`native field-role drift: ${changed.join(", ")}; run node compiler/frontend-tsrs/roles.ts`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
} else for (const [name, contents] of files) { mkdirSync(dirname(join(output, name)), { recursive: true }); writeFileSync(join(output, name), contents); }
process.stdout.write(`native roles: ${entries.length} payloads, ${entries.reduce((n, e) => n + e.fields.length, 0)} fields verified\n`);
